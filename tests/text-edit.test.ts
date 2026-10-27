import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as mupdf from 'mupdf';
import { cjkLanguage, describeFont, editText, readPageText, splitRuns, winAnsi } from '../src/engines/text-edit';
import type { TextItem } from '../src/core/types';

/** A Letter page: two tightly spaced lines on a blue band, and a red line below. */
async function sample(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const page = d.addPage([612, 792]);
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const bold = await d.embedFont(StandardFonts.TimesRomanBold);
  page.drawRectangle({ x: 50, y: 680, width: 400, height: 60, color: rgb(0.8, 0.9, 1) });
  page.drawText('Invoice total: 100 dollars', { x: 72, y: 720, size: 12, font: helv });
  page.drawText('Due in thirty days', { x: 72, y: 707, size: 12, font: helv });
  page.drawText('Thank you', { x: 72, y: 600, size: 18, font: bold, color: rgb(0.8, 0, 0) });
  return d.save();
}

function textOf(bytes: Uint8Array, page = 0): string {
  const doc = new mupdf.PDFDocument(bytes);
  return doc.loadPage(page).toStructuredText('').asText();
}

/** Average colour of a small area of the rendered page (fractions), 0–255. */
function colourAt(bytes: Uint8Array, fx: number, fy: number): number[] {
  const doc = new mupdf.PDFDocument(bytes);
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const px = pix.getPixels();
  const i = Math.round(fy * pix.getHeight()) * pix.getStride() + Math.round(fx * pix.getWidth()) * 3;
  return [px[i], px[i + 1], px[i + 2]];
}

describe('readPageText', () => {
  it('finds each line with its font, size and colour', async () => {
    const { width, lines } = await readPageText(await sample(), 1);
    expect(width).toBe(612);
    expect(lines.map((l) => l.text)).toEqual(['Invoice total: 100 dollars', 'Due in thirty days', 'Thank you']);
    const [first, , thanks] = lines;
    expect(first.x * 612).toBeCloseTo(72, 0);
    expect(first.y * 792).toBeCloseTo(792 - 720, 0);
    expect(first.size * 612).toBeCloseTo(12, 1);
    expect(first.source?.generic).toBe('sans');
    expect(thanks.color).toBe('#cc0000');
    expect([thanks.bold, thanks.source?.generic]).toEqual([true, 'serif']);
  });
});

