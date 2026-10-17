/**
 * The site has four sections that share one app: PDF & image tools at the
 * root, and Video, Screen recorder and IT (developer) tools at `video/`,
 * `record/` and `it/`. Each is a real path with its own index.html (see
 * vite.config.ts). Hash routes work the same in every section, so sharing,
 * transfers, scanning and any tool page are available everywhere; only the
 * home page, header and titles differ.
 */
import { encodeToolState, type ToolState } from '../it/links';

export type Section = 'files' | 'video' | 'record' | 'it';

/** Folder of each section below the site root ('' is the root). */
const FOLDERS: Record<Section, string> = { files: '', video: 'video/', record: 'record/', it: 'it/' };

export function sectionOf(pathname: string): Section {
  const m = /\/(it|video|record)\/(index\.html)?$/.exec(pathname);
  return (m?.[1] as Section | undefined) ?? 'files';
}

export const section: Section = typeof location === 'undefined' ? 'files' : sectionOf(location.pathname);

/** Link from section `from` to page `hash` (default: home) of section `to`. */
export function sectionHref(to: Section, hash = '#/', from: Section = section): string {
  if (to === from) return hash;
  const up = from === 'files' ? '' : '../';
  return `${up}${FOLDERS[to]}${hash === '#/' ? '' : hash}` || './';
}

/** Links to each section's home page from the current one. */
export const FILES_HOME = sectionHref('files');
export const VIDEO_HOME = sectionHref('video');
export const RECORD_HOME = sectionHref('record');
export const IT_HOME = sectionHref('it');

/** Link to an IT tool from any section, optionally opening it with this input. */
export function itToolHref(id: string, state?: ToolState): string {
  return sectionHref('it', `#/${id}${state ? `/${encodeToolState(state)}` : ''}`);
}

/** Link to a video tool from any section. */
export function videoToolHref(id: string, suffix = ''): string {
  return sectionHref('video', `#/tool/${id}${suffix}`);
}
