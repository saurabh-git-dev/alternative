/**
 * OCR engine: recognise text in images.
 *
 * Source:  Tesseract.js 7 (Apache-2.0), LSTM engine. The worker and WASM core
 *          are served from /vendor/tesseract (see vite.config.ts).
 * Language data ("best_int" models, 2–4 MB each): English is bundled with the
 * app; other languages are downloaded from jsDelivr the first time they are
 * used and then cached in the browser (IndexedDB), so later runs work offline.
 */
import type { Worker as TesseractWorker } from 'tesseract.js';

export interface OcrWord {
  text: string;
  /** Pixel bounding box in the recognised image. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
  /** Mean word confidence 0–100. */
  confidence: number;
}

const VENDOR = new URL(`${import.meta.env.BASE_URL}vendor/tesseract/`, appRoot()).href;

/** The app's root URL, valid from both the page and module workers. */
function appRoot(): string {
  // Workers live under /assets/ in the build and /src/core/ in dev.
  const here = self.location.href;
  const cut = here.search(/\/(assets|src)\//);
  return cut >= 0 ? here.slice(0, cut + 1) : new URL('./', here).href;
}

/** Languages served from /vendor/tesseract/lang (see vite.config.ts). */
const BUNDLED_LANGUAGES = new Set(['eng']);

let current: { langs: string; worker: Promise<TesseractWorker> } | null = null;

async function getWorker(langs: string[], onProgress?: (fraction: number, message: string) => void): Promise<TesseractWorker> {
  const key = langs.join('+');
  if (current?.langs === key) return current.worker;
  if (current) (await current.worker).terminate();
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = createWorker(key, OEM.LSTM_ONLY, {
    workerPath: `${VENDOR}worker.min.js`,
    corePath: VENDOR,
    // Undefined means Tesseract's default per-language jsDelivr URL.
    langPath: langs.every((l) => BUNDLED_LANGUAGES.has(l)) ? `${VENDOR}lang` : undefined,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status.includes('loading') || m.status.includes('initializ')) {
        onProgress?.(m.progress, m.status.includes('language') ? 'Downloading language data (first time only)' : 'Starting OCR engine');
      }
    },
  });
  current = { langs: key, worker };
  return worker;
}

export interface RecognizeOptions {
  /** Also return a PDF: the image with an invisible, searchable text layer. */
  pdf?: boolean;
  /** With `pdf`: only the invisible text layer, to overlay on an existing page. */
  pdfTextOnly?: boolean;
  onProgress?: (fraction: number, message: string) => void;
}

/** Recognise text in an image (any browser-decodable format, or a canvas). */
export async function recognize(
  image: Blob | OffscreenCanvas | ImageData,
  langs: string[],
  options: RecognizeOptions = {},
): Promise<OcrResult & { pdf?: Uint8Array }> {
  const worker = await getWorker(langs, options.onProgress);
  const input = image instanceof ImageData ? await toBlob(image) : image instanceof OffscreenCanvas ? await image.convertToBlob() : image;
  const { data } = await worker.recognize(
    input,
    { pdfTitle: 'OCR', pdfTextOnly: options.pdfTextOnly ?? false },
    { text: true, blocks: true, pdf: options.pdf ?? false },
  );
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          if (w.text.trim()) words.push({ text: w.text, ...w.bbox, confidence: w.confidence });
        }
      }
    }
  }
  const confidence = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
  const pdf = data.pdf ? new Uint8Array(data.pdf) : undefined;
  return { text: data.text, words, confidence, pdf };
}

async function toBlob(image: ImageData): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
