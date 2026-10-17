/**
 * Structured data: JSON formatting, JSON ↔ CSV and JWT decoding.
 * (YAML lives in the transform itself so its parser only loads when used.)
 */
import { parseCsv, guessDelimiter } from '../../core/text-formats';
import { base64ToBytes } from './encoding';

/** JSON.parse with an error that says where the problem is. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const at = /position (\d+)/.exec(message);
    if (at) {
      const pos = Number(at[1]);
      const before = text.slice(0, pos);
      const line = before.split('\n').length;
      const column = pos - before.lastIndexOf('\n');
      throw new Error(`Invalid JSON at line ${line}, column ${column}: ${message.replace(/ in JSON at position \d+.*$/, '')}.`);
    }
    throw new Error(`Invalid JSON: ${message}`);
  }
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function formatJson(text: string, indent: number | 'tab' | 0, sort = false): string {
  let value = parseJson(text);
  if (sort) value = sortKeys(value);
  return JSON.stringify(value, null, indent === 'tab' ? '\t' : indent || undefined);
}

/** Flatten nested objects into dotted keys: {a:{b:1}} → {"a.b": 1}. Arrays stay as JSON. */
function flatten(value: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = v;
  }
  return out;
}

function csvField(value: unknown, delimiter: string): string {
  const s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** An array of objects (or one object) → CSV with a header row; nested keys are flattened with dots. */
export function jsonToCsv(text: string, delimiter = ','): string {
  const data = parseJson(text);
  const rows = (Array.isArray(data) ? data : [data]).map((row) =>
    row && typeof row === 'object' && !Array.isArray(row) ? flatten(row as Record<string, unknown>) : { value: row },
  );
  if (!rows.length) return '';
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [columns, ...rows.map((r) => columns.map((c) => (r as Record<string, unknown>)[c]))]
    .map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter))
    .join('\n');
}

/** CSV with a header row → array of objects. Numbers, booleans and null are typed when `typed` is set. */
export function csvToJson(text: string, typed = true): string {
  const delimiter = guessDelimiter(text);
  const [header, ...rows] = parseCsv(text.trim(), delimiter);
  if (!header) return '[]';
  const convert = (s: string): unknown => {
    if (!typed) return s;
    if (s === 'true' || s === 'false') return s === 'true';
    if (s === 'null' || s === '') return s === 'null' ? null : '';
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s) && Number.isFinite(Number(s))) return Number(s);
    return s;
  };
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(header.map((h, i) => [h, convert(r[i] ?? '')]))),
    null,
    2,
  );
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

const JWT_DATES = ['exp', 'iat', 'nbf', 'auth_time'];

/** Decode (not verify) a JWT. */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) throw new Error('A JWT has three parts separated by dots: header.payload.signature.');
  const part = (s: string, what: string) => {
    try {
      return JSON.parse(new TextDecoder().decode(base64ToBytes(s))) as Record<string, unknown>;
    } catch {
      throw new Error(`The ${what} is not valid Base64-encoded JSON.`);
    }
  };
  return { header: part(parts[0], 'header'), payload: part(parts[1], 'payload'), signature: parts[2] };
}

/** Human-readable notes about the standard date claims, e.g. "exp: 2026-01-01 … (expired 3 days ago)". */
export function jwtDateNotes(payload: Record<string, unknown>, now = Date.now()): string[] {
  return JWT_DATES.filter((k) => typeof payload[k] === 'number').map((k) => {
    const when = (payload[k] as number) * 1000;
    let note = `${k}: ${new Date(when).toISOString()}`;
    if (k === 'exp') note += when < now ? ` (expired ${relative(now - when)} ago)` : ` (expires in ${relative(when - now)})`;
    if (k === 'nbf' && when > now) note += ` (not valid for another ${relative(when - now)})`;
    return note;
  });
}

/** 90061000 → "1 day 1 hour". */
export function relative(ms: number): string {
  const units: [string, number][] = [['year', 31_536_000_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000], ['second', 1000]];
  const parts: string[] = [];
  for (const [name, size] of units) {
    const n = Math.floor(ms / size);
    if (n > 0 && parts.length < 2) {
      parts.push(`${n} ${name}${n > 1 ? 's' : ''}`);
      ms -= n * size;
    }
  }
  return parts.join(' ') || 'less than a second';
}
