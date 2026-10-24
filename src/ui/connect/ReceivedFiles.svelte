<!--
  Files received over the local network (Local share and the A2B page),
  in the folder the app saves them to: preview them, open them in any tool,
  delete them or clear them all. On Android that folder is the app's own,
  so each file also has "Save to Downloads", which copies it to the phone's
  Downloads folder (Download/Tools) for the Files app and other apps; on
  computers it already is Downloads/Tools ("Show in folder").
-->
<script lang="ts">
  import { formatBytes } from '../../core/files';
  import * as local from '../../core/local';
  import type { ReceivedFile } from '../../core/local';
  import EditMenu from '../components/EditMenu.svelte';
  import FilePreview from '../components/FilePreview.svelte';
  import { localHub } from './local.svelte';

  let { onOpen }: { onOpen: (id: string, files: File[]) => void } = $props();

  const android = local.isAndroid();
  let files = $state<ReceivedFile[]>([]);
  let loaded = $state<Record<string, File | 'loading' | 'too big' | 'failed'>>({});
  let saved = $state<Record<string, string>>({});
  let open = $state<Record<string, boolean>>({});
  let note = $state('');

  async function load() {
    files = (await local.received().catch(() => null)) ?? [];
  }

  // Again whenever something arrives.
  $effect(() => {
    void localHub.filesChanged;
    load();
  });

  async function toggle(f: ReceivedFile) {
    open[f.path] = !open[f.path];
    if (!open[f.path] || loaded[f.path]) return;
    if (f.size > local.LOAD_LIMIT) {
      loaded[f.path] = 'too big';
      return;
    }
    loaded[f.path] = 'loading';
    loaded[f.path] = await local.readFile(f).catch(() => 'failed' as const);
  }

  async function save(f: ReceivedFile) {
    saved[f.path] = 'Saving…';
    saved[f.path] = await local.saveToDownloads(f.path).then(
      (where) => `✓ In ${where}`,
      (e: unknown) => String(e),
    );
  }

  async function saveAll() {
    for (const f of files) if (!saved[f.path]?.startsWith('✓')) await save(f);
  }

  async function remove(f: ReceivedFile) {
    if (!confirm(`Delete ${f.name}?`)) return;
    await local.deleteFile(f.path).catch(() => {});
    await load();
  }

  async function clearAll() {
    if (!confirm(`Delete all ${files.length} received files${android ? ' from the app' : ' in Downloads/Tools'}? Copies you saved to Downloads stay.`)) return;
    const n = await local.clearReceived().catch(() => 0);
    note = `Deleted ${n} file${n === 1 ? '' : 's'}.`;
    setTimeout(() => (note = ''), 3000);
    loaded = {};
    await load();
  }

  const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
</script>

<section class="card received">
  <div class="top">
    <h2>📥 Received files</h2>
    <span class="muted small">{files.length ? `${files.length} · ${formatBytes(files.reduce((n, f) => n + f.size, 0))}` : ''}</span>
    {#if files.length}
      {#if android}<button class="btn" onclick={saveAll}>Save all to Downloads</button>{/if}
      <button class="btn danger" onclick={clearAll}>Clear all</button>
    {/if}
  </div>
  {#if note}<p class="muted small">{note}</p>{/if}
  {#if !files.length}
    <p class="muted small">Files sent to this device over your network show up here.{android ? ' Save them to Downloads to open them in other apps.' : ' They are saved in Downloads/Tools.'}</p>
  {/if}
  <ul>
    {#each files as f (f.path)}
      {@const file = loaded[f.path]}
      <li>
        <div class="line">
          <button class="name" onclick={() => toggle(f)} title="Preview {f.name}">{f.name}</button>
          <span class="muted small meta">{formatBytes(f.size)} · {when(f.modified)}</span>
        </div>
        <div class="actions">
          {#if file instanceof File}<EditMenu {file} {onOpen} />{/if}
          {#if android}
            <button class="btn" onclick={() => save(f)} disabled={saved[f.path] === 'Saving…'}>⬇ Save to Downloads</button>
          {:else}
            <button class="btn" onclick={() => local.reveal(f.path).catch(() => {})}>📂 Show in folder</button>
          {/if}
          <button class="btn" onclick={() => remove(f)} aria-label="Delete {f.name}">🗑 Delete</button>
        </div>
        {#if saved[f.path]}<p class="muted small">{saved[f.path]}</p>{/if}
        {#if open[f.path]}
          {#if file instanceof File}
            <div class="preview"><FilePreview {file} /></div>
          {:else if file === 'loading'}
            <p class="muted small">Loading…</p>
          {:else if file === 'too big'}
            <p class="muted small">Too big to preview here ({formatBytes(local.LOAD_LIMIT)} at most). {android ? 'Save it to Downloads and open it from the Files app.' : 'Open it from the folder.'}</p>
          {:else if file === 'failed'}
            <p class="muted small">Couldn't open it.</p>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .received {
    display: grid;
    gap: 10px;
    padding: 16px;
    margin-top: 16px;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .top .muted {
    flex: 1;
  }
  p {
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: grid;
    gap: 6px;
    padding: 10px 0;
    border-top: 1px solid var(--border);
    min-width: 0;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    min-width: 0;
  }
  .name {
    min-width: 0;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .name:hover {
    color: var(--accent);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .actions :global(.btn),
  .top .btn {
    padding: 5px 10px;
    font-size: 13px;
  }
  .danger {
    color: var(--danger);
  }
  .preview {
    padding: 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .small {
    font-size: 13px;
  }
</style>
