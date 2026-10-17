/**
 * Neural-network engine: runs ONNX models in the browser.
 *
 * Source:  ONNX Runtime Web (MIT). Uses WebGPU when the browser has it, which
 *          is many times faster, and falls back to multi-threaded WASM on the
 *          CPU. Vite bundles the runtime's WASM like any other asset.
 * Models are served from /vendor/models (see vite.config.ts), split into
 * chunks under GitHub Pages' size limits where needed. They download on first
 * use and are kept in the browser's Cache Storage, so later runs work offline.
 */
import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { vendorUrl } from './vendor';

export interface ModelSpec {
  /** Cache key; change it when the model files change. */
  id: string;
  /** File names under /vendor/models/, joined in order. */
  files: string[];
  /** Total size in bytes, for download progress. */
  size: number;
}

export type ProgressFn = (fraction: number, message: string) => void;

const CACHE = 'formatter-models-v1';

let ortPromise: Promise<typeof import('onnxruntime-web')> | null = null;

async function runtime() {
  ortPromise ??= import('onnxruntime-web').then((ort) => {
    // Threads need cross-origin isolation; without it ORT runs single-threaded.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1;
    ort.env.logLevel = 'error';
    return ort;
  });
  return ortPromise;
}

/** Download a model (or read it from the cache), reporting progress. */
async function modelBytes(spec: ModelSpec, onProgress?: ProgressFn): Promise<Uint8Array> {
  const key = vendorUrl(`models/${spec.id}`);
  const cache = await caches?.open(CACHE).catch(() => undefined);
  const hit = await cache?.match(key);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const out = new Uint8Array(spec.size);
  let offset = 0;
  const mb = (n: number) => (n / 1e6).toFixed(0);
  for (const file of spec.files) {
    const response = await fetch(vendorUrl(`models/${file}`));
    if (!response.ok || !response.body) throw new Error(`Couldn't download the AI model (${response.status}). Check your connection and try again.`);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, offset);
      offset += value.length;
      onProgress?.(offset / spec.size, `Downloading AI model, ${mb(offset)} of ${mb(spec.size)} MB (first time only)`);
    }
  }
  if (offset !== spec.size) throw new Error('The AI model download was incomplete. Try again.');
  await cache?.put(key, new Response(out)).catch(() => {});
  return out;
}

const sessions = new Map<string, Promise<InferenceSession>>();

/** Load a model once per worker. WebGPU first, CPU (WASM) as fallback. */
export function loadModel(spec: ModelSpec, onProgress?: ProgressFn): Promise<InferenceSession> {
  let session = sessions.get(spec.id);
  if (!session) {
    session = (async () => {
      const ort = await runtime();
      const bytes = await modelBytes(spec, onProgress);
      onProgress?.(1, 'Starting AI model');
      const gpu = 'gpu' in navigator && (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
      if (gpu) {
        try {
          return await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
        } catch {
          // Some GPUs or drivers lack an operator; the CPU always works.
        }
      }
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    })();
    session.catch(() => sessions.delete(spec.id));
    sessions.set(spec.id, session);
  }
  return session;
}

/** Run a single-input, single-output model on a float32 NCHW tensor. */
export async function infer(session: InferenceSession, data: Float32Array, dims: number[]): Promise<{ data: Float32Array; dims: readonly number[] }> {
  const ort = await runtime();
  const input = new ort.Tensor('float32', data, dims);
  const results = await session.run({ [session.inputNames[0]]: input });
  const output = results[session.outputNames[0]] as Tensor;
  const out = { data: (await output.getData()) as Float32Array, dims: output.dims };
  input.dispose();
  for (const t of Object.values(results)) t.dispose();
  return out;
}
