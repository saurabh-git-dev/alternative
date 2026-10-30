<!--
  Summarize: the gist of a PDF, Word file, web page, image of text or pasted
  text, made on this device. Two ways, picked automatically:

  - On-device AI (lib/ai-summarizer.ts): the browser's own model, which
    rewrites the text in its own words. Recent desktop Chrome and Edge.
  - Key sentences (lib/summarize.ts): the sentences that best represent the
    text, picked by TextRank. Every browser, instant, no download.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ItToolProps } from '../../../it/types';
  import { aiAvailability, aiSummary, type AiAvailability } from '../../../it/lib/ai-summarizer';
  import { DOCUMENT_ACCEPT, documentText } from '../../../it/lib/document-text';
  import { extractiveSummary, formatSentences, wordCount, type SummaryFormat, type SummaryLength } from '../../../it/lib/summarize';
  import Dropzone from '../../components/Dropzone.svelte';
  import OutputActions from '../OutputActions.svelte';

  let { initial = '' }: ItToolProps = $props();

  type Method = 'auto' | 'ai' | 'sentences';

  // svelte-ignore state_referenced_locally
  let text = $state(initial);
  let fileName = $state('');
  let method = $state<Method>('auto');
  let length = $state<SummaryLength>('medium');
  let format = $state<SummaryFormat>('bullets');

  let summary = $state('');
  /** How the shown summary was made, for the note under it. */
  let madeWith = $state<'ai' | 'sentences' | null>(null);
  let note = $state('');
  let error = $state('');
  let busy = $state(false);
  let progress = $state(0);
  let status = $state('');
  let controller: AbortController | null = null;

  let ai = $state<AiAvailability>('unavailable');
  aiAvailability().then((a) => (ai = a));
  const hasAi = $derived(ai !== 'unavailable');

  const words = $derived(wordCount(text));

  async function onFiles([file]: File[]) {
    stop();
    error = '';
    summary = '';
    fileName = file.name;
    busy = true;
    status = 'Reading the file';
    progress = 0;
    try {
      const read = await documentText(file, (f, m) => {
        progress = f;
        status = m;
      });
      if (!read.trim()) throw new Error(`No text found in ${file.name}.`);
      text = read;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      fileName = '';
      return;
    } finally {
      busy = false;
    }
    await summarize();
  }

  async function summarize() {
    stop();
    error = '';
    note = '';
    const input = text.trim();
    if (wordCount(input) < 40) {
      error = 'Add a longer text (at least a few sentences) to summarize.';
      return;
    }
    const useAi = method === 'ai' || (method === 'auto' && hasAi);
    if (!useAi) {
      showSentences(input);
      return;
    }
    const run = (controller = new AbortController());
    busy = true;
    progress = 0;
    try {
      summary = await aiSummary(input, {
        length,
        format,
        signal: run.signal,
        onProgress: (f, m) => {
          progress = f;
          status = m;
        },
      });
      madeWith = 'ai';
      ai = 'available';
    } catch (e) {
      if (run.signal.aborted) return;
      // The model can refuse or fail (not enough disk space, unsupported language …): still give a summary.
      showSentences(input);
      note = `On-device AI didn't work here (${e instanceof Error ? e.message : String(e)}), so these are the key sentences instead.`;
    } finally {
      if (controller === run) {
        busy = false;
        controller = null;
      }
    }
  }

  function showSentences(input: string) {
    const result = extractiveSummary(input, length);
    summary = formatSentences(result.sentences, format);
    madeWith = 'sentences';
  }

  function stop() {
    controller?.abort();
    controller = null;
    busy = false;
  }
  onDestroy(stop);

  function clear() {
    stop();
    text = '';
    fileName = '';
    summary = '';
    error = '';
    note = '';
  }

  const outWords = $derived(wordCount(summary));
  const saveName = $derived(fileName ? `${fileName.replace(/\.[^.]+$/, '')}-summary` : 'summary');
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>Text to summarize</h2>
      {#if text}<button class="it-mini" onclick={clear}>Clear</button>{/if}
    </div>
    <Dropzone accept={DOCUMENT_ACCEPT} multiple={false} compact paste label="Drop a PDF, Word, text or image file here" {onFiles} />
    <textarea
      class="it-text plain"
      bind:value={text}
      oninput={() => (fileName = '')}
      placeholder="…or paste an article, report, email or notes"
      aria-label="Text to summarize"
    ></textarea>
    <p class="it-help">
      {#if fileName}{fileName} · {/if}{words.toLocaleString()} words. Read on this device; nothing is uploaded.
    </p>

    <div class="it-options">
      <div class="it-field">
        <span>Length</span>
        <div class="it-segmented">
          <button class:active={length === 'short'} onclick={() => (length = 'short')}>Short</button>
          <button class:active={length === 'medium'} onclick={() => (length = 'medium')}>Medium</button>
          <button class:active={length === 'long'} onclick={() => (length = 'long')}>Long</button>
        </div>
      </div>
      <div class="it-field">
        <span>As</span>
        <div class="it-segmented">
          <button class:active={format === 'bullets'} onclick={() => (format = 'bullets')}>Bullet points</button>
          <button class:active={format === 'paragraph'} onclick={() => (format = 'paragraph')}>Paragraph</button>
        </div>
      </div>
      <label class="it-field">
        <span>Method</span>
        <select bind:value={method}>
          <option value="auto">Best available</option>
          <option value="ai" disabled={!hasAi}>On-device AI{hasAi ? '' : ' (not in this browser)'}</option>
          <option value="sentences">Key sentences</option>
        </select>
      </label>
    </div>
    <p class="it-help">
      {#if !hasAi}
        Key sentences: the sentences that sum up the text best, picked instantly. For summaries written in new words, open this in
        desktop Chrome or Edge, which have a built-in AI.
      {:else if ai === 'available'}
        On-device AI is ready: summaries are written in new words, by a model that runs on this device.
      {:else}
        On-device AI is available: your browser downloads its model once (about 2 GB) the first time. Pick Key sentences to skip it.
      {/if}
    </p>
    <div class="actions">
      {#if busy}
        <button class="btn" onclick={stop}>Stop</button>
      {:else}
        <button class="btn btn-primary" onclick={summarize} disabled={!text.trim()}>Summarize</button>
      {/if}
    </div>
  </section>

  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>Summary</h2>
      <OutputActions text={busy ? '' : summary} name={saveName} />
    </div>
    {#if error}
      <p class="it-error">{error}</p>
    {/if}
    {#if busy}
      <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style:width="{Math.max(4, progress * 100)}%"></span>
      </div>
      <p class="it-help">{status}…</p>
    {:else if summary}
      {#if summary.startsWith('• ')}
        <ul class="summary">
          {#each summary.split('\n') as line, i (i)}<li>{line.replace(/^• /, '')}</li>{/each}
        </ul>
      {:else}
        <div class="summary">{summary}</div>
      {/if}
      <p class="it-help">
        {madeWith === 'ai' ? 'Written by on-device AI' : 'Key sentences from the text'} · {words.toLocaleString()} → {outWords.toLocaleString()} words.
        {#if madeWith === 'ai'}AI can get details wrong; check anything important.{/if}
      </p>
      {#if note}<p class="it-help">{note}</p>{/if}
    {:else if !error}
      <p class="it-help">The summary appears here.</p>
    {/if}
  </section>
</div>

<style>
  .plain {
    font: inherit;
    font-size: 14.5px;
    line-height: 1.55;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .summary {
    white-space: pre-wrap;
    font-size: 15px;
    line-height: 1.6;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow-wrap: anywhere;
  }
  ul.summary {
    margin: 0;
    padding-left: 2em;
    display: grid;
    gap: 6px;
  }
  .bar {
    height: 6px;
    border-radius: 99px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }
</style>
