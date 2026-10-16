/**
 * Office engine: convert Word, Excel, PowerPoint and OpenDocument files.
 *
 * Source:  LibreOffice compiled to WebAssembly (MPL-2.0), as packaged by
 *          BentoPDF (npm `@bentopdf/libreoffice-wasm`), served from
 *          /vendor/libreoffice (see vite.config.ts). It runs in its own
 *          worker with LibreOffice's headless conversion API (LibreOfficeKit).
 *          That worker is started from the page (the action sets
 *          `mainThread`) and kept for later jobs, so only the first file
 *          waits for LibreOffice to start.
 * Size:    about 78 MB to download (gzip), 250 MB once unpacked. It downloads
 *          on first use with progress and stays in Cache Storage afterwards.
 * Needs:   cross-origin isolation (SharedArrayBuffer), since LibreOffice runs
 *          several threads. The dev server sends the headers; on static hosts
 *          like GitHub Pages, public/coi-serviceworker.js adds them.
 *
 * LibreOffice opens PDFs only as drawings, so PDF → Word isn't possible here.
 */
import { vendorUrl } from './vendor';

export type ProgressFn = (fraction: number, message: string) => void;

/** Input extensions LibreOffice reads, by MIME type. */
export const OFFICE_TYPES: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
};

const CACHE = 'formatter-libreoffice-v1';
// Sizes of the gzip files, for download progress (npm package 2.3.1).
const PARTS = [
  { file: 'soffice.wasm.gz', size: 48763638 },
  { file: 'soffice.data.gz', size: 28604373 },
];

/**
 * Make sure both gzip parts are in Cache Storage, downloading with progress.
 * vendor-src/libreoffice-loader.js unpacks them inside LibreOffice's worker.
 */
async function download(onProgress: ProgressFn): Promise<void> {
  const cache = await caches?.open(CACHE).catch(() => undefined);
  const total = PARTS.reduce((n, p) => n + p.size, 0);
  let loaded = 0;
  for (const part of PARTS) {
    const url = vendorUrl(`libreoffice/${part.file}`);
    if (!cache || (await cache.match(url))) {
      // Without Cache Storage (some private windows) the loader fetches it itself.
      loaded += part.size;
      continue;
    }
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Couldn't download the Office converter (${response.status}). Check your connection and try again.`);
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(Math.min(loaded / total, 1) * 0.85, `Downloading the Office converter, ${(loaded / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB (first time only)`);
    }
    await cache.put(url, new Response(new Blob(chunks as BlobPart[]))).catch(() => {});
  }
}

interface WorkerReply {
  type: string;
  id?: number;
  error?: string;
  data?: Uint8Array;
  progress?: { percent?: number; message?: string };
}

let instance: Promise<(message: Record<string, unknown>, onProgress?: ProgressFn) => Promise<WorkerReply>> | null = null;

/** Start LibreOffice once per page. */
function start(onProgress: ProgressFn) {
  instance ??= (async () => {
    if (!self.crossOriginIsolated) {
      throw new Error('Office conversion needs a page reload to turn on multi-threading. Reload the page and try again.');
    }
    await download(onProgress);
    const worker = new Worker(vendorUrl('libreoffice/loader.js'));
    let failed: ((e: Error) => void)[] = [];
    worker.onerror = (e) => {
      e.preventDefault();
      for (const reject of failed) reject(new Error(`LibreOffice stopped: ${e.message || 'unknown error'}`));
    };
    let next = 1;
    const call = (message: Record<string, unknown>, progress?: ProgressFn) =>
      new Promise<WorkerReply>((resolve, reject) => {
        const id = next++;
        failed.push(reject);
        const listener = (e: MessageEvent<WorkerReply>) => {
          const reply = e.data;
          if (reply.id !== id) return;
          if (reply.type === 'progress') {
            if (reply.progress?.percent !== undefined) progress?.(reply.progress.percent / 100, reply.progress.message ?? 'Converting');
            return;
          }
          worker.removeEventListener('message', listener);
          failed = failed.filter((r) => r !== reject);
          if (reply.type === 'error') reject(new Error(reply.error || 'LibreOffice could not convert this file.'));
          else resolve(reply);
        };
        worker.addEventListener('message', listener);
        worker.postMessage({ ...message, id });
      });
    onProgress(0.88, 'Starting LibreOffice');
    await call({
      type: 'init',
      sofficeJs: vendorUrl('libreoffice/soffice.js'),
      sofficeWasm: vendorUrl('libreoffice/unpacked/soffice.wasm'),
      sofficeData: vendorUrl('libreoffice/unpacked/soffice.data'),
      sofficeWorkerJs: vendorUrl('libreoffice/soffice.worker.js'),
    });
    return call;
  })();
  instance.catch(() => (instance = null));
  return instance;
}

/**
 * Convert one document. `outputFormat` is a LibreOffice extension: pdf, docx,
 * odt, xlsx, csv, pptx… `password` opens protected documents.
 */
export async function convertDocument(
  bytes: Uint8Array,
  inputExt: string,
  outputFormat: string,
  options: { password?: string; onProgress?: ProgressFn } = {},
): Promise<Uint8Array> {
  const progress: ProgressFn = options.onProgress ?? (() => {});
  const call = await start((f, m) => progress(f * 0.7, m));
  const reply = await call(
    { type: 'convert', inputData: bytes, inputExt, outputFormat, password: options.password || undefined },
    (f, m) => progress(0.7 + f * 0.3, m),
  ).catch((e: Error) => {
    if (/password/i.test(e.message)) throw new Error('This document is password-protected. Enter its password under Advanced settings.');
    throw new Error(`LibreOffice couldn't convert this file: ${e.message}`);
  });
  return new Uint8Array(reply.data!);
}
