/**
 * Screen recorder: captures the screen, the camera or both, with the
 * microphone and/or the sound playing on the computer, using the browser's
 * own MediaRecorder. Each second of video is written to the library
 * (core/recordings.ts) as it's recorded.
 *
 * "Screen + camera" works like Loom: the camera shows in a small round
 * bubble that floats above other windows (Picture-in-Picture), so it's part
 * of the recording when you share your entire screen. Mixing the camera
 * into the video ourselves would need a canvas redrawn every frame, which
 * browsers pause while the tab is in the background, exactly when you're
 * recording another window.
 *
 * Phones can't share their screen from a browser, so there only the camera
 * is offered.
 */
import { appendChunk, defaultTitle, keepStorage, saveMeta, updateMeta, type RecordingMeta } from './recordings';

export type RecordSource = 'screen' | 'camera' | 'both';
export type RecordQuality = '720' | '1080' | '1440';

export interface RecordOptions {
  source: RecordSource;
  mic: boolean;
  /** Microphone to use; default device when empty. */
  micId?: string;
  /** Sound playing on the computer or tab (Chrome and Edge; on macOS only for tabs). */
  systemAudio: boolean;
  quality: RecordQuality;
  cameraId?: string;
}

/** What this browser can do. */
export function recorderSupport() {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return {
    recorder: typeof MediaRecorder !== 'undefined',
    screen: !!media && 'getDisplayMedia' in media,
    camera: !!media && 'getUserMedia' in media,
    /** A round, always-on-top camera bubble (Chrome and Edge). */
    documentPip: typeof window !== 'undefined' && 'documentPictureInPicture' in window,
    videoPip: typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled,
  };
}

