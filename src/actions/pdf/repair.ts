/**
 * Repair PDF: fix files that won't open or show errors.
 *
 * Engines: qpdf first (rebuilds the cross-reference table and rewrites every
 * object, which fixes most damage losslessly). If qpdf gives up, MuPDF opens
 * the file with its more forgiving parser and saves a clean copy.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

export const repairPdf: ActionDefinition = {
  id: 'pdf.repair',
  title: 'Repair PDF',
  description: 'Fix damaged PDFs that won’t open or show errors.',
  category: 'pdf-optimize',
  icon: '🩹',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Repair',
  engines: ['qpdf', 'mupdf'],
  params: {},
  async run([file], _params, ctx) {
    const name = `${baseName(file.name)}-repaired.pdf`;
    ctx.progress(0.1, 'Rebuilding with qpdf');
    try {
      const { runQpdf } = await import('../../engines/qpdf');
      const [bytes] = await runQpdf({ inputs: [file.bytes], args: ['{in0}', '--object-streams=generate', '{out}'] });
      return [{ name, type: 'application/pdf', bytes }];
    } catch {
      ctx.progress(0.5, 'Trying a deeper repair with MuPDF');
      const { repairWithMupdf } = await import('../../engines/mupdf');
      const bytes = await repairWithMupdf(file.bytes);
      return [{ name, type: 'application/pdf', bytes, note: 'Rebuilt with the deeper repair. Check that every page looks right.' }];
    }
  },
};
