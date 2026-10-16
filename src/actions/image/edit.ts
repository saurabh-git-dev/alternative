/**
 * Photo editor: brightness, contrast, colour and one-click filters, with a
 * live preview.
 *
 * Engine: a single-pass pixel pipeline (src/engines/image.ts `adjust`), then
 * re-encoded with the Squoosh codecs at q92.
 */
import type { ActionDefinition, ParamValues } from '../../core/types';
import { renameFor } from '../../core/files';
import type { Adjustments } from '../../engines/image';

const slider = (label: string, help?: string) =>
  ({ kind: 'number', label, help, default: 0, min: -100, max: 100 }) as const;

const NEUTRAL = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, shadows: 0, highlights: 0, vignette: 0 };

export const editImage: ActionDefinition = {
  id: 'image.edit',
  title: 'Photo editor',
  description: 'Adjust brightness, contrast and colour, or apply a filter.',
  category: 'image',
  icon: '🎨',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Apply',
  engines: ['Pixel pipeline', 'MozJPEG', 'libwebp', 'OxiPNG'],
  livePreview: true,
  defaultPreset: 'none',
  presets: [
    { id: 'none', label: 'Original', description: 'No changes; start from here', values: { ...NEUTRAL, filter: 'none' } },
    { id: 'auto', label: 'Enhance', description: 'A gentle boost for everyday photos', values: { ...NEUTRAL, contrast: 12, saturation: 15, shadows: 20, highlights: -10, filter: 'none' } },
    { id: 'bw', label: 'Black & white', description: 'Classic monochrome with extra contrast', values: { ...NEUTRAL, contrast: 20, filter: 'grayscale' } },
    { id: 'warm', label: 'Warm', description: 'Golden-hour tones', values: { ...NEUTRAL, warmth: 35, saturation: 10, filter: 'none' } },
    { id: 'vintage', label: 'Vintage', description: 'Faded colours and a soft vignette', values: { ...NEUTRAL, warmth: 20, contrast: -10, vignette: 35, filter: 'fade' } },
  ],
  params: {
    filter: {
      kind: 'enum',
      label: 'Filter',
      default: 'none',
      display: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'vivid', label: 'Vivid' },
        { value: 'grayscale', label: 'Black & white' },
        { value: 'sepia', label: 'Sepia' },
        { value: 'fade', label: 'Fade' },
      ],
    },
    brightness: slider('Brightness'),
    contrast: slider('Contrast'),
    saturation: slider('Saturation', '−100 removes all colour.'),
    warmth: slider('Warmth', 'Left is cooler (blue), right is warmer (orange).'),
    shadows: { ...slider('Shadows', 'Brighten or deepen the dark areas.'), advanced: true },
    highlights: { ...slider('Highlights', 'Recover or brighten the light areas.'), advanced: true },
    vignette: { kind: 'number', label: 'Vignette', default: 0, min: 0, max: 100, advanced: true },
    quality: { kind: 'number', label: 'Output quality', default: 92, min: 10, max: 100, unit: '%', advanced: true },
  },
  async run([file], params: ParamValues) {
    const { decode, encode, encodableFormat, adjust } = await import('../../engines/image');
    const pixels = await decode(file.bytes, file.type);
    const result = adjust(pixels, params as unknown as Adjustments);
    const format = encodableFormat(file.type);
    const bytes = await encode(result, format, { quality: params.quality as number, pngLevel: 2 });
    return [{ name: renameFor(file.name, format, '-edited'), type: format, bytes }];
  },
};
