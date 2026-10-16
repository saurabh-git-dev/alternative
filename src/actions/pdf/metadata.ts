/**
 * Edit metadata: title, author, subject and keywords, or remove all of it.
 *
 * Engines: pdf-lib for editing the Info dictionary; qpdf to strip XMP
 * metadata as well when "remove everything" is chosen.
 * The current values are shown in the form (see `inspect`), so users edit
 * rather than retype.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

const FIELDS = ['title', 'author', 'subject', 'keywords'] as const;

export const metadataPdf: ActionDefinition = {
  id: 'pdf.metadata',
  title: 'Edit PDF metadata',
  description: 'Change the title, author and keywords, or remove hidden info.',
  category: 'pdf-edit',
  icon: '🏷️',
  accepts: ['application/pdf'],
  mode: 'each',
  maxFiles: 1,
  verb: 'Save metadata',
  engines: ['pdf-lib', 'qpdf'],
  params: {
    removeAll: {
      kind: 'boolean',
      label: 'Remove all metadata',
      help: 'Clears title, author, dates, software names and XMP data.',
      default: false,
    },
    title: { kind: 'text', label: 'Title', default: '', visibleWhen: (v) => !v.removeAll },
    author: { kind: 'text', label: 'Author', default: '', visibleWhen: (v) => !v.removeAll },
    subject: { kind: 'text', label: 'Subject', default: '', visibleWhen: (v) => !v.removeAll },
    keywords: {
      kind: 'text',
      label: 'Keywords',
      help: 'Separate with commas.',
      default: '',
      visibleWhen: (v) => !v.removeAll,
    },
  },
  /** Prefill the form with the document's current metadata. */
  async inspect(file) {
    const { loadPdf } = await import('../../engines/pdflib');
    const doc = await loadPdf(file.bytes);
    return {
      title: doc.getTitle() ?? '',
      author: doc.getAuthor() ?? '',
      subject: doc.getSubject() ?? '',
      keywords: doc.getKeywords() ?? '',
    };
  },
  async run([file], params) {
    const name = `${baseName(file.name)}-metadata.pdf`;
    if (params.removeAll) {
      const { runQpdf } = await import('../../engines/qpdf');
      const [bytes] = await runQpdf({ inputs: [file.bytes], args: ['{in0}', '--remove-metadata', '--remove-info', '{out}'] });
      return [{ name, type: 'application/pdf', bytes }];
    }
    const { loadPdf } = await import('../../engines/pdflib');
    const doc = await loadPdf(file.bytes);
    for (const field of FIELDS) {
      const value = (params[field] as string).trim();
      if (field === 'title') doc.setTitle(value);
      if (field === 'author') doc.setAuthor(value);
      if (field === 'subject') doc.setSubject(value);
      if (field === 'keywords') doc.setKeywords(value ? value.split(',').map((k) => k.trim()).filter(Boolean) : []);
    }
    doc.setModificationDate(new Date());
    const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    return [{ name, type: 'application/pdf', bytes }];
  },
};
