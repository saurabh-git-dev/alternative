/**
 * Edit PDF text: read the lines on a page, then rewrite the ones the user
 * changed.
 *
 * Engine: MuPDF. Reading uses the structured-text walker, which gives every
 * character's font, size, colour and position. Saving erases the changed
 * lines with text-only redactions (images, shapes and backgrounds under them
 * stay), then writes the new text into the page's content, so it is real,
 * selectable page text rather than an annotation on top.
 *
 * Fonts: a changed line keeps its own font when that font has a glyph for
 * every character typed (fonts embedded in PDFs are usually subsets, so new
 * letters may be missing). Otherwise the closest standard font is used:
 * Helvetica, Times or Courier, which every viewer has, and MuPDF's built-in
 * copies of them for letters outside Western European (Greek, Cyrillic, …).
 * Chinese, Japanese and Korean use the viewer's CJK fonts. Scripts whose
 * letters change shape when joined (Arabic, Hindi, …) can't be written yet,
 * since there is no text shaping here.
 */
import type * as MuPDF from 'mupdf';
import type { TextItem } from '../core/types';
import { loadMupdf } from './mupdf';

type Rect = [number, number, number, number];
type Matrix = [number, number, number, number, number, number];
type Generic = 'sans' | 'serif' | 'mono';

export interface PageText {
  /** Page size in points, as displayed (after rotation). */
  width: number;
  height: number;
  lines: TextItem[];
}

