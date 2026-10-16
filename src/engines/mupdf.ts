/**
 * MuPDF engine: high-quality PDF rendering and inspection.
 *
 * Source:  mupdf.js (Artifex, AGPL-3.0), ~10 MB WASM (3.6 MB brotli).
 * Used for: page thumbnails, PDF → image, page count / encryption checks.
 * Why MuPDF: sharper anti-aliasing and more faithful rendering than PDF.js,
 * and it opens damaged files that other renderers reject.
 *
 * The module is imported lazily so only tools that need it pay the download.
 */
import type * as MuPDF from 'mupdf';

let modulePromise: Promise<typeof MuPDF> | null = null;

export function loadMupdf(): Promise<typeof MuPDF> {
  modulePromise ??= import('mupdf');
  return modulePromise;
}

export interface PdfInfo {
  pageCount: number;
  /** True when a password is needed to open the file. */
  encrypted: boolean;
}

/** Page count and encryption status, without rendering anything. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const encrypted = doc.needsPassword();
    return { pageCount: encrypted ? 0 : doc.countPages(), encrypted };
  } finally {
    doc.destroy();
  }
}

export interface RenderOptions {
  /** Output resolution in dots per inch (72 = 1:1 with PDF points). */
  dpi: number;
  format: 'png' | 'jpeg';
  /** JPEG quality 1–100. */
  quality?: number;
  /** Render with a transparent background instead of white (PNG only). */
  transparent?: boolean;
  password?: string;
  /**
   * Upper bound on pixels per page. Pages larger than this are rendered at a
   * lower resolution instead. Phone scanner apps often make pages several
   * metres wide (one point per pixel), which would otherwise run out of memory.
   */
  maxPixels?: number;
}

/**
 * Render selected pages (1-based) to image bytes, calling `onPage` after each
 * so callers can report progress and stream results.
 */
export async function renderPages(
  bytes: Uint8Array,
  pages: number[],
  options: RenderOptions,
  onPage?: (index: number, image: Uint8Array) => void,
): Promise<Uint8Array[]> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  if (doc.needsPassword() && !(options.password && doc.authenticatePassword(options.password))) {
    doc.destroy();
    throw new Error('This PDF is password-protected. Unlock it first.');
  }
  const alpha = options.format === 'png' && !!options.transparent;
  const results: Uint8Array[] = [];
  try {
    pages.forEach((pageNumber, index) => {
      const page = doc.loadPage(pageNumber - 1);
      const scale = renderScale(page.getBounds(), options);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, alpha, true);
      const image = options.format === 'png' ? pixmap.asPNG() : pixmap.asJPEG(options.quality ?? 90, false);
      results.push(image.slice());
      pixmap.destroy();
      page.destroy();
      onPage?.(index, results[index]);
    });
  } finally {
    doc.destroy();
  }
  return results;
}

/** Points-to-pixels scale for one page: the requested dpi, capped by `maxPixels`. */
function renderScale([x0, y0, x1, y1]: number[], options: RenderOptions): number {
  const scale = options.dpi / 72;
  const pixels = (x1 - x0) * (y1 - y0) * scale * scale;
  return options.maxPixels && pixels > options.maxPixels ? scale * Math.sqrt(options.maxPixels / pixels) : scale;
}

/** Small JPEG thumbnails at a given pixel width, for page grids and previews. */
export async function renderThumbnails(bytes: Uint8Array, pages: number[], width: number): Promise<Uint8Array[]> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  if (doc.needsPassword()) {
    doc.destroy();
    return [];
  }
  try {
    return pages.map((pageNumber) => {
      const page = doc.loadPage(pageNumber - 1);
      const [x0, , x1] = page.getBounds();
      const scale = width / Math.max(1, x1 - x0);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      const jpeg = pixmap.asJPEG(80, false).slice();
      pixmap.destroy();
      page.destroy();
      return jpeg;
    });
  } finally {
    doc.destroy();
  }
}

/**
 * Re-save a damaged PDF through MuPDF's forgiving parser, with garbage
 * collection and stream cleanup. Used as the fallback repair strategy.
 */
export async function repairWithMupdf(bytes: Uint8Array): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf') as InstanceType<typeof mupdf.PDFDocument>;
  try {
    return doc.saveToBuffer('garbage=compact,clean=yes,compress=yes').asUint8Array().slice();
  } finally {
    doc.destroy();
  }
}

