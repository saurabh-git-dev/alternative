<!--
  Scan to connect: reads a QR code with the device camera, inside the app,
  and opens it. Works for connection codes (Send to / Get files from your
  phone) and share-link codes. Uses the browser's built-in BarcodeDetector
  where it exists (Chrome on Android) and the jsQR decoder elsewhere (iOS
  Safari, Firefox). A photo or screenshot of a code works too.
-->
<script lang="ts">
  import { routeFromScan } from '../../core/direct';

  type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

  let video: HTMLVideoElement;
  let picker: HTMLInputElement;
  let status = $state<'starting' | 'scanning' | 'blocked' | 'nocamera' | 'unsupported'>('starting');
  let notOurs = $state('');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let detector: Detector | null = null;
  let jsqr: typeof import('jsqr').default | null = null;

  async function decoders() {
    const Native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (Native) {
      try {
        detector = new Native({ formats: ['qr_code'] });
        return;
      } catch {
        /* no QR support: fall back */
      }
    }
    jsqr = (await import('jsqr')).default;
  }

  /** Decode one frame (or image); returns the text of a QR code if one is found. */
  async function read(source: HTMLVideoElement | HTMLImageElement | ImageBitmap, width: number, height: number): Promise<string | null> {
    if (detector) {
      const [code] = await detector.detect(source).catch(() => []);
      return code?.rawValue ?? null;
    }
    // jsQR needs pixels; a smaller copy is faster and decodes just as well.
    const scale = Math.min(1, 800 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsqr!(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  }

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
    let stream: MediaStream | null = null;
    let stopped = false;
    let last = '';
    (async () => {
      await decoders();
      if (!navigator.mediaDevices?.getUserMedia) {
        status = 'unsupported';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) {
        status = (e as DOMException)?.name === 'NotFoundError' ? 'nocamera' : 'blocked';
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});
      status = 'scanning';
      while (!stopped) {
        if (video.readyState >= 2) {
          const text = await read(video, video.videoWidth, video.videoHeight);
          if (text && text !== last) {
            last = text;
            if (handle(text)) break;
          }
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  });

  async function fromImage(file: File | undefined) {
    if (!file) return;
    notOurs = '';
    if (!detector && !jsqr) await decoders();
    const bitmap = await createImageBitmap(file).catch(() => null);
    const text = bitmap && (await read(bitmap, bitmap.width, bitmap.height));
    if (text) handle(text);
    else notOurs = 'No QR code found in that image. Try a sharper, closer photo.';
  }
</script>

<a class="back" href="#/">← All tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">📷</span>
  <div>
    <h1>Scan to connect</h1>
    <p class="muted">Point your camera at the QR code on your other device.</p>
  </div>
</div>

<div class="card box">
  <div class="viewer" class:live={status === 'scanning'}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} playsinline muted></video>
    {#if status === 'scanning'}<div class="frame" aria-hidden="true"></div>{/if}
    {#if status === 'starting'}<p class="overlay">Starting the camera…</p>{/if}
    {#if status === 'blocked'}
      <p class="overlay">Camera access was blocked. Allow the camera for this site in your browser settings, or pick a photo of the code below.</p>
    {/if}
    {#if status === 'nocamera'}<p class="overlay">No camera found on this device. Pick a photo of the code below.</p>{/if}
    {#if status === 'unsupported'}<p class="overlay">This browser can't use the camera here. Pick a photo of the code below.</p>{/if}
  </div>

  {#if notOurs}
    <p class="note">
      {#if notOurs.startsWith('No QR code')}{notOurs}{:else}That code isn't a Formatter connection or share link. It says: <code>{notOurs.slice(0, 200)}</code>{/if}
    </p>
  {/if}

  <input bind:this={picker} type="file" accept="image/*" hidden onchange={(e) => fromImage(e.currentTarget.files?.[0])} />
  <div class="actions">
    <button class="btn" onclick={() => picker.click()}>🖼️ Scan from a photo</button>
  </div>
  <p class="muted small">
    To get a code: on your other device open <strong>Send to your phone</strong> or <strong>Get files from your phone</strong>. Scanning stays on this device; nothing is uploaded.
  </p>
</div>

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
  .box {
    max-width: 560px;
    margin: 0 auto;
    padding: 16px;
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
  @media (max-width: 560px) {
    .head p {
      display: none;
    }
    h1 {
      font-size: 21px;
    }
  }
</style>
