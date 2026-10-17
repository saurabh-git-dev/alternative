<!--
  In-place preview of a file: images, PDFs (first pages), CSV as a table,
  JSON pretty-printed, plain text, and audio or video. Anything else gets a
  short "no preview" note. Used by share links and direct transfers.
-->
<script lang="ts">
  import { inspectPdf, pdfThumbnails } from '../../core/runner';
  import { parseCsv } from '../../core/text-formats';
  import { detectType, extensionOf } from '../../core/files';
  import PdfViewer from './PdfViewer.svelte';

  let {
    file,
    pdfPages = 3,
    summary = $bindable(''),
  }: {
    file: File;
    /** How many PDF pages to render. */
    pdfPages?: number;
    /** Set to a short description once known, e.g. "12 pages" or "340 rows". */
    summary?: string;
  } = $props();

  /** Text beyond this is cut off in the preview (the file itself is untouched). */
  const MAX_TEXT = 1_000_000;
  const MAX_ROWS = 500;

  let viewing = $state(false);

  /** Text-ish types browsers often leave blank. */
  const TEXT_EXTENSIONS: Record<string, string> = { csv: 'text/csv', json: 'application/json', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg' };

  const kind = $derived.by(() => {
    const declared = file.type === 'application/octet-stream' ? '' : file.type;
    const t = declared || TEXT_EXTENSIONS[extensionOf(file.name)] || detectType(new File([], file.name));
    if (t.startsWith('image/')) return 'image';
    if (t === 'application/pdf') return 'pdf';
    if (t === 'text/csv') return 'csv';
    if (t === 'application/json') return 'json';
    if (t.startsWith('text/') || /\.(txt|md|log|xml|ya?ml|ini|tsv)$/i.test(file.name)) return 'text';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    return 'other';
  });

  const url = $derived(URL.createObjectURL(file));
  $effect(() => {
    const current = url;
    return () => URL.revokeObjectURL(current);
  });

  let text = $state('');
  let truncated = $state(false);
  let pages = $state<string[]>([]);
  let pageCount = $state(0);
  let locked = $state(false);
  let failed = $state(false);

  $effect(() => {
    const f = file;
    const k = kind;
    let alive = true;
    let made: string[] = [];
    text = '';
    pages = [];
    pageCount = 0;
    locked = false;
    failed = false;
    summary = '';
    (async () => {
      if (k === 'csv' || k === 'json' || k === 'text') {
        const t = await f.slice(0, MAX_TEXT).text();
        if (!alive) return;
        truncated = f.size > MAX_TEXT;
        text = t;
      } else if (k === 'pdf') {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const info = await inspectPdf(bytes);
        if (!alive) return;
        pageCount = info.pageCount;
        summary = `${info.pageCount} page${info.pageCount > 1 ? 's' : ''}`;
        if (info.encrypted) {
          locked = true;
          summary = 'password-protected';
          return;
        }
        made = await pdfThumbnails(bytes, Array.from({ length: Math.min(pdfPages, info.pageCount) }, (_, i) => i + 1), 700);
        if (alive) pages = made;
        else made.forEach((u) => URL.revokeObjectURL(u));
      }
    })().catch(() => alive && (failed = true));
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  });

  const pretty = $derived.by(() => {
    if (kind !== 'json' || truncated) return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  });
  const table = $derived(kind === 'csv' ? parseCsv(text) : []);
  $effect(() => {
    if (kind === 'csv' && text) summary = `${Math.max(0, table.length - 1)}${truncated ? '+' : ''} rows`;
  });
</script>

<div class="preview">
  {#if failed}
    <p class="muted">Couldn't preview this file. Download it to open it.</p>
  {:else if kind === 'image'}
    <img src={url} alt={file.name} onerror={() => (failed = true)} />
  {:else if kind === 'pdf'}
    {#if pageCount && pages.length}
      <button class="btn btn-primary" onclick={() => (viewing = true)}>📖 View all {pageCount} page{pageCount > 1 ? 's' : ''}</button>
    {/if}
    {#each pages as page, i (page)}
      <button class="page-btn" onclick={() => (viewing = true)} title="Open the full PDF"><img class="page" src={page} alt="Page {i + 1}" /></button>
    {:else}
      <p class="muted">{locked ? 'This PDF is password-protected, so it can’t be previewed.' : 'Rendering…'}</p>
    {/each}
    {#if pageCount > pages.length && pages.length}
      <p class="muted small">…and {pageCount - pages.length} more page{pageCount - pages.length > 1 ? 's' : ''}.</p>
    {/if}
    {#if viewing}<PdfViewer {file} onClose={() => (viewing = false)} />{/if}
  {:else if kind === 'csv'}
    <div class="table">
      <table><tbody>
        {#each table.slice(0, MAX_ROWS) as row, r (r)}
          <tr>
            {#each row as cell, c (c)}
              {#if r === 0}<th>{cell}</th>{:else}<td>{cell}</td>{/if}
            {/each}
          </tr>
        {/each}
      </tbody></table>
    </div>
    {#if table.length > MAX_ROWS || truncated}<p class="muted small">Showing the first {Math.min(table.length, MAX_ROWS) - 1} rows. Download for the rest.</p>{/if}
  {:else if kind === 'json' || kind === 'text'}
    <pre>{pretty}</pre>
    {#if truncated}<p class="muted small">Showing the first 1 MB. Download for the rest.</p>{/if}
  {:else if kind === 'video'}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={url} controls playsinline></video>
  {:else if kind === 'audio'}
    <audio src={url} controls></audio>
  {:else}
    <p class="muted">No preview for this kind of file{file.type ? ` (${file.type})` : ''}. Download it to open it.</p>
  {/if}
</div>

<style>
  .preview {
    display: grid;
    justify-items: center;
    gap: 12px;
    overflow: hidden;
  }
  .preview p {
    margin: 0;
  }
  img,
  video {
    max-width: 100%;
    max-height: 75vh;
    border-radius: 6px;
  }
  audio {
    width: 100%;
  }
  .page-btn {
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
    max-width: 100%;
  }
  .page {
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
  .small {
    font-size: 13px;
  }
</style>
