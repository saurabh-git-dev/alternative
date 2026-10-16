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
