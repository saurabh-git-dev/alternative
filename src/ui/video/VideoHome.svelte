<!--
  Video home: every video tool on one screen (see ToolCatalog), plus links
  to the screen recorder and to sharing.

  Pick or drop a video first and the tool you choose opens with it loaded.
-->
<script lang="ts">
  import { VIDEO_ACTIONS, VIDEO_CATEGORIES } from '../../actions';
  import { isConstrained } from '../../core/device';
  import { RECORD_HOME } from '../section';
  import ToolCatalog, { type CatalogEntry } from '../components/ToolCatalog.svelte';
  import { otherSectionTools } from '../other-tools';

  let { onOpen }: { onOpen: (id: string, files?: File[]) => void } = $props();

  let dropped = $state<File[]>([]);
  let dragging = $state(false);
  let picker: HTMLInputElement;
  const constrained = isConstrained();
  const webCodecs = typeof VideoEncoder !== 'undefined';

  const entries: CatalogEntry[] = $derived([
    ...VIDEO_ACTIONS.map(
      (a): CatalogEntry => ({
        key: a.id,
        icon: a.icon,
        title: a.title,
        description: a.description,
        group: a.category,
        href: `#/tool/${a.id}`,
        open: () => onOpen(a.id, dropped),
        warning: constrained ? a.demanding : undefined,
      }),
    ),
    { key: 'record', icon: '⏺️', title: 'Record your screen', description: 'Screen, camera and mic, saved in this browser.', keywords: 'loom capture screencast webcam', group: 'more', href: RECORD_HOME },
    { key: 'connect', icon: '🔗', title: 'Connect a device', description: 'Send videos to and from your phone by QR code, any size, end-to-end encrypted.', keywords: 'transfer share airdrop receive import phone scan', group: 'more', href: '#/connect' },
  ]);
  const GROUPS = [...VIDEO_CATEGORIES, { id: 'more', label: 'Record & share', icon: '✨' }];

  $effect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragging = true;
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) dragging = false;
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragging = false;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) dropped = files;
    };
    addEventListener('dragover', onOver);
    addEventListener('dragleave', onLeave);
    addEventListener('drop', onDrop);
    return () => {
      removeEventListener('dragover', onOver);
      removeEventListener('dragleave', onLeave);
      removeEventListener('drop', onDrop);
    };
  });
</script>

<section class="hero">
  <h1>Video tools, right in your browser</h1>
  <p class="muted">Trim, crop, blur, compress and convert. Videos are processed on your device and never uploaded.</p>
</section>

{#if dropped.length}
  <p class="note muted">Now pick a tool for {dropped.length > 1 ? 'these videos' : 'this video'}.</p>
{/if}
{#if !webCodecs}
  <p class="note muted">This browser has no built-in video encoder (WebCodecs), so tools use ffmpeg.wasm instead: a 32 MB download the first time, and slower.</p>
{/if}

<ToolCatalog {entries} groups={GROUPS} others={otherSectionTools()} placeholder="Search tools, e.g. “compress” or “gif”" label="Search video tools">
  {#snippet extra()}
    <input bind:this={picker} type="file" accept="video/*,.mkv,.avi,.wmv,.flv,.ts,.mts" hidden onchange={(e) => (dropped = [...(e.currentTarget.files ?? [])])} />
    {#if dropped.length}
      <span class="chip" title={dropped.map((f) => f.name).join('\n')}>
        🎬 {dropped.length === 1 ? dropped[0].name : `${dropped.length} videos`}
        <button aria-label="Clear videos" onclick={() => (dropped = [])}>✕</button>
      </span>
    {:else}
      <button class="btn open" onclick={() => picker.click()} title="Pick a video, then a tool">📂 <span>Open a video</span></button>
    {/if}
  {/snippet}
</ToolCatalog>

{#if dragging}
  <div class="dropping" aria-hidden="true"><span>Drop a video, then pick a tool</span></div>
{/if}

<style>
  .hero {
    text-align: center;
    padding: 4px 0 0;
  }
  h1 {
    font-size: clamp(21px, 3vw, 30px);
    line-height: 1.2;
    margin: 0 0 4px;
    letter-spacing: -0.02em;
  }
  .hero p {
    margin: 0;
    font-size: 14.5px;
  }
  .open {
    flex: none;
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 45%;
    padding: 6px 6px 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    font-size: 14px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chip button {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 2px 6px;
  }
  .note {
    text-align: center;
    font-size: 14px;
    margin: 0 0 12px;
  }
  .dropping {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border: 3px dashed var(--accent);
    pointer-events: none;
  }
  .dropping span {
    padding: 12px 20px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    font-weight: 600;
  }
  @media (max-width: 560px) {
    .hero p {
      display: none;
    }
    .open span {
      display: none;
    }
  }
</style>
