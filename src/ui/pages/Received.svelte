<!--
  Opens a share link (#/s/… or #/q/…): unpacks the file carried in the URL,
  previews it and offers to save it. On phones, "Save to phone" uses the
  system share sheet, so images can go straight to Photos or Files.
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { decodeFragment } from '../../core/share';
  import { download, formatBytes, toBlob } from '../../core/files';
  import FilePreview from '../components/FilePreview.svelte';
  import { ACTIONS } from '../../actions';
  import { accepts } from '../../core/files';
  import { suggestItTools } from '../../it/suggest';
  import { itToolHref } from '../section';

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
  const tools = $derived(file ? ACTIONS.filter((a) => accepts(a, file.type)) : []);
  /** IT tools that fit text (Decrypt, Format JSON …), opened with this text already in. */
  const itTools = $derived(file && isText ? suggestItTools(file.type, text) : []);

  let summary = $state('');

  const asFile = () => new File([file!.bytes as BlobPart], file!.name, { type: file!.type });
  const asObject = $derived(file ? asFile() : null);
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
        {formatBytes(file.bytes.length)}{#if summary}{' · '}{summary}{/if}
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
    <FilePreview file={asObject!} bind:summary />
  </div>

  {#if tools.length || itTools.length}
    <div class="more">
      <span class="muted small">Do more with it:</span>
      {#each tools as tool (tool.id)}
        <button class="chip" onclick={() => onOpen(tool.id, [asFile()])}>{tool.icon} {tool.title}</button>
      {/each}
      {#each itTools as s (s.tool)}
        <a class="chip" href={itToolHref(s.tool, { input: text, options: s.options ?? {} })}>{s.label}</a>
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
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 16px;
  }
  .chip {
    color: var(--text);
    text-decoration: none;
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
