/**
 * Connected devices: every direct-transfer session of this tab (see
 * core/direct.ts), one per device, with a chat-style history of the files and
 * text sent each way. Kept outside any page, so connections stay open while
 * you use the tools; the header's Connect button shows how many are live.
 *
 * - A session closes after 15 minutes without anything sent or received
 *   (`IDLE_MS`), on both devices. A QR code nobody scans expires the same way.
 * - Sessions survive a reload or a switch to another section (a different
 *   page of the same site): the invite is kept in sessionStorage (this tab
 *   only, gone when it closes) and both sides reconnect by themselves. Chat
 *   text is kept with it; files are kept in IndexedDB (connect/history-db.ts)
 *   until the session ends.
 * - Calls (the hidden `chat/` page and the native apps, see
 *   connect/calls.svelte.ts) plug in with `listenForCalls`; elsewhere a
 *   ringing call is turned down.
 * - The native apps' Local share devices (connect/local.svelte.ts) live here
 *   too, with a `LocalConnection` instead of a `DirectTransfer`; both are a
 *   `Connection` (core/connection.ts), so the chat, files and calls work the
 *   same. They are listed on the Local share page, not Connect, and don't
 *   time out or come back from sessionStorage (the native side remembers them).
 * - A batch over 1 GB waits for the receiver to accept it, on every kind of
 *   connection (`askToAccept`, shown by connect/AskDialog.svelte).
 */
import { DirectTransfer, type ConnectionState, type Invite, type Progress } from '../../core/direct';
import { fromB64url, toB64url } from '../../core/direct-crypto';
import { deviceName, randomDeviceName } from '../../core/device';
import * as history from './history-db';
import { parseSignal } from '../../core/call';
import type { Connection } from '../../core/connection';
import { askToAccept } from './asks.svelte';

export const IDLE_MS = 15 * 60_000;
const SAVE_KEY = 'tools-connect';
const NAME_KEY = 'tools-device-name';

export interface FileInfo {
  name: string;
  type: string;
  size: number;
}

export interface Message {
  id: string;
  dir: 'in' | 'out';
  at: number;
  /** `call`: a line in the chat about a call (its text says what happened). */
  kind: 'text' | 'files' | 'call';
  text?: string;
  /** The files, once they are here (received, or loaded back after a reload). */
  files: File[];
  meta: FileInfo[];
  done: number;
  total: number;
  status: 'queued' | 'active' | 'complete' | 'interrupted' | 'declined';
  /** Name of the file going across right now. */
  current: string;
  /** Why it was declined, in words. */
  note?: string;
  /** Local share: where each received file was saved, in the same order as `meta`. */
  saved?: { name: string; path: string; size: number; type: string }[];
}

export interface Device {
  /** Local id of this session. */
  key: string;
  transfer: Connection;
  conn: ConnectionState;
  /** The other device's name, once it has said it. */
  name: string;
  /** The other device's kind, e.g. "iPhone · Safari". */
  kind: string;
  /** Has connected at least once. A host that hasn't is a QR code waiting to be scanned. */
  paired: boolean;
  messages: Message[];
  unread: number;
  /** Last time anything was sent or received (or the session started). */
  lastActive: number;
}

export const hub = $state<{
  devices: Device[];
  /** The device whose chat is on screen; its messages don't count as unread. */
  viewing: string | null;
  /** The latest arrival (or a send started from a Share menu), for the corner notice. */
  notice: { device: string; message: string } | null;
  /** A received text file open in the text editor (connect/TextEditor.svelte), and the device it came from. */
  editing: { file: File; device?: string } | null;
  /** This device's name, as other devices see it. */
  me: string;
  /** Ticks every second, for countdowns. */
  now: number;
}>({ devices: [], viewing: null, notice: null, editing: null, me: loadName(), now: Date.now() });

export const myKind = deviceName();

/** This browser's name: saved, or a new random one ("Blue Otter") saved for next time. */
function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const name = randomDeviceName();
    localStorage.setItem(NAME_KEY, name);
    return name;
  } catch {
    return randomDeviceName();
  }
}

/** Rename this device (or, with nothing, pick a new random name); connected devices see it at once. */
export function setMyName(name?: string) {
  const next = name?.trim().slice(0, 40) || randomDeviceName();
  hub.me = next;
  try {
    localStorage.setItem(NAME_KEY, next);
  } catch {
    /* storage blocked: the name lasts for this page */
  }
  for (const d of hub.devices) if (isLive(d)) d.transfer.rename(next);
  for (const hook of renameHooks) hook(next);
}

