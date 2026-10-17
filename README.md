# Tools

PDF, image and video tools, a screen recorder, and developer (IT) tools, that
run entirely in your browser. Files are processed on your device with
WebAssembly engines and the browser's own codecs, and are never uploaded.

## Tools

| Area | Tools |
|---|---|
| Organize PDF | Merge, Split, Organize pages (reorder/rotate/delete), Rotate |
| Optimize PDF | Compress, Repair, Fast web view |
| Convert PDF | PDF → JPG/PNG, Images → PDF, OCR (make scanned PDFs searchable), PDF → PDF/A (archival) |
| Edit PDF | Annotate (text, highlight, pen, shapes, arrows, white-out, comments), Sign, Fill forms, Watermark, Page numbers, Metadata, Compare two PDFs (text and visual) |
| PDF security | Protect (AES-256), Unlock, Redact (true removal), Digitally sign (certificate, .p12/.pfx) |
| Images | Compress, Resize, Crop, Remove background (AI), Upscale 2–4× (AI), Convert, Photo editor, Rotate, Watermark, Remove photo info, Image → text (OCR) |
| Automate | Pipelines: chain tools and run them in one go, with ready-made recipes |
| Share | Share as link or QR code: any small file, or pasted text, CSV or JSON, packed into the link itself. Send to / get files from your phone: any size, either way, over a lasting end-to-end encrypted connection, with previews and an in-app QR scanner |

### Video (`video/`)

| Area | Tools |
|---|---|
| Edit | Trim (exact or instant), Crop (16:9, 9:16, 1:1 …), Blur or hide area (blur, pixelate or solid box, with time spans), Rotate or flip |
| Compress & convert | Compress (by quality or target size), Resize, Convert (MP4, WebM, MOV, from AVI, MKV, WMV …), Remove audio |
| Export | Video to GIF, Extract audio (MP3, M4A, WAV, Ogg), Save a frame |

WebCodecs (hardware encoders, no download) does the work, with ffmpeg.wasm
as an automatic fallback for other formats and browsers. See
[docs/video.md](docs/video.md).

### Screen recorder (`record/`)

Record your screen, camera and microphone like Loom: screen + camera bubble,
screen only or camera only, computer sound, pause/resume. Recordings are
saved in the browser as they're made (a crash loses at most a second), and
can be watched, renamed, shared to another device, downloaded, edited in the
video tools or deleted later. See [docs/screen-recorder.md](docs/screen-recorder.md).

### IT tools (`it/`)

An [IT-Tools](https://github.com/CorentinTh/it-tools)-style set of developer
utilities, linked from the header switch on every page:

| Area | Tools |
|---|---|
| Crypto & secrets | Password & token generator, UUID v4/v7 & ULID, Hash text (MD5, SHA-1/256/384/512), File checksum, HMAC, Encrypt text (AES-256) |
| Converters | Base64, Date & time, Number bases, Colors, JSON ↔ YAML, JSON ↔ CSV, Case, Text ↔ binary, Unicode escape, Roman numerals, NATO alphabet |
| Web & network | URL encode/decode, URL parser, HTML entities, JWT decoder, QR code (text, links, Wi-Fi), IPv4 subnets, HTTP status codes, Device info |
| Development | JSON formatter, Regex tester, Text diff, Cron explainer, Chmod calculator |
| Text | Text statistics, Slugify, Lorem ipsum |

Every output can be copied, saved, or shared to your phone (QR code when it
fits, direct encrypted transfer when it doesn't), and most tools can copy a
link that reopens them with the same input.

Every tool opens with recommended settings. Presets cover the common cases,
and an **Advanced settings** drawer exposes every parameter. Your last-used
settings are remembered per tool (passwords never are).

Everything works on phones too. Tools that download large engines or need a
lot of memory (AI background removal and upscaling, OCR, Ghostscript
compression, video re-encoding) show a heads-up on phones and low-memory
computers, and use safer limits there. Phone browsers can't record the
screen, so the recorder offers the camera there.

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
| [ONNX Runtime Web](https://onnxruntime.ai/) | runs the AI models (WebGPU, or WASM on the CPU) | MIT | 22 MB |
| [BRIA RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) | background removal model | CC BY-NC 4.0 (non-commercial) | 44 MB |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) general x4v3 | upscaling model | BSD-3-Clause | 5 MB |
| [Mediabunny](https://mediabunny.dev) (WebCodecs) | video reading, writing and conversion with the browser's own codecs | MPL-2.0 | 0.5 MB |
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) core | video fallback: other formats, codecs and browsers | GPL-2.0-or-later | 32 MB |
| [gifenc](https://github.com/mattdesl/gifenc) | GIF encoding | MIT | 9 KB |
| [LAME](https://lame.sourceforge.io/) via `@mediabunny/mp3-encoder` | MP3 for Extract audio | LGPL (LAME), MPL-2.0 | 0.3 MB |

Engines load only when a tool needs them and are cached by the browser after.
English OCR data ships with the app; other OCR languages are fetched once from
jsDelivr when first used, then cached.

## Documentation

- [Architecture](docs/architecture.md): how actions, the runner, workers and the UI fit together
- [Adding a tool](docs/adding-a-tool.md): step-by-step guide
- [Engines](docs/engines.md): what each engine does, defaults, and why
- [Pipelines](docs/pipelines.md): chaining tools, type checks, recipes
- [Share links](docs/share-links.md): the link and QR formats, their size limits, and direct transfers for big files
- [IT tools](docs/it-tools.md): the `it/` section, how sharing fits in, adding a tool
- [Video](docs/video.md): the `video/` section, WebCodecs and ffmpeg.wasm, defaults
- [Screen recorder](docs/screen-recorder.md): recording, storage in the browser, the library

## License

AGPL-3.0-or-later, because MuPDF and Ghostscript are AGPL.
