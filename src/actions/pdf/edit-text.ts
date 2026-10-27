/**
 * Edit PDF text: click a line on the page to change, move, restyle or delete
 * it, or add new text anywhere.
 *
 * Engine: MuPDF (see engines/text-edit.ts). Changed lines are erased from the
 * page and written again as real text, so they stay selectable and
 * searchable. Lines nobody touched are left exactly as they were.
 */
import type { ActionDefinition, TextItem } from '../../core/types';
import { baseName } from '../../core/files';

export const editTextPdf: ActionDefinition = {
  id: 'pdf.edit-text',
  title: 'Edit PDF text',
  description: 'Change, move or delete the text on a page, or add new text.',
  category: 'pdf-edit',
  icon: '✍️',
  accepts: ['application/pdf'],
  mode: 'each',
  maxFiles: 1,
  verb: 'Save changes',
  engines: ['mupdf'],
  params: {
    edits: { kind: 'textEdits', label: 'Text changes', default: [] },
  },
  async run([file], params, ctx) {
    const edits = params.edits as TextItem[];
    if (edits.length === 0) throw new Error('Click any text to change it, or add new text.');
    const { editText } = await import('../../engines/text-edit');
    ctx.progress(0.3, 'Rewriting text');
    const bytes = await editText(file.bytes, edits);
    return [{ name: `${baseName(file.name)}-edited.pdf`, type: 'application/pdf', bytes }];
  },
};
