/**
 * Ghostscript engine: PDF re-distillation for compression, grayscale and PDF/A.
 *
 * Source:  Ghostscript compiled to WASM (@bentopdf/gs-wasm, AGPL-3.0), ~15 MB.
 * Used for: Compress PDF.
 * Why Ghostscript: its pdfwrite device re-encodes images at a target
 * resolution, subsets fonts and removes duplicates, which gives the best
 * size/quality trade-off of any open-source engine.
 *
 * The glue script and the .wasm are imported as asset URLs, so Vite copies
 * them into the build with hashed names and the browser caches them.
 * A fresh instance is created per run: Ghostscript keeps global state between
 * invocations, and the compiled WASM is cached so restarts are cheap.
 */
import gsScriptUrl from 'gs-wasm-assets/gs.js?url';
import gsWasmUrl from 'gs-wasm-assets/gs.wasm?url';
import type { GhostscriptModuleFactory } from '@bentopdf/gs-wasm';

let factory: Promise<GhostscriptModuleFactory> | null = null;

function loadFactory(): Promise<GhostscriptModuleFactory> {
  factory ??= import(/* @vite-ignore */ gsScriptUrl).then((m) => m.default as GhostscriptModuleFactory);
  return factory;
}

/** Run Ghostscript with the given arguments on one input PDF; returns the output file. */
export async function runGhostscript(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const log: string[] = [];
  const create = await loadFactory();
  const gs = await create({
    locateFile: (path: string) => (path.endsWith('.wasm') ? gsWasmUrl : path),
    print: (t: string) => log.push(t),
    printErr: (t: string) => log.push(t),
  } as never);
  gs.FS.writeFile('/input.pdf', input);
  const code = gs.callMain([
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-dQUIET',
    ...args,
    '-sOutputFile=/output.pdf',
    '/input.pdf',
  ]);
  if (code !== 0) {
    throw new Error(/password/i.test(log.join(' '))
      ? 'This PDF is password-protected. Unlock it first.'
      : `Ghostscript failed: ${log.slice(-3).join(' ') || `exit code ${code}`}`);
  }
  return gs.FS.readFile('/output.pdf');
}
