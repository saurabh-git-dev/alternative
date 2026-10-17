/**
 * Remove audio: the same video without its sound track. The video is copied
 * as is, so it's instant and lossless.
 */
import type { ActionDefinition } from '../../core/types';
import { VIDEO_ACCEPTS, VIDEO_ENGINES, containerOf, runJob } from './shared';

export const muteVideo: ActionDefinition = {
  id: 'video.mute',
  title: 'Remove audio',
  description: 'Silence a video by removing its sound track, instantly.',
  category: 'video-convert',
  icon: '🔇',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  verb: 'Remove audio',
  engines: VIDEO_ENGINES,
  params: {},
  async run([file], _params, ctx) {
    return [await runJob(file, { container: containerOf('same', file), copy: true, audio: 'remove' }, ctx, '-muted')];
  },
};
