<!--
  Generic tool page. Works for every action: it loads files, renders the
  settings panel from the action's parameter schema, runs the job in a worker
  and shows the results. No tool-specific code lives here.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ActionDefinition, Annotation, Box, OutputFile, PageBox, PageRef, ParamValues, SignatureValue, TextItem } from '../../core/types';
  import { initialValues, validate } from '../../core/params';
  import { accepts, detectType, readFile } from '../../core/files';
  import { CancelledError, inspectAction, inspectPdf, pdfThumbnails, runAction, type JobHandle } from '../../core/runner';
  import { loadSettings, saveSettings } from '../settings';
  import Dropzone from '../components/Dropzone.svelte';
  import FileList, { type Item } from '../components/FileList.svelte';
  import ParamPanel from '../components/ParamPanel.svelte';
  import PageOrderEditor from '../components/PageOrderEditor.svelte';
  import RegionEditor from '../components/RegionEditor.svelte';
  import SignatureEditor from '../components/SignatureEditor.svelte';
  import FormEditor from '../components/FormEditor.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import AnnotateEditor from '../components/AnnotateEditor.svelte';
  import TextEditor from '../components/TextEditor.svelte';
  import LivePreview from '../components/LivePreview.svelte';
  import { isWorkspaceParam } from '../../core/params';
  import Results from '../components/Results.svelte';
  import { isConstrained } from '../../core/device';
  import VideoWorkspace from '../components/VideoWorkspace.svelte';
  import { videoPoster } from '../video-poster';

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
  /** Shown only on phones and low-memory computers, where heavy tools may struggle. */
  const deviceWarning = $derived(action.demanding && isConstrained() ? action.demanding : null);
  const single = $derived(action.mode === 'each' && action.maxFiles === 1);
  /** The parameter edited directly on the document, if this tool has one. */
  const workspace = $derived(Object.entries(action.params).find(([, s]) => isWorkspaceParam(s)));
  const orderKey = $derived(workspace?.[1].kind === 'pageOrder' ? workspace[0] : undefined);
  /** Video tools edit on a player: which editor it shows for the workspace parameter. */
  const VIDEO_MODES = { timeRange: 'trim', videoTime: 'time', crop: 'crop', masks: 'masks' } as const;
  const videoMode = $derived(
    workspace && items[0]?.data.type.startsWith('video/') ? VIDEO_MODES[workspace[1].kind as keyof typeof VIDEO_MODES] : undefined,
  );
  const kind = $derived(
    action.accepts.includes('application/pdf') ? 'PDF' : action.accepts.some((a) => a.startsWith('video/')) ? 'video' : 'image',
  );

  const errors = $derived(validate(action, values));
  /** A problem with the workspace value (e.g. nothing drawn yet), shown under the button. */
  const workspaceError = $derived(workspace ? errors[workspace[0]] : undefined);
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
    const wasEmpty = items.length === 0 || single;
    items = single ? fresh : [...items, ...fresh];
    for (const item of fresh) describe(item.id);
    if (wasEmpty && fresh[0]) prefill(fresh[0]);
  }

  /** Reset per-document values and let the action prefill from the first file. */
  async function prefill(item: Item) {
    for (const [key, spec] of Object.entries(action.params)) {
      if (isWorkspaceParam(spec)) values[key] = structuredClone(spec.default) as never;
    }
    if (!action.inspect) return;
    try {
      Object.assign(values, await inspectAction(action.id, $state.snapshot(item.data) as Item['data']));
    } catch {
      /* unreadable file: the run will report a clear error */
    }
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
        if (orderKey && !info.encrypted && current === items[0]) {
          values[orderKey] = Array.from({ length: info.pageCount }, (_, i): PageRef => ({ page: i + 1, rotate: 0 }));
        }
      } catch {
        const current = find();
        if (current) current.error = "This file couldn't be read. It may be damaged or not a real PDF.";
      }
    } else if (item.data.type.startsWith('image/')) {
      item.thumb = URL.createObjectURL(new Blob([item.data.bytes as BlobPart], { type: item.data.type }));
    } else if (item.data.type.startsWith('video/')) {
      item.src = URL.createObjectURL(new Blob([item.data.bytes as BlobPart], { type: item.data.type }));
      const poster = await videoPoster(item.src);
      const current = find();
      if (current && poster) {
        current.thumb = poster.thumb;
        current.duration = poster.duration;
      }
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
{#if deviceWarning}
  <p class="device-warning" role="note"><strong>Heads up on this device:</strong> {deviceWarning} A computer works best for big files.</p>
{/if}

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
          label={`Drop ${kind} file${single ? '' : 's'} here`}
          onFiles={addFiles}
        />
      {:else}
        {@const first = items[0]}
        {#if workspace && videoMode}
          {@const [key, spec] = workspace}
          {#if first.src}
            <VideoWorkspace
              src={first.src}
              mode={videoMode}
              value={values[key] as never}
              onChange={(v) => (values[key] = v)}
              initialLength={spec.kind === 'timeRange' ? spec.initialLength : undefined}
              maxLength={spec.kind === 'timeRange' ? spec.maxLength : undefined}
              effect={spec.kind === 'masks' ? spec.preview?.(values) : undefined}
            />
          {/if}
          <FileList bind:items />
        {:else if workspace && !first.encrypted && !first.error}
          {@const [key, spec] = workspace}
          {#if spec.kind === 'crop'}
            {#if first.thumb}
              <CropEditor src={first.thumb} box={values[key] as Box} onChange={(v) => (values[key] = v)} />
            {/if}
            {#if items.length > 1}<p class="muted note">The same crop is applied to all {items.length} images.</p>{/if}
            <FileList bind:items />
          {:else if !first.pages}
            <p class="muted">Opening document…</p>
          {:else if spec.kind === 'pageOrder'}
            <PageOrderEditor bytes={first.data.bytes} pageCount={first.pages} order={values[key] as PageRef[]} onChange={(v) => (values[key] = v)} />
          {:else if spec.kind === 'regions'}
            <RegionEditor bytes={first.data.bytes} pageCount={first.pages} regions={values[key] as PageBox[]} onChange={(v) => (values[key] = v)} />
          {:else if spec.kind === 'signature'}
            <SignatureEditor bytes={first.data.bytes} pageCount={first.pages} value={values[key] as SignatureValue} onChange={(v) => (values[key] = v)} />
          {:else if spec.kind === 'annotations'}
            <AnnotateEditor bytes={first.data.bytes} pageCount={first.pages} annotations={values[key] as Annotation[]} onChange={(v) => (values[key] = v)} />
          {:else if spec.kind === 'textEdits'}
            <TextEditor bytes={first.data.bytes} pageCount={first.pages} edits={values[key] as TextItem[]} onChange={(v) => (values[key] = v)} />
          {:else if spec.kind === 'formFields'}
            <FormEditor bytes={first.data.bytes} values={values[key] as Record<string, string | boolean>} onChange={(v) => (values[key] = v)} />
          {/if}
        {:else}
          {#if action.livePreview && first.data.type.startsWith('image/')}
            <LivePreview actionId={action.id} file={first.data} {values} />
          {/if}
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
          {:else if workspaceError}
            <p class="hint muted">{workspaceError}</p>
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
  .device-warning {
    margin: -8px 0 20px;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning) 12%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
    font-size: 14px;
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
  .note {
    margin: 0;
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
  @media (max-width: 560px) {
    .head {
      gap: 12px;
      margin-bottom: 16px;
    }
    .head .icon {
      font-size: 24px;
      width: 44px;
      height: 44px;
    }
    h1 {
      font-size: 21px;
    }
    .head p {
      font-size: 14px;
    }
  }
</style>
