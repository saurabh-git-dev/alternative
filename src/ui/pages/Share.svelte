<!--
  Share as link or QR: packs a small file, or pasted text, into a link (see
  core/share.ts). Scanning the QR code with a phone opens the app there with
  the file ready to save. Nothing is uploaded anywhere.
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { formatBytes, readFile } from '../../core/files';
  import {
    LONG_LINK_CHARS,
    appUrl,
    linkFor,
    pack,
    qrCapacity,
    qrSegmentsFor,
    type QrErrorCorrection,
  } from '../../core/share';
  import { detectTextType } from '../../core/text-formats';
  import { fitImage } from '../../core/runner';
  import { takeHandoff } from '../handoff.svelte';
  import { MAX_LINK_FILE_BYTES as MAX_FILE_BYTES } from '../share-target';
  import ShareMenu from '../components/ShareMenu.svelte';
  import Dropzone from '../components/Dropzone.svelte';
  import QrCode from '../components/QrCode.svelte';

  const handed = takeHandoff();
  let mode = $state<'file' | 'text'>('file');
  let file = $state<FileData | null>(handed);
  /** The file as the user gave it, so "Undo shrink" can restore it. */
  let original = $state<FileData | null>(null);
  let text = $state('');
  let textType = $state<'auto' | 'text/plain' | 'text/csv' | 'application/json'>('auto');
  let includeName = $state(true);
  let level = $state<QrErrorCorrection>('L');
  let fitting = $state<{ fraction: number; cancel: () => void } | null>(null);
  let fitNote = $state('');
  let fitError = $state('');
  let copied = $state(false);

  const TEXT_TYPES = [
    { value: 'auto', label: 'Auto' },
    { value: 'text/plain', label: 'Text' },
    { value: 'text/csv', label: 'CSV' },
    { value: 'application/json', label: 'JSON' },
  ] as const;
  const TEXT_EXT: Record<string, string> = { 'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json' };

  const detected = $derived(textType === 'auto' ? detectTextType(text) : textType);
  const current = $derived.by((): FileData | null => {
    if (mode === 'file') return file;
    if (!text) return null;
    return { name: `text.${TEXT_EXT[detected]}`, type: detected, bytes: new TextEncoder().encode(text) };
  });
  const tooBig = $derived(!!current && current.bytes.length > MAX_FILE_BYTES);
  const packed = $derived(current && !tooBig ? pack(current, { includeName: includeName && mode === 'file' }) : null);

  const base = appUrl(location);
  const link = $derived(packed ? linkFor(base, packed) : '');
  const qr = $derived(packed ? qrSegmentsFor(base, packed) : null);
  const capacity = $derived(qrCapacity(`${base}#/q/`, level));
  const fits = $derived(!!packed && packed.length <= capacity);
  const isImage = $derived(!!current && mode === 'file' && current.type.startsWith('image/') && current.type !== 'image/svg+xml');

  async function onFiles([f]: File[]) {
    fitting?.cancel();
    fitting = null;
    file = await readFile(f);
    original = null;
    fitNote = fitError = '';
  }

  /** Re-encode the image as a small AVIF that fits the QR code. */
  async function shrink() {
    if (!file) return;
    const source = original ?? file;
    // Header overhead: everything pack() adds besides the image bytes.
    const overhead = pack({ ...source, type: 'image/avif', bytes: new Uint8Array() }, { includeName }).length + 2;
    const job = fitImage(source, capacity - overhead, (fraction) => fitting && (fitting.fraction = fraction));
    fitting = { fraction: 0, cancel: job.cancel };
    fitError = '';
    try {
      const out = await job.result;
      if (fitting?.cancel !== job.cancel) return;
      if (!out) {
        fitError = "Even a tiny version of this image doesn't fit in a QR code. Share the link instead.";
        return;
      }
      original = source;
      file = { name: source.name.replace(/\.[^.]+$/, '') + '.avif', type: 'image/avif', bytes: out.bytes };
      fitNote = `Shrunk to ${out.width} × ${out.height} px, AVIF quality ${out.quality} (${formatBytes(out.bytes.length)}).`;
    } finally {
      if (fitting?.cancel === job.cancel) fitting = null;
    }
  }

  function undoShrink() {
    file = original;
    original = null;
    fitNote = '';
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function shareLink() {
    navigator.share({ title: current?.name, url: link }).catch(() => {});
  }
</script>

<a class="back" href="#/">← All tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">🔗</span>
  <div>
    <h1>Share as link or QR code</h1>
    <p class="muted">The file travels inside the link itself, so nothing is uploaded. Scan the QR code with your phone's camera and the file opens there, ready to save.</p>
  </div>
</div>

<div class="layout">
  <section class="card input">
    <div class="segmented" role="tablist">
      <button role="tab" aria-selected={mode === 'file'} class:active={mode === 'file'} onclick={() => (mode = 'file')}>File</button>
      <button role="tab" aria-selected={mode === 'text'} class:active={mode === 'text'} onclick={() => (mode = 'text')}>Text, CSV or JSON</button>
    </div>

    {#if mode === 'file'}
      {#if file}
        <div class="picked">
          <div>
            <div class="name">{file.name}</div>
            <div class="muted small">{formatBytes(file.bytes.length)}</div>
          </div>
          <button class="btn" onclick={() => { file = null; original = null; fitNote = ''; }}>Change</button>
        </div>
        {#if fitNote}
          <p class="note small">{fitNote} <button class="link" onclick={undoShrink}>Undo</button></p>
        {/if}
      {:else}
        <Dropzone accept="*/*" multiple={false} paste label="Drop an image, PDF, or text, CSV or JSON file" onFiles={onFiles} />
      {/if}
    {:else}
      <textarea bind:value={text} rows="10" placeholder="Paste or type text, CSV or JSON…" spellcheck="false"></textarea>
      <div class="row">
        <span class="small muted">Format</span>
        <div class="segmented compact">
          {#each TEXT_TYPES as t (t.value)}
            <button class:active={textType === t.value} onclick={() => (textType = t.value)}>{t.label}</button>
          {/each}
        </div>
        {#if textType === 'auto' && text}<span class="small muted">Looks like {TEXT_TYPES.find((t) => t.value === detected)?.label}</span>{/if}
      </div>
    {/if}

    <details>
      <summary>More options</summary>
      <div class="options">
        {#if mode === 'file'}
          <label class="check"><input type="checkbox" bind:checked={includeName} /> Include the file name</label>
        {/if}
        <label class="small" for="ecc">QR code sturdiness</label>
        <select id="ecc" bind:value={level}>
          <option value="L">Normal: holds the most ({formatBytes(qrCapacity(`${base}#/q/`, 'L'))})</option>
          <option value="M">Sturdier: scans even if smudged ({formatBytes(qrCapacity(`${base}#/q/`, 'M'))})</option>
          <option value="Q">Sturdiest: for printing ({formatBytes(qrCapacity(`${base}#/q/`, 'Q'))})</option>
        </select>
      </div>
    </details>
  </section>

  <section class="card output">
    {#if !current}
      <p class="muted empty">Add a file or some text to get a link and QR code.</p>
    {:else if tooBig}
      <p class="muted">This file is {formatBytes(current.bytes.length)}, more than a link can carry (about {formatBytes(MAX_FILE_BYTES)}). Send it straight to your other device instead: any size, end-to-end encrypted.</p>
      <ShareMenu files={[$state.snapshot(current) as FileData]} label="Send to a device" />
    {:else if packed}
      <p class="stats small muted">
        Packed size <strong>{formatBytes(packed.length)}</strong>{#if packed.length < current.bytes.length * 0.95}, compressed from {formatBytes(current.bytes.length)}{/if}.
      </p>

      {#if fits && qr}
        <QrCode prefix={qr.prefix} payload={qr.payload} {level} name={current.name.replace(/\.[^.]+$/, '')} />
      {:else}
        <div class="nofit">
          <strong>Too big for a QR code.</strong>
          <p class="muted small">One QR code holds up to {formatBytes(capacity)}; this needs {formatBytes(packed.length)}. The link below still works: copy it or send it to your phone.</p>
          {#if isImage}
            {#if fitting}
              <div class="progress"><div style="width: {Math.round(fitting.fraction * 100)}%"></div></div>
              <button class="btn" onclick={() => { fitting?.cancel(); fitting = null; }}>Cancel</button>
            {:else}
              <button class="btn btn-primary" onclick={shrink}>Shrink image to fit the QR code</button>
              <p class="muted small">Makes a smaller copy (AVIF, a few hundred pixels wide). Your original stays as it is.</p>
            {/if}
          {/if}
          {#if fitError}<p class="error small">{fitError}</p>{/if}
        </div>
      {/if}

      <div class="link">
        <label class="small" for="share-link">Link ({link.length.toLocaleString()} characters)</label>
        <input id="share-link" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
        <div class="tools">
          <button class="btn btn-primary" onclick={copyLink}>{copied ? '✓ Copied' : 'Copy link'}</button>
          {#if 'share' in navigator}<button class="btn" onclick={shareLink}>Send…</button>{/if}
          <a class="btn" href={link} target="_blank" rel="noopener">Open</a>
        </div>
        {#if link.length > LONG_LINK_CHARS}
          <p class="warn small">This is a very long link. It works when pasted into a browser, but chat apps and email may cut it off.</p>
        {/if}
      </div>

    {/if}
  </section>
</div>

<style>
  .back {
    display: inline-block;
    margin: 4px 0 12px;
    text-decoration: none;
    color: var(--text-2);
  }
  .head {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 20px;
  }
  .head h1 {
    margin: 0;
    font-size: 24px;
  }
  .head p {
    margin: 4px 0 0;
    max-width: 680px;
  }
  .icon {
    font-size: 28px;
    width: 52px;
    height: 52px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: var(--accent-soft);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  @media (max-width: 820px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .card {
    padding: 18px;
    display: grid;
    gap: 14px;
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
    font-weight: 550;
    color: var(--text-2);
  }
  .segmented.compact button {
    padding: 4px 10px;
    font-size: 13.5px;
  }
  .segmented button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    resize: vertical;
  }
  .picked {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .name {
    font-weight: 600;
    word-break: break-all;
  }
  .small {
    font-size: 13px;
  }
  .note {
    margin: 0;
    color: var(--success);
  }
  button.link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  details summary {
    cursor: pointer;
    color: var(--text-2);
    font-size: 14px;
  }
  .options {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  select,
  .link input {
    width: 100%;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .link {
    display: grid;
    gap: 8px;
  }
  .link input {
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--text-2);
  }
  .tools {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tools .btn {
    text-decoration: none;
    color: var(--text);
  }
  .tools .btn-primary {
    color: var(--on-accent);
  }
  .stats,
  .empty {
    margin: 0;
  }
  .empty {
    text-align: center;
    padding: 40px 0;
  }
  .nofit {
    display: grid;
    gap: 8px;
    justify-items: start;
    padding: 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .nofit p {
    margin: 0;
  }
  .progress {
    width: 100%;
    height: 6px;
    border-radius: 99px;
    background: var(--border);
    overflow: hidden;
  }
  .progress div {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
  .warn {
    margin: 0;
    color: var(--warning);
  }
</style>
