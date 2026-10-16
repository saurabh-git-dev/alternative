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

export function inspectPdf(bytes: Uint8Array) {
  return previewApi().inspectPdf(bytes.slice());
}

/** Object URLs for page thumbnails. Callers should revoke them when done. */
export async function pdfThumbnails(bytes: Uint8Array, pages: number[], width = 160): Promise<string[]> {
  const images = await previewApi().thumbnails(bytes.slice(), pages, width);
  return images.map((img) => URL.createObjectURL(new Blob([img as BlobPart], { type: 'image/jpeg' })));
}
