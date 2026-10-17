/**
 * Video jobs: what a video tool asks for, independent of the engine that
 * does it.
 *
 * Every video action describes its work as a `VideoJob` (trim, crop, rotate,
 * resize, hide areas, re-encode …). `engines/video.ts` runs a job with
 * WebCodecs through Mediabunny, which is fast and hardware accelerated, and
 * falls back to ffmpeg.wasm (`engines/ffmpeg.ts`) for files or browsers
 * WebCodecs can't handle. The ffmpeg command line for a job is built here,
 * as pure functions, so both paths are unit-tested in Node.
 */
import type { Box } from './types';

export type VideoContainer = 'mp4' | 'webm' | 'mov';
export type VideoQuality = 'very-high' | 'high' | 'medium' | 'low' | 'very-low';
export type Rotation = 0 | 90 | 180 | 270;
export type MaskStyle = 'blur' | 'pixelate' | 'solid';

/** A part of the frame to hide, in fractions of the frame, shown from `start` to `end` seconds (`end` 0: to the end). */
export interface MaskBox extends Box {
  start: number;
  end: number;
}

/** A stretch of the video in seconds; `end` 0 means "to the end". */
export interface TimeRange {
  start: number;
  end: number;
}

export interface VideoJob {
  container: VideoContainer;
  /** Keep only this part of the video. */
  trim?: TimeRange;
  /**
   * Copy the encoded video instead of re-encoding when nothing else needs
   * the pixels (trim, container change, removing audio, rotation). Fast and
   * lossless; cuts land on the nearest key frame.
   */
  copy?: boolean;
  /** Part of the frame to keep, in fractions of the frame as displayed. Applied before rotation. */
  crop?: Box;
  /** Clockwise rotation in degrees. */
  rotate?: Rotation;
  flipH?: boolean;
  flipV?: boolean;
  /** Shrink so the shorter side is at most this many pixels (e.g. 720 for 720p). Never enlarges. */
  maxSide?: number;
  /** Output frame rate; leave out to keep the original. Never raised. */
  fps?: number;
  quality?: VideoQuality;
  /** Video bitrate in bits per second; overrides `quality` (used for a target file size). */
  videoBitrate?: number;
  audio: 'keep' | 'remove';
  /** Areas to blur, pixelate or cover. Fractions of the source frame. */
  masks?: { boxes: MaskBox[]; style: MaskStyle; strength: number; color: string };
}

