<!--
  Password and token generator. Generated on this device with
  crypto.getRandomValues; "📱 QR" puts the result in a QR code so it can go
  straight to your phone without typing it.
-->
<script lang="ts">
  import type { ItToolProps } from '../../../it/types';
  import { CHARSETS, entropyBits, password, token } from '../../../it/lib/ids';
  import { loadItOptions, saveItOptions } from '../../settings';
  import OutputActions from '../OutputActions.svelte';
  import CopyButton from '../CopyButton.svelte';

  // Takes no starting input, but accepts the props every IT tool gets.
  let _props: ItToolProps = $props();

  const saved = loadItOptions('password');
  let mode = $state<'password' | 'token'>(saved.mode === 'token' ? 'token' : 'password');
  let length = $state(typeof saved.length === 'number' ? saved.length : 20);
  let sets = $state({ lower: true, upper: true, digits: true, symbols: true, readable: false, ...(saved.sets as object) });
  let bytes = $state(typeof saved.bytes === 'number' ? saved.bytes : 32);
  let encoding = $state<'hex' | 'base64url'>(saved.encoding === 'hex' ? 'hex' : 'base64url');
  let count = $state(typeof saved.count === 'number' ? saved.count : 1);
  let nonce = $state(0);

  $effect(() => saveItOptions('password', { mode, length, sets: $state.snapshot(sets), bytes, encoding, count }));

  const results = $derived.by(() => {
    void nonce;
    try {
      return Array.from({ length: count }, () => (mode === 'password' ? password({ length, ...sets }) : token(bytes, encoding)));
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  const alphabet = $derived(
    (['lower', 'upper', 'digits', 'symbols'] as const)
      .filter((k) => sets[k])
      .reduce((n, k) => n + (sets.readable ? CHARSETS[k].replace(/[Il1O0o|`'"]/g, '') : CHARSETS[k]).length, 0),
  );
  const bits = $derived(mode === 'password' ? entropyBits(length, alphabet) : bytes * 8);
  const strength = $derived(bits < 50 ? ['Weak', 'danger'] : bits < 80 ? ['Fair', 'warning'] : bits < 128 ? ['Strong', 'success'] : ['Very strong', 'success']);
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="it-segmented">
      <button class:active={mode === 'password'} onclick={() => (mode = 'password')}>Password</button>
      <button class:active={mode === 'token'} onclick={() => (mode = 'token')}>Token / API key</button>
    </div>
    {#if mode === 'password'}
      <label class="it-field length">
        <span>Length</span>
        <input type="range" min="4" max="128" bind:value={length} />
        <strong>{length}</strong>
      </label>
      <div class="it-options">
        <label class="it-field"><input type="checkbox" bind:checked={sets.lower} /> a–z</label>
        <label class="it-field"><input type="checkbox" bind:checked={sets.upper} /> A–Z</label>
        <label class="it-field"><input type="checkbox" bind:checked={sets.digits} /> 0–9</label>
        <label class="it-field"><input type="checkbox" bind:checked={sets.symbols} /> !@#$…</label>
        <label class="it-field" title="Leaves out I, l, 1, O, 0 and quotes, which are easy to misread"><input type="checkbox" bind:checked={sets.readable} /> Easy to read</label>
      </div>
    {:else}
      <div class="it-options">
        <label class="it-field">
          <span>Random bytes</span>
          <select bind:value={bytes}>
            {#each [16, 24, 32, 48, 64] as n (n)}<option value={n}>{n} ({n * 8} bits)</option>{/each}
          </select>
        </label>
        <label class="it-field">
          <span>Format</span>
          <select bind:value={encoding}>
            <option value="base64url">Base64url</option>
            <option value="hex">Hex</option>
          </select>
        </label>
      </div>
    {/if}
    <div class="it-options">
      <label class="it-field"><span>How many</span><input type="number" min="1" max="100" bind:value={count} /></label>
      <span class="strength {strength[1]}">{strength[0]} · {bits} bits</span>
    </div>
  </section>

  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>{count > 1 ? `${count} ${mode}s` : mode === 'password' ? 'Password' : 'Token'}</h2>
      <button class="it-mini" onclick={() => nonce++}>↻ New</button>
      <OutputActions text={Array.isArray(results) ? results.join('\n') : ''} name={mode === 'password' ? 'password' : 'token'} />
    </div>
    {#if typeof results === 'string'}
      <p class="it-error">{results}</p>
    {:else}
      <ul class="list">
        {#each results as r, i (i + r)}
          <li><code>{r}</code><CopyButton text={r} /></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .length input {
    flex: 1;
    min-width: 120px;
  }
  .length {
    flex-wrap: nowrap;
  }
  .strength {
    font-size: 13px;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 99px;
    background: var(--surface-2);
  }
  .strength.danger {
    color: var(--danger);
  }
  .strength.warning {
    color: var(--warning);
  }
  .strength.success {
    color: var(--success);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    max-height: 420px;
    overflow: auto;
  }
  li {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  code {
    font-size: 15px;
    word-break: break-all;
  }
</style>
