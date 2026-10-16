/**
 * Rotate / flip image.
 *
 * Engine: exact pixel transform (no resampling), then re-encode. PNG stays
 * lossless; JPEG/WebP/AVIF are re-encoded at quality 92 to minimise loss.
 */
import type { ActionDefinition } from '../../core/types';
import { renameFor } from '../../core/files';

export const rotateImage: ActionDefinition = {
  id: 'image.rotate',
  title: 'Rotate image',
  description: 'Rotate or mirror images in bulk.',
  category: 'image',
  icon: '↩️',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Rotate',
  engines: ['MozJPEG', 'libwebp', 'OxiPNG'],
  params: {
    angle: {
      kind: 'enum',
      label: 'Rotation',
      default: '90',
      options: [
        { value: '90', label: '↻ 90° right' },
        { value: '180', label: '180°' },
        { value: '270', label: '↺ 90° left' },
        { value: '0', label: 'None' },
      ],
    },
    flip: {
      kind: 'enum',
      label: 'Mirror',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'h', label: '⇋ Horizontal' },
        { value: 'v', label: '⥮ Vertical' },
      ],
    },
    quality: { kind: 'number', label: 'Output quality', default: 92, min: 10, max: 100, unit: '%', advanced: true },
  },
  async run([file], params) {
    const { decode, encode, transform, encodableFormat } = await import('../../engines/image');
    const pixels = await decode(file.bytes, file.type);
    const out = transform(pixels, Number(params.angle) as 0 | 90 | 180 | 270, params.flip === 'h', params.flip === 'v');
    const format = encodableFormat(file.type);
    const bytes = await encode(out, format, { quality: params.quality as number });
    return [{ name: renameFor(file.name, format, '-rotated'), type: format, bytes }];
  },
};
