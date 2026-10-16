<!--
  Generic tool page. Works for every action: it loads files, renders the
  settings panel from the action's parameter schema, runs the job in a worker
  and shows the results. No tool-specific code lives here.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ActionDefinition, OutputFile, PageRef, ParamValues } from '../../core/types';
  import { initialValues, validate } from '../../core/params';
  import { accepts, detectType, readFile } from '../../core/files';
  import { CancelledError, inspectPdf, pdfThumbnails, runAction, type JobHandle } from '../../core/runner';
  import { loadSettings, saveSettings } from '../settings';
  import Dropzone from '../components/Dropzone.svelte';
  import FileList, { type Item } from '../components/FileList.svelte';
  import ParamPanel from '../components/ParamPanel.svelte';
  import PageOrderEditor from '../components/PageOrderEditor.svelte';
  import Results from '../components/Results.svelte';

  let { action, initialFiles = [] }: { action: ActionDefinition; initialFiles?: File[] } = $props();

  let items = $state<Item[]>([]);
  // The page is re-created per tool (see App.svelte's {#key}), so reading the
  // initial props once is intended.
  let values = $state<ParamValues>(untrack(() => initialValues(action, loadSettings(action))));
  let rejected = $state<string[]>([]);
  let progress = $state<{ fraction: number; message?: string } | null>(null);
  let job: JobHandle | null = null;
  let results = $state<OutputFile[] | null>(null);
  let error = $state<string | null>(null);

  const acceptAttr = $derived(action.accepts.join(','));
  const single = $derived(action.mode === 'each' && action.maxFiles === 1);
  const orderKey = $derived(Object.entries(action.params).find(([, s]) => s.kind === 'pageOrder')?.[0]);

  const errors = $derived(validate(action, values));
  const minFiles = $derived(action.minFiles ?? 1);
  const blocked = $derived(items.some((i) => i.encrypted) && action.id !== 'pdf.unlock');
  const canRun = $derived(
    items.length >= minFiles && Object.keys(errors).length === 0 && !progress && !blocked && items.every((i) => !i.error),
  );

  $effect(() => saveSettings(action, $state.snapshot(values)));

  untrack(() => initialFiles.length && addFiles(initialFiles));

  async function addFiles(files: File[]) {
    results = null;
    error = null;
    const ok = files.filter((f) => accepts(action, detectType(f)));
    rejected = files.filter((f) => !ok.includes(f)).map((f) => f.name);
    const room = action.maxFiles ? action.maxFiles - (single ? 0 : items.length) : Infinity;
    const take = ok.slice(0, Math.max(0, room));
    const fresh: Item[] = await Promise.all(take.map(async (f) => ({ id: crypto.randomUUID(), data: await readFile(f) })));
    items = single ? fresh : [...items, ...fresh];
    for (const item of fresh) describe(item.id);
  }

  /** Fill in page count / thumbnail / encryption status in the background. */
  async function describe(id: string) {
    const find = () => items.find((i) => i.id === id);
    const item = find();
    if (!item) return;
    if (item.data.type === 'application/pdf') {
      try {
        const info = await inspectPdf(item.data.bytes);
        const current = find();
        if (!current) return;
        current.pages = info.pageCount;
        current.encrypted = info.encrypted;
        if (!info.encrypted) current.thumb = (await pdfThumbnails(item.data.bytes, [1], 120))[0];
        if (orderKey && !info.encrypted) {
          values[orderKey] = Array.from({ length: info.pageCount }, (_, i): PageRef => ({ page: i + 1, rotate: 0 }));
        }
      } catch {
        const current = find();
        if (current) current.error = "This file couldn't be read. It may be damaged or not a real PDF.";
      }
    } else if (item.data.type.startsWith('image/')) {
      item.thumb = URL.createObjectURL(new Blob([item.data.bytes as BlobPart], { type: item.data.type }));
    }
  }

  async function run() {
    error = null;
    results = null;
    progress = { fraction: 0, message: 'Starting' };
    job = runAction(action, items.map((i) => $state.snapshot(i.data) as Item['data']), $state.snapshot(values), (p) => (progress = p));
    try {
      results = await job.result;
    } catch (e) {
      if (!(e instanceof CancelledError)) error = e instanceof Error ? e.message : String(e);
    } finally {
      progress = null;
      job = null;
    }
  }

  function reset() {
    results = null;
    error = null;
    items = [];
  }
