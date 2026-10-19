/**
 * Direct transfer: a secure, lasting connection between two browsers
 * (computer ↔ phone) for sending files of any size, either way, with no
 * upload and no size limit.
 *
 * How it works:
 * - The device showing the QR code is the *host*. It registers a random ID
 *   with a public matchmaking server (PeerJS's free cloud server by default)
 *   and waits.
 * - The QR code holds a link `<app>#/d/<id>.<secret>.<s|r>`. Opening it makes
 *   the other device (the *guest*) ask the matchmaker to introduce it to that
 *   ID. The matchmaker only passes connection details between the two; files
 *   never touch it, and the secret (in the URL fragment) never leaves the two
 *   devices.
 * - The browsers then connect directly over WebRTC. On networks that block
 *   direct connections, traffic goes through PeerJS's free TURN relay, which
 *   only ever sees encrypted bytes.
 * - Before anything is sent, both sides prove they hold the secret and see
 *   the same connection certificates, and every message is sealed with
 *   AES-256-GCM (see core/direct-crypto.ts).
 * - Once connected, either side can send files and text messages at any
 *   time, as often as it likes, until one side ends the session. If the
 *   connection drops (a phone locks its screen, Wi-Fi blips, a page
 *   reloads), the guest reconnects to the same host with the same secret and
 *   fresh keys, so nobody has to scan again. A reloaded host registers the
 *   same ID again (`resume`). Each transfer links one host and one guest; a
 *   device connected to several others runs one transfer per device.
 * - `s` / `r` in the link say whether the host started with files to send;
 *   it only decides which screen the guest opens on.
 *
 * Wire format, after the security check: every message is a sealed frame of
 * `[u8 kind][payload]`; kind 1 is JSON control, kind 2 is file bytes. A
 * sender announces a batch (`files`), streams each file's bytes in order,
 * then says `done`; the receiver checks the sizes and confirms (`got`).
 * Each side sends one batch at a time, so bytes always belong to the batch
 * that side announced last; batches in the two directions can overlap.
 * Other control messages: `hello` (the device's display name and kind,
 * such as "Blue Otter" and "iPhone · Safari", sent on each connection and
 * again after a rename), `text` (a chat message, confirmed with `got`, re-sent
 * after a reconnect until confirmed, so the receiver drops repeats by id)
 * `sig` (call signalling, passed to `onSignal` as is; see core/call.ts) and
 * `bye` (end the session). Frames go out strictly in the order they
 * are sealed, because the receiver expects consecutive counter nonces.
 */
import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import { Channel, authKey, authTag, channelKeys, fromB64url, newNonce, newSecret, sdpFingerprint, toB64url, verifyTag, type Role } from './direct-crypto';

/** Route prefix, without the leading `#`. */
export const DIRECT_ROUTE = '/d/';

export interface Invite {
  peerId: string;
  secret: Uint8Array;
  /** True when the host started with files to send. */
  hostSends: boolean;
}

export type ConnectionState =
  | { state: 'starting' }
  /** Host: registered and waiting for the QR code to be scanned (or for the guest to come back). */
  | { state: 'waiting'; reconnect: boolean }
  | { state: 'connecting' }
  | { state: 'connected' }
  /** Guest: the connection dropped and it is trying to get back. */
  | { state: 'reconnecting' }
  | { state: 'ended'; message: string }
  | { state: 'failed'; message: string };

export interface Progress {
  id: string;
  direction: 'send' | 'receive';
  done: number;
  total: number;
  /** File currently going across. */
  file: string;
}

export interface Handlers {
  onState: (state: ConnectionState) => void;
  onProgress?: (progress: Progress) => void;
  /** A batch arrived intact. */
  onReceived?: (id: string, files: File[]) => void;
  /** The other side confirmed a batch this side sent. */
  onSent?: (id: string) => void;
  /** A batch stopped part-way (the connection dropped). */
  onAborted?: (id: string, direction: 'send' | 'receive') => void;
  /** The other device said its name (once per connection). */
  onHello?: (name: string, kind: string) => void;
  /** A text message arrived. The same id can arrive twice after a reconnect. */
  onText?: (id: string, text: string, at: number) => void;
  /** Call signalling from the other device (see core/call.ts). */
  onSignal?: (data: unknown) => void;
}

