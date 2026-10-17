/**
 * The site has two sections that share one app: PDF & image tools at the
 * root, and IT (developer) tools at `it/`, a real path with its own
 * index.html (see vite.config.ts). Hash routes work the same in both, so
 * sharing, transfers and scanning are available everywhere; only the home
 * page, header and titles differ.
 */
import { encodeToolState, type ToolState } from '../it/links';

export type Section = 'files' | 'it';

export const section: Section = /\/it\/(index\.html)?$/.test(location.pathname) ? 'it' : 'files';

/** Links to each section's home page from the current one. */
export const FILES_HOME = section === 'it' ? '../' : '#/';
export const IT_HOME = section === 'it' ? '#/' : 'it/';

/** Link to an IT tool from either section, optionally opening it with this input. */
export function itToolHref(id: string, state?: ToolState): string {
  return `${section === 'it' ? '' : 'it/'}#/${id}${state ? `/${encodeToolState(state)}` : ''}`;
}
