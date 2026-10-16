/**
 * Crop image: draw a box on the first image; the same area (in proportion)
 * is cropped from every image in the batch.
 *
 * Engine: exact pixel copy (no resampling), then re-encoded at q92 (PNG stays
 * lossless).
 */
import type { ActionDefinition, Box } from '../../core/types';
import { renameFor } from '../../core/files';

export const cropImage: ActionDefinition = {
  id: 'image.crop',
  title: 'Crop image',
  description: 'Trim images to the area you want, with handy aspect ratios.',
  category: 'image',
  icon: '✂️',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Crop',
  engines: ['MozJPEG', 'libwebp', 'OxiPNG'],
  params: {
    box: { kind: 'crop', label: 'Crop area', default: { x: 0, y: 0, w: 1, h: 1 } },
    quality: { kind: 'number', label: 'Output quality', default: 92, min: 10, max: 100, unit: '%', advanced: true },
  },
  async run([file], params) {
    const { decode, encode, encodableFormat, crop } = await import('../../engines/image');
    const pixels = await decode(file.bytes, file.type);
    const box = params.box as Box;
    const x = Math.round(box.x * pixels.width);
    const y = Math.round(box.y * pixels.height);
    const w = Math.max(1, Math.min(pixels.width - x, Math.round(box.w * pixels.width)));
    const h = Math.max(1, Math.min(pixels.height - y, Math.round(box.h * pixels.height)));
    const result = crop(pixels, x, y, w, h);
    const format = encodableFormat(file.type);
    const bytes = await encode(result, format, { quality: params.quality as number, pngLevel: 2 });
    return [{ name: renameFor(file.name, format, '-cropped'), type: format, bytes }];
  },
};
