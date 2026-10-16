/**
 * Annotate PDF: draw, highlight, add text boxes, shapes, arrows, white-out
 * and comments.
 *
 * Engine: MuPDF. Marks are saved as standard PDF annotations, so they can
 * still be moved or deleted in Acrobat, Preview or any other viewer, unless
 * "Flatten" bakes them into the page. The page content itself is untouched.
 */
import type { ActionDefinition, Annotation } from '../../core/types';
import { baseName } from '../../core/files';

export const annotatePdf: ActionDefinition = {
  id: 'pdf.annotate',
  title: 'Annotate PDF',
  description: 'Write, highlight, draw, add shapes, white-out or comments.',
  category: 'pdf-edit',
  icon: '🖊️',
  accepts: ['application/pdf'],
  mode: 'each',
  maxFiles: 1,
  verb: 'Save annotations',
  engines: ['mupdf'],
  params: {
    annotations: { kind: 'annotations', label: 'Annotations', default: [] },
    flatten: {
      kind: 'boolean',
      label: 'Flatten (make annotations part of the page)',
      help: "Off: others can still move or delete them in their PDF viewer. On: they can't be changed, and every viewer shows them the same.",
      default: false,
      advanced: true,
    },
    author: {
      kind: 'text',
      label: 'Author name on comments',
      default: '',
      placeholder: 'Optional',
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const annotations = params.annotations as Annotation[];
    if (annotations.length === 0) throw new Error('Add at least one annotation first.');
    const { annotate } = await import('../../engines/mupdf');
    ctx.progress(0.3, 'Adding annotations');
    const bytes = await annotate(file.bytes, annotations, { flatten: params.flatten as boolean, author: (params.author as string).trim() });
    return [{ name: `${baseName(file.name)}-annotated.pdf`, type: 'application/pdf', bytes }];
  },
};
