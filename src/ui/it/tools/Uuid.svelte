<!-- UUID v4 / v7 and ULID generator, plus reading the time out of a v7 or ULID. -->
<script lang="ts">
  import { idTimestamp, ulid, uuidV4, uuidV7 } from '../../../it/lib/ids';
  import { loadItOptions, saveItOptions } from '../../settings';
  import OutputActions from '../OutputActions.svelte';

  let { initial = '' }: { initial?: string } = $props();

  const KINDS = { v4: 'UUID v4 (random)', v7: 'UUID v7 (time-ordered)', ulid: 'ULID' } as const;
  type Kind = keyof typeof KINDS;
  const saved = loadItOptions('uuid');
  let kind = $state<Kind>((saved.kind as Kind) in KINDS ? (saved.kind as Kind) : 'v4');
  let count = $state(typeof saved.count === 'number' ? saved.count : 5);
  let upper = $state(!!saved.upper);
  let hyphens = $state(saved.hyphens !== false);
  let nonce = $state(0);
  // svelte-ignore state_referenced_locally
  let inspect = $state(initial);

  $effect(() => saveItOptions('uuid', { kind, count, upper, hyphens }));

  const ids = $derived.by(() => {
    void nonce;
    const make = kind === 'v4' ? uuidV4 : kind === 'v7' ? () => uuidV7() : () => ulid();
    return Array.from({ length: Math.min(1000, Math.max(1, count)) }, () => {
      let id = make();
      if (kind !== 'ulid' && !hyphens) id = id.replace(/-/g, '');
      return upper ? id.toUpperCase() : kind === 'ulid' ? id : id.toLowerCase();
    }).join('\n');
  });
  const when = $derived(inspect.trim() ? idTimestamp(inspect) : null);
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="it-segmented">
      {#each Object.entries(KINDS) as [k, label] (k)}
        <button class:active={kind === k} onclick={() => (kind = k as Kind)}>{label}</button>
      {/each}
    </div>
    <div class="it-options">
      <label class="it-field"><span>How many</span><input type="number" min="1" max="1000" bind:value={count} /></label>
      <label class="it-field"><input type="checkbox" bind:checked={upper} /> Upper case</label>
      {#if kind !== 'ulid'}<label class="it-field"><input type="checkbox" bind:checked={hyphens} /> Hyphens</label>{/if}
    </div>
    <p class="it-help">
      {#if kind === 'v4'}122 random bits. The usual choice.{:else if kind === 'v7'}Starts with the creation time, so ids sort by age, which keeps database indexes fast.{:else}26 characters, sortable by time, no hyphens; easy to read aloud.{/if}
    </p>
    <h2 class="sub">Read the time inside an id</h2>
    <input class="it-input" bind:value={inspect} placeholder="Paste a UUID v7 or ULID" spellcheck="false" />
    {#if inspect.trim()}
      <p class="it-help">{when ? `Created ${when.toISOString()} (${when.toLocaleString()})` : 'Only UUID v7 and ULID carry a time.'}</p>
    {/if}
  </section>
  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>{count > 1 ? `${count} ids` : 'Id'}</h2>
      <button class="it-mini" onclick={() => nonce++}>↻ New</button>
      <OutputActions text={ids} name="ids" />
    </div>
    <textarea class="it-text" readonly value={ids} rows={Math.min(14, count + 1)} aria-label="Generated ids"></textarea>
  </section>
</div>

<style>
  .sub {
    margin: 6px 0 0;
    font-size: 14px;
    color: var(--text-2);
  }
</style>
