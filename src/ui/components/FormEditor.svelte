<!--
  Lists a PDF's fillable fields (read in the preview worker) as a normal web
  form. Values are emitted keyed by field name.
-->
<script lang="ts">
  import { formFields } from '../../core/runner';
  import type { FormField } from '../../engines/pdflib';

  let {
    bytes,
    values,
    onChange,
  }: { bytes: Uint8Array; values: Record<string, string | boolean>; onChange: (v: Record<string, string | boolean>) => void } = $props();

  let fields = $state<FormField[] | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    formFields(bytes)
      .then((list) => {
        fields = list;
        const initial: Record<string, string | boolean> = {};
        for (const f of list) initial[f.name] = f.value;
        onChange(initial);
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  const set = (name: string, value: string | boolean) => onChange({ ...values, [name]: value });

  /** Field names are often technical ("form1[0].name_first"); show the readable tail. */
  const label = (name: string) => name.split('.').pop()!.replace(/\[\d+\]/g, '').replace(/[_-]+/g, ' ').trim() || name;
</script>

{#if error}
  <p class="error">{error}</p>
{:else if !fields}
  <p class="muted">Reading form fields…</p>
{:else if fields.length === 0}
  <p class="muted">This PDF has no fillable fields. To add text anywhere on a page, a future “Edit PDF” tool will help.</p>
{:else}
  <div class="form card">
    <p class="muted small">{fields.length} field{fields.length === 1 ? '' : 's'} found.</p>
    {#each fields as f (f.name)}
      <div class="field">
        {#if f.type === 'checkbox'}
          <label class="check">
            <input type="checkbox" checked={values[f.name] === true} disabled={f.readOnly} onchange={(e) => set(f.name, e.currentTarget.checked)} />
            {label(f.name)}
          </label>
        {:else}
          <label for="ff-{f.name}">{label(f.name)}</label>
          {#if f.type === 'text' && f.multiline}
            <textarea id="ff-{f.name}" rows="3" disabled={f.readOnly} value={String(values[f.name] ?? '')} oninput={(e) => set(f.name, e.currentTarget.value)}></textarea>
          {:else if f.type === 'text'}
            <input id="ff-{f.name}" type="text" disabled={f.readOnly} value={String(values[f.name] ?? '')} oninput={(e) => set(f.name, e.currentTarget.value)} />
          {:else}
            <select id="ff-{f.name}" disabled={f.readOnly} value={String(values[f.name] ?? '')} onchange={(e) => set(f.name, e.currentTarget.value)}>
              <option value="">—</option>
              {#each f.options ?? [] as o (o)}<option value={o}>{o}</option>{/each}
            </select>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .form {
    padding: 18px;
    display: grid;
    gap: 14px;
    box-shadow: none;
  }
  .field {
    display: grid;
    gap: 5px;
  }
  .field > label {
    font-weight: 550;
    font-size: 14px;
    text-transform: capitalize;
  }
  input[type='text'],
  textarea,
  select {
    width: 100%;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font: inherit;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: 550;
  }
  .small {
    margin: 0;
    font-size: 13px;
  }
  .error {
    color: var(--danger);
  }
</style>
