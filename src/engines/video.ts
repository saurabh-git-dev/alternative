/**
 * Video engine: runs a `VideoJob` (see core/video.ts) with WebCodecs through
 * Mediabunny, and falls back to ffmpeg.wasm when it can't.
 *
 * WebCodecs uses the browser's own (usually hardware) encoders, so it is
 * many times faster than WebAssembly and needs no download. It handles MP4,
 * MOV, WebM and MKV with the codecs the browser supports. ffmpeg.wasm
 * (32 MB, downloaded once) covers the rest: older formats such as AVI, WMV
 * or FLV, codecs the browser can't decode, and browsers without WebCodecs.
 *
 * Mediabunny is used in the job worker; it reads straight from the file's
 * bytes and writes the result into memory.
 */
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type InputVideoTrack,
  type OutputFormat,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';
import type { FileData, OutputFile } from '../core/types';
import { baseName } from '../core/files';
import {
  VIDEO_TYPES,
  bitrateFor,
  cropPixels,
  fitSize,
  maskActive,
  needsReencode,
  outputSize,
  rotateBox,
  type MaskBox,
  type SourceInfo,
  type TimeRange,
  type VideoJob,
} from '../core/video';
import { drawMask } from './video-effects';

export type Progress = (fraction: number, message?: string) => void;

/** Thrown when WebCodecs can't do a job; the caller retries with ffmpeg.wasm. */
export class NeedsFallback extends Error {}

/** WebCodecs encoding and decoding, plus OffscreenCanvas for frame effects. */
export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/**
 * Run `fast` (WebCodecs) and, when it can't handle the file or the browser,
 * `fallback` (ffmpeg.wasm). Other errors are real and are passed on.
 */
export async function withFallback<T>(fast: () => Promise<T>, fallback: () => Promise<T>, progress: Progress): Promise<T> {
  if (hasWebCodecs()) {
    try {
      return await fast();
    } catch (e) {
      if (!(e instanceof NeedsFallback)) throw e;
    }
  }
  progress(0, 'Loading the compatibility engine (32 MB, once)');
  return fallback();
}

async function open(file: FileData): Promise<Input> {
  const input = new Input({ source: new BufferSource(file.bytes), formats: ALL_FORMATS });
  if (!(await input.canRead())) throw new NeedsFallback('unreadable container');
  return input;
}

/** The main video track; `decode` checks the browser can decode it (copying doesn't need to). */
async function videoTrack(input: Input, decode = true): Promise<InputVideoTrack> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("This file doesn't contain a video track.");
  if (decode && !(await track.canDecode())) throw new NeedsFallback('undecodable video');
  return track;
}

/** Size, length and audio presence of a video. Works without WebCodecs decoding. */
export async function probe(file: FileData): Promise<SourceInfo> {
  const input = await open(file);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("This file doesn't contain a video track.");
  const stats = await track.computePacketStats(120).catch(() => null);
  return {
    width: track.displayWidth,
    height: track.displayHeight,
    duration: await input.computeDuration(),
    hasAudio: !!(await input.getPrimaryAudioTrack()),
    fps: stats?.averagePacketRate || undefined,
  };
}

function outputFormat(container: VideoJob['container']): OutputFormat {
  if (container === 'webm') return new WebMOutputFormat();
  if (container === 'mov') return new MovOutputFormat({ fastStart: 'in-memory' });
  return new Mp4OutputFormat({ fastStart: 'in-memory' });
}

/** Preferred codecs per container, most compatible first. */
const VIDEO_CODECS: Record<VideoJob['container'], VideoCodec[]> = {
  // MP4 should play everywhere, so without an H.264 or HEVC encoder the job falls back to ffmpeg's x264.
  mp4: ['avc', 'hevc'],
  mov: ['avc', 'hevc'],
  webm: ['vp9', 'vp8', 'av1'],
};
const AUDIO_CODECS: Record<VideoJob['container'], AudioCodec[]> = {
  mp4: ['aac', 'opus'],
  mov: ['aac'],
  webm: ['opus', 'vorbis'],
};

/**
 * Bitrate for the job: explicit (target size), or from the quality step for
 * this frame size and rate. Newer codecs need about 30% less than H.264.
 */
function qualityOf(job: VideoJob, codec: VideoCodec, size: { width: number; height: number }, fps: number): Quality {
  if (job.videoBitrate) return new Quality({ bitrate: job.videoBitrate });
  const rate = bitrateFor(job.quality ?? 'high', size.width, size.height, Math.min(fps, job.fps ?? fps));
  return new Quality({ bitrate: Math.round(codec === 'avc' || codec === 'vp8' ? rate : rate * 0.7) });
}

