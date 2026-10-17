/**
 * Video to GIF: an animated GIF from part of a video, for chats and docs.
 *
 * GIFs are big (256 colours, no inter-frame compression), so clips are
 * capped at 30 seconds and default to the first 6 at 480 px wide.
 */
import type { ActionDefinition } from '../../core/types';
import type { TimeRange } from '../../core/video';
import { VIDEO_ACCEPTS, VIDEO_ENGINES } from './shared';

export const videoToGif: ActionDefinition = {
  id: 'video.gif',
  title: 'Video to GIF',
  description: 'Turn a short clip into an animated GIF.',
  category: 'video-export',
  icon: '🎞️',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  maxFiles: 1,
  verb: 'Make GIF',
  engines: ['WebCodecs (via Mediabunny)', 'gifenc', 'ffmpeg.wasm for other formats'],
  produces: () => 'image/gif',
  params: {
    range: { kind: 'timeRange', label: 'Clip', default: { start: 0, end: 0 }, initialLength: 6, maxLength: 30 },
    width: {
      kind: 'enum',
      label: 'Width',
      default: '480',
      options: [
        { value: '320', label: '320 px' },
        { value: '480', label: '480 px' },
        { value: '640', label: '640 px' },
        { value: '800', label: '800 px' },
      ],
      display: 'segmented',
    },
    fps: {
      kind: 'enum',
      label: 'Smoothness',
      default: '12',
      options: [
        { value: '8', label: '8 fps' },
        { value: '12', label: '12 fps' },
        { value: '20', label: '20 fps' },
      ],
      display: 'segmented',
    },
    loop: { kind: 'boolean', label: 'Loop forever', default: true },
  },
  async run([file], params, ctx) {
    const video = await import('../../engines/video');
    const options = { range: params.range as TimeRange, fps: Number(params.fps), width: Number(params.width), loop: params.loop as boolean };
    return [
      await video.withFallback(
        () => video.toGif(file, options, ctx.progress),
        async () => (await import('../../engines/ffmpeg')).toGif(file, options.range, options.fps, options.width, options.loop, video.GIF_MAX_SECONDS, ctx.progress),
        ctx.progress,
      ),
    ];
  },
};
