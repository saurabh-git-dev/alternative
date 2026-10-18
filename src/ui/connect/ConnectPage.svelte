<!--
  Connect: link this browser with another device, then chat with it, text
  and files of any size, either way (see connect/devices.svelte.ts).

  - "Show my code" (the default) shows a QR code for the other device to
    scan; "Scan a code" scans the other device's code with this camera.
  - Connected devices are listed beside the chat; you can connect several.
  - Routes: `#/connect` (devices, or the code when there are none),
    `#/connect/new`, `#/connect/scan`, `#/connect/<device>` (that chat), and
    `#/d/<invite>`, the link inside a QR code, which joins and then moves to
    `#/connect/<device>` so the key doesn't stay in the address bar or history.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { inviteLink, parseInvite } from '../../core/direct';
  import { appUrl } from '../../core/share';
  import { formatBytes } from '../../core/files';
  import QrCode from '../components/QrCode.svelte';
  import QrScanner from '../components/QrScanner.svelte';
  import Chat from './Chat.svelte';
  import MyName from './MyName.svelte';
  import { displayName, getDevice, hub, isLive, join, listedDevices, newHost, pendingHost, secondsLeft } from './devices.svelte';

  let { hash, onOpen }: { hash: string; onOpen: (id: string, files: File[]) => void } = $props();

  const route = untrack(() => hash);
  const invite = parseInvite(route);
  const joined = invite ? join(invite).key : null;
  if (joined) history.replaceState(null, '', `#/connect/${joined}`);
  const wanted = /^#\/connect\/(.+)$/.exec(route)?.[1];

  let tab = $state<'show' | 'scan'>(route === '#/connect/scan' || route === '#/scan' ? 'scan' : 'show');
  /** A device's chat, or `new` for the connect panel. */
  let selected = $state<string>(joined ?? (wanted && wanted !== 'new' && wanted !== 'scan' ? wanted : ''));
  if (wanted === 'new' || wanted === 'scan') selected = 'new';

  const devices = $derived(listedDevices());
  const current = $derived(selected && selected !== 'new' ? getDevice(selected) : undefined);
  const showingNew = $derived(selected === 'new' || !current);
  const host = $derived(pendingHost());
  const link = $derived(host && host.conn.state === 'waiting' ? inviteLink(appUrl(location), host.transfer.invite) : '');
  const queued = $derived(host?.messages.filter((m) => m.kind === 'files').flatMap((m) => m.meta) ?? []);
  let copied = $state(false);

  // With nothing chosen, open the first device's chat.
  $effect(() => {
    if (!selected && devices.length) selected = devices[0].key;
  });

  // The code on offer is made when it's on screen (and again after it expires).
  $effect(() => {
    if (showingNew && tab === 'show' && !host) untrack(() => newHost());
  });

  // When someone scans the code, open their chat.
  let watching = '';
  $effect(() => {
    if (host) watching = host.key;
    else if (watching && getDevice(watching)?.paired) {
      selected = watching;
      watching = '';
    }
  });

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  const expires = $derived(host ? secondsLeft(host) : 0);
</script>

<div class="head">
  <span class="icon" aria-hidden="true">🔗</span>
  <div>
    <h1>Connect devices</h1>
    <p class="muted">Send text and files of any size between this browser and your phone or another computer. Straight between the devices, end-to-end encrypted, nothing uploaded.</p>
  </div>
</div>

<MyName />

