/**
 * Compress video: smaller files for sharing, by re-encoding at a lower
 * bitrate and, optionally, a lower resolution and frame rate.
 *
 * Quality steps map to bitrates for the frame size (core/video.ts), or a
 * target file size sets the bitrate directly. Quality guard: if the result
 * isn't smaller, the original is kept.
 */
import type { ActionDefinition } from '../../core/types';
import { bitrateForSize, type VideoQuality } from '../../core/video';
import { VIDEO_ACCEPTS, VIDEO_DEMANDING, VIDEO_ENGINES, audioParam, containerOf, formatParam, probeVideo, runJob } from './shared';

export const RESOLUTIONS = [
  { value: '0', label: 'Original' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p (Full HD)' },
  { value: '720', label: '720p (HD)' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: '240', label: '240p' },
];

export const compressVideo: ActionDefinition = {
  id: 'video.compress',
  title: 'Compress video',
  description: 'Make videos much smaller for email, chat and uploads.',
  category: 'video-convert',
  icon: '🗜️',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  verb: 'Compress',
  engines: VIDEO_ENGINES,
  demanding: VIDEO_DEMANDING,
  defaultPreset: 'recommended',
  presets: [
    { id: 'light', label: 'Light', description: 'Looks the same, keeps the resolution', values: { target: 'quality', quality: 'high', resolution: '0', fps: '0' } },
    { id: 'recommended', label: 'Recommended', description: 'Up to 1080p, big savings', values: { target: 'quality', quality: 'medium', resolution: '1080', fps: '0' } },
    { id: 'strong', label: 'Strong', description: '720p at 30 fps, smallest files', values: { target: 'quality', quality: 'low', resolution: '720', fps: '30' } },
  ],
  params: {
    target: {
      kind: 'enum',
      label: 'Aim for',
      default: 'quality',
      options: [
        { value: 'quality', label: 'Quality' },
        { value: 'size', label: 'File size' },
      ],
      display: 'segmented',
    },
    quality: {
      kind: 'enum',
      label: 'Quality',
      default: 'medium',
      options: [
        { value: 'high', label: 'High' },
        { value: 'medium', label: 'Good' },
        { value: 'low', label: 'Low' },
        { value: 'very-low', label: 'Tiny' },
      ],
      display: 'segmented',
      visibleWhen: (v) => v.target === 'quality',
    },
    sizeMB: {
      kind: 'number',
      label: 'Target size',
      help: 'The video is encoded to land close to this size. Very small targets look blocky.',
      default: 10,
      min: 1,
      max: 2000,
      unit: 'MB',
      display: 'input',
      visibleWhen: (v) => v.target === 'size',
    },
    resolution: { kind: 'enum', label: 'Resolution (at most)', default: '1080', options: RESOLUTIONS, display: 'select' },
    audio: audioParam,
    fps: {
      kind: 'enum',
      label: 'Frame rate (at most)',
      default: '0',
      options: [
        { value: '0', label: 'Original' },
        { value: '60', label: '60 fps' },
        { value: '30', label: '30 fps' },
        { value: '24', label: '24 fps' },
        { value: '15', label: '15 fps (screen recordings)' },
      ],
      display: 'select',
      advanced: true,
    },
    format: formatParam,
  },
  async run([file], params, ctx) {
    const audio = params.audio as 'keep' | 'remove';
    let videoBitrate: number | undefined;
    if (params.target === 'size') {
      const info = await probeVideo(file);
      const bitrate = bitrateForSize((params.sizeMB as number) * 1024 * 1024, info.duration, audio === 'keep' && info.hasAudio);
      if (!bitrate) throw new Error('That target is too small for this video’s length. Try a larger size or trim it first.');
      videoBitrate = bitrate;
    }
    const out = await runJob(
      file,
      {
        container: containerOf(params.format, file),
        quality: params.quality as VideoQuality,
        videoBitrate,
        maxSide: Number(params.resolution) || undefined,
        fps: Number(params.fps) || undefined,
        audio,
      },
      ctx,
      '-compressed',
    );
    if (out.bytes.length >= file.bytes.length && out.type === file.type) {
      return [{ ...file, name: file.name, note: 'Already well compressed: the original is smaller, so it was kept.' }];
    }
    return [out];
  },
};
