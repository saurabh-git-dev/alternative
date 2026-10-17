<!--
  Results view: download buttons, before/after sizes, and a side-by-side
  comparison for images that came from images (e.g. compression).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { FileData, OutputFile } from '../../core/types';
  import { download, formatBytes, toBlob, zipFiles } from '../../core/files';
  import CompareSlider from './CompareSlider.svelte';
  import FilePreview from './FilePreview.svelte';
  import PdfViewer from './PdfViewer.svelte';
  import { fitsQr as fitsOneQr, sendFiles, shareFile } from '../share-target';
  import { isConnected } from '../transfer.svelte';

  let {
    results,
    inputs,
    onReset,
    onBack,
  }: { results: OutputFile[]; inputs: FileData[]; onReset: () => void; onBack: () => void } = $props();

  const urls = $derived(results.map((r) => URL.createObjectURL(toBlob(r))));
  $effect(() => {
    const current = urls;
    return () => current.forEach((u) => URL.revokeObjectURL(u));
  });

  let comparing = $state<number | null>(null);
  let viewing = $state<number | null>(null);

  const isText = (r: OutputFile) => /^text\/|^application\/json$/.test(r.type);
  const asFile = (r: OutputFile) => new File([r.bytes as BlobPart], r.name, { type: r.type });
  /** Text results (e.g. OCR) show their text right away when there are only a few. */
  let showText = $state<Record<number, boolean>>(
    untrack(() => Object.fromEntries(results.flatMap((r, i) => (isText(r) && results.length <= 3 ? [[i, true]] : [])))),
  );
  let copied = $state<number | null>(null);

  async function copyText(r: OutputFile, i: number) {
    await navigator.clipboard.writeText(new TextDecoder().decode(r.bytes));
    copied = i;
    setTimeout(() => (copied = null), 1500);
  }
  let zipping = $state(false);

  const totalIn = $derived(
    results.every((r) => r.inputIndex !== undefined)
      ? results.reduce((s, r) => s + (r.inputSize ?? 0), 0)
      : (results[0]?.inputSize ?? 0),
  );
  const totalOut = $derived(results.reduce((s, r) => s + r.bytes.length, 0));
  const oneToOne = $derived(results.every((r) => r.inputIndex !== undefined) && new Set(results.map((r) => r.inputIndex)).size === results.length);
  /** "x% smaller" only makes sense when the output is the same kind of file (a frame from a video isn't "smaller"). */
  const sameKind = $derived(results.every((r) => r.inputIndex !== undefined && r.type.split('/')[0] === inputs[r.inputIndex]?.type.split('/')[0]));
  const saved = $derived(oneToOne && sameKind && totalIn > 0 ? 1 - totalOut / totalIn : null);

  async function downloadAll() {
    zipping = true;
    try {
      download(await zipFiles(results), 'tools-results.zip');
    } finally {
      zipping = false;
    }
  }

  /** Before → after sizes only compare like with like (not an image with its OCR text). */
  const comparable = (r: OutputFile) => oneToOne && !!r.inputSize && r.type.split('/')[0] === inputs[r.inputIndex!]?.type.split('/')[0];

  function delta(r: OutputFile): string | null {
    if (!comparable(r)) return null;
    const change = r.bytes.length / r.inputSize! - 1;
    if (Math.abs(change) < 0.005) return 'same size';
    return `${change < 0 ? '−' : '+'}${Math.abs(Math.round(change * 100))}%`;
  }

  /** Small files share as a QR code (Share page); bigger ones over a direct, encrypted connection. */
  const fitsQr = $derived(results.map((r) => fitsOneQr(r)));

  function share(r: OutputFile, i: number) {
    shareFile({ name: r.name, type: r.type, bytes: r.bytes }, fitsQr[i]);
  }

  function sendAll() {
    sendFiles(results.map((r) => ({ name: r.name, type: r.type, bytes: r.bytes })));
  }

  function canCompare(r: OutputFile): boolean {
    return r.type.startsWith('image/') && r.inputIndex !== undefined && inputs[r.inputIndex]?.type.startsWith('image/');
  }
</script>

