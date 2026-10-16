# Engines

Each engine has one wrapper in `src/engines/`. Actions call wrappers, never the
libraries directly, so swapping an engine touches one file.

## qpdf (`qpdf.ts`)
- qpdf 12 compiled to WASM (`@neslinesli93/qpdf-wasm`). One instance per worker, reused.
- Lossless: rewrites structure without re-rendering, so text, links and forms survive.
- Errors are captured from qpdf's output and translated (`friendlyMessage`).

## MuPDF (`mupdf.ts`)
- `mupdf` npm package (official Artifex build).
- Renders with `Matrix.scale(dpi / 72)`; thumbnails are JPEG q80 at a fixed width.
- Defaults for PDF → image: JPG, 150 dpi, q90 (presets for print at 300 dpi PNG).

## Ghostscript (`ghostscript.ts`)
- `@bentopdf/gs-wasm`; glue script and wasm are bundled as assets via the
  `gs-wasm-assets` alias in `vite.config.ts`.
- New instance per run (Ghostscript keeps global state).
- Compression levels map to `PDFSETTINGS` plus explicit image resolution:
  light 300 dpi, recommended 150 dpi, strong 96 dpi, extreme 72 dpi.
  Images are only downsampled when more than 1.5× the target, to avoid
  degrading images that are already about the right size.
- Followed by a lossless qpdf pass (object streams, Flate level 9).

## Image (`image.ts`)
- Decode: browser `createImageBitmap` (honours EXIF orientation).
- Encode: MozJPEG (progressive), libwebp, libavif (speed 6), OxiPNG.
- Resize: jSquash resize, Lanczos3 in linear light with premultiplied alpha.
- Default qualities: compress 75 (presets 88 / 75 / 55), convert WebP 80,
  AVIF 60, JPG 85, resize/rotate output 90–92.

## pdf-lib (`pdflib.ts`)
- Watermark text is vector (Helvetica), drawn over the page with opacity.
- Images → PDF embeds JPEG/PNG bytes unchanged; other formats are converted.
  EXIF-rotated or CMYK JPEGs are re-encoded upright as RGB.
