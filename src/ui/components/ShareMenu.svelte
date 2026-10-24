<!--
  The one "Share" button, used for every result in the app. Hover (or tap)
  shows where it can go, in this order:
  - each connected device: sent at once over its encrypted connection;
  - "Someone else": opens Connect with a QR code for a new device, and the
    file goes as soon as that device scans it;
  - "QR code or link" / "Link": only when the file is small enough to travel
    inside a link (see ui/share-target.ts);
  - "Other apps…": the system share sheet, where the browser has one.
  In the native apps it also lists Local share devices: saved ones (sent
  at once, or when they're back within 10 minutes) and nearby ones.
  `files` can be a function, for results that are costly to load (e.g. a
  saved recording); they are then loaded on the first pick. With `text`
  (an IT tool's output), a connected device gets plain text as a chat
  message it can copy; JSON, CSV and other formats still go as a file, so
  they can be saved and opened in a tool there.
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { displayName, hub, liveDevices, newHost, sendFiles, sendText } from '../connect/devices.svelte';
  import { fitsLink, fitsQr, openSharePage, toFile } from '../share-target';
  import { ensureDevice, localHub } from '../connect/local.svelte';
  import type { LocalDevice } from '../../core/local';

  type Source = (FileData | File)[] | (() => Promise<(FileData | File)[]>);

  let {
    files,
    label = 'Share',
    variant = 'btn',
    disabled = false,
    text,
  }: { files: Source; label?: string; variant?: 'btn' | 'btn-lg' | 'mini'; disabled?: boolean; text?: string } = $props();

  /** Longer text goes as a file, which is easier to save and open in a tool. */
  const MAX_CHAT_TEXT = 20_000;

  let open = $state(false);
  let busy = $state(false);
  let root = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();
  let pos = $state({ top: 0, left: 0 });
  /** Hidden until placed, so it never flashes in the corner. */
  let placed = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Opened by the mouse arriving; the click that usually follows keeps it open. */
  let byHover = false;

  const devices = $derived(liveDevices());
  /** Native apps: Local share devices, saved (online or not) then nearby. */
  const localDevices = $derived(localHub.devices.filter((d) => (d.paired && d.ours) || d.online));
  /** A single file that is already in memory can go by link or QR code. */
  const single = $derived(Array.isArray(files) && files.length === 1 && !(files[0] instanceof File) ? (files[0] as FileData) : null);
  const qr = $derived(open && single ? fitsQr(single) : false);
  const link = $derived(open && single ? fitsLink(single) : false);
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  async function resolve(): Promise<File[]> {
    busy = true;
    try {
      return (typeof files === 'function' ? await files() : files).map(toFile);
    } finally {
      busy = false;
    }
  }

  async function toDevice(key: string) {
    const asMessage = !!text && text.length <= MAX_CHAT_TEXT && (!single || single.type === 'text/plain');
    const id = asMessage ? sendText(key, text!) : sendFiles(key, await resolve());
    if (id) hub.notice = { device: key, message: id };
    open = false;
  }

  async function toLocal(view: LocalDevice) {
    const key = ensureDevice(view).key;
    const id = sendFiles(key, await resolve());
    if (id) hub.notice = { device: key, message: id };
    open = false;
  }

  async function toSomeoneElse() {
    newHost(await resolve());
    open = false;
    location.hash = '#/connect';
  }

  function toLink() {
    if (single) openSharePage(single);
    open = false;
  }

  async function toApps() {
    const list = await resolve();
    open = false;
    if (navigator.canShare?.({ files: list })) await navigator.share({ files: list }).catch(() => {});
  }

  function show() {
    clearTimeout(closeTimer);
    if (!open) byHover = true;
    open = true;
  }

  function toggle() {
    open = byHover || !open;
    byHover = false;
  }

  function hideSoon() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => ((open = false), (byHover = false)), 250);
  }

  // Place the menu under the button (above it near the bottom of the screen), inside the window.
  $effect(() => {
    if (!open) placed = false;
    if (!open || !button || !panel) return;
    const b = button.getBoundingClientRect();
    const h = panel.offsetHeight;
    const w = panel.offsetWidth;
    const below = b.bottom + 6 + h <= innerHeight || b.top < h + 6;
    pos = {
      top: below ? b.bottom + 6 : b.top - 6 - h,
      left: Math.max(8, Math.min(b.right - w, innerWidth - w - 8)),
    };
    placed = true;
  });

  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root?.contains(e.target as Node) && (open = false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (open = false);
    const onScroll = () => (open = false);
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey);
    addEventListener('scroll', onScroll, { passive: true });
    return () => {
      removeEventListener('pointerdown', onDown);
      removeEventListener('keydown', onKey);
      removeEventListener('scroll', onScroll);
    };
  });
