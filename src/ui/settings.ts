/**
 * Per-tool remembered settings, saved pipelines and the app theme, kept in
 * localStorage.
 *
 * Secret parameters (passwords) are never stored. Storage can be unavailable
 * (private mode, blocked site data), so every access is wrapped in try/catch
 * and the app works the same without it.
 */
import type { ActionDefinition, ParamValues } from '../core/types';
import { withoutSecrets, type Pipeline } from '../core/pipeline';
import { isPrivateParam, isWorkspaceParam } from '../core/params';

const PREFIX = 'formatter:';

export function loadSettings(action: ActionDefinition): ParamValues | undefined {
  try {
    const raw = localStorage.getItem(`${PREFIX}params:${action.id}`);
    return raw ? (JSON.parse(raw) as ParamValues) : undefined;
  } catch {
    return undefined;
  }
}

export function saveSettings(action: ActionDefinition, values: ParamValues): void {
  const safe: ParamValues = {};
  for (const [key, spec] of Object.entries(action.params)) {
    const secret = isPrivateParam(spec);
    // Workspace values (page order, crop box …) belong to one file, so they aren't remembered either.
    if (!secret && !isWorkspaceParam(spec)) safe[key] = values[key];
  }
  try {
    localStorage.setItem(`${PREFIX}params:${action.id}`, JSON.stringify(safe));
  } catch {
    /* storage unavailable: settings simply aren't remembered */
  }
}

export function clearSettings(action: ActionDefinition): void {
  try {
    localStorage.removeItem(`${PREFIX}params:${action.id}`);
  } catch {
    /* ignore */
  }
}

export type Theme = 'light' | 'dark';

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(`${PREFIX}theme`);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function saveTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(`${PREFIX}theme`, theme);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Saved pipelines (passwords stripped, see core/pipeline.ts)
// ---------------------------------------------------------------------------


export function loadPipelines(): Pipeline[] {
  try {
    const raw = localStorage.getItem(`${PREFIX}pipelines`);
    return raw ? (JSON.parse(raw) as Pipeline[]) : [];
  } catch {
    return [];
  }
}

/** Save under its name, replacing a saved pipeline with the same name. */
export function savePipeline(pipeline: Pipeline): void {
  const rest = loadPipelines().filter((p) => p.name !== pipeline.name);
  writePipelines([withoutSecrets(pipeline), ...rest]);
}

export function deletePipeline(name: string): void {
  writePipelines(loadPipelines().filter((p) => p.name !== name));
}

function writePipelines(list: Pipeline[]): void {
  try {
    localStorage.setItem(`${PREFIX}pipelines`, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// IT tool options (secret options such as passwords and keys are never stored)
// ---------------------------------------------------------------------------

export function loadItOptions(id: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(`${PREFIX}it:${id}`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `values` should already be free of secrets; see ui/it/TransformTool.svelte. */
export function saveItOptions(id: string, values: Record<string, unknown>): void {
  try {
    localStorage.setItem(`${PREFIX}it:${id}`, JSON.stringify(values));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Screen recorder choices (source, mic, quality …)
// ---------------------------------------------------------------------------

export function loadRecorderOptions<T extends object>(defaults: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}recorder`);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<T>) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveRecorderOptions(options: object): void {
  try {
    localStorage.setItem(`${PREFIX}recorder`, JSON.stringify(options));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Home dashboard: which tools it shows (see pages/Home.svelte)
// ---------------------------------------------------------------------------

/** The keys of the tools picked for the home page, or null for the default set. */
export function loadDashboard(): string[] | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}dashboard`);
    const keys: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

/** Pass null to go back to the default set. */
export function saveDashboard(keys: string[] | null): void {
  try {
    if (keys) localStorage.setItem(`${PREFIX}dashboard`, JSON.stringify(keys));
    else localStorage.removeItem(`${PREFIX}dashboard`);
  } catch {
    /* storage unavailable: the choice lasts until the page is closed */
  }
}
