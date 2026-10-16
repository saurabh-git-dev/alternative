import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { initialValues } from '../src/core/params';
import { watermarkPdf } from '../src/actions/pdf/watermark';
import { jpegOrientation } from '../src/actions/pdf/from-images';

const ctx = { progress: () => {} };

async function samplePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

describe('watermark', () => {
  it('stamps only the selected pages', async () => {
    const bytes = await samplePdf(3);
    const params = { ...initialValues(watermarkPdf), pages: '2' };
    const [out] = await watermarkPdf.run([{ name: 'a.pdf', type: 'application/pdf', bytes }], params, ctx);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(3);
    const contentCount = (i: number) => doc.getPage(i).node.Contents()?.toString().length ?? 0;
    expect(contentCount(1)).toBeGreaterThan(contentCount(0));
    expect(out.name).toBe('a-watermarked.pdf');
  });
});

describe('jpegOrientation', () => {
  it('reads the EXIF orientation tag', () => {
    // Minimal JPEG: SOI + APP1 Exif (big-endian TIFF, one IFD entry: orientation = 6).
    const app1 = [
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ];
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]))).toBe(6);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
  });
});
