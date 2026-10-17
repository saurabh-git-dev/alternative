<!--
  Direct transfer between two devices, any file size (see core/direct.ts).

  Three ways in:
  - `#/direct`          send: pick files, show a QR code, the scanning device receives them.
  - `#/direct/receive`  receive: show a QR code, the scanning device picks files and sends them here.
  - `#/d/<invite>`      the scanning device's side of either.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { DirectTransfer, inviteLink, parseInvite, type Status } from '../../core/direct';
  import { appUrl } from '../../core/share';
  import { download, formatBytes } from '../../core/files';
  import { takeHandoff } from '../handoff.svelte';
  import Dropzone from '../components/Dropzone.svelte';
  import QrCode from '../components/QrCode.svelte';

  let { hash }: { hash: string } = $props();

  const route = untrack(() => hash);
  const invite = parseInvite(route);
  const joining = route.startsWith('#/d/');
  /** Does this device send the files? */
  const sends = invite ? !invite.hostSends : route !== '#/direct/receive';

  const handed = takeHandoff();
  let files = $state<File[]>(handed ? [new File([handed.bytes as BlobPart], handed.name, { type: handed.type })] : []);
  let status = $state<Status | null>(null);
  let received = $state<File[]>([]);
  let transfer = $state<DirectTransfer | null>(null);
  let copied = $state(false);

  const link = $derived(transfer && transfer.role === 'host' ? inviteLink(appUrl(location), transfer.invite) : '');
  const totalSize = $derived(files.reduce((n, f) => n + f.size, 0));
  const busy = $derived(status?.state === 'transferring');

  function start() {
    transfer?.close();
    received = [];
    const handlers = {
      onStatus: (s: Status) => {
        status = s;
        // The sender starts as soon as the connection is verified and files are picked.
        if (s.state === 'secured' && sends && files.length) transfer?.send($state.snapshot(files) as File[]);
      },
      onReceived: (got: File[]) => (received = got),
    };
    transfer = invite ? DirectTransfer.join(invite, handlers) : DirectTransfer.host(sends, handlers);
  }

  // Hosts that receive, and every joining device, connect right away; a sending host waits for files.
  untrack(() => {
    if (joining ? !!invite : !sends || files.length) start();
  });
  $effect(() => () => transfer?.close());

  function pick(list: File[]) {
    files = list;
    if (!transfer) start();
    else if (status?.state === 'secured') transfer.send(list);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  /** The privacy notes start open beside the transfer on wide screens, folded on phones. */
  const wide = typeof matchMedia !== 'undefined' && matchMedia('(min-width: 761px)').matches;

  const canShare = (f: File) => typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });

  const title = joining ? (sends ? 'Send files to your other device' : 'Receiving files') : sends ? 'Send to another device' : 'Get files from another device';
</script>

<a class="back" href="#/">← All tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">📡</span>
  <div>
    <h1>{title}</h1>
    <p class="muted">
      Any size, straight from one device to the other. Files are end-to-end encrypted with a key that exists only in the QR code, and never stored anywhere.
    </p>
  </div>
</div>