/** Recording formats, best first: MP4 plays everywhere; WebM is what Chrome and Firefox record best. */
const MIME_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function pickMimeType(isSupported: (type: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string {
  return MIME_TYPES.find((t) => isSupported(t)) ?? '';
}

const SIZES: Record<RecordQuality, { width: number; height: number; bitrate: number }> = {
  '720': { width: 1280, height: 720, bitrate: 2_500_000 },
  '1080': { width: 1920, height: 1080, bitrate: 5_000_000 },
  '1440': { width: 2560, height: 1440, bitrate: 8_000_000 },
};

/** Friendly messages for the errors getUserMedia / getDisplayMedia throw. */
export function captureError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Permission was denied, or the picker was closed. Allow screen, camera or microphone access and try again.';
  if (name === 'NotFoundError') return 'No camera or microphone was found.';
  if (name === 'NotReadableError') return 'The camera or microphone is in use by another app.';
  if (name === 'NotSupportedError' || name === 'TypeError') return 'This browser can’t record that. Try Chrome, Edge or Firefox on a computer.';
  return e instanceof Error ? e.message : String(e);
}

export type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

/**
 * One recording session. Create with `Recorder.start(options)`, then
 * `pause`, `resume` and `stop` (or `discard`). `onStop` fires when the
 * recording ends for any reason, including "Stop sharing" in the browser.
 */
export class Recorder {
  state: RecorderState = 'idle';
  meta!: RecordingMeta;
  /** The camera stream, for the bubble (screen + camera) or the preview (camera only). */
  camera: MediaStream | null = null;
  /** What's being recorded, for the live preview. */
  preview!: MediaStream;
  onStop: ((meta: RecordingMeta) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private recorder!: MediaRecorder;
  private streams: MediaStream[] = [];
  private audio: AudioContext | null = null;
  private seq = 0;
  private writes: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private finished!: Promise<void>;

  /** Ask for the screen/camera/mic and start recording. Throws a friendly message on refusal. */
  static async start(options: RecordOptions): Promise<Recorder> {
    const r = new Recorder();
    try {
      await r.begin(options);
    } catch (e) {
      r.release();
      throw new Error(captureError(e));
    }
    return r;
  }

  private async begin(o: RecordOptions): Promise<void> {
    const size = SIZES[o.quality];
    const media = navigator.mediaDevices;
    let video: MediaStreamTrack;
    let systemTrack: MediaStreamTrack | undefined;

    if (o.source !== 'camera') {
      const screen = await media.getDisplayMedia({
        video: { width: { ideal: size.width }, height: { ideal: size.height }, frameRate: { ideal: 30, max: 30 } },
        audio: o.systemAudio,
        // Chrome hints: offer the whole screen first and allow switching tabs mid-recording.
        ...({ selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: o.systemAudio ? 'include' : 'exclude', monitorTypeSurfaces: 'include' } as object),
      } as DisplayMediaStreamOptions);
      this.streams.push(screen);
      video = screen.getVideoTracks()[0];
      systemTrack = screen.getAudioTracks()[0];
      // The browser's own "Stop sharing" button ends the recording.
      video.addEventListener('ended', () => void this.stop());
    }
    if (o.source !== 'screen') {
      const cam = await media.getUserMedia({
        video: { deviceId: o.cameraId ? { exact: o.cameraId } : undefined, width: { ideal: o.source === 'camera' ? size.width : 640 }, height: { ideal: o.source === 'camera' ? size.height : 640 }, facingMode: 'user' },
      });
      this.streams.push(cam);
      this.camera = cam;
      if (o.source === 'camera') video = cam.getVideoTracks()[0];
    }
    let micTrack: MediaStreamTrack | undefined;
    if (o.mic) {
      const mic = await media.getUserMedia({ audio: { deviceId: o.micId ? { exact: o.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.streams.push(mic);
      micTrack = mic.getAudioTracks()[0];
    }

    const audioTrack = this.mixAudio([micTrack, systemTrack].filter((t): t is MediaStreamTrack => !!t));
    this.preview = new MediaStream([video!]);
    const stream = new MediaStream([video!, ...(audioTrack ? [audioTrack] : [])]);
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: size.bitrate, audioBitsPerSecond: 128_000 });

    const settings = video!.getSettings();
    this.meta = {
      id: crypto.randomUUID(),
      title: defaultTitle(),
      createdAt: Date.now(),
      duration: 0,
      size: 0,
      type: (this.recorder.mimeType || mimeType || 'video/webm').split(';')[0],
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      source: o.source,
      status: 'recording',
    };
    await saveMeta(this.meta);
    void keepStorage();

    this.recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      const seq = this.seq++;
      this.meta.size += e.data.size;
      this.writes = this.writes.then(() => appendChunk(this.meta.id, seq, e.data)).catch((err) => {
        this.onError?.(err instanceof Error ? err.message : 'Saving the recording failed: storage may be full.');
      });
    };
    this.recorder.onerror = () => this.onError?.('The recording stopped because of an error in the browser.');
    this.finished = new Promise((resolve) => (this.recorder.onstop = () => resolve()));
    this.recorder.start(1000);
    this.startedAt = performance.now();
    this.state = 'recording';
  }

  /** Mix several audio tracks into one (MediaRecorder records only the first). */
  private mixAudio(tracks: MediaStreamTrack[]): MediaStreamTrack | undefined {
    if (tracks.length < 2) return tracks[0];
    this.audio = new AudioContext();
    const out = this.audio.createMediaStreamDestination();
    for (const t of tracks) this.audio.createMediaStreamSource(new MediaStream([t])).connect(out);
    return out.stream.getAudioTracks()[0];
  }

  /** Seconds recorded so far, not counting pauses. */
  elapsed(): number {
    if (!this.startedAt) return 0;
    const now = this.state === 'paused' ? this.pausedAt : performance.now();
    return (now - this.startedAt - this.pausedTotal) / 1000;
  }

  pause(): void {
    if (this.state !== 'recording') return;
    this.recorder.pause();
    this.pausedAt = performance.now();
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.recorder.resume();
    this.pausedTotal += performance.now() - this.pausedAt;
    this.state = 'recording';
  }

  /** Finish the recording and save it. Resolves with its library entry. */
  async stop(): Promise<RecordingMeta> {
    if (this.state === 'saving' || this.state === 'idle') return this.meta;
    const duration = this.elapsed();
    this.state = 'saving';
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    await this.finished;
    this.release();
    await this.writes;
    this.meta = (await updateMeta(this.meta.id, { duration, size: this.meta.size, status: 'ready' })) ?? this.meta;
    this.state = 'idle';
    this.onStop?.(this.meta);
    return this.meta;
  }

  /** Stop and throw the recording away. */
  async discard(): Promise<void> {
    this.onStop = null;
    await this.stop();
    const { deleteRecording } = await import('./recordings');
    await deleteRecording(this.meta.id);
  }

  /** Turn off the camera, mic and screen sharing. */
  private release(): void {
    for (const s of this.streams) for (const t of s.getTracks()) t.stop();
    this.streams = [];
    void this.audio?.close();
    this.audio = null;
  }
}
