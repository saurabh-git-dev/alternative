/**
 * Save a frame: one moment of a video as a full-resolution image, picked
 * with the player.
 */
import type { ActionDefinition } from '../../core/types';
import { VIDEO_ACCEPTS, VIDEO_ENGINES } from './shared';

export const videoFrame: ActionDefinition = {
  id: 'video.frame',
  title: 'Save a frame',
  description: 'Grab a still from any moment of a video as PNG or JPG.',
  category: 'video-export',
  icon: '📸',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  maxFiles: 1,
  verb: 'Save frame',
  engines: VIDEO_ENGINES,
  params: {
    time: { kind: 'videoTime', label: 'Moment', default: 0 },
    format: {
      kind: 'enum',
      label: 'Format',
      default: 'image/png',
      options: [
        { value: 'image/png', label: 'PNG', hint: 'Lossless' },
        { value: 'image/jpeg', label: 'JPG', hint: 'Smaller' },
      ],
      display: 'segmented',
    },
  },
  produces: (_type, params) => params.format as string,
  async run([file], params, ctx) {
    const video = await import('../../engines/video');
    const type = params.format as 'image/png' | 'image/jpeg';
    const time = params.time as number;
    return [
      await video.withFallback(
        () => video.grabFrame(file, time, type),
        async () => (await import('../../engines/ffmpeg')).grabFrame(file, time, type, ctx.progress),
        ctx.progress,
      ),
    ];
  },
};