interface Char {
  c: string;
  x: number;
  y: number;
  font: MuPDF.Font;
  size: number;
  /** Left and right edges of the glyph box, and its top and bottom. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  color: number[];
}

function openPdf(mupdf: typeof MuPDF, bytes: Uint8Array): MuPDF.PDFDocument {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf') as MuPDF.PDFDocument;
  if (doc.needsPassword()) {
    doc.destroy();
    throw new Error('This PDF is password-protected. Unlock it first.');
  }
  return doc;
}

/** Every character on the page, grouped by the lines MuPDF found. Vertical and rotated lines are left out. */
function readLines(page: MuPDF.PDFPage): Char[][] {
  const lines: Char[][] = [];
  let line: Char[] | null = null;
  const stext = page.toStructuredText('preserve-whitespace');
  stext.walk({
    beginLine(_bbox, wmode, dir) {
      line = wmode === 0 && Math.abs(dir[1]) < 0.01 && dir[0] > 0 ? [] : null;
    },
    onChar(c, origin, font, size, quad, color) {
      if (!line) return;
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      line.push({
        c,
        x: origin[0],
        y: origin[1],
        font,
        size,
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
        color,
      });
    },
    endLine() {
      if (line?.length) lines.push(line);
      line = null;
    },
  });
  stext.destroy();
  return lines;
}

/**
 * Split a line where there is a wide gap, so table cells and columns that
 * MuPDF joined become separate items, and trim surrounding spaces.
 */
export function splitRuns<T extends { c: string; x: number; left: number; right: number; size: number }>(chars: T[]): T[][] {
  const runs: T[][] = [];
  let run: T[] = [];
  let last: T | null = null;
  for (const ch of chars) {
    if (/\s/.test(ch.c)) {
      if (run.length) run.push(ch);
      continue;
    }
    if (last && ch.left - last.right > Math.max(ch.size, last.size) * 1.2) {
      runs.push(run);
      run = [];
    }
    run.push(ch);
    last = ch;
  }
  if (run.length) runs.push(run);
  return runs.map((r) => {
    let end = r.length;
    while (end > 0 && /\s/.test(r[end - 1].c)) end--;
    return r.slice(0, end);
  });
}

const hex2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0');

/** Standard family, weight and slant that look closest to a font. */
export function describeFont(name: string, flags: { serif: boolean; mono: boolean; bold: boolean; italic: boolean }) {
  const n = name.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const generic: Generic =
    flags.mono || /courier|mono|consol|menlo|typewriter/.test(n)
      ? 'mono'
      : /sans|arial|helvetica|verdana|calibri|segoe|roboto|gothic|tahoma|carlito/.test(n)
        ? 'sans'
        : flags.serif || /times|serif|roman|georgia|garamond|cambria|book|minion|palatino|caladea/.test(n)
          ? 'serif'
          : 'sans';
  return {
    generic,
    bold: flags.bold || /bold|black|heavy|semibold|demi/.test(n),
    italic: flags.italic || /italic|oblique/.test(n),
  };
}

/** The lines of text on one page (1-based), ready to edit. */
export async function readPageText(bytes: Uint8Array, pageNumber: number): Promise<PageText> {
  const mupdf = await loadMupdf();
  const doc = openPdf(mupdf, bytes);
  try {
    const page = doc.loadPage(pageNumber - 1) as MuPDF.PDFPage;
    const [bx0, by0, bx1, by1] = page.getBounds();
    const pw = bx1 - bx0;
    const ph = by1 - by0;
    const items: TextItem[] = [];
    for (const line of readLines(page)) {
      for (const run of splitRuns(line)) {
        if (!run.length) continue;
        // The style most of the letters have; mixed lines take it as a whole when edited.
        const counts = new Map<string, { n: number; ch: Char }>();
        for (const ch of run) {
          if (/\s/.test(ch.c)) continue;
          const key = `${ch.font.getName()}|${ch.size.toFixed(1)}|${ch.color.join(',')}`;
          const entry = counts.get(key) ?? { n: 0, ch };
          entry.n++;
          counts.set(key, entry);
        }
        const { ch: main } = [...counts.values()].sort((a, b) => b.n - a.n)[0];
        const name = main.font.getName();
        const style = describeFont(name, {
          serif: main.font.isSerif(),
          mono: main.font.isMono(),
          bold: main.font.isBold(),
          italic: main.font.isItalic(),
        });
        const left = Math.min(...run.map((c) => c.left));
        const right = Math.max(...run.map((c) => c.right));
        const top = Math.min(...run.map((c) => c.top));
        const bottom = Math.max(...run.map((c) => c.bottom));
        items.push({
          id: `${pageNumber}:${items.length}`,
          page: pageNumber,
          x: (run[0].x - bx0) / pw,
          y: (main.y - by0) / ph,
          text: run.map((c) => c.c).join(''),
          family: 'original',
          bold: style.bold,
          italic: style.italic,
          size: main.size / pw,
          color: `#${main.color.slice(0, 3).map(hex2).join('')}`,
          source: {
            x: (left - bx0) / pw,
            y: (top - by0) / ph,
            w: (right - left) / pw,
            h: (bottom - top) / ph,
            font: name,
            generic: style.generic,
          },
        });
      }
    }
    page.destroy();
    return { width: pw, height: ph, lines: items };
  } finally {
    doc.destroy();
  }
}

/**
 * The page with all its text removed, as a JPEG `width` pixels wide. The
 * editor shows patches of it where a line was changed, so the preview has the
 * real background behind the new text.
 */
export async function renderWithoutText(bytes: Uint8Array, pageNumber: number, width: number): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const doc = openPdf(mupdf, bytes);
  try {
    const page = doc.loadPage(pageNumber - 1) as MuPDF.PDFPage;
    const bounds = page.getBounds();
    page.createAnnotation('Redact').setRect(bounds);
    page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    const scale = width / Math.max(1, bounds[2] - bounds[0]);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const jpeg = pixmap.asJPEG(85, false).slice();
    pixmap.destroy();
    page.destroy();
    return jpeg;
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Windows-1252 codes for the characters it has outside Latin-1. */
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Bytes of `text` in WinAnsiEncoding, or null if a character isn't in it. */
export function winAnsi(text: string): number[] | null {
  const out: number[] = [];
  for (const ch of text) {
    const u = ch.codePointAt(0)!;
    if ((u >= 0x20 && u <= 0x7e) || (u >= 0xa0 && u <= 0xff)) out.push(u);
    else if (WIN_ANSI_EXTRA[u]) out.push(WIN_ANSI_EXTRA[u]);
    else return null;
  }
  return out;
}

/** Letters that need shaping (joining, reordering), which plain glyph placement gets wrong. */
const NEEDS_SHAPING = /[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0fff\u1000-\u109f\u1780-\u17ff\ua8e0-\ua8ff\ufb1d-\ufdff\ufe70-\ufeff]/;

const CJK_CHARS = '\u1100-\u11ff\u2e80-\u2fdf\u3000-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef';
const CJK = new RegExp(`[${CJK_CHARS}]`);
/** Splits text into CJK and other runs, keeping the CJK ones (odd indexes). */
const CJK_RUNS = new RegExp(`([${CJK_CHARS}]+)`);

/** CJK language for MuPDF's built-in CJK fonts, or null when the text has none. */
export function cjkLanguage(text: string): 'ja' | 'ko' | 'zh-Hans' | null {
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text)) return 'ko';
  if (CJK.test(text)) return 'zh-Hans';
  return null;
}

