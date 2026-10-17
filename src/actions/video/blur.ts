/**
 * Blur or hide area: draw boxes over faces, number plates, names or screen
 * contents to blur, pixelate or cover them, each for the whole video or
 * just part of it.
 *
 * The hidden pixels are really gone in the output (every frame is
 * re-encoded); see engines/video-effects.ts for how each effect is drawn.
 */
import type { ActionDefinition } from '../../core/types';
import type { MaskBox, MaskStyle, VideoQuality } from '../../core/video';
import { VIDEO_ACCEPTS, VIDEO_DEMANDING, VIDEO_ENGINES, audioParam, containerOf, formatParam, runJob } from './shared';

export const blurVideo: ActionDefinition = {
  id: 'video.blur',
  title: 'Blur or hide area',
  description: 'Blur, pixelate or cover faces, plates and private details in a video.',
  category: 'video-edit',
  icon: '🫥',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  maxFiles: 1,
  verb: 'Hide areas',
  engines: VIDEO_ENGINES,
  demanding: VIDEO_DEMANDING,
  params: {
    masks: {
      kind: 'masks',
      label: 'Areas to hide',
      default: [],
      preview: (v) => ({ style: v.style as MaskStyle, strength: v.strength as number, color: v.color as string }),
    },
    style: {
      kind: 'enum',
      label: 'Effect',
      default: 'blur',
      options: [
        { value: 'blur', label: 'Blur' },
        { value: 'pixelate', label: 'Pixelate' },
        { value: 'solid', label: 'Solid box' },
      ],
      display: 'segmented',
    },
    strength: { kind: 'number', label: 'Strength', default: 60, min: 0, max: 100, unit: '%', visibleWhen: (v) => v.style !== 'solid' },
    color: { kind: 'color', label: 'Box colour', default: '#000000', visibleWhen: (v) => v.style === 'solid' },
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
        {
          container: containerOf(params.format, file),
          masks: { boxes: params.masks as MaskBox[], style: params.style as MaskStyle, strength: params.strength as number, color: params.color as string },
          quality: params.quality as VideoQuality,
          audio: params.audio as 'keep' | 'remove',
        },
        ctx,
        '-hidden',
      ),
    ];
  },
};
