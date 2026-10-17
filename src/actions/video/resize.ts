/**
 * Resize video: scale down to a standard resolution, keeping the shape.
 */
import type { ActionDefinition } from '../../core/types';
import type { VideoQuality } from '../../core/video';
import { RESOLUTIONS } from './compress';
import { VIDEO_ACCEPTS, VIDEO_DEMANDING, VIDEO_ENGINES, audioParam, containerOf, formatParam, runJob } from './shared';

export const resizeVideo: ActionDefinition = {
  id: 'video.resize',
  title: 'Resize video',
  description: 'Scale videos down to 1080p, 720p, 480p and more.',
  category: 'video-convert',
  icon: '📐',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  verb: 'Resize',
  engines: VIDEO_ENGINES,
  demanding: VIDEO_DEMANDING,
  params: {
    resolution: { kind: 'enum', label: 'Resolution', help: 'The shorter side of the frame. Videos are never enlarged.', default: '720', options: RESOLUTIONS.slice(1), display: 'select' },
    audio: audioParam,
    quality: {
      kind: 'enum',
      label: 'Quality',
      default: 'high',
      options: [
        { value: 'very-high', label: 'Best' },
        { value: 'high', label: 'High' },
        { value: 'medium', label: 'Smaller file' },
      ],
      display: 'segmented',
      advanced: true,
    },
    format: formatParam,
  },
  async run([file], params, ctx) {
    const maxSide = Number(params.resolution);
    return [await runJob(file, { container: containerOf(params.format, file), maxSide, quality: params.quality as VideoQuality, audio: params.audio as 'keep' | 'remove' }, ctx, `-${maxSide}p`)];
  },
};
