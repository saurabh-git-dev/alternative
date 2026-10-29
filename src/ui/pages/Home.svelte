<!--
  Two pages share this component:

  - The PDF & image home (`#/` in the root section): every PDF and image tool
    plus sharing and automation, as slim rows in panels.
  - The Dashboard (`#/dashboard`, `dashboard`): the tools most people need,
    from every section. By default an everyday set (see PRESETS): common PDF,
    image and video tools plus a few handy extras. "Customize" at the bottom
    opens a dialog to pick the tools shown, starting from a preset for a kind
    of user (everyday, documents, photos & video, developer); the choice is
    saved in this browser (settings.ts). "Show all tools" lists everything.

  On both, the search box stays pinned at the top and searches every tool in
  every section (PDF, image, video, IT): typing filters the panels, Enter
  opens the best match, and a match opens the tool itself, not its section's
  home page. "/" jumps to the box from anywhere.

  Dropping files anywhere on the page (or picking them with "Open a file")
  filters the list to tools that accept them; picking a tool then opens it with
  those files already loaded.
-->
<script lang="ts">
  import { ACTIONS, CATEGORIES, VIDEO_ACTIONS, VIDEO_CATEGORIES } from '../../actions';
  import { IT_CATEGORIES, IT_TOOLS } from '../../it/registry';
  import { accepts, detectType, readFile } from '../../core/files';
  import { isConstrained } from '../../core/device';
  import { handoff } from '../handoff.svelte';
  import { PIPELINE_ROUTE, encodePipeline } from '../../core/pipeline';
  import { loadDashboard, loadPipelines, saveDashboard } from '../settings';
  import { IT_HOME, RECORD_HOME, VIDEO_HOME, itToolHref, videoToolHref } from '../section';
  import DashboardDialog, { type DashboardPreset } from '../components/DashboardDialog.svelte';

  let { onOpen, dashboard = false }: { onOpen: (id: string, files?: File[]) => void; dashboard?: boolean } = $props();

  type PanelId = 'pdf' | 'image' | 'video' | 'it' | 'more';

  /** One row in the list: a tool (action), a page of its own, or a shortcut. */
  interface Entry {
    key: string;
    icon: string;
    title: string;
    description: string;
    /** Extra words that should match a search but aren't shown. */
    keywords?: string;
    panel: PanelId;
    /** Sub-heading within the panel (a category id), if it has them. */
    group?: string;
    /** Hidden while files are dropped unless this returns true. */
    takes: (files: File[]) => boolean;
    open: () => void;
    href?: string;
    demanding?: string;
    /** A shortcut listed on the PDF & image home only: search and the dashboard have the real thing. */
    listOnly?: boolean;
  }

  let query = $state('');
  let dropped = $state<File[]>([]);
  let dragging = $state(false);
  let search: HTMLInputElement;
  let picker: HTMLInputElement;

  const constrained = isConstrained();
  const pipelines = loadPipelines();

  const isVideo = (f: File) => detectType(f).startsWith('video/');

  const entries: Entry[] = $derived([
    ...ACTIONS.map(
      (a): Entry => ({
        key: a.id,
        icon: a.icon,
        title: a.title,
        description: a.description,
        panel: a.category === 'image' ? 'image' : 'pdf',
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
      panel: 'pdf',
      group: 'pdf-edit',
      href: '#/compare',
      takes: (files) => files.every((f) => detectType(f) === 'application/pdf'),
      open: () => (location.hash = '#/compare'),
    },
    // Video tools live in the Video section; with videos picked here they open in place, loaded.
    ...VIDEO_ACTIONS.map(
      (a): Entry => ({
        key: a.id,
        icon: a.icon,
        title: a.title,
        description: a.description,
        keywords: 'video',
        panel: 'video',
        group: a.category,
        href: dropped.length ? undefined : videoToolHref(a.id),
        takes: (files) => files.every(isVideo),
        open: () => (dropped.length ? onOpen(a.id, dropped) : (location.href = videoToolHref(a.id))),
        demanding: a.demanding,
      }),
    ),
    ...IT_TOOLS.map(
      (t): Entry => ({
        key: `it:${t.id}`,
        icon: t.icon,
        title: t.title,
        description: t.description,
        keywords: `${t.keywords ?? ''} developer it`,
        panel: 'it',
        group: t.category,
        href: itToolHref(t.id),
        takes: (files) => files.length === 0,
        open: () => (location.href = itToolHref(t.id)),
      }),
    ),
    {
      key: 'share',
      icon: '🔗',
      title: 'Share as link or QR',
      description: 'Put a file or text into a link and QR code, then open it on your phone.',
      keywords: 'send phone transfer qr code',
      panel: 'more',
      takes: (files) => files.length <= 1,
      open: async () => {
        handoff.file = dropped[0] ? await readFile(dropped[0]) : null;
        location.hash = '#/share';
      },
    },
    {
      key: 'connect',
      icon: '🔗',
      title: 'Connect a device',
      description: 'Send files and text to your phone or another computer, any size, either way. End-to-end encrypted.',
      keywords: 'share transfer send receive big large file phone computer airdrop scan qr camera chat',
      panel: 'more',
      href: '#/connect',
      takes: (files) => files.length === 0,
      open: () => (location.hash = '#/connect'),
    },
    {
      key: 'qr-scan',
      icon: '📷',
      title: 'Scan a QR code',
      description: 'Read any QR code with the camera or from a photo: links, Wi-Fi, contacts and more.',
      panel: 'more',
      href: itToolHref('qr-scan'),
      takes: () => false,
      open: () => (location.href = itToolHref('qr-scan')),
      listOnly: true,
    },
    {
      key: 'video',
      icon: '🎬',
      title: 'Video tools',
      description: 'Trim, crop, blur areas, compress, convert, GIFs and more.',
      panel: 'more',
      href: VIDEO_HOME,
      takes: () => false,
      open: () => (location.href = VIDEO_HOME),
      listOnly: true,
    },
    {
      key: 'record',
      icon: '⏺️',
      title: 'Screen recorder',
      description: 'Record your screen, camera and mic. Saved in this browser.',
      keywords: 'loom screencast capture webcam',
      panel: 'more',
      href: RECORD_HOME,
      takes: (files) => files.length === 0,
      open: () => (location.href = RECORD_HOME),
    },
    {
      key: 'it',
      icon: '🛠️',
      title: 'IT tools',
      description: 'JSON, Base64, hashes, UUIDs, JWT, regex, cron, colors and 25 more.',
      panel: 'more',
      href: IT_HOME,
      takes: () => false,
      open: () => (location.href = IT_HOME),
      listOnly: true,
    },
    {
      key: 'pipeline',
      icon: '⛓️',
      title: 'Build a pipeline',
      description: 'Chain tools and run them in one go, e.g. photos → PDF → OCR → compress.',
      keywords: 'automate chain batch recipe workflow',
      panel: 'more',
      href: PIPELINE_ROUTE,
      takes: (files) => files.length === 0,
      open: () => (location.hash = PIPELINE_ROUTE),
    },
    ...pipelines.map(
      (p): Entry => ({
        key: `pipeline:${p.name}`,
        icon: '▶️',
        title: p.name,
        description: `${p.steps.length} steps · your pipeline`,
        keywords: 'pipeline automate',
        panel: 'more',
        href: `${PIPELINE_ROUTE}/${encodePipeline(p)}`,
        takes: (files) => files.length === 0,
        open: () => (location.hash = `${PIPELINE_ROUTE}/${encodePipeline(p)}`),
      }),
    ),
  ]);

  const PANELS: { id: PanelId; icon: string; label: string; href?: string; more?: string; groups?: { id: string; label: string }[] }[] = [
    { id: 'pdf', icon: '📄', label: 'PDF', groups: CATEGORIES.filter((c) => c.id.startsWith('pdf-')).map((c) => ({ id: c.id, label: c.label.replace(/ ?PDF ?/, '') })) },
    { id: 'image', icon: '🖼️', label: 'Image' },
    { id: 'more', icon: '✨', label: 'Share & automate' },
    { id: 'video', icon: '🎬', label: 'Video', href: VIDEO_HOME, more: 'All video tools', groups: VIDEO_CATEGORIES },
    { id: 'it', icon: '🛠️', label: 'IT tools', href: IT_HOME, more: 'All IT tools', groups: IT_CATEGORIES },
  ];

  /**
   * Starting sets for the dashboard, one per kind of user. The first is the
   * default: what most people reach for. Saved pipelines join every preset.
   */
  const keysOf = (panel: PanelId) => tools.filter((e) => e.panel === panel).map((e) => e.key);
  const saved = pipelines.map((p) => `pipeline:${p.name}`);
  const PRESETS: DashboardPreset[] = $derived([
    {
      id: 'everyday',
      icon: '⭐',
      label: 'Everyday',
      keys: [
        'pdf.merge', 'pdf.split', 'pdf.compress', 'pdf.to-images', 'pdf.from-images', 'pdf.sign', 'pdf.edit-text', 'pdf.fill-form', 'pdf.protect', 'pdf.unlock',
        'image.compress', 'image.resize', 'image.crop', 'image.convert', 'image.remove-background',
        'video.trim', 'video.compress', 'video.audio',
        'it:qr', 'it:qr-scan', 'it:password',
        'share', 'connect', 'record', ...saved,
      ],
    },
    {
      id: 'documents',
      icon: '🗂️',
      label: 'Documents & office',
      keys: [...keysOf('pdf'), 'image.ocr', 'image.convert', 'image.compress', 'it:qr-scan', 'share', 'connect', 'pipeline', ...saved],
    },
    {
      id: 'media',
      icon: '📸',
      label: 'Photos & video',
      keys: ['pdf.from-images', 'pdf.to-images', ...keysOf('image'), ...keysOf('video'), 'share', 'connect', 'record', ...saved],
    },
    {
      id: 'developer',
      icon: '👩‍💻',
      label: 'Developer',
      keys: [...keysOf('it'), 'pdf.merge', 'pdf.compress', 'image.compress', 'image.convert', 'share', 'connect', 'pipeline', ...saved],
    },
  ]);

  let chosen = $state<string[] | null>(loadDashboard());
  /** The tools on the dashboard: the saved choice, or the default preset. */
  const shownKeys = $derived(new Set(chosen ?? PRESETS[0].keys));
  let showAll = $state(false);
  let customizing = $state(false);

  /** Every word typed must appear somewhere in the entry, so "pdf comp" finds Compress PDF. */
  const words = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  /** Searching or filtering by files looks at every tool, on the dashboard or not. */
  const filtering = $derived(words.length > 0 || dropped.length > 0);
  /** Everything but the PDF & image home's shortcuts. */
  const tools = $derived(entries.filter((e) => !e.listOnly));
  const visible = $derived(
    (dashboard || filtering ? tools : entries).filter((e) => {
      if (!filtering) return dashboard ? showAll || shownKeys.has(e.key) : ['pdf', 'image', 'more'].includes(e.panel);
      const text = `${e.title} ${e.description} ${e.keywords ?? ''} ${e.group ?? ''} ${e.panel}`.toLowerCase();
      return words.every((w) => text.includes(w)) && (dropped.length === 0 || e.takes(dropped));
    }),
  );
  const inTitle = (e: Entry) => words.every((w) => e.title.toLowerCase().includes(w));
  /** Search results run best first: titles that match every word, then the rest. */
  const ranked = $derived(
    words.length ? [...visible].sort((a, b) => +!inTitle(a) - +!inTitle(b)) : visible,
  );
  const inPanel = (id: PanelId) => visible.filter((e) => e.panel === id);
  const inGroup = (id: PanelId, group: string) => visible.filter((e) => e.panel === id && e.group === group);
  /** Panels with sub-headings show them once they hold more than a handful of tools. */
  const SUBHEADS_FROM = 7;

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && ranked[0]) ranked[0].open();
    if (e.key === 'Escape') query = '';
  }

  function saveChoice(keys: string[]) {
    const isDefault = keys.length === PRESETS[0].keys.length && PRESETS[0].keys.every((k) => keys.includes(k));
    chosen = isDefault ? null : keys;
    saveDashboard(chosen);
    showAll = false;
    customizing = false;
  }

  // Page-wide shortcuts and drop target, active while the home page is shown.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing && !customizing) {
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
    <a class="tool" href={e.href} title={warn ? `${e.description}\n\n⚠ ${e.demanding}` : e.description}>
      <span class="icon" aria-hidden="true">{e.icon}</span>
      <span class="text">
        <span class="title">{e.title}{#if warn}<span class="heavy" aria-label="May be slow on this device">⚠</span>{/if}</span>
        <span class="desc">{e.description}</span>
      </span>
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

{#snippet panel(id: PanelId)}
  {@const p = PANELS.find((x) => x.id === id)!}
  {@const items = inPanel(id)}
  {#if items.length}
    {@const subheads = p.groups && items.length >= SUBHEADS_FROM}
    <section class="panel card" class:wide={subheads}>
      <h2>
        <span><span aria-hidden="true">{p.icon}</span> {p.label}</span>
        {#if p.href && !filtering}<a class="all" href={p.href}>{p.more} →</a>{/if}
      </h2>
      {#if subheads}
        <div class="groups">
          {#each p.groups! as g (g.id)}
            {@const sub = inGroup(id, g.id)}
            {#if sub.length}
              <div class="group">
                <h3>{g.label}</h3>
                {#each sub as e (e.key)}{@render row(e)}{/each}
              </div>
            {/if}
          {/each}
        </div>
      {:else}
        <div class="group">
          {#each items as e (e.key)}{@render row(e)}{/each}
        </div>
      {/if}
    </section>
  {/if}
{/snippet}

<section class="hero">
  {#if dashboard}
    <h1>Your everyday tools</h1>
    <p class="muted">The tools you use most, from every section. Customize them at the bottom; search finds any tool.</p>
  {:else}
    <h1>Every PDF and image tool, right in your browser</h1>
    <p class="muted">Free and private: files are processed on your device and never uploaded.</p>
  {/if}
</section>

<div class="bar">
  <input
    bind:this={search}
    class="search"
    type="search"
    placeholder="Search all tools, e.g. “compress” or “json”"
    aria-label="Search all tools"
    bind:value={query}
    onkeydown={onSearchKey}
  />
  <input bind:this={picker} type="file" multiple accept="application/pdf,image/*,video/*" hidden onchange={(e) => (dropped = [...(e.currentTarget.files ?? [])])} />
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
  {#if inPanel('pdf').length}
    {@render panel('pdf')}
  {/if}
  {#if inPanel('image').length || inPanel('more').length}
    <div class="side">
      {@render panel('image')}
      {@render panel('more')}
    </div>
  {/if}
</div>
{#if inPanel('video').length || inPanel('it').length}
  <div class="panels pair">
    {@render panel('video')}
    {@render panel('it')}
  </div>
{/if}

{#if visible.length === 0}
  {#if filtering}
    <p class="empty muted">No tools match. Try another word{dropped.length ? ', or clear the file' : ''}.</p>
  {:else}
    <p class="empty muted">Your dashboard is empty. Customize it below, or search for any tool.</p>
  {/if}
{/if}

{#if dashboard && !filtering}
  <div class="customize">
    <button class="btn" onclick={() => (customizing = true)}>⚙️ Customize dashboard</button>
    <button class="btn" onclick={() => (showAll = !showAll)} aria-pressed={showAll}>
      {showAll ? '⭐ Show my dashboard' : `🧰 Show all ${tools.length} tools`}
    </button>
  </div>
{/if}

{#if customizing}
  <DashboardDialog
    panels={PANELS.map((p) => ({ id: p.id, icon: p.icon, label: p.label, tools: tools.filter((e) => e.panel === p.id) }))}
    selected={[...shownKeys]}
    presets={PRESETS}
    onSave={saveChoice}
    onClose={() => (customizing = false)}
  />
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
  .pair {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    margin-top: 16px;
  }
  h2 {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    font-size: 15px;
    margin: 0 6px 6px;
    letter-spacing: -0.01em;
  }
  .all {
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .all:hover {
    text-decoration: underline;
  }
  .customize {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 24px;
  }
  .customize .btn {
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 14px;
  }
  .groups {
    columns: 2 220px;
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
    .panels,
    .pair {
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