describe('editText', () => {
  const edit = (line: TextItem, patch: Partial<TextItem>): TextItem => ({ ...line, ...patch });

  it('replaces one line and leaves its neighbours and background alone', async () => {
    const input = await sample();
    const { lines } = await readPageText(input, 1);
    const out = await editText(input, [edit(lines[0], { text: 'Invoice total: 250 dollars' })]);
    const text = textOf(out);
    expect(text).toContain('Invoice total: 250 dollars');
    expect(text).not.toContain('100');
    expect(text).toContain('Due in thirty days');
    expect(text).toContain('Thank you');
    // The blue band behind the text is still there.
    expect(colourAt(out, 460 / 612, (792 - 690) / 792)).toEqual(colourAt(input, 460 / 612, (792 - 690) / 792));
    // The new line sits where the old one was.
    const after = (await readPageText(out, 1)).lines.find((l) => l.text.startsWith('Invoice'))!;
    expect(after.x).toBeCloseTo(lines[0].x, 3);
    expect(after.y).toBeCloseTo(lines[0].y, 3);
  });

  it('deletes, moves and restyles lines, and adds new text', async () => {
    const input = await sample();
    const { lines } = await readPageText(input, 1);
    const out = await editText(input, [
      edit(lines[1], { text: '' }),
      edit(lines[2], { y: 0.5, color: '#0000ff', family: 'mono', bold: false }),
      { id: 'new', page: 1, x: 0.1, y: 0.9, text: 'Paid — merci, Grüße, Ελλάδα, Привет', family: 'serif', bold: false, italic: true, size: 14 / 612, color: '#111111' },
    ]);
    const after = await readPageText(out, 1);
    const texts = after.lines.map((l) => l.text);
    expect(texts).not.toContain('Due in thirty days');
    expect(texts).toContain('Paid — merci, Grüße, Ελλάδα, Привет');
    const moved = after.lines.find((l) => l.text === 'Thank you')!;
    expect(moved.y).toBeCloseTo(0.5, 3);
    expect(moved.color).toBe('#0000ff');
    expect(moved.source?.generic).toBe('mono');
  });

  it('reuses an embedded subset font when it has the letters, and falls back when not', async () => {
    // A PDF whose text uses a subset of an embedded font, like most real documents.
    const doc = new mupdf.PDFDocument();
    const font = doc.addFont(new mupdf.Font('Times-Roman'));
    const resources = doc.addObject({ Font: { F1: font } });
    const contents = 'BT /F1 20 Tf 72 700 Td <' + [...'Hello there'].map((c) => new mupdf.Font('Times-Roman').encodeCharacter(c).toString(16).padStart(4, '0')).join('') + '> Tj ET';
    doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, resources, contents));
    doc.subsetFonts();
    const input = doc.saveToBuffer('compress=yes').asUint8Array().slice();
    const { lines } = await readPageText(input, 1);
    expect(lines[0].text).toBe('Hello there');

    const same = await editText(input, [edit(lines[0], { text: 'Hello other' })]);
    const reused = new mupdf.PDFDocument(same);
    expect(textOf(same)).toContain('Hello other');
    const fontNames = (d: mupdf.PDFDocument) => {
      const fonts = d.loadPage(0).getObject().get('Resources').get('Font');
      const out: string[] = [];
      fonts.forEach((v) => out.push(v.get('BaseFont').asName()));
      return out;
    };
    expect(fontNames(reused)).toEqual([expect.stringMatching(/^[A-Z]{6}\+Times-Roman$/)]);

    // "x" and "z" aren't in the subset: the standard Times is used instead.
    const other = await editText(input, [edit(lines[0], { text: 'Hello xyz' })]);
    expect(textOf(other)).toContain('Hello xyz');
    expect(fontNames(new mupdf.PDFDocument(other))).toContain('Times-Roman');
  });

  it('keeps text in place on rotated and offset pages', async () => {
    // A landscape page stored portrait with /Rotate 90, its text drawn turned so it reads level.
    const d = await PDFDocument.create();
    const page = d.addPage([612, 792]);
    page.setMediaBox(100, 50, 612, 792);
    page.drawText('Quarterly report', { x: 300, y: 200, size: 16, font: await d.embedFont(StandardFonts.Helvetica), rotate: degrees(90) });
    page.setRotation(degrees(90));
    const input = await d.save();
    const { lines } = await readPageText(input, 1);
    expect(lines.map((l) => l.text)).toEqual(['Quarterly report']);
    const out = await editText(input, [edit(lines[0], { text: 'Yearly report', x: lines[0].x + 0.1 })]);
    const [after] = (await readPageText(out, 1)).lines;
    expect(after.text).toBe('Yearly report');
    expect(after.x).toBeCloseTo(lines[0].x + 0.1, 3);
    expect(after.y).toBeCloseTo(lines[0].y, 3);
    expect(after.size).toBeCloseTo(lines[0].size, 4);
  });

  it('refuses scripts that need shaping', async () => {
    const input = await sample();
    await expect(editText(input, [{ id: 'new', page: 1, x: 0.1, y: 0.1, text: 'नमस्ते', family: 'sans', bold: false, italic: false, size: 0.02, color: '#000000' }])).rejects.toThrow(/Hindi/);
  });
});

describe('helpers', () => {
  it('encodes WinAnsi and detects CJK', () => {
    expect(winAnsi('A€ü')).toEqual([0x41, 0x80, 0xfc]);
    expect(winAnsi('Привет')).toBeNull();
    expect([cjkLanguage('日本語のテキスト'), cjkLanguage('한국어'), cjkLanguage('中文'), cjkLanguage('abc')]).toEqual(['ja', 'ko', 'zh-Hans', null]);
  });
  it('guesses the closest standard font', () => {
    const none = { serif: false, mono: false, bold: false, italic: false };
    expect(describeFont('ABCDEF+TimesNewRomanPS-BoldItalicMT', none)).toEqual({ generic: 'serif', bold: true, italic: true });
    expect(describeFont('Arial-BoldMT', { ...none, serif: true }).generic).toBe('sans');
    expect(describeFont('CourierNewPSMT', none).generic).toBe('mono');
  });
  it('splits a line at wide gaps, like table cells', () => {
    const ch = (c: string, left: number) => ({ c, x: left, left, right: left + 6, size: 10 });
    const runs = splitRuns([ch('a', 0), ch('b', 6), ch(' ', 12), ch('c', 15), ch(' ', 21), ch('d', 60)]);
    expect(runs.map((r) => r.map((x) => x.c).join(''))).toEqual(['ab c', 'd']);
  });
});
