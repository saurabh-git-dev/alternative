<!--
  One PDF page rendered large, with page navigation and an overlay layer.
  The overlay snippet receives the page number and draws in a box that
  exactly covers the page, so children can position themselves in fractions.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { pdfThumbnails } from '../../core/runner';

  let {
    bytes,
    pageCount,
    page = $bindable(1),
    overlay,
    toolbar,
  }: {
    bytes: Uint8Array;
    pageCount: number;
    page?: number;
    overlay?: Snippet<[number]>;
    toolbar?: Snippet;
  } = $props();

  const cache = new Map<number, string>();
  let src = $state<string | null>(null);

  $effect(() => {
    const n = page;
    let stale = false;
    if (cache.has(n)) {
      src = cache.get(n)!;
    } else {
      src = null;
      pdfThumbnails(bytes, [n], 1000).then(([url]) => {
        cache.set(n, url);
        if (!stale) src = url;
      });
    }
    return () => (stale = true);
  });

  $effect(() => () => cache.forEach((u) => URL.revokeObjectURL(u)));
</script>

<div class="viewer">
  <div class="bar">
    <button class="btn" disabled={page <= 1} onclick={() => page--} aria-label="Previous page">‹</button>
    <span class="muted">Page {page} of {pageCount}</span>
    <button class="btn" disabled={page >= pageCount} onclick={() => page++} aria-label="Next page">›</button>
    <span class="spacer"></span>
    {@render toolbar?.()}
  </div>
  <div class="stage">
    {#if src}
      <div class="page">
        <img {src} alt="Page {page}" draggable="false" />
        <div class="overlay">{@render overlay?.(page)}</div>
      </div>
    {:else}
      <div class="loading muted">Rendering page…</div>
    {/if}
  </div>
</div>

<style>
  .viewer {
    display: grid;
    gap: 10px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .bar .btn {
    padding: 6px 12px;
  }
  .spacer {
    flex: 1;
  }
  .stage {
    display: grid;
    place-items: center;
    padding: 16px;
    border-radius: var(--radius);
    background: var(--surface-2);
    min-height: 300px;
  }
  .page {
    position: relative;
    max-width: 100%;
    box-shadow: 0 2px 10px rgb(0 0 0 / 18%);
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 75vh;
    background: white;
    user-select: none;
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
</style>
