<!--
  The recordings saved in this browser (core/recordings.ts): watch, rename,
  download, share to another device, open in a video tool, or delete.

  Sharing uses the app's usual route: a QR code for tiny files, otherwise a
  direct, end-to-end encrypted transfer (ui/share-target.ts). "Edit" opens
  a video tool in the Video section with the recording loaded.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { deleteRecording, fileNameFor, recordingBlob, storageUse, updateMeta, type RecordingMeta } from '../../core/recordings';
  import { download, formatBytes } from '../../core/files';
  import { formatTime } from '../../core/video';
  import { shareFile } from '../share-target';
  import { videoToolHref } from '../section';

  let { recordings = $bindable(), busy = [], openId = $bindable(null) }: { recordings: RecordingMeta[]; busy?: string[]; openId?: string | null } = $props();

  let thumbs = $state<Record<string, string>>({});
  let playing = $state<{ id: string; url: string } | null>(null);
  let renaming = $state<string | null>(null);
  let usage = $state<{ used: number; quota: number } | null>(null);
  let working = $state<string | null>(null);

  const EDITS = [
    { id: 'video.trim', label: '✂️ Trim' },
    { id: 'video.compress', label: '🗜️ Compress' },
    { id: 'video.blur', label: '🫥 Blur an area' },
    { id: 'video.crop', label: '🔲 Crop' },
    { id: 'video.gif', label: '🎞️ Make a GIF' },
    { id: 'video.audio', label: '🎵 Extract audio' },
    { id: 'video.convert', label: '🔁 Convert to MP4' },
  ];

  $effect(() => {
    const prev = untrack(() => thumbs);
    const next: Record<string, string> = {};
    for (const r of recordings) next[r.id] = prev[r.id] || (r.thumb ? URL.createObjectURL(r.thumb) : '');
    thumbs = next;
    void storageUse().then((u) => (usage = u));
  });

  $effect(() => {
    if (openId) {
      const id = openId;
      openId = null;
      void play(id);
    }
  });

  $effect(() => () => {
    if (playing) URL.revokeObjectURL(playing.url);
  });

  async function play(id: string) {
    const meta = recordings.find((r) => r.id === id);
    if (!meta) return;
    close();
    playing = { id, url: URL.createObjectURL(await recordingBlob(id, meta.type)) };
  }

  function close() {
    if (playing) URL.revokeObjectURL(playing.url);
    playing = null;
  }

  async function save(meta: RecordingMeta) {
    download(await recordingBlob(meta.id, meta.type), fileNameFor(meta));
  }

  async function share(meta: RecordingMeta) {
    working = meta.id;
    try {
      const blob = await recordingBlob(meta.id, meta.type);
      shareFile({ name: fileNameFor(meta), type: meta.type, bytes: new Uint8Array(await blob.arrayBuffer()) });
    } finally {
      working = null;
    }
  }

  async function remove(meta: RecordingMeta) {
    if (!confirm(`Delete “${meta.title}”? This can't be undone.`)) return;
    if (playing?.id === meta.id) close();
    await deleteRecording(meta.id);
    recordings = recordings.filter((r) => r.id !== meta.id);
  }

  async function rename(meta: RecordingMeta, title: string) {
    renaming = null;
    title = title.trim();
    if (!title || title === meta.title) return;
    const next = await updateMeta(meta.id, { title });
    if (next) recordings = recordings.map((r) => (r.id === meta.id ? next : r));
  }

  const dateOf = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const current = $derived(playing ? recordings.find((r) => r.id === playing!.id) : undefined);
</script>

