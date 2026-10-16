<!--
  List of loaded files with thumbnail, size and page count.
  When `reorderable`, files can be dragged (or moved with the arrow buttons)
  because order matters, e.g. for merging.
-->
<script lang="ts" module>
  import type { FileData } from '../../core/types';

  export interface Item {
    id: string;
    data: FileData;
    thumb?: string;
    pages?: number;
    encrypted?: boolean;
    error?: string;
  }
</script>

<script lang="ts">
  import { formatBytes } from '../../core/files';

  let { items = $bindable(), reorderable = false }: { items: Item[]; reorderable?: boolean } = $props();

  let dragging = $state<number | null>(null);

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    items = next;
  }

  function remove(index: number) {
    items = items.filter((_, i) => i !== index);
  }
</script>

<ul class="list">
  {#each items as item, i (item.id)}
    <li
      class="card"
      class:dragging={dragging === i}
      draggable={reorderable}
      ondragstart={() => (dragging = i)}
      ondragend={() => (dragging = null)}
      ondragover={(e) => {
        e.preventDefault();
        if (dragging !== null && dragging !== i) {
          move(dragging, i);
          dragging = i;
        }
      }}
    >
      {#if reorderable}<span class="grip" aria-hidden="true">⋮⋮</span>{/if}
      <div class="thumb">
        {#if item.thumb}
          <img src={item.thumb} alt="" />
        {:else}
          <span>{item.data.type === 'application/pdf' ? 'PDF' : '…'}</span>
        {/if}
      </div>
      <div class="meta">
        <div class="name" title={item.data.name}>{item.data.name}</div>
        <div class="muted small">
          {formatBytes(item.data.bytes.length)}
          {#if item.pages}· {item.pages} page{item.pages > 1 ? 's' : ''}{/if}
          {#if item.encrypted}· <span class="lock">🔒 password-protected</span>{/if}
        </div>
        {#if item.error}<div class="err small">{item.error}</div>{/if}
      </div>
      {#if reorderable}
        <button class="icon-btn" aria-label="Move up" disabled={i === 0} onclick={() => move(i, i - 1)}>↑</button>
        <button class="icon-btn" aria-label="Move down" disabled={i === items.length - 1} onclick={() => move(i, i + 1)}>↓</button>
      {/if}
      <button class="icon-btn" aria-label="Remove {item.data.name}" onclick={() => remove(i)}>✕</button>
    </li>
  {/each}
</ul>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    box-shadow: none;
  }
  li.dragging {
    opacity: 0.5;
    border-color: var(--accent);
  }
  li[draggable='true'] {
    cursor: grab;
  }
  .grip {
    color: var(--text-3);
    letter-spacing: -3px;
  }
  .thumb {
    width: 48px;
    height: 60px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 11px;
    font-weight: 700;
    color: var(--text-3);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: white;
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: 550;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .small {
    font-size: 13px;
  }
  .lock {
    color: var(--warning);
  }
  .err {
    color: var(--danger);
  }
  .icon-btn:disabled {
    opacity: 0.3;
  }
</style>
