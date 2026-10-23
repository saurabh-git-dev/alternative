/**
 * Installing the app: registers the service worker (src/pwa/sw.js, built to
 * sw.js at the site root) and keeps the browser's install prompt so the
 * header can offer an Install button. Browsers without a prompt (Safari,
 * Firefox) install from their own menu (Share → Add to Home Screen) instead.
 */
import { sectionHref } from '../ui/section';

/** Running inside the Windows, Linux or Android app (src-tauri/) rather than a browser. */
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Chrome's `beforeinstallprompt` event; not in the DOM typings. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred = $state<InstallPromptEvent | null>(null);

/** Can the app be installed from a button right now? */
export function canInstall(): boolean {
  return deferred !== null;
}

/** Show the browser's install dialog. */
export async function install(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null; // a prompt can only be shown once
  await event.prompt();
}

export function setupInstall(): void {
  if (typeof window === 'undefined') return;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for the button instead of the browser's mini-infobar
    deferred = e as InstallPromptEvent;
  });
  addEventListener('appinstalled', () => (deferred = null));
  // Only built sites have sw.js; in dev it would cache files Vite serves fresh.
  // The native apps bundle every file already, so they skip it too.
  if (import.meta.env.PROD && !isNativeApp() && 'serviceWorker' in navigator) {
    const root = new URL(sectionHref('files'), location.href);
    root.hash = '';
    navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname }).catch((e: unknown) => {
      console.warn('Service worker not registered; the app still works online.', e);
    });
  }
}