const renameHooks: ((name: string) => void)[] = [];

/** Hear when this device is renamed (Local share tells the native side). */
export function onRename(hook: (name: string) => void) {
  renameHooks.push(hook);
}

const me = () => ({ name: hub.me, kind: myKind });

export const isLive = (d: Device) => d.conn.state !== 'ended' && d.conn.state !== 'failed';

/** A WebRTC Connect session (not a Local share device). */
export const isDirect = (d: Device): d is Device & { transfer: DirectTransfer } => d.transfer instanceof DirectTransfer;

/** Where a device's chat is: Connect for WebRTC sessions, Local share for local devices. */
export const chatHref = (d: Device) => (isDirect(d) ? `#/connect/${d.key}` : `#/local/${d.key}`);

/** Devices to list: connected now or before (with their history), and guests on their way in. */
export function listedDevices(): Device[] {
  return hub.devices.filter((d) => isDirect(d) && (d.paired || d.transfer.role === 'guest'));
}

/** Devices files can be sent to: paired and not ended (they may be reconnecting). */
export function liveDevices(): Device[] {
  return hub.devices.filter((d) => isDirect(d) && d.paired && isLive(d));
}

export function connectedCount(): number {
  return hub.devices.filter((d) => isDirect(d) && d.conn.state === 'connected').length;
}

/** The QR code currently offered to a new device, if any. */
export function pendingHost(): (Device & { transfer: DirectTransfer }) | undefined {
  return hub.devices.find((d): d is Device & { transfer: DirectTransfer } => isDirect(d) && !d.paired && d.transfer.role === 'host' && isLive(d));
}

export function getDevice(key: string): Device | undefined {
  return hub.devices.find((d) => d.key === key);
}

/** Seconds left before an idle session closes. */
export function secondsLeft(d: Device): number {
  return Math.max(0, Math.ceil((d.lastActive + IDLE_MS - hub.now) / 1000));
}

export function displayName(d: Device): string {
  if (d.name) {
    // Two devices with the same name (both renamed alike, or a random clash): tell them apart by kind.
    const clash = d.name === hub.me || hub.devices.some((x) => x.key !== d.key && x.name === d.name && isLive(x) && isDirect(x) === isDirect(d));
    return clash && d.kind ? `${d.name} (${d.kind})` : d.name;
  }
  if (!isDirect(d)) return 'Nearby device';
  return d.transfer.role === 'host' ? 'Device that scanned your code' : 'Device that showed the code';
}

function touch(d: Device) {
  d.lastActive = Date.now();
}

/** Count as activity, so the session doesn't close as idle (e.g. during a call). */
export function touchDevice(key: string) {
  const d = getDevice(key);
  if (d) touch(d);
}

export interface CallListener {
  /** Call signalling from a device. */
  signal: (key: string, data: unknown) => void;
  /** A device's connection changed (a call on it can't outlive a drop). */
  state: (key: string, state: ConnectionState) => void;
}

let calls: CallListener | null = null;

/** Take calls on this page. Without a listener, a device that rings hears this page can't answer. */
export function listenForCalls(listener: CallListener) {
  calls = listener;
}

/** Send call signalling to a device now; false if it isn't connected. */
export function signalDevice(key: string, data: object): boolean {
  return getDevice(key)?.transfer.signal(data) ?? false;
}

/** Add a line about a call to a device's chat. */
export function logCall(key: string, dir: 'in' | 'out', text: string) {
  const d = getDevice(key);
  if (!d) return;
  d.messages.push({ id: crypto.randomUUID(), dir, at: Date.now(), kind: 'call', text, files: [], meta: [], done: 0, total: 0, status: 'complete', current: '' });
  save();
}

function fileInfo(files: File[]): FileInfo[] {
  return files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
}

function arrived(d: Device, m: Message) {
  touch(d);
  if (hub.viewing !== d.key || document.hidden) d.unread++;
  hub.notice = { device: d.key, message: m.id };
}