<div class="summary card">
  <div class="done">✓</div>
  <div class="text">
    <h2>Done! {results.length} file{results.length > 1 ? 's are' : ' is'} ready.</h2>
    {#if saved !== null && saved > 0.005}
      <p class="muted">Reduced from {formatBytes(totalIn)} to {formatBytes(totalOut)}: <strong class="good">{Math.round(saved * 100)}% smaller</strong>.</p>
    {:else}
      <p class="muted">Total size {formatBytes(totalOut)}.</p>
    {/if}
  </div>
  <div class="cta">
    {#if results.length === 1}
      <button class="btn btn-primary btn-lg" onclick={() => download(toBlob(results[0]), results[0].name)}>⬇ Download</button>
    {:else}
      <button class="btn btn-primary btn-lg" disabled={zipping} onclick={downloadAll}>{zipping ? 'Zipping…' : '⬇ Download all (ZIP)'}</button>
      <button class="btn btn-lg" title="Send every file to your phone over a direct, encrypted connection" onclick={sendAll}>📡 Send all to phone</button>
    {/if}
  </div>
</div>

{#if results.length === 1 && /^(video|audio)\//.test(results[0].type)}
  <div class="player card">
    {#if results[0].type.startsWith('video/')}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={urls[0]} controls playsinline preload="metadata"></video>
    {:else}
      <audio src={urls[0]} controls preload="metadata"></audio>
    {/if}
  </div>
{/if}

<ul class="list">
  {#each results as r, i (i)}
    <li class="card">
      <div class="thumb">
        {#if r.type.startsWith('image/')}
          <img src={urls[i]} alt="" loading="lazy" />
        {:else if r.type.startsWith('video/')}
          <video src={urls[i]} muted playsinline preload="metadata"></video>
        {:else}
          <span>{r.name.split('.').pop()?.toUpperCase()}</span>
        {/if}
      </div>
      <div class="meta">
        <div class="name" title={r.name}>{r.name}</div>
        <div class="muted small">
          {#if comparable(r)}{formatBytes(r.inputSize!)} →{" "}{/if}{formatBytes(r.bytes.length)}
          {#if delta(r)}<span class:good={r.bytes.length < (r.inputSize ?? 0)}> ({delta(r)})</span>{/if}
        </div>
        {#if r.note}<div class="note small">{r.note}</div>{/if}
      </div>
      {#if canCompare(r)}
        <button class="btn" onclick={() => (comparing = i)}>Compare</button>
      {/if}
      {#if r.type === 'application/pdf'}
        <button class="btn" onclick={() => (viewing = i)}>📖 View</button>
      {/if}
      {#if isText(r)}
        <button class="btn" onclick={() => (showText[i] = !showText[i])}>{showText[i] ? 'Hide text' : 'Show text'}</button>
        <button class="btn" onclick={() => copyText(r, i)}>{copied === i ? '✓ Copied' : 'Copy'}</button>
      {/if}
      <button class="btn" onclick={() => download(toBlob(r), r.name)}>Download</button>
      {#if fitsQr[i] && !isConnected()}
        <button class="btn" title="Small enough for a QR code: scan it with your phone to get the file" onclick={() => share(r, i)}>📱 QR code</button>
      {:else}
        <button class="btn" title="Too big for a QR code: send it to your phone over a direct, encrypted connection" onclick={() => share(r, i)}>📡 Send to phone</button>
      {/if}
      {#if isText(r) && showText[i]}
        <div class="textout"><FilePreview file={asFile(r)} /></div>
      {/if}
    </li>
  {/each}
</ul>

<div class="after">
  <button class="btn" onclick={onBack}>← Change settings and run again</button>
  <button class="btn" onclick={onReset}>Start over with new files</button>
  <a class="btn" href="#/">Use another tool</a>
</div>

{#if viewing !== null}
  <PdfViewer file={asFile(results[viewing])} onClose={() => (viewing = null)} />
{/if}

{#if comparing !== null}
  {@const r = results[comparing]}
  <CompareSlider before={inputs[r.inputIndex!]} after={r} onClose={() => (comparing = null)} />
{/if}

<style>
  .summary {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 22px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }
  .done {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--success-soft);
    color: var(--success);
    font-size: 24px;
    font-weight: 700;
  }
  .text {
    flex: 1;
    min-width: 200px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .text p {
    margin: 2px 0 0;
  }
  .good {
    color: var(--success);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 10px;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    box-shadow: none;
    flex-wrap: wrap;
  }
  li .btn {
    padding: 7px 14px;
    font-size: 14px;
    text-decoration: none;
    color: var(--text);
  }
  .thumb {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface-2);
    font-size: 11px;
    font-weight: 700;
    color: var(--text-3);
  }
  .textout {
    flex-basis: 100%;
    min-width: 0;
  }
  .player {
    display: grid;
    place-items: center;
    padding: 12px;
    margin-bottom: 14px;
  }
  .player video {
    max-width: 100%;
    max-height: 55vh;
    border-radius: var(--radius-sm);
    background: #000;
  }
  .player audio {
    width: 100%;
  }
  .thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .meta {
    flex: 1;
    min-width: 160px;
  }
  .name {
    font-weight: 550;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .small {
    font-size: 13px;
  }
  .note {
    color: var(--warning);
  }
  .after {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 20px;
  }
  .after .btn {
    text-decoration: none;
    color: var(--text);
  }
</style>
