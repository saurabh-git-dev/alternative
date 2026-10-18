/**
 * Keeps the files of a connected-device chat in the browser's IndexedDB, so
 * they are still there after the page reloads or you switch sections (each
 * section is its own page). Files belong to one device session and are
 * deleted when it ends. A session in a tab that was simply closed stops
 * sending its heartbeat, and its files are cleared the next time any page of
 * the site loads.
 */

const DB_NAME = 'tools-connect';
const STORE = 'files';
const ALIVE_KEY = 'tools-connect-alive';
/** A session with no heartbeat for this long is gone; its files are deleted. */
const STALE_MS = 6 * 60_000;

interface Row {
  /** `<message id>/<index>` */
  id: string;
  device: string;
  file: File;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('device', 'device');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Errors here only cost history after a reload, so they never interrupt a transfer. */
const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);

export function saveFiles(device: string, messageId: string, files: File[]) {
  return quiet(run('readwrite', (s) => files.forEach((file, i) => s.put({ id: `${messageId}/${i}`, device, file } satisfies Row))));
}

export async function loadFiles(messageId: string, count: number): Promise<File[] | null> {
  const rows = await quiet(
    Promise.all(Array.from({ length: count }, (_, i) => run<Row | undefined>('readonly', (s) => s.get(`${messageId}/${i}`)))),
  );
  return rows?.every(Boolean) ? rows.map((r) => r!.file) : null;
}

export function deleteDevice(device: string) {
  setAlive(device, null);
  return quiet(
    run('readwrite', (s) => {
      const req = s.index('device').openKeyCursor(IDBKeyRange.only(device));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        s.delete(cursor.primaryKey);
        cursor.continue();
      };
    }),
  );
}

function aliveMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ALIVE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Mark a session as still open (or gone, with `null`), across tabs. */
export function setAlive(device: string, at: number | null) {
  try {
    const map = aliveMap();
    if (at === null) delete map[device];
    else map[device] = at;
    localStorage.setItem(ALIVE_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked: history just won't outlive the page */
  }
}

/** Delete files of sessions that are no longer open in any tab. */
export async function purgeStale(keep: string[]) {
  const map = aliveMap();
  const now = Date.now();
  const alive = new Set([...keep, ...Object.keys(map).filter((k) => now - map[k] < STALE_MS)]);
  for (const k of Object.keys(map)) if (!alive.has(k)) setAlive(k, null);
  await quiet(
    run('readwrite', (s) => {
      const req = s.index('device').openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (!alive.has(String(cursor.key))) s.delete(cursor.primaryKey);
        cursor.continue();
      };
    }),
  );
}
