<!--
  Chat with one connected device: text and files, either way, in the order
  they were sent. Received files preview in place and open in any tool
  that takes them (Edit). Type and press Enter to send text; attach, drop or
  paste files to send them. With `calls` (the chat/ page), the header also
  has voice and video call buttons, and calls show as lines in the chat.

  The same chat serves Local share devices (connect/LocalPage.svelte): they
  stay listed while away (nothing to End), received files are saved to
  Downloads (Show in folder), and LocalSend devices take files only.
-->
<script lang="ts">
  import { download, formatBytes } from '../../core/files';
  import FilePreview from '../components/FilePreview.svelte';
  import EditMenu from '../components/EditMenu.svelte';
  import { calls as callState, hardware, startCall } from './calls.svelte';
  import { displayName, endDevice, forget, hub, isDirect, isLive, markRead, resend, secondsLeft, sendFiles, sendText, type Device, type Message } from './devices.svelte';
  import { isAndroid, reveal, saveToDownloads } from '../../core/local';
  import { LocalConnection } from '../../core/local-connection';

  let { device, onOpen, calls = false }: { device: Device; onOpen: (id: string, files: File[]) => void; calls?: boolean } = $props();

  let draft = $state('');
  let dragging = $state(false);
  let open = $state<Record<string, boolean>>({});
  let copied = $state<string | null>(null);
  let picker = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();

  const live = $derived(isLive(device));
  /** Android keeps received files in the app's folder: a button copies one to Downloads. */
  const android = isAndroid();
  let savedNote = $state<Record<string, string>>({});
  async function saveCopy(path: string) {
    savedNote[path] = 'Saving…';
    savedNote[path] = await saveToDownloads(path).then(
      () => '✓ Saved to Downloads',
      (e: unknown) => String(e),
    );
  }
  const direct = $derived(isDirect(device));
  /** Text works (everything but LocalSend devices, which take files only). */
  const texts = $derived(!(device.transfer instanceof LocalConnection) || device.transfer.chat);
  const left = $derived(secondsLeft(device));
  const clock = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);

  // While this chat is on screen, its messages are read.
  $effect(() => {
    const key = device.key;
    hub.viewing = key;
    markRead(key);
    return () => {
      if (hub.viewing === key) hub.viewing = null;
    };
  });
  $effect(() => {
    void device.messages.length;
    markRead(device.key);
    if (hub.notice?.device === device.key) hub.notice = null;
  });

  // Keep the newest message in view.
  $effect(() => {
    void device.messages.length;
    const last = device.messages.at(-1);
    void last?.status;
    if (list) queueMicrotask(() => list && (list.scrollTop = list.scrollHeight));
  });

  function submit() {
    if (!draft.trim()) return;
    sendText(device.key, draft);
    draft = '';
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function send(files: FileList | File[] | null | undefined) {
    if (files?.length) sendFiles(device.key, [...files]);
  }

  function onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (files?.length) {
      e.preventDefault();
      send(files);
    }
  }

  async function copy(m: Message) {
    await navigator.clipboard.writeText(m.text ?? '');
    copied = m.id;
    setTimeout(() => (copied = null), 1500);
  }

  const canShare = (files: File[]) => typeof navigator.canShare === 'function' && navigator.canShare({ files });
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  /** Small picture for image files. */
  function thumb(img: HTMLImageElement, file: File) {
    const url = URL.createObjectURL(file);
    img.src = url;
    return { destroy: () => URL.revokeObjectURL(url) };
  }

  function status(m: Message): string {
    if (m.status === 'active') return `${formatBytes(m.done)} of ${formatBytes(m.total)}`;
    if (m.status === 'queued') return device.conn.state === 'connected' ? (m.kind === 'files' && !direct ? 'Waiting for them to accept…' : 'Sending…') : direct ? 'Waiting for connection' : 'Will send when the device is back (within 10 min)';
    if (m.status === 'interrupted') return 'Interrupted';
    if (m.status === 'declined') return m.note ?? 'Declined';
    if (m.dir === 'in' && m.saved) return android ? 'Received' : 'Saved to Downloads';
    return m.dir === 'out' ? '✓ Delivered' : '';
  }
</script>

<section
  class="chat card"
  class:dragging
  aria-label="Chat with {displayName(device)}"
  ondragover={(e) => {
    if (!live) return;
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    if (live) send(e.dataTransfer?.files);
  }}