const BASE14: Record<Generic, [string, string, string, string]> = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};

/** A font added to the document, and how to turn text into a TJ array for it. */
interface PdfFont {
  ref: MuPDF.PDFObject;
  /** TJ array contents, or null if a character can't be shown. */
  encode(text: string): string | null;
}

/** A font seen on the page, with how wide some of its letters were drawn (in em). */
interface SeenFont {
  font: MuPDF.Font;
  widths: Map<string, number>;
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/**
 * Glyph ids for Identity-H fonts; spaces the font lacks become a quarter-em
 * gap. `drawable` can veto glyphs, e.g. ones a subset font kept empty.
 */
function glyphEncoder(font: MuPDF.Font, drawable: (gid: number) => boolean = () => true): (text: string) => string | null {
  return (text) => {
    let out = '';
    for (const ch of text) {
      const gid = font.encodeCharacter(ch.codePointAt(0)!);
      if (gid > 0 && (/\s/.test(ch) || drawable(gid))) out += `<${hex4(gid)}>`;
      else if (/\s/.test(ch)) out += ' -250 ';
      else return null;
    }
    return out;
  };
}

/**
 * True when the font's character map is trustworthy: the letters drawn with
 * it on the page have the widths its glyphs say they should. Subset fonts
 * often have their own private codes, and then reusing them for new text
 * would show the wrong letters.
 */
function mapsCorrectly(seen: SeenFont): boolean {
  let good = 0;
  let total = 0;
  const gids = new Map<number, string>();
  for (const [c, width] of seen.widths) {
    const gid = seen.font.encodeCharacter(c.codePointAt(0)!);
    total++;
    if (gid <= 0) continue;
    if (gids.has(gid) && gids.get(gid) !== c) return false;
    gids.set(gid, c);
    if (Math.abs(seen.font.advanceGlyph(gid) - width) < 0.05) good++;
  }
  return total > 0 && good / total >= 0.85;
}

/** Adds the fonts needed for edits, each once per document. */
class FontBook {
  private cache = new Map<string, PdfFont | null>();
  constructor(
    private mupdf: typeof MuPDF,
    private doc: MuPDF.PDFDocument,
  ) {}

  private get(key: string, make: () => PdfFont | null): PdfFont | null {
    if (!this.cache.has(key)) {
      try {
        this.cache.set(key, make());
      } catch {
        this.cache.set(key, null);
      }
    }
    return this.cache.get(key)!;
  }

  /** The line's own font, if it is safe to reuse and has every letter. */
  original(seen: SeenFont | undefined, text: string): PdfFont | null {
    if (!seen || !mapsCorrectly(seen)) return null;
    const font = this.get(`orig:${seen.font.getName()}`, () => ({
      ref: this.doc.addFont(seen.font),
      encode: glyphEncoder(seen.font, (gid) => this.hasInk(seen.font, gid)),
    }));
    return font?.encode(text) != null ? font : null;
  }

  private ink = new Map<string, boolean>();

