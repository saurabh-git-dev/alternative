<!--
  Full-screen PDF viewer: every page, rendered as you scroll (MuPDF in the
  preview worker), with zoom and a page counter. Works the same on phones,
  where browsers often can't show PDFs themselves (Android Chrome only
  downloads them). "Browser viewer" opens the browser's own viewer, which
  can search and select text, where there is one.
-->
<script lang="ts">
  import { inspectPdf, pdfThumbnails } from '../../core/runner';
  import { download } from '../../core/files';

  let { file, onClose }: { file: File; onClose: () => void } = $props();

  const ZOOMS = [1, 1.5, 2, 3];
  let zoom = $state(1);
  let count = $state(0);
  let error = $state('');
  let current = $state(1);
  /** Rendered page images, by page number, with the zoom they were drawn at. */
  let images = $state<Record<number, { url: string; zoom: number }>>({});
  let bytes: Uint8Array | null = null;
  let scroller: HTMLDivElement;

  const url = $derived(URL.createObjectURL(file));
  /** Pixel width to draw pages at: the on-screen width, sharp on high-density screens. */
  function renderWidth(z: number): number {
    const shown = Math.min(900, (scroller?.clientWidth || innerWidth) - 16) * z;
    return Math.round(Math.min(3000, shown * (devicePixelRatio || 1)));
  }

  $effect(() => {
    let alive = true;
    file.arrayBuffer().then(async (buf) => {
      bytes = new Uint8Array(buf);
      const info = await inspectPdf(bytes);
      if (!alive) return;
      if (info.encrypted) error = 'This PDF is password-protected. Unlock it first to view it here.';
      else count = info.pageCount;
    }).catch(() => alive && (error = "This PDF couldn't be opened."));
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
      for (const { url: u } of Object.values(images)) URL.revokeObjectURL(u);
    };
  });

  // Render pages as they come into view, one at a time, at the current zoom.
  const queue = new Set<number>();
  let rendering = false;
  async function pump() {
    if (rendering || !bytes) return;
    rendering = true;
    try {
      while (queue.size) {
        const page = Math.min(...queue);
        queue.delete(page);
        if (images[page]?.zoom === zoom) continue;
        const z = zoom;
        const [img] = await pdfThumbnails(bytes, [page], renderWidth(z));
        const old = images[page];
        images[page] = { url: img, zoom: z };
        if (old) URL.revokeObjectURL(old.url);
      }
    } catch {
      error = 'Some pages could not be drawn.';
    } finally {
      rendering = false;
    }
  }

  function watch(node: HTMLElement, page: number) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        queue.add(page);
        pump();
      },
      { root: scroller, rootMargin: '600px 0px' },
    );
    observer.observe(node);
    const counter = new IntersectionObserver(([entry]) => entry.isIntersecting && (current = page), { root: scroller, threshold: 0.5 });
    counter.observe(node);
    return { destroy: () => (observer.disconnect(), counter.disconnect()) };
  }

  // Re-render visible pages after zooming.
  $effect(() => {
    void zoom;
    for (const p of [current - 1, current, current + 1, current + 2]) if (p >= 1 && p <= count) queue.add(p);
    pump();
  });

  $effect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  });
</script>

<div class="viewer" role="dialog" aria-modal="true" aria-label="PDF viewer">
  <div class="bar">
    <strong class="name" title={file.name}>{file.name}</strong>
    {#if count}<span class="muted small">{current} / {count}</span>{/if}
    <span class="spacer"></span>
    <button class="btn" aria-label="Zoom out" disabled={zoom === ZOOMS[0]} onclick={() => (zoom = ZOOMS[ZOOMS.indexOf(zoom) - 1])}>−</button>
    <span class="small zoom">{Math.round(zoom * 100)}%</span>
    <button class="btn" aria-label="Zoom in" disabled={zoom === ZOOMS.at(-1)} onclick={() => (zoom = ZOOMS[ZOOMS.indexOf(zoom) + 1])}>+</button>
    <a class="btn hide-phone" href={url} target="_blank" rel="noopener">Browser viewer</a>
    <button class="btn" onclick={() => download(file, file.name)} aria-label="Download">⬇</button>
    <button class="btn" onclick={onClose} aria-label="Close">✕</button>
  </div>
  <div class="pages" bind:this={scroller}>
    {#if error}<p class="error">{error}</p>{/if}
    {#each Array.from({ length: count }, (_, i) => i + 1) as page (page)}
      <div class="page" style:width="calc(min(900px, 100%) * {zoom})" use:watch={page}>
        {#if images[page]}
          <img src={images[page].url} alt="Page {page}" />
        {:else}
          <div class="placeholder"><span class="muted">Page {page}</span></div>
        {/if}
      </div>
    {:else}
      {#if !error}<p class="muted loading">Opening…</p>{/if}
    {/each}
  </div>
</div>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--bg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .zoom {
    min-width: 42px;
    text-align: center;
  }
  .bar .btn {
    padding: 6px 10px;
    text-decoration: none;
    white-space: nowrap;
  }
  .pages {
    overflow: auto;
    padding: 16px;
  }
  .page {
    margin: 0 auto 14px;
  }
  .page img,
  .placeholder {
    display: block;
    width: 100%;
    background: white;
    box-shadow: var(--shadow);
  }
  .placeholder {
    aspect-ratio: 1 / 1.414;
    display: grid;
    place-items: center;
  }
  .error {
    color: var(--danger);
  }
  .loading {
    margin-top: 40px;
  }
  .small {
    font-size: 13px;
  }
  @media (max-width: 560px) {
    .hide-phone {
      display: none;
    }
    .pages {
      padding: 8px;
    }
  }
</style>
