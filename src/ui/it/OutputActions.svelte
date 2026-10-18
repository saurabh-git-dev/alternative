<!--
  What you can do with a tool's text output: copy it, save it as a file, or
  share it (to a connected device, a new one by QR code, or as a link and QR
  code when it is small; see components/ShareMenu.svelte).
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { download } from '../../core/files';
  import ShareMenu from '../components/ShareMenu.svelte';
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
</script>

<div class="actions">
  <CopyButton {text} primary />
  <button class="it-mini" disabled={!text} onclick={() => download(new Blob([file.bytes as BlobPart], { type }), file.name)} title="Save as {file.name}">⬇ Save</button>
  <ShareMenu files={[file]} {text} variant="mini" disabled={!text} />
</div>

<style>
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
