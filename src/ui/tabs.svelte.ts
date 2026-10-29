/**
 * Tabs inside the app: several pages open at once, each keeping its state
 * (input, loaded files, results) while another is in use, optionally side by
 * side (split view, see App.svelte).
 *
 * - There's always at least one tab; the tab bar shows once there are two.
 * - The tab in use follows the address bar's hash, so links, back and
 *   forward work in it as they would without tabs. Switching tabs replaces
 *   the hash without adding a history entry.
 * - Each tab also has a section: what `#/` shows in it (the Dashboard, PDF
 *   tools …). Links to another section's page open in the tab instead of
 *   loading that page, so the other tabs stay open (see App.svelte); the
 *   section is kept in each history entry's state for back and forward.
 * - The tabs (their pages, not their contents) are kept in sessionStorage,
 *   so they come back after a reload, empty.
 */
import { tick } from 'svelte';
import { section, type Section } from './section';

export interface Tab {
  id: string;
  section: Section;
  hash: string;
  /** Window scroll position when last left, restored on return. */
  scroll?: number;
}

interface Workspace {
  tabs: Tab[];
  active: string;
  /** Split view on (it shows on wide screens only). */
  split: boolean;
  /** Tab ids, most recently used first: split view shows the first few. */
  recent: string[];
}

export const MAX_TABS = 12;
const KEY = 'formatter:workspace';

const newId = () => Math.random().toString(36).slice(2, 10);
const here = () => location.hash || '#/';
/** The section stored with the current history entry, else this page's. */
const entrySection = (): Section => (history.state as { section?: Section } | null)?.section ?? section;

function load(): Workspace | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Workspace | null;
    return saved && Array.isArray(saved.tabs) && saved.tabs.length ? saved : null;
  } catch {
    return null;
  }
}

function start(): Workspace {
  const tab: Tab = { id: newId(), section: entrySection(), hash: here() };
  if (typeof location === 'undefined') return { tabs: [tab], active: tab.id, split: false, recent: [tab.id] };
  const saved = load();
  if (!saved) return { tabs: [tab], active: tab.id, split: false, recent: [tab.id] };
  // The address wins for the tab in use: it may be a link someone opened.
  const active = saved.tabs.find((t) => t.id === saved.active) ?? saved.tabs[0];
  active.section = tab.section;
  active.hash = tab.hash;
  const ids = saved.tabs.map((t) => t.id);
  return { tabs: saved.tabs, active: active.id, split: !!saved.split, recent: [active.id, ...(saved.recent ?? []).filter((id) => id !== active.id && ids.includes(id))] };
}

export const workspace = $state<Workspace>(start());

export function currentTab(): Tab {
  return workspace.tabs.find((t) => t.id === workspace.active) ?? workspace.tabs[0];
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(workspace));
  } catch {
    /* storage unavailable or full: tabs last until the page is closed */
  }
}

/** Mark the current history entry with the tab's section. */
function stamp() {
  history.replaceState({ ...(history.state as object | null), section: currentTab().section }, '');
}

if (typeof window !== 'undefined') {
  stamp();
  addEventListener('pagehide', () => {
    currentTab().hash = here();
    save();
  });
}

/** The hash changed (a link, a tool, back or forward): it's the tab in use's page now. */
export function followHash() {
  const tab = currentTab();
  tab.hash = here();
  // Back or forward to an entry made here carries its section; a new one keeps the tab's.
  tab.section = (history.state as { section?: Section } | null)?.section ?? tab.section;
  stamp();
  save();
}

/** Open `hash` in the tab in use, with `#/` meaning section `to`'s home page. */
export function navigate(to: Section, hash: string) {
  const tab = currentTab();
  if (tab.section === to && tab.hash === hash) return;
  history.pushState({ section: to }, '', hash);
  tab.section = to;
  tab.hash = hash;
  save();
}

export function activate(id: string) {
  if (id === workspace.active || !workspace.tabs.some((t) => t.id === id)) return;
  const leaving = currentTab();
  // Pages may rewrite their address without a hashchange (Connect does, after joining).
  leaving.hash = here();
  if (!workspace.split) leaving.scroll = scrollY;
  workspace.active = id;
  workspace.recent = [id, ...workspace.recent.filter((r) => r !== id)];
  const tab = currentTab();
  history.replaceState({ section: tab.section }, '', tab.hash);
  save();
  if (!workspace.split) tick().then(() => scrollTo(0, tab.scroll ?? 0));
}

/** Open a page in a new tab next to the one in use, and switch to it. False when there are too many tabs. */
export function openTab(hash = '#/', to: Section = 'home'): boolean {
  if (workspace.tabs.length >= MAX_TABS) return false;
  const tab: Tab = { id: newId(), section: to, hash };
  const at = workspace.tabs.findIndex((t) => t.id === workspace.active);
  workspace.tabs.splice(at + 1, 0, tab);
  activate(tab.id);
  return true;
}

export function closeTab(id: string) {
  if (workspace.tabs.length < 2) return;
  const at = workspace.tabs.findIndex((t) => t.id === id);
  if (at < 0) return;
  workspace.recent = workspace.recent.filter((r) => r !== id);
  if (id === workspace.active) activate(workspace.recent[0] ?? workspace.tabs[at + 1]?.id ?? workspace.tabs[at - 1].id);
  workspace.tabs.splice(at, 1);
  if (workspace.tabs.length < 2) workspace.split = false;
  save();
}

export function toggleSplit() {
  workspace.split = !workspace.split && workspace.tabs.length > 1;
  save();
}

/** The tabs on screen: the one in use, or in split view up to `panes` most recently used, in tab order. */
export function shownTabs(panes: number): Tab[] {
  if (!workspace.split || panes < 2) return [currentTab()];
  const ids = workspace.recent.filter((id) => workspace.tabs.some((t) => t.id === id)).slice(0, panes);
  return workspace.tabs.filter((t) => ids.includes(t.id));
}

// Files picked on a home page (or a recording), handed to the tool opened next.
let handed: File[] = [];

export function handFiles(files: File[]) {
  handed = files;
}

export function takeFiles(): File[] {
  const files = handed;
  handed = [];
  return files;
}
