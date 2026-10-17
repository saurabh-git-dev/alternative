<!-- One option of a transform, drawn from its OptionSpec. -->
<script lang="ts">
  import type { OptionSpec, OptionValue } from '../../it/types';

  let { spec, value = $bindable() }: { spec: OptionSpec; value: OptionValue } = $props();
</script>

{#if spec.kind === 'toggle'}
  <label class="it-field" title={spec.help}>
    <input type="checkbox" checked={!!value} onchange={(e) => (value = e.currentTarget.checked)} />
    {spec.label}
  </label>
{:else if spec.kind === 'choice'}
  <label class="it-field" title={spec.help}>
    <span>{spec.label}</span>
    <select value={String(value)} onchange={(e) => (value = e.currentTarget.value)}>
      {#each spec.choices as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
    </select>
  </label>
{:else if spec.kind === 'number'}
  <label class="it-field" title={spec.help}>
    <span>{spec.label}</span>
    <input
      type="number"
      min={spec.min}
      max={spec.max}
      step={spec.step ?? 1}
      value={Number(value)}
      oninput={(e) => {
        const n = e.currentTarget.valueAsNumber;
        if (Number.isFinite(n)) value = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n));
      }}
    />
  </label>
{:else}
  <label class="it-field" title={spec.help}>
    <span>{spec.label}</span>
    <input
      type={spec.secret ? 'password' : 'text'}
      autocomplete={spec.secret ? 'off' : undefined}
      placeholder={spec.placeholder}
      value={String(value)}
      oninput={(e) => (value = e.currentTarget.value)}
    />
  </label>
{/if}
