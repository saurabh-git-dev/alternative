<!-- Chmod calculator: tick permissions, or type 755 / rwxr-xr-x, and the rest follows. -->
<script lang="ts">
  import { WHAT, WHO, fromOctal, fromSymbolic, toOctal, toSymbolic, type Permissions } from '../../../it/lib/chmod';
  import CopyButton from '../CopyButton.svelte';

  let { initial = '' }: { initial?: string } = $props();

  let p = $state<Permissions>(fromOctal('755'));
  let error = $state('');
  let typed = $state<{ field: 'octal' | 'symbolic'; text: string } | null>(null);

  function read(field: 'octal' | 'symbolic', text: string) {
    typed = { field, text };
    try {
      p = field === 'octal' ? fromOctal(text) : fromSymbolic(text);
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  // svelte-ignore state_referenced_locally
  if (initial.trim()) read(/^[0-7]+$/.test(initial.trim()) ? 'octal' : 'symbolic', initial);
  typed = null;

  const octal = $derived(toOctal(p));
  const symbolic = $derived(toSymbolic(p));
  const command = $derived(`chmod ${octal} file`);
</script>

<div class="it-panes">
  <section class="card it-pane">
    <table>
      <thead>
        <tr><th></th>{#each WHAT as w (w)}<th>{w}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each WHO as who, i (who)}
          <tr>
            <th scope="row">{who}</th>
            {#each WHAT as w, j (w)}
              <td><input type="checkbox" aria-label="{who} {w}" bind:checked={p.bits[i][j]} onchange={() => (typed = null)} /></td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="it-options">
      <label class="it-field" title="Runs as the file's owner"><input type="checkbox" bind:checked={p.setuid} /> setuid</label>
      <label class="it-field" title="Runs as the file's group; new files in a folder inherit its group"><input type="checkbox" bind:checked={p.setgid} /> setgid</label>
      <label class="it-field" title="In a shared folder, only owners can delete their files (like /tmp)"><input type="checkbox" bind:checked={p.sticky} /> sticky</label>
    </div>
  </section>
  <section class="card it-pane">
    <label class="field">
      <span>Octal</span>
      <div class="line">
        <input class="it-input" value={typed?.field === 'octal' ? typed.text : octal} oninput={(e) => read('octal', e.currentTarget.value)} onblur={() => (typed = null)} inputmode="numeric" />
        <CopyButton text={octal} />
      </div>
    </label>
    <label class="field">
      <span>Symbolic</span>
      <div class="line">
        <input class="it-input" value={typed?.field === 'symbolic' ? typed.text : symbolic} oninput={(e) => read('symbolic', e.currentTarget.value)} onblur={() => (typed = null)} spellcheck="false" />
        <CopyButton text={symbolic} />
      </div>
    </label>
    {#if error}<p class="it-error">{error}</p>{/if}
    <label class="field">
      <span>Command</span>
      <div class="line"><code class="it-input">{command}</code><CopyButton text={command} /></div>
    </label>
  </section>
</div>

<style>
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 8px;
    text-align: center;
    text-transform: capitalize;
    font-size: 14px;
  }
  th[scope='row'] {
    text-align: left;
  }
  thead th {
    color: var(--text-2);
    font-weight: 550;
  }
  tbody tr {
    border-top: 1px solid var(--border);
  }
  td input {
    width: 20px;
    height: 20px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 14px;
    color: var(--text-2);
  }
  .line {
    display: flex;
    gap: 6px;
    align-items: center;
  }
</style>