export function handlersFor(key: string) {
  const find = () => getDevice(key);
  const message = (id: string) => find()?.messages.find((m) => m.id === id);
  return {
    onState: (s: ConnectionState) => {
      const d = find();
      if (!d) return;
      d.conn = s;
      calls?.state(key, s);
      if (s.state === 'connected' && !d.paired) {
        d.paired = true;
        touch(d);
      }
      if (!isLive(d)) {
        for (const m of d.messages) if (m.status === 'queued' || m.status === 'active') m.status = 'interrupted';
        history.deleteDevice(d.key);
      }
      save();
    },
    onProgress: (p: Progress) => {
      const d = find();
      if (!d) return;
      let m = message(p.id);
      if (!m) {
        d.messages.push({ id: p.id, dir: 'in', at: Date.now(), kind: 'files', files: [], meta: [], done: 0, total: p.total, status: 'active', current: p.file });
        m = d.messages.at(-1)!;
      }
      m.status = 'active';
      m.done = p.done;
      m.total = p.total;
      m.current = p.file;
      touch(d);
    },
    onReceived: (id: string, files: File[], saved?: Message['saved']) => {
      const d = find();
      const m = message(id);
      if (!d || !m) return;
      m.files = files;
      m.meta = saved ? saved.map(({ name, type, size }) => ({ name, type, size })) : fileInfo(files);
      m.saved = saved;
      m.status = 'complete';
      m.done = m.total;
      arrived(d, m);
      if (isDirect(d)) history.saveFiles(d.key, id, files);
      save();
    },
    onDeclined: (id: string, note?: string) => {
      const d = find();
      const m = message(id);
      if (!d || !m) return;
      m.status = 'declined';
      m.note = note ?? `${displayName(d)} declined.`;
      save();
    },
    onAsk: (_id: string, files: FileInfo[]) => {
      const d = find();
      if (!d) return Promise.resolve(false);
      touch(d);
      return askToAccept({ from: displayName(d), files, device: key });
    },
    onSent: (id: string) => {
      const d = find();
      const m = message(id);
      if (!d || !m) return;
      m.status = 'complete';
      m.done = m.total;
      touch(d);
      save();
    },
    onAborted: (id: string, direction: 'send' | 'receive') => {
      const m = message(id);
      if (!m) return;
      // Sends stay queued and restart on reconnect; partial receives are dropped.
      m.status = direction === 'send' ? 'queued' : 'interrupted';
      if (direction === 'send') m.done = 0;
    },
    onHello: (name: string, kind: string) => {
      const d = find();
      if (!d) return;
      d.name = name;
      d.kind = kind;
      save();
    },
    onText: (id: string, text: string, at: number) => {
      const d = find();
      if (!d || d.messages.some((m) => m.id === id)) return;
      d.messages.push({ id, dir: 'in', at, kind: 'text', text, files: [], meta: [], done: 0, total: 0, status: 'complete', current: '' });
      arrived(d, d.messages.at(-1)!);
      save();
    },
    onSignal: (data: unknown) => {
      if (calls) return calls.signal(key, data);
      const signal = parseSignal(data);
      if (signal?.c === 'ring') signalDevice(key, { c: 'decline', id: signal.id, reason: 'unavailable' });
    },
  };
}

export function add(make: (key: string) => Connection, init: Partial<Device> = {}): Device {
  const key = init.key ?? crypto.randomUUID();
  // Its first state change ('starting') arrives before it is listed, which matches the initial state.
  const transfer = make(key);
  hub.devices.push({ conn: { state: 'starting' }, name: '', kind: '', paired: false, messages: [], unread: 0, lastActive: Date.now(), ...init, key, transfer });
  return hub.devices.at(-1)!;
}

/**
 * A QR code for a new device to scan. Reuses the one already on offer. Files
 * given here are sent as soon as that device connects.
 */
export function newHost(files: File[] = []): Device {
  const d = pendingHost() ?? add((key) => DirectTransfer.host(files.length > 0, handlersFor(key), me()));
  if (files.length) sendFiles(d.key, files);
  return d;
}

/** Connect to the device that showed this invite (or return that session if it is already open). */
export function join(invite: Invite): Device {
  const existing = hub.devices.find((d) => isDirect(d) && d.transfer.invite.peerId === invite.peerId && isLive(d));
  return existing ?? add((key) => DirectTransfer.join(invite, handlersFor(key), me()));
}

export function sendFiles(key: string, files: File[]): string | undefined {
  const d = getDevice(key);
  if (!d || !files.length || !isLive(d)) return;
  const id = d.transfer.send(files);
  const total = files.reduce((n, f) => n + f.size, 0);
  d.messages.push({ id, dir: 'out', at: Date.now(), kind: 'files', files, meta: fileInfo(files), done: 0, total, status: 'queued', current: files[0].name });
  touch(d);
  if (isDirect(d)) history.saveFiles(d.key, id, files);
  save();
  return id;
}

