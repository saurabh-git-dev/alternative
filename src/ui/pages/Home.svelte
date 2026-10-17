<!--
  Home: every tool on one compact screen.

  Tools are listed as slim rows in two panels, PDF and Image (side by side on
  wide screens), so most of the catalogue fits without scrolling. The search
  box stays pinned at the top: typing filters every panel, Enter opens the
  first match, and "/" jumps to the box from anywhere on the page.

  Dropping files anywhere on the page (or picking them with "Open a file")
  filters the list to tools that accept them; picking a tool then opens it with
  those files already loaded.
-->
<script lang="ts">
  import { ACTIONS, CATEGORIES } from '../../actions';
  import type { ActionCategory } from '../../core/types';
  import { accepts, detectType, readFile } from '../../core/files';
  import { isConstrained } from '../../core/device';
  import { handoff } from '../handoff.svelte';
  import { PIPELINE_ROUTE, encodePipeline } from '../../core/pipeline';
  import { loadPipelines } from '../settings';

  let { onOpen }: { onOpen: (id: string, files?: File[]) => void } = $props();

  /** One row in the list: a tool (action), a page of its own, or a shortcut. */
  interface Entry {
    key: string;
    icon: string;
    title: string;
    description: string;
    /** Extra words that should match a search but aren't shown. */
    keywords?: string;
    /** Category id (PDF sub-groups, 'image') or 'more'. */
    group: ActionCategory | 'more';
    /** Hidden while files are dropped unless this returns true. */
    takes: (files: File[]) => boolean;
    open: () => void;
    href?: string;
    demanding?: string;
  }

  let query = $state('');
  let dropped = $state<File[]>([]);
  let dragging = $state(false);
  let search: HTMLInputElement;
  let picker: HTMLInputElement;

  const constrained = isConstrained();

  const entries: Entry[] = [
    ...ACTIONS.map(
      (a): Entry => ({
        key: a.id,
        icon: a.icon,
        title: a.title,
        description: a.description,
        group: a.category,
        takes: (files) => files.every((f) => accepts(a, detectType(f))),
        open: () => onOpen(a.id, dropped),
        demanding: a.demanding,
      }),
    ),
    // Pages whose result is a view, not a file.
    {
      key: 'compare',
      icon: '🔀',
      title: 'Compare PDFs',
      description: 'See what changed between two versions, word by word and on the page.',
      keywords: 'diff difference',
      group: 'pdf-edit',
      href: '#/compare',
      takes: (files) => files.every((f) => detectType(f) === 'application/pdf'),
      open: () => (location.hash = '#/compare'),
    },
    {
      key: 'share',
      icon: '🔗',
      title: 'Share as link or QR',
      description: 'Put a file or text into a link and QR code, then open it on your phone.',
      keywords: 'send phone transfer qr code',
      group: 'more',
      takes: (files) => files.length <= 1,
      open: async () => {
        handoff.file = dropped[0] ? await readFile(dropped[0]) : null;
        location.hash = '#/share';
      },
    },
    {
      key: 'direct',
      icon: '📡',
      title: 'Send to your phone',
      description: 'Any size, straight to another device by QR code, end-to-end encrypted.',
      keywords: 'share transfer send big large file phone computer airdrop',
      group: 'more',
      takes: (files) => files.length <= 1,
      open: async () => {
        handoff.file = dropped[0] ? await readFile(dropped[0]) : null;
        location.hash = '#/direct';
      },
    },
    {
      key: 'direct-receive',
      icon: '📥',
      title: 'Get files from your phone',
      description: 'Scan a QR code with your phone and send photos or files here, any size.',
      keywords: 'receive transfer import photos phone computer airdrop',
      group: 'more',
      href: '#/direct/receive',
      takes: (files) => files.length === 0,
      open: () => (location.hash = '#/direct/receive'),
    },
    {
      key: 'pipeline',
      icon: '⛓️',
      title: 'Build a pipeline',
      description: 'Chain tools and run them in one go, e.g. photos → PDF → OCR → compress.',
      keywords: 'automate chain batch recipe workflow',
      group: 'more',
      href: PIPELINE_ROUTE,
      takes: (files) => files.length === 0,
      open: () => (location.hash = PIPELINE_ROUTE),
    },
    ...loadPipelines().map(
      (p): Entry => ({
        key: `pipeline:${p.name}`,
        icon: '▶️',
        title: p.name,
        description: `${p.steps.length} steps · your pipeline`,
        keywords: 'pipeline automate',
        group: 'more',
        href: `${PIPELINE_ROUTE}/${encodePipeline(p)}`,
        takes: (files) => files.length === 0,
        open: () => (location.hash = `${PIPELINE_ROUTE}/${encodePipeline(p)}`),
      }),
    ),
  ];

  /** Every word typed must appear somewhere in the entry, so "pdf comp" finds Compress PDF. */
  const visible = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => {
      const text = `${e.title} ${e.description} ${e.keywords ?? ''} ${e.group}`.toLowerCase();
      return words.every((w) => text.includes(w)) && (dropped.length === 0 || e.takes(dropped));
    });
  });

  const PDF_GROUPS = CATEGORIES.filter((c) => c.id.startsWith('pdf-'));
  const inGroup = (id: string) => visible.filter((e) => e.group === id);
  const pdfCount = $derived(visible.filter((e) => e.group.startsWith('pdf-')).length);
  const imageEntries = $derived(inGroup('image'));
  const moreEntries = $derived(inGroup('more'));

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && visible[0]) visible[0].open();
    if (e.key === 'Escape') query = '';
  }

  // Page-wide shortcuts and drop target, active while the home page is shown.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.focus();
      }
    };
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragging = true;
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) dragging = false;
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragging = false;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) dropped = files;
    };
    addEventListener('keydown', onKey);
    addEventListener('dragover', onOver);
    addEventListener('dragleave', onLeave);
    addEventListener('drop', onDrop);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('dragover', onOver);
      removeEventListener('dragleave', onLeave);
      removeEventListener('drop', onDrop);
    };
  });
