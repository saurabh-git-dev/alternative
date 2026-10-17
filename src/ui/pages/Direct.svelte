<!--
  Direct transfer between two devices: a secure session that stays open, so
  either side can send files of any size, as often as it likes, without
  scanning again (see core/direct.ts). Received files can be previewed here.

  Three ways in:
  - `#/direct`          start a session with files to send (handed over from Share or Home, or picked here).
  - `#/direct/receive`  start a session to receive (e.g. photos from a phone).
  - `#/d/<invite>`      the scanning device's side of a session.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { DirectTransfer, inviteLink, parseInvite, type ConnectionState, type Progress } from '../../core/direct';
  import { appUrl } from '../../core/share';
  import { download, formatBytes } from '../../core/files';
  import { takeHandoff } from '../handoff.svelte';
  import Dropzone from '../components/Dropzone.svelte';
  import QrCode from '../components/QrCode.svelte';
  import FilePreview from '../components/FilePreview.svelte';

  let { hash }: { hash: string } = $props();

  interface Batch {
    id: string;
    direction: 'send' | 'receive';
    files: File[];
    done: number;
    total: number;
    status: 'queued' | 'active' | 'complete' | 'interrupted';
    /** Name of the file going across right now. */
    current: string;
  }

  const route = untrack(() => hash);
  const invite = parseInvite(route);
  const joining = route.startsWith('#/d/');
  /** Did this session start with files to send from this device? */
  const startsSending = invite ? !invite.hostSends : route !== '#/direct/receive';

  let conn = $state<ConnectionState | null>(null);
  let batches = $state<Batch[]>([]);
  let transfer = $state<DirectTransfer | null>(null);
  let copied = $state(false);
  /** Keys `<batch id>/<file index>` of open previews. */
  let open = $state<Record<string, boolean>>({});

  const link = $derived(transfer && transfer.role === 'host' ? inviteLink(appUrl(location), transfer.invite) : '');
  const connected = $derived(conn?.state === 'connected');
  const over = $derived(conn?.state === 'ended' || conn?.state === 'failed');

  function find(id: string) {
    return batches.find((b) => b.id === id);
  }

  function onProgress(p: Progress) {
    let batch = find(p.id);
    if (!batch) {
      batches.unshift({ id: p.id, direction: p.direction, files: [], done: 0, total: p.total, status: 'active', current: p.file });
      batch = batches[0];
    }
    batch.status = 'active';
    batch.done = p.done;
    batch.total = p.total;
    batch.current = p.file;
  }

  function start() {
    transfer?.shutdown();
    const t = invite
      ? DirectTransfer.join(invite, handlers())
      : DirectTransfer.host(startsSending, handlers());
    transfer = t;
    // Files picked before connecting wait in the queue.
    for (const b of batches) if (b.direction === 'send' && b.status !== 'complete') b.id = t.send(b.files);
  }

  function handlers() {
    return {
      onState: (s: ConnectionState) => (conn = s),
      onProgress,
      onReceived: (id: string, files: File[]) => {
        const batch = find(id);
        if (!batch) return;
        batch.files = files;
        batch.status = 'complete';
        batch.done = batch.total;
        // A single received file opens straight away.
        if (files.length === 1) open[`${id}/0`] = true;
      },
      onSent: (id: string) => {
        const batch = find(id);
        if (batch) {
          batch.status = 'complete';
          batch.done = batch.total;
        }
      },
      onAborted: (id: string, direction: 'send' | 'receive') => {
        const batch = find(id);
        if (!batch) return;
        // Sends stay queued and restart on reconnect; partial receives are dropped.
        batch.status = direction === 'send' ? 'queued' : 'interrupted';
        if (direction === 'send') batch.done = 0;
      },
    };
  }

  function sendFiles(files: File[]) {
    if (!files.length) return;
    const id = transfer && !over ? transfer.send(files) : crypto.randomUUID();
    batches.unshift({ id, direction: 'send', files, done: 0, total: files.reduce((n, f) => n + f.size, 0), status: 'queued', current: files[0].name });
  }

  const handed = takeHandoff();
  untrack(() => {
    if (handed) sendFiles([new File([handed.bytes as BlobPart], handed.name, { type: handed.type })]);
    if (!joining || invite) start();
  });
  $effect(() => () => transfer?.shutdown());

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  const canShare = (files: File[]) => typeof navigator.canShare === 'function' && navigator.canShare({ files });

  const title = joining ? 'Connected devices' : startsSending ? 'Send to your phone' : 'Get files from your phone';
  /** The privacy notes start open beside the session on wide screens, folded on phones. */
  const wide = typeof matchMedia !== 'undefined' && matchMedia('(min-width: 761px)').matches;
</script>

<a class="back" href="#/">← All tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">📡</span>
  <div>
    <h1>{title}</h1>
    <p class="muted">
      Any size, either way, straight between your devices. The connection stays open, so you can keep sending without scanning again. End-to-end encrypted with a key that exists only in the QR code.
    </p>
  </div>
</div>

