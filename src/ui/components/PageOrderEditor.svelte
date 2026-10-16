<!--
  Visual page editor: thumbnails that can be dragged to reorder, rotated,
  duplicated or deleted. Emits the new order as `{ page, rotate }[]`.
  Thumbnails render in the background preview worker, in small batches so the
  first pages appear quickly even for long documents.
-->
<script lang="ts">
  import type { PageRef } from '../../core/types';
  import { pdfThumbnails } from '../../core/runner';

  let {
    bytes,
    pageCount,
    order,
    onChange,
  }: { bytes: Uint8Array; pageCount: number; order: PageRef[]; onChange: (order: PageRef[]) => void } = $props();

  let thumbs = $state<Record<number, string>>({});
  let dragging = $state<number | null>(null);

  $effect(() => {
    let stopped = false;
    const urls: string[] = [];
    (async () => {
      const BATCH = 8;
      for (let start = 1; start <= pageCount && !stopped; start += BATCH) {
        const pages = Array.from({ length: Math.min(BATCH, pageCount - start + 1) }, (_, i) => start + i);
        const result = await pdfThumbnails(bytes, pages, 180);
        if (stopped) {
          result.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        pages.forEach((p, i) => (thumbs[p] = result[i]));
        urls.push(...result);
      }
    })();
    return () => {
      stopped = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  });

  function update(fn: (next: PageRef[]) => void) {
    const next = order.map((p) => ({ ...p }));
    fn(next);
    onChange(next);
  }

  const rotateAll = () => update((n) => n.forEach((p) => (p.rotate = (p.rotate + 90) % 360)));
  const reverse = () => update((n) => n.reverse());
  const restore = () => onChange(Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, rotate: 0 })));
</script>

<div class="toolbar">
  <span class="muted">{order.length} page{order.length === 1 ? '' : 's'}</span>
  <button class="btn" onclick={rotateAll}>↻ Rotate all</button>
  <button class="btn" onclick={reverse}>⇅ Reverse</button>
  <button class="btn" onclick={restore}>↺ Restore</button>
</div>

<div class="pages">
  {#each order as ref, i (`${ref.page}-${i}`)}
    <div
      class="page card"
      class:dragging={dragging === i}
      draggable="true"
      role="listitem"
      ondragstart={() => (dragging = i)}
      ondragend={() => (dragging = null)}
      ondragover={(e) => {
        e.preventDefault();
        if (dragging !== null && dragging !== i) {
          const from = dragging;
          update((n) => n.splice(i, 0, n.splice(from, 1)[0]));
          dragging = i;
        }
      }}
    >
      <div class="frame">
        {#if thumbs[ref.page]}
          <img src={thumbs[ref.page]} alt="Page {ref.page}" style="transform: rotate({ref.rotate}deg)" draggable="false" />
        {:else}
          <div class="placeholder"></div>
        {/if}
      </div>
      <div class="actions">
        <button class="icon-btn" aria-label="Rotate page" onclick={() => update((n) => (n[i].rotate = (n[i].rotate + 90) % 360))}>↻</button>
        <button class="icon-btn" aria-label="Duplicate page" onclick={() => update((n) => n.splice(i + 1, 0, { ...n[i] }))}>⧉</button>
        <button class="icon-btn" aria-label="Delete page" onclick={() => update((n) => n.splice(i, 1))}>🗑</button>
      </div>
      <div class="num muted">{ref.page}</div>
    </div>
  {/each}
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .toolbar span {
    margin-right: auto;
    font-size: 14px;
  }
  .toolbar .btn {
    padding: 6px 12px;
    font-size: 13.5px;
  }
  .pages {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 12px;
  }
  .page {
    padding: 8px;
    box-shadow: none;
    cursor: grab;
    position: relative;
  }
  .page.dragging {
    opacity: 0.4;
    border-color: var(--accent);
  }
  .frame {
    aspect-ratio: 3 / 4;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 6px;
    background: var(--surface-2);
  }
  img {
    max-width: 100%;
    max-height: 100%;
    background: white;
    box-shadow: 0 1px 3px rgb(0 0 0 / 15%);
    transition: transform 0.2s;
  }
  .placeholder {
    width: 70%;
    height: 85%;
    background: var(--border);
    border-radius: 3px;
    animation: pulse 1.2s infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.5;
    }
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 2px;
    margin-top: 6px;
  }
  .num {
    position: absolute;
    top: 12px;
    left: 12px;
    font-size: 11px;
    font-weight: 700;
    background: var(--surface);
    padding: 0 6px;
    border-radius: 99px;
  }
</style>
