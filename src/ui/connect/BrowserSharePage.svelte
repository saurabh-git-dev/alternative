<!--
  A2B (LAN), native apps only, a tab of Connect: the app serves a small page
  on this network (see connect/web-share.svelte.ts and
  src-tauri/src/local/web.rs). Any phone or computer on the same Wi-Fi scans
  the code and, in its browser with no app, sends files here (you accept
  them) and downloads the files offered here. Route: `#/lan`.
-->
<script lang="ts">
  import { formatBytes } from '../../core/files';
  import QrCode from '../components/QrCode.svelte';
  import ReceivedFiles from './ReceivedFiles.svelte';
  import { offerFiles, startWebShare, stopWebShare, unoffer, webShare } from './web-share.svelte';

  let { onOpen }: { onOpen: (id: string, files: File[]) => void } = $props();

  let chosen = $state(0);
  let copied = $state(false);
  let picker = $state<HTMLInputElement>();
  let dragging = $state(false);
  const url = $derived(webShare.urls[chosen] ?? webShare.urls[0] ?? '');

  async function copy() {
    await navigator.clipboard.writeText(url);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="head">
  <span class="icon" aria-hidden="true">🌐</span>
  <div>
    <h1>App ↔ Browser on this network</h1>
    <p class="muted">For a phone or computer without the app: it opens a page from this device in its browser, on the same Wi-Fi. Files go both ways, straight over your network, no internet needed.</p>
  </div>
</div>

{#if !webShare.on}
  <section class="card panel">
    <ol>
      <li>Switch on sharing: this device shows a QR code.</li>
      <li>Scan it with the other device's camera (same Wi-Fi), or type the link in its browser.</li>
      <li>Send files from that page (you accept them here), and download the files you add here.</li>
    </ol>
    <button class="btn btn-primary" onclick={startWebShare} disabled={webShare.starting}>{webShare.starting ? 'Starting…' : 'Switch on sharing'}</button>
    {#if webShare.error}<p class="error">{webShare.error}</p>{/if}
    <p class="muted small">Only someone with the code can open the page; it gets a new code each time you switch it on. The page is plain HTTP on your local network, so use it on networks you trust.</p>
  </section>
{:else}
  <div class="layout">
    <section class="card panel">
      {#if url}
        <div class="qr"><QrCode prefix={url} payload="" level="M" name="local-share" /></div>
        {#if webShare.urls.length > 1}
          <label class="muted small">
            Network
            <select bind:value={chosen}>
              {#each webShare.urls as u, i (u)}<option value={i}>{new URL(u).hostname}</option>{/each}
            </select>
          </label>
        {/if}
        <div class="row">
          <input class="link" readonly value={url} aria-label="Page link" onfocus={(e) => e.currentTarget.select()} />
          <button class="btn" onclick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      {:else}
        <p class="error">This device isn't on a network right now. Join Wi-Fi, then switch sharing off and on.</p>
      {/if}
      <button class="btn" onclick={stopWebShare}>Switch off</button>
    </section>

    <section
      class="card panel"
      role="group"
      aria-label="Files to download there"
      class:dragging
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => {
        e.preventDefault();
        dragging = false;
        if (e.dataTransfer?.files.length) offerFiles([...e.dataTransfer.files]);
      }}
    >
      <h2>Files to download there</h2>
      <input bind:this={picker} type="file" multiple hidden onchange={(e) => (offerFiles([...(e.currentTarget.files ?? [])]), (e.currentTarget.value = ''))} />
      <button class="btn btn-primary" onclick={() => picker?.click()}>📎 Add files</button>
      {#if webShare.offered.length}
        <ul>
          {#each webShare.offered as o, i (i)}
            <li>
              <span class="name">{o.name}</span>
              <span class="muted small">
                {o.error ? o.error : o.id ? formatBytes(o.size) : `Adding… ${Math.round((o.size ? o.done / o.size : 1) * 100)}%`}
              </span>
              <button class="btn mini" onclick={() => unoffer(o)} aria-label="Stop offering {o.name}">✕</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">Add or drop files here; they appear on the page for the other device to download.</p>
      {/if}
    </section>
  </div>
{/if}

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
    font-size: 17px;
  }
  .head p {
    margin: 2px 0 0;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .panel {
    display: grid;
    gap: 12px;
    padding: 18px;
    max-width: 760px;
  }
  .panel.dragging {
    outline: 2px dashed var(--accent);
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
  .panel > .btn {
    justify-self: start;
  }
  .qr {
    justify-self: center;
    width: min(260px, 100%);
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
  select {
    margin-left: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }
  .mini {
    padding: 3px 8px;
    font-size: 12px;
  }
  .error {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
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
    }
  }
</style>
