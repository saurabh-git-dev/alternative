<!--
  A searchable catalogue of tools in panels, one per group: the home page of
  the IT, Video and Screen recorder sections. Typing filters every panel,
  Enter opens the first match, and "/" jumps to the search box.

  Entries are links; `open` (when set) runs instead, e.g. to hand files to
  the tool. The `extra` snippet adds controls next to the search box.

  `others` are tools from other sections (see other-tools.ts): they aren't
  listed, but a search finds them too, in a panel of their own, and opens
  the tool itself.
-->
<script lang="ts" module>
  export interface CatalogEntry {
    key: string;
    icon: string;
    title: string;
    description: string;
    /** Extra words that should match a search but aren't shown. */
    keywords?: string;
    group: string;
    href: string;
    open?: () => void;
    /** Shown as a warning mark and tooltip, e.g. why a tool may struggle on this device. */
    warning?: string;
  }
  export interface CatalogGroup {
    id: string;
    label: string;
    icon: string;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { usePane } from '../pane';

  /** Window-wide shortcuts and drops go to the tab in use only (see pane.ts). */
  const pane = usePane();

  let {
    entries,
    groups,
    placeholder,
    label,
    empty,
    extra,
    others = [],
  }: { entries: CatalogEntry[]; groups: CatalogGroup[]; placeholder: string; label: string; empty?: Snippet; extra?: Snippet; others?: CatalogEntry[] } = $props();

  const OTHER: CatalogGroup = { id: 'other', label: 'In other sections', icon: '🔎' };

  let query = $state('');
  let search: HTMLInputElement;

  /** Every word typed must appear somewhere in the entry. */
  function matching(list: CatalogEntry[], q: string): CatalogEntry[] {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((e) => {
      const text = `${e.title} ${e.description} ${e.keywords ?? ''} ${e.group}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }
  const visible = $derived(matching(entries, query));
  /** Other sections' tools appear only for a search. */
  const elsewhere = $derived(query.trim() ? matching(others, query) : []);

  function go(e: CatalogEntry) {
    if (e.open) e.open();
    else location.href = e.href;
  }

  function onSearchKey(e: KeyboardEvent) {
    const first = visible[0] ?? elsewhere[0];
    if (e.key === 'Enter' && first) go(first);
    if (e.key === 'Escape') query = '';
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pane.active) return;
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
</script>

<div class="bar">
  <input bind:this={search} class="search" type="search" {placeholder} aria-label={label} bind:value={query} onkeydown={onSearchKey} />
  {@render extra?.()}
</div>

<div class="panels">
  {#each [...groups, OTHER] as group (group.id)}
    {@const items = group === OTHER ? elsewhere : visible.filter((e) => e.group === group.id)}
    {#if items.length}
      <section class="panel card">
        <h2><span aria-hidden="true">{group.icon}</span> {group.label}</h2>
        <div class="group">
          {#each items as e (e.key)}
            <a
              class="tool"
              href={e.href}
              title={e.warning ? `${e.description}\n\n⚠ ${e.warning}` : e.description}
              onclick={(ev) => {
                if (!e.open) return;
                ev.preventDefault();
                e.open();
              }}
            >
              <span class="icon" aria-hidden="true">{e.icon}</span>
              <span class="text">
                <span class="title">{e.title}{#if e.warning}<span class="heavy" aria-label="May be slow on this device">⚠</span>{/if}</span>
                <span class="desc">{e.description}</span>
              </span>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/each}
</div>

{#if visible.length === 0 && elsewhere.length === 0}
  <p class="empty muted">No tools match. Try another word{#if empty}, or {@render empty()}{/if}.</p>
{/if}

<style>
  .bar {
    display: flex;
    gap: 8px;
    align-items: center;
    position: sticky;
    top: var(--header-h, 55px);
    z-index: 5;
    max-width: 640px;
    margin: 0 auto;
    padding: 12px 0;
    background: var(--bg);
  }
  .search {
    flex: 1;
    min-width: 0;
    padding: 10px 16px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
    font-size: 15px;
  }
  .panels {
    columns: 3 300px;
    column-gap: 16px;
  }
  .panel {
    break-inside: avoid;
    margin-bottom: 16px;
    padding: 12px 10px 10px;
  }
  h2 {
    font-size: 15px;
    margin: 0 6px 6px;
    letter-spacing: -0.01em;
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: inherit;
    text-decoration: none;
  }
  .tool:hover,
  .tool:focus-visible {
    background: var(--accent-soft);
  }
  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 18px;
    line-height: 1;
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    font-size: 14.5px;
    line-height: 1.25;
  }
  .desc {
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .heavy {
    margin-left: 6px;
    color: var(--warning);
    font-size: 12px;
  }
  .empty {
    text-align: center;
    margin-top: 32px;
  }
  /* Phones: two tiles per row, title only (the description is on the tool page). */
  @media (max-width: 560px) {
    .bar {
      padding: 10px 0;
    }
    .group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 4px;
    }
    .tool {
      padding: 7px 6px;
      gap: 8px;
    }
    .icon {
      width: 30px;
      height: 30px;
      font-size: 17px;
    }
    .title {
      font-size: 13.5px;
    }
    .desc {
      display: none;
    }
  }
</style>
