/**
 * The one direct-transfer session of this tab (see core/direct.ts), kept
 * outside any page so it survives navigation: you can open a received file
 * in a tool, then send the result back over the same connection, and come
 * back to the session page at any time (the header shows a "Connected" pill).
 * It ends when either side ends it or the tab closes.
 */
import { DirectTransfer, type ConnectionState, type Invite, type Progress } from '../core/direct';

export interface Batch {
  id: string;
  direction: 'send' | 'receive';
  files: File[];
  done: number;
  total: number;
  status: 'queued' | 'active' | 'complete' | 'interrupted';
  /** Name of the file going across right now. */
  current: string;
}

export const session = $state<{
  transfer: DirectTransfer | null;
  conn: ConnectionState | null;
  batches: Batch[];
  /** Keys `<batch id>/<file index>` of open previews. */
  open: Record<string, boolean>;
}>({ transfer: null, conn: null, batches: [], open: {} });

/** A session that is set up or in use (not ended or failed). */
export function isLive(): boolean {
  const s = session.conn?.state;
  return !!session.transfer && s !== 'ended' && s !== 'failed';
}

export function isConnected(): boolean {
  return session.conn?.state === 'connected';
}

function find(id: string) {
  return session.batches.find((b) => b.id === id);
}

function onProgress(p: Progress) {
  let batch = find(p.id);
  if (!batch) {
    session.batches.unshift({ id: p.id, direction: p.direction, files: [], done: 0, total: p.total, status: 'active', current: p.file });
    batch = session.batches[0];
  }
  batch.status = 'active';
  batch.done = p.done;
  batch.total = p.total;
  batch.current = p.file;
}

const handlers = {
  onState: (s: ConnectionState) => (session.conn = s),
  onProgress,
  onReceived: (id: string, files: File[]) => {
    const batch = find(id);
    if (!batch) return;
    batch.files = files;
    batch.status = 'complete';
    batch.done = batch.total;
    // A single received file opens straight away.
    if (files.length === 1) session.open[`${id}/0`] = true;
  },
  onSent: (id: string) => {
    const batch = find(id);
    if (batch) {
      batch.status = 'complete';
      batch.done = batch.total;
    }
  },
  onAborted: (id: string, direction: 'send' | 'receive') => {
    const batch = find(id);
    if (!batch) return;
    // Sends stay queued and restart on reconnect; partial receives are dropped.
    batch.status = direction === 'send' ? 'queued' : 'interrupted';
    if (direction === 'send') batch.done = 0;
  },
};

/** Start a new session, as host (show a QR code) or by joining an invite. Replaces any current one. */
export function startSession(options: { invite: Invite } | { hostSends: boolean }): void {
  session.transfer?.shutdown();
  session.conn = null;
  const keep = session.batches.filter((b) => b.direction === 'send' && b.status !== 'complete');
  session.batches = keep;
  session.open = {};
  const t = 'invite' in options ? DirectTransfer.join(options.invite, handlers) : DirectTransfer.host(options.hostSends, handlers);
  session.transfer = t;
  // Files picked before connecting wait in the queue.
  for (const b of keep) b.id = t.send(b.files);
}

/** Queue files to send; they go as soon as the devices are connected. */
export function sendOverSession(files: File[]): void {
  if (!files.length) return;
  const t = session.transfer;
  const id = t && isLive() ? t.send(files) : crypto.randomUUID();
  session.batches.unshift({ id, direction: 'send', files, done: 0, total: files.reduce((n, f) => n + f.size, 0), status: 'queued', current: files[0].name });
}

export function endSession(): void {
  session.transfer?.end();
}

// Leaving the page closes the connection right away, so the other side knows.
if (typeof addEventListener !== 'undefined') addEventListener('pagehide', () => session.transfer?.shutdown());