export function sendText(key: string, text: string): string | undefined {
  const d = getDevice(key);
  if (!d || !text.trim() || !isLive(d)) return;
  const id = d.transfer.sendText(text);
  d.messages.push({ id, dir: 'out', at: Date.now(), kind: 'text', text, files: [], meta: [], done: 0, total: 0, status: 'queued', current: '' });
  touch(d);
  save();
  return id;
}

/** Send files from an interrupted message again. */
export function resend(key: string, message: Message) {
  if (message.files.length) sendFiles(key, message.files);
}

export function endDevice(key: string) {
  getDevice(key)?.transfer.end();
}

/** Remove an ended session and its history. */
export function forget(key: string) {
  const d = getDevice(key);
  if (!d) return;
  if (isLive(d) || !isDirect(d)) d.transfer.shutdown();
  hub.devices = hub.devices.filter((x) => x.key !== key);
  if (hub.notice?.device === key) hub.notice = null;
  history.deleteDevice(key);
  save();
}

export function markRead(key: string) {
  const d = getDevice(key);
  if (d) d.unread = 0;
}

// --- Keeping sessions across reloads ---------------------------------------

interface Saved {
  key: string;
  role: 'host' | 'guest';
  peerId: string;
  secret: string;
  name: string;
  kind?: string;
  lastActive: number;
  messages: Omit<Message, 'files' | 'current' | 'done'>[];
}

function save() {
  if (typeof sessionStorage === 'undefined') return;
  const saved: Saved[] = liveDevices().filter(isDirect).map((d) => ({
    key: d.key,
    role: d.transfer.role,
    peerId: d.transfer.invite.peerId,
    secret: toB64url(d.transfer.invite.secret),
    name: d.name,
    kind: d.kind,
    lastActive: d.lastActive,
    messages: d.messages.map(({ id, dir, at, kind, text, meta, total, status }) => ({ id, dir, at, kind, text, meta, total, status })),
  }));
  try {
    if (saved.length) sessionStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    else sessionStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage full or blocked: sessions just won't outlive the page */
  }
}

function restore() {
  let saved: Saved[] = [];
  try {
    saved = JSON.parse(sessionStorage.getItem(SAVE_KEY) ?? '[]');
  } catch {
    /* nothing usable */
  }
  const now = Date.now();
  for (const s of saved) {
    if (now - s.lastActive >= IDLE_MS) continue;
    const invite: Invite = { peerId: s.peerId, secret: fromB64url(s.secret), hostSends: false };
    const messages: Message[] = s.messages.map((m) => ({
      ...m,
      files: [],
      done: m.status === 'complete' ? m.total : 0,
      current: '',
      // Anything mid-way when the page went away has to be sent again.
      status: m.status === 'complete' ? 'complete' : 'interrupted',
    }));
    const d = add(
      (key) =>
        s.role === 'host'
          ? DirectTransfer.host(false, handlersFor(key), { ...me(), invite, resume: true })
          : DirectTransfer.join(invite, handlersFor(key), { ...me(), resume: true }),
      { key: s.key, name: s.name, kind: s.kind ?? '', paired: true, lastActive: s.lastActive, messages },
    );
    for (const m of d.messages) {
      if (m.kind !== 'files') continue;
      history.loadFiles(m.id, m.meta.length).then((files) => {
        const live = getDevice(d.key)?.messages.find((x) => x.id === m.id);
        if (files && live) live.files = files;
      });
    }
  }
  history.purgeStale(hub.devices.map((d) => d.key));
}

/** Close idle sessions and expired codes; keep live sessions' files marked as in use. */
function tick() {
  const now = (hub.now = Date.now());
  for (const d of hub.devices) {
    if (!isDirect(d) || !isLive(d) || now - d.lastActive < IDLE_MS) continue;
    if (d.paired) d.transfer.end('idle');
    else {
      d.transfer.shutdown();
      d.conn = { state: 'ended', message: 'This code expired.' };
    }
  }
  if (now % 30_000 < 1_000) for (const d of liveDevices()) history.setAlive(d.key, now);
}

if (typeof window !== 'undefined') {
  restore();
  for (const d of liveDevices()) history.setAlive(d.key, Date.now());
  setInterval(tick, 1_000);
  // Leaving the page drops the connections at once; the other side waits for this page to come back.
  addEventListener('pagehide', () => {
    save();
    for (const d of hub.devices) if (isDirect(d)) d.transfer.shutdown();
  });
  // Back from the browser's page cache, the connections are gone: start again from what was saved.
  addEventListener('pageshow', (e) => (e as PageTransitionEvent).persisted && location.reload());
}
