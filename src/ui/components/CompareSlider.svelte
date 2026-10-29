<!--
  Before/after comparison overlay, Squoosh-style: drag the divider to reveal
  the original on the left and the result on the right. Scroll or use the
  zoom buttons to inspect detail.
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { formatBytes, toBlob } from '../../core/files';
  import { usePane } from '../pane';

  /** Window-wide shortcuts and drops go to the tab in use only (see pane.ts). */
  const pane = usePane();

  let { before, after, onClose }: { before: FileData; after: FileData; onClose: () => void } = $props();

  const beforeUrl = $derived(URL.createObjectURL(toBlob(before)));
  const afterUrl = $derived(URL.createObjectURL(toBlob(after)));
  $effect(() => {
    const urls = [beforeUrl, afterUrl];
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  });

  let split = $state(50);
  let zoom = $state(1);
  let stage: HTMLDivElement;

  function onPointer(e: PointerEvent) {
    if (e.buttons !== 1 && e.type !== 'pointerdown') return;
    const rect = stage.getBoundingClientRect();
    split = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => pane.active && e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Compare before and after">
  <div class="bar">
    <span><strong>Original</strong> {formatBytes(before.bytes.length)}</span>
    <span class="zoom">
      <button class="btn" onclick={() => (zoom = Math.max(1, zoom / 1.5))}>−</button>
      {Math.round(zoom * 100)}%
      <button class="btn" onclick={() => (zoom = Math.min(8, zoom * 1.5))}>+</button>
    </span>
    <span><strong>Result</strong> {formatBytes(after.bytes.length)}</span>
    <button class="btn close" onclick={onClose}>Close</button>
  </div>
  <div class="scroll">
    <div
      class="stage"
      bind:this={stage}
      style="width: {zoom * 100}%"
      role="slider"
      tabindex="0"
      aria-valuenow={Math.round(split)}
      onpointerdown={onPointer}
      onpointermove={onPointer}
      onkeydown={(e) => {
        if (e.key === 'ArrowLeft') split = Math.max(0, split - 2);
        if (e.key === 'ArrowRight') split = Math.min(100, split + 2);
      }}
    >
      <img src={afterUrl} alt="Result" draggable="false" />
      <img class="before" src={beforeUrl} alt="Original" draggable="false" style="clip-path: inset(0 {100 - split}% 0 0)" />
      <div class="divider" style="left: {split}%"><span>⇔</span></div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgb(10 12 18 / 92%);
    color: white;
    display: grid;
    grid-template-rows: auto 1fr;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    flex-wrap: wrap;
  }
  .bar .btn {
    padding: 4px 12px;
    color: var(--text);
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .scroll {
    overflow: auto;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .stage {
    position: relative;
    max-width: none;
    touch-action: none;
    cursor: ew-resize;
    user-select: none;
  }
  .stage img {
    display: block;
    width: 100%;
    max-height: calc(100vh - 120px);
    object-fit: contain;
  }
  .stage .before {
    position: absolute;
    inset: 0;
    height: 100%;
  }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: white;
    transform: translateX(-1px);
  }
  .divider span {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: white;
    color: black;
  }
</style>
