# Formatter

PDF and image tools that run entirely in your browser. Files are processed on
your device with WebAssembly engines and are never uploaded.

## Tools

| Area | Tools |
|---|---|
| Organize PDF | Merge, Split, Organize pages (reorder/rotate/delete), Rotate |
| Optimize PDF | Compress, Repair, Fast web view |
| Convert PDF | PDF → JPG/PNG, Images → PDF, OCR (make scanned PDFs searchable) |
| Edit PDF | Sign, Fill forms, Watermark, Page numbers, Metadata |
| PDF security | Protect (AES-256), Unlock, Redact (true removal) |
| Images | Compress, Resize, Crop, Convert, Photo editor, Rotate, Watermark, Remove photo info, Image → text (OCR) |

Every tool opens with recommended settings. Presets cover the common cases,
and an **Advanced settings** drawer exposes every parameter. Your last-used
settings are remembered per tool (passwords never are).

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
npm run preview   # serve the build locally
npm test          # unit tests
npm run check     # type-check
```

Requires Node 20+.

### Hosting

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`
(enable it once under Settings → Pages → Source: GitHub Actions).

`dist/` is a static site that works from any sub-path, so any static host works. For full speed, the host
should send these headers (they enable multi-threaded WASM):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Cloudflare Pages and Netlify support this with a `_headers` file; everything
still works without them, just single-threaded.

## Engines

| Engine | Used for | License | Size |
|---|---|---|---|
| [qpdf](https://github.com/qpdf/qpdf) (WASM) | merge, split, organize, rotate, encrypt, decrypt | Apache-2.0 | 1.3 MB |
| [MuPDF.js](https://mupdf.readthedocs.io/) | page rendering, thumbnails, PDF info | AGPL-3.0 | 10 MB |
| [Ghostscript](https://www.ghostscript.com/) (WASM) | PDF compression | AGPL-3.0 | 15 MB |
| [pdf-lib](https://pdf-lib.js.org/) | watermark, images → PDF | MIT | 0.4 MB |
| [jSquash](https://github.com/jamsinclair/jSquash) (Squoosh codecs) | MozJPEG, WebP, AVIF, OxiPNG, resize | Apache-2.0 | per codec |
| [Tesseract.js](https://tesseract.projectnaptha.com/) | OCR for images and scanned PDFs | Apache-2.0 | 4 MB + 3 MB per language |

Engines load only when a tool needs them and are cached by the browser after.
English OCR data ships with the app; other OCR languages are fetched once from
jsDelivr when first used, then cached.

## Documentation

- [Architecture](docs/architecture.md): how actions, the runner, workers and the UI fit together
- [Adding a tool](docs/adding-a-tool.md): step-by-step guide
- [Engines](docs/engines.md): what each engine does, defaults, and why

## License

AGPL-3.0-or-later, because MuPDF and Ghostscript are AGPL.
