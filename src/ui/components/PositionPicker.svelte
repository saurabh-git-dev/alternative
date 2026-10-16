<!-- 3×3 anchor grid. Value format: `<top|middle|bottom>-<left|center|right>`. -->
<script lang="ts">
  let { value = $bindable() }: { value: string } = $props();

  const rows = ['top', 'middle', 'bottom'];
  const cols = ['left', 'center', 'right'];
</script>

<div class="grid" role="radiogroup" aria-label="Position">
  {#each rows as row (row)}
    {#each cols as col (col)}
      {@const v = `${row}-${col}`}
      <button
        role="radio"
        aria-checked={value === v}
        aria-label={`${row} ${col}`}
        class:active={value === v}
        onclick={() => (value = v)}
      ><span></span></button>
    {/each}
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 34px);
    gap: 4px;
    padding: 6px;
    width: fit-content;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  button {
    height: 26px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
  }
  span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
  }
  button.active {
    border-color: var(--accent);
  }
  button.active span {
    background: var(--accent);
  }
</style>
