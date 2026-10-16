/**
 * Sign PDF: draw, type or upload a signature and place it on the pages.
 *
 * Engine: pdf-lib (the signature is embedded as a transparent PNG image).
 * This is a visual signature, like signing a printout. It is not a
 * certificate-based digital signature.
 */
import type { ActionDefinition, SignatureValue } from '../../core/types';
import { baseName } from '../../core/files';

export const signPdf: ActionDefinition = {
  id: 'pdf.sign',
  title: 'Sign PDF',
  description: 'Draw, type or upload your signature and place it on the document.',
  category: 'pdf-edit',
  icon: '✍️',
  accepts: ['application/pdf'],
  mode: 'each',
  maxFiles: 1,
  verb: 'Sign document',
  engines: ['pdf-lib'],
  params: {
    signature: {
      kind: 'signature',
      label: 'Signature',
      default: { image: '', placements: [] },
    },
    flatten: {
      kind: 'boolean',
      label: 'Lock form fields',
      help: 'Turns fillable fields into plain content so they can’t be changed after signing.',
      default: false,
      advanced: true,
    },
  },
  async run([file], params) {
    const [{ degrees }, { loadPdf, displayBoxToPdf }] = await Promise.all([
      import('pdf-lib'),
      import('../../engines/pdflib'),
    ]);
    const signature = params.signature as SignatureValue;
    if (!signature.image) throw new Error('Create your signature first.');
    if (signature.placements.length === 0) throw new Error('Place your signature on a page first.');

    const doc = await loadPdf(file.bytes);
    const png = await fetch(signature.image).then((r) => r.arrayBuffer());
    const image = await doc.embedPng(png);
    for (const placement of signature.placements) {
      const page = doc.getPage(placement.page - 1);
      const { x, y, width, height, rotate } = displayBoxToPdf(page, placement);
      page.drawImage(image, { x, y, width, height, rotate: degrees(rotate) });
    }
    if (params.flatten) doc.getForm().flatten();
    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${baseName(file.name)}-signed.pdf`, type: 'application/pdf', bytes }];
  },
};
