/**
 * Direct transfer: send files of any size straight from one browser to
 * another (computer ↔ phone), with no upload and no size limit.
 *
 * How it works:
 * - The device showing the QR code is the *host*. It registers a random,
 *   single-use ID with a public matchmaking server (PeerJS's free cloud
 *   server by default) and waits.
 * - The QR code holds a link `<app>#/d/<id>.<secret>.<s|r>`. Opening it makes
 *   the other device (the *guest*) ask the matchmaker to introduce it to that
 *   ID. The matchmaker only passes connection details between the two; the
 *   file never touches it, and the secret (in the URL fragment) never leaves
 *   the two devices.
 * - The browsers then connect directly over WebRTC. On networks that block
 *   direct connections, traffic goes through PeerJS's free TURN relay, which
 *   only ever sees encrypted bytes.
 * - Before anything is sent, both sides prove they hold the secret and see
 *   the same connection certificates, and every message is sealed with
 *   AES-256-GCM (see core/direct-crypto.ts).
 * - `s` means the host sends (e.g. a file from the computer to the phone);
 *   `r` means the host receives (e.g. photos from the phone to the computer).
 *
 * Wire format, after the security check: every message is a sealed frame of
 * `[u8 kind][payload]`; kind 1 is JSON control, kind 2 is file bytes. The
 * sender announces the files, streams each one's bytes in order, then says
 * "done"; the receiver checks the sizes and confirms.
 */
import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import { Channel, authTag, deriveKeys, fromB64url, newSecret, sdpFingerprint, toB64url, verifyTag, type Role } from './direct-crypto';

/** Route prefix, without the leading `#`. */
export const DIRECT_ROUTE = '/d/';

export interface Invite {
  peerId: string;
  secret: Uint8Array;
  /** True when the host sends and the guest receives. */
  hostSends: boolean;
}

export type Status =
  | { state: 'starting' }
  | { state: 'waiting' }
  | { state: 'connecting' }
  | { state: 'secured' }
  | { state: 'transferring'; direction: 'send' | 'receive'; done: number; total: number; file: string }
  | { state: 'done'; direction: 'send' | 'receive' }
  | { state: 'failed'; message: string };

export interface Handlers {
  onStatus: (status: Status) => void;
  /** Called on the receiving side once every file has arrived intact. */
  onReceived?: (files: File[]) => void;
}

const KIND_JSON = 1;
const KIND_DATA = 2;
const CHUNK = 64 * 1024;
/** Pause sending while this much is queued, so memory stays flat. */
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;
const CONNECT_TIMEOUT_MS = 25_000;

const SERVER_SETTING = 'formatter-peer-server';

/**
 * Matchmaker settings. PeerJS's free cloud server unless a custom one is
 * saved (as JSON PeerOptions, e.g. `{"host":"localhost","port":9000}`) under
 * `formatter-peer-server` in localStorage, for self-hosting or testing.
 */
function peerOptions(): PeerOptions {
  try {
    const saved = localStorage.getItem(SERVER_SETTING);
    if (saved) return { ...JSON.parse(saved), debug: 0 };
  } catch {
    /* storage blocked: use the default */
  }
  return { debug: 0 };
}

export function inviteLink(base: string, invite: Invite): string {
  return `${base}#${DIRECT_ROUTE}${invite.peerId}.${toB64url(invite.secret)}.${invite.hostSends ? 's' : 'r'}`;
}

