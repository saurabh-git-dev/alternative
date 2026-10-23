<!--
  Corner notice for connected devices, on every page except that device's
  chat: what just arrived (with Open, Edit and Download, so a video sent
  while you're in the PDF tools opens straight in a video tool), or how a
  send started from a Share menu is going.
-->
<script lang="ts">
  import { download, formatBytes } from '../../core/files';
  import EditMenu from '../components/EditMenu.svelte';
  import { chatHref, displayName, getDevice, hub } from './devices.svelte';

  let { onOpen }: { onOpen: (id: string, files: File[]) => void } = $props();

  const device = $derived(hub.notice ? getDevice(hub.notice.device) : undefined);
  const message = $derived(device?.messages.find((m) => m.id === hub.notice?.message));
  const visible = $derived(!!device && !!message && hub.viewing !== device.key);
  let copied = $state(false);

  // Sends finished, and arrivals nobody acted on, clear by themselves.
  $effect(() => {
    if (!visible || !message || message.status === 'active' || message.status === 'queued') return;
    const id = message.id;
    const t = setTimeout(() => hub.notice?.message === id && (hub.notice = null), message.dir === 'out' ? 4_000 : 20_000);
    return () => clearTimeout(t);
  });

  function close() {
    hub.notice = null;
  }

  async function copy() {
    await navigator.clipboard.writeText(message?.text ?? '');
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

{#if visible && device && message}
  {@const name = displayName(device)}
  {@const files = message.files}
  <div class="notice card" role="status">
    {#if message.dir === 'out'}
      <p>
        {#if message.status === 'complete'}
          ✓ Sent to <strong>{name}</strong>
        {:else if message.status === 'active'}
          Sending to <strong>{name}</strong>… {Math.round((message.total ? message.done / message.total : 0) * 100)}%
        {:else if message.status === 'interrupted'}
          Sending to <strong>{name}</strong> was interrupted.
        {:else}
          Will send to <strong>{name}</strong> when it reconnects.
        {/if}
      </p>
      <div class="actions">
        <a class="btn" href={chatHref(device)}>Open chat</a>
        <button class="btn close" aria-label="Close" onclick={close}>✕</button>
      </div>
    {:else if message.kind === 'text'}
      <p>💬 <strong>{name}</strong>: <span class="text">{message.text}</span></p>
      <div class="actions">
        <button class="btn" onclick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
        <a class="btn" href={chatHref(device)}>Reply</a>
        <button class="btn close" aria-label="Close" onclick={close}>✕</button>
      </div>
    {:else}
      <p>
        📥 <strong>{name}</strong> sent
        {message.meta.length === 1 ? message.meta[0].name : `${message.meta.length} files`}
        <span class="muted">({formatBytes(message.total)})</span>
      </p>
      <div class="actions">
        {#if message.meta.length === 1 && files[0]}
          <EditMenu file={files[0]} device={device.key} onOpen={(id, f) => (close(), onOpen(id, f))} />
          {#if !message.saved}<button class="btn" onclick={() => download(files[0], files[0].name)}>⬇ Download</button>{/if}
        {/if}
        <a class="btn" href={chatHref(device)}>Open chat</a>
        <button class="btn close" aria-label="Close" onclick={close}>✕</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .notice {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 50;
    display: grid;
    gap: 10px;
    width: min(400px, calc(100vw - 32px));
    padding: 12px 14px;
    box-shadow: var(--shadow-lg, var(--shadow));
  }
  p {
    margin: 0;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .actions :global(.btn) {
    padding: 5px 10px;
    font-size: 13px;
    text-decoration: none;
    color: var(--text);
  }
  .close {
    margin-left: auto;
  }
  @media (max-width: 560px) {
    .notice {
      right: 8px;
      left: 8px;
      bottom: 8px;
      width: auto;
    }
  }
</style>
