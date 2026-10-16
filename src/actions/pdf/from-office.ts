/**
 * Office to PDF: Word, Excel, PowerPoint and OpenDocument files to PDF.
 *
 * Engine: LibreOffice (WASM) via engines/libreoffice.ts, the same converter
 * LibreOffice's own "Export as PDF" uses. Fonts: LibreOffice's bundled set
 * (Liberation, Carlito, Caladea… metric-compatible with Arial, Calibri,
 * Cambria…), so layouts keep their line breaks even without Microsoft fonts.
 * The converter is a one-time ~78 MB download, cached afterwards.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName, extensionOf } from '../../core/files';
import { OFFICE_TYPES } from '../../engines/libreoffice';

export const officeToPdf: ActionDefinition = {
  id: 'pdf.from-office',
  title: 'Office to PDF',
  description: 'Convert Word, Excel and PowerPoint files (and OpenDocument) to PDF.',
  category: 'pdf-convert',
  icon: '📝',
  accepts: Object.keys(OFFICE_TYPES),
  mode: 'each',
  verb: 'Convert to PDF',
  produces: () => 'application/pdf',
  engines: ['LibreOffice'],
  mainThread: true,
  params: {
    password: {
      kind: 'text',
      label: 'Document password',
      help: 'Only for password-protected documents.',
      default: '',
      secret: true,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const { convertDocument } = await import('../../engines/libreoffice');
    // Trust the extension when present: browsers report CSV as an Excel type on Windows.
    const ext = Object.values(OFFICE_TYPES).includes(extensionOf(file.name)) ? extensionOf(file.name) : OFFICE_TYPES[file.type];
    const bytes = await convertDocument(file.bytes, ext, 'pdf', {
      password: params.password as string,
      onProgress: (f, m) => ctx.progress(f, m),
    });
    return [{ name: `${baseName(file.name)}.pdf`, type: 'application/pdf', bytes }];
  },
};
