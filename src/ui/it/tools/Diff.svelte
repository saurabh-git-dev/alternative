<!-- Text diff: two texts side by side in, a coloured diff out (lines, words or characters). -->
<script lang="ts">
  import { diffChars, diffLines, diffWordsWithSpace, createTwoFilesPatch } from 'diff';
  import OutputActions from '../OutputActions.svelte';

  let { initial = '' }: { initial?: string } = $props();

  // svelte-ignore state_referenced_locally
  let before = $state(initial || 'The quick brown fox\njumps over the lazy dog.\nSee you soon.');
  let after = $state('The quick red fox\njumps over the lazy dog!\nSee you soon.\nBye.');
  let mode = $state<'lines' | 'words' | 'chars'>('words');
  let ignoreCase = $state(false);

  const parts = $derived(
    mode === 'lines'
      ? diffLines(before, after)
      : mode === 'words'
        ? diffWordsWithSpace(before, after, { ignoreCase })
        : diffChars(before, after, { ignoreCase }),
  );
  const added = $derived(parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0));
  const removed = $derived(parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0));
  const patch = $derived(createTwoFilesPatch('before', 'after', before, after, '', '', { context: 3 }));
  const unit = $derived(mode === 'lines' ? 'line' : mode === 'words' ? 'word' : 'character');
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="it-pane-head"><h2>Before</h2></div>
    <textarea class="it-text" bind:value={before} spellcheck="false" aria-label="Before"></textarea>
  </section>
  <section class="card it-pane">
    <div class="it-pane-head"><h2>After</h2><button class="it-mini" onclick={() => ([before, after] = [after, before])}>⇄ Swap</button></div>
    <textarea class="it-text" bind:value={after} spellcheck="false" aria-label="After"></textarea>
  </section>
</div>

<section class="card it-pane result">
  <div class="it-pane-head">
    <h2>
      {#if before === after}No differences{:else}<span class="add">+{added}</span> <span class="del">−{removed}</span> {unit}{added + removed === 1 ? '' : 's'}{/if}
    </h2>
    <div class="it-segmented">
      <button class:active={mode === 'lines'} onclick={() => (mode = 'lines')}>Lines</button>
      <button class:active={mode === 'words'} onclick={() => (mode = 'words')}>Words</button>
      <button class:active={mode === 'chars'} onclick={() => (mode = 'chars')}>Characters</button>
    </div>
    {#if mode !== 'lines'}<label class="it-field"><input type="checkbox" bind:checked={ignoreCase} /> Ignore case</label>{/if}
    <OutputActions text={before === after ? '' : patch} name="changes" />
  </div>
  <pre class="diff">{#each parts as p, i (i)}{#if p.added}<ins>{p.value}</ins>{:else if p.removed}<del>{p.value}</del>{:else}{p.value}{/if}{/each}</pre>
  <p class="it-help">Copy, Save and Share give the changes as a unified diff (patch).</p>
</section>

<style>
  .result {
    margin-top: 14px;
  }
  .diff {
    margin: 0;
    padding: 10px 12px;
    max-height: 480px;
    overflow: auto;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font: 13.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
  ins {
    background: var(--success-soft);
    color: var(--success);
    text-decoration: none;
  }
  del {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .add {
    color: var(--success);
  }
  .del {
    color: var(--danger);
  }
</style>
