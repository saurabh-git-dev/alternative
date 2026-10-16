<!--
  Live preview for image tools: re-runs the action on a downscaled copy of
  the first image whenever settings change (debounced). Hold the
  "Original" button to compare.
-->
<script lang="ts">
  import type { FileData, ParamValues } from '../../core/types';
  import { livePreview } from '../../core/runner';
  import { toBlob } from '../../core/files';

  let { actionId, file, values }: { actionId: string; file: FileData; values: ParamValues } = $props();

  let url = $state<string | null>(null);
  let originalUrl = $derived(URL.createObjectURL(toBlob(file)));
  let busy = $state(false);
  let showOriginal = $state(false);

  $effect(() => {
    const params = $state.snapshot(values) as ParamValues;
    const timer = setTimeout(async () => {
      busy = true;
      try {
        const out = await livePreview(actionId, file, params);
        if (out) {
          if (url) URL.revokeObjectURL(url);
          url = URL.createObjectURL(toBlob(out));
        }
      } catch {
        /* invalid intermediate settings: keep the last good preview */
      } finally {
        busy = false;
      }
    }, 220);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const u = originalUrl;
    return () => URL.revokeObjectURL(u);
  });
</script>

<div class="preview">
  <img src={showOriginal ? originalUrl : (url ?? originalUrl)} alt="Preview" draggable="false" class:busy />
  <button
    class="btn compare"
    onpointerdown={() => (showOriginal = true)}
    onpointerup={() => (showOriginal = false)}
    onpointerleave={() => (showOriginal = false)}
  >Hold to see original</button>
  {#if busy}<span class="spinner muted">Updating…</span>{/if}
</div>

<style>
  .preview {
    position: relative;
    display: grid;
    place-items: center;
    padding: 16px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  img {
    max-width: 100%;
    max-height: 60vh;
    border-radius: 6px;
    transition: opacity 0.15s;
  }
  img.busy {
    opacity: 0.85;
  }
  .compare {
    position: absolute;
    bottom: 24px;
    left: 24px;
    padding: 6px 12px;
    font-size: 13px;
    user-select: none;
  }
  .spinner {
    position: absolute;
    top: 22px;
    right: 24px;
    font-size: 13px;
  }
</style>
