/**
 * Fast web view (linearize): reorder a PDF so the first page shows before the
 * whole file has downloaded. Useful for PDFs hosted on websites.
 *
 * Engine: qpdf `--linearize` (lossless).
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

export const webViewPdf: ActionDefinition = {
  id: 'pdf.web-view',
  title: 'Fast web view',
  description: 'Optimise a PDF so it starts showing instantly when opened online.',
  category: 'pdf-optimize',
  icon: '⚡',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Optimise',
  engines: ['qpdf'],
  params: {},
  async run([file]) {
    const { runQpdf } = await import('../../engines/qpdf');
    const [bytes] = await runQpdf({ inputs: [file.bytes], args: ['{in0}', '--linearize', '{out}'] });
    return [{ name: `${baseName(file.name)}-web.pdf`, type: 'application/pdf', bytes }];
  },
};
