/**
 * Every open tab stays mounted (see tabs.svelte.ts), so components that
 * listen on the whole window (keyboard shortcuts, paste, drop) check
 * `usePane().active` and leave events to the tab in use. Outside a tab,
 * e.g. in a dialog, a component is always active.
 */
import { getContext, setContext } from 'svelte';

const KEY = Symbol('pane');

export interface Pane {
  /** The tab in use (the one shown, or in split view the one last clicked). */
  readonly active: boolean;
  /** Open another copy of this tab's page in a new tab. */
  duplicate: () => void;
}

export function providePane(pane: Pane): void {
  setContext(KEY, pane);
}

/** Call while the component is created; read `.active` in event handlers. */
export function usePane(): Pane {
  return getContext<Pane>(KEY) ?? { active: true, duplicate: () => {} };
}
