<!--
  Home: searchable grid of tools, grouped by category.
  Dropping files anywhere on the page filters the grid to tools that accept
  them; picking a tool then opens it with those files already loaded.
-->
<script lang="ts">
  import { ACTIONS, CATEGORIES } from '../../actions';
  import { accepts, detectType } from '../../core/files';
  import Dropzone from '../components/Dropzone.svelte';
  import { readFile } from '../../core/files';
  import { handoff } from '../handoff.svelte';
  import { PIPELINE_ROUTE, encodePipeline } from '../../core/pipeline';
  import { loadPipelines } from '../settings';

  const pipelines = loadPipelines();

  /**
   * Tools that are pages of their own rather than actions (their result is a
   * view, not a file). They are listed in their category alongside actions.
   */
  const PAGES = [
    {
      href: '#/compare',
      icon: '🔀',
      title: 'Compare PDFs',
      description: 'See what changed between two versions, word by word and on the page.',
      category: 'pdf-edit',
      accepts: 'application/pdf',
    },
  ];

  let { onOpen }: { onOpen: (id: string, files?: File[]) => void } = $props();

  let query = $state('');
  let dropped = $state<File[]>([]);

  /** Share isn't an action (its output is a link, not a file), so it is listed here. */
  const showShare = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return (!q || 'share as link or qr code send to phone'.includes(q)) && dropped.length <= 1;
  });
  const showAutomate = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return !dropped.length && (!q || 'pipeline automate chain batch recipe'.includes(q) || pipelines.some((p) => p.name.toLowerCase().includes(q)));
  });

  function matchesPage(p: (typeof PAGES)[number]): boolean {
    const q = query.trim().toLowerCase();
    return (!q || `${p.title} ${p.description}`.toLowerCase().includes(q)) && dropped.every((f) => detectType(f) === p.accepts);
  }

  async function openShare() {
    handoff.file = dropped[0] ? await readFile(dropped[0]) : null;
    location.hash = '#/share';
  }

  const visible = $derived(
    ACTIONS.filter((a) => {
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || `${a.title} ${a.description}`.toLowerCase().includes(q);
      const matchesFiles = dropped.length === 0 || dropped.every((f) => accepts(a, detectType(f)));
      return matchesQuery && matchesFiles;
    }),
  );
</script>

<section class="hero">
  <h1>Every PDF and image tool, right in your browser</h1>
  <p class="muted">Merge, split, compress, convert and more. Fast, free, and private: your files are processed on your device and never uploaded.</p>
  <input class="search" type="search" placeholder="Search tools, e.g. “compress”" bind:value={query} aria-label="Search tools" />
</section>

<div class="drop">
  {#if dropped.length}
    <div class="dropped card">
      <span>
        <strong>{dropped.length} file{dropped.length > 1 ? 's' : ''} ready.</strong>
        <span class="muted">Pick what to do with {dropped.length > 1 ? 'them' : 'it'} below.</span>
      </span>
      <button class="btn" onclick={() => (dropped = [])}>Clear</button>
    </div>
  {:else}
    <Dropzone compact accept="application/pdf,image/*" label="Not sure which tool? Drop a file here to see what you can do with it." onFiles={(f) => (dropped = f)} />
  {/if}
</div>

{#if showShare}
  <section class="group">
    <h2>Share</h2>
    <div class="grid">
      <button class="tool card" onclick={openShare}>
        <span class="icon" aria-hidden="true">🔗</span>
        <span class="title">Share as link or QR</span>
        <span class="desc muted">Put a small file or text into a link and QR code, then open it on your phone.</span>
      </button>
    </div>
  </section>
{/if}

{#if showAutomate}
  <section class="group">
    <h2>Automate</h2>
    <div class="grid">
      <a class="tool card" href={PIPELINE_ROUTE}>
        <span class="icon" aria-hidden="true">⛓️</span>
        <span class="title">Build a pipeline</span>
        <span class="desc muted">Chain tools and run them in one go, e.g. photos → PDF → OCR → compress.</span>
      </a>
      {#each pipelines as p (p.name)}
        <a class="tool card" href={`${PIPELINE_ROUTE}/${encodePipeline(p)}`}>
          <span class="icon" aria-hidden="true">▶️</span>
          <span class="title">{p.name}</span>
          <span class="desc muted">{p.steps.length} steps · your pipeline</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

{#each CATEGORIES as category (category.id)}
  {@const tools = visible.filter((a) => a.category === category.id)}
  {@const pages = PAGES.filter((p) => p.category === category.id && matchesPage(p))}
  {#if tools.length || pages.length}
    <section class="group">
      <h2>{category.label}</h2>
      <div class="grid">
        {#each pages as p (p.href)}
          <a class="tool card" href={p.href}>
            <span class="icon" aria-hidden="true">{p.icon}</span>
            <span class="title">{p.title}</span>
            <span class="desc muted">{p.description}</span>
          </a>
        {/each}
        {#each tools as tool (tool.id)}
          <button class="tool card" onclick={() => onOpen(tool.id, dropped)}>
            <span class="icon" aria-hidden="true">{tool.icon}</span>
            <span class="title">{tool.title}</span>
            <span class="desc muted">{tool.description}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}
{/each}

{#if visible.length === 0}
  <p class="empty muted">No tools match. Try another word, or clear the dropped files.</p>
{/if}

<style>
  .hero {
    text-align: center;
    padding: 24px 0 8px;
  }
  h1 {
    font-size: clamp(26px, 4vw, 38px);
    line-height: 1.15;
    margin: 0 0 12px;
    letter-spacing: -0.02em;
  }
  .hero p {
    max-width: 620px;
    margin: 0 auto 20px;
    font-size: 16px;
  }
  .search {
    width: min(520px, 100%);
    padding: 12px 16px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .drop {
    margin: 20px 0 8px;
  }
  .dropped {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-color: var(--accent);
  }
  .group h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
    margin: 28px 0 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 14px;
  }
  .tool {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 14px;
    text-align: left;
    padding: 18px;
    transition: transform 0.12s, border-color 0.12s;
  }
  a.tool {
    text-decoration: none;
    color: inherit;
  }
  .tool:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .icon {
    grid-row: span 2;
    font-size: 28px;
    line-height: 1;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--accent-soft);
  }
  .title {
    font-weight: 650;
    font-size: 16px;
  }
  .desc {
    font-size: 13.5px;
  }
  .empty {
    text-align: center;
    margin-top: 40px;
  }
</style>
