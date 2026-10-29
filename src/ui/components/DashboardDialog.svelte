<!--
  Customize the home page: tick the tools it shows, grouped like the home
  page. Searching on the home page still finds every tool, ticked or not.
-->
<script lang="ts" module>
  export interface DashboardTool {
    key: string;
    icon: string;
    title: string;
    description: string;
  }
  /** A starting set for one kind of user, e.g. everyday or developer. */
  export interface DashboardPreset {
    id: string;
    icon: string;
    label: string;
    keys: string[];
  }
  export interface DashboardPanel {
    id: string;
    icon: string;
    label: string;
    tools: DashboardTool[];
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';

  let {
    panels,
    selected,
    presets,
    onSave,
    onClose,
  }: {
    panels: DashboardPanel[];
    selected: string[];
    /** The first one is the default. */
    presets: DashboardPreset[];
    /** The ticked keys, in home page order. */
    onSave: (keys: string[]) => void;
    onClose: () => void;
  } = $props();

  /** Starts from the tools shown now; the dashboard only changes on Save. */
  const picked = new SvelteSet(untrack(() => selected));
  let filter = $state('');
  let box: HTMLInputElement;

  const shown = $derived.by(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return panels
      .map((p) => ({ ...p, tools: p.tools.filter((t) => words.every((w) => `${t.title} ${t.description} ${p.label}`.toLowerCase().includes(w))) }))
      .filter((p) => p.tools.length);
  });

  function setAll(tools: DashboardTool[], on: boolean) {
    for (const t of tools) {
      if (on) picked.add(t.key);
      else picked.delete(t.key);
    }
  }

  function apply(preset: DashboardPreset) {
    picked.clear();
    for (const k of preset.keys) picked.add(k);
  }
  /** The preset the ticks match exactly, if any. */
  const current = $derived(presets.find((p) => p.keys.length === picked.size && p.keys.every((k) => picked.has(k))));

  function save() {
    onSave(panels.flatMap((p) => p.tools.map((t) => t.key)).filter((k) => picked.has(k)));
  }

  $effect(() => {
    box.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (Escape closes it too) -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
    <header>
      <h2 id="dashboard-title">Customize your dashboard</h2>
      <p class="muted">Start from a preset, then tick the tools you want on the home page. Search still finds every tool.</p>
      <div class="presets" role="group" aria-label="Presets">
        {#each presets as p (p.id)}
          <button class="preset" class:active={current === p} aria-pressed={current === p} onclick={() => apply(p)}>
            <span aria-hidden="true">{p.icon}</span> {p.label}
          </button>
        {/each}
      </div>
      <input bind:this={box} class="filter" type="search" placeholder="Filter tools" aria-label="Filter tools" bind:value={filter} />
    </header>

    <div class="list">
      {#each shown as panel (panel.id)}
        {@const on = panel.tools.filter((t) => picked.has(t.key)).length}
        <section>
          <h3>
            <span><span aria-hidden="true">{panel.icon}</span> {panel.label} <span class="count">{on}/{panel.tools.length}</span></span>
            <span class="bulk">
              <button onclick={() => setAll(panel.tools, true)} disabled={on === panel.tools.length}>All</button>
              <button onclick={() => setAll(panel.tools, false)} disabled={on === 0}>None</button>
            </span>
          </h3>
          <div class="tools">
            {#each panel.tools as t (t.key)}
              <label class="tool" class:on={picked.has(t.key)} title={t.description}>
                <input type="checkbox" checked={picked.has(t.key)} onchange={(e) => setAll([t], e.currentTarget.checked)} />
                <span class="icon" aria-hidden="true">{t.icon}</span>
                <span class="title">{t.title}</span>
              </label>
            {/each}
          </div>
        </section>
      {:else}
        <p class="muted none">No tools match.</p>
      {/each}
    </div>

    <footer>
      <button class="btn reset" onclick={() => apply(presets[0])}>Reset to default</button>
      <span class="muted picked">{picked.size} shown</span>
      <button class="btn" onclick={onClose}>Cancel</button>
      <button class="btn btn-primary" onclick={save}>Save</button>
    </footer>
  </div>
</div>

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
    width: min(760px, 100%);
    max-height: min(720px, calc(100dvh - 32px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
  }
  header {
    display: grid;
    gap: 6px;
    padding: 18px 18px 12px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  header p {
    margin: 0;
    font-size: 14px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .preset {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: 13.5px;
  }
  .preset:hover {
    border-color: var(--accent);
  }
  .preset.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .filter {
    margin-top: 4px;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .list {
    overflow-y: auto;
    padding: 6px 18px 12px;
  }
  h3 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin: 12px 0 6px;
    font-size: 14px;
  }
  .count {
    color: var(--text-3);
    font-weight: 500;
    font-size: 12.5px;
  }
  .bulk {
    display: flex;
    gap: 4px;
  }
  .bulk button {
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: 12.5px;
  }
  .bulk button:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .bulk button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .tools {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 4px;
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 14px;
  }
  .tool:hover {
    border-color: var(--accent);
  }
  .tool.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .tool input {
    margin: 0;
    accent-color: var(--accent);
  }
  .icon {
    font-size: 16px;
    line-height: 1;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .none {
    text-align: center;
    margin: 24px 0;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
  }
  .picked {
    margin-left: auto;
    font-size: 13px;
  }
  footer .btn {
    padding: 8px 14px;
  }
  @media (max-width: 560px) {
    .tools {
      grid-template-columns: 1fr 1fr;
    }
    footer {
      flex-wrap: wrap;
    }
    .picked {
      order: -1;
      width: 100%;
      margin: 0;
    }
    .reset {
      margin-right: auto;
    }
  }
</style>
