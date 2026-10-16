<!--
  One control for one parameter. The control type follows the spec's `kind`
  (and `display` hint): segmented buttons, dropdown, slider, number input,
  switch, text/password, colour picker or 3×3 position grid.
-->
<script lang="ts">
  import type { FileValue, ParamSpec, ParamValue, ParamValues } from '../../core/types';
  import PositionPicker from './PositionPicker.svelte';

  let {
    id,
    spec,
    value = $bindable(),
    values,
    error,
  }: { id: string; spec: ParamSpec; value: ParamValue; values: ParamValues; error?: string } = $props();

  const inputId = $derived(`param-${id}`);
  let reveal = $state(false);
</script>

<div class="field" class:invalid={!!error}>
  {#if spec.kind === 'boolean'}
    <label class="switch">
      <input type="checkbox" bind:checked={value as boolean} />
      <span class="track" aria-hidden="true"></span>
      <span class="label">{spec.label}</span>
    </label>
  {:else}
    <div class="top">
      <label class="label" for={inputId}>{spec.label}</label>
      {#if spec.kind === 'number' && spec.display !== 'input'}
        <span class="value">{value}{spec.unit ?? ''}</span>
      {/if}
    </div>

    {#if spec.kind === 'enum'}
      {#if spec.display === 'select' || spec.options.length > 4}
        <select id={inputId} bind:value>
          {#each spec.options as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      {:else}
        <div class="segmented" role="radiogroup" id={inputId}>
          {#each spec.options as option (option.value)}
            <button
              role="radio"
              aria-checked={value === option.value}
              class:active={value === option.value}
              title={option.hint}
              onclick={() => (value = option.value)}>{option.label}</button
            >
          {/each}
        </div>
      {/if}
      {@const hint = spec.options.find((o) => o.value === value)?.hint}
      {#if hint}<p class="help">{hint}</p>{/if}
    {:else if spec.kind === 'number'}
      {#if spec.display === 'input'}
        <div class="with-unit">
          <input id={inputId} type="number" min={spec.min} max={spec.max} step={spec.step ?? 1} bind:value />
          {#if spec.unit}<span class="unit">{spec.unit}</span>{/if}
        </div>
      {:else}
        <input id={inputId} type="range" min={spec.min} max={spec.max} step={spec.step ?? 1} bind:value />
      {/if}
    {:else if spec.kind === 'text'}
      <div class="with-unit">
        <input
          id={inputId}
          type={spec.secret && !reveal ? 'password' : 'text'}
          placeholder={spec.placeholder}
          autocomplete={spec.secret ? 'new-password' : 'off'}
          bind:value
        />
        {#if spec.secret}
          <button class="icon-btn" type="button" aria-label={reveal ? 'Hide' : 'Show'} onclick={() => (reveal = !reveal)}>
            {reveal ? '🙈' : '👁'}
          </button>
        {/if}
      </div>
    {:else if spec.kind === 'color'}
      <div class="with-unit">
        <input id={inputId} type="color" bind:value />
        <span class="unit">{value}</span>
      </div>
    {:else if spec.kind === 'position'}
      <PositionPicker bind:value={value as string} />
    {:else if spec.kind === 'file'}
      {@const picked = value as FileValue | null}
      <div class="with-unit">
        <label class="btn pick">
          {picked ? 'Change…' : (spec.placeholder ?? 'Choose file…')}
          <input
            id={inputId}
            type="file"
            accept={spec.accept}
            onchange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (f) value = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
            }}
          />
        </label>
        {#if picked}<span class="unit file-name" title={picked.name}>{picked.name}</span>{/if}
      </div>
    {/if}
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {:else if spec.help}
    <p class="help">{spec.help}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .label {
    font-weight: 550;
    font-size: 14px;
  }
  .value {
    font-variant-numeric: tabular-nums;
    font-size: 14px;
    color: var(--accent);
    font-weight: 600;
  }
  .help,
  .error {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-2);
  }
  .error {
    color: var(--danger);
  }
  select,
  input[type='text'],
  input[type='password'],
  input[type='number'] {
    width: 100%;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .invalid input {
    border-color: var(--danger);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  input[type='color'] {
    width: 44px;
    height: 34px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .with-unit {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .unit {
    color: var(--text-2);
    font-size: 14px;
  }
  .pick {
    position: relative;
    padding: 7px 14px;
    font-size: 14px;
    cursor: pointer;
  }
  .pick input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .segmented {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .segmented button {
    flex: 1;
    padding: 7px 8px;
    border: none;
    border-radius: 7px;
    background: transparent;
    font-size: 13.5px;
    font-weight: 550;
    color: var(--text-2);
    white-space: nowrap;
  }
  .segmented button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    opacity: 0;
  }
  .track {
    width: 38px;
    height: 22px;
    flex: none;
    border-radius: 99px;
    background: var(--border);
    position: relative;
    transition: background 0.15s;
  }
  .track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s;
  }
  .switch input:checked + .track {
    background: var(--accent);
  }
  .switch input:checked + .track::after {
    transform: translateX(16px);
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
