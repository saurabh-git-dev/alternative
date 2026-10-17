<!--
  Number base converter: edit any field and the others follow. Uses BigInt,
  so numbers of any size convert exactly.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { formatBigInt, parseBigInt } from '../../../it/lib/numbers';
  import CopyButton from '../CopyButton.svelte';

  let { initial = '' }: { initial?: string } = $props();

  const BASES = [
    { base: 2, label: 'Binary (2)' },
    { base: 8, label: 'Octal (8)' },
    { base: 10, label: 'Decimal (10)' },
    { base: 16, label: 'Hexadecimal (16)' },
    { base: 36, label: 'Base 36' },
  ];

  let custom = $state(32);
  let value = $state<bigint | null>(null);
  let error = $state<{ base: number; message: string } | null>(null);
  /** What the user is typing in the field they're editing, kept as typed. */
  let editing = $state<{ base: number; text: string } | null>(null);

  function set(base: number, text: string) {
    editing = { base, text };
    if (!text.trim()) {
      value = null;
      error = null;
      return;
    }
    try {
      value = parseBigInt(text, base);
      error = null;
    } catch (e) {
      error = { base, message: e instanceof Error ? e.message : String(e) };
    }
  }

  untrack(() => set(10, initial.trim() || '255'));
  editing = null;

  const shown = (base: number) => (editing?.base === base ? editing.text : value === null ? '' : formatBigInt(value, base));
  const all = $derived([...BASES, { base: custom, label: `Base ${custom}` }]);
</script>

<section class="card it-pane narrow">
  {#each all as b, i (i)}
    <label class="field">
      <span>
        {#if i === BASES.length}
          Base <input class="base" type="number" min="2" max="36" bind:value={custom} onfocus={() => (editing = null)} />
        {:else}{b.label}{/if}
      </span>
      <div class="line">
        <input class="it-input" value={shown(b.base)} oninput={(e) => set(b.base, e.currentTarget.value)} onblur={() => (editing = null)} spellcheck="false" inputmode={b.base <= 10 ? 'numeric' : 'text'} />
        <CopyButton text={value === null ? '' : formatBigInt(value, b.base)} />
      </div>
      {#if error?.base === b.base}<span class="it-help bad">{error.message}</span>{/if}
    </label>
  {/each}
  {#if value !== null}
    <p class="it-help">{value.toString(2).replace('-', '').length} bits{value >= 0n && value < 2n ** 53n ? ` · ${Number(value).toLocaleString()}` : ''}</p>
  {/if}
</section>

<style>
  .narrow {
    max-width: 720px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 14px;
    color: var(--text-2);
  }
  .line {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .base {
    width: 64px;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }
  .bad {
    color: var(--danger);
  }
</style>
