/**
 * Remove background: cut the subject out of a photo.
 *
 * Engine: RMBG-1.4 via ONNX Runtime Web (see engines/ai-image.ts). The model
 * (44 MB) downloads on first use and is cached. Output is a PNG or WebP with
 * transparency, or the original format when a background colour is chosen.
 */
import type { ActionDefinition } from '../../core/types';
import { renameFor } from '../../core/files';

export const removeBackground: ActionDefinition = {
  id: 'image.remove-background',
  title: 'Remove background',
  description: 'Cut out the subject of a photo with AI. Hair and soft edges stay natural.',
  category: 'image',
  icon: '✂️',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Remove background',
  produces: (type, p) =>
    p.fill === 'color' ? (['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type) ? type : 'image/png') : (p.format as string),
  engines: ['RMBG-1.4', 'ONNX Runtime'],
  params: {
    fill: {
      kind: 'enum',
      label: 'New background',
      default: 'transparent',
      options: [
        { value: 'transparent', label: 'Transparent' },
        { value: 'color', label: 'Colour' },
      ],
    },
    color: {
      kind: 'color',
      label: 'Background colour',
      default: '#ffffff',
      visibleWhen: (v) => v.fill === 'color',
    },
    crop: {
      kind: 'boolean',
      label: 'Crop to the subject',
      help: 'Trim empty space around the cut-out, leaving a small margin.',
      default: false,
    },
    edgeCleanup: {
      kind: 'number',
      label: 'Edge cleanup',
      help: 'Raise if a faint halo of the old background remains; lower if fine hair gets cut off.',
      default: 30,
      min: 0,
      max: 100,
      unit: '%',
      advanced: true,
    },
    format: {
      kind: 'enum',
      label: 'Save as',
      default: 'image/png',
      advanced: true,
      options: [
        { value: 'image/png', label: 'PNG', hint: 'Lossless, opens everywhere' },
        { value: 'image/webp', label: 'WebP', hint: 'Much smaller, for the web' },
      ],
      visibleWhen: (v) => v.fill === 'transparent',
    },
  },
  async run([file], params, ctx) {
    const { decode, encode, encodableFormat } = await import('../../engines/image');
    const { foregroundMatte, applyMatte } = await import('../../engines/ai-image');
    const pixels = await decode(file.bytes, file.type);
    const matte = await foregroundMatte(pixels, (f, m) => ctx.progress(f * 0.9, m));
    const coloured = params.fill === 'color';
    const result = applyMatte(pixels, matte, {
      background: coloured ? (params.color as string) : undefined,
      edgeCleanup: params.edgeCleanup as number,
      cropMargin: params.crop ? Math.round(Math.max(subjectMargin(pixels), 4)) : undefined,
    });
    ctx.progress(0.92, 'Encoding');
    const format = coloured ? encodableFormat(file.type) : (params.format as 'image/png' | 'image/webp');
    const bytes = await encode(result, format, { quality: format === 'image/webp' ? 90 : 92, pngLevel: 2 });
    return [{ name: renameFor(file.name, format, coloured ? '-new-background' : '-no-background'), type: format, bytes }];
  },
};

/** Margin around a cropped subject: 2% of the longer side. */
function subjectMargin(image: { width: number; height: number }): number {
  return Math.max(image.width, image.height) * 0.02;
}
