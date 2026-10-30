/**
 * IT tools worth offering for a piece of received text (Received page:
 * "Do more with it"), e.g. Decrypt for text locked with Encrypt text, or
 * Format for JSON.
 */
import type { OptionValues } from './types';

export interface Suggestion {
  tool: string;
  label: string;
  options?: OptionValues;
}

export function suggestItTools(type: string, text: string): Suggestion[] {
  const t = text.trim();
  if (type === 'application/json') {
    return [
      { tool: 'json', label: '📋 Format JSON' },
      { tool: 'json-yaml', label: '📑 JSON → YAML', options: { mode: 'encode' } },
      { tool: 'json-csv', label: '📊 JSON → CSV', options: { mode: 'encode' } },
    ];
  }
  if (type === 'text/csv') return [{ tool: 'json-csv', label: '📊 CSV → JSON', options: { mode: 'decode' } }];
  if (type === 'text/yaml') return [{ tool: 'json-yaml', label: '📑 YAML → JSON', options: { mode: 'decode' } }];

  const out: Suggestion[] = [];
  // Encrypt text output: Base64 of version byte 1 (so it starts with A and one of Q…f), salt, IV and at least a tag.
  if (/^A[Q-Za-f][A-Za-z0-9+/]{58,}={0,2}$/.test(t)) out.push({ tool: 'encrypt', label: '🔓 Decrypt', options: { mode: 'decode' } });
  else if (/^[\w-]+\.[\w-]+\.[\w-]*$/.test(t) && t.startsWith('eyJ')) out.push({ tool: 'jwt', label: '🎫 Decode JWT' });
  else if (t.length >= 8 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) out.push({ tool: 'base64', label: '🔤 Base64 decode', options: { mode: 'decode' } });
  // An article, email or notes: long enough to be worth summarizing.
  if ((t.match(/\s+/g)?.length ?? 0) >= 80) out.push({ tool: 'summarize', label: '🧠 Summarize' });
  out.push({ tool: 'stats', label: '📏 Text statistics' }, { tool: 'hash', label: '#️⃣ Hash' });
  return out;
}
