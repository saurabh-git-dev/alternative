/**
 * Reading QR codes with the camera or from a picture, shared by the Connect
 * page's "Scan a code" tab (ui/components/QrScanner.svelte) and the QR code
 * scanner tool (ui/it/tools/QrScan.svelte). Uses the browser's built-in
 * BarcodeDetector where it exists (Chrome on Android) and the jsQR decoder
 * elsewhere (iOS Safari, Firefox, desktop webviews).
 */

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type Source = HTMLVideoElement | HTMLImageElement | ImageBitmap;

export type CameraStatus = 'starting' | 'scanning' | 'blocked' | 'nocamera' | 'unsupported';

let ready: Promise<(source: Source, width: number, height: number) => Promise<string | null>> | null = null;

async function makeReader() {
  const Native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ['qr_code'] });
      return async (source: Source) => (await detector.detect(source).catch(() => []))[0]?.rawValue ?? null;
    } catch {
      /* no QR support: fall back */
    }
  }
  const jsqr = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (source: Source, width: number, height: number) => {
    // jsQR needs pixels; a smaller copy is faster and decodes just as well.
    const scale = Math.min(1, 800 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsqr(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  };
}

/** Decode one frame or image; the text of a QR code if one is found. */
export async function readQr(source: Source, width: number, height: number): Promise<string | null> {
  ready ??= makeReader();
  return (await ready)(source, width, height);
}

/** The text of the QR code in a photo or screenshot, or null if there is none. */
export async function readQrFromImage(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  try {
    return await readQr(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export interface CameraScan {
  stop(): void;
}

/**
 * Show the camera in `video` and call `onCode` for every new code it sees
 * (a code held in view is reported once). `onCode` returns true to stop
 * scanning. `deviceId` picks a camera; the back camera is used otherwise.
 */
export function scanCamera(
  video: HTMLVideoElement,
  onStatus: (status: CameraStatus) => void,
  onCode: (text: string) => boolean | void,
  deviceId?: string,
): CameraScan {
  let stream: MediaStream | null = null;
  let stopped = false;
  let last = '';
  (async () => {
    ready ??= makeReader();
    await ready;
    if (!navigator.mediaDevices?.getUserMedia) return onStatus('unsupported');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
        audio: false,
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      return onStatus(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocamera' : 'blocked');
    }
    if (stopped) return stream.getTracks().forEach((t) => t.stop());
    video.srcObject = stream;
    await video.play().catch(() => {});
    onStatus('scanning');
    while (!stopped) {
      if (video.readyState >= 2 && video.videoWidth) {
        const text = await readQr(video, video.videoWidth, video.videoHeight);
        if (text && text !== last && !stopped) {
          last = text;
          if (onCode(text)) break;
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  })();
  return {
    stop() {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

/** The cameras on this device (labels appear once camera access is allowed). */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
  return (devices ?? []).filter((d) => d.kind === 'videoinput');
}
