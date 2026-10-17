/**
 * Helpers for resolving parameter values: defaults, presets and validation.
 */
import type { ActionDefinition, ParamSpec, ParamValues } from './types';

/**
 * Parameter kinds edited directly on the document (page grid, crop box,
 * redaction boxes, signature, form). They render in the main workspace rather
 * than the settings panel, and are never remembered between visits because
 * they belong to one specific file.
 */
export const WORKSPACE_KINDS: ReadonlySet<ParamSpec['kind']> = new Set([
  'pageOrder',
  'crop',
  'regions',
  'signature',
  'formFields',
  'annotations',
  'timeRange',
  'masks',
  'videoTime',
]);

export function isWorkspaceParam(spec: ParamSpec): boolean {
  return WORKSPACE_KINDS.has(spec.kind);
}

/** Values that must never be stored or put in links: passwords and picked files. */
export function isPrivateParam(spec: ParamSpec): boolean {
  return (spec.kind === 'text' && !!spec.secret) || spec.kind === 'file';
}

/** Every parameter at its declared default. */
export function defaultValues(action: ActionDefinition): ParamValues {
  const values: ParamValues = {};
  for (const [key, spec] of Object.entries(action.params)) {
    values[key] = structuredClone(spec.default);
  }
  return values;
}

/**
 * Starting values for a tool: defaults, then the default preset, then any
 * values the user saved last time (unknown keys are ignored).
 */
export function initialValues(action: ActionDefinition, saved?: ParamValues): ParamValues {
  const values = defaultValues(action);
  const preset = action.presets?.find((p) => p.id === action.defaultPreset);
  if (preset) Object.assign(values, preset.values);
  if (saved) {
    for (const [key, spec] of Object.entries(action.params)) {
      if (isWorkspaceParam(spec)) continue;
      if (isPrivateParam(spec)) continue;
      if (key in saved && typeof saved[key] === typeof values[key]) values[key] = saved[key];
    }
  }
  return values;
}

/** Apply a preset on top of the current values. */
export function applyPreset(action: ActionDefinition, presetId: string, current: ParamValues): ParamValues {
  const preset = action.presets?.find((p) => p.id === presetId);
  return preset ? { ...current, ...structuredClone(preset.values) } : current;
}

/** The preset whose values all match the current values, if any. */
export function matchingPreset(action: ActionDefinition, values: ParamValues): string | null {
  for (const preset of action.presets ?? []) {
    const matches = Object.entries(preset.values).every(
      ([key, v]) => JSON.stringify(values[key]) === JSON.stringify(v),
    );
    if (matches) return preset.id;
  }
  return null;
}

export function isVisible(spec: ParamSpec, values: ParamValues): boolean {
  return spec.visibleWhen ? spec.visibleWhen(values) : true;
}

/** Map of param key to error message for every visible invalid parameter. */
export function validate(action: ActionDefinition, values: ParamValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, spec] of Object.entries(action.params)) {
    if (!isVisible(spec, values)) continue;
    const value = values[key];
    if (spec.kind === 'number') {
      const n = value as number;
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
        errors[key] = `Enter a value between ${spec.min} and ${spec.max}.`;
      }
    } else if (spec.kind === 'file' && spec.required && !value) {
      errors[key] = 'Choose a file.';
    } else if (spec.kind === 'masks' && !(value as unknown[]).length) {
      errors[key] = 'Draw a box over the area to hide.';
    } else if (spec.kind === 'text' && spec.validate) {
      const message = spec.validate(value as string, values);
      if (message) errors[key] = message;
    }
  }
  return errors;
}