<div class="layout" class:solo={!devices.length}>
  {#if devices.length}
    <nav class="devices card" aria-label="Devices">
      {#each devices as d (d.key)}
        <button class="device" class:active={selected === d.key} onclick={() => (selected = d.key)}>
          <span class="dot {d.conn.state}" aria-hidden="true"></span>
          <span class="dname">{displayName(d)}{#if d.kind}<small class="muted">{d.kind}</small>{/if}</span>
          {#if d.unread}<span class="unread" aria-label="{d.unread} new">{d.unread}</span>{/if}
          {#if !isLive(d)}<span class="muted small">Ended</span>{/if}
        </button>
      {/each}
      <button class="device add" class:active={showingNew} onclick={() => (selected = 'new')}>➕ <span class="dname">Connect another</span></button>
    </nav>
  {/if}

  {#if current && !showingNew}
    {#key current.key}
      <Chat device={current} {onOpen} />
    {/key}
  {:else}
    <section class="card connect">
      <div class="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'show'} class:active={tab === 'show'} onclick={() => (tab = 'show')}>Show my code</button>
        <button role="tab" aria-selected={tab === 'scan'} class:active={tab === 'scan'} onclick={() => (tab = 'scan')}>Scan a code</button>
      </div>

      {#if tab === 'show'}
        {#if host?.conn.state === 'waiting' && link}
          <div class="qr"><QrCode prefix={link} payload="" level="M" name="connect" /></div>
          <p class="steps">Scan this with your other device's camera, or with <strong>Connect → Scan a code</strong> on this site there.</p>
          {#if queued.length}
            <p class="queued">📦 {queued.length === 1 ? queued[0].name : `${queued.length} files`} ({formatBytes(queued.reduce((n, f) => n + f.size, 0))}) will be sent as soon as it connects.</p>
          {/if}
          <div class="row">
            <input class="link" readonly value={link} aria-label="Connection link" onfocus={(e) => e.currentTarget.select()} />
            <button class="btn" onclick={copyLink}>{copied ? '✓ Copied' : 'Copy link'}</button>
          </div>
          <p class="muted small">
            Works for one device, while this page is open. The code expires in {Math.ceil(expires / 60)} min if nobody scans it. Anyone with the link can connect, so only send it to yourself.
          </p>
        {:else if host?.conn.state === 'connecting'}
          <p class="state">🔌 Connecting to the other device…</p>
        {:else if host?.conn.state === 'failed'}
          <p class="error">{host.conn.message}</p>
        {:else}
          <p class="muted state">Making a code…</p>
        {/if}
      {:else}
        <QrScanner />
      {/if}
    </section>
  {/if}
</div>

<details class="card how muted small">
  <summary><strong>How it stays private</strong></summary>
  <p>A free public matchmaker introduces the two browsers, then they talk directly. The matchmaker never sees your files, messages or the key.</p>
  <p>Each time the devices connect, both prove they hold the key from the QR code, so no one can pose as the other device. Everything is then encrypted with AES-256, using fresh keys per connection, on top of the connection's own encryption.</p>
  <p>On strict networks (some mobile data and office Wi-Fi) the encrypted bytes pass through a relay that can't read them.</p>
  <p>The connection closes after 15 minutes without anything sent, or when you press End. Nothing is stored after that: the chat history lives only in this tab while the connection is open.</p>
</details>

<style>
  .head {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-bottom: 20px;
  }
  .head .icon {
    flex: none;
    font-size: 28px;
    width: 52px;
    height: 52px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: var(--accent-soft);
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .head p {
    margin: 2px 0 0;
  }
  .layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .layout.solo {
    grid-template-columns: minmax(0, 560px);
    justify-content: center;
  }
  .devices {
    display: grid;
    gap: 2px;
    padding: 6px;
  }
  .device {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .device:hover {
    background: var(--surface-2);
  }
  .device.active {
    background: var(--accent-soft);
  }
  .dname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }
  .dname small {
    display: block;
    font-size: 12px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .add .dname {
    font-weight: 500;
    color: var(--text-2);
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--warning);
  }
  .dot.connected {
    background: var(--success);
  }
  .dot.ended,
  .dot.failed {
    background: var(--text-3);
  }
  .unread {
    min-width: 20px;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 12px;
    font-weight: 700;
    text-align: center;
  }
  .connect {
    display: grid;
    gap: 14px;
    padding: 18px;
  }
  .segmented {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .segmented button {
    flex: 1;
    padding: 8px;
    border: none;
    border-radius: 7px;
    background: transparent;
    font: inherit;
    font-weight: 550;
    color: var(--text-2);
    cursor: pointer;
  }
  .segmented button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .qr {
    justify-self: center;
    width: min(280px, 100%);
  }
  .steps {
    margin: 0;
    text-align: center;
  }
  .queued {
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    font-size: 14px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .link {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 13px;
  }
  .state {
    margin: 0;
    font-weight: 600;
    text-align: center;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
  }
  .small {
    font-size: 13px;
  }
  .how {
    max-width: 760px;
    margin: 20px auto 0;
    padding: 14px 18px;
  }
  .how summary {
    cursor: pointer;
  }
  .how p {
    margin: 8px 0 0;
  }
  @media (max-width: 760px) {
    .head {
      margin-bottom: 12px;
    }
    .head p {
      display: none;
    }
    h1 {
      font-size: 21px;
    }
    .head .icon {
      width: 44px;
      height: 44px;
      font-size: 24px;
    }
    .layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }
    /* Devices become a row of chips above the chat. */
    .devices {
      display: flex;
      overflow-x: auto;
      scrollbar-width: none;
      padding: 4px;
    }
    .device {
      flex: none;
      max-width: 210px;
      padding: 7px 10px;
    }
    .connect {
      padding: 14px;
    }
  }
</style>
