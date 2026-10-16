<!--
  Draw boxes on PDF pages (used by Redact). Drag on the page to add a box;
  click a box's ✕ to remove it. Boxes are stored in fractions of the page.
-->
<script lang="ts">
  import type { Box, PageBox } from '../../core/types';
  import PdfPageView from './PdfPageView.svelte';
  import { drawBox } from './BoxDrag';

  let {
    bytes,
    pageCount,
    regions,
    onChange,
  }: { bytes: Uint8Array; pageCount: number; regions: PageBox[]; onChange: (regions: PageBox[]) => void } = $props();

  let page = $state(1);
  let drafting = $state<Box | null>(null);
</script>

<p class="hint muted">Drag on the page to cover anything you want removed. Use the arrows to move between pages.</p>

<PdfPageView {bytes} {pageCount} bind:page>
  {#snippet toolbar()}
    <span class="muted count">{regions.length} area{regions.length === 1 ? '' : 's'} marked</span>
    {#if regions.length}
      <button class="btn" onclick={() => onChange([])}>Clear all</button>
    {/if}
  {/snippet}
  {#snippet overlay(current)}
    <div
      class="surface"
      role="application"
      aria-label="Draw redaction boxes"
      onpointerdown={(e) =>
        drawBox(
          e.currentTarget as HTMLElement,
          e,
          (b) => (drafting = b),
          (b) => {
            drafting = null;
            if (b.w > 0.005 && b.h > 0.005) onChange([...regions, { ...b, page: current }]);
          },
        )}
    >
      {#each regions as r, i (i)}
        {#if r.page === current}
          <div class="box" style="left:{r.x * 100}%;top:{r.y * 100}%;width:{r.w * 100}%;height:{r.h * 100}%">
            <button
              class="remove"
              aria-label="Remove box"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => onChange(regions.filter((_, j) => j !== i))}>✕</button
            >
          </div>
        {/if}
      {/each}
      {#if drafting}
        <div class="box draft" style="left:{drafting.x * 100}%;top:{drafting.y * 100}%;width:{drafting.w * 100}%;height:{drafting.h * 100}%"></div>
      {/if}
    </div>
  {/snippet}
</PdfPageView>

<style>
  .hint {
    margin: 0;
    font-size: 14px;
  }
  .count {
    font-size: 14px;
  }
  .surface {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
  }
  .box {
    position: absolute;
    background: rgb(0 0 0 / 75%);
    outline: 2px solid #e11d48;
  }
  .box.draft {
    background: rgb(225 29 72 / 25%);
  }
  .remove {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    background: #e11d48;
    color: white;
    font-size: 11px;
    line-height: 1;
    display: grid;
    place-items: center;
  }
</style>
