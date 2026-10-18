<!--
  Edit a received text file (JSON, CSV, YAML, Markdown, plain text…) in
  place, then send it back to the device it came from, or to any connected
  device, under the same name, or save it. JSON gets a validity check and
  Format / Minify. Opened from a file's Edit menu (sets `hub.editing`).
-->
<script lang="ts">
  import { download } from '../../core/files';
  import { displayName, getDevice, hub, isLive, liveDevices, sendFiles } from './devices.svelte';

  let { file, device }: { file: File; device?: string } = $props();

  let text = $state('');
  let original = $state('');
  let loaded = $state(false);
  let sentTo = $state('');

  const isJson = $derived(/\.json$/i.test(file.name) || file.type === 'application/json');
  const jsonError = $derived.by(() => {
    if (!isJson || !loaded || !text.trim()) return '';
    try {
      JSON.parse(text);
      return '';
    } catch (e) {
      return e instanceof Error ? e.message : 'Not valid JSON';
    }
  });
  const changed = $derived(text !== original);
  const from = $derived(device ? getDevice(device) : undefined);
  /** Where it can go: the device it came from first, then any other connected device. */
  const targets = $derived([...(from && isLive(from) ? [from] : []), ...liveDevices().filter((d) => d.key !== device)]);

  $effect(() => {
    file.text().then((t) => {
      text = original = t;
      loaded = true;
    });
  });

  $effect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  });

  function edited(): File {
    return new File([text], file.name, { type: file.type || 'text/plain' });
  }

  function close() {
    if (changed && !sentTo && !confirm('Close without sending or saving your changes?')) return;
    hub.editing = null;
  }

  function send(key: string) {
    const id = sendFiles(key, [edited()]);
    const d = getDevice(key);
    if (id && d) {
      hub.notice = { device: key, message: id };
      sentTo = displayName(d);
      original = text;
    }
  }

  function format(spaces: number) {
    try {
      text = JSON.stringify(JSON.parse(text), null, spaces || undefined);
    } catch {
      /* the error is already shown */
    }
  }
</script>

<div class="editor" role="dialog" aria-modal="true" aria-label="Edit {file.name}">
  <div class="bar">
    <strong class="name" title={file.name}>📝 {file.name}</strong>
    {#if isJson && loaded}
      <span class="small" class:bad={!!jsonError} class:good={!jsonError}>{jsonError ? '⚠ Not valid JSON' : '✓ Valid JSON'}</span>
      <button class="btn" disabled={!!jsonError} onclick={() => format(2)}>Format</button>
      <button class="btn hide-phone" disabled={!!jsonError} onclick={() => format(0)}>Minify</button>
    {/if}
    <span class="spacer"></span>
    <button class="btn" onclick={close} aria-label="Close">✕</button>
  </div>
  {#if loaded}
    <textarea bind:value={text} spellcheck="false" aria-label="File contents"></textarea>
  {:else}
    <p class="muted loading">Opening…</p>
  {/if}
  {#if jsonError}<p class="error small">{jsonError}</p>{/if}
  <div class="actions">
    {#each targets as d, i (d.key)}
      <button class="btn" class:btn-primary={i === 0} onclick={() => send(d.key)}>
        📡 {d.key === device ? 'Send back to' : 'Send to'} {displayName(d)}
      </button>
    {/each}
    <button class="btn" class:btn-primary={!targets.length} onclick={() => download(edited(), file.name)}>⬇ Save</button>
    {#if sentTo}<span class="small good">✓ {changed ? 'Sent an earlier version' : 'Sent'} to {sentTo}</span>{/if}
  </div>
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    background: var(--bg);
  }
  .bar,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface);
  }
  .bar {
    border-bottom: 1px solid var(--border);
  }
  .actions {
    border-top: 1px solid var(--border);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .btn {
    padding: 6px 12px;
  }
  textarea {
    width: 100%;
    height: 100%;
    padding: 12px 14px;
    border: 0;
    background: var(--bg);
    color: var(--text);
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    resize: none;
    outline: none;
    tab-size: 2;
  }
  .error {
    margin: 0;
    padding: 6px 12px;
    background: var(--danger-soft);
    color: var(--danger);
  }
  .loading {
    text-align: center;
    margin-top: 40px;
  }
  .small {
    font-size: 13px;
  }
  .good {
    color: var(--success);
  }
  .bad {
    color: var(--danger);
  }
  @media (max-width: 560px) {
    .hide-phone {
      display: none;
    }
  }
</style>
