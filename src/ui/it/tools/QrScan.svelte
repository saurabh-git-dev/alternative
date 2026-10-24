<!--
  QR code scanner: reads any QR code with the camera, live, or from a photo,
  a screenshot or a pasted image, and shows what it holds (core/qr-scan.ts
  decodes, it/lib/qr-content.ts works out the kind). Links open, Wi-Fi
  logins show the network and password, contacts and events save as .vcf
  and .ics, and Tools' own connection and share codes open here. Text
  handed in (`initial`, e.g. from the Connect page's scanner) is shown as a
  scan. Nothing leaves the device.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { routeFromScan } from '../../../core/direct';
  import { download } from '../../../core/files';
  import { openLink, isOpenable } from '../../../core/open-link';
  import { listCameras, readQrFromImage, scanCamera, type CameraStatus } from '../../../core/qr-scan';
  import { parseQrContent } from '../../../it/lib/qr-content';
  import { isNativeApp } from '../../../pwa/install.svelte';
  import CopyButton from '../CopyButton.svelte';
  import OutputActions from '../OutputActions.svelte';

  let { initial = '' }: { initial?: string } = $props();

  let video = $state<HTMLVideoElement>();
  let picker: HTMLInputElement;
  let cameraOn = $state(true);
  let status = $state<CameraStatus>('starting');
  let cameras = $state<MediaDeviceInfo[]>([]);
  let cameraIndex = $state(-1);
  let text = $state(untrack(() => initial));
  let history = $state<string[]>(untrack(() => (initial ? [initial] : [])));
  let note = $state('');
  let reveal = $state<Record<string, boolean>>({});
  let openError = $state('');

  const content = $derived(text ? parseQrContent(text) : null);
  const route = $derived(text ? routeFromScan(text) : null);

  function found(code: string) {
    note = '';
    openError = '';
    reveal = {};
    text = code;
    history = [code, ...history.filter((h) => h !== code)].slice(0, 8);
    navigator.vibrate?.(40);
  }

  $effect(() => {
    if (!cameraOn || !video) return;
    const deviceId = cameraIndex >= 0 ? cameras[cameraIndex]?.deviceId : undefined;
    status = 'starting';
    const scan = untrack(() =>
      scanCamera(
        video!,
        (s) => {
          status = s;
          if (s === 'scanning' && !cameras.length) listCameras().then((list) => (cameras = list));
        },
        (code) => {
          found(code);
        },
        deviceId,
      ),
    );
    return () => scan.stop();
  });

  function switchCamera() {
    if (cameras.length < 2) return;
    // The first switch goes from "the back camera" to the next listed one.
    cameraIndex = (cameraIndex + 1) % cameras.length;
  }

  async function fromImage(file: Blob | undefined | null) {
    if (!file) return;
    note = 'Reading…';
    const code = await readQrFromImage(file);
    if (code) found(code);
    else note = 'No QR code found in that image. Try a sharper, closer picture with the whole code in it.';
  }

  function onPaste(e: ClipboardEvent) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      fromImage(item.getAsFile());
    }
  }

  async function open(href: string) {
    openError = '';
    try {
      await openLink(href);
    } catch (e) {
      openError = `Couldn't open it: ${(e as Error)?.message ?? e}`;
    }
  }

  const blockedHelp = $derived(
    isNativeApp()
      ? 'Camera access was blocked. Allow the camera for Tools in your device settings (Apps → Tools → Permissions → Camera), then turn the camera on again. Or scan a photo of the code.'
      : 'Camera access was blocked. Allow the camera for this site (the camera or lock icon next to the address), then turn the camera on again. Or scan a photo of the code.',
  );
</script>

<svelte:window onpaste={onPaste} />

