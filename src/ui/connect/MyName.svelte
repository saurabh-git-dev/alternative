<!--
  This device's name, as connected devices see it ("Blue Otter" by
  default, picked at random once and kept in this browser). Rename it, or
  pick a new random one; connected devices see the change at once.
-->
<script lang="ts">
  import { hub, setMyName } from './devices.svelte';

  let editing = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement>();

  function start() {
    draft = hub.me;
    editing = true;
    queueMicrotask(() => input?.select());
  }

  function save() {
    if (draft.trim()) setMyName(draft);
    editing = false;
  }
</script>

<div class="me">
  {#if editing}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label for="my-name" class="muted small">This device's name</label>
      <input id="my-name" bind:this={input} bind:value={draft} maxlength="40" onkeydown={(e) => e.key === 'Escape' && (editing = false)} />
      <button class="btn btn-primary" disabled={!draft.trim()}>Save</button>
      <button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
    </form>
  {:else}
    <span class="small">Other devices see this one as <strong>{hub.me}</strong></span>
    <button class="link small" onclick={start}>Rename</button>
    <button class="link small" title="Pick a new random name" onclick={() => setMyName()}>New random name</button>
  {/if}
</div>

<style>
  .me,
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }
  .me {
    margin-bottom: 14px;
  }
  input {
    flex: 1;
    min-width: 160px;
    max-width: 280px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .btn {
    padding: 6px 12px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .small {
    font-size: 13px;
  }
</style>
