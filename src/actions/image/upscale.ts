/**
 * Upscale image: enlarge 2×, 3× or 4× with AI, adding real detail instead of
 * the blur ordinary resizing gives.
 *
 * Engine: Real-ESRGAN general model via ONNX Runtime Web (see
 * engines/ai-image.ts). The model is 5 MB and cached after first use.
 */
import type { ActionDefinition } from '../../core/types';
import { renameFor } from '../../core/files';

export const upscaleImage: ActionDefinition = {
  id: 'image.upscale',
  title: 'Upscale image',
  description: 'Enlarge photos 2× to 4× with AI, sharpening detail instead of blurring it.',
  category: 'image',
  icon: '🔍',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Upscale',
  engines: ['Real-ESRGAN', 'ONNX Runtime'],
  params: {
    scale: {
      kind: 'enum',
      label: 'Enlarge',
      default: '2',
      options: [
        { value: '2', label: '2×' },
        { value: '3', label: '3×' },
        { value: '4', label: '4×' },
      ],
    },
    quality: {
      kind: 'number',
      label: 'Output quality',
      help: 'For JPG, WebP and AVIF. PNG stays lossless.',
      default: 92,
      min: 50,
      max: 100,
      unit: '%',
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const { decode, encode, encodableFormat } = await import('../../engines/image');
    const { upscale } = await import('../../engines/ai-image');
    const scale = Number(params.scale);
    const pixels = await decode(file.bytes, file.type);
    const result = await upscale(pixels, scale, (f, m) => ctx.progress(f * 0.9, m));
    ctx.progress(0.92, 'Encoding');
    const format = encodableFormat(file.type);
    const bytes = await encode(result, format, { quality: params.quality as number, pngLevel: 2 });
    return [{ name: renameFor(file.name, format, `-${scale}x`), type: format, bytes }];
  },
};
