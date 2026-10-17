<!--
  File checksum: MD5 and SHA hashes of a file, read on this device. Paste the
  checksum a download page lists to see at a glance whether it matches.
-->
<script lang="ts">
  import type { ItToolProps } from '../../../it/types';
  import { HASH_ALGORITHMS, digest, encodeDigest } from '../../../it/lib/hash';
  import { formatBytes } from '../../../core/files';
  import Dropzone from '../../components/Dropzone.svelte';
  import CopyButton from '../CopyButton.svelte';
  import OutputActions from '../OutputActions.svelte';

  // Takes no starting input, but accepts the props every IT tool gets.
  let _props: ItToolProps = $props();

  let file = $state<File | null>(null);
  let rows = $state<{ label: string; value: string }[]>([]);
  let busy = $state(false);
  let expected = $state('');

  async function onFiles([f]: File[]) {
    file = f;
    rows = [];
    busy = true;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      rows = await Promise.all(HASH_ALGORITHMS.map(async (a) => ({ label: a, value: encodeDigest(await digest(a, bytes), 'hex') })));
    } finally {
      busy = false;
    }
  }

  const want = $derived(expected.trim().toLowerCase().replace(/^[a-z0-9-]+[:=]\s*/, '').replace(/\s.*$/, ''));
  const match = $derived(want ? rows.find((r) => r.value === want)?.label : undefined);
  const summary = $derived(file ? `${file.name}\n${rows.map((r) => `${r.label}: ${r.value}`).join('\n')}` : '');
</script>

<div class="it-panes">
  <section class="card it-pane">
    <Dropzone accept="*/*" multiple={false} label="Drop a file to hash" compact onFiles={onFiles} />
    {#if file}<p class="it-help">{file.name} · {formatBytes(file.size)}</p>{/if}
    <label class="it-field col">
      <span>Expected checksum (optional)</span>
      <input class="it-input" bind:value={expected} placeholder="Paste the hash from the download page" spellcheck="false" />
    </label>
    {#if want && rows.length}
      {#if match}
        <p class="ok">✓ Matches the {match} checksum. The file is intact.</p>
      {:else}
        <p class="it-error">✗ No match. The file may be damaged or different, or the checksum uses another algorithm.</p>
      {/if}
    {/if}
  </section>
  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>Checksums{#if busy}…{/if}</h2>
      <OutputActions text={rows.length ? summary : ''} name="checksums" />
    </div>
    {#if rows.length}
      <dl class="it-rows">
        {#each rows as row (row.label)}
          <div class="it-row" class:hit={match === row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
            <CopyButton text={row.value} />
          </div>
        {/each}
      </dl>
    {:else}
      <p class="it-help">{busy ? 'Reading the file…' : 'Hashes appear here. The file never leaves your device.'}</p>
    {/if}
  </section>
</div>

<style>
  .col {
    display: grid;
    gap: 6px;
  }
  .ok {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--success-soft);
    color: var(--success);
    font-size: 14px;
  }
  .hit {
    background: var(--success-soft);
    border-radius: 6px;
  }
</style>
