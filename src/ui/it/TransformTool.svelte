<!--
  Generic page for every transform tool (see it/types.ts): input on the left,
  output on the right, options in between. Output updates as you type.

  Input can be typed, pasted, opened from a text file or dropped. The output
  can be copied, saved, shared (QR code or direct transfer), swapped back into
  the input for two-way tools, or turned into a link that reopens the tool
  with the same input.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ItToolInfo, OptionValues, OutputRow, TransformSpec } from '../../it/types';
  import { encodeToolState, publicOptions, resolveOptions, type ToolState } from '../../it/links';
  import { appUrl } from '../../core/share';
  import { loadItOptions, saveItOptions } from '../settings';
  import OptionField from './OptionField.svelte';
  import OutputActions from './OutputActions.svelte';
  import CopyButton from './CopyButton.svelte';

  let { tool, spec, initial }: { tool: ItToolInfo; spec: TransformSpec; initial?: Partial<ToolState> } = $props();

  // The page is re-created per tool, so reading the initial props once is intended.
  let input = $state(untrack(() => initial?.input ?? spec.input?.sample ?? ''));
  let options = $state<OptionValues>(untrack(() => resolveOptions(spec.options, loadItOptions(tool.id), initial?.options ?? {})));
  let output = $state<string | OutputRow[]>('');
  let error = $state('');
  let busy = $state(false);
  let picker: HTMLInputElement;

  const direction = $derived(spec.direction ? spec.options?.[spec.direction] : undefined);
  const otherOptions = $derived(Object.entries(spec.options ?? {}).filter(([k]) => k !== spec.direction));
  const outputText = $derived(
    typeof output === 'string' ? output : output.map((r) => (r.value.includes('\n') ? `${r.label}:\n${r.value}` : `${r.label}: ${r.value}`)).join('\n'),
  );
  const outputType = $derived(
    typeof output !== 'string' ? 'text/plain' : typeof spec.output?.type === 'function' ? spec.output.type(options) : (spec.output?.type ?? 'text/plain'),
  );

  $effect(() => saveItOptions(tool.id, publicOptions(spec.options, $state.snapshot(options))));

  // Re-run on every change; a short pause first so typing stays smooth, and
  // stale results from slower runs (e.g. key derivation) are dropped.
  let generation = 0;
  $effect(() => {
    const text = input;
    const values = $state.snapshot(options);
    const run = ++generation;
    const timer = setTimeout(async () => {
      busy = true;
      try {
        const result = await spec.run(text, values);
        if (run !== generation) return;
        output = result;
        error = '';
      } catch (e) {
        if (run !== generation) return;
        output = '';
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (run === generation) busy = false;
      }
    }, 120);
    return () => clearTimeout(timer);
  });

  function swap() {
    if (!direction || direction.kind !== 'choice' || typeof output !== 'string') return;
    const other = direction.choices.find((c) => c.value !== options[spec.direction!]);
    input = output;
    if (other) options[spec.direction!] = other.value;
  }

  async function openFile(files: FileList | null | undefined) {
    const f = files?.[0];
    if (f) input = await f.text();
  }

  async function paste() {
    try {
      input = await navigator.clipboard.readText();
    } catch {
      /* permission denied: the user can still paste with the keyboard */
    }
  }

  let linkCopied = $state(false);

  /** Built on click, not on every keystroke: packing a big input takes a moment. */
  async function copyLink() {
    const state = { input, options: publicOptions(spec.options, $state.snapshot(options)) };
    await navigator.clipboard.writeText(`${appUrl(location)}#/${tool.id}/${encodeToolState(state)}`);
    linkCopied = true;
    setTimeout(() => (linkCopied = false), 1200);
  }
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>{spec.input?.label ?? 'Input'}</h2>
      {#if spec.input?.sample}<button class="it-mini" onclick={() => (input = spec.input!.sample!)}>Example</button>{/if}
      <button class="it-mini" onclick={paste} title="Paste from clipboard">Paste</button>
      {#if !spec.input?.singleLine}<button class="it-mini" onclick={() => picker.click()} title="Load a text file">Open</button>{/if}
      <button class="it-mini" disabled={!input} onclick={() => (input = '')}>Clear</button>
    </div>
    <input bind:this={picker} type="file" hidden onchange={(e) => openFile(e.currentTarget.files)} />

    {#if direction?.kind === 'choice'}
      <div class="it-segmented" role="radiogroup" aria-label={direction.label}>
        {#each direction.choices as c (c.value)}
          <button role="radio" aria-checked={options[spec.direction!] === c.value} class:active={options[spec.direction!] === c.value} onclick={() => (options[spec.direction!] = c.value)}>{c.label}</button>
        {/each}
      </div>
    {/if}

    {#if spec.input?.singleLine}
      <input class="it-input" bind:value={input} placeholder={spec.input?.placeholder} spellcheck="false" aria-label={spec.input?.label ?? 'Input'} />
    {:else}
      <textarea
        class="it-text"
        bind:value={input}
        placeholder={spec.input?.placeholder ?? 'Type or paste here, or drop a text file…'}
        spellcheck="false"
        aria-label={spec.input?.label ?? 'Input'}
        ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
        ondrop={(e) => {
          if (!e.dataTransfer?.files.length) return;
          e.preventDefault();
          openFile(e.dataTransfer.files);
        }}
      ></textarea>
    {/if}

    {#if otherOptions.length}
      <div class="it-options">
        {#each otherOptions as [key, optionSpec] (key)}
          <OptionField spec={optionSpec} bind:value={options[key]} />
        {/each}
      </div>
      {#each otherOptions.filter(([, s]) => s.help) as [key, s] (key)}
        <p class="it-help">{s.help}</p>
      {/each}
    {/if}
  </section>

  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>{spec.output?.label ?? 'Output'}{#if busy}<span class="busy" aria-label="Working">…</span>{/if}</h2>
      {#if direction && typeof output === 'string' && output}<button class="it-mini" onclick={swap} title="Use the output as input, the other way round">⇅ Swap</button>{/if}
      <OutputActions text={error ? '' : outputText} name={spec.output?.name ?? tool.id} type={outputType} />
    </div>

    {#if error}
      <p class="it-error" role="alert">{error}</p>
    {:else if typeof output === 'string'}
      <textarea class="it-text" readonly value={output} aria-label="Output" spellcheck="false"></textarea>
    {:else if output.length}
      <dl class="it-rows">
        {#each output as row (row.label)}
          <div class="it-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
            <CopyButton text={row.value} />
          </div>
        {/each}
      </dl>
    {:else}
      <p class="it-help">Results appear here as you type.</p>
    {/if}

    {#if !spec.sensitive && input}
      <div class="link">
        <button class="it-mini" onclick={copyLink}>{linkCopied ? '✓ Copied' : '🔗 Copy link to this'}</button>
        <span class="it-help">Opens this tool with the same input. Nothing is uploaded: it travels inside the link.</span>
      </div>
    {/if}
  </section>
</div>

<style>
  .busy {
    margin-left: 6px;
    color: var(--text-3);
  }
  .link {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
</style>
