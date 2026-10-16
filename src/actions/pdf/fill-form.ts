/**
 * Fill PDF form: type into a PDF's fillable fields.
 *
 * Engine: pdf-lib (AcroForm). The form editor lists every field with its
 * current value; optionally the result is flattened so it can't be edited.
 * XFA forms (an old Adobe-only format) are not supported.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

export const fillFormPdf: ActionDefinition = {
  id: 'pdf.fill-form',
  title: 'Fill PDF form',
  description: 'Type into fillable PDF forms and save the result.',
  category: 'pdf-edit',
  icon: '📝',
  accepts: ['application/pdf'],
  mode: 'each',
  maxFiles: 1,
  verb: 'Save filled form',
  engines: ['pdf-lib'],
  params: {
    fields: { kind: 'formFields', label: 'Form fields', default: {} },
    flatten: {
      kind: 'boolean',
      label: 'Lock answers',
      help: 'Turns the fields into plain content so nobody can change them later.',
      default: false,
    },
  },
  async run([file], params) {
    const [{ PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList }, { loadPdf }] = await Promise.all([
      import('pdf-lib'),
      import('../../engines/pdflib'),
    ]);
    const doc = await loadPdf(file.bytes);
    const form = doc.getForm();
    const values = params.fields as Record<string, string | boolean>;
    if (form.getFields().length === 0) throw new Error('This PDF has no fillable fields.');

    for (const [name, value] of Object.entries(values)) {
      const field = form.getFieldMaybe(name);
      if (!field || field.isReadOnly()) continue;
      if (field instanceof PDFTextField) field.setText(String(value));
      else if (field instanceof PDFCheckBox) (value ? field.check() : field.uncheck());
      else if (field instanceof PDFDropdown && value) field.select(String(value));
      else if (field instanceof PDFRadioGroup && value) field.select(String(value));
      else if (field instanceof PDFOptionList && value) field.select(String(value));
    }
    if (params.flatten) form.flatten();
    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${baseName(file.name)}-filled.pdf`, type: 'application/pdf', bytes }];
  },
};
