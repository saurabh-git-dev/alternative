<!--
  QR code for a share link. The URL prefix is encoded in byte mode and the
  payload in alphanumeric mode (see core/share.ts), which is what lets one
  code hold close to 3 KB. Always drawn dark-on-white, whatever the theme,
  because phone scanners expect that. "Full screen" makes dense codes easy
  to scan from a monitor.
-->
<script lang="ts">
  import QRCode, { type QRCodeSegment } from 'qrcode';
  import type { QrErrorCorrection } from '../../core/share';
  import { download } from '../../core/files';

  let { prefix, payload, level, name }: { prefix: string; payload: string; level: QrErrorCorrection; name: string } = $props();

  const segments = $derived<QRCodeSegment[]>([
    { data: new TextEncoder().encode(prefix), mode: 'byte' },
    ...(payload ? [{ data: payload, mode: 'alphanumeric' as const }] : []),
  ]);
  const options = $derived({ errorCorrectionLevel: level, margin: 4, color: { dark: '#000000', light: '#ffffff' } });
  const version = $derived(QRCode.create(segments, options).version);

  let svg = $state('');
  let full = $state(false);
  $effect(() => {
    let current = true;
    QRCode.toString(segments, { ...options, type: 'svg' }).then((s) => current && (svg = s));
    return () => (current = false);
  });

  async function savePng() {
    const url = await QRCode.toDataURL(segments, { ...options, scale: 8 });
    download(await (await fetch(url)).blob(), `${name}-qr.png`);
  }

  $effect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (full = false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
</script>

<div class="qr">
  <button class="code" onclick={() => (full = true)} aria-label="Show QR code full screen">{@html svg}</button>
  <div class="tools">
    <button class="btn" onclick={() => (full = true)}>⛶ Full screen</button>
    <button class="btn" onclick={savePng}>Save QR image</button>
  </div>
  <p class="muted small">
    {17 + 4 * version} × {17 + 4 * version} squares.
    {#if version > 25}Dense codes scan best full screen, with the phone held about 20 cm away.{/if}
  </p>
</div>

{#if full}
  <button class="overlay" onclick={() => (full = false)} aria-label="Close full screen QR code">
    {@html svg}
    <span>Tap anywhere or press Esc to close</span>
  </button>
{/if}

<style>
  .qr {
    display: grid;
    justify-items: center;
    gap: 10px;
  }
  .code {
    width: min(100%, 420px);
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: #fff;
    overflow: hidden;
    cursor: zoom-in;
  }
  .code :global(svg),
  .overlay :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .tools {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .small {
    margin: 0;
    font-size: 13px;
    text-align: center;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 12px;
    border: none;
    background: #fff;
    color: #555;
    cursor: zoom-out;
  }
  .overlay :global(svg) {
    width: min(94vw, 88vh);
    height: auto;
  }
</style>