/** Run a job with WebCodecs. Throws `NeedsFallback` when it can't. */
export async function transcode(file: FileData, job: VideoJob, progress: Progress): Promise<OutputFile> {
  const input = await open(file);
  const reencode = needsReencode(job);
  const track = await videoTrack(input, reencode);
  const source = { width: track.displayWidth, height: track.displayHeight };
  const size = outputSize(job, source.width, source.height);

  const format = outputFormat(job.container);
  const target = new BufferTarget();
  const output = new Output({ format, target });

  let videoCodec: VideoCodec | undefined;
  if (reencode) {
    const allowed = format.getSupportedVideoCodecs();
    videoCodec = (await getFirstEncodableVideoCodec(VIDEO_CODECS[job.container].filter((c) => allowed.includes(c)), size)) ?? undefined;
    if (!videoCodec) throw new NeedsFallback('no video encoder');
  }
  const fps = reencode ? ((await track.computePacketStats(60).catch(() => null))?.averagePacketRate || 30) : 30;
  const audioTrack = job.audio === 'keep' ? await input.getPrimaryAudioTrack() : null;
  let audioCodec: AudioCodec | undefined;
  if (audioTrack && !format.getSupportedAudioCodecs().includes(audioTrack.codec!)) {
    audioCodec = (await getFirstEncodableAudioCodec(AUDIO_CODECS[job.container])) ?? undefined;
  }

  // Mediabunny rotates and flips before cropping, so the crop drawn on the
  // unrotated frame is turned with it.
  const rotation = job.rotate ?? 0;
  const rotated = rotation === 90 || rotation === 270 ? { width: source.height, height: source.width } : source;
  const crop = job.crop ? cropPixels(rotateBox(job.crop, rotation), rotated.width, rotated.height) : undefined;
  const shrink = job.maxSide && Math.min(crop?.width ?? rotated.width, crop?.height ?? rotated.height) > job.maxSide;

  // Two flips make a half turn, so a vertical flip is a horizontal flip
  // (Mediabunny's only flip) turned by 180°.
  const flip = !!job.flipH !== !!job.flipV;
  const turn = job.flipV ? (((rotation + 180) % 360) as typeof rotation) : rotation;

  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    trim: job.trim ? { start: job.trim.start, end: job.trim.end > 0 ? job.trim.end : undefined } : undefined,
    copy: reencode ? false : {},
    video: {
      rotate: turn,
      flip: flip || undefined,
      crop,
      width: shrink ? size.width : undefined,
      height: shrink ? size.height : undefined,
      fit: shrink ? 'fill' : undefined,
      frameRate: job.fps,
      codec: videoCodec,
      quality: videoCodec ? qualityOf(job, videoCodec, size, fps) : undefined,
      forceTranscode: reencode,
      process: maskProcessor(job),
    },
    audio: job.audio === 'remove' ? { discard: true } : { codec: audioCodec, quality: new Quality('high') },
    showWarnings: false,
  });
  ensureValid(conversion);
  conversion.onProgress = (p) => progress(p, reencode ? 'Encoding' : 'Copying');
  await conversion.execute();

  return {
    name: `${baseName(file.name)}.${job.container}`,
    type: VIDEO_TYPES[job.container],
    bytes: new Uint8Array(target.buffer!),
  };
}

/**
 * A track the browser can't decode or encode would be left out of the
 * result; ffmpeg can handle it, so hand the job over rather than silently
 * dropping the picture or the sound.
 */
function ensureValid(conversion: Conversion): void {
  const dropped = conversion.discardedTracks.find((d) => d.reason !== 'discarded_by_user');
  if (dropped) throw new NeedsFallback(dropped.reason);
  if (!conversion.isValid) throw new NeedsFallback('invalid conversion');
}

/** A frame processor that hides the job's masked areas, or undefined when there are none. */
function maskProcessor(job: VideoJob): ((sample: VideoSample) => VideoSample | OffscreenCanvas) | undefined {
  const masks = job.masks;
  if (!masks?.boxes.length) return undefined;
  let canvas: OffscreenCanvas | undefined;
  let ctx: OffscreenCanvasRenderingContext2D | undefined;
  return (sample) => {
    const active = masks.boxes.filter((m: MaskBox) => maskActive(m, sample.timestamp));
    if (!active.length) return sample;
    if (!canvas || canvas.width !== sample.displayWidth || canvas.height !== sample.displayHeight) {
      canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
      ctx = canvas.getContext('2d')!;
    }
    sample.draw(ctx!, 0, 0);
    for (const m of active) drawMask(ctx!, cropPixels(m, canvas.width, canvas.height), masks.style, masks.strength, masks.color);
    return canvas;
  };
}

// ---------------------------------------------------------------------------
// Exports to other formats
// ---------------------------------------------------------------------------

export interface GifOptions {
  range: TimeRange;
  fps: number;
  /** Width in pixels; 0 keeps the original (capped at 800). */
  width: number;
  loop: boolean;
}

