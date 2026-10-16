<!--
  Settings panel generated from an action's parameter schema.

  Layout: presets first (if any), then basic parameters, then an "Advanced"
  drawer with everything else. "Reset to recommended" restores the defaults.
-->
<script lang="ts">
  import type { ActionDefinition, ParamValues } from '../../core/types';
  import { applyPreset, initialValues, isVisible, isWorkspaceParam, matchingPreset } from '../../core/params';
  import ParamField from './ParamField.svelte';

  let {
    action,
    values = $bindable(),
    errors,
  }: { action: ActionDefinition; values: ParamValues; errors: Record<string, string> } = $props();

  const entries = $derived(Object.entries(action.params).filter(([, s]) => !isWorkspaceParam(s)));
  const basic = $derived(entries.filter(([, s]) => !s.advanced));
  const advanced = $derived(entries.filter(([, s]) => s.advanced));
  const recommended = $derived(initialValues(action));

  const activePreset = $derived(matchingPreset(action, values));
  let showAdvanced = $state(false);

  function reset() {
    const fresh = initialValues(action);
    // Keep per-document values such as page order or crop box.
    for (const [key, spec] of Object.entries(action.params)) if (isWorkspaceParam(spec)) fresh[key] = values[key];
    values = fresh;
  }

  const isDefault = $derived(entries.every(([k]) => JSON.stringify(values[k]) === JSON.stringify(recommended[k])));
</script>

<div class="panel">
  {#if action.presets?.length}
    <div class="presets" role="radiogroup" aria-label="Preset">
      {#each action.presets as preset (preset.id)}
        <button
          class="preset"
          class:active={activePreset === preset.id}
          role="radio"
          aria-checked={activePreset === preset.id}
          onclick={() => (values = applyPreset(action, preset.id, values))}
        >
          <span class="label">{preset.label}{preset.id === action.defaultPreset ? ' ★' : ''}</span>
          <span class="desc">{preset.description}</span>
        </button>
      {/each}
      {#if !activePreset}<div class="custom muted">Custom settings</div>{/if}
    </div>
  {/if}

  {#each basic as [key, spec] (key)}
    {#if isVisible(spec, values)}
      <ParamField id={key} {spec} bind:value={values[key]} {values} error={errors[key]} />
    {/if}
  {/each}

  {#if advanced.length}
    <button class="toggle" onclick={() => (showAdvanced = !showAdvanced)} aria-expanded={showAdvanced}>
      <span>{showAdvanced ? '▾' : '▸'} Advanced settings</span>
    </button>
    {#if showAdvanced}
      <div class="advanced">
        {#each advanced as [key, spec] (key)}
          {#if isVisible(spec, values)}
            <ParamField id={key} {spec} bind:value={values[key]} {values} error={errors[key]} />
          {/if}
        {/each}
      </div>
    {/if}
  {/if}

  {#if !isDefault}
    <button class="reset" onclick={reset}>↺ Reset to recommended</button>
  {/if}
</div>

<style>
  .panel {
    display: grid;
    gap: 16px;
  }
  .presets {
    display: grid;
    gap: 8px;
  }
  .preset {
    display: grid;
    text-align: left;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--border);
    background: var(--surface);
  }
  .preset:hover {
    border-color: var(--accent);
  }
  .preset.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .preset .label {
    font-weight: 600;
  }
  .preset .desc {
    font-size: 13px;
    color: var(--text-2);
  }
  .custom {
    font-size: 13px;
    text-align: center;
  }
  .toggle,
  .reset {
    border: none;
    background: none;
    padding: 0;
    text-align: left;
    color: var(--accent);
    font-weight: 550;
    font-size: 14px;
  }
  .advanced {
    display: grid;
    gap: 16px;
    padding: 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
</style>
