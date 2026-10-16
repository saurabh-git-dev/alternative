<!--
  Results view: download buttons, before/after sizes, and a side-by-side
  comparison for images that came from images (e.g. compression).
-->
<script lang="ts">
  import type { FileData, OutputFile } from '../../core/types';
  import { download, formatBytes, toBlob, zipFiles } from '../../core/files';
  import CompareSlider from './CompareSlider.svelte';

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
  let zipping = $state(false);

  const totalIn = $derived(
    results.every((r) => r.inputIndex !== undefined)
      ? results.reduce((s, r) => s + (r.inputSize ?? 0), 0)
      : (results[0]?.inputSize ?? 0),
  );
  const totalOut = $derived(results.reduce((s, r) => s + r.bytes.length, 0));
  const oneToOne = $derived(results.every((r) => r.inputIndex !== undefined) && new Set(results.map((r) => r.inputIndex)).size === results.length);
  const saved = $derived(oneToOne && totalIn > 0 ? 1 - totalOut / totalIn : null);

  async function downloadAll() {
    zipping = true;
    try {
      download(await zipFiles(results), 'formatter-results.zip');
    } finally {
      zipping = false;
    }
  }

  function delta(r: OutputFile): string | null {
    if (!oneToOne || !r.inputSize) return null;
    const change = r.bytes.length / r.inputSize - 1;
    if (Math.abs(change) < 0.005) return 'same size';
    return `${change < 0 ? '−' : '+'}${Math.abs(Math.round(change * 100))}%`;
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
    {/if}
  </div>
</div>

<ul class="list">
  {#each results as r, i (i)}
    <li class="card">
      <div class="thumb">
        {#if r.type.startsWith('image/')}
          <img src={urls[i]} alt="" loading="lazy" />
        {:else}
          <span>{r.name.split('.').pop()?.toUpperCase()}</span>
        {/if}
      </div>
      <div class="meta">
        <div class="name" title={r.name}>{r.name}</div>
        <div class="muted small">
          {#if oneToOne && r.inputSize}{formatBytes(r.inputSize)} →{" "}{/if}{formatBytes(r.bytes.length)}
          {#if delta(r)}<span class:good={r.bytes.length < (r.inputSize ?? 0)}> ({delta(r)})</span>{/if}
        </div>
        {#if r.note}<div class="note small">{r.note}</div>{/if}
      </div>
      {#if canCompare(r)}
        <button class="btn" onclick={() => (comparing = i)}>Compare</button>
      {/if}
      {#if r.type === 'application/pdf'}
        <a class="btn" href={urls[i]} target="_blank" rel="noopener">Open</a>
      {/if}
      <button class="btn" onclick={() => download(toBlob(r), r.name)}>Download</button>
    </li>
  {/each}
</ul>

<div class="after">
  <button class="btn" onclick={onBack}>← Change settings and run again</button>
  <button class="btn" onclick={onReset}>Start over with new files</button>
  <a class="btn" href="#/">Use another tool</a>
</div>

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
