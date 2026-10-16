/**
 * Pipelines: several tools run one after another, each step's output files
 * feeding the next step, e.g. "photos → PDF → OCR → compress".
 *
 * A pipeline is plain data (action ids + parameter values), so it can be
 * saved, put in a link, and checked before running: `planTypes` works out
 * which file types reach each step and flags steps that can't accept them.
 *
 * Tools that need the user to work on the document itself (organize pages,
 * crop, redact, sign, fill forms) can't run unattended and are left out.
 */
import type { ActionDefinition, FileData, OutputFile, ParamValues } from './types';
import { ACTIONS, getAction } from '../actions';
import { isWorkspaceParam, initialValues, validate } from './params';
import { fromBase64Url, toBase64Url } from './share';

export interface PipelineStep {
  actionId: string;
  params: ParamValues;
}

export interface Pipeline {
  name: string;
  steps: PipelineStep[];
}

/** Actions that can run as a pipeline step. */
export const PIPELINE_ACTIONS: ActionDefinition[] = ACTIONS.filter(
  (a) => !Object.values(a.params).some(isWorkspaceParam),
);

export function canRunInPipeline(action: ActionDefinition): boolean {
  return PIPELINE_ACTIONS.includes(action);
}

/** Does an action accept this MIME type (`image/*` wildcards allowed)? */
export function acceptsType(action: ActionDefinition, type: string): boolean {
  return action.accepts.some((p) => (p.endsWith('/*') ? type.startsWith(p.slice(0, -1)) : p === type));
}

/** Type an image tool writes for an input type: same format when the codecs can encode it, else PNG. */
export function encodableImageType(type: string): string {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type) ? type : 'image/png';
}

/** Output type of one step for one input type. */
export function producedType(action: ActionDefinition, inputType: string, params: ParamValues): string {
  if (action.produces) return action.produces(inputType, params);
  return inputType.startsWith('image/') ? encodableImageType(inputType) : inputType;
}

export interface StepPlan {
  /** Types arriving at this step. */
  inputs: string[];
  /** Types it leaves for the next step. */
  outputs: string[];
  /** Arriving types this step can't take. */
  rejected: string[];
}

/** Follow file types through the pipeline, starting from the input types. */
export function planTypes(pipeline: Pipeline, inputTypes: string[]): StepPlan[] {
  let current = [...new Set(inputTypes)];
  return pipeline.steps.map((step) => {
    const action = getAction(step.actionId);
    if (!action) return { inputs: current, outputs: [], rejected: current };
    const rejected = current.filter((t) => !acceptsType(action, t));
    const outputs = [...new Set(current.filter((t) => !rejected.includes(t)).map((t) => producedType(action, t, step.params)))];
    const plan = { inputs: current, outputs, rejected };
    current = outputs;
    return plan;
  });
}

/** Problems that stop the pipeline from running, keyed by step index. */
export function pipelineErrors(pipeline: Pipeline, inputTypes: string[]): Map<number, string> {
  const errors = new Map<number, string>();
  const plans = inputTypes.length ? planTypes(pipeline, inputTypes) : [];
  pipeline.steps.forEach((step, i) => {
    const action = getAction(step.actionId);
    if (!action) return errors.set(i, 'This tool no longer exists. Remove the step.');
    const invalid = Object.values(validate(action, step.params));
    if (invalid.length) return errors.set(i, invalid[0]);
    const rejected = plans[i]?.rejected ?? [];
    if (rejected.length) errors.set(i, `${action.title} can't take ${rejected.map(typeLabel).join(' or ')} files from the step before.`);
  });
  return errors;
}

