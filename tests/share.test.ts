import { describe, expect, it } from 'vitest';
import QRCode, { type QRCodeSegment } from 'qrcode';
import { decodeFragment, fromBase43, fromBase64Url, linkFor, pack, qrCapacity, qrSegmentsFor, toBase43, toBase64Url, unpack } from '../src/core/share';

const base = 'https://saurabh-git-dev.github.io/alternative/';
const random = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));

describe('share links', () => {
  it('base64url and base43 round-trip every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = random(n);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
      expect(fromBase43(toBase43(bytes))).toEqual(bytes);
    }
    expect(fromBase43(toBase43(new Uint8Array([255, 255, 255])))).toEqual(new Uint8Array([255, 255, 255]));
  });

  it('packs text compressed and binary stored, keeping name and type', () => {
    const text = { name: 'notes.csv', type: 'text/csv', bytes: new TextEncoder().encode('a,b\n1,2\n'.repeat(50)) };
    const packed = pack(text);
    expect(packed[0]).toBe(2);
    expect(packed.length).toBeLessThan(60);
    expect(unpack(packed)).toEqual(text);

    const bin = { name: 'Résumé ✓.pdf', type: 'application/pdf', bytes: random(500) };
    expect(pack(bin)[0]).toBe(1);
    expect(unpack(pack(bin))).toEqual(bin);

    const custom = { name: 'x.heic', type: 'image/heic', bytes: random(10) };
    expect(unpack(pack(custom))).toEqual(custom);
    expect(unpack(pack(custom, { includeName: false })).name).toBe('shared.bin');
  });

  it('decodes both link forms', () => {
    const file = { name: 'hi.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello') };
    const packed = pack(file);
    expect(decodeFragment(new URL(linkFor(base, packed)).hash)).toEqual(file);
    const { prefix, payload } = qrSegmentsFor(base, packed);
    expect(decodeFragment(new URL(prefix + payload).hash)).toEqual(file);
    expect(decodeFragment('#/tool/pdf.merge')).toBeNull();
    expect(() => decodeFragment('#/s/' + toBase64Url(packed).slice(0, 5))).toThrow(/incomplete/);
  });

  it('qrCapacity is exactly the largest payload a version-40 QR accepts', () => {
    for (const level of ['L', 'M', 'Q'] as const) {
      const prefix = `${base}#/q/`;
      const cap = qrCapacity(prefix, level);
      const segs = (n: number): QRCodeSegment[] => [{ data: new TextEncoder().encode(prefix), mode: 'byte' }, { data: toBase43(random(n)), mode: 'alphanumeric' }];
      expect(QRCode.create(segs(cap), { errorCorrectionLevel: level }).version).toBe(40);
      expect(() => QRCode.create(segs(cap + 1), { errorCorrectionLevel: level })).toThrow();
    }
    expect(qrCapacity(`${base}#/q/`, 'L')).toBeGreaterThan(2700);
  });
});

import { detectTextType, parseCsv } from '../src/core/text-formats';

describe('text formats', () => {
  it('detects JSON, CSV and text', () => {
    expect(detectTextType('{"a": [1, 2]}')).toBe('application/json');
    expect(detectTextType('name,age\nAda,36\nAlan,41')).toBe('text/csv');
    expect(detectTextType('a;b;c\n1;2;3')).toBe('text/csv');
    expect(detectTextType('Hello there.\nHow are you, friend?')).toBe('text/plain');
    expect(detectTextType('{not json')).toBe('text/plain');
  });
  it('parses quoted CSV', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });
});