<div class="it-panes">
  <section class="card it-pane">
    <div
      class="viewer"
      role="region"
      aria-label="Camera"
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => {
        e.preventDefault();
        fromImage(e.dataTransfer?.files?.[0]);
      }}
    >
      {#if cameraOn}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} playsinline muted></video>
        {#if status === 'scanning'}<div class="frame" aria-hidden="true"></div>{/if}
        {#if status === 'starting'}<p class="overlay">Starting the camera…</p>{/if}
        {#if status === 'blocked'}<p class="overlay">{blockedHelp}</p>{/if}
        {#if status === 'nocamera'}<p class="overlay">No camera found on this device. Scan a photo or screenshot of the code instead.</p>{/if}
        {#if status === 'unsupported'}<p class="overlay">The camera can't be used here. Scan a photo or screenshot of the code instead.</p>{/if}
      {:else}
        <p class="overlay">Camera off. Drop, paste or pick a picture of a QR code, or turn the camera on.</p>
      {/if}
    </div>
    <div class="controls">
      <button class="btn btn-primary" onclick={() => picker.click()}>🖼️ Scan a photo or screenshot</button>
      <button class="btn" onclick={() => (cameraOn = !cameraOn)}>{cameraOn ? '⏸ Camera off' : '📷 Camera on'}</button>
      {#if cameraOn && cameras.length > 1 && status === 'scanning'}
        <button class="btn" onclick={switchCamera} title="Use another camera">🔄 Switch camera</button>
      {/if}
    </div>
    <input bind:this={picker} type="file" accept="image/*" hidden onchange={(e) => { fromImage(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
    {#if note}<p class="it-help">{note}</p>{/if}
    <p class="it-help">Point the camera at a code, or paste a screenshot (Ctrl+V). Scanning stays on this device; nothing is uploaded.</p>
  </section>

  <section class="card it-pane" aria-live="polite">
    {#if !content}
      <div class="it-pane-head"><h2>Result</h2></div>
      <p class="it-help">The code's content shows here: links, Wi-Fi logins, contacts, events, text and more.</p>
    {:else}
      <div class="it-pane-head">
        <h2>{content.title}</h2>
      </div>

      {#if route}
        <p class="mine">This is a Tools {route.startsWith('#/d/') ? 'connection code' : 'share link'}.</p>
        <button class="btn btn-primary" onclick={() => (location.hash = route)}>Open it here</button>
      {/if}

      {#if content.fields.length}
        <dl class="it-rows">
          {#each content.fields as f, i (i)}
            <div class="it-row">
              <dt>{f.label}</dt>
              <dd>
                {#if f.secret && !reveal[i]}
                  <button class="it-mini" onclick={() => (reveal[i] = true)}>Show</button>
                  <span class="dots" aria-label="hidden">••••••••</span>
                {:else}{f.value}{/if}
              </dd>
              <CopyButton text={f.value} />
            </div>
          {/each}
        </dl>
      {/if}

      {#if content.kind === 'wifi'}
        <p class="it-help">Copy the password, then pick the network in your Wi-Fi settings. On a phone, the camera app can also join from this code.</p>
      {:else if content.kind === 'otp'}
        <p class="it-help">This sets up a two-factor login. Scan it with your authenticator app instead, and keep the secret key private.</p>
      {/if}

      <div class="actions">
        {#if content.open && isOpenable(content.open.href) && !route}
          <button class="btn btn-primary" onclick={() => open(content.open!.href)}>{content.open.label}</button>
        {/if}
        {#if content.file}
          {@const file = content.file}
          <button class="btn" onclick={() => download(new Blob([file.text], { type: file.type }), file.name)}>
            ⬇ {content.kind === 'contact' ? 'Save contact' : 'Add to calendar'} (.{file.name.split('.').pop()})
          </button>
        {/if}
      </div>
      {#if openError}<p class="it-error">{openError}</p>{/if}

      <div class="it-pane-head"><h2>Raw text</h2><OutputActions {text} name="qr-code" /></div>
      <textarea class="it-text raw" readonly value={text} aria-label="QR code text"></textarea>
    {/if}

    {#if history.length > 1}
      <div class="it-pane-head"><h2>Earlier scans</h2></div>
      <ul class="history">
        {#each history.slice(1) as h (h)}
          <li><button class="link" onclick={() => found(h)}>{parseQrContent(h).title}: {h.slice(0, 80)}</button></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .viewer {
    position: relative;
    aspect-ratio: 1;
    max-height: 60vh;
    width: 100%;
    margin: 0 auto;
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
    inset: 16%;
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
  .controls,
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .actions:empty {
    display: none;
  }
  .mine {
    margin: 0;
    font-size: 14px;
  }
  .dots {
    margin-left: 6px;
    letter-spacing: 2px;
  }
  .raw {
    min-height: 90px;
  }
  .history {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
  }
  .link {
    all: unset;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    max-width: 100%;
  }
  .link:hover {
    color: var(--text);
    text-decoration: underline;
  }
</style>
