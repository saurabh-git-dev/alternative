import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const nodeModules = (path: string) => fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url));

/**
 * Engines that load their own files by URL at runtime (rather than through
 * imports) are served from /vendor/… in dev and emitted there in the build.
 * Tesseract's worker picks one of the core builds depending on CPU support.
 */
const VENDOR_FILES: Record<string, string> = {
  'vendor/tesseract/worker.min.js': nodeModules('tesseract.js/dist/worker.min.js'),
  'vendor/tesseract/tesseract-core-lstm.wasm.js': nodeModules('tesseract.js-core/tesseract-core-lstm.wasm.js'),
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js': nodeModules('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
  'vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js': nodeModules('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'),
  // English ships with the app so the most common case works fully offline;
  // other languages download from jsDelivr on first use (see src/engines/ocr.ts).
  'vendor/tesseract/lang/eng.traineddata.gz': nodeModules('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  // AI models for ONNX Runtime Web (src/engines/onnx.ts). RMBG-1.4 comes split
  // into 9 MB parts on npm, which also keeps each file small for static hosts.
  ...Object.fromEntries(
    [1, 2, 3, 4, 5].map((i) => [`vendor/models/rmbg-1.4/briaai-${i}.onnx`, nodeModules(`@rmbg/model-briaai/briaai-${i}.onnx`)]),
  ),
  // Converted from Real-ESRGAN's weights by tools/convert-realesrgan.py.
  'vendor/models/realesr-general-x4.onnx': fileURLToPath(new URL('./models/realesr-general-x4.onnx', import.meta.url)),
};

function vendorFiles(): Plugin {
  return {
    name: 'formatter-vendor-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0].replace(/^\//, '') ?? '';
        const source = VENDOR_FILES[path];
        if (!source) return next();
        res.setHeader('Content-Type', /\.m?js$/.test(path) ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.end(readFileSync(source));
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(VENDOR_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
      }
    },
  };
}

/**
 * Cross-origin isolation lets WASM engines use threads (SharedArrayBuffer),
 * e.g. multi-threaded oxipng. Any static host should send the same two
 * headers; everything still works single-threaded without them.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [svelte(), vendorFiles()],
  resolve: {
    alias: {
      // gs-wasm doesn't export its asset folder; reach it by path so Vite can bundle the files.
      'gs-wasm-assets': nodeModules('@bentopdf/gs-wasm/assets'),
    },
  },
  base: './',
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Two pages, one app: PDF & image tools at the root, IT tools at it/ (see src/ui/section.ts).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        it: fileURLToPath(new URL('./it/index.html', import.meta.url)),
      },
    },
  },
  // WASM packages locate their .wasm files relative to import.meta.url,
  // which breaks if Vite pre-bundles them.
  optimizeDeps: {
    exclude: [
      'mupdf',
      'onnxruntime-web',
      '@jsquash/jpeg',
      '@jsquash/webp',
      '@jsquash/avif',
      '@jsquash/png',
      '@jsquash/oxipng',
      '@jsquash/resize',
    ],
  },
});
