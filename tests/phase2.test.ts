import { describe, expect, it } from 'vitest';
import { stripJpeg, stripPng } from '../src/actions/image/metadata';
import { displayBoxToPdf } from '../src/engines/pdflib';

const seg = (marker: number, payload: number[]) => [0xff, marker, 0x00, payload.length + 2, ...payload];

describe('stripJpeg', () => {
  it('drops EXIF and comments, keeps JFIF, ICC and image data', () => {
    const exif = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0]);
    const icc = seg(0xe2, [...'ICC_PROFILE'].map((c) => c.charCodeAt(0)).concat([0]));
    const jfif = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
    const comment = seg(0xfe, [0x68, 0x69]);
    const scan = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9];
    const input = new Uint8Array([0xff, 0xd8, ...jfif, ...exif, ...icc, ...comment, ...scan]);
    expect([...stripJpeg(input, true)]).toEqual([0xff, 0xd8, ...jfif, ...icc, ...scan]);
    expect([...stripJpeg(input, false)]).toEqual([0xff, 0xd8, ...jfif, ...scan]);
  });
});

describe('stripPng', () => {
  const chunk = (type: string, data: number[] = []) => {
    const len = data.length;
    return [0, 0, (len >> 8) & 255, len & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  };
  it('drops text and EXIF chunks', () => {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const ihdr = chunk('IHDR', [1, 2, 3]);
    const idat = chunk('IDAT', [9]);
    const input = new Uint8Array([...sig, ...ihdr, ...chunk('tEXt', [65]), ...chunk('eXIf', [1]), ...idat, ...chunk('IEND')]);
    expect([...stripPng(input, true)]).toEqual([...sig, ...ihdr, ...idat, ...chunk('IEND')]);
  });
});

describe('displayBoxToPdf', () => {
  const page = (angle: number) => ({
    getCropBox: () => ({ x: 0, y: 0, width: 600, height: 800 }),
    getRotation: () => ({ angle }),
  });
  it('maps a top-left box on an unrotated page', () => {
    expect(displayBoxToPdf(page(0), { x: 0, y: 0, w: 0.5, h: 0.25 })).toEqual({ x: 0, y: 600, width: 300, height: 200, rotate: 0 });
  });
  it('maps the displayed top-left corner of a page rotated 90°', () => {
    // Displayed 800 × 600. The box's bottom-left (0, 150) in display space is unrotated (150, 0).
    expect(displayBoxToPdf(page(90), { x: 0, y: 0, w: 0.5, h: 0.25 })).toEqual({ x: 150, y: 0, width: 400, height: 150, rotate: 90 });
  });
});
