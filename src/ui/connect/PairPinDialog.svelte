<!--
  Another device on the network asked to pair with this one: show the PIN to
  type there (see core/local.ts and src-tauri/src/local/pair.rs). Closes when
  pairing finishes, is cancelled, or the PIN expires.
-->
<script lang="ts">
  import { pairDismiss } from '../../core/local';
  import { localHub } from './local.svelte';

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const pin = $derived(localHub.pin && localHub.pin.until > now ? localHub.pin : null);

  function close() {
    if (localHub.pin) pairDismiss(localHub.pin.fingerprint).catch(() => {});
    localHub.pin = null;
  }
</script>

{#if pin}
  <div class="backdrop">
    <div class="dialog card" role="alertdialog" aria-labelledby="pin-title">
      <h2 id="pin-title">🔗 {pin.alias} wants to pair</h2>
      <p class="muted">Type this PIN on {pin.alias} to pair. Only do it if you started pairing there.</p>
      <p class="code" aria-label="PIN {pin.pin.split('').join(' ')}">{pin.pin.slice(0, 3)} {pin.pin.slice(3)}</p>
      <p class="muted small">Expires in {Math.max(0, Math.ceil((pin.until - now) / 1000))} s</p>
      <div class="actions"><button class="btn" onclick={close}>Cancel</button></div>
    </div>
  </div>
{:else if localHub.paired?.ok}
  <div class="toast card" role="status">
    ✓ Paired. It's under <a href="#/local">Local share → Saved devices</a>.
    <button class="btn" onclick={() => (localHub.paired = null)} aria-label="Close">✕</button>
  </div>
{/if}

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
    width: min(380px, 100%);
    display: grid;
    gap: 10px;
    padding: 20px;
    text-align: center;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
  .code {
    font-size: 40px;
    font-weight: 700;
    letter-spacing: 0.12em;
    font-variant-numeric: tabular-nums;
  }
  .small {
    font-size: 12px;
  }
  .actions {
    display: flex;
    justify-content: center;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 16px;
    z-index: 55;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
  }
</style>
