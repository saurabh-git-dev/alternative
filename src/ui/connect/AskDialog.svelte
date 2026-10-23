<!--
  Accept incoming files? Shows the oldest question from connect/asks.svelte.ts:
  who is sending, what, and how big, with a warning for batches over 1 GB.
-->
<script lang="ts">
  import { formatBytes } from '../../core/files';
  import { answer, asks } from './asks.svelte';

  const ask = $derived(asks.list[0]);
</script>

{#if ask}
  <div class="backdrop">
    <div class="dialog card" role="alertdialog" aria-labelledby="ask-title" aria-describedby="ask-what">
      <h2 id="ask-title">📥 {ask.from} wants to send you {ask.files.length === 1 ? 'a file' : `${ask.files.length} files`}</h2>
      <p id="ask-what" class="muted">{formatBytes(ask.total)} in total{ask.stranger ? ' · not a paired device' : ''}</p>
      {#if ask.huge}
        <p class="warn">⚠️ This is over 1 GB. Make sure you have room for it and expect it to take a while.</p>
      {/if}
      <ul>
        {#each ask.files.slice(0, 6) as f, i (i)}
          <li><span class="name">{f.name}</span> <span class="muted">{formatBytes(f.size)}</span></li>
        {/each}
        {#if ask.files.length > 6}<li class="muted">and {ask.files.length - 6} more</li>{/if}
      </ul>
      <div class="actions">
        <button class="btn" onclick={() => answer(ask.id, false)}>Decline</button>
        <button class="btn btn-primary" onclick={() => answer(ask.id, true)}>Accept</button>
      </div>
      {#if asks.list.length > 1}<p class="muted small">{asks.list.length - 1} more waiting</p>{/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.4);
  }
  .dialog {
    width: min(440px, 100%);
    display: grid;
    gap: 10px;
    padding: 18px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
  .warn {
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warning) 15%, transparent);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
    font-size: 14px;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .small {
    font-size: 12px;
  }
</style>