  /**
   * Whether a glyph draws anything. Subsetting often keeps a font's character
   * map but empties the glyphs no one used, which would make new letters invisible.
   */
  private hasInk(font: MuPDF.Font, gid: number): boolean {
    const key = `${font.getName()}:${gid}`;
    if (!this.ink.has(key)) {
      const { mupdf } = this;
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 64, 64], false);
      pix.clear(255);
      const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
      const text = new mupdf.Text();
      text.showGlyph(font, [40, 0, 0, -40, 8, 48], gid, 0);
      device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, [0], 1);
      device.close();
      this.ink.set(key, pix.getPixels().some((v) => v < 160));
      [text, device, pix].forEach((x) => x.destroy());
    }
    return this.ink.get(key)!;
  }

  /** A standard font for the family, or a CJK font in `lang` for CJK text. */
  standard(generic: Generic, bold: boolean, italic: boolean, text: string, lang = cjkLanguage(text)): PdfFont | null {
    const name = BASE14[generic][(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (winAnsi(text)) {
      return this.get(`simple:${name}`, () => ({
        ref: this.doc.addSimpleFont(new this.mupdf.Font(name), 'Latin'),
        encode: (t) => {
          const codes = winAnsi(t);
          return codes && `<${codes.map((c) => c.toString(16).padStart(2, '0')).join('')}>`;
        },
      }));
    }
    if (lang && CJK.test(text)) {
      const cjk = this.get(`cjk:${lang}:${generic}`, () => ({
        ref: this.doc.addCJKFont(new this.mupdf.Font(lang), lang, 0, generic === 'serif'),
        encode: (t) => {
          let out = '<';
          for (let i = 0; i < t.length; i++) out += hex4(t.charCodeAt(i));
          return `${out}>`;
        },
      }));
      return cjk;
    }
    // Greek, Cyrillic and other Latin letters: embed MuPDF's copy of the standard font.
    const font = this.get(`cid:${name}`, () => {
      const f = new this.mupdf.Font(name);
      return { ref: this.doc.addFont(f), encode: glyphEncoder(f) };
    });
    return font?.encode(text) != null ? font : null;
  }
}

const num = (n: number) => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(4).replace(/\.?0+$/, ''));