{#if joining && !invite}
  <div class="card box">
    <p class="error">This transfer link is incomplete. Scan the QR code again.</p>
  </div>
{:else}
  <div class="layout">
    <section class="card box">
      {#if sends && !joining}
        {#if files.length}
          <div class="picked">
            <div>
              <div class="name">{files.length === 1 ? files[0].name : `${files.length} files`}</div>
              <div class="muted small">{formatBytes(totalSize)}</div>
            </div>
            {#if !busy && status?.state !== 'done'}
              <button class="btn" onclick={() => { files = []; transfer?.close(); transfer = null; status = null; }}>Change</button>
            {/if}
          </div>
        {:else}
          <Dropzone accept="*/*" paste label="Drop the files to send" onFiles={pick} />
        {/if}
      {/if}

      {#if status?.state === 'starting'}
        <p class="muted">Getting ready…</p>
      {:else if status?.state === 'waiting' && link}
        <div class="qr">
          <QrCode prefix={link} payload="" level="M" name="transfer" />
        </div>
        <p class="steps">
          Scan this with your {sends ? 'phone' : 'phone or other device'}'s camera and open the link.
          {sends ? 'The files go across as soon as it connects.' : "Then pick files there and they'll arrive here."}
          Keep this page open until it's done.
        </p>
        <div class="row">
          <input class="link" readonly value={link} aria-label="Transfer link" onfocus={(e) => e.currentTarget.select()} />
          <button class="btn" onclick={copyLink}>{copied ? '✓ Copied' : 'Copy link'}</button>
        </div>
        <p class="muted small">The link works once, only while this page is open, and only for the device that opens it first. Anyone who has it can connect, so send it only to yourself.</p>
      {:else if status?.state === 'connecting'}
        <p class="state">🔌 Connecting to the other device…</p>
      {:else if status?.state === 'secured'}
        <p class="state ok">🔒 Connected securely.</p>
        {#if sends && !files.length}
          <Dropzone accept="*/*" label="Choose files to send" onFiles={pick} />
        {:else if !sends}
          <p class="muted">Waiting for the other device to send files…</p>
        {/if}
      {:else if status?.state === 'transferring'}
        <p class="state ok">🔒 {status.direction === 'send' ? 'Sending' : 'Receiving'} {status.file}</p>
        <div class="bar"><div style:width="{(status.total ? status.done / status.total : 1) * 100}%"></div></div>
        <p class="muted small">{formatBytes(status.done)} of {formatBytes(status.total)}</p>
      {:else if status?.state === 'done'}
        <p class="state ok">✓ {status.direction === 'send' ? 'Sent. The other device has the files.' : 'All files arrived intact.'}</p>
      {:else if status?.state === 'failed'}
        <p class="error">{status.message}</p>
        {#if !joining}<button class="btn" onclick={start}>Try again</button>{/if}
      {/if}

      {#if received.length}
        <ul class="files">
          {#each received as f, i (i)}
            <li>
              <span class="fname" title={f.name}>{f.name}</span>
              <span class="muted small">{formatBytes(f.size)}</span>
              {#if canShare(f)}<button class="btn" onclick={() => navigator.share({ files: [f] }).catch(() => {})}>Save…</button>{/if}
              <button class="btn btn-primary" onclick={() => download(f, f.name)}>⬇ Download</button>
            </li>
          {/each}
        </ul>
        {#if received.length > 1 && typeof navigator.canShare === 'function' && navigator.canShare({ files: received })}
          <button class="btn" onclick={() => navigator.share({ files: received }).catch(() => {})}>Save all…</button>
        {/if}
      {/if}
    </section>

    <details class="card box how muted small" open={wide}>
      <summary><strong>How it stays private</strong></summary>
      <p>A free public matchmaker introduces the two browsers, then they talk directly. The matchmaker never sees the files or the key.</p>
      <p>Before anything is sent, both devices prove they hold the key from the QR code, so no one can pose as the other device. Every piece is then encrypted with AES-256 on top of the connection's own encryption.</p>
      <p>On strict networks (some mobile data and office Wi-Fi) the encrypted bytes pass through a relay that can't read them. Both devices must stay online with this page open.</p>
    </details>
  </div>
{/if}

<style>
  .back {
    display: inline-block;
    margin-bottom: 12px;
    text-decoration: none;
    font-size: 14px;
  }
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
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 20px;
    align-items: start;
  }
  .box {
    padding: 18px;
    display: grid;
    gap: 12px;
  }
  .picked {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .name,
  .fname {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qr {
    justify-self: center;
    width: min(280px, 100%);
  }
  .steps {
    margin: 0;
    text-align: center;
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
  }
  .ok {
    color: var(--success);
  }
  .bar {
    height: 8px;
    border-radius: 99px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .files li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 8px;
  }
  .small {
    font-size: 13px;
  }
  .how p {
    margin: 0;
  }
  .how summary {
    cursor: pointer;
  }
  @media (max-width: 760px) {
    .layout {
      grid-template-columns: 1fr;
    }
    h1 {
      font-size: 21px;
    }
    .head p {
      display: none;
    }
    .head .icon {
      width: 44px;
      height: 44px;
      font-size: 24px;
    }
    .files li {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .files li .small {
      display: none;
    }
  }
</style>
