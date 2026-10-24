<!--
  In the native apps, Connect has three tabs:
  - P2P: a QR code, through the internet (WebRTC), with any browser or app
    (connect/ConnectPage.svelte, `#/connect`).
  - A2B (LAN): this app serves a page to browsers on the same network
    (connect/BrowserSharePage.svelte, `#/lan`).
  - A2A (LAN): Local share with other copies of this app and LocalSend
    (connect/LocalPage.svelte, `#/local`).
  Not shown on the website, which only has P2P.
-->
<script lang="ts">
  import { localHub } from './local.svelte';
  import { webShare } from './web-share.svelte';

  let { active }: { active: 'connect' | 'lan' | 'local' } = $props();
  const online = $derived(localHub.devices.filter((d) => d.linked).length);

  const TABS = [
    { id: 'connect', href: '#/connect', icon: '🔗', label: 'P2P', hint: 'QR code, any device' },
    { id: 'lan', href: '#/lan', icon: '🌐', label: 'A2B (LAN)', hint: 'Browser on this Wi-Fi' },
    { id: 'local', href: '#/local', icon: '📡', label: 'A2A (LAN)', hint: 'Tools or LocalSend app' },
  ] as const;
</script>

<nav class="tabs" aria-label="Ways to connect">
  {#each TABS as t (t.id)}
    <a href={t.href} class:active={active === t.id} aria-current={active === t.id ? 'page' : undefined}>
      <span class="label">
        <span aria-hidden="true">{t.icon}</span>
        {t.label}
        {#if (t.id === 'local' && online) || (t.id === 'lan' && webShare.on)}<span class="dot" aria-label="on"></span>{/if}
      </span>
      <small>{t.hint}</small>
    </a>
  {/each}
</nav>

<style>
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    max-width: 640px;
    margin-bottom: 18px;
    padding: 4px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  a {
    display: grid;
    justify-items: center;
    gap: 1px;
    padding: 8px 6px;
    border-radius: var(--radius-sm);
    color: var(--text-2);
    text-decoration: none;
    text-align: center;
    min-width: 0;
  }
  a.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 650;
    white-space: nowrap;
  }
  small {
    font-size: 11.5px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
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
