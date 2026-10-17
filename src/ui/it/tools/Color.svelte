<!--
  Color converter: type a colour in any CSS form, or pick one, and get it in
  every format, with contrast against white and black text.
-->
<script lang="ts">
  import { contrast, formatColor, parseColor, type Rgba } from '../../../it/lib/numbers';
  import CopyButton from '../CopyButton.svelte';

  let { initial = '' }: { initial?: string } = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(initial.trim() || '#4f46e5');
  const parsed = $derived.by((): Rgba | string => {
    try {
      return parseColor(text);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  const color = $derived(typeof parsed === 'string' ? null : parsed);
  const formats = $derived(color ? formatColor(color) : null);
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const grade = (ratio: number) => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'fails');
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="pick">
      <input type="color" value={formats?.hex.slice(0, 7) ?? '#000000'} oninput={(e) => (text = e.currentTarget.value)} aria-label="Pick a colour" />
      <input class="it-input" bind:value={text} placeholder="#4f46e5, rgb(79 70 229), hsl(…), orange" spellcheck="false" />
    </div>
    {#if typeof parsed === 'string'}<p class="it-error">{parsed}</p>{/if}
    {#if color && formats}
      <div class="swatch" style:background={formats.rgb}>
        <span style:color="#fff">Aa white text · {contrast(color, white)}:1 {grade(contrast(color, white))}</span>
        <span style:color="#000">Aa black text · {contrast(color, black)}:1 {grade(contrast(color, black))}</span>
      </div>
    {/if}
  </section>
  <section class="card it-pane">
    <div class="it-pane-head"><h2>Formats</h2></div>
    {#if formats}
      <dl class="it-rows">
        {#each Object.entries(formats) as [label, value] (label)}
          <div class="it-row"><dt>{label.toUpperCase()}</dt><dd>{value}</dd><CopyButton text={value} /></div>
        {/each}
      </dl>
    {/if}
  </section>
</div>

<style>
  .pick {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  input[type='color'] {
    flex: none;
    width: 46px;
    height: 40px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .swatch {
    display: grid;
    gap: 6px;
    place-content: center;
    min-height: 140px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    font-weight: 600;
    text-align: center;
  }
</style>
