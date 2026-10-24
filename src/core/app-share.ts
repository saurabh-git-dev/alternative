/**
 * Files shared *to* the native app from outside: "Share with Tools" in the
 * file manager (Windows, Linux) or the Android share sheet. The native side
 * (src-tauri/src/shared.rs) keeps them until the page asks.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface SharedFile {
  name: string;
  path: string;
  size: number;
}

/** Files shared since the last call. */
export const sharedFiles = () => invoke<SharedFile[]>('app_shared_files');

/** Biggest file loaded into the page; anything larger is refused with a note. */
export const SHARE_LOAD_LIMIT = 2 * 1024 * 1024 * 1024 - 1;

export async function readShared(file: SharedFile, type = ''): Promise<File> {
  const buffer = await invoke<ArrayBuffer>('app_read_shared', { path: file.path });
  return new File([buffer], file.name, { type });
}

/** The page has the file: Android drops its copy. */
export const doneShared = (path: string) => invoke<void>('app_done_shared', { path });

/** Called when more files are shared while the app is open. */
export function onShared(handler: () => void) {
  listen('app://shared', handler).catch(() => {});
}
