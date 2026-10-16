/**
 * Compress image: smaller files with minimal visible difference.
 *
 * Engines: MozJPEG / libwebp / libavif / OxiPNG via jSquash.
 * By default the format is kept; JPEG, WebP and AVIF are re-encoded at the
 * chosen quality and PNG is optimised losslessly. Metadata is dropped as a
 * side effect of re-encoding (orientation is baked into the pixels first).
 *
 * Quality guard: if the result is larger than the original, the original is kept.
 */
import type { ActionDefinition } from '../../core/types';
import { renameFor } from '../../core/files';

export const compressImage: ActionDefinition = {
  id: 'image.compress',
  title: 'Compress image',
  description: 'Shrink JPG, PNG, WebP and AVIF files with the best open-source encoders.',
  category: 'image',
  icon: '🪶',
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  mode: 'each',
  verb: 'Compress',
  engines: ['MozJPEG', 'libwebp', 'libavif', 'OxiPNG'],
  defaultPreset: 'recommended',
  presets: [
    { id: 'light', label: 'Light', description: 'Visually identical, smaller savings', values: { quality: 88, pngLevel: 2 } },
    { id: 'recommended', label: 'Recommended', description: 'Hard to tell apart, big savings', values: { quality: 75, pngLevel: 3 } },
    { id: 'strong', label: 'Strong', description: 'Smallest files, some visible softening', values: { quality: 55, pngLevel: 4 } },
  ],
  params: {
    quality: {
      kind: 'number',
      label: 'Quality',
      help: 'Lower means smaller files. 70–80 is the sweet spot for photos.',
      default: 75,
      min: 10,
      max: 100,
      unit: '%',
      advanced: true,
    },
    pngLevel: {
      kind: 'number',
      label: 'PNG effort',
      help: 'PNG compression is lossless; higher effort is slower but smaller.',
      default: 3,
      min: 1,
      max: 6,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const { decode, encode, optimisePng } = await import('../../engines/image');
    ctx.progress(0.1, 'Compressing');
    let bytes: Uint8Array;
    if (file.type === 'image/png') {
      bytes = await optimisePng(file.bytes, params.pngLevel as number);
    } else {
      const pixels = await decode(file.bytes, file.type);
      ctx.progress(0.4, 'Encoding');
      bytes = await encode(pixels, file.type as 'image/jpeg', { quality: params.quality as number });
    }
    const name = renameFor(file.name, file.type, '-compressed');
    if (bytes.length >= file.bytes.length) {
      return [{ name, type: file.type, bytes: file.bytes, note: 'Already well optimised, so the original was kept.' }];
    }
    return [{ name, type: file.type, bytes }];
  },
};
