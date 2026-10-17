<!-- Lorem ipsum generator. -->
<script lang="ts">
  import type { ItToolProps } from '../../../it/types';
  import { lorem } from '../../../it/lib/text';
  import { loadItOptions, saveItOptions } from '../../settings';
  import OutputActions from '../OutputActions.svelte';

  // Takes no starting input, but accepts the props every IT tool gets.
  let _props: ItToolProps = $props();

  const saved = loadItOptions('lorem');
  let paragraphs = $state(typeof saved.paragraphs === 'number' ? saved.paragraphs : 3);
  let sentences = $state(typeof saved.sentences === 'number' ? saved.sentences : 5);
  let classic = $state(saved.classic !== false);
  let html = $state(!!saved.html);
  let nonce = $state(0);

  $effect(() => saveItOptions('lorem', { paragraphs, sentences, classic, html }));

  const text = $derived.by(() => {
    void nonce;
    const out = lorem(Math.min(100, Math.max(1, paragraphs)), Math.min(30, Math.max(1, sentences)), classic);
    return html ? out.split('\n\n').map((p) => `<p>${p}</p>`).join('\n') : out;
  });
</script>

<section class="card it-pane">
  <div class="it-options">
    <label class="it-field"><span>Paragraphs</span><input type="number" min="1" max="100" bind:value={paragraphs} /></label>
    <label class="it-field"><span>Sentences each</span><input type="number" min="1" max="30" bind:value={sentences} /></label>
    <label class="it-field"><input type="checkbox" bind:checked={classic} /> Start with “Lorem ipsum”</label>
    <label class="it-field"><input type="checkbox" bind:checked={html} /> As HTML &lt;p&gt;</label>
  </div>
  <div class="it-pane-head">
    <h2>{text.split(/\s+/).length} words</h2>
    <button class="it-mini" onclick={() => nonce++}>↻ New</button>
    <OutputActions {text} name="lorem-ipsum" />
  </div>
  <textarea class="it-text tall" readonly value={text} aria-label="Lorem ipsum"></textarea>
</section>

<style>
  .tall {
    min-height: 320px;
  }
</style>
