<!--
  Files shared to the app from outside ("Share with Tools", see
  connect/incoming-share.svelte.ts): where should they go?
  - Scan (P2P): a QR code for any device; sent when it scans it.
  - Devices connected by code right now.
  - Saved devices (paired over Local share): sent at once, or, if one is
    away, as soon as it is back within 10 minutes.
  - Nearby devices found on the network (other apps, LocalSend).
  - A browser on this Wi-Fi (A2B page).
  - Or open a file in one of the tools.
-->
<script lang="ts">
  import { formatBytes } from '../../core/files';
  import type { LocalDevice } from '../../core/local';
  import EditMenu from '../components/EditMenu.svelte';
  import { chatHref, displayName, getDevice, hub, isDirect, liveDevices, newHost, sendFiles } from './devices.svelte';
  import { closeIncoming, incoming } from './incoming-share.svelte';
  import { ensureDevice, keyOf, localHub } from './local.svelte';
  import { offerFiles, startWebShare, webShare } from './web-share.svelte';

  let { onOpen }: { onOpen: (id: string, files: File[]) => void } = $props();

  const files = $derived(incoming.files);
  const shown = $derived(files.length > 0 || incoming.loading > 0 || incoming.skipped.length > 0);
  const total = $derived(files.reduce((n, f) => n + f.size, 0));
  const p2p = $derived(liveDevices().filter((d) => d.conn.state === 'connected'));
  const saved = $derived(localHub.devices.filter((d) => d.paired && d.ours));
  const nearby = $derived(localHub.devices.filter((d) => d.online && !(d.paired && d.ours)));

  function done(href?: string) {
    closeIncoming();
    if (href) location.hash = href;
  }

  function scan() {
    newHost([...files]);
    done('#/connect');
  }

  function toDevice(key: string) {
    const id = sendFiles(key, [...files]);
    const d = getDevice(key);
    if (id) hub.notice = { device: key, message: id };
    done(d ? chatHref(d) : undefined);
  }

  function toLocal(view: LocalDevice) {
    toDevice(ensureDevice(view).key);
  }

  async function toBrowser() {
    const list = [...files];
    if (!webShare.on) await startWebShare();
    done('#/lan');
    offerFiles(list);
  }

  const icon = (d: LocalDevice) => (d.deviceType === 'mobile' ? '📱' : d.deviceType === 'web' ? '🌐' : '💻');
</script>

{#if shown}
  <div class="backdrop">
    <div class="dialog card" role="dialog" aria-labelledby="share-title">
      <div class="top">
        <h2 id="share-title">Share with Tools</h2>
        <button class="btn close" onclick={() => done()} aria-label="Close">✕</button>
      </div>
      <p class="muted">
        {#if files.length}
          {files.length === 1 ? files[0].name : `${files.length} files`} · {formatBytes(total)}
        {/if}
        {#if incoming.loading}<span> · getting {incoming.loading} more…</span>{/if}
      </p>
      {#each incoming.skipped as s (s)}<p class="warn">⚠️ Left out: {s}</p>{/each}

      {#if files.length}
        <div class="group">
          <h3>Send to a device</h3>
          <button class="target" onclick={scan}>
            <span aria-hidden="true">🔗</span>
            <span class="tname">Scan a code (P2P)<small>Any phone or computer, through the internet. Sent when it scans the code.</small></span>
          </button>
          {#each p2p as d (d.key)}
            <button class="target" onclick={() => toDevice(d.key)}>
              <span class="dot on" aria-hidden="true"></span>
              <span class="tname">{displayName(d)}<small>Connected by code{d.kind ? ` · ${d.kind}` : ''}</small></span>
            </button>
          {/each}
        </div>

        <div class="group">
          <h3>Saved devices <small class="muted">(local network)</small></h3>
          {#each saved as d (d.fingerprint)}
            <button class="target" onclick={() => toLocal(d)}>
              <span class="dot" class:on={d.linked} aria-hidden="true"></span>
              <span class="tname">
                {getDevice(keyOf(d.fingerprint)) ? displayName(getDevice(keyOf(d.fingerprint))!) : d.alias}
                <small>{d.linked ? 'Online · sends now' : 'Offline · sends when it is back, within 10 min'}</small>
              </span>
            </button>
          {:else}
            <p class="muted small">None yet: pair one under Connect → A2A (LAN).</p>
          {/each}
        </div>

        <div class="group">
          <h3>Nearby <small class="muted">(found on this network)</small></h3>
          {#each nearby as d (d.fingerprint)}
            <button class="target" onclick={() => toLocal(d)}>
              <span aria-hidden="true">{icon(d)}</span>
              <span class="tname">{d.alias}<small>{d.ours ? 'Tools app · not paired, it asks first' : 'LocalSend · it asks first'}</small></span>
            </button>
          {:else}
            <p class="muted small">{localHub.ready ? 'Nothing found on this network right now.' : 'Looking…'}</p>
          {/each}
          <button class="target" onclick={toBrowser}>
            <span aria-hidden="true">🌐</span>
            <span class="tname">A browser on this Wi-Fi (A2B)<small>Shows a code; the other device downloads from its browser.</small></span>
          </button>
        </div>

        <div class="group">
          <h3>Or open in a tool</h3>
          {#each files as file, i (i)}
            <div class="file">
              <span class="fname">{file.name}</span>
              <EditMenu {file} onOpen={(id, f) => (done(), onOpen(id, f))} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 58;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.4);
  }
  .dialog {
    width: min(480px, 100%);
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    display: grid;
    gap: 10px;
    padding: 18px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 19px;
  }
  h3 {
    margin: 4px 0 2px;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  h3 small {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .warn {
    font-size: 13px;
    color: var(--danger);
  }
  .group {
    display: grid;
    gap: 2px;
  }
  .target {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .target:hover {
    background: var(--surface-2);
  }
  .tname {
    flex: 1;
    min-width: 0;
    font-weight: 550;
    overflow-wrap: anywhere;
  }
  .tname small {
    display: block;
    font-size: 12px;
    font-weight: 400;
    color: var(--text-3);
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
  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
  }
  .fname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file :global(.btn) {
    padding: 5px 10px;
    font-size: 13px;
  }
  .small {
    font-size: 13px;
    padding: 2px 10px;
  }
</style>
