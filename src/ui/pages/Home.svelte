<!--
  Home: searchable grid of tools, grouped by category.
  Dropping files anywhere on the page filters the grid to tools that accept
  them; picking a tool then opens it with those files already loaded.
-->
<script lang="ts">
  import { ACTIONS, CATEGORIES } from '../../actions';
  import { accepts, detectType } from '../../core/files';
  import Dropzone from '../components/Dropzone.svelte';

  let { onOpen }: { onOpen: (id: string, files?: File[]) => void } = $props();

  let query = $state('');
  let dropped = $state<File[]>([]);

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

{#each CATEGORIES as category (category.id)}
  {@const tools = visible.filter((a) => a.category === category.id)}
  {#if tools.length}
    <section class="group">
      <h2>{category.label}</h2>
      <div class="grid">
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
