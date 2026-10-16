<!--
  Sign workflow: create a signature, then place it on pages. Each placement
  can be dragged and resized; "Place on this page" adds another copy.
-->
<script lang="ts">
  import type { SignatureValue } from '../../core/types';
  import PdfPageView from './PdfPageView.svelte';
  import SignaturePad from './SignaturePad.svelte';
  import { dragBox, type Handle } from './BoxDrag';

  let {
    bytes,
    pageCount,
    value,
    onChange,
  }: { bytes: Uint8Array; pageCount: number; value: SignatureValue; onChange: (v: SignatureValue) => void } = $props();

  let page = $state(1);
  let aspect = $state(3);
  let surface = $state<HTMLElement>();

  let loadedAspect = $state(false);
  $effect(() => {
    loadedAspect = false;
    if (!value.image) return;
    const img = new Image();
    img.onload = () => {
      aspect = img.width / img.height;
      loadedAspect = true;
    };
    img.src = value.image;
  });

  // Place a new signature once automatically (bottom-right of the current page)
  // as soon as both the page and the signature's proportions are known.
  $effect(() => {
    if (!(value.image && loadedAspect && surface && value.placements.length === 0)) return;
    // Retry each frame until the page image has been laid out.
    let id = 0;
    const attempt = () => {
      if (!place()) id = requestAnimationFrame(attempt);
    };
    id = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(id);
  });

  function create(image: string) {
    onChange({ image, placements: [] });
  }

  /** Add a placement on the current page; false if the page isn't laid out yet. */
  function place(): boolean {
    if (!surface) return false;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(aspect)) return false;
    const w = 0.28;
    const h = (w * rect.width) / aspect / rect.height;
    onChange({ ...value, placements: [...value.placements, { page, x: 0.62, y: Math.max(0, 0.86 - h), w, h }] });
    return true;
  }

  function start(e: PointerEvent, index: number, handle: Handle) {
    dragBox(surface!, e, value.placements[index], handle, (box) => {
      const placements = value.placements.map((p, i) => (i === index ? { ...p, ...box } : p));
      onChange({ ...value, placements });
    }, aspect);
  }
</script>

{#if !value.image}
  <SignaturePad onCreate={create} />
{:else}
  <PdfPageView {bytes} {pageCount} bind:page>
    {#snippet toolbar()}
      <button class="btn" onclick={place}>＋ Place on this page</button>
      <button class="btn" onclick={() => onChange({ image: '', placements: [] })}>New signature</button>
    {/snippet}
    {#snippet overlay(current)}
      <div class="surface" bind:this={surface}>
        {#each value.placements as p, i (i)}
          {#if p.page === current}
            <div
              class="sig"
              role="button"
              tabindex="0"
              aria-label="Signature, drag to move"
              style="left:{p.x * 100}%;top:{p.y * 100}%;width:{p.w * 100}%;height:{p.h * 100}%"
              onpointerdown={(e) => start(e, i, 'move')}
            >
              <img src={value.image} alt="" draggable="false" />
              <button
                class="remove"
                aria-label="Remove signature"
                onpointerdown={(e) => e.stopPropagation()}
                onclick={() => onChange({ ...value, placements: value.placements.filter((_, j) => j !== i) })}>✕</button
              >
              <span class="handle" role="presentation" onpointerdown={(e) => start(e, i, 'se')}></span>
            </div>
          {/if}
        {/each}
      </div>
    {/snippet}
  </PdfPageView>
  <p class="hint muted">Drag the signature into place and pull the corner to resize it. Placed {value.placements.length} time{value.placements.length === 1 ? '' : 's'}.</p>
{/if}

<style>
  .surface {
    position: absolute;
    inset: 0;
    touch-action: none;
  }
  .sig {
    position: absolute;
    cursor: move;
    outline: 1.5px dashed var(--accent);
  }
  .sig img {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  .remove {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: white;
    font-size: 11px;
  }
  .handle {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--accent);
    cursor: nwse-resize;
  }
  .hint {
    margin: 0;
    font-size: 14px;
  }
</style>
