/**
 * Organize PDF: reorder, rotate and delete pages visually.
 *
 * Engine: qpdf. The page-order editor produces a list of `{ page, rotate }`;
 * qpdf assembles the new document losslessly and applies rotations as
 * page attributes (content is not re-rendered).
 */
import type { ActionDefinition, PageRef } from '../../core/types';
import { baseName } from '../../core/files';

export const organizePdf: ActionDefinition = {
  id: 'pdf.organize',
  title: 'Organize PDF',
  description: 'Drag pages into a new order, rotate or delete them.',
  category: 'pdf-organize',
  icon: '🗂️',
  accepts: ['application/pdf'],
  mode: 'each',
  maxFiles: 1,
  verb: 'Save changes',
  engines: ['qpdf', 'mupdf'],
  params: {
    order: {
      kind: 'pageOrder',
      label: 'Pages',
      help: 'Drag to reorder. Use the buttons on each page to rotate or remove it.',
      default: [],
    },
  },
  async run([file], params, ctx) {
    const { runQpdf } = await import('../../engines/qpdf');
    const order = params.order as PageRef[];
    if (order.length === 0) throw new Error('Keep at least one page.');
    ctx.progress(0.2, 'Rebuilding document');

    const args = ['--empty', '--pages', '{in0}', order.map((p) => p.page).join(','), '--'];
    // After --pages, output page i corresponds to order[i]; rotate per output page.
    order.forEach((p, i) => {
      if (p.rotate % 360 !== 0) args.push(`--rotate=+${p.rotate % 360}:${i + 1}`);
    });
    args.push('{out}');

    const [bytes] = await runQpdf({ inputs: [file.bytes], args });
    return [{ name: `${baseName(file.name)}-organized.pdf`, type: 'application/pdf', bytes }];
  },
};
