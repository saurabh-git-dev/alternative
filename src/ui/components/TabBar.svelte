<!--
  The app's own tabs (see tabs.svelte.ts), shown once two or more are open:
  click to switch, ✕ or middle-click to close, ＋ for a new tab on the
  Dashboard. "Split" shows the most recently used tabs side by side (two,
  or three on very wide screens); it's offered on wide screens only.
-->
<script lang="ts">
  import { describeRoute, parseRoute } from '../routes';
  import { MAX_TABS, activate, closeTab, openTab, toggleSplit, workspace, type Tab } from '../tabs.svelte';

  let { native, canSplit, shown }: { native: boolean; canSplit: boolean; shown: Tab[] } = $props();

  function onKey(e: KeyboardEvent, i: number) {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
    const tab = workspace.tabs[to];
    if (!tab) return;
    e.preventDefault();
    activate(tab.id);
    (e.currentTarget as HTMLElement).parentElement?.parentElement?.querySelectorAll<HTMLElement>('[role=tab]')[to]?.focus();
  }
</script>

<div class="bar">
  <div class="tabs" role="tablist" aria-label="Open tabs">
    {#each workspace.tabs as tab, i (tab.id)}
      {@const d = describeRoute(parseRoute(tab.hash, native), tab.section)}
      {@const current = tab.id === workspace.active}
      <div class="tab" class:current class:shown={!current && shown.includes(tab)}>
        <button
          role="tab"
          aria-selected={current}
          tabindex={current ? 0 : -1}
          title={d.title}
          onclick={() => activate(tab.id)}
          onauxclick={(e) => e.button === 1 && closeTab(tab.id)}
          onkeydown={(e) => onKey(e, i)}
        >
          <span aria-hidden="true">{d.icon}</span>
          <span class="title">{d.title}</span>
        </button>
        <button class="close" aria-label="Close {d.title}" title="Close tab" onclick={() => closeTab(tab.id)}>✕</button>
      </div>
    {/each}
    <button class="add" onclick={() => openTab()} disabled={workspace.tabs.length >= MAX_TABS} title="New tab" aria-label="New tab">＋</button>
  </div>
  {#if canSplit}
    <button class="split" aria-pressed={workspace.split} onclick={toggleSplit} title={workspace.split ? 'Show one tab at a time' : 'Show tabs side by side'}>
      <span aria-hidden="true">◫</span> {workspace.split ? 'Single' : 'Split'}
    </button>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    order: 2;
  }
  .tabs {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    flex: none;
    display: flex;
    align-items: center;
    max-width: 220px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--text-2);
  }
  .tab.shown {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .tab.current {
    background: var(--surface);
    border-color: var(--accent);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .tab button {
    border: 0;
    background: none;
    color: inherit;
  }
  [role='tab'] {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 5px 4px 5px 10px;
    font-size: 13.5px;
    font-weight: 550;
  }
  .title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .close {
    flex: none;
    padding: 4px 8px;
    border-radius: 7px;
    font-size: 11px;
    opacity: 0.6;
  }
  .close:hover {
    opacity: 1;
    background: var(--surface-2);
  }
  .add,
  .split {
    flex: none;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    font-size: 13.5px;
  }
  .add:hover:not(:disabled),
  .split:hover {
    border-color: var(--accent);
  }
  .add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .split[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
</style>