/** Short human name for a MIME type: "PDF", "JPG", "text". */
export function typeLabel(type: string): string {
  return (
    { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/avif': 'AVIF', 'text/plain': 'text' }[type] ??
    (type.startsWith('image/') ? `${type.slice(6).toUpperCase()} image` : type)
  );
}

export function newStep(action: ActionDefinition): PipelineStep {
  return { actionId: action.id, params: initialValues(action) };
}

/**
 * Run each step on the previous step's outputs. `runStep` is the job runner
 * (injected so this stays testable). Each output remembers which original
 * file it came from while steps go file by file, so the results page can
 * still show before/after sizes.
 */
export async function runPipeline(
  pipeline: Pipeline,
  files: FileData[],
  runStep: (action: ActionDefinition, files: FileData[], params: ParamValues, onProgress: (fraction: number, message?: string) => void) => Promise<OutputFile[]>,
  onProgress: (fraction: number, message: string) => void,
): Promise<OutputFile[]> {
  let current: OutputFile[] = files.map((f, i) => ({ ...f, inputIndex: i, inputSize: f.bytes.length }));
  const total = pipeline.steps.length;
  for (const [i, step] of pipeline.steps.entries()) {
    const action = getAction(step.actionId)!;
    const label = `Step ${i + 1} of ${total}: ${action.title}`;
    onProgress(i / total, label);
    const origins = current.map((f) => f.inputIndex);
    const out = await runStep(action, current, step.params, (f, m) => onProgress((i + f) / total, m ? `${label} · ${m}` : label));
    for (const o of out) {
      // In `each` mode the runner sets inputIndex to the position within this
      // step's inputs; map it back to the original file. `all` mode merges files.
      const origin = action.mode === 'each' && o.inputIndex !== undefined ? origins[o.inputIndex] : undefined;
      o.inputIndex = origin;
      o.inputSize = origin !== undefined ? files[origin].bytes.length : files.reduce((n, f) => n + f.bytes.length, 0);
    }
    current = out;
  }
  onProgress(1, 'Done');
  return current;
}

// ---------------------------------------------------------------------------
// Sharing and storage
// ---------------------------------------------------------------------------

/** Route for a pipeline carried in the link, e.g. `#/pipeline/<data>`. */
export const PIPELINE_ROUTE = '#/pipeline';

/** Pipeline as link-safe text. Passwords are never included. */
export function encodePipeline(pipeline: Pipeline): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(withoutSecrets(pipeline))));
}

export function decodePipeline(text: string): Pipeline | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(fromBase64Url(text))) as Pipeline;
    if (typeof value.name !== 'string' || !Array.isArray(value.steps)) return null;
    // Fill in parameters added to tools since the pipeline was saved.
    const steps = value.steps
      .map((s) => ({ s, action: getAction(s.actionId) }))
      .filter(({ action }) => action && canRunInPipeline(action))
      .map(({ s, action }) => ({ actionId: s.actionId, params: initialValues(action!, s.params) }));
    return { name: value.name, steps };
  } catch {
    return null;
  }
}

export function withoutSecrets(pipeline: Pipeline): Pipeline {
  return {
    name: pipeline.name,
    steps: pipeline.steps.map((step) => {
      const action = getAction(step.actionId);
      const params = { ...step.params };
      for (const [key, spec] of Object.entries(action?.params ?? {})) if (spec.kind === 'text' && spec.secret) params[key] = spec.default;
      return { actionId: step.actionId, params };
    }),
  };
}

/** Ready-made pipelines offered as starting points. */
export const RECIPES: { id: string; description: string; pipeline: () => Pipeline }[] = [
  {
    id: 'scans',
    description: 'Phone photos of paper become one small, searchable PDF.',
    pipeline: () => recipe('Scans to searchable PDF', ['pdf.from-images', 'pdf.ocr', 'pdf.compress']),
  },
  {
    id: 'web-photos',
    // Resizing re-encodes from pixels, which also drops location and camera info.
    description: 'Resize to 1920 px and compress. Location and camera info are dropped too.',
    pipeline: () => {
      const p = recipe('Photos for the web', ['image.resize', 'image.compress']);
      Object.assign(p.steps[0].params, { mode: 'longest', longest: 1920 });
      return p;
    },
  },
  {
    id: 'send-pdf',
    description: 'Compress, number the pages and add a password.',
    pipeline: () => recipe('Number, shrink and lock a PDF', ['pdf.compress', 'pdf.page-numbers', 'pdf.protect']),
  },
];

function recipe(name: string, ids: string[]): Pipeline {
  return { name, steps: ids.map((id) => newStep(getAction(id)!)) };
}
