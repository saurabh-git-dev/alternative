/**
 * Convert image: change format, e.g. PNG → WebP, HEIC → JPG.
 *
 * Decoding uses the browser (so input support follows the browser: HEIC works
 * in Safari only for now). Encoding uses the Squoosh codecs.
 * Defaults per target: WebP 80, AVIF 60 (AVIF quality numbers run lower for
 * the same look), JPG 85, PNG lossless.
 */
import type { ActionDefinition } from '../../core/types';
import { renameFor } from '../../core/files';

export const convertImage: ActionDefinition = {
  id: 'image.convert',
  title: 'Convert image',
  description: 'Convert between JPG, PNG, WebP and AVIF.',
  category: 'image',
  icon: '🔁',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Convert',
  produces: (_, p) => p.format as string,
  engines: ['MozJPEG', 'libwebp', 'libavif', 'OxiPNG'],
  params: {
    format: {
      kind: 'enum',
      label: 'Convert to',
      default: 'image/webp',
      options: [
        { value: 'image/jpeg', label: 'JPG', hint: 'Works everywhere' },
        { value: 'image/png', label: 'PNG', hint: 'Lossless, keeps transparency' },
        { value: 'image/webp', label: 'WebP', hint: 'Much smaller than JPG, widely supported' },
        { value: 'image/avif', label: 'AVIF', hint: 'Smallest files, slower to create' },
      ],
    },
    quality: {
      kind: 'number',
      label: 'Quality',
      help: 'Leave at 0 for the recommended value for the chosen format.',
      default: 0,
      min: 0,
      max: 100,
      unit: '%',
      advanced: true,
      visibleWhen: (v) => v.format !== 'image/png',
    },
    background: {
      kind: 'color',
      label: 'Background for transparent areas',
      help: 'JPG has no transparency, so see-through areas get this colour.',
      default: '#ffffff',
      advanced: true,
      visibleWhen: (v) => v.format === 'image/jpeg',
    },
  },
  async run([file], params, ctx) {
    const { decode, encode } = await import('../../engines/image');
    const format = params.format as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';
    const recommended = { 'image/jpeg': 85, 'image/webp': 80, 'image/avif': 60, 'image/png': 100 }[format];
    const pixels = await decode(file.bytes, file.type);
    ctx.progress(0.3, 'Encoding');
    const bytes = await encode(pixels, format, {
      quality: (params.quality as number) || recommended,
      background: params.background as string,
      pngLevel: 2,
    });
    return [{ name: renameFor(file.name, format), type: format, bytes }];
  },
};
