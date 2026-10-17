<!--
  Opens a share link (#/s/… or #/q/…): unpacks the file carried in the URL,
  previews it and offers to save it. On phones, "Save to phone" uses the
  system share sheet, so images can go straight to Photos or Files.
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { decodeFragment } from '../../core/share';
  import { download, formatBytes, toBlob } from '../../core/files';
  import { parseCsv } from '../../core/text-formats';
  import { inspectPdf, pdfThumbnails } from '../../core/runner';
  import { ACTIONS } from '../../actions';
  import { accepts } from '../../core/files';

  let { hash, onOpen }: { hash: string; onOpen: (id: string, files: File[]) => void } = $props();

  const decoded = $derived.by((): { file: FileData } | { error: string } => {
    try {
      const file = decodeFragment(hash);
      return file ? { file } : { error: 'This is not a share link.' };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  const file = $derived('file' in decoded ? decoded.file : null);

  const kind = $derived.by(() => {
    const t = file?.type ?? '';
    if (t.startsWith('image/')) return 'image';
    if (t === 'application/pdf') return 'pdf';
    if (t === 'text/csv') return 'csv';
    if (t === 'application/json') return 'json';
    if (t.startsWith('text/')) return 'text';
    return 'other';
  });
  const isText = $derived(kind === 'csv' || kind === 'json' || kind === 'text');
  const text = $derived(file && isText ? new TextDecoder().decode(file.bytes) : '');
  const pretty = $derived.by(() => {
    if (kind !== 'json') return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  });
  const table = $derived(kind === 'csv' ? parseCsv(text) : []);
  const tools = $derived(file ? ACTIONS.filter((a) => accepts(a, file.type)) : []);

  const url = $derived(file ? URL.createObjectURL(toBlob(file)) : '');
  $effect(() => {
    const current = url;
    return () => current && URL.revokeObjectURL(current);
  });

  let pages = $state<string[]>([]);
  let pageCount = $state(0);
  $effect(() => {
    if (!file || kind !== 'pdf') return;
    let alive = true;
    let made: string[] = [];
    (async () => {
      const info = await inspectPdf(file.bytes);
      if (!alive) return;
      pageCount = info.pageCount;
      made = await pdfThumbnails(file.bytes, Array.from({ length: Math.min(3, info.pageCount) }, (_, i) => i + 1), 700);
      if (alive) pages = made;
      else made.forEach((u) => URL.revokeObjectURL(u));
    })().catch(() => {});
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  });

  const asFile = () => new File([file!.bytes as BlobPart], file!.name, { type: file!.type });
  const canShareFile = $derived(!!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [asFile()] }));

  let copied = $state(false);
  async function copyText() {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

{#if !file}
  <div class="card failed">
    <h1>Couldn't open this link</h1>
    <p class="muted">{'error' in decoded ? decoded.error : ''}</p>
    <a class="btn" href="#/">Go to all tools</a>
  </div>
{:else}
  <div class="card head">
    <div class="meta">
      <span class="muted small">Shared with you</span>
      <h1 title={file.name}>{file.name}</h1>
      <span class="muted small">
        {formatBytes(file.bytes.length)}{#if kind === 'pdf' && pageCount}{' · '}{pageCount} page{pageCount > 1 ? 's' : ''}{/if}{#if kind === 'csv'}{' · '}{table.length - 1} rows{/if}
      </span>
    </div>
    <div class="actions">
      {#if canShareFile}
        <button class="btn btn-primary btn-lg" onclick={() => navigator.share({ files: [asFile()] }).catch(() => {})}>Save to phone…</button>
        <button class="btn btn-lg" onclick={() => download(toBlob(file), file.name)}>⬇ Download</button>
      {:else}
        <button class="btn btn-primary btn-lg" onclick={() => download(toBlob(file), file.name)}>⬇ Download</button>
      {/if}
      {#if isText}<button class="btn btn-lg" onclick={copyText}>{copied ? '✓ Copied' : 'Copy text'}</button>{/if}
    </div>
  </div>

  <div class="preview card">
    {#if kind === 'image'}
      <img src={url} alt={file.name} />
    {:else if kind === 'pdf'}
      {#each pages as page, i (page)}
        <img class="page" src={page} alt="Page {i + 1}" />
      {/each}
      {#if pageCount > pages.length && pages.length}<p class="muted small">…and {pageCount - pages.length} more page{pageCount - pages.length > 1 ? 's' : ''}. <a href={url} target="_blank" rel="noopener">Open the whole PDF</a></p>{/if}
    {:else if kind === 'csv'}
      <div class="table">
        <table><tbody>
          {#each table.slice(0, 500) as row, r (r)}
            <tr>
              {#each row as cell, c (c)}
                {#if r === 0}<th>{cell}</th>{:else}<td>{cell}</td>{/if}
              {/each}
            </tr>
          {/each}
        </tbody></table>
      </div>
      {#if table.length > 500}<p class="muted small">Showing the first 500 rows. Download for the rest.</p>{/if}
    {:else if isText}
      <pre>{pretty}</pre>
    {:else}
      <p class="muted">No preview for this kind of file ({file.type}). Download it to open it.</p>
    {/if}
  </div>

  {#if tools.length}
    <div class="more">
      <span class="muted small">Do more with it:</span>
      {#each tools as tool (tool.id)}
        <button class="chip" onclick={() => onOpen(tool.id, [asFile()])}>{tool.icon} {tool.title}</button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .card {
    padding: 18px;
  }
  .failed {
    text-align: center;
    display: grid;
    gap: 6px;
    justify-items: center;
    padding: 40px 18px;
  }
  .failed h1 {
    margin: 0;
    font-size: 22px;
  }
  .failed .btn {
    text-decoration: none;
    color: var(--text);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .meta {
    display: grid;
    min-width: 0;
  }
  .meta h1 {
    margin: 2px 0;
    font-size: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .small {
    font-size: 13px;
  }
  .preview {
    display: grid;
    justify-items: center;
    gap: 12px;
    overflow: hidden;
  }
  .preview img {
    max-width: 100%;
    max-height: 75vh;
    border-radius: 6px;
  }
  .preview .page {
    box-shadow: var(--shadow);
    background: white;
  }
  pre {
    justify-self: stretch;
    margin: 0;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 70vh;
    overflow: auto;
  }
  .table {
    justify-self: stretch;
    overflow: auto;
    max-height: 70vh;
  }
  table {
    border-collapse: collapse;
    font-size: 13.5px;
  }
  th,
  td {
    border: 1px solid var(--border);
    padding: 5px 9px;
    text-align: left;
    white-space: nowrap;
  }
  th {
    background: var(--surface-2);
    position: sticky;
    top: 0;
  }
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 16px;
  }
  .chip {
    padding: 6px 12px;
    border-radius: 99px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 13.5px;
  }
  .chip:hover {
    border-color: var(--accent);
  }
</style>