</script>

<div
  class="share"
  bind:this={root}
  role="presentation"
  onpointerenter={(e) => e.pointerType === 'mouse' && !disabled && show()}
  onpointerleave={(e) => e.pointerType === 'mouse' && hideSoon()}
>
  <button
    bind:this={button}
    class={variant === 'mini' ? 'it-mini' : variant === 'btn-lg' ? 'btn btn-lg' : 'btn'}
    {disabled}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
  >
    {busy ? 'Preparing…' : `↗ ${label}`}
  </button>
  {#if open}
    <div class="panel card" role="menu" bind:this={panel} style:top="{pos.top}px" style:left="{pos.left}px" style:visibility={placed ? 'visible' : 'hidden'}>
      {#if devices.length}
        <p class="group">Connected devices</p>
        {#each devices as d (d.key)}
          <button role="menuitem" onclick={() => toDevice(d.key)}>
            <span class="dot" class:ok={d.conn.state === 'connected'} aria-hidden="true"></span>
            <span class="what">{displayName(d)}</span>
            {#if d.conn.state !== 'connected'}<span class="muted hint">sends on reconnect</span>{/if}
          </button>
        {/each}
        <hr />
      {/if}
      {#if localDevices.length}
        <p class="group">On this network</p>
        {#each localDevices as d (d.fingerprint)}
          <button role="menuitem" onclick={() => toLocal(d)}>
            <span class="dot" class:ok={d.paired && d.ours ? d.linked : d.online} aria-hidden="true"></span>
            <span class="what">{d.alias}</span>
            {#if d.paired && d.ours && !d.linked}<span class="muted hint">sends when back</span>{:else if !(d.paired && d.ours)}<span class="muted hint">asks first</span>{/if}
          </button>
        {/each}
        <hr />
      {/if}
      <button role="menuitem" onclick={toSomeoneElse}>
        <span aria-hidden="true">➕</span>
        <span class="what">{devices.length ? 'Someone else' : 'Send to a device'}<small class="muted">Scan a QR code to connect · any size</small></span>
      </button>
      {#if qr || link}
        <button role="menuitem" onclick={toLink}>
          <span aria-hidden="true">🔳</span>
          <span class="what">{qr ? 'QR code or link' : 'Link'}<small class="muted">The file travels inside the link</small></span>
        </button>
      {/if}
      {#if canShareFiles}
        <button role="menuitem" onclick={toApps}>
          <span aria-hidden="true">📤</span>
          <span class="what">Other apps…</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .share {
    display: inline-block;
  }
  .panel {
    position: fixed;
    z-index: 60;
    display: grid;
    min-width: 230px;
    max-width: calc(100vw - 16px);
    padding: 6px;
    box-shadow: var(--shadow-lg, var(--shadow));
  }
  .group {
    margin: 4px 10px 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
  }
  .panel button {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .panel button:hover,
  .panel button:focus-visible {
    background: var(--accent-soft);
  }
  .what {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .what small {
    font-size: 12px;
  }
  .hint {
    font-size: 12px;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    margin: 0 3px;
    border-radius: 50%;
    background: var(--warning);
  }
  .dot.ok {
    background: var(--success);
  }
  hr {
    width: 100%;
    margin: 4px 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
</style>
