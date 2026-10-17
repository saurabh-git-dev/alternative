<!--
  What you can do with a tool's text output: copy it, save it as a file, or
  share it. Sharing picks the route by size (see ui/share-target.ts): a QR
  code your phone can scan when it fits, otherwise a direct, end-to-end
  encrypted transfer to your phone or another computer.
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { download } from '../../core/files';
  import { fitsQr, shareFile } from '../share-target';
  import CopyButton from './CopyButton.svelte';

  let { text, name, type = 'text/plain' }: { text: string; name: string; type?: string } = $props();

  const EXTENSIONS: Record<string, string> = {
    'text/plain': 'txt',
    'application/json': 'json',
    'text/csv': 'csv',
    'text/yaml': 'yaml',
    'image/svg+xml': 'svg',
  };

  const file = $derived<FileData>({
    name: `${name}.${EXTENSIONS[type] ?? 'txt'}`,
    type,
    bytes: new TextEncoder().encode(text),
  });
  const small = $derived(!!text && fitsQr(file));
</script>

<div class="actions">
  <CopyButton {text} primary />
  <button class="it-mini" disabled={!text} onclick={() => download(new Blob([file.bytes as BlobPart], { type }), file.name)} title="Save as {file.name}">⬇ Save</button>
  <button
    class="it-mini"
    disabled={!text}
    onclick={() => shareFile(file, small)}
    title={small ? 'Show as a QR code: scan it with your phone to get this' : 'Send to your phone or another computer over a direct, encrypted connection'}
  >
    {small ? '📱 QR' : '📡 Send'}
  </button>
</div>

<style>
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
