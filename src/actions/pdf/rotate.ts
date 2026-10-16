/**
 * Rotate PDF: turn all or selected pages.
 *
 * Engine: qpdf. Rotation is stored as a page attribute, so it is instant and
 * perfectly lossless.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';
import { rangeSyntaxError } from '../../core/ranges';

export const rotatePdf: ActionDefinition = {
  id: 'pdf.rotate',
  title: 'Rotate PDF',
  description: 'Rotate every page or just the ones you pick.',
  category: 'pdf-organize',
  icon: '🔄',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Rotate',
  engines: ['qpdf'],
  params: {
    angle: {
      kind: 'enum',
      label: 'Rotation',
      default: '90',
      options: [
        { value: '90', label: '↻ 90° right' },
        { value: '180', label: '180°' },
        { value: '270', label: '↺ 90° left' },
      ],
    },
    pages: {
      kind: 'text',
      label: 'Pages',
      help: 'Leave as "all", or list pages like 1, 3-5',
      default: 'all',
      validate: rangeSyntaxError,
      advanced: true,
    },
  },
  async run([file], params) {
    const { runQpdf } = await import('../../engines/qpdf');
    const pages = (params.pages as string).replace(/\s+/g, '').toLowerCase();
    // qpdf range syntax matches ours, except "last" is spelled "z".
    const qpdfRange = pages === '' || pages === 'all' ? '1-z' : pages.replace(/last/g, 'z').replace(/(^|,)-/g, '$11-').replace(/-(?=,|$)/g, '-z');
    const [bytes] = await runQpdf({
      inputs: [file.bytes],
      args: ['{in0}', `--rotate=+${params.angle}:${qpdfRange}`, '{out}'],
    });
    return [{ name: `${baseName(file.name)}-rotated.pdf`, type: 'application/pdf', bytes }];
  },
};