/** 1-based numbers of pages that already contain extractable text. */
export async function pagesWithText(bytes: Uint8Array): Promise<Set<number>> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const result = new Set<number>();
  try {
    const count = doc.countPages();
    for (let i = 0; i < count; i++) {
      const page = doc.loadPage(i);
      const text = page.toStructuredText("").asText();
      if (text.replace(/\s+/g, '').length > 20) result.add(i + 1);
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
  return result;
}

export interface RedactOptions {
  /** Boxes in fractions of the displayed page. */
  regions: { page: number; x: number; y: number; w: number; h: number }[];
  /** Text to find and redact on every page (case-insensitive). */
  terms: string[];
  blackBoxes: boolean;
  removeMetadata: boolean;
}

/** True redaction: removes text, image pixels and line art under each area. */
export async function redact(bytes: Uint8Array, options: RedactOptions): Promise<{ bytes: Uint8Array; count: number }> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf') as InstanceType<typeof mupdf.PDFDocument>;
  if (doc.needsPassword()) {
    doc.destroy();
    throw new Error('This PDF is password-protected. Unlock it first.');
  }
  let count = 0;
  try {
    const pageCount = doc.countPages();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i) as InstanceType<typeof mupdf.PDFPage>;
      const [bx0, by0, bx1, by1] = page.getBounds();
      const bw = bx1 - bx0;
      const bh = by1 - by0;
      const rects: [number, number, number, number][] = [];
      for (const r of options.regions.filter((r) => r.page === i + 1)) {
        rects.push([bx0 + r.x * bw, by0 + r.y * bh, bx0 + (r.x + r.w) * bw, by0 + (r.y + r.h) * bh]);
      }
      for (const term of options.terms) {
        for (const hit of page.search(term, '')) {
          for (const q of hit) {
            const xs = [q[0], q[2], q[4], q[6]];
            const ys = [q[1], q[3], q[5], q[7]];
            rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
          }
        }
      }
      for (const rect of rects) {
        const annot = page.createAnnotation('Redact');
        annot.setRect(rect);
        count++;
      }
      if (rects.length) {
        page.applyRedactions(
          options.blackBoxes,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE,
        );
      }
      page.destroy();
    }
    if (options.removeMetadata) {
      const trailer = doc.getTrailer();
      trailer.delete('Info');
      doc.getTrailer().get('Root').delete('Metadata');
    }
    const out = doc.saveToBuffer('garbage=compact,compress=yes').asUint8Array().slice();
    return { bytes: out, count };
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// Comparing two PDFs
// ---------------------------------------------------------------------------

/** Plain text of every page, in reading order. */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    return Array.from({ length: doc.countPages() }, (_, i) => {
      const page = doc.loadPage(i);
      const text = page.toStructuredText('').asText();
      page.destroy();
      return text;
    });
  } finally {
    doc.destroy();
  }
}

export interface VisualDiff {
  width: number;
  height: number;
  /** Share of pixels that differ, 0–1. */
  changed: number;
  /** Number of pixels that differ. */
  changedPixels: number;
  /** Both pages rendered at the same pixel size (PNG), when requested. */
  before?: Uint8Array;
  after?: Uint8Array;
  /** The "after" page faded to grey, removed ink in red, added ink in green (PNG). */
  diff?: Uint8Array;
}

/**
 * Pixel comparison of page `pageA` of `a` with page `pageB` of `b`, both
 * rendered `width` pixels wide (page B is stretched to page A's size if they
 * differ). With `images: false` only the changed share is computed, which is
 * cheap enough to scan every page at thumbnail size.
 */
export async function visualDiff(a: Uint8Array, b: Uint8Array, pageA: number, pageB: number, width: number, images = true): Promise<VisualDiff> {
  const mupdf = await loadMupdf();
  const docA = mupdf.Document.openDocument(a, 'application/pdf');
  const docB = mupdf.Document.openDocument(b, 'application/pdf');
  try {
    const pa = docA.loadPage(pageA - 1);
    const pb = docB.loadPage(pageB - 1);
    const [ax0, ay0, ax1, ay1] = pa.getBounds();
    const [bx0, by0, bx1, by1] = pb.getBounds();
    const scale = width / (ax1 - ax0);
    const height = Math.max(1, Math.round((ay1 - ay0) * scale));
    const render = (page: typeof pa, sx: number, sy: number) => {
      const pix = page.toPixmap([sx, 0, 0, sy, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
      return pix;
    };
    const pixA = render(pa, scale, scale);
    const pixB = render(pb, width / (bx1 - bx0), height / (by1 - by0));
    const w = Math.min(pixA.getWidth(), pixB.getWidth());
    const h = Math.min(pixA.getHeight(), pixB.getHeight());
    const sa = pixA.getPixels();
    const sb = pixB.getPixels();
    const strideA = pixA.getStride();
    const strideB = pixB.getStride();

    const out = images ? new Uint8ClampedArray(w * h * 3) : null;
    let changed = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * strideA + x * 3;
        const j = y * strideB + x * 3;
        const d = Math.max(Math.abs(sa[i] - sb[j]), Math.abs(sa[i + 1] - sb[j + 1]), Math.abs(sa[i + 2] - sb[j + 2]));
        // Small differences are anti-aliasing noise, not changes.
        const isChanged = d > 64;
        if (isChanged) changed++;
        if (!out) continue;
        const o = (y * w + x) * 3;
        const lumA = sa[i] * 0.3 + sa[i + 1] * 0.59 + sa[i + 2] * 0.11;
        const lumB = sb[j] * 0.3 + sb[j + 1] * 0.59 + sb[j + 2] * 0.11;
        if (isChanged) {
          // Darker before = ink that disappeared (red); darker after = new ink (green).
          const [r, g, bl] = lumA < lumB ? [220, 38, 38] : [22, 163, 74];
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = bl;
        } else {
          const v = 255 - (255 - lumB) * 0.3;
          out[o] = out[o + 1] = out[o + 2] = v;
        }
      }
    }

    const result: VisualDiff = { width: w, height: h, changed: changed / (w * h), changedPixels: changed };
    if (out) {
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
      const target = pix.getPixels();
      const stride = pix.getStride();
      for (let y = 0; y < h; y++) target.set(out.subarray(y * w * 3, (y + 1) * w * 3), y * stride);
      result.diff = pix.asPNG().slice();
      result.before = pixA.asPNG().slice();
      result.after = pixB.asPNG().slice();
      pix.destroy();
    }
    pixA.destroy();
    pixB.destroy();
    pa.destroy();
    pb.destroy();
    return result;
  } finally {
    docA.destroy();
    docB.destroy();
  }
}
