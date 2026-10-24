<!--
  In the native apps, Connect has two tabs: Connect (QR code, through the
  internet, connect/ConnectPage.svelte) and Local share (devices on this
  network, connect/LocalPage.svelte). Not shown on the website.
-->
<script lang="ts">
  import { localHub } from './local.svelte';

  let { active }: { active: 'connect' | 'local' } = $props();
  const online = $derived(localHub.devices.filter((d) => d.linked).length);
</script>

<nav class="tabs" aria-label="Ways to connect">
  <a href="#/connect" class:active={active === 'connect'} aria-current={active === 'connect' ? 'page' : undefined}>🔗 With a code</a>
  <a href="#/local" class:active={active === 'local'} aria-current={active === 'local' ? 'page' : undefined}>
    📡 Local share{#if online}<span class="dot" aria-label="{online} online"></span>{/if}
  </a>
</nav>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    max-width: 420px;
    margin-bottom: 18px;
    padding: 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  a {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    border-radius: 7px;
    color: var(--text-2);
    font-weight: 550;
    text-decoration: none;
    white-space: nowrap;
  }
  a.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
  }
  @media (max-width: 760px) {
    .tabs {
      max-width: none;
      margin-bottom: 12px;
    }
  }
</style>
