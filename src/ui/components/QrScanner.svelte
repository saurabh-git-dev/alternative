<!--
  QR scanner (the Connect page's "Scan a code" tab): reads a QR code with the
  device camera, inside the app, and opens it. Works for connection codes
  and share-link codes; any other code links to the QR code scanner tool
  (ui/it/tools/QrScan.svelte). Decoding is shared, in core/qr-scan.ts. A
  photo or screenshot of a code works too.
-->
<script lang="ts">
  import { routeFromScan } from '../../core/direct';
  import { readQrFromImage, scanCamera, type CameraStatus } from '../../core/qr-scan';
  import { isNativeApp } from '../../pwa/install.svelte';
  import { itToolHref } from '../section';

  let video: HTMLVideoElement;
  let picker: HTMLInputElement;
  let status = $state<CameraStatus>('starting');
  let notOurs = $state('');
  const scanToolHref = $derived(itToolHref('qr-scan', { input: notOurs, options: {} }));

  /** Open the code if it is one of ours; otherwise say what it was. */
  function handle(text: string): boolean {
    const route = routeFromScan(text);
    if (route) {
      location.hash = route;
      return true;
    }
    notOurs = text;
    return false;
  }

  $effect(() => {
    const scan = scanCamera(video, (s) => (status = s), handle);
    return () => scan.stop();
  });

  async function fromImage(file: File | undefined) {
    if (!file) return;
    notOurs = '';
    const text = await readQrFromImage(file);
    if (text) handle(text);
    else notOurs = 'No QR code found in that image. Try a sharper, closer photo.';
  }
</script>

<div class="scanner">
  <div class="viewer" class:live={status === 'scanning'}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} playsinline muted></video>
    {#if status === 'scanning'}<div class="frame" aria-hidden="true"></div>{/if}
    {#if status === 'starting'}<p class="overlay">Starting the camera…</p>{/if}
    {#if status === 'blocked'}
      <p class="overlay">
        {#if isNativeApp()}Camera access was blocked. Allow the camera for Tools in your device settings (Apps → Tools → Permissions), or pick a photo of the code below.{:else}Camera access was blocked. Allow the camera for this site in your browser settings, or pick a photo of the code below.{/if}
      </p>
    {/if}
    {#if status === 'nocamera'}<p class="overlay">No camera found on this device. Pick a photo of the code below.</p>{/if}
    {#if status === 'unsupported'}<p class="overlay">This browser can't use the camera here. Pick a photo of the code below.</p>{/if}
  </div>

  {#if notOurs}
    <p class="note">
      {#if notOurs.startsWith('No QR code')}{notOurs}{:else}That code isn't a Tools connection or share link. It says: <code>{notOurs.slice(0, 200)}</code>
        <a href={scanToolHref}>Open it in the QR code scanner</a>{/if}
    </p>
  {/if}

  <input bind:this={picker} type="file" accept="image/*" hidden onchange={(e) => fromImage(e.currentTarget.files?.[0])} />
  <div class="actions">
    <button class="btn" onclick={() => picker.click()}>🖼️ Scan from a photo</button>
  </div>
  <p class="muted small">
    To get a code, open <strong>Connect</strong> at the top of this site on your other device. Scanning stays on this device; nothing is uploaded.
  </p>
</div>

<style>
  .scanner {
    max-width: 480px;
    margin: 0 auto;
    width: 100%;
    display: grid;
    gap: 12px;
  }
  .viewer {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: #111;
    display: grid;
    place-items: center;
  }
  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .frame {
    position: absolute;
    inset: 18%;
    border: 3px solid rgb(255 255 255 / 85%);
    border-radius: 16px;
    box-shadow: 0 0 0 999px rgb(0 0 0 / 35%);
  }
  .overlay {
    position: relative;
    margin: 0;
    padding: 20px;
    color: #fff;
    text-align: center;
  }
  .note {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: 14px;
    word-break: break-word;
  }
  .actions {
    display: flex;
    justify-content: center;
  }
  .small {
    font-size: 13px;
  }
</style>
