/**
 * A Local share device as a `Connection` (core/connection.ts), so the chat,
 * files and calls work over the local network like over WebRTC Connect.
 *
 * - Files go through the native side's LocalSend-compatible upload
 *   (`local.sendFiles`), to any device: paired copies of this app take them
 *   straight away (up to 1 GB), others ask first.
 * - Chat text, `hello` and call signalling go over the paired link as JSON
 *   (`{t: 'text' | 'got' | 'hello' | 'sig', …}`), as in core/direct.ts.
 *   Texts wait while the device is away and go when it is back.
 * - A call gets its own RTCPeerConnection with no STUN or TURN servers: on
 *   the same network the devices reach each other directly. Its offer and
 *   answer carry all their addresses (see `settled` in core/call.ts).
 * - LocalSend devices only take files: no text, calls or name changes.
 * - Files sent while the device is away wait for it, for up to
 *   `QUEUE_FOR_MS`; after that they are dropped as expired.
 */
import type { Connection } from './connection';
import type { Role } from './direct-crypto';
import type { ConnectionState, Handlers } from './direct';
import * as local from './local';
import type { LocalDevice, SavedFile } from './local';

/** How long files wait for a device that is away before they expire. */
export const QUEUE_FOR_MS = 10 * 60_000;

export class LocalConnection implements Connection {
  readonly kind = 'local';
  readonly role: Role;
  private state: ConnectionState['state'] | '' = '';
  private outbox: { id: string; files: File[]; at: number }[] = [];
  private expiry = setInterval(() => this.expire(), 15_000);
  private sending = false;
  private texts = new Map<string, { text: string; at: number }>();
  private pc: RTCPeerConnection | null = null;
  /** Batches arriving, by session, for their progress. */
  private incoming = new Map<string, { total: number; file: string }>();

  constructor(
    public device: LocalDevice,
    myFingerprint: string,
    private handlers: Handlers,
    private me: { name: string; kind: string },
  ) {
    // The same rule on both sides: the smaller fingerprint offers.
    this.role = myFingerprint < device.fingerprint ? 'host' : 'guest';
    // Away until the first `update`, made once the device is in the hub so its state shows.
    this.device = { ...device, online: false, linked: false };
  }

  /** Chat and calls work with paired copies of this app; LocalSend devices take files only. */
  get chat(): boolean {
    return this.device.ours && this.device.paired;
  }

  private get reachable(): boolean {
    return this.chat ? this.device.linked : this.device.online;
  }

  /** The device's latest state from the native side. */
  update(device: LocalDevice) {
    const wasLinked = this.device.linked;
    this.device = device;
    const state = this.reachable ? 'connected' : 'reconnecting';
    if (state !== this.state) {
      this.state = state;
      this.handlers.onState({ state });
    }
    if (device.linked && !wasLinked) {
      this.hello();
      this.flushTexts();
    }
    if (this.reachable) this.pump();
  }

  send(files: File[]): string {
    const id = crypto.randomUUID();
    this.outbox.push({ id, files, at: Date.now() });
    this.pump();
    return id;
  }

  /** Drop files that waited too long for the device (not one already going). */
  private expire() {
    const now = Date.now();
    const keep = this.outbox.filter((item, i) => (this.sending && i === 0) || now - item.at < QUEUE_FOR_MS);
    for (const item of this.outbox) {
      if (!keep.includes(item)) this.handlers.onDeclined?.(item.id, `Not sent: ${this.device.alias} didn't come back within ${QUEUE_FOR_MS / 60_000} minutes.`);
    }
    this.outbox = keep;
  }

