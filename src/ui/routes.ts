/**
 * What a hash route shows: a tool, an IT tool, one of the other pages, or the
 * home page of a section. Each tab (see tabs.svelte.ts) has its own route.
 */
import { getAction } from '../actions';
import { getItTool } from '../it/registry';
import type { ActionDefinition } from '../core/types';
import type { ItToolInfo } from '../it/types';
import { PIPELINE_ROUTE } from '../core/pipeline';
import { LINK_ROUTE, QR_ROUTE } from '../core/share';
import { DIRECT_ROUTE } from '../core/direct';
import { SECTION_INFO, sectionOfCategory, type Section } from './section';

export type Page = 'tool' | 'it-tool' | 'pipeline' | 'compare' | 'share' | 'local' | 'lan' | 'connect' | 'received' | 'home';

export interface Route {
  page: Page;
  action?: ActionDefinition;
  /** `#/tool/<video tool>/recording/<id>`: a saved recording to open in the tool. */
  recordingId?: string;
  itTool?: ItToolInfo;
  /** `#/<IT tool>/<state>`: starting input for the IT tool. */
  itPayload?: string;
}

/** `native`: the Local share pages (`#/local`, `#/lan`) exist in the native apps only. */
export function parseRoute(hash: string, native: boolean): Route {
  const tool = /^#\/tool\/([^/]+)(?:\/recording\/([\w-]+))?$/.exec(hash);
  const action = tool ? getAction(decodeURIComponent(tool[1])) : undefined;
  if (action) return { page: 'tool', action, recordingId: tool?.[2] };
  const it = /^#\/([a-z0-9-]+)(?:\/(.+))?$/.exec(hash);
  const itTool = it ? getItTool(it[1]) : undefined;
  if (itTool) return { page: 'it-tool', itTool, itPayload: it?.[2] };
  if (hash === PIPELINE_ROUTE || hash.startsWith(`${PIPELINE_ROUTE}/`)) return { page: 'pipeline' };
  if (hash === '#/compare') return { page: 'compare' };
  if (hash === '#/share') return { page: 'share' };
  if (native && (hash === '#/local' || hash.startsWith('#/local/'))) return { page: 'local' };
  if (native && hash === '#/lan') return { page: 'lan' };
  if (hash === '#/connect' || hash.startsWith('#/connect/') || hash === '#/scan' || hash.startsWith('#/direct') || hash.startsWith(`#${DIRECT_ROUTE}`)) {
    return { page: 'connect' };
  }
  if (hash.startsWith(`#${LINK_ROUTE}`) || hash.startsWith(`#${QR_ROUTE}`)) return { page: 'received' };
  return { page: 'home' };
}

/** The section a route belongs to: a tool's own, else the tab's. */
export function sectionOfRoute(route: Route, tabSection: Section): Section {
  return route.action ? sectionOfCategory(route.action.category) : route.itTool ? 'it' : tabSection;
}

const PAGES: Record<Exclude<Page, 'tool' | 'it-tool' | 'home'>, { icon: string; title: string }> = {
  pipeline: { icon: '⛓️', title: 'Pipeline' },
  compare: { icon: '🔀', title: 'Compare PDFs' },
  share: { icon: '🔗', title: 'Share as link or QR' },
  local: { icon: '📡', title: 'Local share' },
  lan: { icon: '📡', title: 'Share with a browser' },
  connect: { icon: '🔗', title: 'Connect devices' },
  received: { icon: '📥', title: 'Shared file' },
};

/** Icon and title for a tab or the window. */
export function describeRoute(route: Route, tabSection: Section): { icon: string; title: string } {
  if (route.action) return { icon: route.action.icon, title: route.action.title };
  if (route.itTool) return { icon: route.itTool.icon, title: route.itTool.title };
  if (route.page === 'home') return { icon: SECTION_INFO[tabSection].icon, title: SECTION_INFO[tabSection].home };
  return PAGES[route.page as keyof typeof PAGES];
}
