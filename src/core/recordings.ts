/**
 * The screen recorder's library: recordings kept in this browser's
 * IndexedDB, so they survive reloads and can be watched, shared,
 * downloaded or deleted later. Nothing leaves the device unless shared.
 *
 * A recording is written while it's being made, one chunk about every
 * second, so closing the tab or a crash mid-recording loses at most the
 * last second: the next visit finds the chunks and offers the recording as
 * "recovered" (see `recoverInterrupted`).
 *
 * Two object stores:
 * - `recordings`: one `RecordingMeta` per recording (title, length, size …)
 * - `chunks`: the video data, keyed by `[recording id, sequence number]`
 */

export interface RecordingMeta {
  id: string;
  title: string;
  /** Milliseconds since 1970. */
  createdAt: number;
  /** Length in seconds (0 until known). */
  duration: number;
  /** Total size in bytes. */
  size: number;
  /** MIME type, e.g. `video/webm` or `video/mp4`. */
  type: string;
  width: number;
  height: number;
  source: 'screen' | 'camera' | 'both';
  /** `recording` while chunks are still being written. */
  status: 'recording' | 'ready';
  /** True when found unfinished after a crash or closed tab. */
  recovered?: boolean;
  /** JPEG still for the library. */
  thumb?: Blob;
}

const DB_NAME = 'tools-recordings';
const RECORDINGS = 'recordings';
const CHUNKS = 'chunks';

let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore(RECORDINGS, { keyPath: 'id' });
      d.createObjectStore(CHUNKS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Browser storage is unavailable here (private window or blocked site data?).'));
  });
  db.catch(() => (db = undefined));
  return db;
}

/** Run `fn` in a transaction and resolve with its request's result once the transaction commits. */
async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const d = await open();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Storage is full. Delete some recordings and try again.'));
  });
}

/** Chunks of one recording: from `[id, 0]` to `[id, ∞]`. */
const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Infinity]);

/** Every recording, newest first. */
export async function listRecordings(): Promise<RecordingMeta[]> {
  const all = await tx<RecordingMeta[]>([RECORDINGS], 'readonly', (t) => t.objectStore(RECORDINGS).getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function getRecording(id: string): Promise<RecordingMeta | undefined> {
  return tx([RECORDINGS], 'readonly', (t) => t.objectStore(RECORDINGS).get(id));
}

export async function saveMeta(meta: RecordingMeta): Promise<void> {
  await tx([RECORDINGS], 'readwrite', (t) => t.objectStore(RECORDINGS).put(meta));
}

export async function updateMeta(id: string, patch: Partial<RecordingMeta>): Promise<RecordingMeta | undefined> {
  const meta = await getRecording(id);
  if (!meta) return undefined;
  const next = { ...meta, ...patch, id };
  await saveMeta(next);
  return next;
}

/** Store one piece of a recording as it's being made. */
export async function appendChunk(id: string, seq: number, data: Blob): Promise<void> {
  await tx([CHUNKS], 'readwrite', (t) => t.objectStore(CHUNKS).put(data, [id, seq]));
}

/** The whole recording as one file. */
export async function recordingBlob(id: string, type?: string): Promise<Blob> {
  const parts = await tx<Blob[]>([CHUNKS], 'readonly', (t) => t.objectStore(CHUNKS).getAll(chunkRange(id)));
  return new Blob(parts, { type: type ?? parts[0]?.type ?? 'video/webm' });
}

/** Swap a recording's data for a rewritten file (e.g. with its length fixed). */
export async function replaceData(id: string, data: Blob): Promise<void> {
  await tx([CHUNKS], 'readwrite', (t) => {
    const store = t.objectStore(CHUNKS);
    store.delete(chunkRange(id));
    store.put(data, [id, 0]);
  });
}

export async function deleteRecording(id: string): Promise<void> {
  await tx([RECORDINGS, CHUNKS], 'readwrite', (t) => {
    t.objectStore(RECORDINGS).delete(id);
    t.objectStore(CHUNKS).delete(chunkRange(id));
  });
}

/**
 * Recordings left unfinished (tab closed or crashed while recording) are
 * marked ready and recovered, with their size from the chunks that made it.
 * `active` is the id being recorded right now in this tab, if any.
 */
export async function recoverInterrupted(active?: string): Promise<RecordingMeta[]> {
  const recovered: RecordingMeta[] = [];
  for (const meta of await listRecordings()) {
    if (meta.status !== 'recording' || meta.id === active) continue;
    const blob = await recordingBlob(meta.id, meta.type);
    if (!blob.size) {
      await deleteRecording(meta.id);
      continue;
    }
    const next = { ...meta, status: 'ready' as const, recovered: true, size: blob.size };
    await saveMeta(next);
    recovered.push(next);
  }
  return recovered;
}

/** How much this site stores and may store, in bytes, when the browser says. */
export async function storageUse(): Promise<{ used: number; quota: number } | null> {
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return usage !== undefined && quota ? { used: usage, quota } : null;
  } catch {
    return null;
  }
}

/** Ask the browser not to clear our storage when space runs low. Best effort. */
export async function keepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

/** "Recording 17 Oct 2026, 14:05" in the user's locale. */
export function defaultTitle(date = new Date()): string {
  return `Recording ${date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

/** A file name for downloading: the title made safe, plus the extension for the type. */
export function fileNameFor(meta: Pick<RecordingMeta, 'title' | 'type'>): string {
  const safe = meta.title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'recording';
  return `${safe}.${meta.type.includes('mp4') ? 'mp4' : 'webm'}`;
}