  private async pump() {
    this.expire();
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.outbox.length && this.reachable) {
        const { id, files } = this.outbox[0];
        try {
          await local.sendFiles(this.device.fingerprint, files, (p) => this.handlers.onProgress?.({ id, direction: 'send', ...p }));
          this.outbox.shift();
          this.handlers.onSent?.(id);
        } catch (e) {
          const code = String(e instanceof Error ? e.message : e);
          if (code === 'offline' || code === 'no answer' || code.includes('connection')) {
            // Stays queued: goes again when the device is back.
            this.handlers.onAborted?.(id, 'send');
            break;
          }
          this.outbox.shift();
          this.handlers.onDeclined?.(id, local.sendError(code, this.device.alias));
        }
      }
    } finally {
      this.sending = false;
    }
  }

  sendText(text: string, id: string = crypto.randomUUID()): string {
    if (!this.chat) return id;
    this.texts.set(id, { text, at: Date.now() });
    this.flushTexts();
    return id;
  }

  private flushTexts() {
    if (!this.device.linked) return;
    for (const [id, { text, at }] of this.texts) local.linkSend(this.device.fingerprint, { t: 'text', id, text, at }).catch(() => {});
  }

  private hello() {
    local.linkSend(this.device.fingerprint, { t: 'hello', name: this.me.name, kind: this.me.kind }).catch(() => {});
  }

  rename(name: string) {
    this.me.name = name;
    if (this.device.linked) this.hello();
  }

  signal(data: object): boolean {
    if (!this.device.linked) return false;
    local.linkSend(this.device.fingerprint, { t: 'sig', d: data }).catch(() => {});
    return true;
  }

  /** A message over the link from this device. */
  onLink(data: unknown) {
    if (!data || typeof data !== 'object') return;
    const m = data as { t?: unknown; id?: unknown; text?: unknown; at?: unknown; name?: unknown; kind?: unknown; d?: unknown };
    const id = typeof m.id === 'string' ? m.id : '';
    if (m.t === 'text' && typeof m.text === 'string' && id) {
      local.linkSend(this.device.fingerprint, { t: 'got', id }).catch(() => {});
      this.handlers.onText?.(id, m.text, typeof m.at === 'number' ? m.at : Date.now());
    } else if (m.t === 'got' && this.texts.delete(id)) {
      this.handlers.onSent?.(id);
    } else if (m.t === 'hello' && typeof m.name === 'string') {
      this.handlers.onHello?.(m.name.slice(0, 40), typeof m.kind === 'string' ? m.kind.slice(0, 60) : '');
    } else if (m.t === 'sig') {
      this.handlers.onSignal?.(m.d);
    }
  }

  /** Files from this device started arriving. */
  onIncoming(session: string, total: number, file: string) {
    this.incoming.set(session, { total, file });
    this.handlers.onProgress?.({ id: session, direction: 'receive', done: 0, total, file });
  }

  onProgress(session: string, done: number, total: number, file: string) {
    this.handlers.onProgress?.({ id: session, direction: 'receive', done, total, file });
  }

  async onReceived(session: string, saved: SavedFile[]) {
    this.incoming.delete(session);
    // Same order as `saved`; files too big to load are left out (holes), so indexes still match.
    const files: File[] = [];
    for (const [i, s] of saved.entries()) {
      if (s.size <= local.LOAD_LIMIT) {
        const file = await local.readFile(s).catch(() => undefined);
        if (file) files[i] = file;
      }
    }
    this.handlers.onReceived?.(
      session,
      files,
      saved.map((s) => ({ name: s.name, path: s.path, size: s.size, type: s.fileType })),
    );
  }

  onCancelled(session: string) {
    if (this.incoming.delete(session)) this.handlers.onAborted?.(session, 'receive');
  }

  get peerConnection(): RTCPeerConnection | null {
    if (!this.device.linked) return null;
    if (!this.pc || this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
      this.pc?.close();
      this.pc = new RTCPeerConnection({ iceServers: [] });
    }
    return this.pc;
  }

  /** Local devices stay listed; there is no session to end. */
  end() {}

  shutdown() {
    clearInterval(this.expiry);
    this.pc?.close();
    this.pc = null;
  }
}