/** Longest GIF we make, in seconds: GIFs grow very fast. */
export const GIF_MAX_SECONDS = 30;

/** Turn part of a video into an animated GIF (WebCodecs decoding, gifenc encoding). */
export async function toGif(file: FileData, options: GifOptions, progress: Progress): Promise<OutputFile> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const input = await open(file);
  const track = await videoTrack(input);
  const duration = await input.computeDuration();
  const start = Math.min(options.range.start, duration);
  const end = Math.min(options.range.end > 0 ? options.range.end : duration, start + GIF_MAX_SECONDS, duration);
  const width = Math.min(options.width || track.displayWidth, track.displayWidth, 800);
  const { width: w, height: h } = fitSize(track.displayWidth, track.displayHeight, Math.min(track.displayWidth, track.displayHeight) * (width / track.displayWidth));
  const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill' });

  const step = 1 / options.fps;
  const times: number[] = [];
  for (let t = start; t < end; t += step) times.push(t);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / options.fps);
  let i = 0;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    i++;
    if (!frame) continue;
    const ctx = (frame.canvas as OffscreenCanvas).getContext('2d', { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay, repeat: options.loop ? 0 : -1 });
    progress(i / times.length, `Frame ${i} of ${times.length}`);
  }
  gif.finish();
  return { name: `${baseName(file.name)}.gif`, type: 'image/gif', bytes: gif.bytes() };
}

export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'ogg';

export const AUDIO_TYPES: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

/** Save the sound track as an audio file. */
export async function extractAudio(file: FileData, format: AudioFormat, progress: Progress): Promise<OutputFile> {
  const input = await open(file);
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('This video has no sound to extract.');
  if (!(await track.canDecode())) throw new NeedsFallback('undecodable audio');
  let out: OutputFormat;
  let codec: AudioCodec | undefined;
  if (format === 'mp3') {
    if (!(await canEncodeAudio('mp3'))) (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
    out = new Mp3OutputFormat();
  } else if (format === 'wav') {
    out = new WavOutputFormat();
  } else if (format === 'ogg') {
    out = new OggOutputFormat();
    codec = (await getFirstEncodableAudioCodec(['opus', 'vorbis'])) ?? undefined;
    if (!codec) throw new NeedsFallback('no opus encoder');
  } else {
    out = new Mp4OutputFormat({ fastStart: 'in-memory' });
    if (track.codec !== 'aac') {
      codec = (await canEncodeAudio('aac')) ? 'aac' : undefined;
      if (!codec) throw new NeedsFallback('no aac encoder');
    }
  }
  const target = new BufferTarget();
  const conversion = await Conversion.init({
    input,
    output: new Output({ format: out, target }),
    tracks: 'primary',
    video: { discard: true },
    audio: { codec, quality: new Quality('high') },
    showWarnings: false,
  });
  if (!conversion.isValid) throw new NeedsFallback('invalid audio conversion');
  conversion.onProgress = (p) => progress(p, 'Extracting sound');
  await conversion.execute();
  return { name: `${baseName(file.name)}.${format}`, type: AUDIO_TYPES[format], bytes: new Uint8Array(target.buffer!) };
}

/** One frame as a PNG or JPEG image. */
export async function grabFrame(file: FileData, time: number, type: 'image/png' | 'image/jpeg'): Promise<OutputFile> {
  const input = await open(file);
  const track = await videoTrack(input);
  const first = await track.getFirstTimestamp();
  const sink = new CanvasSink(track, {});
  const frame = (await sink.getCanvas(Math.max(time, first))) ?? (await sink.getCanvas(first));
  if (!frame) throw new Error("Couldn't read a frame at that time.");
  const canvas = frame.canvas;
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type, quality: 0.92 })
      : await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding the frame failed.'))), type, 0.92));
  const stamp = time.toFixed(1).replace('.', '_');
  return { name: `${baseName(file.name)}-${stamp}s.${type === 'image/png' ? 'png' : 'jpg'}`, type, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

/**
 * Rewrite a browser recording without re-encoding. MediaRecorder writes WebM
 * files with no duration or seek index, so players can't show the length or
 * jump around; copying the packets into a fresh file fixes both.
 */
export async function remux(file: FileData): Promise<FileData> {
  const input = await open(file);
  const container = file.type.includes('mp4') ? 'mp4' : 'webm';
  const target = new BufferTarget();
  const conversion = await Conversion.init({ input, output: new Output({ format: outputFormat(container), target }), showWarnings: false });
  if (!conversion.isValid) throw new Error('This recording could not be read.');
  await conversion.execute();
  return { name: file.name, type: VIDEO_TYPES[container], bytes: new Uint8Array(target.buffer!) };
}