/** Read an invite from a `#/d/…` fragment; null if it isn't one. */
export function parseInvite(hash: string): Invite | null {
  const match = hash.match(/^#\/d\/([A-Za-z0-9-]+)\.([A-Za-z0-9_-]{22})\.([sr])$/);
  if (!match) return null;
  return { peerId: match[1], secret: fromB64url(match[2]), hostSends: match[3] === 's' };
}

function newPeerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `fmt-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Plain-language message for PeerJS errors. */
function explain(error: unknown): string {
  const type = (error as { type?: string })?.type;
  switch (type) {
    case 'peer-unavailable':
      return 'The other device is no longer waiting. Make a new QR code and scan it again.';
    case 'browser-incompatible':
      return "This browser can't make direct connections. Try an up-to-date Chrome, Safari, Edge or Firefox.";
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return "Couldn't reach the matchmaking server. Check your internet connection and try again.";
    default:
      return error instanceof Error ? error.message : 'The connection failed. Try again.';
  }
}

export class DirectTransfer {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private channel: Channel | null = null;
  private secured = false;
  private finished = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Incoming frames are opened one at a time, in arrival order. */
  private inbox: Promise<void> = Promise.resolve();
  private incoming: { list: { name: string; type: string; size: number }[]; index: number; parts: Uint8Array[]; got: number; files: File[] } | null = null;
  private resolveSent: (() => void) | null = null;

  private constructor(
    readonly invite: Invite,
    readonly role: Role,
    private handlers: Handlers,
  ) {}

  /** Whether this side sends the files. */
  get sends(): boolean {
    return this.invite.hostSends === (this.role === 'host');
  }

  /** Start waiting for a guest. Show `inviteLink(…, transfer.invite)` as a QR code once the status is `waiting`. */
  static host(hostSends: boolean, handlers: Handlers): DirectTransfer {
    const transfer = new DirectTransfer({ peerId: newPeerId(), secret: newSecret(), hostSends }, 'host', handlers);
    transfer.start();
    return transfer;
  }

  /** Connect to the host from an invite link. */
  static join(invite: Invite, handlers: Handlers): DirectTransfer {
    const transfer = new DirectTransfer(invite, 'guest', handlers);
    transfer.start();
    return transfer;
  }

  private status(s: Status) {
    if (!this.finished || s.state === 'done' || s.state === 'failed') this.handlers.onStatus(s);
  }

  private fail(message: string) {
    if (this.finished) return;
    this.status({ state: 'failed', message });
    this.finished = true;
    this.close();
  }

  private async start() {
    this.status({ state: 'starting' });
    try {
      const { Peer } = await import('peerjs');
      const peer = this.role === 'host' ? new Peer(this.invite.peerId, peerOptions()) : new Peer(peerOptions());
      this.peer = peer;
      peer.on('error', (e) => this.fail(explain(e)));
      peer.on('open', () => {
        if (this.role === 'host') {
          this.status({ state: 'waiting' });
          peer.on('connection', (conn) => {
            // One guest per invite; anyone else is turned away.
            if (this.conn) conn.close();
            else this.attach(conn);
          });
        } else {
          this.attach(peer.connect(this.invite.peerId, { reliable: true, serialization: 'raw' }));
        }
      });
    } catch (e) {
      this.fail(explain(e));
    }
  }

  private attach(conn: DataConnection) {
    this.conn = conn;
    this.status({ state: 'connecting' });
    this.timer = setTimeout(
      () => this.fail("The devices couldn't connect. Make sure both are online (the same Wi-Fi works best) and try again."),
      CONNECT_TIMEOUT_MS,
    );
    conn.on('open', () => this.handshake().catch((e) => this.fail(explain(e))));
    conn.on('data', (data) => {
      this.inbox = this.inbox.then(() => this.onData(data)).catch((e) => this.fail(explain(e)));
    });
    conn.on('close', () => {
      if (!this.finished) this.fail('The other device disconnected before the transfer finished.');
    });
    conn.on('error', (e) => this.fail(explain(e)));
  }

  private keys: Awaited<ReturnType<typeof deriveKeys>> | null = null;
  private fingerprints: { own: string; peer: string } | null = null;

  private async handshake() {
    const pc = this.conn!.peerConnection;
    this.fingerprints = { own: sdpFingerprint(pc.localDescription?.sdp), peer: sdpFingerprint(pc.remoteDescription?.sdp) };
    this.keys = await deriveKeys(this.invite.secret, this.role);
    this.channel = new Channel(this.keys);
    const tag = await authTag(this.keys, this.role, this.fingerprints.own, this.fingerprints.peer);
    this.conn!.send(JSON.stringify({ t: 'auth', tag }));
  }

  private async onData(data: unknown) {
    if (!this.secured) {
      // The only message accepted before the check passes is the other side's tag.
      const message = typeof data === 'string' ? JSON.parse(data) : null;
      if (message?.t !== 'auth' || !this.keys || !this.fingerprints) throw new Error('The other device sent something unexpected, so the connection was closed.');
      const peerRole: Role = this.role === 'host' ? 'guest' : 'host';
      const ok = await verifyTag(this.keys, peerRole, this.fingerprints.own, this.fingerprints.peer, message.tag);
      if (!ok) throw new Error("The security check failed: this isn't the device that scanned or showed your QR code. Nothing was sent.");
      clearTimeout(this.timer);
      this.secured = true;
      this.status({ state: 'secured' });
      return;
    }
    if (!(data instanceof ArrayBuffer)) throw new Error('The other device sent something unexpected, so the connection was closed.');
    const frame = await this.channel!.open(data);
    const body = frame.subarray(1);
    if (frame[0] === KIND_JSON) await this.onControl(JSON.parse(new TextDecoder().decode(body)));
    else if (frame[0] === KIND_DATA) this.onChunk(body);
  }

  private async onControl(message: { t: string; files?: { name: string; type: string; size: number }[] }) {
    if (message.t === 'files' && !this.sends && message.files) {
      this.incoming = { list: message.files, index: 0, parts: [], got: 0, files: [] };
      this.nextIncoming();
    } else if (message.t === 'done' && this.incoming) {
      const { list, files } = this.incoming;
      if (files.length !== list.length) throw new Error('Some files arrived incomplete. Try again.');
      await this.sendJson({ t: 'got' });
      this.finished = true;
      this.status({ state: 'done', direction: 'receive' });
      this.handlers.onReceived?.(files);
      setTimeout(() => this.close(), 1000);
    } else if (message.t === 'got' && this.sends) {
      this.resolveSent?.();
    }
  }

  /** Finish files that are complete (including empty ones) and report progress. */
  private nextIncoming() {
    const inc = this.incoming!;
    for (;;) {
      const meta = inc.list[inc.index];
      if (!meta) return;
      const size = inc.parts.reduce((n, p) => n + p.length, 0);
      if (size < meta.size) break;
      if (size > meta.size) throw new Error('A file arrived larger than announced, so the transfer was stopped.');
      inc.files.push(new File(inc.parts as BlobPart[], meta.name, { type: meta.type }));
      inc.parts = [];
      inc.index++;
    }
    const total = inc.list.reduce((n, f) => n + f.size, 0);
    this.status({ state: 'transferring', direction: 'receive', done: inc.got, total, file: inc.list[inc.index]?.name ?? '' });
  }

  private onChunk(bytes: Uint8Array) {
    if (!this.incoming) throw new Error('The other device sent data before saying what it was.');
    this.incoming.parts.push(bytes.slice());
    this.incoming.got += bytes.length;
    this.nextIncoming();
  }

  private async sendFrame(kind: number, payload: Uint8Array) {
    const plain = new Uint8Array(payload.length + 1);
    plain[0] = kind;
    plain.set(payload, 1);
    const sealed = await this.channel!.seal(plain);
    const dc = this.conn!.dataChannel;
    if (dc.bufferedAmount > HIGH_WATER) {
      dc.bufferedAmountLowThreshold = LOW_WATER;
      await new Promise<void>((resolve) => dc.addEventListener('bufferedamountlow', () => resolve(), { once: true }));
    }
    if (this.finished || dc.readyState !== 'open') throw new Error('The other device disconnected before the transfer finished.');
    dc.send(sealed);
  }

  private sendJson(message: object) {
    return this.sendFrame(KIND_JSON, new TextEncoder().encode(JSON.stringify(message)));
  }

  /** Send files to the other device. Call once the status is `secured`, on the sending side. */
  async send(files: File[]): Promise<void> {
    if (!this.secured || !this.sends) throw new Error('Not ready to send yet.');
    const total = files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    try {
      await this.sendJson({ t: 'files', files: files.map((f) => ({ name: f.name, type: f.type || 'application/octet-stream', size: f.size })) });
      for (const file of files) {
        for (let offset = 0; offset < file.size; offset += CHUNK) {
          const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
          await this.sendFrame(KIND_DATA, bytes);
          done += bytes.length;
          this.status({ state: 'transferring', direction: 'send', done, total, file: file.name });
        }
      }
      const confirmed = new Promise<void>((resolve) => (this.resolveSent = resolve));
      await this.sendJson({ t: 'done' });
      await confirmed;
      this.finished = true;
      this.status({ state: 'done', direction: 'send' });
      setTimeout(() => this.close(), 1000);
    } catch (e) {
      this.fail(explain(e));
    }
  }

  /** Stop and disconnect; the invite can't be used again. */
  close() {
    clearTimeout(this.timer);
    this.finished = true;
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }
}
