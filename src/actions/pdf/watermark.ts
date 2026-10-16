/**
 * Watermark PDF: stamp text across pages.
 *
 * Engine: pdf-lib. The watermark is drawn as real vector text on top of each
 * page (crisp at any zoom), with adjustable opacity, angle and placement.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';
import { parseRanges, rangeSyntaxError } from '../../core/ranges';

export const watermarkPdf: ActionDefinition = {
  id: 'pdf.watermark',
  title: 'Watermark PDF',
  description: 'Stamp text like "CONFIDENTIAL" or "DRAFT" over your pages.',
  category: 'pdf-edit',
  icon: '💧',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Add watermark',
  engines: ['pdf-lib'],
  params: {
    text: {
      kind: 'text',
      label: 'Watermark text',
      default: 'CONFIDENTIAL',
      validate: (v) => (v.trim() ? null : 'Enter the text to stamp.'),
    },
    layout: {
      kind: 'enum',
      label: 'Layout',
      default: 'single',
      options: [
        { value: 'single', label: 'Once per page' },
        { value: 'tile', label: 'Tiled', hint: 'Repeated across the whole page' },
      ],
    },
    position: {
      kind: 'position',
      label: 'Position',
      default: 'middle-center',
      visibleWhen: (v) => v.layout === 'single',
    },
    opacity: { kind: 'number', label: 'Opacity', default: 25, min: 5, max: 100, unit: '%' },
    size: { kind: 'number', label: 'Text size', default: 60, min: 8, max: 200, unit: 'pt', advanced: true },
    angle: { kind: 'number', label: 'Angle', default: 45, min: -90, max: 90, unit: '°', advanced: true },
    color: { kind: 'color', label: 'Colour', default: '#d32f2f', advanced: true },
    bold: { kind: 'boolean', label: 'Bold', default: true, advanced: true },
    pages: {
      kind: 'text',
      label: 'Pages',
      default: 'all',
      help: 'Leave as "all", or list pages like 1, 3-5',
      validate: rangeSyntaxError,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const [{ PDFDocument, StandardFonts, rgb, degrees }, { hexToRgb }] = await Promise.all([
      import('pdf-lib'),
      import('../../engines/pdflib'),
    ]);
    let doc;
    try {
      doc = await PDFDocument.load(file.bytes);
    } catch (e) {
      if (/encrypted/i.test(String(e))) throw new Error('This PDF is password-protected. Unlock it first.');
      throw e;
    }
    const font = await doc.embedFont(params.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    const text = (params.text as string).trim();
    const size = params.size as number;
    const angle = params.angle as number;
    const color = rgb(...hexToRgb(params.color as string));
    const opacity = (params.opacity as number) / 100;
    const textWidth = font.widthOfTextAtSize(text, size);
    const textHeight = font.heightAtSize(size);
    const rad = (angle * Math.PI) / 180;

    const allPages = doc.getPages();
    const selected = parseRanges(params.pages as string, allPages.length);

    for (const [i, n] of selected.entries()) {
      ctx.progress(i / selected.length);
      const page = allPages[n - 1];
      const { width, height } = page.getSize();
      // Bounding box of the rotated text, used to keep it inside the page.
      const bw = Math.abs(textWidth * Math.cos(rad)) + Math.abs(textHeight * Math.sin(rad));
      const bh = Math.abs(textWidth * Math.sin(rad)) + Math.abs(textHeight * Math.cos(rad));

      const centers: [number, number][] = [];
      if (params.layout === 'tile') {
        const stepX = bw + size * 1.5;
        const stepY = bh + size * 1.5;
        for (let y = stepY / 2; y < height + stepY; y += stepY) {
          for (let x = stepX / 2; x < width + stepX; x += stepX) centers.push([x, y]);
        }
      } else {
        const [row, col] = (params.position as string).split('-');
        const pad = 24;
        const cx = col === 'left' ? pad + bw / 2 : col === 'right' ? width - pad - bw / 2 : width / 2;
        const cy = row === 'top' ? height - pad - bh / 2 : row === 'bottom' ? pad + bh / 2 : height / 2;
        centers.push([cx, cy]);
      }

      for (const [cx, cy] of centers) {
        // drawText rotates around the text origin (bottom-left); offset so the centre lands on (cx, cy).
        const ox = (textWidth / 2) * Math.cos(rad) - (textHeight / 3) * Math.sin(rad);
        const oy = (textWidth / 2) * Math.sin(rad) + (textHeight / 3) * Math.cos(rad);
        page.drawText(text, { x: cx - ox, y: cy - oy, size, font, color, opacity, rotate: degrees(angle) });
      }
    }

    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${baseName(file.name)}-watermarked.pdf`, type: 'application/pdf', bytes }];
  },
};
