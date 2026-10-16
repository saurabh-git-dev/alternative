/**
 * Add page numbers: stamp "1", "Page 1 of 9" or similar on each page.
 *
 * Engine: pdf-lib. Numbers are vector text placed relative to each page's own
 * size, so mixed page sizes and landscape pages are handled correctly.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';
import { parseRanges, rangeSyntaxError } from '../../core/ranges';

export const pageNumbersPdf: ActionDefinition = {
  id: 'pdf.page-numbers',
  title: 'Add page numbers',
  description: 'Number your pages, with the position and style you like.',
  category: 'pdf-edit',
  icon: '🔢',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Add page numbers',
  engines: ['pdf-lib'],
  params: {
    position: { kind: 'position', label: 'Position', default: 'bottom-center' },
    format: {
      kind: 'enum',
      label: 'Format',
      default: '{n}',
      options: [
        { value: '{n}', label: '1' },
        { value: '{n} / {total}', label: '1 / 9' },
        { value: 'Page {n}', label: 'Page 1' },
        { value: 'Page {n} of {total}', label: 'Page 1 of 9' },
      ],
    },
    custom: {
      kind: 'text',
      label: 'Custom format',
      help: 'Overrides the format above. Use {n} for the number and {total} for the page count.',
      default: '',
      placeholder: '— {n} —',
      advanced: true,
    },
    start: { kind: 'number', label: 'First number', default: 1, min: 0, max: 99999, display: 'input', advanced: true },
    skipFirst: {
      kind: 'boolean',
      label: 'Skip the first page',
      help: 'Useful for cover pages. Numbering still counts it.',
      default: false,
    },
    size: { kind: 'number', label: 'Text size', default: 11, min: 6, max: 48, unit: 'pt', advanced: true },
    margin: { kind: 'number', label: 'Distance from edge', default: 28, min: 6, max: 144, unit: 'pt', advanced: true },
    color: { kind: 'color', label: 'Colour', default: '#333333', advanced: true },
    pages: {
      kind: 'text',
      label: 'Pages',
      default: 'all',
      help: 'Leave as "all", or list pages like 2-10',
      validate: rangeSyntaxError,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const [{ StandardFonts, rgb }, { hexToRgb, loadPdf }] = await Promise.all([
      import('pdf-lib'),
      import('../../engines/pdflib'),
    ]);
    const doc = await loadPdf(file.bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    const selected = parseRanges(params.pages as string, total).filter((n) => !(params.skipFirst && n === 1));
    const template = (params.custom as string).trim() || (params.format as string);
    const size = params.size as number;
    const margin = params.margin as number;
    const color = rgb(...hexToRgb(params.color as string));
    const [row, col] = (params.position as string).split('-');
    const start = params.start as number;

    for (const [i, n] of selected.entries()) {
      ctx.progress(i / selected.length);
      const page = pages[n - 1];
      const text = template.replaceAll('{n}', String(start + n - 1)).replaceAll('{total}', String(start + total - 1));
      const width = font.widthOfTextAtSize(text, size);
      const { width: pw, height: ph } = page.getSize();
      const x = col === 'left' ? margin : col === 'right' ? pw - margin - width : (pw - width) / 2;
      const y = row === 'top' ? ph - margin - size : row === 'bottom' ? margin : (ph - size) / 2;
      page.drawText(text, { x, y, size, font, color });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${baseName(file.name)}-numbered.pdf`, type: 'application/pdf', bytes }];
  },
};
