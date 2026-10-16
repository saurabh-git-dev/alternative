/**
 * Redact PDF: permanently remove sensitive text and images.
 *
 * Engine: MuPDF's redaction. Unlike drawing a black box (which leaves the
 * text underneath copyable), this deletes the covered text, removes covered
 * image pixels and line art, and then draws the box. Areas can be drawn by
 * hand, found by searching for text, or both.
 */
import type { ActionDefinition, PageBox } from '../../core/types';
import { baseName } from '../../core/files';

export const redactPdf: ActionDefinition = {
  id: 'pdf.redact',
  title: 'Redact PDF',
  description: 'Permanently black out names, numbers or any area, for real.',
  category: 'pdf-security',
  icon: '⬛',
  accepts: ['application/pdf'],
  mode: 'each',
  maxFiles: 1,
  verb: 'Redact permanently',
  engines: ['mupdf'],
  params: {
    regions: { kind: 'regions', label: 'Areas to redact', default: [] },
    search: {
      kind: 'text',
      label: 'Also redact this text everywhere',
      help: 'Separate several words or phrases with commas, e.g. John Smith, 555-0134',
      default: '',
      placeholder: 'Name, account number…',
    },
    style: {
      kind: 'enum',
      label: 'Fill',
      default: 'black',
      options: [
        { value: 'black', label: 'Black boxes' },
        { value: 'blank', label: 'Blank (white)' },
      ],
      advanced: true,
    },
    removeMetadata: {
      kind: 'boolean',
      label: 'Also remove hidden metadata',
      help: 'Author, title and editing history can reveal information too.',
      default: true,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const { redact } = await import('../../engines/mupdf');
    const terms = (params.search as string).split(',').map((t) => t.trim()).filter(Boolean);
    const regions = params.regions as PageBox[];
    if (regions.length === 0 && terms.length === 0) throw new Error('Draw at least one box or enter text to find.');
    ctx.progress(0.2, 'Redacting');
    const { bytes, count } = await redact(file.bytes, {
      regions,
      terms,
      blackBoxes: params.style === 'black',
      removeMetadata: params.removeMetadata as boolean,
    });
    if (count === 0) throw new Error('Nothing was redacted: the text wasn’t found and no boxes were drawn.');
    return [{ name: `${baseName(file.name)}-redacted.pdf`, type: 'application/pdf', bytes, note: `${count} area${count === 1 ? '' : 's'} removed.` }];
  },
};
