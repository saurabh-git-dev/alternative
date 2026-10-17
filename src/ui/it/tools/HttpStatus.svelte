<!-- HTTP status code reference with search. -->
<script lang="ts">
  import { HTTP_STATUSES } from '../../../it/lib/http-status';

  let { initial = '' }: { initial?: string } = $props();
  // svelte-ignore state_referenced_locally
  let query = $state(initial);

  const GROUPS: Record<number, string> = { 1: 'Informational', 2: 'Success', 3: 'Redirection', 4: 'Client error', 5: 'Server error' };
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return HTTP_STATUSES.filter(([code, name, meaning]) => !q || `${code} ${name} ${meaning}`.toLowerCase().includes(q));
  });
</script>

<section class="card it-pane">
  <input class="it-input plain" type="search" bind:value={query} placeholder="Search, e.g. 404 or redirect" aria-label="Search status codes" />
  {#each Object.entries(GROUPS) as [digit, label] (digit)}
    {@const rows = shown.filter(([c]) => Math.floor(c / 100) === Number(digit))}
    {#if rows.length}
      <h2>{digit}xx · {label}</h2>
      <dl class="it-rows">
        {#each rows as [code, name, meaning] (code)}
          <div class="row"><dt class="code c{digit}">{code}</dt><dd><strong>{name}</strong><span class="muted">{meaning}</span></dd></div>
        {/each}
      </dl>
    {/if}
  {/each}
  {#if !shown.length}<p class="it-help">No status code matches.</p>{/if}
</section>

<style>
  h2 {
    margin: 8px 0 0;
    font-size: 14px;
    color: var(--text-2);
  }
  .row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 10px;
    padding: 7px 4px;
    border-bottom: 1px solid var(--border);
  }
  .code {
    font: 700 15px ui-monospace, monospace;
  }
  .c2 {
    color: var(--success);
  }
  .c3 {
    color: var(--accent);
  }
  .c4 {
    color: var(--warning);
  }
  .c5 {
    color: var(--danger);
  }
  dd {
    margin: 0;
    display: grid;
    font-size: 14px;
  }
</style>
