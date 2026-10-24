/**
 * "Share with Tools" from outside the app (core/app-share.ts): picks up the
 * shared files and holds them for ShareDialog.svelte, which asks where they
 * go. Native apps only.
 */
import { SHARE_LOAD_LIMIT, doneShared, onShared, readShared, sharedFiles } from '../../core/app-share';
import { detectType, formatBytes } from '../../core/files';
import { isNativeApp } from '../../pwa/install.svelte';

export const incoming = $state<{ files: File[]; loading: number; skipped: string[] }>({ files: [], loading: 0, skipped: [] });

let checking = false;

async function check() {
  if (checking) return;
  checking = true;
  try {
    const list = await sharedFiles().catch(() => []);
    incoming.loading += list.length;
    for (const shared of list) {
      try {
        if (shared.size > SHARE_LOAD_LIMIT) {
          incoming.skipped.push(`${shared.name} (${formatBytes(shared.size)}: too big to share from here)`);
          continue;
        }
        const file = await readShared(shared, detectType(new File([], shared.name)));
        incoming.files.push(file);
      } catch {
        incoming.skipped.push(`${shared.name} (couldn't be read)`);
      } finally {
        incoming.loading--;
        doneShared(shared.path).catch(() => {});
      }
    }
  } finally {
    checking = false;
  }
}

export function closeIncoming() {
  incoming.files = [];
  incoming.skipped = [];
}

let started = false;

/** Look for shared files now, when the app comes back to the front, and when told. */
export function startIncomingShare() {
  if (started || !isNativeApp()) return;
  started = true;
  check();
  onShared(check);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  addEventListener('focus', check);
  // Android copies shared files in the background, so look a few more times after coming to the front.
  setInterval(() => document.visibilityState === 'visible' && check(), 3000);
}