>
  <header>
    <span class="dot {device.conn.state}" aria-hidden="true"></span>
    <div class="who">
      <strong>{displayName(device)}{#if device.kind}<span class="kind"> · {device.kind}</span>{/if}</strong>
      <span class="muted small">
        {#if !direct}
          {#if device.conn.state === 'connected'}
            🔒 {texts ? 'Connected on your local network' : 'LocalSend · send it files'}
          {:else}
            {texts ? 'Offline · messages and files go when it is back' : 'Not on the network right now'}
          {/if}
        {:else if device.conn.state === 'connected'}
          🔒 Connected · closes in {clock} if idle
        {:else if device.conn.state === 'reconnecting' || (device.conn.state === 'waiting' && device.paired)}
          Reconnecting… keep both pages open
        {:else if device.conn.state === 'connecting' || device.conn.state === 'starting'}
          Connecting…
        {:else if device.conn.state === 'ended' || device.conn.state === 'failed'}
          {device.conn.message}
        {/if}
      </span>
    </div>
    {#if calls && live}
      {@const busy = !!callState.current || device.conn.state !== 'connected'}
      <button class="btn call-btn" disabled={busy || !hardware.mic} onclick={() => startCall(device.key, false)} title={hardware.mic ? 'Voice call' : 'Voice call (no microphone found)'} aria-label="Voice call">📞</button>
      <button class="btn call-btn" disabled={busy || !hardware.cam} onclick={() => startCall(device.key, true)} title={hardware.cam ? 'Video call' : 'Video call (no camera found)'} aria-label="Video call">🎥</button>
    {/if}
    {#if !direct}
      <!-- Local devices stay listed: Forget is on the Local share page. -->
    {:else if live}
      <button class="btn" onclick={() => endDevice(device.key)}>End</button>
    {:else}
      <button class="btn" onclick={() => forget(device.key)}>Remove</button>
    {/if}
  </header>

  <div class="messages" bind:this={list}>
    {#if !device.messages.length}
      <p class="muted empty">
        {!direct
          ? texts
            ? 'Send text or files of any size. They go straight to the other device over your network, encrypted.'
            : 'Attach or drop files to send them. The other device asks its owner to accept.'
          : live
            ? 'Send text or files of any size. They go straight to the other device, end-to-end encrypted.'
            : 'Nothing was sent.'}
      </p>
    {/if}
    {#each device.messages as m (m.id)}
      {#if m.kind === 'call'}
        {#if calls}<p class="call-line muted">{m.text} · {time(m.at)}</p>{/if}
      {:else}
      <div class="msg {m.dir}">
        <div class="bubble">
          {#if m.kind === 'text'}
            <p class="text">{m.text}</p>
            <div class="meta">
              <span>{time(m.at)}{m.dir === 'out' && m.status !== 'complete' ? ' · sending' : ''}</span>
              <button class="mini" onclick={() => copy(m)}>{copied === m.id ? '✓ Copied' : 'Copy'}</button>
            </div>
          {:else}
            {#if m.status === 'active' || (m.dir === 'in' && !m.meta.length)}
              <div class="what">{m.current || 'Receiving…'}</div>
              <div class="bar"><div style:width="{(m.total ? m.done / m.total : 0) * 100}%"></div></div>
            {/if}
            {#each m.meta as info, i (i)}
              {@const file = m.files[i]}
              {@const key = `${m.id}/${i}`}
              <div class="file">
                {#if file && info.type.startsWith('image/')}
                  <button class="thumb" title="Preview {info.name}" onclick={() => (open[key] = !open[key])}><img use:thumb={file} alt="" /></button>
                {:else}
                  <span class="thumb ext" aria-hidden="true">{info.name.split('.').pop()?.slice(0, 4).toUpperCase()}</span>
                {/if}
                <div class="fmeta">
                  {#if file}
                    <button class="fname" title="Preview {info.name}" onclick={() => (open[key] = !open[key])}>{info.name}</button>
                  {:else}
                    <span class="fname">{info.name}</span>
                  {/if}
                  <span class="muted small">{formatBytes(info.size)}</span>
                </div>
              </div>
              {#if file && (m.dir === 'in' || m.status === 'complete')}
                <div class="actions">
                  <EditMenu {file} {onOpen} device={m.dir === 'in' ? device.key : undefined} />
                  {#if canShare([file])}<button class="btn" onclick={() => navigator.share({ files: [file] }).catch(() => {})}>Save…</button>{/if}
                  {#if m.saved?.[i]}
                    {#if android}
                    <button class="btn" onclick={() => saveCopy(m.saved![i].path)}>{savedNote[m.saved![i].path] ?? '⬇ Save to Downloads'}</button>
                  {:else}
                    <button class="btn" onclick={() => reveal(m.saved![i].path).catch(() => {})}>📂 Show in folder</button>
                  {/if}
                  {:else}
                    <button class="btn" onclick={() => download(file, file.name)}>⬇ Download</button>
                  {/if}
                </div>
              {:else if !file && m.saved?.[i]}
                <div class="actions">
                  {#if android}
                    <button class="btn" onclick={() => saveCopy(m.saved![i].path)}>{savedNote[m.saved![i].path] ?? '⬇ Save to Downloads'}</button>
                  {:else}
                    <button class="btn" onclick={() => reveal(m.saved![i].path).catch(() => {})}>📂 Show in folder</button>
                  {/if}
                </div>
              {/if}
              {#if file && open[key]}
                <div class="preview"><FilePreview {file} /></div>
              {/if}
            {/each}
            <div class="meta">
              <span>{time(m.at)}{status(m) ? ` · ${status(m)}` : ''}</span>
              {#if m.dir === 'out' && m.status === 'interrupted' && m.files.length && live}
                <button class="mini" onclick={() => resend(device.key, m)}>Send again</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {/if}
    {/each}
  </div>

  {#if live}
    <form
      class="composer"
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input bind:this={picker} type="file" multiple hidden onchange={(e) => (send(e.currentTarget.files), (e.currentTarget.value = ''))} />
      {#if texts}
        <button type="button" class="btn attach" title="Send files" aria-label="Send files" onclick={() => picker?.click()}>📎</button>
        <textarea bind:value={draft} rows="1" placeholder="Message, or paste or drop files" onkeydown={onKey} onpaste={onPaste} aria-label="Message"></textarea>
        <button class="btn btn-primary" disabled={!draft.trim()}>Send</button>
      {:else}
        <button type="button" class="btn btn-primary files-only" onclick={() => picker?.click()}>📎 Send files</button>
      {/if}
    </form>
  {/if}
  {#if dragging}<div class="drop" aria-hidden="true">Drop to send</div>{/if}
</section>

<style>
  .chat {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: min(72vh, 760px);
    min-height: 420px;
    min-width: 0;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .who strong,
  .who span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    font-weight: 400;
    color: var(--text-3);
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
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
  .call-btn {
    padding: 6px 10px;
  }
  .call-line {
    margin: 0;
    align-self: center;
    font-size: 13px;
  }
  .messages {
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .empty {
    margin: auto;
    max-width: 340px;
    text-align: center;
  }
  .msg {
    display: flex;
  }
  .msg.out {
    justify-content: flex-end;
  }
  .bubble {
    display: grid;
    gap: 8px;
    max-width: min(560px, 88%);
    min-width: 0;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--surface-2);
  }
  .out .bubble {
    background: var(--accent-soft);
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: var(--text-3);
  }
  .mini {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .what {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    height: 6px;
    border-radius: 99px;
    background: var(--surface);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .thumb {
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface);
    cursor: pointer;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ext {
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-3);
    cursor: default;
  }
  .fmeta {
    display: grid;
    min-width: 0;
  }
  .fname {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.fname {
    cursor: pointer;
  }
  button.fname:hover {
    color: var(--accent);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .actions :global(.btn) {
    padding: 5px 10px;
    font-size: 13px;
  }
  .preview {
    padding: 8px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    min-width: min(420px, 70vw);
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid var(--border);
  }
  textarea {
    flex: 1;
    min-width: 0;
    max-height: 140px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    resize: none;
    field-sizing: content;
  }
  .attach {
    padding: 8px 11px;
  }
  .files-only {
    flex: 1;
  }
  .drop {
    position: absolute;
    inset: 8px;
    display: grid;
    place-items: center;
    border: 2px dashed var(--accent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    font-weight: 600;
    pointer-events: none;
  }
  .small {
    font-size: 13px;
  }
  @media (max-width: 760px) {
    .chat {
      height: calc(100dvh - 190px);
      min-height: 380px;
    }
    .bubble {
      max-width: 94%;
    }
  }
</style>
