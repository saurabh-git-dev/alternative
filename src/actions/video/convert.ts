/**
 * Convert video between MP4, WebM and MOV. Also opens formats browsers
 * can't play, such as AVI, MKV, WMV, FLV and MPEG, through ffmpeg.wasm.
 *
 * Copies the encoded video when the new format can hold it (instant, no
 * quality loss) and re-encodes otherwise.
 */
import type { ActionDefinition } from '../../core/types';
import type { VideoContainer } from '../../core/video';
import { VIDEO_ACCEPTS, VIDEO_DEMANDING, VIDEO_ENGINES, audioParam, runJob } from './shared';

export const convertVideo: ActionDefinition = {
  id: 'video.convert',
  title: 'Convert video',
  description: 'MP4, WebM or MOV from almost any video, including AVI, MKV and WMV.',
  category: 'video-convert',
  icon: '🔁',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  verb: 'Convert',
  engines: VIDEO_ENGINES,
  demanding: VIDEO_DEMANDING,
  params: {
    format: {
      kind: 'enum',
      label: 'Convert to',
      default: 'mp4',
      options: [
        { value: 'mp4', label: 'MP4', hint: 'Plays everywhere' },
        { value: 'webm', label: 'WebM', hint: 'Open format for the web' },
        { value: 'mov', label: 'MOV', hint: 'For Apple apps' },
      ],
      display: 'segmented',
    },
    audio: audioParam,
    reencode: {
      kind: 'boolean',
      label: 'Always re-encode',
      help: 'Normally the video is copied as is when the new format can hold it. Turn on for the widest compatibility.',
      default: false,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const container = params.format as VideoContainer;
    return [await runJob(file, { container, copy: !params.reencode, quality: params.reencode ? 'high' : undefined, audio: params.audio as 'keep' | 'remove' }, ctx)];
  },
};
