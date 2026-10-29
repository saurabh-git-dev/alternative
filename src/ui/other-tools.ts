/**
 * Tools that live in other sections, as catalogue entries linking straight to
 * each tool (not to its section's home page). The IT and Video home pages
 * search these too, so typing "compress pdf" there finds Compress PDF.
 */
import { ACTIONS, VIDEO_ACTIONS } from '../actions';
import { IT_TOOLS } from '../it/registry';
import { itToolHref, section, sectionHref, videoToolHref, type Section } from './section';
import type { CatalogEntry } from './components/ToolCatalog.svelte';

const SECTION_NAMES: Record<Section, string> = { files: 'PDF & image', video: 'Video', record: 'Screen recorder', it: 'IT tools', chat: 'Chat' };

/** Every tool outside the current section, each tagged with the section it's in. */
export function otherSectionTools(): CatalogEntry[] {
  const tools: (CatalogEntry & { section: Section })[] = [
    ...ACTIONS.map((a) => ({ key: a.id, icon: a.icon, title: a.title, description: a.description, group: a.category, href: sectionHref('files', `#/tool/${a.id}`), section: 'files' as const })),
    ...VIDEO_ACTIONS.map((a) => ({ key: a.id, icon: a.icon, title: a.title, description: a.description, keywords: 'video', group: a.category, href: videoToolHref(a.id), section: 'video' as const })),
    ...IT_TOOLS.map((t) => ({ key: `it:${t.id}`, icon: t.icon, title: t.title, description: t.description, keywords: t.keywords, group: t.category, href: itToolHref(t.id), section: 'it' as const })),
  ];
  return tools
    .filter((t) => t.section !== section)
    .map(({ section: s, ...t }) => ({ ...t, keywords: `${t.keywords ?? ''} ${SECTION_NAMES[s]}`, group: 'other', description: `${SECTION_NAMES[s]} · ${t.description}` }));
}
