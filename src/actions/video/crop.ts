/**
 * Crop video: draw a box on the video to keep only that part of the frame,
 * e.g. to cut away black bars or turn landscape into a 9:16 story.
 */
import type { ActionDefinition, Box } from '../../core/types';
import type { VideoQuality } from '../../core/video';
import { VIDEO_ACCEPTS, VIDEO_DEMANDING, VIDEO_ENGINES, audioParam, containerOf, formatParam, runJob } from './shared';

export const cropVideo: ActionDefinition = {
  id: 'video.crop',
  title: 'Crop video',
  description: 'Keep only part of the frame, with handy aspect ratios like 9:16 and 1:1.',
  category: 'video-edit',
  icon: '🔲',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  maxFiles: 1,
  verb: 'Crop',
  engines: VIDEO_ENGINES,
  demanding: VIDEO_DEMANDING,
  params: {
    box: { kind: 'crop', label: 'Crop area', default: { x: 0, y: 0, w: 1, h: 1 } },
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
    return [
      await runJob(
        file,
        { container: containerOf(params.format, file), crop: params.box as Box, quality: params.quality as VideoQuality, audio: params.audio as 'keep' | 'remove' },
        ctx,
        '-cropped',
      ),
    ];
  },
};