</script>

<a class="back" href="#/">← All tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">{action.icon}</span>
  <div>
    <h1>{action.title}</h1>
    <p class="muted">{action.description}</p>
  </div>
</div>

{#if results}
  <Results {results} inputs={items.map((i) => i.data)} onReset={reset} onBack={() => (results = null)} />
{:else}
  <div class="layout" class:empty={items.length === 0}>
    <section class="files">
      {#if items.length === 0}
        <Dropzone
          accept={acceptAttr}
          multiple={!single}
          paste
          label={`Drop ${action.accepts.includes('application/pdf') ? 'PDF' : 'image'} file${single ? '' : 's'} here`}
          onFiles={addFiles}
        />
      {:else}
        {#if orderKey && items[0]?.pages}
          <PageOrderEditor
            bytes={items[0].data.bytes}
            pageCount={items[0].pages}
            order={values[orderKey] as PageRef[]}
            onChange={(order) => (values[orderKey] = order)}
          />
        {:else}
          <FileList bind:items reorderable={action.mode === 'all'} />
        {/if}
        {#if !single}
          <Dropzone compact accept={acceptAttr} label="Add more files" onFiles={addFiles} />
        {:else}
          <button class="btn" onclick={reset}>Choose a different file</button>
        {/if}
      {/if}
      {#if rejected.length}
        <p class="warn">Skipped {rejected.join(', ')}: this tool doesn't accept that file type.</p>
      {/if}
      {#if blocked}
        <p class="warn">
          A file is password-protected. <a href="#/tool/pdf.unlock">Unlock it first</a>, then come back.
        </p>
      {/if}
    </section>

    {#if items.length > 0}
      <aside class="panel card">
        <ParamPanel {action} bind:values {errors} />
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        {#if progress}
          <div class="progress" aria-live="polite">
            <div class="bar"><div style="width: {Math.round(progress.fraction * 100)}%"></div></div>
            <div class="status muted">
              <span>{progress.message ?? 'Working'}</span>
              <button class="btn" onclick={() => job?.cancel()}>Cancel</button>
            </div>
          </div>
        {:else}
          <button class="btn btn-primary btn-lg run" disabled={!canRun} onclick={run}>
            {action.verb}
          </button>
          {#if items.length < minFiles}
            <p class="hint muted">Add at least {minFiles} files.</p>
          {/if}
        {/if}
        <details class="how muted">
          <summary>How it works</summary>
          Runs on your device with {action.engines.join(' + ')}. Large engines download once and are then cached.
        </details>
      </aside>
    {/if}
  </div>
{/if}

<style>
  .back {
    display: inline-block;
    margin-bottom: 12px;
    text-decoration: none;
    font-size: 14px;
  }
  .head {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-bottom: 24px;
  }
  .head .icon {
    font-size: 30px;
    width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: var(--accent-soft);
  }
  h1 {
    margin: 0;
    font-size: 26px;
    letter-spacing: -0.01em;
  }
  .head p {
    margin: 2px 0 0;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 24px;
    align-items: start;
  }
  .layout.empty {
    grid-template-columns: 1fr;
  }
  .files {
    display: grid;
    gap: 14px;
  }
  .panel {
    position: sticky;
    top: 80px;
    padding: 20px;
    display: grid;
    gap: 16px;
  }
  .run {
    width: 100%;
  }
  .progress .bar {
    height: 8px;
    border-radius: 99px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .progress .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
    font-size: 14px;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 14px;
  }
  .warn {
    margin: 0;
    color: var(--warning);
    font-size: 14px;
  }
  .hint {
    margin: -8px 0 0;
    font-size: 13px;
    text-align: center;
  }
  .how {
    font-size: 13px;
  }
  .how summary {
    cursor: pointer;
  }
  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .panel {
      position: static;
    }
  }
</style>
