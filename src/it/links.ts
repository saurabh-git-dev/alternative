/**
 * "Link to this": an IT tool's input and options packed into the URL, so
 * opening the link (or scanning it) shows the same tool with the same
 * content. Uses the share-link packing from core/share.ts (deflate +
 * base64url), in the fragment, so the content never reaches a server.
 *
 *   it/#/<tool id>/<base64url packed JSON {i: input, o: options}>
 */
import { fromBase64Url, pack, toBase64Url, unpack } from '../core/share';
import type { OptionSpec, OptionValues } from './types';

export interface ToolState {
  input: string;
  options: OptionValues;
}

export function encodeToolState(state: ToolState): string {
  const json = JSON.stringify({ i: state.input, o: state.options });
  return toBase64Url(pack({ name: '', type: 'application/json', bytes: new TextEncoder().encode(json) }, { includeName: false }));
}

/** Null if the payload is damaged. */
export function decodeToolState(payload: string): ToolState | null {
  try {
    const { i, o } = JSON.parse(new TextDecoder().decode(unpack(fromBase64Url(payload)).bytes));
    return { input: typeof i === 'string' ? i : '', options: o && typeof o === 'object' ? o : {} };
  } catch {
    return null;
  }
}

/** Options with secrets (passwords, keys) removed, for links and remembered settings. */
export function publicOptions(specs: Record<string, OptionSpec> | undefined, values: OptionValues): OptionValues {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !(specs?.[k]?.kind === 'text' && specs[k].secret)));
}

/** Defaults, overridden by `saved` values that still fit their option. */
export function resolveOptions(specs: Record<string, OptionSpec> | undefined, ...saved: Record<string, unknown>[]): OptionValues {
  const out: OptionValues = {};
  for (const [key, spec] of Object.entries(specs ?? {})) {
    out[key] = spec.default;
    for (const s of saved) {
      const v = s[key];
      if (spec.kind === 'choice' ? spec.choices.some((c) => c.value === v) : typeof v === typeof spec.default) out[key] = v as OptionValue;
    }
  }
  return out;
}

type OptionValue = OptionValues[string];
