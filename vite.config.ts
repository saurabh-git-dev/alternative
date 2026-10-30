import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The version shown in the footer. Release builds pass the version the
 * release workflow picked (APP_VERSION); local builds use package.json's.
 */
const appVersion = process.env.APP_VERSION || pkg.version;

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
 * Writes the service worker (src/pwa/sw.js) to sw.js at the site root, with
 * the list of files to cache on install. That's everything under 1 MB (pages,
 * scripts, styles, small engines); bigger engines and the AI models are cached
 * on first use instead, so the first visit stays light.
 */
const PRECACHE_MAX_BYTES = 1024 * 1024;

function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'formatter-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else files.push(relative(outDir, path).split(sep).join('/'));
        }
      };
      walk(outDir);
      const hash = createHash('sha256');
      const precache: string[] = [];
      for (const file of files.sort()) {
        const size = statSync(join(outDir, file)).size;
        hash.update(`${file}:${size}\n`);
        if (file === 'sw.js' || file.startsWith('vendor/models/') || size > PRECACHE_MAX_BYTES) continue;
        hash.update(readFileSync(join(outDir, file)));
        // Pages are cached under the URL people open: video/ rather than video/index.html.
        precache.push(file === 'index.html' ? './' : file.replace(/(^|\/)index\.html$/, '$1'));
      }
      const source = readFileSync(fileURLToPath(new URL('./src/pwa/sw.js', import.meta.url)), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__PRECACHE__', JSON.stringify(precache));
      writeFileSync(join(outDir, 'sw.js'), source);
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
  plugins: [svelte(), vendorFiles(), serviceWorker()],
  resolve: {
    alias: {
      // gs-wasm doesn't export its asset folder; reach it by path so Vite can bundle the files.
      'gs-wasm-assets': nodeModules('@bentopdf/gs-wasm/assets'),
    },
  },
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  base: './',
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Six pages, one app: the Dashboard at the root, then pdf/, image/, video/, record/ and it/ (see src/ui/section.ts).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        pdf: fileURLToPath(new URL('./pdf/index.html', import.meta.url)),
        image: fileURLToPath(new URL('./image/index.html', import.meta.url)),
        video: fileURLToPath(new URL('./video/index.html', import.meta.url)),
        record: fileURLToPath(new URL('./record/index.html', import.meta.url)),
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
      '@ffmpeg/core',
      '@jsquash/jpeg',
      '@jsquash/webp',
      '@jsquash/avif',
      '@jsquash/png',
      '@jsquash/oxipng',
      '@jsquash/resize',
    ],
  },
});
