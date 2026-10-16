<!--
  Crop box editor on the first image: drag inside to move, corners to resize,
  or pick an aspect ratio. The box is stored in fractions so it can be
  applied to every image in a batch.
-->
<script lang="ts">
  import type { Box } from '../../core/types';
  import { dragBox, type Handle } from './BoxDrag';

  let { src, box, onChange }: { src: string; box: Box; onChange: (box: Box) => void } = $props();

  let stage = $state<HTMLElement>();
  let natural = $state({ w: 0, h: 0 });
  let ratio = $state<number | null>(null);

  const RATIOS: [string, number | null][] = [
    ['Free', null],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:2', 3 / 2],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:5', 4 / 5],
  ];

  function setRatio(r: number | null) {
    ratio = r;
    if (!r || !natural.w) return;
    // Largest centred box with this ratio.
    const imgRatio = natural.w / natural.h;
    let w = 1, h = 1;
    if (r > imgRatio) h = imgRatio / r;
    else w = r / imgRatio;
    onChange({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }

  function start(e: PointerEvent, handle: Handle) {
    dragBox(stage!, e, box, handle, onChange, ratio ?? undefined);
  }

  const px = $derived(natural.w ? `${Math.round(box.w * natural.w)} × ${Math.round(box.h * natural.h)} px` : '');
</script>

<div class="toolbar">
  {#each RATIOS as [label, r] (label)}
    <button class="chip" class:active={ratio === r} onclick={() => setRatio(r)}>{label}</button>
  {/each}
  <span class="size muted">{px}</span>
  <button class="chip" onclick={() => { ratio = null; onChange({ x: 0, y: 0, w: 1, h: 1 }); }}>Reset</button>
</div>

<div class="stage-wrap">
  <div class="stage" bind:this={stage}>
    <img {src} alt="" draggable="false" onload={(e) => {
      const img = e.currentTarget as HTMLImageElement;
      natural = { w: img.naturalWidth, h: img.naturalHeight };
    }} />
    <div
      class="crop"
      role="application"
      aria-label="Crop area"
      style="left:{box.x * 100}%;top:{box.y * 100}%;width:{box.w * 100}%;height:{box.h * 100}%"
      onpointerdown={(e) => start(e, 'move')}
    >
      <span class="grid"></span>
      {#each ['nw', 'ne', 'sw', 'se'] as h (h)}
        <span class="handle {h}" role="presentation" onpointerdown={(e) => start(e, h as Handle)}></span>
      {/each}
    </div>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chip {
    padding: 5px 12px;
    border-radius: 99px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 13.5px;
    font-weight: 550;
  }
  .chip.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .size {
    margin-left: auto;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .stage-wrap {
    display: grid;
    place-items: center;
    padding: 16px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .stage {
    position: relative;
    touch-action: none;
    user-select: none;
    overflow: hidden; /* clips the dimming shadow around the crop box */
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 65vh;
  }
  .crop {
    position: absolute;
    cursor: move;
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 55%);
    outline: 2px solid white;
  }
  .grid {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to right, transparent 33.2%, rgb(255 255 255 / 40%) 33.3%, transparent 33.4%, transparent 66.5%, rgb(255 255 255 / 40%) 66.6%, transparent 66.7%),
      linear-gradient(to bottom, transparent 33.2%, rgb(255 255 255 / 40%) 33.3%, transparent 33.4%, transparent 66.5%, rgb(255 255 255 / 40%) 66.6%, transparent 66.7%);
    pointer-events: none;
  }
  .handle {
    position: absolute;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
  }
  .nw { left: -8px; top: -8px; cursor: nwse-resize; }
  .ne { right: -8px; top: -8px; cursor: nesw-resize; }
  .sw { left: -8px; bottom: -8px; cursor: nesw-resize; }
  .se { right: -8px; bottom: -8px; cursor: nwse-resize; }
</style>
