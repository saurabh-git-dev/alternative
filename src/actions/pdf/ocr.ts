/**
 * OCR PDF: make scanned PDFs searchable and selectable.
 *
 * How (the "sandwich" approach used by OCRmyPDF):
 *  1. MuPDF renders each page at 300 dpi.
 *  2. Tesseract recognises it and produces a text-only PDF page: invisible
 *     text in a glyph-less font, positioned exactly over the words.
 *  3. pdf-lib overlays that invisible layer on the ORIGINAL page.
 * The original page content is never re-encoded, so quality and file size
 * are preserved; only the text layer is added. Pages that already contain
 * text are skipped by default.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';
import { parseRanges, rangeSyntaxError } from '../../core/ranges';
import { OCR_LANGUAGES } from '../../engines/ocr-languages';

export const ocrPdf: ActionDefinition = {
  id: 'pdf.ocr',
  title: 'OCR PDF',
  description: 'Make scanned PDFs searchable, so you can find and copy text.',
  category: 'pdf-convert',
  icon: '🔍',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Make searchable',
  engines: ['Tesseract.js', 'mupdf', 'pdf-lib'],
  demanding: 'Downloads text-recognition data and reads each page in turn, so long documents can take minutes on a phone.',
  params: {
    language: {
      kind: 'enum',
      label: 'Language of the document',
      help: 'English is built in. Other languages download once (2–4 MB), then work offline.',
      default: 'eng',
      display: 'select',
      options: OCR_LANGUAGES,
    },
    second: {
      kind: 'enum',
      label: 'Second language',
      default: '',
      display: 'select',
      options: [{ value: '', label: 'None' }, ...OCR_LANGUAGES],
      advanced: true,
    },
    saveText: {
      kind: 'boolean',
      label: 'Also save the text (.txt)',
      help: 'A plain-text file of everything on the pages, shown on the results page to read or copy.',
      default: true,
    },
    skipText: {
      kind: 'boolean',
      label: 'Skip pages that already have text',
      help: 'Saves time on documents that are only partly scanned.',
      default: true,
      advanced: true,
    },
    dpi: {
      kind: 'number',
      label: 'Recognition resolution',
      help: '300 dpi is the sweet spot. Raise it for tiny print.',
      default: 300,
      min: 150,
      max: 600,
      step: 50,
      unit: 'dpi',
      advanced: true,
    },
    pages: {
      kind: 'text',
      label: 'Pages',
      default: 'all',
      validate: rangeSyntaxError,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const [{ recognize }, mupdfEngine, { loadPdf }, { degrees }] = await Promise.all([
      import('../../engines/ocr'),
      import('../../engines/mupdf'),
      import('../../engines/pdflib'),
      import('pdf-lib'),
    ]);
    const langs = [params.language as string, params.second as string].filter(Boolean);
    const doc = await loadPdf(file.bytes);
    const pages = parseRanges(params.pages as string, doc.getPageCount());
    const hasText = params.skipText ? await mupdfEngine.pagesWithText(file.bytes) : new Set<number>();
    const todo = pages.filter((p) => !hasText.has(p));
    /** Text of each page, for the .txt: recognised pages fill in as they go, pages with text already are read directly. */
    const texts = new Map<number, string>();
    if (params.saveText && hasText.size) {
      const existing = await mupdfEngine.pageTexts(file.bytes);
      for (const p of pages) if (hasText.has(p)) texts.set(p, existing[p - 1] ?? '');
    }
    const textFile = () =>
      params.saveText
        ? [{
            name: `${baseName(file.name)}-text.txt`,
            type: 'text/plain',
            bytes: new TextEncoder().encode(
              pages.map((p) => (pages.length > 1 ? `--- Page ${p} ---\n` : '') + (texts.get(p) ?? '').trim()).join('\n\n') + '\n',
            ),
          }]
        : [];
    if (todo.length === 0) {
      return [
        { name: `${baseName(file.name)}-ocr.pdf`, type: 'application/pdf', bytes: file.bytes, note: 'Every page already has text, so nothing needed doing.' },
        ...textFile(),
      ];
    }

    let found = 0;
    for (const [i, pageNumber] of todo.entries()) {
      const report = (f: number, m: string) => ctx.progress((i + f) / todo.length, m);
      report(0, `Reading page ${pageNumber} (${i + 1} of ${todo.length})`);
      const [png] = await mupdfEngine.renderPages(file.bytes, [pageNumber], {
        dpi: params.dpi as number,
        format: 'png',
        // Twice an A4 page at the chosen dpi: real paper sizes up to A3 render
        // at full resolution, oversized "pixel" pages are scaled down to fit.
        maxPixels: 2 * 8.27 * 11.69 * (params.dpi as number) ** 2,
      });
      const result = await recognize(new Blob([png as BlobPart], { type: 'image/png' }), langs, {
        pdf: true,
        pdfTextOnly: true,
        onProgress: (f, m) => report(f * 0.5, m),
      });
      texts.set(pageNumber, result.text);
      if (!result.pdf || result.words.length === 0) continue;
      found += result.words.length;

      // Overlay the invisible text page onto the original, undoing the page's
      // display rotation (the render is of the rotated view).
      const [layer] = await doc.embedPdf(result.pdf);
      const page = doc.getPage(pageNumber - 1);
      const box = page.getCropBox();
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const [w, h] = [box.width, box.height];
      const sideways = rotation === 90 || rotation === 270;
      const size = sideways ? { width: h, height: w } : { width: w, height: h };
      const offset = { 0: [0, 0], 90: [w, 0], 180: [w, h], 270: [0, h] }[rotation] ?? [0, 0];
      page.drawPage(layer, { ...size, x: box.x + offset[0], y: box.y + offset[1], rotate: degrees(rotation) });
    }

    const bytes = await doc.save({ useObjectStreams: true });
    const note = found === 0 ? 'No text was recognised. Check the language setting.' : undefined;
    return [{ name: `${baseName(file.name)}-ocr.pdf`, type: 'application/pdf', bytes, note }, ...textFile()];
  },
};
