/**
 * Main-thread job runner.
 *
 * - Jobs run in a dedicated worker; cancelling terminates that worker, which
 *   is the only reliable way to stop a WASM computation mid-flight.
 * - Previews (page counts, thumbnails) use a separate long-lived worker so
 *   they never queue behind a heavy job.
 */
import * as Comlink from 'comlink';
import type { WorkerApi } from './worker';
import type { ActionDefinition, FileData, OutputFile, ParamValues } from './types';

function spawn(): { worker: Worker; api: Comlink.Remote<WorkerApi> } {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return { worker, api: Comlink.wrap<WorkerApi>(worker) };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobProgress {
  /** Overall progress, 0–1. */
  fraction: number;
  message?: string;
}

export interface JobHandle {
  result: Promise<OutputFile[]>;
  cancel(): void;
}

/**
 * Run an action. In `each` mode files are processed one at a time and overall
 * progress is the average across files; outputs keep the input order.
 */
export function runAction(
  action: ActionDefinition,
  files: FileData[],
  params: ParamValues,
  onProgress: (p: JobProgress) => void,
): JobHandle {
  const { worker, api } = spawn();
  let cancelled = false;
  let rejectCancelled!: (e: Error) => void;
  const cancelledSignal = new Promise<never>((_, reject) => (rejectCancelled = reject));
  cancelledSignal.catch(() => {});

  const result = (async () => {
    try {
      const batches = action.mode === 'each' ? files.map((f) => [f]) : [files];
      const outputs: OutputFile[] = [];
      for (const [i, batch] of batches.entries()) {
        if (cancelled) throw new CancelledError();
        const label = batches.length > 1 ? `File ${i + 1} of ${batches.length}` : undefined;
        // Must return nothing: Comlink sends the return value back to the worker.
        const report = (fraction: number, message?: string): void => {
          onProgress({ fraction: (i + fraction) / batches.length, message: [label, message].filter(Boolean).join(' · ') });
        };
        report(0, 'Starting');
        // Copy before sending: the originals stay usable for re-runs.
        const copies = batch.map((f) => ({ ...f, bytes: f.bytes.slice() }));
        const out = await Promise.race([
          api.run(
            action.id,
            Comlink.transfer(copies, copies.map((c) => c.bytes.buffer as ArrayBuffer)),
            params,
            Comlink.proxy(report),
          ),
          cancelledSignal,
        ]);
        const inputSize = batch.reduce((sum, f) => sum + f.bytes.length, 0);
        for (const o of out) {
          o.inputSize = inputSize;
          if (action.mode === 'each') o.inputIndex = i;
        }
        outputs.push(...out);
      }
      onProgress({ fraction: 1 });
      return outputs;
    } finally {
      worker.terminate();
    }
  })();

  return {
    result,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      worker.terminate();
      // A terminated worker never answers, so settle the pending await ourselves.
      rejectCancelled(new CancelledError());
    },
  };
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

let preview: ReturnType<typeof spawn> | null = null;

function previewApi(): Comlink.Remote<WorkerApi> {
  preview ??= spawn();
  return preview.api;
}

export function inspectAction(actionId: string, file: FileData) {
  return previewApi().inspect(actionId, { ...file, bytes: file.bytes.slice() });
}

export function formFields(bytes: Uint8Array) {
  return previewApi().formFields(bytes.slice());
}

/**
 * Live preview runs in its own worker so a slow encode never delays
 * thumbnails. A newer request supersedes an older one still in flight.
 */
let livePreviewWorker: ReturnType<typeof spawn> | null = null;
let previewTicket = 0;

export async function livePreview(actionId: string, file: FileData, params: ParamValues, maxSize = 900): Promise<FileData | null> {
  const ticket = ++previewTicket;
  livePreviewWorker ??= spawn();
  const out = await livePreviewWorker.api.preview(actionId, { ...file, bytes: file.bytes.slice() }, params, maxSize);
  return ticket === previewTicket ? out : null;
}

export function inspectPdf(bytes: Uint8Array) {
  return previewApi().inspectPdf(bytes.slice());
}

/** Object URLs for page thumbnails. Callers should revoke them when done. */
export async function pdfThumbnails(bytes: Uint8Array, pages: number[], width = 160): Promise<string[]> {
  const images = await previewApi().thumbnails(bytes.slice(), pages, width);
  return images.map((img) => URL.createObjectURL(new Blob([img as BlobPart], { type: 'image/jpeg' })));
}

/** Shrink an image to at most `maxBytes` in a worker of its own (cancellable). */
export function fitImage(file: FileData, maxBytes: number, onProgress: (fraction: number) => void) {
  const { worker, api } = spawn();
  const report = (fraction: number): void => onProgress(fraction);
  const result = api.fitImage({ ...file, bytes: file.bytes.slice() }, maxBytes, Comlink.proxy(report)).finally(() => worker.terminate());
  return { result, cancel: () => worker.terminate() };
}

/** Rewrite a recording in a worker of its own (see WorkerApi.remuxVideo). The input bytes are handed over, not copied. */
export async function remuxVideo(file: FileData): Promise<FileData> {
  const { worker, api } = spawn();
  try {
    return await api.remuxVideo(Comlink.transfer(file, [file.bytes.buffer as ArrayBuffer]));
  } finally {
    worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Compare PDFs: a worker of its own, kept while the compare page is open
// ---------------------------------------------------------------------------

let compareWorker: ReturnType<typeof spawn> | null = null;

export function compareApi(): Comlink.Remote<WorkerApi> {
  compareWorker ??= spawn();
  return compareWorker.api;
}

/** Stop any comparison still running (e.g. when new files are chosen). */
export function resetCompare(): void {
  compareWorker?.worker.terminate();
  compareWorker = null;
}
