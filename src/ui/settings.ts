/**
 * Per-tool remembered settings and the app theme, kept in localStorage.
 *
 * Secret parameters (passwords) are never stored. Storage can be unavailable
 * (private mode, blocked site data), so every access is wrapped in try/catch
 * and the app works the same without it.
 */
import type { ActionDefinition, ParamValues } from '../core/types';
import { isWorkspaceParam } from '../core/params';

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
    const secret = spec.kind === 'text' && spec.secret;
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
