/**
 * Whether the header shows a link to the unlisted chat/ page. Off unless
 * switched on from the chat page itself (see connect/ConnectPage.svelte),
 * and remembered in this browser's localStorage only, so the page stays
 * hidden for everyone else.
 */
const KEY = 'tools-chat-link';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const chatLink = $state({ shown: typeof localStorage === 'undefined' ? false : load() });

export function setChatLink(shown: boolean) {
  chatLink.shown = shown;
  try {
    if (shown) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: it lasts for this page */
  }
}

// Switched in another tab: follow it here too.
if (typeof window !== 'undefined') addEventListener('storage', (e: StorageEvent) => e.key === KEY && (chatLink.shown = load()));
