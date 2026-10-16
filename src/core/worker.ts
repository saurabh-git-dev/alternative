/**
 * Web Worker entry point. Every action and engine runs here, off the main
 * thread, so the UI stays responsive while WASM engines crunch files.
 *
 * The API is exposed with Comlink; see `runner.ts` for the main-thread side.
 */
import * as Comlink from 'comlink';
import { getAction } from '../actions';
import type { FileData, OutputFile, ParamValues } from './types';

export interface ProgressCallback {
  (fraction: number, message?: string): void;
}

const api = {
  /** Run an action on the given files. Output buffers are transferred back. */
  async run(actionId: string, files: FileData[], params: ParamValues, onProgress: ProgressCallback): Promise<OutputFile[]> {
    const action = getAction(actionId);
    if (!action) throw new Error(`Unknown tool: ${actionId}`);
    const outputs = await action.run(files, params, { progress: (f, m) => onProgress(f, m) });
    return Comlink.transfer(outputs, outputs.map((o) => o.bytes.buffer as ArrayBuffer));
  },

  /** Page count and encryption status of a PDF. */
  async inspectPdf(bytes: Uint8Array) {
    const { inspectPdf } = await import('../engines/mupdf');
    return inspectPdf(bytes);
  },

  /** JPEG thumbnails for the given 1-based pages. */
  async thumbnails(bytes: Uint8Array, pages: number[], width: number): Promise<Uint8Array[]> {
    const { renderThumbnails } = await import('../engines/mupdf');
    const thumbs = await renderThumbnails(bytes, pages, width);
    return Comlink.transfer(thumbs, thumbs.map((t) => t.buffer as ArrayBuffer));
  },
};

export type WorkerApi = typeof api;

Comlink.expose(api);
