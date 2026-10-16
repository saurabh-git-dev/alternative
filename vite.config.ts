import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

/**
 * Cross-origin isolation lets WASM engines use threads (SharedArrayBuffer),
 * e.g. multi-threaded oxipng. Any static host must send the same two headers.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      // gs-wasm doesn't export its asset folder; reach it by path so Vite can bundle the files.
      'gs-wasm-assets': fileURLToPath(new URL('./node_modules/@bentopdf/gs-wasm/assets', import.meta.url)),
    },
  },
  base: './',
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  // WASM packages locate their .wasm files relative to import.meta.url,
  // which breaks if Vite pre-bundles them.
  optimizeDeps: {
    exclude: [
      'mupdf',
      '@jsquash/jpeg',
      '@jsquash/webp',
      '@jsquash/avif',
      '@jsquash/png',
      '@jsquash/oxipng',
      '@jsquash/resize',
    ],
  },
});
