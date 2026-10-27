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
- PDF/A: `-dPDFA=1|2|3 -dPDFACompatibilityPolicy=1` plus a `PDFA_def.ps`
  prelude (written into Ghostscript's virtual filesystem) that attaches the
  sRGB (or sGray) output intent from Ghostscript's built-in `%rom%`
  ICC profiles. Not validated in the browser (veraPDF is Java).

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

## Tesseract.js (`ocr.ts`)
- Worker and WASM cores are served from `/vendor/tesseract` (copied by the
  `vendorFiles` plugin in `vite.config.ts`); the worker picks the SIMD core
  the CPU supports.
- LSTM-only "best_int" models. English is bundled; other languages load from
  jsDelivr once and are cached in IndexedDB.
- OCR PDF uses the OCRmyPDF "sandwich": MuPDF renders the page at 300 dpi,
  Tesseract produces a text-only PDF page (invisible text in a glyph-less
  font, so every script works), and pdf-lib overlays it on the original page.
  The page itself is never re-encoded.

## Editing text (`text-edit.ts`)
- Reading: MuPDF's structured-text walker gives each character's font, size,
  colour and box. Lines are split at wide gaps (table cells, columns); a mixed
  line takes the style most of its letters have. Vertical and rotated text
  isn't offered for editing.
- Saving: each changed line is erased with a text-only redaction (images,
  shapes and backgrounds underneath stay), shrunk a little vertically so tight
  neighbouring lines survive. New text is appended to the page content as real
  text (`Tm` + `TJ`), mapped through the inverse page transform so rotated or
  offset pages work, after wrapping the old content in `q`/`Q`.
- Fonts: the line's own font is reused (embedded as an Identity-H font) only
  when its character map is trustworthy (the widths its glyphs report match
  how the page drew them) and every typed letter has a glyph that draws ink;
  subset fonts often keep a character map but empty unused glyphs. Otherwise
  the closest standard font: Helvetica/Times/Courier by reference
  (WinAnsi text, no embedding), MuPDF's built-in copies embedded for other
  Latin, Greek and Cyrillic (~35–45 KB), and MuPDF's CJK fonts by reference
  for Chinese, Japanese and Korean runs. Scripts that need shaping (Arabic,
  Hebrew, Indic, Thai…) are refused with a clear message.
- The editor previews changes over a render of the page with all text
  removed, so the background behind an edited line looks as it will in the file.

## MuPDF redaction (`mupdf.ts` → `redact`)
- Redact annotations are added for drawn boxes and text-search hits, then
  `applyRedactions` removes covered text, image pixels and line art.
- Covered images are rewritten losslessly, so redacting over a photo can
  make the file larger.

## Image editing (`image.ts`)
- `adjust`: brightness, contrast, shadows/highlights, warmth, saturation,
  filter and vignette in one pass, in that order.
- `downscale`: fast browser resampling for live previews only.
- Remove photo info strips JPEG APPn/COM segments and PNG text/EXIF chunks
  without touching pixels; EXIF-rotated JPEGs are rotated upright first.

## Digital signatures (`signing.ts`)

Certificate signing uses [node-forge](https://github.com/digitalbazaar/forge) for the
PKCS#12 digital ID and the CMS (PKCS#7) signature, and pdf-lib to write the signature
field. The PDF is saved with a fixed-size `/Contents` placeholder, the `/ByteRange`
is filled in, the covered bytes are hashed with SHA-256, and the detached
`adbe.pkcs7.detached` signature is written into the placeholder. A new self-signed
ID uses a WebCrypto RSA-2048 key and is returned as a password-protected .p12.

Only signing happens here; verification is left to the reader's PDF viewer
(node-forge's known verification issues don't apply). Signing re-saves the file, so
any earlier signatures stop validating; the action warns when the input had some.
Output was checked with pyHanko: intact, valid, coverage of the entire file.

## AI models (`onnx.ts`, `ai-image.ts`)

ONNX Runtime Web runs the models, on the GPU through WebGPU when the browser
offers it and on the CPU (WASM, multi-threaded when cross-origin isolated)
otherwise. Models are served from `/vendor/models/`, downloaded on first use with
progress, and stored in Cache Storage (`formatter-models-v1`), so later runs are
offline. Each job's worker loads a model once and reuses it for every file.

- **Remove background**: BRIA RMBG-1.4, 8-bit quantised (npm `@rmbg/model-briaai`,
  five 9 MB parts). The image is squeezed to 1024 × 1024, the predicted matte is
  stretched to 0–1 and resized back with bilinear filtering, then used as alpha.
  "Edge cleanup" ramps the matte to drop a faint fringe. In a side-by-side test
  against IS-Net (imgly's model, 44 and 88 MB variants) RMBG kept whole subjects
  where IS-Net left parts semi-transparent. RMBG-1.4 is licensed for
  non-commercial use only (CC BY-NC 4.0).
- **Upscale**: Real-ESRGAN `realesr-general-x4v3` blended 50/50 with its
  denoising twin, converted to ONNX by `tools/convert-realesrgan.py` and committed
  as `models/realesr-general-x4.onnx` (5 MB). It runs on 192 px tiles with 12 px
  of overlap that is discarded, so seams don't show and memory stays flat.
  2× and 3× shrink the 4× result with Lanczos. Transparency is enlarged with
  Lanczos since the model only sees colour. Results over 80 MP are refused.
