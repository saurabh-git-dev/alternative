/**
 * Merge PDF: combine several PDFs into one, in the order shown.
 *
 * Engine: qpdf. Pages are copied structurally (no re-rendering), so text stays
 * selectable, links keep working and form fields are preserved.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

export const mergePdf: ActionDefinition = {
  id: 'pdf.merge',
  title: 'Merge PDF',
  description: 'Combine PDFs into one file, in the order you choose.',
  category: 'pdf-organize',
  icon: '🧩',
  accepts: ['application/pdf'],
  mode: 'all',
  minFiles: 2,
  verb: 'Merge PDFs',
  engines: ['qpdf'],
  params: {
    fileName: {
      kind: 'text',
      label: 'File name',
      help: 'Name of the merged file. Leave empty to use the first file’s name.',
      default: '',
      placeholder: 'merged',
      advanced: true,
    },
  },
  async run(files, params, ctx) {
    const { runQpdf } = await import('../../engines/qpdf');
    ctx.progress(0.1, 'Merging');
    // qpdf --empty --pages a.pdf 1-z b.pdf 1-z … -- out.pdf
    // (explicit ranges: qpdf 12 would otherwise try to read the next file name as a range)
    const [bytes] = await runQpdf({
      inputs: files.map((f) => f.bytes),
      args: ['--empty', '--pages', ...files.flatMap((_, i) => [`{in${i}}`, '1-z']), '--', '{out}'],
    });
    const name = (params.fileName as string).trim() || `${baseName(files[0].name)}-merged`;
    return [{ name: `${name.replace(/\.pdf$/i, '')}.pdf`, type: 'application/pdf', bytes }];
  },
};
