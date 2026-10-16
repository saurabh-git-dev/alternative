/**
 * qpdf engine: lossless PDF structure operations.
 *
 * Source:  qpdf 12 compiled to WASM (@neslinesli93/qpdf-wasm, Apache-2.0), ~1.3 MB.
 * Used for: merge, split, organize, rotate, encrypt, decrypt, stream optimisation.
 * Why qpdf: it rewrites PDFs without re-rendering anything, so text, fonts,
 * links and form fields survive untouched, and it repairs damaged files on the way.
 *
 * One WASM instance is created per worker and reused; `callMain` can be invoked
 * repeatedly. Files are exchanged through Emscripten's in-memory filesystem.
 */
import createModule from '@neslinesli93/qpdf-wasm';
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';

type QpdfInstance = Awaited<ReturnType<typeof createModule>>;

let instance: Promise<QpdfInstance> | null = null;
let jobCounter = 0;
/** Collects qpdf's diagnostics while a command runs; null otherwise. */
let sink: string[] | null = null;

function load(): Promise<QpdfInstance> {
  if (!instance) {
    // The module binds console.error once at creation and ignores `printErr`,
    // so route console.error through a sink before creating it.
    const original = console.error.bind(console);
    console.error = (...parts: unknown[]) => (sink ? sink.push(parts.join(' ')) : original(...parts));
    instance = createModule({ locateFile: () => wasmUrl, noInitialRun: true } as never);
  }
  return instance;
}

/** Error raised when qpdf exits with a failure; `message` holds qpdf's own output. */
export class QpdfError extends Error {}

export interface QpdfJob {
  /** Input files, referenced in `args` by the placeholders `{in0}`, `{in1}`, … */
  inputs: Uint8Array[];
  /** qpdf command-line arguments. Use `{out}` (or `{out0}`, `{out1}` …) for outputs. */
  args: string[];
  /** Number of output files the arguments produce. Default 1. */
  outputs?: number;
}

/**
 * Run one qpdf command and return its output file(s).
 * Exit code 3 ("succeeded with warnings") is treated as success, as qpdf intends.
 */
export async function runQpdf(job: QpdfJob): Promise<Uint8Array[]> {
  const qpdf = await load();
  const dir = `/job${++jobCounter}`;
  qpdf.FS.mkdir(dir);

  const inPaths = job.inputs.map((bytes, i) => {
    const path = `${dir}/in${i}.pdf`;
    (qpdf.FS as unknown as { writeFile(p: string, d: Uint8Array): void }).writeFile(path, bytes);
    return path;
  });
  const outCount = job.outputs ?? 1;
  const outPaths = Array.from({ length: outCount }, (_, i) => `${dir}/out${i}.pdf`);

  const args = job.args.map((arg) =>
    arg
      .replace(/\{in(\d+)\}/g, (_, i) => inPaths[Number(i)])
      .replace(/\{out(\d*)\}/g, (_, i) => outPaths[Number(i || 0)]),
  );

  // Capture diagnostics so failures can be shown to the user in plain words.
  const messages: string[] = [];
  sink = messages;
  let code: number;
  try {
    code = qpdf.callMain(args);
  } finally {
    sink = null;
  }

  try {
    if (code !== 0 && code !== 3) throw new QpdfError(friendlyMessage(messages.join('\n')));
    return outPaths.map((p) => qpdf.FS.readFile(p));
  } finally {
    cleanup(qpdf, dir);
  }
}

function cleanup(qpdf: QpdfInstance, dir: string): void {
  const fs = qpdf.FS as unknown as { readdir(p: string): string[]; unlink(p: string): void; rmdir(p: string): void };
  try {
    for (const name of fs.readdir(dir)) if (name !== '.' && name !== '..') fs.unlink(`${dir}/${name}`);
    fs.rmdir(dir);
  } catch {
    /* best effort: the worker's memory is reclaimed when it is terminated anyway */
  }
}

/** Translate common qpdf errors into language a non-technical user understands. */
function friendlyMessage(raw: string): string {
  if (/invalid password/i.test(raw)) return 'The password is incorrect.';
  if (/not a PDF file|can't find PDF header/i.test(raw)) return "This file doesn't look like a PDF.";
  return raw.replace(/^[^:]*:\s*\/job\d+\/in\d+\.pdf:\s*/gm, '').trim() || 'qpdf could not process this file.';
}
