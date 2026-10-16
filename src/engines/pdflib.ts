/**
 * pdf-lib engine: drawing onto and creating PDFs in pure JavaScript.
 *
 * Source:  pdf-lib (MIT), ~200 KB, no WASM.
 * Used for: watermarks, images → PDF (and later page numbers, forms, signatures).
 * Why pdf-lib: precise placement of text and images with a simple API; it
 * keeps existing page content as-is and only appends new drawing operations.
 */
export async function loadPdfLib() {
  return import('pdf-lib');
}

/**
 * Open a PDF for editing.
 *
 * pdf-lib can't read encrypted files or some damaged ones, so on failure the
 * file is first rewritten by qpdf: that removes encryption that has no open
 * password (common on bank statements and official forms, which open without
 * a password but forbid editing) and repairs broken structure. Only a real
 * open password produces the "Unlock it first" message.
 */
export async function loadPdf(bytes: Uint8Array) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(bytes);
  } catch (first) {
    const { runQpdf } = await import('./qpdf');
    let rewritten: Uint8Array;
    try {
      [rewritten] = await runQpdf({ inputs: [bytes], args: ['--decrypt', '{in0}', '{out}'] });
    } catch (e) {
      if (/password/i.test(String(e))) throw new Error('This PDF is password-protected. Unlock it first.');
      throw new Error("This PDF couldn't be read. Try Repair PDF first.");
    }
    try {
      return await PDFDocument.load(rewritten);
    } catch {
      throw new Error(/encrypted/i.test(String(first)) ? 'This PDF is password-protected. Unlock it first.' : "This PDF couldn't be read. Try Repair PDF first.");
    }
  }
}

/** Parse `#rrggbb` into pdf-lib's 0–1 RGB components. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Standard page sizes in PDF points (1 pt = 1/72 inch). */
export const PAGE_SIZES: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
};

export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'list';
  value: string | boolean;
  options?: string[];
  multiline?: boolean;
  readOnly?: boolean;
}

/** List a PDF's interactive (AcroForm) fields with their current values. */
export async function readFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = await import('pdf-lib');
  const doc = await loadPdf(bytes);
  const fields: FormField[] = [];
  for (const field of doc.getForm().getFields()) {
    const base = { name: field.getName(), readOnly: field.isReadOnly() };
    if (field instanceof PDFTextField) {
      fields.push({ ...base, type: 'text', value: field.getText() ?? '', multiline: field.isMultiline() });
    } else if (field instanceof PDFCheckBox) {
      fields.push({ ...base, type: 'checkbox', value: field.isChecked() });
    } else if (field instanceof PDFDropdown) {
      fields.push({ ...base, type: 'dropdown', value: field.getSelected()[0] ?? '', options: field.getOptions() });
    } else if (field instanceof PDFRadioGroup) {
      fields.push({ ...base, type: 'radio', value: field.getSelected() ?? '', options: field.getOptions() });
    } else if (field instanceof PDFOptionList) {
      fields.push({ ...base, type: 'list', value: field.getSelected()[0] ?? '', options: field.getOptions() });
    }
  }
  return fields;
}

/**
 * Convert a rectangle given in fractions of the page *as displayed* (top-left
 * origin, after the page's /Rotate) into PDF user space, returning the anchor
 * and rotation to pass to pdf-lib's drawImage/drawText so content appears
 * upright where the user placed it.
 */
export function displayBoxToPdf(
  page: { getCropBox(): { x: number; y: number; width: number; height: number }; getRotation(): { angle: number } },
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; width: number; height: number; rotate: number } {
  const crop = page.getCropBox();
  const W = crop.width;
  const H = crop.height;
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = r === 90 || r === 270;
  const DW = sideways ? H : W;
  const DH = sideways ? W : H;
  const width = box.w * DW;
  const height = box.h * DH;
  // The content's bottom-left corner in display coordinates (y down).
  const dx = box.x * DW;
  const dy = (box.y + box.h) * DH;
  let px: number, py: number;
  switch (r) {
    case 90: px = dy; py = dx; break;
    case 180: px = W - dx; py = dy; break;
    case 270: px = W - dy; py = H - dx; break;
    default: px = dx; py = H - dy;
  }
  return { x: crop.x + px, y: crop.y + py, width, height, rotate: r };
}
