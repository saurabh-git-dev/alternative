<!--
  Local share (native apps only, a tab of Connect): devices on the same network, found
  without the internet (see connect/local.svelte.ts).

  - Saved devices: copies of this app you paired with a PIN. They stay
    listed, online or offline, and open a chat with files, text, and voice
    and video calls, straight over the local network.
  - Nearby: everything else on the network right now. Another copy of this
    app can be paired (it shows a PIN; type it here). A LocalSend app can be
    sent files right away (it asks its owner to accept).
  - Routes: `#/local` and `#/local/<device key>`.
  Connect (`#/connect`, WebRTC through the internet) is separate and unchanged.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Chat from './Chat.svelte';
  import MyName from './MyName.svelte';
  import ReceivedFiles from './ReceivedFiles.svelte';
  import { displayName, getDevice, hub } from './devices.svelte';
  import { enterPin, ensureDevice, forgetDevice, keyOf, localHub, refresh, requestPin, viewOf } from './local.svelte';
  import type { LocalDevice } from '../../core/local';

  let { hash, onOpen }: { hash: string; onOpen: (id: string, files: File[]) => void } = $props();

  /** The device on the right: a hub key (`local:<fingerprint>`). */
  let selected = $state(untrack(() => /^#\/local\/(.+)$/.exec(hash)?.[1] ?? ''));
  let scanning = $state(false);
  let pin = $state('');
  let pairing = $state<{ fingerprint: string; phase: 'asking' | 'enter' | 'checking'; error: string } | null>(null);

  const saved = $derived(localHub.devices.filter((d) => d.paired && d.ours));
  const nearby = $derived(localHub.devices.filter((d) => !(d.paired && d.ours) && d.online));
  const selectedView = $derived(selected.startsWith('local:') ? viewOf(selected.slice(6)) : undefined);
  const current = $derived(selected ? getDevice(selected) : undefined);
  /** Show the chat: a paired copy of this app, or a LocalSend device (files only). */
  const chatting = $derived(!!current && !!selectedView && (selectedView.paired || !selectedView.ours));

  function open(view: LocalDevice) {
    pairing = null;
    pin = '';
    if (view.paired || !view.ours) ensureDevice(view);
    selected = keyOf(view.fingerprint);
    history.replaceState(null, '', `#/local/${selected}`);
  }

  async function startPairing(view: LocalDevice) {
    pairing = { fingerprint: view.fingerprint, phase: 'asking', error: '' };
    pin = '';
    try {
      await requestPin(view.fingerprint);
      if (pairing?.fingerprint === view.fingerprint) pairing.phase = 'enter';
    } catch (e) {
      if (pairing?.fingerprint === view.fingerprint) pairing = { ...pairing, phase: 'enter', error: String(e) };
    }
  }

  async function submitPin() {
    if (!pairing || pin.replace(/\D/g, '').length !== 6) return;
    const fingerprint = pairing.fingerprint;
    pairing.phase = 'checking';
    pairing.error = '';
    try {
      await enterPin(fingerprint, pin);
      pairing = null;
      const view = viewOf(fingerprint);
      if (view) open(view);
    } catch (e) {
      if (pairing) pairing = { ...pairing, phase: 'enter', error: String(e) };
    }
  }

  async function scan() {
    scanning = true;
    await refresh().catch(() => {});
    scanning = false;
  }

  async function unpair(view: LocalDevice) {
    if (!confirm(`Forget ${view.alias}? You'll need a new PIN to pair again.`)) return;
    await forgetDevice(view.fingerprint);
    selected = '';
  }

  const icon = (d: LocalDevice) => (d.deviceType === 'mobile' ? '📱' : d.deviceType === 'web' ? '🌐' : '💻');
  const seen = (d: LocalDevice) => (d.online ? 'Online' : d.lastSeen ? `Last seen ${new Date(d.lastSeen).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'Offline');
</script>

<div class="head">
  <span class="icon" aria-hidden="true">📡</span>
  <div>
    <h1>Local share</h1>
    <p class="muted">Devices on the same Wi-Fi or network as this one, connected directly: no internet, no server. Pair once with a PIN to chat, call and send files any time; LocalSend apps show up too.</p>
  </div>
</div>

<MyName />

{#if localHub.error}
  <p class="error">Local share couldn't start: {localHub.error}</p>
{/if}

<div class="layout">
  <nav class="devices card" aria-label="Local devices">
    <div class="group">
      <span>Saved devices</span>
    </div>
    {#each saved as d (d.fingerprint)}
      {@const hubDevice = getDevice(keyOf(d.fingerprint))}
      <button class="device" class:active={selected === keyOf(d.fingerprint)} onclick={() => open(d)}>
        <span class="dot" class:on={d.linked} aria-hidden="true"></span>
        <span class="dname">{hubDevice ? displayName(hubDevice) : d.alias}<small class="muted">{d.linked ? 'Online' : 'Offline'}{d.deviceModel ? ` · ${d.deviceModel}` : ''}</small></span>
        {#if hubDevice?.unread}<span class="unread" aria-label="{hubDevice.unread} new">{hubDevice.unread}</span>{/if}
      </button>
    {:else}
      <p class="muted small hint">Pair with a nearby device and it stays here.</p>
    {/each}

    <div class="group">
      <span>Nearby</span>
      <button class="mini" onclick={scan} disabled={scanning} title="Look again, including on networks that block discovery">{scanning ? 'Looking…' : '↻ Refresh'}</button>
    </div>
    {#each nearby as d (d.fingerprint)}
      <button class="device" class:active={selected === keyOf(d.fingerprint)} onclick={() => open(d)}>
        <span aria-hidden="true">{icon(d)}</span>
        <span class="dname">{d.alias}<small class="muted">{d.ours ? 'Tools · tap to pair' : 'LocalSend · files only'}{d.deviceModel ? ` · ${d.deviceModel}` : ''}</small></span>
      </button>
    {:else}
      <p class="muted small hint">{localHub.ready ? 'Looking for devices… Open Tools (or LocalSend) on another device on this network.' : 'Starting…'}</p>
    {/each}
  </nav>

  {#if chatting && current && selectedView}
    <div class="chat-col">
      {#key current.key}
        <Chat device={current} {onOpen} calls={selectedView.ours && selectedView.paired} />
      {/key}
      {#if selectedView.paired}
        <p class="muted small foot">
          {icon(selectedView)} {seen(selectedView)}{selectedView.ip ? ` · ${selectedView.ip}` : ''} ·
          <button class="linkish" onclick={() => unpair(selectedView)}>Forget this device</button>
        </p>
      {/if}
    </div>
  {:else if selectedView && selectedView.ours}
    <section class="card panel">
      <h2>{icon(selectedView)} {selectedView.alias}</h2>
      <p class="muted">{selectedView.deviceModel ?? 'Tools'} · {selectedView.ip}</p>
      {#if !pairing || pairing.fingerprint !== selectedView.fingerprint}
        <p>Pair to chat, make calls and send files whenever both devices are on this network. You do this once.</p>
        <button class="btn btn-primary" onclick={() => startPairing(selectedView)}>Pair with a PIN</button>
      {:else if pairing.phase === 'asking'}
        <p class="state">Asking {selectedView.alias} for a PIN…</p>
      {:else}
        <form
          class="pin"
          onsubmit={(e) => {
            e.preventDefault();
            submitPin();
          }}
        >
          <label for="pin">Type the 6-digit PIN now showing on <strong>{selectedView.alias}</strong></label>
          <input id="pin" bind:value={pin} inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" disabled={pairing.phase === 'checking'} />
          <div class="row">
            <button type="button" class="btn" onclick={() => startPairing(selectedView)}>New PIN</button>
            <button class="btn btn-primary" disabled={pairing.phase === 'checking' || pin.replace(/\D/g, '').length !== 6}>{pairing.phase === 'checking' ? 'Checking…' : 'Pair'}</button>
          </div>
        </form>
      {/if}
      {#if pairing?.error && pairing.fingerprint === selectedView.fingerprint}<p class="error">{pairing.error}</p>{/if}
    </section>
  {:else}
    <section class="card panel">
      <h2>How it works</h2>
      <ol>
        <li>Open Tools on your other device, on the same Wi-Fi. It shows up under <strong>Nearby</strong> as <strong>{hub.me}</strong> does there.</li>
        <li>Tap it and choose <strong>Pair with a PIN</strong>; type the PIN the other device shows.</li>
        <li>It's saved: chat, call and send files any time both are on the network, even with no internet.</li>
      </ol>
      <p class="muted small">LocalSend apps (Windows, Mac, Linux, Android, iPhone) are listed too: tap one to send it files. Files sent to this device are listed under Received files below; anything over 1 GB, or from a device you haven't paired, asks you first.</p>
    </section>
  {/if}
</div>

<ReceivedFiles {onOpen} />

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
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .head p {
    margin: 2px 0 0;
  }
  .layout {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .devices {
    display: grid;
    gap: 2px;
    padding: 6px;
  }
  .group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 4px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  .mini {
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
  }
  .hint {
    margin: 0;
    padding: 4px 10px 8px;
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
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-3);
  }
  .dot.on {
    background: var(--success);
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
  .panel {
    display: grid;
    gap: 12px;
    padding: 18px;
  }
  .panel p,
  .panel ol {
    margin: 0;
  }
  .panel ol {
    display: grid;
    gap: 6px;
    padding-left: 20px;
  }
  .panel .btn-primary {
    justify-self: start;
  }
  .pin {
    display: grid;
    gap: 10px;
  }
  .pin input {
    width: 10ch;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 24px;
    letter-spacing: 0.2em;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .state {
    font-weight: 600;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
  }
  .chat-col {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .foot {
    margin: 0;
    text-align: center;
  }
  .linkish {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .small {
    font-size: 13px;
  }
  @media (max-width: 760px) {
    .head p {
      display: none;
    }
    .layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }
  }
</style>
