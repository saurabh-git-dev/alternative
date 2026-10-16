/**
 * Watermark image: text over photos, once or tiled.
 *
 * Engine: canvas text rendering (the browser's own font engine, so text is
 * properly anti-aliased), then re-encoded with the Squoosh codecs at q90.
 * Text size is a percentage of the image width so the same settings look
 * right on images of any resolution.
 */
import type { ActionDefinition } from '../../core/types';
import { renameFor } from '../../core/files';

export const watermarkImage: ActionDefinition = {
  id: 'image.watermark',
  title: 'Watermark image',
  description: 'Add your name, a © notice or any text over your images.',
  category: 'image',
  icon: '©️',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Add watermark',
  engines: ['Canvas', 'MozJPEG', 'libwebp', 'OxiPNG'],
  livePreview: true,
  params: {
    text: {
      kind: 'text',
      label: 'Watermark text',
      default: '© Your name',
      validate: (v) => (v.trim() ? null : 'Enter the text to add.'),
    },
    layout: {
      kind: 'enum',
      label: 'Layout',
      default: 'single',
      options: [
        { value: 'single', label: 'Once' },
        { value: 'tile', label: 'Tiled', hint: 'Repeated diagonally over the whole image; hard to remove' },
      ],
    },
    position: { kind: 'position', label: 'Position', default: 'bottom-right', visibleWhen: (v) => v.layout === 'single' },
    size: { kind: 'number', label: 'Text size', help: 'Relative to the image width.', default: 5, min: 1, max: 30, unit: '%' },
    opacity: { kind: 'number', label: 'Opacity', default: 60, min: 5, max: 100, unit: '%' },
    color: { kind: 'color', label: 'Colour', default: '#ffffff', advanced: true },
    shadow: {
      kind: 'boolean',
      label: 'Soft shadow',
      help: 'Keeps text readable on both light and dark areas.',
      default: true,
      advanced: true,
    },
    font: {
      kind: 'enum',
      label: 'Font',
      default: 'sans-serif',
      advanced: true,
      options: [
        { value: 'sans-serif', label: 'Sans' },
        { value: 'serif', label: 'Serif' },
        { value: 'monospace', label: 'Mono' },
      ],
    },
    quality: { kind: 'number', label: 'Output quality', default: 90, min: 10, max: 100, unit: '%', advanced: true },
  },
  async run([file], params) {
    const { decode, encode, encodableFormat, toCanvas } = await import('../../engines/image');
    const pixels = await decode(file.bytes, file.type);
    const { ctx } = toCanvas(pixels);
    const { width: w, height: h } = pixels;
    const text = (params.text as string).trim();
    const size = Math.max(8, Math.round((w * (params.size as number)) / 100));

    ctx.font = `600 ${size}px ${params.font as string}`;
    ctx.fillStyle = params.color as string;
    ctx.globalAlpha = (params.opacity as number) / 100;
    if (params.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = size * 0.15;
      ctx.shadowOffsetY = size * 0.04;
    }
    const metrics = ctx.measureText(text);
    const tw = metrics.width;

    if (params.layout === 'tile') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const stepX = tw + size * 2;
      const stepY = size * 3.5;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 6);
      const reach = Math.hypot(w, h);
      for (let y = -reach; y < reach; y += stepY) {
        const offset = (Math.round(y / stepY) % 2) * (stepX / 2);
        for (let x = -reach; x < reach; x += stepX) ctx.fillText(text, x + offset, y);
      }
    } else {
      const [row, col] = (params.position as string).split('-');
      const pad = size * 0.8;
      ctx.textAlign = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center';
      ctx.textBaseline = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle';
      const x = col === 'left' ? pad : col === 'right' ? w - pad : w / 2;
      const y = row === 'top' ? pad : row === 'bottom' ? h - pad : h / 2;
      ctx.fillText(text, x, y);
    }

    const result = ctx.getImageData(0, 0, w, h);
    const format = encodableFormat(file.type);
    const bytes = await encode(result, format, { quality: params.quality as number, pngLevel: 2 });
    return [{ name: renameFor(file.name, format, '-watermarked'), type: format, bytes }];
  },
};
