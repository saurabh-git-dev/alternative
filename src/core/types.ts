/**
 * Core type definitions shared by every action, engine and UI component.
 *
 * The central idea: an action (a "tool" in the UI) is a plain object that
 * declares what it accepts, which parameters it has (with defaults), optional
 * presets, and a `run` function. The UI is generated from that declaration, so
 * adding a tool never needs bespoke form code.
 */

/** A file moving through the system. Bytes are transferred to workers zero-copy. */
export interface FileData {
  name: string;
  /** MIME type, e.g. `application/pdf` or `image/png`. */
  type: string;
  bytes: Uint8Array;
}

/** An output produced by an action, optionally with a human-readable note. */
export interface OutputFile extends FileData {
  /** Short message shown next to the result, e.g. "Already optimal, kept original". */
  note?: string;
  /** Size of the input(s) this output came from; set by the runner for before/after display. */
  inputSize?: number;
  /** Index of the input file this output came from (`each` mode only); set by the runner. */
  inputIndex?: number;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

interface ParamBase<T> {
  /** Label shown to the user. Plain language, no jargon. */
  label: string;
  /** One-sentence explanation, shown as a hint under the control. */
  help?: string;
  default: T;
  /** Advanced parameters live in the collapsible "Advanced" drawer. */
  advanced?: boolean;
  /** Hide the control unless this returns true for the current values. */
  visibleWhen?: (values: ParamValues) => boolean;
}

export interface EnumParam extends ParamBase<string> {
  kind: 'enum';
  options: { value: string; label: string; hint?: string }[];
  /** `segmented` renders buttons (best for ≤4 options), `select` a dropdown. */
  display?: 'segmented' | 'select';
}

export interface NumberParam extends ParamBase<number> {
  kind: 'number';
  min: number;
  max: number;
  step?: number;
  /** Unit suffix, e.g. `%`, `px`, `dpi`. */
  unit?: string;
  /** `slider` for bounded tweakables like quality, `input` for exact values. */
  display?: 'slider' | 'input';
}

export interface BooleanParam extends ParamBase<boolean> {
  kind: 'boolean';
}

export interface TextParam extends ParamBase<string> {
  kind: 'text';
  placeholder?: string;
  /** Renders a password field. */
  secret?: boolean;
  /** Return an error message for invalid input, or null if valid. */
  validate?: (value: string, values: ParamValues) => string | null;
}

export interface ColorParam extends ParamBase<string> {
  kind: 'color';
}

/** A 3×3 anchor grid (top-left … bottom-right). Value is e.g. `middle-center`. */
export interface PositionParam extends ParamBase<string> {
  kind: 'position';
}

/**
 * Page order editor: renders thumbnails the user can reorder, rotate and delete.
 * Value is a list of `{ page, rotate }` (1-based pages); empty means "unchanged".
 */
export interface PageOrderParam extends ParamBase<PageRef[]> {
  kind: 'pageOrder';
}

export interface PageRef {
  /** 1-based page number in the source document. */
  page: number;
  /** Extra clockwise rotation in degrees (0, 90, 180, 270). */
  rotate: number;
}

/** A rectangle in fractions (0–1) of the page or image, measured from the top-left. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box on a given PDF page (1-based). */
export interface PageBox extends Box {
  page: number;
}

/** Crop rectangle on an image, drawn on the first image and applied proportionally to all. */
export interface CropParam extends ParamBase<Box> {
  kind: 'crop';
}

/** Rectangles drawn on PDF pages, e.g. areas to redact. */
export interface RegionsParam extends ParamBase<PageBox[]> {
  kind: 'regions';
}

/** A signature image (PNG data URL) and where it is placed on the pages. */
export interface SignatureValue {
  image: string;
  placements: PageBox[];
}

export interface SignatureParam extends ParamBase<SignatureValue> {
  kind: 'signature';
}

/** Values for the PDF's form fields, keyed by field name. Filled from the document. */
export interface FormFieldsParam extends ParamBase<Record<string, string | boolean>> {
  kind: 'formFields';
}

export type ParamSpec =
  | EnumParam
  | NumberParam
  | BooleanParam
  | TextParam
  | ColorParam
  | PositionParam
  | PageOrderParam
  | CropParam
  | RegionsParam
  | SignatureParam
  | FormFieldsParam;

export type ParamValue =
  | string
  | number
  | boolean
  | PageRef[]
  | Box
  | PageBox[]
  | SignatureValue
  | Record<string, string | boolean>;
export type ParamValues = Record<string, ParamValue>;

/** Named, ready-made parameter set, e.g. "Recommended" or "Extreme". */
export interface Preset {
  id: string;
  label: string;
  description: string;
  values: ParamValues;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ActionCategory =
  | 'pdf-organize'
  | 'pdf-optimize'
  | 'pdf-convert'
  | 'pdf-edit'
  | 'pdf-security'
  | 'image';

/** Passed to `run` so actions can report progress. */
export interface RunContext {
  /** Report progress from 0 to 1, with an optional status message. */
  progress(fraction: number, message?: string): void;
}

export interface ActionDefinition {
  /** Stable id, `<domain>.<verb>`, used in URLs and saved settings. */
  id: string;
  title: string;
  /** One line shown on the tool card. */
  description: string;
  category: ActionCategory;
  /** Emoji or short glyph for the tool card. */
  icon: string;
  /** Accepted MIME types; `image/*` style wildcards allowed. */
  accepts: string[];
  /**
   * `each`: run once per input file (batch-friendly).
   * `all`: run once with every input file (e.g. merge).
   */
  mode: 'each' | 'all';
  minFiles?: number;
  maxFiles?: number;
  /** Label of the main button, e.g. "Merge PDFs". */
  verb: string;
  params: Record<string, ParamSpec>;
  presets?: Preset[];
  /** Preset applied on first visit. */
  defaultPreset?: string;
  /** Which engine(s) the action loads, shown in "How it works". */
  engines: string[];
  /**
   * Optional: read the first file and return parameter values to prefill,
   * e.g. a PDF's current metadata. Runs in the preview worker.
   */
  inspect?(file: FileData): Promise<ParamValues>;
  /**
   * MIME type of the files `run` returns for an input of `inputType`, so
   * pipelines can check that steps fit together before running. Leave it out
   * when outputs have the input's type (most PDF tools); image tools that
   * re-encode default to `encodableImageType` (see core/pipeline.ts).
   */
  produces?(inputType: string, params: ParamValues): string;
  /**
   * Show a live preview of the first image while settings change. The action
   * runs on a downscaled copy in the preview worker, so `run` must work on
   * any image size.
   */
  livePreview?: boolean;
  /**
   * Do the work. Runs inside a Web Worker. Import engines lazily inside the
   * function (`await import(...)`) so the main bundle stays small.
   */
  run(files: FileData[], params: ParamValues, ctx: RunContext): Promise<OutputFile[]>;
}
