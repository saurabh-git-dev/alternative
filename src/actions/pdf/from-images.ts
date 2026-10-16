/**
 * Images to PDF: one image per page.
 *
 * Engine: pdf-lib for the PDF, plus the image engine for formats PDF can't
 * embed directly. JPEG and PNG files are embedded byte-for-byte (no quality
 * loss); other formats are converted to PNG (if transparent) or JPEG q92.
 * JPEGs with an EXIF rotation flag are re-encoded upright, since PDF viewers
 * ignore EXIF orientation.
 */
import type { ActionDefinition, FileData } from '../../core/types';
import { baseName } from '../../core/files';

export const imagesToPdf: ActionDefinition = {
  id: 'pdf.from-images',
  title: 'Images to PDF',
  description: 'Turn photos and scans into a single PDF, one image per page.',
  category: 'pdf-convert',
  icon: '📄',
  accepts: ['image/*'],
  mode: 'all',
  verb: 'Create PDF',
  engines: ['pdf-lib', 'jSquash'],
  params: {
    pageSize: {
      kind: 'enum',
      label: 'Page size',
      default: 'a4',
      options: [
        { value: 'a4', label: 'A4' },
        { value: 'letter', label: 'US Letter' },
        { value: 'fit', label: 'Same as image', hint: 'Each page takes the size of its image' },
      ],
    },
    orientation: {
      kind: 'enum',
      label: 'Orientation',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Automatic', hint: 'Landscape pages for wide images' },
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
      visibleWhen: (v) => v.pageSize !== 'fit',
    },
    margin: {
      kind: 'enum',
      label: 'Margin',
      default: 'small',
      options: [
        { value: 'none', label: 'None' },
        { value: 'small', label: 'Small' },
        { value: 'large', label: 'Large' },
      ],
      advanced: true,
    },
    fileName: {
      kind: 'text',
      label: 'File name',
      default: '',
      placeholder: 'images',
      advanced: true,
    },
  },
  async run(files, params, ctx) {
    const [{ PDFDocument }, { PAGE_SIZES }] = await Promise.all([
      import('pdf-lib'),
      import('../../engines/pdflib'),
    ]);
    const doc = await PDFDocument.create();
    const margin = { none: 0, small: 20, large: 48 }[params.margin as string] ?? 20;

    for (const [i, file] of files.entries()) {
      ctx.progress(i / files.length, `Adding image ${i + 1} of ${files.length}`);
      const prepared = await prepareImage(file);
      const image = prepared.type === 'image/png' ? await doc.embedPng(prepared.bytes) : await doc.embedJpg(prepared.bytes);
      // Pixels → points at 96 dpi, so "Same as image" pages have a natural size.
      const imgW = image.width * 0.75;
      const imgH = image.height * 0.75;

      let pageW: number, pageH: number;
      if (params.pageSize === 'fit') {
        pageW = imgW + margin * 2;
        pageH = imgH + margin * 2;
      } else {
        const [w, h] = PAGE_SIZES[params.pageSize as string] ?? PAGE_SIZES.a4;
        const landscape = params.orientation === 'landscape' || (params.orientation === 'auto' && imgW > imgH);
        [pageW, pageH] = landscape ? [h, w] : [w, h];
      }
      const boxW = pageW - margin * 2;
      const boxH = pageH - margin * 2;
      const scale = Math.min(boxW / imgW, boxH / imgH);
      const w = imgW * scale;
      const h = imgH * scale;
      const page = doc.addPage([pageW, pageH]);
      page.drawImage(image, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    }

    const name = (params.fileName as string).trim() || (files.length === 1 ? baseName(files[0].name) : 'images');
    const bytes = await doc.save();
    return [{ name: `${name.replace(/\.pdf$/i, '')}.pdf`, type: 'application/pdf', bytes }];
  },
};

/** Return JPEG/PNG bytes that pdf-lib can embed and that display upright. */
async function prepareImage(file: FileData): Promise<FileData> {
  if (file.type === 'image/png') return file;
  if (file.type === 'image/jpeg' && jpegOrientation(file.bytes) <= 1 && !isCmykJpeg(file.bytes)) return file;
  const { decode, encode, hasTransparency } = await import('../../engines/image');
  const pixels = await decode(file.bytes, file.type);
  const png = hasTransparency(pixels);
  const bytes = await encode(pixels, png ? 'image/png' : 'image/jpeg', { quality: 92, pngLevel: 1 });
  return { name: file.name, type: png ? 'image/png' : 'image/jpeg', bytes };
}

/** Read the EXIF orientation tag (1–8) of a JPEG; 1 means upright or unknown. */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    offset += 2 + length;
  }
  return 1;
}

/** CMYK JPEGs (Adobe APP14 with 4 components) render with inverted colours in many viewers. */
function isCmykJpeg(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    // SOF0–SOF2: byte 9 holds the number of components.
    if (marker >= 0xffc0 && marker <= 0xffc2) return view.getUint8(offset + 9) === 4;
    offset += 2 + view.getUint16(offset + 2);
  }
  return false;
}
