/**
 * Opening a link that leaves the app (a scanned web page, mailto:, tel:,
 * a map …). In a browser that's a new tab or the system handler; inside the
 * native apps the webview stays on the bundled site, so the native side
 * hands the link to the system (`app_open_url` in src-tauri/src/lib.rs).
 */
import { isNativeApp } from '../pwa/install.svelte';

const BLOCKED = /^\s*(javascript|vbscript|data|file|blob|about):/i;

/** Links that can be opened at all (no script or local-file links). */
export function isOpenable(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !BLOCKED.test(href);
}

export async function openLink(href: string): Promise<void> {
  if (!isOpenable(href)) return;
  if (isNativeApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('app_open_url', { url: href });
    return;
  }
  if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener');
  else location.href = href;
}