{#if joining && !invite}
  <div class="card box">
    <p class="error">This link is incomplete. Scan the QR code again.</p>
  </div>
{:else}
  <div class="layout">
    <div class="main">
      <section class="card box">
        {#if !conn || conn.state === 'starting'}
          <p class="muted">Getting ready…</p>
        {:else if conn.state === 'waiting' && link}
          {#if conn.reconnect}
            <p class="state warn">The other device disconnected. It reconnects by itself when it comes back, or scan again.</p>
          {/if}
          <div class="qr">
            <QrCode prefix={link} payload="" level="M" name="connect" />
          </div>
          <p class="steps">
            Scan this with your phone's camera, or with <strong>📷 Scan</strong> at the top of this site on your phone. Then send files either way, as many times as you like. Keep this page open.
          </p>
          <div class="row">
            <input class="link" readonly value={link} aria-label="Connection link" onfocus={(e) => e.currentTarget.select()} />
            <button class="btn" onclick={copyLink}>{copied ? '✓ Copied' : 'Copy link'}</button>
          </div>
          <p class="muted small">The link works while this page is open, for one device at a time. Anyone who has it can connect, so send it only to yourself.</p>
        {:else if conn.state === 'connecting'}
          <p class="state">🔌 Connecting to the other device…</p>
        {:else if conn.state === 'reconnecting'}
          <p class="state warn">🔄 Connection lost. Reconnecting…</p>
          <p class="muted small">This happens when a phone locks its screen or switches networks. Keep both pages open.</p>
        {:else if connected}
          <div class="connected">
            <p class="state ok">🔒 Connected securely</p>
            <button class="btn" onclick={() => transfer?.end()}>End session</button>
          </div>
        {:else if conn.state === 'ended' || conn.state === 'failed'}
          <p class={conn.state === 'failed' ? 'error' : 'state'}>{conn.message}</p>
          {#if !joining}<button class="btn" onclick={start}>Start a new session</button>{/if}
        {/if}

        {#if !over && (connected || !joining)}
          <Dropzone compact accept="*/*" paste label={connected ? 'Send files to the other device' : 'Add files to send once connected'} onFiles={sendFiles} />
        {/if}
      </section>

      {#if batches.length}
        <section class="card box activity">
          <h2>This session</h2>
          {#each batches as batch (batch.id)}
            <div class="batch">
              <div class="batch-head">
                <span class="dir" title={batch.direction === 'send' ? 'Sent' : 'Received'}>{batch.direction === 'send' ? '↑' : '↓'}</span>
                <span class="what">
                  {#if batch.direction === 'receive' && batch.status === 'complete'}
                    {batch.files.length} file{batch.files.length === 1 ? '' : 's'}
                  {:else}
                    {batch.files.length === 1 ? batch.files[0].name : batch.files.length ? `${batch.files.length} files` : batch.current}
                  {/if}
                </span>
                <span class="muted small">
                  {#if batch.status === 'active'}
                    {formatBytes(batch.done)} of {formatBytes(batch.total)}
                  {:else if batch.status === 'queued'}
                    {connected ? 'Starting…' : 'Waiting for connection'}
                  {:else if batch.status === 'interrupted'}
                    Interrupted
                  {:else}
                    {batch.direction === 'send' ? '✓ Sent' : '✓ Received'} · {formatBytes(batch.total)}
                  {/if}
                </span>
              </div>
              {#if batch.status === 'active'}
                <div class="bar"><div style:width="{(batch.total ? batch.done / batch.total : 1) * 100}%"></div></div>
              {/if}
              {#if batch.direction === 'receive' && batch.status === 'complete'}
                <ul class="files">
                  {#each batch.files as f, i (i)}
                    {@const key = `${batch.id}/${i}`}
                    <li>
                      <div class="file">
                        <button class="fname linkish" title="Preview {f.name}" onclick={() => (open[key] = !open[key])}>
                          {open[key] ? '▾' : '▸'} {f.name}
                        </button>
                        <span class="muted small size">{formatBytes(f.size)}</span>
                        {#if canShare([f])}<button class="btn" onclick={() => navigator.share({ files: [f] }).catch(() => {})}>Save…</button>{/if}
                        <button class="btn btn-primary" onclick={() => download(f, f.name)}>⬇ Download</button>
                      </div>
                      {#if open[key]}
                        <div class="preview"><FilePreview file={f} /></div>
                      {/if}
                    </li>
                  {/each}
                </ul>
                {#if batch.files.length > 1 && canShare(batch.files)}
                  <button class="btn" onclick={() => navigator.share({ files: batch.files }).catch(() => {})}>Save all…</button>
                {/if}
              {/if}
            </div>
          {/each}
        </section>
      {/if}
    </div>

    <details class="card box how muted small" open={wide}>
      <summary><strong>How it stays private</strong></summary>
      <p>A free public matchmaker introduces the two browsers, then they talk directly. The matchmaker never sees your files or the key.</p>
      <p>Each time the devices connect, both prove they hold the key from the QR code, so no one can pose as the other device. Every piece is then encrypted with AES-256, using fresh keys per connection, on top of the connection's own encryption.</p>
      <p>On strict networks (some mobile data and office Wi-Fi) the encrypted bytes pass through a relay that can't read them.</p>
      <p>Nothing is stored. Closing either page or pressing End session closes the connection for good.</p>
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
  h2 {
    margin: 0;
    font-size: 15px;
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
  .main {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .box {
    padding: 18px;
    display: grid;
    gap: 12px;
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
  .connected {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .state {
    margin: 0;
    font-weight: 600;
  }
  .ok {
    color: var(--success);
  }
  .warn {
    color: var(--warning);
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
  }
  .activity {
    gap: 4px;
  }
  .batch {
    display: grid;
    gap: 8px;
    padding: 10px 0;
    border-top: 1px solid var(--border);
  }
  .batch:first-of-type {
    border-top: 0;
  }
  .batch-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .dir {
    flex: none;
    font-weight: 700;
    color: var(--accent);
  }
  .what {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    height: 6px;
    border-radius: 99px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .file {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 8px;
  }
  .fname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .linkish {
    border: 0;
    padding: 0;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .linkish:hover {
    color: var(--accent);
  }
  .preview {
    margin-top: 8px;
    padding: 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .small {
    font-size: 13px;
  }
  .how p {
    margin: 8px 0 0;
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
    .file {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
    .file .size {
      display: none;
    }
  }
</style>