function invert([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];

/** Distance between lines of a multi-line item, in font sizes. */
const LINE_HEIGHT = 1.2;

/**
 * Apply edits: erase the original text of every changed or deleted line, and
 * write the new text. Returns the new PDF.
 */
export async function editText(bytes: Uint8Array, items: TextItem[]): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const doc = openPdf(mupdf, bytes);
  try {
    for (const item of items) {
      const lines = item.text.split('\n');
      if (lines.some((l) => NEEDS_SHAPING.test(l))) {
        throw new Error(`“${item.text.slice(0, 40)}” is in a script whose letters join or change shape (such as Arabic or Hindi), which this tool can't write yet.`);
      }
    }
    const fonts = new FontBook(mupdf, doc);
    const pageCount = doc.countPages();
    const pages = [...new Set(items.map((i) => i.page))].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
    for (const pageNumber of pages) {
      const onPage = items.filter((i) => i.page === pageNumber);
      const page = doc.loadPage(pageNumber - 1) as MuPDF.PDFPage;
      const [bx0, by0, bx1, by1] = page.getBounds();
      const pw = bx1 - bx0;
      const ph = by1 - by0;

      // Fonts on the page and the widths their letters were drawn at, read before erasing.
      const seen = new Map<string, SeenFont>();
      for (const line of readLines(page)) {
        for (const ch of line) {
          if (/\s/.test(ch.c) || ch.size <= 0) continue;
          const name = ch.font.getName();
          let entry = seen.get(name);
          if (!entry) seen.set(name, (entry = { font: ch.font, widths: new Map() }));
          if (entry.widths.size < 60 && !entry.widths.has(ch.c)) entry.widths.set(ch.c, (ch.right - ch.left) / ch.size);
        }
      }

      // Erase the original lines. Only text goes; pictures and shapes underneath stay.
      const erased = onPage.filter((i) => i.source);
      for (const { source } of erased) {
        const s = source!;
        // A little smaller than the glyph boxes, so neighbouring lines with tight spacing are spared.
        const inset = s.h * ph * 0.15;
        const rect: Rect = [bx0 + s.x * pw, by0 + s.y * ph + inset, bx0 + (s.x + s.w) * pw, by0 + (s.y + s.h) * ph - inset];
        page.createAnnotation('Redact').setRect(rect);
      }
      if (erased.length) {
        page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      }

      // Write the new text, in PDF user space (the page may be rotated or offset).
      const toUser = invert(page.getTransform() as Matrix);
      const pageObj = page.getObject();
      let resources = pageObj.getInheritable('Resources');
      if (resources.isNull()) {
        resources = doc.newDictionary();
        pageObj.put('Resources', resources);
      }
      let fontDict = resources.get('Font');
      if (fontDict.isNull()) {
        fontDict = doc.newDictionary();
        resources.put('Font', fontDict);
      }
      const names = new Map<string, string>();
      const resourceName = (font: PdfFont) => {
        const key = String(font.ref.asIndirect());
        if (!names.has(key)) {
          let n = 1;
          while (!fontDict.get(`FEd${n}`).isNull()) n++;
          fontDict.put(`FEd${n}`, font.ref);
          names.set(key, `FEd${n}`);
        }
        return names.get(key)!;
      };

      let content = '';
      for (const item of onPage) {
        if (!item.text.trim()) continue;
        const size = item.size * pw;
        const [ux, uy] = sub(apply(toUser, 1, 0), apply(toUser, 0, 0));
        const [vx, vy] = sub(apply(toUser, 0, -1), apply(toUser, 0, 0));
        const rgb = [1, 3, 5].map((i) => parseInt(item.color.slice(i, i + 2), 16) / 255);
        content += `BT\n${rgb.map(num).join(' ')} rg\n`;
        item.text.split('\n').forEach((line, i) => {
          if (!line.trim()) return;
          const runs = fontRuns(fonts, seen, item, line);
          if (!runs) throw new Error(`“${line.slice(0, 40)}” has characters no available font can show.`);
          const [ox, oy] = apply(toUser, bx0 + item.x * pw, by0 + item.y * ph + i * size * LINE_HEIGHT);
          content += `${[ux * size, uy * size, vx * size, vy * size, ox, oy].map(num).join(' ')} Tm\n`;
          // Each run continues where the previous one ended.
          for (const run of runs) content += `/${resourceName(run.font)} 1 Tf\n[${run.font.encode(run.text)}] TJ\n`;
        });
        content += 'ET\n';
      }
      if (content) {
        // Wrap the existing content in q/Q so a transform it leaves behind can't move the new text.
        const existing = pageObj.get('Contents');
        const list = doc.newArray();
        list.push(doc.addStream('q\n', {}));
        if (existing.isArray()) for (let i = 0; i < existing.length; i++) list.push(existing.get(i));
        else if (!existing.isNull()) list.push(existing);
        list.push(doc.addStream(`Q\nq\n${content}Q\n`, {}));
        pageObj.put('Contents', list);
      }
      page.destroy();
    }
    return doc.saveToBuffer('garbage=compact,compress=yes').asUint8Array().slice();
  } finally {
    doc.destroy();
  }
}

const sub = ([a, b]: [number, number], [c, d]: [number, number]): [number, number] => [a - c, b - d];

/**
 * Fonts for one line: the line's own font for all of it when possible,
 * otherwise standard fonts, with CJK parts in a CJK font so the Latin letters
 * around them keep their normal widths.
 */
function fontRuns(fonts: FontBook, seen: Map<string, SeenFont>, item: TextItem, line: string): { font: PdfFont; text: string }[] | null {
  if (item.family === 'original' && item.source) {
    const own = fonts.original(seen.get(item.source.font), line);
    if (own) return [{ font: own, text: line }];
  }
  const generic = item.family === 'original' ? (item.source?.generic ?? 'sans') : item.family;
  const lang = cjkLanguage(line);
  const runs = [];
  for (const text of line.split(CJK_RUNS).filter(Boolean)) {
    const font = fonts.standard(generic, item.bold, item.italic, text, lang);
    if (!font) return null;
    runs.push({ font, text });
  }
  return runs;
}
