/**
 * Split PDF: break one PDF into several.
 *
 * Engine: qpdf (lossless page extraction).
 * Modes:
 *  - ranges: each comma-separated range becomes one file (`1-3, 4-6`)
 *  - every:  a new file every N pages (N = 1 gives one file per page)
 *  - extract: the selected pages become a single file
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';
import { parseRangeGroups, parseRanges, rangeSyntaxError } from '../../core/ranges';

export const splitPdf: ActionDefinition = {
  id: 'pdf.split',
  title: 'Split PDF',
  description: 'Split a PDF by page ranges, every few pages, or pull out selected pages.',
  category: 'pdf-organize',
  icon: '✂️',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Split PDF',
  engines: ['qpdf', 'mupdf'],
  params: {
    mode: {
      kind: 'enum',
      label: 'How to split',
      default: 'every',
      options: [
        { value: 'every', label: 'Every N pages', hint: 'One file per page, or per group of pages' },
        { value: 'ranges', label: 'By ranges', hint: 'Each range becomes its own file' },
        { value: 'extract', label: 'Extract pages', hint: 'Selected pages into one new file' },
      ],
    },
    every: {
      kind: 'number',
      label: 'Pages per file',
      default: 1,
      min: 1,
      max: 500,
      display: 'input',
      visibleWhen: (v) => v.mode === 'every',
    },
    ranges: {
      kind: 'text',
      label: 'Page ranges',
      help: 'Separate ranges with commas, e.g. 1-3, 4-6, 7-',
      default: '1-3, 4-',
      placeholder: '1-3, 4-6, 7-',
      validate: rangeSyntaxError,
      visibleWhen: (v) => v.mode === 'ranges',
    },
    pages: {
      kind: 'text',
      label: 'Pages to extract',
      help: 'e.g. 1, 3, 5-8',
      default: '1',
      placeholder: '1, 3, 5-8',
      validate: rangeSyntaxError,
      visibleWhen: (v) => v.mode === 'extract',
    },
  },
  async run([file], params, ctx) {
    const [{ runQpdf }, { inspectPdf }] = await Promise.all([
      import('../../engines/qpdf'),
      import('../../engines/mupdf'),
    ]);
    const { pageCount, encrypted } = await inspectPdf(file.bytes);
    if (encrypted) throw new Error('This PDF is password-protected. Unlock it first.');

    let groups: number[][];
    if (params.mode === 'every') {
      const n = params.every as number;
      groups = [];
      for (let start = 1; start <= pageCount; start += n) {
        groups.push(Array.from({ length: Math.min(n, pageCount - start + 1) }, (_, i) => start + i));
      }
    } else if (params.mode === 'ranges') {
      groups = parseRangeGroups(params.ranges as string, pageCount);
    } else {
      groups = [parseRanges(params.pages as string, pageCount)];
    }

    const base = baseName(file.name);
    const pad = String(pageCount).length;
    const outputs = [];
    for (const [i, group] of groups.entries()) {
      ctx.progress(i / groups.length, `Part ${i + 1} of ${groups.length}`);
      const [bytes] = await runQpdf({
        inputs: [file.bytes],
        args: ['--empty', '--pages', '{in0}', group.join(','), '--', '{out}'],
      });
      const label = group.length === 1
        ? `page-${String(group[0]).padStart(pad, '0')}`
        : `pages-${String(group[0]).padStart(pad, '0')}-${String(group[group.length - 1]).padStart(pad, '0')}`;
      outputs.push({ name: `${base}-${label}.pdf`, type: 'application/pdf', bytes });
    }
    return outputs;
  },
};