export interface TransferOptions {
  /** This device's display name, shown on the other device. */
  name?: string;
  /** What kind of device and browser this is, e.g. "iPhone · Safari". */
  kind?: string;
  /** Picking up a session after this page reloaded: keep trying to reconnect instead of failing. */
  resume?: boolean;
}

interface FileMeta {
  name: string;
  type: string;
  size: number;
}

const KIND_JSON = 1;
const KIND_DATA = 2;
const CHUNK = 64 * 1024;
/** Pause sending while this much is queued, so memory stays flat. */
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;
const CONNECT_TIMEOUT_MS = 25_000;
/** How long a guest keeps trying to get back after the connection drops. */
const RECONNECT_FOR_MS = 3 * 60_000;
const RECONNECT_EVERY_MS = 4_000;
/** A reloaded host may find its ID still taken for a moment; how long it keeps asking for it. */
const RECLAIM_FOR_MS = 30_000;

const IDLE_MESSAGE = 'Closed after 15 minutes without activity.';

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
    case 'unavailable-id':
      return 'This QR code is already in use in another tab. Make a new one.';
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

/** One connection attempt: handshake, encryption and the batches sent over it. */
interface Link {
  conn: DataConnection;
  channel: Channel | null;
  secured: boolean;
  nonce: string;
  fingerprints: { own: string; peer: string } | null;
  /** Opens incoming frames one at a time, in arrival order. */
  inbox: Promise<void>;
  incoming: { id: string; list: FileMeta[]; index: number; parts: Uint8Array[]; got: number; files: File[] } | null;
  confirm: Map<string, () => void>;
  /** Frames go out one after another, in sealing order. */
  out: Promise<void>;
  /** Text messages already sent over this connection, awaiting `got`. */
  textsSent: Set<string>;
  /** Settles once this side's own tag is sent; nothing else may go out (or be checked) before it. */
  authSent: Promise<void>;
  authDone: () => void;
}

export class DirectTransfer {
  private peer: Peer | null = null;
  private link: Link | null = null;
  private ended = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reconnectUntil = 0;
  private auth: Promise<CryptoKey>;
  /** Batches waiting to go out, sent one after another. */
  private outbox: { id: string; files: File[] }[] = [];
  private sending = false;
  /** Text messages not yet confirmed by the other device. */
  private texts = new Map<string, { text: string; at: number }>();
  private reclaimUntil = 0;

  private constructor(
    readonly invite: Invite,
    readonly role: Role,
    private handlers: Handlers,
    private options: TransferOptions,
  ) {
    this.auth = authKey(invite.secret);
  }

  /**
   * Start waiting for a guest. Show `inviteLink(…, transfer.invite)` as a QR
   * code once the state is `waiting`. Pass `invite` (with `resume`) to pick
   * up a session this page hosted before it reloaded.
   */
  static host(hostSends: boolean, handlers: Handlers, options: TransferOptions & { invite?: Invite } = {}): DirectTransfer {
    const invite = options.invite ?? { peerId: newPeerId(), secret: newSecret(), hostSends };
    const transfer = new DirectTransfer(invite, 'host', handlers, options);
    if (options.resume) transfer.reclaimUntil = Date.now() + RECLAIM_FOR_MS;
    transfer.start();
    return transfer;
  }

  /** Connect to the host from an invite link. */
  static join(invite: Invite, handlers: Handlers, options: TransferOptions = {}): DirectTransfer {
    const transfer = new DirectTransfer(invite, 'guest', handlers, options);
    if (options.resume) transfer.reconnectUntil = Date.now() + RECONNECT_FOR_MS;
    transfer.start();
    return transfer;
  }

