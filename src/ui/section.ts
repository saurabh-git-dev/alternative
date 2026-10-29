/**
 * The site has six sections that share one app, each a real path with its
 * own index.html (see vite.config.ts): the Dashboard at the root (your pick of
 * tools from every section, see pages/Home.svelte), then `pdf/`, `image/`,
 * `video/`, `record/` (screen recorder) and `it/` (developer tools). Hash
 * routes work the same in every section, so sharing, transfers, Connect and
 * any tool page are available everywhere; only the home page, header and
 * titles differ.
 */
import { encodeToolState, type ToolState } from '../it/links';

export type Section = 'home' | 'pdf' | 'image' | 'video' | 'record' | 'it';

/** Folder of each section below the site root ('' is the root). */
const FOLDERS: Record<Section, string> = { home: '', pdf: 'pdf/', image: 'image/', video: 'video/', record: 'record/', it: 'it/' };

export function sectionOf(pathname: string): Section {
  const m = /\/(pdf|image|it|video|record)\/(index\.html)?$/.exec(pathname);
  return (m?.[1] as Section | undefined) ?? 'home';
}

export const section: Section = typeof location === 'undefined' ? 'home' : sectionOf(location.pathname);

/** Link from section `from` to page `hash` (default: home) of section `to`. */
export function sectionHref(to: Section, hash = '#/', from: Section = section): string {
  if (to === from) return hash;
  const up = from === 'home' ? '' : '../';
  return `${up}${FOLDERS[to]}${hash === '#/' ? '' : hash}` || './';
}

/** Links to each section's home page from the current one. */
export const DASHBOARD_HOME = sectionHref('home');
export const PDF_HOME = sectionHref('pdf');
export const IMAGE_HOME = sectionHref('image');
export const VIDEO_HOME = sectionHref('video');
export const RECORD_HOME = sectionHref('record');
export const IT_HOME = sectionHref('it');

/** The section a tool (action) belongs to, from its category. */
export function sectionOfCategory(category: string): Section {
  return category === 'image' ? 'image' : category.startsWith('video') ? 'video' : 'pdf';
}

/** Link to an IT tool from any section, optionally opening it with this input. */
export function itToolHref(id: string, state?: ToolState): string {
  return sectionHref('it', `#/${id}${state ? `/${encodeToolState(state)}` : ''}`);
}

/** Link to a video tool from any section. */
export function videoToolHref(id: string, suffix = ''): string {
  return sectionHref('video', `#/tool/${id}${suffix}`);
}
