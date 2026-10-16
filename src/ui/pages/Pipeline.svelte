<!--
  Pipeline builder: chain tools so one click runs them all, each step working
  on the files the step before produced. Start from a recipe or from scratch,
  tune each step with the same settings panel as the tool page, then save it
  in this browser or copy a link to it.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { FileData, OutputFile } from '../../core/types';
  import { CATEGORIES, getAction } from '../../actions';
  import { readFile } from '../../core/files';
  import { matchingPreset, validate } from '../../core/params';
  import { CancelledError, runAction, type JobHandle } from '../../core/runner';
  import {
    PIPELINE_ACTIONS,
    PIPELINE_ROUTE,
    RECIPES,
    acceptsType,
    decodePipeline,
    encodePipeline,
    newStep,
    pipelineErrors,
    planTypes,
    runPipeline,
    typeLabel,
    type Pipeline,
  } from '../../core/pipeline';
  import { deletePipeline, loadPipelines, savePipeline } from '../settings';
  import Dropzone from '../components/Dropzone.svelte';
  import FileList, { type Item } from '../components/FileList.svelte';
  import ParamPanel from '../components/ParamPanel.svelte';
  import Results from '../components/Results.svelte';

  let { encoded = '' }: { encoded?: string } = $props();

  let pipeline = $state<Pipeline>(untrack(() => (encoded && decodePipeline(encoded)) || { name: 'My pipeline', steps: [] }));
  let open = $state<number | null>(null);
  let items = $state<Item[]>([]);
  let progress = $state<{ fraction: number; message: string } | null>(null);
  let results = $state<OutputFile[] | null>(null);
  let error = $state<string | null>(null);
  let saved = $state(untrack(() => loadPipelines().some((p) => p.name === pipeline.name)));
  let flash = $state('');
  let cancelled = false;
  let job: JobHandle | null = null;

  const first = $derived(pipeline.steps[0] ? getAction(pipeline.steps[0].actionId) : undefined);
  /** Types going in: the loaded files, or a guess from the first step so the flow shows before files are added. */
  const inputTypes = $derived(
    items.length ? items.map((i) => i.data.type) : first ? [first.accepts[0] === 'image/*' ? 'image/jpeg' : first.accepts[0]] : [],
  );
  const plans = $derived(planTypes(pipeline, inputTypes));
  const errors = $derived(pipelineErrors(pipeline, inputTypes));
  const lastOutputs = $derived(plans.at(-1)?.outputs ?? []);
  const canRun = $derived(pipeline.steps.length > 0 && items.length > 0 && errors.size === 0 && !progress);

  function addStep(id: string) {
    const action = getAction(id);
    if (!action) return;
    pipeline.steps.push(newStep(action));
    open = pipeline.steps.length - 1;
    saved = false;
  }

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= pipeline.steps.length) return;
    const steps = [...pipeline.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    pipeline.steps = steps;
    if (open === i) open = j;
    saved = false;
  }

  function remove(i: number) {
    pipeline.steps = pipeline.steps.filter((_, k) => k !== i);
    open = null;
    saved = false;
  }

  function useRecipe(make: () => Pipeline) {
    pipeline = make();
    open = null;
    saved = false;
  }

  /** Whether an action could follow the current last step. */
  function fits(id: string): boolean {
    const action = getAction(id)!;
    return lastOutputs.length === 0 || lastOutputs.every((t) => acceptsType(action, t));
  }

  async function addFiles(files: File[]) {
    results = null;
    error = null;
    const fresh: Item[] = await Promise.all(
      files.map(async (f) => {
        const data = await readFile(f);
        const thumb = data.type.startsWith('image/') ? URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.type })) : undefined;
        return { id: crypto.randomUUID(), data, thumb };
      }),
    );
    items = [...items, ...fresh];
  }

  async function run() {
    error = null;
    cancelled = false;
    progress = { fraction: 0, message: 'Starting' };
    try {
      results = await runPipeline(
        $state.snapshot(pipeline) as Pipeline,
        items.map((i) => $state.snapshot(i.data) as FileData),
        (action, files, params, onProgress) => {
          if (cancelled) throw new CancelledError();
          job = runAction(action, files, params, (p) => onProgress(p.fraction, p.message));
          return job.result;
        },
        (fraction, message) => (progress = { fraction, message }),
      );
    } catch (e) {
      if (!(e instanceof CancelledError)) error = e instanceof Error ? e.message : String(e);
    } finally {
      progress = null;
      job = null;
    }
  }

  function cancel() {
    cancelled = true;
    job?.cancel();
  }

  function save() {
    savePipeline($state.snapshot(pipeline) as Pipeline);
    saved = true;
    say('Saved in this browser. It is on the home page now.');
  }

  function forget() {
    deletePipeline(pipeline.name);
    saved = false;
    say('Removed from this browser.');
  }

  async function copyLink() {
    const link = `${location.origin}${location.pathname}${PIPELINE_ROUTE}/${encodePipeline($state.snapshot(pipeline) as Pipeline)}`;
    await navigator.clipboard.writeText(link);
    say('Link copied. Passwords are never included.');
  }

  function say(text: string) {
    flash = text;
    setTimeout(() => flash === text && (flash = ''), 3000);
  }

  function summary(i: number): string {
    const step = pipeline.steps[i];
    const action = getAction(step.actionId)!;
    const preset = matchingPreset(action, step.params);
    return preset ? action.presets!.find((p) => p.id === preset)!.label : action.presets?.length ? 'Custom settings' : '';
  }
