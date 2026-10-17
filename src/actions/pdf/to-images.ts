/**
 * PDF to images: render pages as JPG or PNG.
 *
 * Engine: MuPDF (accurate rendering with high-quality anti-aliasing).
 * Defaults: JPG at 150 dpi, quality 90: sharp on screen, reasonable size.
 */
import type { ActionDefinition, OutputFile } from '../../core/types';
import { baseName } from '../../core/files';
import { parseRanges, rangeSyntaxError } from '../../core/ranges';

export const pdfToImages: ActionDefinition = {
  id: 'pdf.to-images',
  title: 'PDF to JPG / PNG',
  description: 'Turn each page into a high-quality image.',
  category: 'pdf-convert',
  icon: '🖼️',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Convert to images',
  produces: (_, p) => (p.format === 'png' ? 'image/png' : 'image/jpeg'),
  engines: ['mupdf'],
  defaultPreset: 'screen',
  presets: [
    { id: 'screen', label: 'Screen', description: 'JPG, 150 dpi: sharp on any display', values: { format: 'jpeg', dpi: 150, quality: 90 } },
    { id: 'print', label: 'Print', description: 'PNG, 300 dpi: lossless, for printing or editing', values: { format: 'png', dpi: 300 } },
    { id: 'small', label: 'Small', description: 'JPG, 96 dpi: quick previews and sharing', values: { format: 'jpeg', dpi: 96, quality: 80 } },
  ],
  params: {
    format: {
      kind: 'enum',
      label: 'Format',
      default: 'jpeg',
      options: [
        { value: 'jpeg', label: 'JPG', hint: 'Smaller files, best for photos and scans' },
        { value: 'png', label: 'PNG', hint: 'Lossless, best for text and diagrams' },
      ],
    },
    dpi: {
      kind: 'number',
      label: 'Resolution',
      help: '150 dpi suits screens, 300 dpi suits printing.',
      default: 150,
      min: 36,
      max: 600,
      step: 1,
      unit: 'dpi',
      advanced: true,
    },
    quality: {
      kind: 'number',
      label: 'JPG quality',
      default: 90,
      min: 10,
      max: 100,
      unit: '%',
      advanced: true,
      visibleWhen: (v) => v.format === 'jpeg',
    },
    transparent: {
      kind: 'boolean',
      label: 'Transparent background',
      default: false,
      advanced: true,
      visibleWhen: (v) => v.format === 'png',
    },
    pages: {
      kind: 'text',
      label: 'Pages',
      help: 'Leave as "all", or list pages like 1, 3-5',
      default: 'all',
      validate: rangeSyntaxError,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const { inspectPdf, renderPages } = await import('../../engines/mupdf');
    const { pageCount, encrypted } = await inspectPdf(file.bytes);
    if (encrypted) throw new Error('This PDF is password-protected. Unlock it first.');
    const pages = parseRanges(params.pages as string, pageCount);
    const format = params.format as 'jpeg' | 'png';
    const ext = format === 'png' ? 'png' : 'jpg';
    const pad = String(pageCount).length;
    const outputs: OutputFile[] = [];
    await renderPages(
      file.bytes,
      pages,
      { dpi: params.dpi as number, format, quality: params.quality as number, transparent: params.transparent as boolean },
      (i, image) => {
        ctx.progress((i + 1) / pages.length, `Page ${i + 1} of ${pages.length}`);
        outputs.push({
          name: `${baseName(file.name)}-page-${String(pages[i]).padStart(pad, '0')}.${ext}`,
          type: format === 'png' ? 'image/png' : 'image/jpeg',
          bytes: image,
        });
      },
    );
    return outputs;
  },
};
