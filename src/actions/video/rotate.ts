/**
 * Rotate or flip video. Rotation alone is lossless and instant where the
 * format allows it (MP4 and MOV store the rotation); flipping, or rotating
 * WebM, re-encodes.
 */
import type { ActionDefinition } from '../../core/types';
import type { Rotation } from '../../core/video';
import { VIDEO_ACCEPTS, VIDEO_DEMANDING, VIDEO_ENGINES, containerOf, formatParam, runJob } from './shared';

export const rotateVideo: ActionDefinition = {
  id: 'video.rotate',
  title: 'Rotate or flip video',
  description: 'Fix sideways phone videos or mirror a selfie clip.',
  category: 'video-edit',
  icon: '🔄',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  verb: 'Rotate',
  engines: VIDEO_ENGINES,
  demanding: VIDEO_DEMANDING,
  params: {
    rotate: {
      kind: 'enum',
      label: 'Rotate',
      default: '90',
      options: [
        { value: '0', label: 'None' },
        { value: '90', label: '90° right' },
        { value: '180', label: '180°' },
        { value: '270', label: '90° left' },
      ],
      display: 'segmented',
    },
    flip: {
      kind: 'enum',
      label: 'Flip',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'h', label: 'Mirror' },
        { value: 'v', label: 'Upside down' },
      ],
      display: 'segmented',
    },
    format: formatParam,
  },
  async run([file], params, ctx) {
    const rotate = Number(params.rotate) as Rotation;
    const flipH = params.flip === 'h';
    const flipV = params.flip === 'v';
    if (!rotate && !flipH && !flipV) throw new Error('Pick a rotation or a flip first.');
    const container = containerOf(params.format, file);
    // MP4 and MOV keep a rotation flag, so rotating alone needs no re-encode.
    const copy = !flipH && !flipV && container !== 'webm';
    return [await runJob(file, { container, rotate, flipH, flipV, copy, quality: copy ? undefined : 'very-high', audio: 'keep' }, ctx, '-rotated')];
  },
};
