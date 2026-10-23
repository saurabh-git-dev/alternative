/**
 * Local share, page side: talks to the native app's local service
 * (src-tauri/src/local/) with `invoke('local_…')` and its `local://…`
 * events. Only works inside the Windows, Linux or Android app; see
 * docs/local-share.md for how devices find, pair with and reach each other.
 */
import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface LocalDevice {
  fingerprint: string;
  alias: string;
  deviceModel: string | null;
  deviceType: string | null;
  /** Runs this app (pairs, chats, calls) rather than LocalSend (files only). */
  ours: boolean;
  paired: boolean;
  online: boolean;
  /** Paired and its chat link is open. */
  linked: boolean;
  ip: string;
  lastSeen: number;
}

export interface SavedFile {
  name: string;
  path: string;
  size: number;
  fileType: string;
}

export interface IncomingFile {
  name: string;
  size: number;
  type: string;
}

/** A question from the local service (accept these files?). */
export interface LocalAsk {
  request: string;
  fingerprint: string;
  alias: string;
  ours: boolean;
  paired: boolean;
  files: IncomingFile[];
  total: number;
  huge: boolean;
}

export interface LocalEvents {
  'local://devices': LocalDevice[];
  'local://link': { fingerprint: string; data: unknown };
  'local://link-state': { fingerprint: string; up: boolean };
  'local://pair-pin': { fingerprint: string; alias: string; pin: string; until: number };
  'local://pair-done': { fingerprint: string; ok: boolean };
  'local://ask': LocalAsk;
  'local://ask-closed': { request: string };
  'local://incoming': { session: string; fingerprint: string; alias: string; files: IncomingFile[]; total: number };
  'local://progress': { session: string; fingerprint: string; done: number; total: number; file: string };
  'local://received': { session: string; fingerprint: string; alias: string; files: SavedFile[] };
  'local://cancelled': { session: string };
}

export function on<E extends keyof LocalEvents>(event: E, handler: (payload: LocalEvents[E]) => void): void {
  listen<LocalEvents[E]>(event, (e) => handler(e.payload)).catch(() => {});
}

const call = <T>(command: string, args?: InvokeArgs) => invoke<T>(command, args);

export const start = (alias: string, deviceModel: string) => call<{ fingerprint: string; port: number }>('local_start', { args: { alias, deviceModel } });
export const devices = () => call<LocalDevice[]>('local_devices');
export const refresh = () => call<void>('local_refresh');
export const pairRequest = (fingerprint: string) => call<void>('local_pair_request', { fingerprint });
export const pairEnter = (fingerprint: string, pin: string) => call<void>('local_pair_enter', { fingerprint, pin });
export const pairCancel = (fingerprint: string) => call<void>('local_pair_cancel', { fingerprint });
export const pairDismiss = (fingerprint: string) => call<void>('local_pair_dismiss', { fingerprint });
export const forget = (fingerprint: string) => call<void>('local_forget', { fingerprint });
export const linkSend = (fingerprint: string, data: unknown) => call<boolean>('local_link_send', { fingerprint, data });
export const answer = (request: string, accept: boolean) => call<void>('local_answer', { request, accept });
export const reveal = (path: string) => call<void>('local_reveal', { path });

/** Why a send didn't happen, in words. */
export function sendError(code: string, name: string): string {
  if (code === 'rejected') return `${name} declined.`;
  if (code === 'offline' || code === 'no answer') return `${name} isn't reachable right now.`;
  if (code === 'busy') return `${name} is busy with another transfer.`;
  if (code === 'pin') return `${name} asks for a PIN (set in its LocalSend settings).`;
  if (code === 'http-only') return `${name} has encryption turned off in LocalSend; turn it on to send files to it.`;
  return code.replace(/^failed: /, '');
}

/** Pieces a file is streamed to the native side in. */
const CHUNK = 4 * 1024 * 1024;

export interface SendProgress {
  done: number;
  total: number;
  file: string;
}

/**
 * Send files to a device. Resolves once they all arrived; rejects with an
 * error whose message is one of the codes `sendError` explains.
 */
export async function sendFiles(fingerprint: string, files: File[], progress: (p: SendProgress) => void, pin?: string): Promise<void> {
  const ids = files.map((_, i) => String(i));
  const meta = files.map((f, i) => ({ id: ids[i], fileName: f.name, size: f.size, fileType: f.type || 'application/octet-stream' }));
  const total = files.reduce((n, f) => n + f.size, 0);
  const started = await call<{ transfer: string; accepted: string[] }>('local_send_start', { args: { fingerprint, files: meta, pin } });
  if (!started.transfer) return;
  let done = 0;
  try {
    for (const [i, file] of files.entries()) {
      if (!started.accepted.includes(ids[i])) continue;
      progress({ done, total, file: file.name });
      for (let offset = 0; ; offset += CHUNK) {
        const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
        const last = offset + CHUNK >= file.size;
        await invoke('local_send_chunk', bytes, { headers: { 'x-transfer': started.transfer, 'x-file': ids[i], 'x-last': last ? '1' : '0' } });
        done += bytes.length;
        progress({ done, total, file: file.name });
        if (last) break;
      }
    }
  } catch (e) {
    await call('local_send_finish', { transfer: started.transfer, cancelled: true }).catch(() => {});
    throw e;
  }
  await call('local_send_finish', { transfer: started.transfer, cancelled: false });
}

/** Files up to this size are loaded so they can be previewed and opened in the tools; bigger ones stay on disk. */
export const LOAD_LIMIT = 256 * 1024 * 1024;

export async function readFile(saved: SavedFile): Promise<File> {
  const buffer = await invoke<ArrayBuffer>('local_read_file', { path: saved.path });
  return new File([buffer], saved.name, { type: saved.fileType });
}