  get connected(): boolean {
    return !!this.link?.secured;
  }

  private state(s: ConnectionState) {
    if (!this.ended || s.state === 'ended' || s.state === 'failed') this.handlers.onState(s);
  }

  private fail(message: string) {
    if (this.ended) return;
    this.state({ state: 'failed', message });
    this.shutdown();
  }

  private async start() {
    this.state({ state: 'starting' });
    try {
      const { Peer } = await import('peerjs');
      const peer = this.role === 'host' ? new Peer(this.invite.peerId, peerOptions()) : new Peer(peerOptions());
      this.peer = peer;
      peer.on('error', (e) => {
        const type = (e as { type?: string }).type;
        // A guest retrying after a drop sees "unavailable" while the host is briefly away; keep trying.
        if (this.role === 'guest' && Date.now() < this.reconnectUntil && type === 'peer-unavailable') {
          if (this.link) this.lost(this.link);
          else this.timer = setTimeout(() => this.dial(), RECONNECT_EVERY_MS);
          return;
        }
        // A reloaded host's old registration can linger for a moment; ask again.
        if (this.role === 'host' && Date.now() < this.reclaimUntil && type === 'unavailable-id') {
          peer.destroy();
          this.timer = setTimeout(() => !this.ended && this.start(), 2_000);
          return;
        }
        this.fail(explain(e));
      });
      // Phones drop the matchmaker's socket when the page is in the background; rejoin quietly.
      peer.on('disconnected', () => !this.ended && !peer.destroyed && peer.reconnect());
      peer.on('open', () => {
        if (this.role === 'host') {
          this.reclaimUntil = 0;
          this.state({ state: 'waiting', reconnect: !!this.options.resume });
          peer.on('connection', (conn) => {
            // One guest at a time; anyone else is turned away.
            if (this.link) conn.close();
            else this.attach(conn);
          });
        } else if (!this.link) {
          this.dial();
        }
      });
    } catch (e) {
      this.fail(explain(e));
    }
  }

  private dial() {
    // While the matchmaker socket is down, the peer's 'open' event dials once it is back.
    if (this.ended || this.link || !this.peer || this.peer.disconnected) return;
    this.attach(this.peer.connect(this.invite.peerId, { reliable: true, serialization: 'raw' }));
  }