</script>

{#snippet row(e: Entry)}
  {@const warn = constrained && e.demanding}
  {#if e.href}
    <a class="tool" href={e.href} title={e.description}>
      <span class="icon" aria-hidden="true">{e.icon}</span>
      <span class="text"><span class="title">{e.title}</span><span class="desc">{e.description}</span></span>
    </a>
  {:else}
    <button class="tool" onclick={e.open} title={warn ? `${e.description}\n\n⚠ ${e.demanding}` : e.description}>
      <span class="icon" aria-hidden="true">{e.icon}</span>
      <span class="text">
        <span class="title">{e.title}{#if warn}<span class="heavy" aria-label="May be slow on this device">⚠</span>{/if}</span>
        <span class="desc">{e.description}</span>
      </span>
    </button>
  {/if}
{/snippet}

<section class="hero">
  <h1>Every PDF and image tool, right in your browser</h1>
  <p class="muted">Free and private: files are processed on your device and never uploaded.</p>
</section>

<div class="bar">
  <input
    bind:this={search}
    class="search"
    type="search"
    placeholder="Search tools, e.g. “compress”"
    aria-label="Search tools"
    bind:value={query}
    onkeydown={onSearchKey}
  />
  <input bind:this={picker} type="file" multiple accept="application/pdf,image/*" hidden onchange={(e) => (dropped = [...(e.currentTarget.files ?? [])])} />
  {#if dropped.length}
    <span class="chip" title={dropped.map((f) => f.name).join('\n')}>
      📎 {dropped.length === 1 ? dropped[0].name : `${dropped.length} files`}
      <button aria-label="Clear files" onclick={() => (dropped = [])}>✕</button>
    </span>
  {:else}
    <button class="btn open" onclick={() => picker.click()} title="Pick a file to see which tools can open it">📂 <span>Open a file</span></button>
  {/if}
</div>
{#if dropped.length}
  <p class="filtered muted">Showing tools for {dropped.length > 1 ? 'these files' : 'this file'}. Pick one to open {dropped.length > 1 ? 'them' : 'it'}.</p>
{/if}

<div class="panels">
  {#if pdfCount}
    <section class="panel card pdf">
      <h2><span aria-hidden="true">📄</span> PDF</h2>
      <div class="groups">
        {#each PDF_GROUPS as category (category.id)}
          {@const items = inGroup(category.id)}
          {#if items.length}
            <div class="group">
              <h3>{category.label.replace(/ ?PDF ?/, '')}</h3>
              {#each items as e (e.key)}{@render row(e)}{/each}
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/if}

  {#if imageEntries.length || moreEntries.length}
    <div class="side">
      {#if imageEntries.length}
        <section class="panel card">
          <h2><span aria-hidden="true">🖼️</span> Image</h2>
          <div class="group">
            {#each imageEntries as e (e.key)}{@render row(e)}{/each}
          </div>
        </section>
      {/if}
      {#if moreEntries.length}
        <section class="panel card">
          <h2><span aria-hidden="true">✨</span> Share & automate</h2>
          <div class="group">
            {#each moreEntries as e (e.key)}{@render row(e)}{/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</div>

{#if visible.length === 0}
  <p class="empty muted">No tools match. Try another word{dropped.length ? ', or clear the file' : ''}.</p>
{/if}

{#if dragging}
  <div class="dropping" aria-hidden="true"><span>Drop to see what you can do with it</span></div>
{/if}

<style>
  .hero {
    text-align: center;
    padding: 4px 0 0;
  }
  h1 {
    font-size: clamp(21px, 3vw, 30px);
    line-height: 1.2;
    margin: 0 0 4px;
    letter-spacing: -0.02em;
  }
  .hero p {
    margin: 0;
    font-size: 14.5px;
  }

  /* Search bar: pinned under the app header while scrolling. */
  .bar {
    position: sticky;
    top: 55px;
    z-index: 5;
    display: flex;
    gap: 8px;
    align-items: center;
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
  .open {
    flex: none;
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 45%;
    padding: 6px 6px 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    font-size: 14px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chip button {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 2px 6px;
  }
  .filtered {
    text-align: center;
    font-size: 14px;
    margin: -4px 0 8px;
  }

  /* PDF on the left (two inner columns), Image and extras on the right. */
  .panels {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .panels > :only-child {
    grid-column: 1 / -1;
  }
  .side {
    display: grid;
    gap: 16px;
  }
  .panel {
    padding: 12px 10px 10px;
  }
  h2 {
    font-size: 15px;
    margin: 0 6px 6px;
    letter-spacing: -0.01em;
  }
  .groups {
    columns: 2;
    column-gap: 10px;
  }
  .group {
    break-inside: avoid;
    margin-bottom: 6px;
  }
  h3 {
    font-size: 11.5px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
    margin: 8px 8px 2px;
  }

  .tool {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
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
  .heavy {
    margin-left: 6px;
    color: var(--warning);
    font-size: 12px;
  }
  .desc {
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty {
    text-align: center;
    margin-top: 32px;
  }
  .dropping {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 3px dashed var(--accent);
    pointer-events: none;
  }
  .dropping span {
    padding: 12px 20px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    font-weight: 600;
  }

  @media (max-width: 900px) {
    .panels {
      grid-template-columns: 1fr;
    }
  }
  /* Phones: two tool tiles per row, title only; the description is in the tooltip and on the tool page. */
  @media (max-width: 560px) {
    .hero p {
      display: none;
    }
    .open span {
      display: none;
    }
    .bar {
      top: 55px;
      padding: 10px 0;
    }
    .groups {
      columns: 1;
    }
    .group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 4px;
      margin-bottom: 4px;
    }
    h3 {
      grid-column: 1 / -1;
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
