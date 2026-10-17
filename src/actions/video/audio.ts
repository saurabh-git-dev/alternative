/**
 * Extract audio: save a video's sound as MP3, M4A, WAV or Ogg (Opus).
 */
import type { ActionDefinition } from '../../core/types';
import { VIDEO_ACCEPTS, VIDEO_ENGINES } from './shared';

export const extractAudio: ActionDefinition = {
  id: 'video.audio',
  title: 'Extract audio',
  description: 'Save the sound of a video as MP3, M4A or WAV.',
  category: 'video-export',
  icon: '🎵',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  verb: 'Extract audio',
  engines: ['WebCodecs (via Mediabunny)', 'LAME (MP3)', 'ffmpeg.wasm for other formats'],
  params: {
    format: {
      kind: 'enum',
      label: 'Format',
      default: 'mp3',
      options: [
        { value: 'mp3', label: 'MP3', hint: 'Plays everywhere' },
        { value: 'm4a', label: 'M4A', hint: 'AAC, smaller at the same quality' },
        { value: 'wav', label: 'WAV', hint: 'Uncompressed, for editing' },
        { value: 'ogg', label: 'Ogg', hint: 'Opus, open format' },
      ],
      display: 'segmented',
    },
  },
  produces: (_type, params) => ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg' })[params.format as string] ?? 'audio/mpeg',
  async run([file], params, ctx) {
    const video = await import('../../engines/video');
    const format = params.format as 'mp3' | 'm4a' | 'wav' | 'ogg';
    return [
      await video.withFallback(
        () => video.extractAudio(file, format, ctx.progress),
        async () => (await import('../../engines/ffmpeg')).extractAudio(file, format, video.AUDIO_TYPES[format], ctx.progress),
        ctx.progress,
      ),
    ];
  },
};
