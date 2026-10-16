/**
 * Resize image: by percentage, by longest side, or to exact dimensions.
 *
 * Engine: jSquash resize (Lanczos3 in linear light, as Squoosh does), which
 * keeps edges sharp without halos. The output keeps the input format and is
 * encoded at high quality (90) since the goal is size in pixels, not bytes.
 */
import type { ActionDefinition } from '../../core/types';
import { renameFor } from '../../core/files';

export const resizeImage: ActionDefinition = {
  id: 'image.resize',
  title: 'Resize image',
  description: 'Change image dimensions by percentage or exact pixels.',
  category: 'image',
  icon: '📐',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Resize',
  engines: ['jSquash resize', 'MozJPEG', 'libwebp', 'OxiPNG'],
  params: {
    mode: {
      kind: 'enum',
      label: 'Resize by',
      default: 'percent',
      options: [
        { value: 'percent', label: 'Percentage' },
        { value: 'longest', label: 'Longest side' },
        { value: 'exact', label: 'Exact size' },
      ],
    },
    percent: {
      kind: 'number',
      label: 'Scale',
      default: 50,
      min: 1,
      max: 400,
      unit: '%',
      visibleWhen: (v) => v.mode === 'percent',
    },
    longest: {
      kind: 'number',
      label: 'Longest side',
      help: 'Width or height, whichever is larger. 1920 suits most screens.',
      default: 1920,
      min: 16,
      max: 16384,
      unit: 'px',
      display: 'input',
      visibleWhen: (v) => v.mode === 'longest',
    },
    width: {
      kind: 'number', label: 'Width', default: 1280, min: 1, max: 16384, unit: 'px', display: 'input',
      visibleWhen: (v) => v.mode === 'exact',
    },
    height: {
      kind: 'number', label: 'Height', default: 720, min: 1, max: 16384, unit: 'px', display: 'input',
      visibleWhen: (v) => v.mode === 'exact',
    },
    keepRatio: {
      kind: 'boolean',
      label: 'Keep proportions',
      help: 'Fit inside width × height without stretching.',
      default: true,
      visibleWhen: (v) => v.mode === 'exact',
    },
    noUpscale: {
      kind: 'boolean',
      label: 'Never enlarge',
      help: 'Leave images that are already smaller untouched. Enlarging adds blur.',
      default: true,
      advanced: true,
    },
    method: {
      kind: 'enum',
      label: 'Resampling',
      default: 'lanczos3',
      display: 'select',
      advanced: true,
      options: [
        { value: 'lanczos3', label: 'Lanczos3 (sharpest, default)' },
        { value: 'magicKernelSharp2021', label: 'Magic Kernel Sharp (crisp downscaling)' },
        { value: 'mitchell', label: 'Mitchell (smooth)' },
        { value: 'catrom', label: 'Catmull-Rom' },
        { value: 'triangle', label: 'Bilinear (fastest)' },
      ],
    },
    quality: {
      kind: 'number', label: 'Output quality', default: 90, min: 10, max: 100, unit: '%', advanced: true,
    },
  },
  async run([file], params, ctx) {
    const { decode, encode, resize, encodableFormat } = await import('../../engines/image');
    const pixels = await decode(file.bytes, file.type);
    const { width: w, height: h } = pixels;

    let tw: number, th: number;
    if (params.mode === 'percent') {
      const s = (params.percent as number) / 100;
      [tw, th] = [w * s, h * s];
    } else if (params.mode === 'longest') {
      const s = (params.longest as number) / Math.max(w, h);
      [tw, th] = [w * s, h * s];
    } else if (params.keepRatio) {
      const s = Math.min((params.width as number) / w, (params.height as number) / h);
      [tw, th] = [w * s, h * s];
    } else {
      [tw, th] = [params.width as number, params.height as number];
    }
    if (params.noUpscale && (tw > w || th > h)) {
      const s = Math.min(w / tw, h / th, 1);
      [tw, th] = [tw * s, th * s];
    }
    tw = Math.max(1, Math.round(tw));
    th = Math.max(1, Math.round(th));

    ctx.progress(0.3, `Resizing to ${tw} × ${th}`);
    const resized = await resize(pixels, tw, th, params.method as 'lanczos3');
    ctx.progress(0.7, 'Encoding');
    const format = encodableFormat(file.type);
    const bytes = await encode(resized, format, { quality: params.quality as number });
    return [{ name: renameFor(file.name, format, `-${tw}x${th}`), type: format, bytes }];
  },
};