export const VIDEO_TYPES: Record<VideoContainer, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** Container to write for an input type when the tool keeps the format: MP4, WebM and MOV stay, anything else becomes MP4. */
export function containerFor(type: string): VideoContainer {
  if (type === 'video/webm') return 'webm';
  if (type === 'video/quicktime') return 'mov';
  return 'mp4';
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Size after shrinking so the shorter side fits `maxSide` (even numbers, never enlarged). */
export function fitSize(width: number, height: number, maxSide?: number): { width: number; height: number } {
  const short = Math.min(width, height);
  const scale = maxSide && short > maxSide ? maxSide / short : 1;
  return { width: even(width * scale), height: even(height * scale) };
}

/** A crop box in pixels, with even sizes as most encoders require. */
export function cropPixels(box: Box, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const w = Math.min(width, even(box.w * width));
  const h = Math.min(height, even(box.h * height));
  const left = Math.min(width - w, Math.max(0, Math.round(box.x * width)));
  const top = Math.min(height - h, Math.max(0, Math.round(box.y * height)));
  return { left, top, width: w, height: h };
}

/** The same box after rotating the frame clockwise by `rotation` (crop is drawn on the unrotated frame). */
export function rotateBox(box: Box, rotation: Rotation): Box {
  switch (rotation) {
    case 90:
      return { x: 1 - box.y - box.h, y: box.x, w: box.h, h: box.w };
    case 180:
      return { x: 1 - box.x - box.w, y: 1 - box.y - box.h, w: box.w, h: box.h };
    case 270:
      return { x: box.y, y: 1 - box.x - box.w, w: box.h, h: box.w };
    default:
      return box;
  }
}

/** Output frame size for a job on a `width` × `height` source (as displayed). */
export function outputSize(job: VideoJob, width: number, height: number): { width: number; height: number } {
  let w = width;
  let h = height;
  if (job.crop) ({ width: w, height: h } = cropPixels(job.crop, width, height));
  if (job.rotate === 90 || job.rotate === 270) [w, h] = [h, w];
  return fitSize(w, h, job.maxSide);
}

/** Is this mask visible at `time` seconds? */
export function maskActive(mask: MaskBox, time: number): boolean {
  return time >= mask.start && (mask.end <= 0 || time < mask.end);
}

/** Bits per pixel per frame for each quality step (H.264-like codecs). */
const BITS_PER_PIXEL: Record<VideoQuality, number> = {
  'very-high': 0.16,
  high: 0.1,
  medium: 0.065,
  low: 0.04,
  'very-low': 0.022,
};

/** A sensible video bitrate (bits/s) for this frame size, frame rate and quality. */
export function bitrateFor(quality: VideoQuality, width: number, height: number, fps = 30): number {
  return Math.round(Math.max(150_000, width * height * Math.min(fps, 60) * BITS_PER_PIXEL[quality]));
}

/** x264 constant-rate factor for each quality step (lower is better). */
const CRF: Record<VideoQuality, number> = { 'very-high': 20, high: 23, medium: 27, low: 31, 'very-low': 35 };

/** Audio bitrate used when re-encoding audio. */
export const AUDIO_BITRATE = 128_000;

/**
 * Video bitrate that makes a file of about `targetBytes`, leaving room for
 * audio and container overhead. Returns null when the target is too small to
 * be watchable.
 */
export function bitrateForSize(targetBytes: number, duration: number, withAudio: boolean): number | null {
  if (!(duration > 0)) return null;
  const total = (targetBytes * 8 * 0.96) / duration;
  const video = total - (withAudio ? AUDIO_BITRATE : 0);
  return video >= 100_000 ? Math.floor(video) : null;
}

export interface SourceInfo {
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  fps?: number;
}

/** Does the job need decoded pixels, or can the encoded video be copied? */
export function needsReencode(job: VideoJob): boolean {
  return !job.copy || !!job.crop || !!job.masks?.boxes.length || !!job.maxSide || !!job.fps || !!job.flipH || !!job.flipV || job.quality !== undefined || job.videoBitrate !== undefined;
}

/**
 * The ffmpeg command line for a job (without the `ffmpeg` itself). Filters
 * run in this order: hide areas (on the source frame), crop, rotate/flip,
 * resize, frame rate.
 */
export function ffmpegArgs(job: VideoJob, info: SourceInfo, input: string, output: string): string[] {
  const args: string[] = [];
  if (job.trim && job.trim.start > 0) args.push('-ss', seconds(job.trim.start));
  if (job.trim && job.trim.end > 0) args.push('-to', seconds(job.trim.end));
  args.push('-i', input);

  if (!needsReencode(job)) {
    args.push('-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy');
    if (job.audio === 'remove') args.push('-an');
    // The source's own rotation is already applied by ffmpeg when reading, so this is the final rotation.
    if (job.rotate) args.push('-metadata:s:v:0', `rotate=${job.rotate}`);
    if (job.container !== 'webm') args.push('-movflags', '+faststart');
    args.push('-avoid_negative_ts', 'make_zero', output);
    return args;
  }

  const chains: string[] = [];
  let label = '0:v';
  const masks = job.masks?.boxes ?? [];
  if (masks.length && job.masks) {
    const { style, strength, color } = job.masks;
    const parts = masks.map((m) => ({ m, px: cropPixels(m, info.width, info.height) }));
    if (style === 'solid') {
      const boxes = parts.map(({ m, px }) => `drawbox=x=${px.left}:y=${px.top}:w=${px.width}:h=${px.height}:color=${color.replace('#', '0x')}@1:t=fill:enable='${enable(m)}'`);
      chains.push(`[${label}]${boxes.join(',')}[masked]`);
    } else {
      chains.push(`[${label}]split=${parts.length + 1}[base]${parts.map((_, i) => `[m${i}]`).join('')}`);
      let base = 'base';
      parts.forEach(({ m, px }, i) => {
        const effect =
          style === 'blur'
            ? `boxblur=${blurRadius(px.width, px.height, strength)}:3`
            : pixelate(px.width, px.height, strength);
        chains.push(`[m${i}]crop=${px.width}:${px.height}:${px.left}:${px.top},${effect}[e${i}]`);
        const next = i === parts.length - 1 ? 'masked' : `b${i}`;
        chains.push(`[${base}][e${i}]overlay=${px.left}:${px.top}:enable='${enable(m)}'[${next}]`);
        base = next;
      });
    }
    label = 'masked';
  }

  const filters: string[] = [];
  if (job.crop) {
    const c = cropPixels(job.crop, info.width, info.height);
    filters.push(`crop=${c.width}:${c.height}:${c.left}:${c.top}`);
  }
  if (job.rotate === 90) filters.push('transpose=1');
  else if (job.rotate === 270) filters.push('transpose=2');
  else if (job.rotate === 180) filters.push('hflip', 'vflip');
  if (job.flipH) filters.push('hflip');
  if (job.flipV) filters.push('vflip');
  const size = outputSize(job, info.width, info.height);
  if (job.maxSide && Math.min(info.width, info.height) > job.maxSide) filters.push(`scale=${size.width}:${size.height}`);
  if (job.fps && (!info.fps || job.fps < info.fps)) filters.push(`fps=${job.fps}`);
  filters.push('format=yuv420p');
  chains.push(`[${label}]${filters.join(',')}[vout]`);
  args.push('-filter_complex', chains.join(';'), '-map', '[vout]');
  if (job.audio === 'keep' && info.hasAudio) args.push('-map', '0:a:0?');

  const quality = job.quality ?? 'high';
  const fps = Math.min(job.fps ?? info.fps ?? 30, info.fps ?? 60);
  if (job.container === 'webm') {
    // VP8 is the only WebM encoder fast enough in WebAssembly.
    const rate = job.videoBitrate ?? bitrateFor(quality, size.width, size.height, fps) * 1.3;
    args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', kbps(rate), '-auto-alt-ref', '0');
    if (job.audio === 'keep' && info.hasAudio) args.push('-c:a', 'libopus', '-b:a', '96k');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast');
    if (job.videoBitrate) args.push('-b:v', kbps(job.videoBitrate), '-maxrate', kbps(job.videoBitrate * 1.5), '-bufsize', kbps(job.videoBitrate * 2));
    else args.push('-crf', String(CRF[quality]));
    if (job.audio === 'keep' && info.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart');
  }
  if (job.audio === 'remove' || !info.hasAudio) args.push('-an');
  args.push(output);
  return args;
}

function enable(m: MaskBox): string {
  return m.end > 0 ? `between(t,${seconds(m.start)},${seconds(m.end)})` : `gte(t,${seconds(m.start)})`;
}

/**
 * Box blur radius for an area. ffmpeg also blurs the colour planes, which
 * are half the size, and rejects a radius over half of their shorter side.
 */
export function blurRadius(w: number, h: number, strength: number): number {
  return Math.max(1, Math.min(Math.floor(Math.min(w, h) / 4) - 1, Math.round(4 + strength * 0.4)));
}

/** Shrink then enlarge with nearest-neighbour: big square blocks. `strength` 0–100. */
function pixelate(w: number, h: number, strength: number): string {
  const block = Math.max(4, Math.round(Math.min(w, h) * (0.04 + strength / 400)));
  return `scale=${Math.max(1, Math.round(w / block))}:${Math.max(1, Math.round(h / block))},scale=${w}:${h}:flags=neighbor`;
}

const seconds = (s: number) => s.toFixed(3).replace(/\.?0+$/, '') || '0';
const kbps = (bps: number) => `${Math.round(bps / 1000)}k`;

/** `75.5` → `1:15.5`, `3725` → `1:02:05`. */
export function formatTime(totalSeconds: number, decimals = 0): string {
  const t = Math.max(0, totalSeconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const sec = decimals ? s.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.floor(s)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