  private attach(conn: DataConnection) {
    const link: Link = {
      conn,
      channel: null,
      secured: false,
      nonce: newNonce(),
      fingerprints: null,
      inbox: Promise.resolve(),
      incoming: null,
      confirm: new Map(),
      out: Promise.resolve(),
      textsSent: new Set(),
      authSent: Promise.resolve(),
      authDone: () => {},
    };
    link.authSent = new Promise((resolve) => (link.authDone = resolve));
    this.link = link;
    if (Date.now() >= this.reconnectUntil) this.state({ state: 'connecting' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lost(link, true), CONNECT_TIMEOUT_MS);
    conn.on('open', () => this.handshake(link).catch((e) => this.drop(link, explain(e))));
    conn.on('data', (data) => {
      link.inbox = link.inbox.then(() => this.onData(link, data)).catch((e) => this.drop(link, explain(e)));
    });
    conn.on('close', () => this.lost(link));
    conn.on('error', () => this.lost(link));
    // PeerJS doesn't always notice a dead connection; the browser does.
    conn.peerConnection?.addEventListener('connectionstatechange', () => {
      const s = conn.peerConnection?.connectionState;
      if (s === 'failed' || s === 'closed') this.lost(link);
    });
  }

  /** A security problem: stop for good, nothing more is sent. */
  private drop(link: Link, message: string) {
    if (this.link === link) this.fail(message);
  }

  /** The connection went away (or never came up): wait for a reconnect, or give up. */
  private lost(link: Link, timedOut = false) {
    if (this.link !== link || this.ended) return;
    this.link = null;
    clearTimeout(this.timer);
    link.conn.close();
    if (link.incoming) this.handlers.onAborted?.(link.incoming.id, 'receive');
    for (const id of link.confirm.keys()) this.handlers.onAborted?.(id, 'send');
    link.confirm.clear();
    const wasConnected = link.secured;
    if (this.role === 'host') {
      // The same QR code stays valid, so the guest can come back.
      this.state({ state: 'waiting', reconnect: wasConnected });
      return;
    }
    if (wasConnected) this.reconnectUntil = Date.now() + RECONNECT_FOR_MS;
    if (Date.now() < this.reconnectUntil) {
      this.state({ state: 'reconnecting' });
      this.timer = setTimeout(() => this.dial(), RECONNECT_EVERY_MS);
    } else {
      this.fail(
        timedOut
          ? "The devices couldn't connect. Make sure both are online (the same Wi-Fi works best) and try again."
          : 'The connection to the other device was lost. Scan the QR code again to reconnect.',
      );
    }
  }

  private async handshake(link: Link) {
    const pc = link.conn.peerConnection;
    link.fingerprints = { own: sdpFingerprint(pc.localDescription?.sdp), peer: sdpFingerprint(pc.remoteDescription?.sdp) };
    const tag = await authTag(await this.auth, this.role, link.fingerprints.own, link.fingerprints.peer, link.nonce);
    link.conn.send(JSON.stringify({ t: 'auth', nonce: link.nonce, tag }));
    link.authDone();
  }

  private async onData(link: Link, data: unknown) {
    if (this.link !== link) return;
    if (!link.secured) {
      // The other side's tag can arrive before this side has sent its own (or even seen the connection open).
      await link.authSent;
      if (this.link !== link) return;
      // The only message accepted before the check passes is the other side's tag.
      const message = typeof data === 'string' ? JSON.parse(data) : null;
      if (message?.t !== 'auth' || typeof message.nonce !== 'string' || !link.fingerprints) {
        throw new Error('The other device sent something unexpected, so the connection was closed.');
      }
      const peerRole: Role = this.role === 'host' ? 'guest' : 'host';
      const ok = await verifyTag(await this.auth, peerRole, link.fingerprints.own, link.fingerprints.peer, message.nonce, message.tag);
      if (!ok) throw new Error("The security check failed: this isn't the device that scanned or showed your QR code. Nothing was sent.");
      const [hostNonce, guestNonce] = this.role === 'host' ? [link.nonce, message.nonce] : [message.nonce, link.nonce];
      link.channel = new Channel(await channelKeys(this.invite.secret, this.role, hostNonce, guestNonce));
      clearTimeout(this.timer);
      this.reconnectUntil = 0;
      link.secured = true;
      this.state({ state: 'connected' });
      this.hello(link);
      this.flushTexts();
      this.pump();
      return;
    }
    if (!(data instanceof ArrayBuffer)) throw new Error('The other device sent something unexpected, so the connection was closed.');
    const frame = await link.channel!.open(data);
    const body = frame.subarray(1);
    if (frame[0] === KIND_JSON) await this.onControl(link, JSON.parse(new TextDecoder().decode(body)));
    else if (frame[0] === KIND_DATA) this.onChunk(link, body);
  }

  private async onControl(link: Link, message: { t: string; id?: string; files?: FileMeta[]; name?: unknown; kind?: unknown; text?: unknown; at?: unknown; d?: unknown }) {
    const id = String(message.id ?? '');
    if (message.t === 'files' && Array.isArray(message.files)) {
      if (link.incoming) this.handlers.onAborted?.(link.incoming.id, 'receive');
      link.incoming = { id, list: message.files, index: 0, parts: [], got: 0, files: [] };
      this.advance(link);
    } else if (message.t === 'done' && link.incoming?.id === id) {
      const { list, files } = link.incoming;
      link.incoming = null;
      if (files.length !== list.length) throw new Error('Some files arrived incomplete, so the connection was closed.');
      await this.sendJson(link, { t: 'got', id });
      this.handlers.onReceived?.(id, files);
    } else if (message.t === 'got') {
      link.confirm.get(id)?.();
      if (this.texts.delete(id)) this.handlers.onSent?.(id);
    } else if (message.t === 'hello' && typeof message.name === 'string') {
      this.handlers.onHello?.(message.name.slice(0, 40), typeof message.kind === 'string' ? message.kind.slice(0, 60) : '');
    } else if (message.t === 'text' && typeof message.text === 'string' && id) {
      await this.sendJson(link, { t: 'got', id });
      this.handlers.onText?.(id, message.text, typeof message.at === 'number' ? message.at : Date.now());
    } else if (message.t === 'sig') {
      this.handlers.onSignal?.(message.d);
    } else if (message.t === 'bye') {
      const idle = (message as { reason?: string }).reason === 'idle';
      this.state({ state: 'ended', message: idle ? IDLE_MESSAGE : 'The other device ended the session.' });
      this.shutdown();
    }
  }

  /** Finish files that are complete (including empty ones) and report progress. */
  private advance(link: Link) {
    const inc = link.incoming!;
    for (;;) {
      const meta = inc.list[inc.index];
      if (!meta) break;
      const size = inc.parts.reduce((n, p) => n + p.length, 0);
      if (size < meta.size) break;
      if (size > meta.size) throw new Error('A file arrived larger than announced, so the connection was closed.');
      inc.files.push(new File(inc.parts as BlobPart[], meta.name, { type: meta.type }));
      inc.parts = [];
      inc.index++;
    }
    const total = inc.list.reduce((n, f) => n + f.size, 0);
    this.handlers.onProgress?.({ id: inc.id, direction: 'receive', done: inc.got, total, file: inc.list[inc.index]?.name ?? '' });
  }

  private onChunk(link: Link, bytes: Uint8Array) {
    if (!link.incoming) throw new Error('The other device sent data before saying what it was.');
    link.incoming.parts.push(bytes.slice());
    link.incoming.got += bytes.length;
    this.advance(link);
  }

  /** Seal and send one frame, after every frame queued before it on this connection. */
  private sendFrame(link: Link, kind: number, payload: Uint8Array): Promise<void> {
    const run = link.out.then(() => this.writeFrame(link, kind, payload));
    link.out = run.catch(() => {});
    return run;
  }

  private async writeFrame(link: Link, kind: number, payload: Uint8Array) {
    if (this.link !== link) throw new Error('disconnected');
    const plain = new Uint8Array(payload.length + 1);
    plain[0] = kind;
    plain.set(payload, 1);
    const sealed = await link.channel!.seal(plain);
    const dc = link.conn.dataChannel;
    while (dc.readyState === 'open' && dc.bufferedAmount > HIGH_WATER) {
      dc.bufferedAmountLowThreshold = LOW_WATER;
      await new Promise<void>((resolve) => {
        dc.addEventListener('bufferedamountlow', () => resolve(), { once: true });
        dc.addEventListener('close', () => resolve(), { once: true });
      });
    }
    if (this.link !== link || dc.readyState !== 'open') throw new Error('disconnected');
    dc.send(sealed);
  }

  private sendJson(link: Link, message: object) {
    return this.sendFrame(link, KIND_JSON, new TextEncoder().encode(JSON.stringify(message)));
  }

  /**
   * Queue files to send to the other device. They go out as soon as the
   * devices are connected, after any batches queued earlier. Returns the
   * batch id used in progress, `onSent` and `onAborted`.
   */
  send(files: File[]): string {
    const id = crypto.randomUUID();
    this.outbox.push({ id, files });
    this.pump();
    return id;
  }

  /**
   * The connection to the other device, once both proved they hold the
   * secret. Calls add their audio and video to it, so they are covered by
   * the same security check (see core/call.ts). A reconnect makes a new one.
   */
  get peerConnection(): RTCPeerConnection | null {
    return this.link?.secured ? (this.link.conn.peerConnection ?? null) : null;
  }

  /** Send call signalling to the other device now; false if not connected. */
  signal(data: object): boolean {
    const link = this.link;
    if (!link?.secured || this.ended) return false;
    this.sendJson(link, { t: 'sig', d: data }).catch(() => {});
    return true;
  }

  private hello(link: Link) {
    if (this.options.name) this.sendJson(link, { t: 'hello', name: this.options.name, kind: this.options.kind ?? '' }).catch(() => {});
  }

  /** Change this device's name; the other device hears it now if connected, or on connecting. */
  rename(name: string) {
    this.options.name = name;
    if (this.link?.secured) this.hello(this.link);
  }

  /**
   * Send a text message. It goes now if the devices are connected, otherwise
   * as soon as they are, and again after a reconnect until the other device
   * confirms it (`onSent` with the returned id).
   */
  sendText(text: string, id: string = crypto.randomUUID()): string {
    this.texts.set(id, { text, at: Date.now() });
    this.flushTexts();
    return id;
  }

  private flushTexts() {
    const link = this.link;
    if (!link?.secured || this.ended) return;
    for (const [id, { text, at }] of this.texts) {
      if (link.textsSent.has(id)) continue;
      link.textsSent.add(id);
      this.sendJson(link, { t: 'text', id, text, at }).catch(() => {});
    }
  }

  private async pump() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.outbox.length && this.link?.secured && !this.ended) {
        const link = this.link;
        const { id, files } = this.outbox[0];
        try {
          await this.sendBatch(link, id, files);
          this.outbox.shift();
          this.handlers.onSent?.(id);
        } catch {
          // The connection dropped mid-batch: `lost` reported it; the batch stays queued and restarts on reconnect.
          if (this.link === link) this.lost(link);
          break;
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private async sendBatch(link: Link, id: string, files: File[]) {
    const total = files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    const meta = files.map((f) => ({ name: f.name, type: f.type || 'application/octet-stream', size: f.size }));
    await this.sendJson(link, { t: 'files', id, files: meta });
    this.handlers.onProgress?.({ id, direction: 'send', done, total, file: files[0]?.name ?? '' });
    for (const file of files) {
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
        await this.sendFrame(link, KIND_DATA, bytes);
        done += bytes.length;
        this.handlers.onProgress?.({ id, direction: 'send', done, total, file: file.name });
      }
    }
    const confirmed = new Promise<void>((resolve, reject) => {
      link.confirm.set(id, resolve);
      link.conn.on('close', () => reject(new Error('disconnected')));
    });
    await this.sendJson(link, { t: 'done', id });
    await confirmed;
    link.confirm.delete(id);
  }

  /** End the session for both devices; the QR code stops working. `idle`: it timed out. */
  async end(reason?: 'idle') {
    const link = this.link;
    this.state({ state: 'ended', message: reason === 'idle' ? IDLE_MESSAGE : 'Session ended.' });
    // From here on, the connection closing (the other side hanging up on `bye`) is not a drop to recover from.
    this.ended = true;
    if (link?.secured) await this.sendJson(link, { t: 'bye', reason }).catch(() => {});
    setTimeout(() => this.shutdown(), 200);
  }

  /** Disconnect without telling the other side (e.g. leaving the page). */
  shutdown() {
    clearTimeout(this.timer);
    this.ended = true;
    this.outbox = [];
    this.texts.clear();
    this.link?.conn.close();
    this.link = null;
    this.peer?.destroy();
    this.peer = null;
  }
}

/** Routes a scanned code can open inside the app. */
const SCANNABLE = /#\/(d|s|q)\/.+$/;

/**
 * The app route for text read from a QR code: a connection invite or a share
 * link, from this site or any copy of it. Null for anything else.
 */
export function routeFromScan(text: string): string | null {
  const match = text.trim().match(SCANNABLE);
  return match ? match[0] : null;
}