{#snippet actions(meta: RecordingMeta)}
  <button class="btn dl" onclick={() => save(meta)} title="Download">⬇<span class="lbl"> Download</span></button>
  <button class="btn" onclick={() => share(meta)} disabled={working === meta.id} title="Send to your phone or another computer, end-to-end encrypted">📡<span class="lbl"> Share</span></button>
  <details class="menu">
    <summary class="btn" title="Open in a video tool">✏️<span class="lbl"> Edit</span></summary>
    <div class="items card">
      {#each EDITS as e (e.id)}<a href={videoToolHref(e.id, `/recording/${meta.id}`)}>{e.label}</a>{/each}
    </div>
  </details>
  <button class="btn danger" onclick={() => remove(meta)} title="Delete">🗑</button>
{/snippet}

<section class="library" aria-label="Your recordings">
  <div class="head">
    <h2>Your recordings</h2>
    {#if usage}
      <span class="muted usage" title="Recordings are stored in this browser only. Clearing this site's data deletes them.">
        {formatBytes(usage.used)} used of {formatBytes(usage.quota)} available
      </span>
    {/if}
  </div>

  {#if recordings.length === 0}
    <p class="empty muted">No recordings yet. They're saved here, in this browser only, until you delete them.</p>
  {:else}
    <ul class="grid">
      {#each recordings as r (r.id)}
        <li class="item card">
          <button class="thumb" onclick={() => play(r.id)} aria-label="Play {r.title}" disabled={busy.includes(r.id)}>
            {#if thumbs[r.id]}<img src={thumbs[r.id]} alt="" />{:else}<span aria-hidden="true">🎬</span>{/if}
            {#if busy.includes(r.id)}
              <span class="badge">Saving…</span>
            {:else if r.duration}
              <span class="badge">{formatTime(r.duration)}</span>
            {/if}
          </button>
          <div class="meta">
            {#if renaming === r.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="title-input"
                value={r.title}
                autofocus
                aria-label="Recording name"
                onblur={(e) => rename(r, e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') renaming = null;
                }}
              />
            {:else}
              <button class="title" title="Rename" onclick={() => (renaming = r.id)}>{r.title}</button>
            {/if}
            <div class="muted small">
              {dateOf(r.createdAt)} · {formatBytes(r.size)}{#if r.recovered} · <span class="warn">recovered</span>{/if}
            </div>
          </div>
          <div class="actions">{@render actions(r)}</div>
        </li>
      {/each}
    </ul>
    <p class="muted small foot">Recordings stay in this browser only. Clearing this site's data, or using a private window, deletes them.</p>
  {/if}
</section>

{#if playing && current}
  <div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && close()} onkeydown={(e) => e.key === 'Escape' && close()}>
    <div class="player card" role="dialog" aria-label={current.title}>
      <div class="player-head">
        <strong>{current.title}</strong>
        <button class="icon-btn" onclick={close} aria-label="Close">✕</button>
      </div>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={playing.url} controls autoplay playsinline></video>
      <div class="actions">{@render actions(current)}</div>
    </div>
  </div>
{/if}

<style>
  .library {
    display: grid;
    gap: 12px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .usage {
    margin-left: auto;
    font-size: 13px;
  }
  .empty {
    margin: 0;
    padding: 28px 16px;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .item {
    display: grid;
    overflow: visible;
    box-shadow: none;
  }
  .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    border: 0;
    border-radius: var(--radius) var(--radius) 0 0;
    background: #0b0c10;
    overflow: hidden;
    display: grid;
    place-items: center;
    font-size: 32px;
    padding: 0;
    cursor: pointer;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .badge {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 1px 7px;
    border-radius: 6px;
    background: rgb(0 0 0 / 70%);
    color: white;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .meta {
    padding: 10px 12px 4px;
    min-width: 0;
  }
  .title {
    display: block;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    font-weight: 600;
    font-size: 14.5px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
    color: var(--text);
  }
  .title-input {
    width: 100%;
    padding: 3px 6px;
    font: inherit;
    font-weight: 600;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  .small {
    font-size: 12.5px;
  }
  .warn {
    color: var(--warning);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px 12px;
  }
  .actions .btn {
    padding: 6px 11px;
    font-size: 13.5px;
    color: var(--text);
  }
  .danger {
    margin-left: auto;
  }
  /* Cards are narrow: the download arrow speaks for itself there. */
  .item .dl .lbl {
    display: none;
  }
  .menu {
    position: relative;
  }
  .menu summary {
    list-style: none;
    cursor: pointer;
  }
  .menu summary::-webkit-details-marker {
    display: none;
  }
  .items {
    position: absolute;
    z-index: 20;
    top: calc(100% + 4px);
    left: 0;
    display: grid;
    min-width: 170px;
    padding: 6px;
  }
  .items a {
    padding: 6px 10px;
    border-radius: 7px;
    color: var(--text);
    text-decoration: none;
    font-size: 14px;
    white-space: nowrap;
  }
  .items a:hover {
    background: var(--accent-soft);
  }
  .foot {
    margin: 0;
    text-align: center;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 60%);
  }
  .player {
    width: min(960px, 100%);
    max-height: 100%;
    overflow: auto;
    display: grid;
  }
  .player-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
  }
  .player video {
    width: 100%;
    max-height: 70vh;
    background: #000;
  }
  @media (max-width: 560px) {
    .lbl {
      display: none;
    }
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