</script>

<a class="back" href="#/">← All tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">⛓️</span>
  <div class="title">
    <input class="name" bind:value={pipeline.name} oninput={() => (saved = false)} aria-label="Pipeline name" />
    <p class="muted">Run several tools in a row with one click. Each step works on the files the step before made.</p>
  </div>
</div>

{#if results}
  <Results {results} inputs={items.map((i) => i.data)} onReset={() => { results = null; items = []; }} onBack={() => (results = null)} />
{:else}
  <div class="layout">
    <section class="steps">
      {#if pipeline.steps.length === 0}
        <div class="card recipes">
          <h2>Start from a recipe</h2>
          {#each RECIPES as r (r.id)}
            {@const p = r.pipeline()}
            <button class="recipe" onclick={() => useRecipe(r.pipeline)}>
              <strong>{p.name}</strong>
              <span class="muted">{r.description}</span>
              <span class="chain">{p.steps.map((s) => getAction(s.actionId)?.title).join(' → ')}</span>
            </button>
          {/each}
          <p class="muted small">Or add your first step below.</p>
        </div>
      {/if}

      <ol>
        {#each pipeline.steps as step, i (i + step.actionId)}
          {@const action = getAction(step.actionId)!}
          {@const plan = plans[i]}
          <li class="card step" class:bad={errors.has(i)}>
            <div class="row">
              <span class="num">{i + 1}</span>
              <span class="ticon" aria-hidden="true">{action.icon}</span>
              <div class="what">
                <strong>{action.title}</strong>
                <span class="muted small">
                  {[summary(i), plan?.outputs.length ? `${plan.inputs.map(typeLabel).join(', ')} → ${plan.outputs.map(typeLabel).join(', ')}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button class="btn small" onclick={() => (open = open === i ? null : i)} aria-expanded={open === i}>{open === i ? 'Done' : 'Settings'}</button>
              <button class="icon-btn" disabled={i === 0} onclick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button class="icon-btn" disabled={i === pipeline.steps.length - 1} onclick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button class="icon-btn" onclick={() => remove(i)} aria-label="Remove step">✕</button>
            </div>
            {#if errors.has(i)}<p class="error small">{errors.get(i)}{open === i ? '' : ' Open Settings to fix it.'}</p>{/if}
            {#if open === i}
              <div class="settings">
                <ParamPanel {action} bind:values={pipeline.steps[i].params} errors={validate(action, step.params)} />
              </div>
            {/if}
          </li>
        {/each}
      </ol>

      <label class="add">
        <span class="sr">Add a step</span>
        <select value="" onchange={(e) => { addStep(e.currentTarget.value); e.currentTarget.value = ''; }}>
          <option value="" disabled>＋ Add a step…</option>
          {#each CATEGORIES as category (category.id)}
            {@const tools = PIPELINE_ACTIONS.filter((a) => a.category === category.id)}
            {#if tools.length}
              <optgroup label={category.label}>
                {#each tools as tool (tool.id)}
                  <option value={tool.id} disabled={!fits(tool.id)}>{tool.title}{fits(tool.id) ? '' : ` (can't take ${lastOutputs.map(typeLabel).join('/')})`}</option>
                {/each}
              </optgroup>
            {/if}
          {/each}
        </select>
      </label>
      <p class="muted small">Tools you work on by hand (organize pages, crop, redact, sign, fill forms) can't run in a pipeline.</p>
    </section>

    <aside class="card run">
      {#if items.length === 0}
        <Dropzone
          accept={first ? first.accepts.join(',') : 'application/pdf,image/*'}
          paste
          label={first ? `Drop the files for “${first.title}”` : 'Add a step, then drop files here'}
          onFiles={addFiles}
        />
      {:else}
        <FileList bind:items reorderable />
        <Dropzone compact accept={first?.accepts.join(',') ?? '*/*'} label="Add more files" onFiles={addFiles} />
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if progress}
        <div class="progress" aria-live="polite">
          <div class="bar"><div style="width: {Math.round(progress.fraction * 100)}%"></div></div>
          <div class="status muted"><span>{progress.message}</span><button class="btn" onclick={cancel}>Cancel</button></div>
        </div>
      {:else}
        <button class="btn btn-primary btn-lg" disabled={!canRun} onclick={run}>
          {pipeline.steps.length ? `Run ${pipeline.steps.length} step${pipeline.steps.length === 1 ? '' : 's'}` : 'Add a step to start'}
        </button>
      {/if}

      <div class="keep">
        <button class="btn" disabled={!pipeline.steps.length} onclick={save}>{saved ? '✓ Saved' : 'Save'}</button>
        <button class="btn" disabled={!pipeline.steps.length} onclick={copyLink}>Copy link</button>
        {#if saved}<button class="btn" onclick={forget}>Delete</button>{/if}
      </div>
      {#if flash}<p class="muted small">{flash}</p>{/if}
    </aside>
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
  .icon {
    font-size: 28px;
    width: 56px;
    height: 56px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: var(--accent-soft);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .name {
    width: 100%;
    font-size: 24px;
    font-weight: 650;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    padding: 2px 6px;
    margin-left: -7px;
  }
  .name:hover,
  .name:focus {
    border-color: var(--border);
    background: var(--surface);
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
  @media (max-width: 860px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .steps {
    display: grid;
    gap: 12px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .card {
    padding: 14px 16px;
  }
  .recipes {
    display: grid;
    gap: 10px;
  }
  .recipes h2 {
    margin: 0;
    font-size: 16px;
  }
  .recipe {
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .recipe:hover {
    border-color: var(--accent);
  }
  .chain {
    font-size: 13px;
    color: var(--accent);
  }
  .step.bad {
    border-color: var(--danger);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .num {
    width: 24px;
    height: 24px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 13px;
    font-weight: 700;
  }
  .ticon {
    font-size: 20px;
  }
  .what {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .small {
    font-size: 13px;
  }
  .btn.small {
    padding: 5px 12px;
    font-size: 13.5px;
  }
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .settings {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .add select {
    width: 100%;
    padding: 11px 12px;
    border: 1px dashed var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .run {
    position: sticky;
    top: 80px;
    display: grid;
    gap: 14px;
    padding: 18px;
  }
  .run .btn-primary {
    width: 100%;
  }
  .keep {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .keep .btn {
    flex: 1;
    padding: 7px 10px;
    font-size: 14px;
  }
  .error {
    margin: 4px 0 0;
    color: var(--danger);
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
    gap: 8px;
    margin-top: 8px;
    font-size: 13.5px;
  }
</style>
