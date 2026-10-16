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
  const scale = options.dpi / 72;
  const alpha = options.format === 'png' && !!options.transparent;
  const results: Uint8Array[] = [];
  try {
    pages.forEach((pageNumber, index) => {
      const page = doc.loadPage(pageNumber - 1);
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
