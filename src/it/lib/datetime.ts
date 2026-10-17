/**
 * Date and time: read a timestamp in any common form, show it in all of them.
 */
import type { OutputRow } from '../types';
import { relative } from './data';

/**
 * Unix seconds, milliseconds or microseconds (told apart by size), ISO 8601,
 * RFC 2822 and anything else `Date` understands. Empty means now.
 */
export function parseDate(text: string, now = Date.now()): Date {
  const s = text.trim();
  if (!s || s.toLowerCase() === 'now') return new Date(now);
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const abs = Math.abs(n);
    return new Date(abs < 1e11 ? n * 1000 : abs < 1e14 ? n : n / 1000);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('Not a date I recognise. Try 2026-10-17T09:30:00Z, a Unix timestamp, or “now”.');
  return d;
}

/** ISO 8601 week number and its year. */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/** Local time with its UTC offset, e.g. 2026-10-17T11:00:00+05:30. */
export function localIso(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

export function dateRows(d: Date, now = Date.now()): OutputRow[] {
  const diff = d.getTime() - now;
  const { year, week } = isoWeek(d);
  const dayOfYear = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000);
  return [
    { label: 'ISO 8601 (UTC)', value: d.toISOString() },
    { label: 'ISO 8601 (local)', value: localIso(d) },
    { label: 'Unix seconds', value: String(Math.floor(d.getTime() / 1000)) },
    { label: 'Unix milliseconds', value: String(d.getTime()) },
    { label: 'Local', value: d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' }) },
    { label: 'HTTP / RFC 7231', value: d.toUTCString() },
    { label: 'Relative', value: Math.abs(diff) < 1000 ? 'now' : diff < 0 ? `${relative(-diff)} ago` : `in ${relative(diff)}` },
    { label: 'Week / day of year', value: `${year}-W${String(week).padStart(2, '0')} · day ${dayOfYear}` },
  ];
}
