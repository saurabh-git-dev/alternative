/**
 * Cron expressions (the classic 5 fields of crontab): parse, describe in
 * plain English, and list the next run times.
 *
 *   minute hour day-of-month month day-of-week
 *
 * Supports `*`, lists `1,5`, ranges `1-5`, steps `*\/15` and `10-40/10`,
 * month and day names (`JAN`, `MON`), 7 as Sunday, and the @hourly … @yearly
 * shortcuts. As in cron, when both day fields are restricted a day matches
 * if *either* does.
 */

interface Field {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const FIELDS: Field[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
  { name: 'day of week', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
];

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface Cron {
  /** Allowed values per field, sorted. */
  values: number[][];
  /** Was the field `*` (or `*` with a step)? Matters for the day-of-month / day-of-week rule. */
  any: boolean[];
  fields: string[];
}

function parseValue(text: string, f: Field): number {
  const i = f.names?.indexOf(text.toLowerCase()) ?? -1;
  const n = i >= 0 ? i + (f.min === 1 ? 1 : 0) : /^\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isNaN(n) || n < f.min || n > f.max) throw new Error(`“${text}” is out of range for ${f.name} (${f.min}–${f.max}).`);
  return n;
}

function parseField(text: string, f: Field): number[] {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step “/${stepText}” in ${f.name}.`);
    let lo: number, hi: number;
    if (range === '*') [lo, hi] = [f.min, f.max === 7 ? 6 : f.max];
    else if (range.includes('-')) {
      const [a, b] = range.split('-');
      [lo, hi] = [parseValue(a, f), parseValue(b, f)];
      if (lo > hi) throw new Error(`Range ${range} in ${f.name} goes backwards.`);
    } else {
      lo = parseValue(range, f);
      hi = stepText === undefined ? lo : f.max;
    }
    for (let v = lo; v <= hi; v += step) out.add(f.max === 7 && v === 7 ? 0 : v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(text: string): Cron {
  const expr = MACROS[text.trim().toLowerCase()] ?? text.trim();
  const fields = expr.split(/\s+/);
  if (fields.length !== 5) throw new Error('A cron expression has 5 fields: minute hour day-of-month month day-of-week.');
  return {
    values: fields.map((t, i) => parseField(t, FIELDS[i])),
    any: fields.map((t) => t.startsWith('*')),
    fields,
  };
}

function matchesDay(c: Cron, d: Date): boolean {
  const dom = c.values[2].includes(d.getDate());
  const dow = c.values[4].includes(d.getDay());
  if (c.any[2] && c.any[4]) return true;
  if (c.any[2]) return dow;
  if (c.any[4]) return dom;
  return dom || dow;
}

/** The next `count` run times after `from`, in local time. */
export function nextRuns(c: Cron, count: number, from = new Date()): Date[] {
  const runs: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  // Bounded walk: skip whole days/hours that can't match. 5 years covers Feb 29.
  const limit = from.getTime() + 5 * 366 * 86_400_000;
  while (runs.length < count && d.getTime() < limit) {
    if (!c.values[3].includes(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0);
    } else if (!matchesDay(c, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0);
    } else if (!c.values[1].includes(d.getHours())) {
      d.setHours(d.getHours() + 1, 0);
    } else if (!c.values[0].includes(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1);
    } else {
      runs.push(new Date(d));
      d.setMinutes(d.getMinutes() + 1);
    }
  }
  return runs;
}

const pad = (n: number) => String(n).padStart(2, '0');

function list(items: string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Describe one field: "every 15 minutes", "minute 5", "minutes 0 and 30" … */
function describeField(text: string, values: number[], f: Field, label: (v: number) => string): string | null {
  if (text === '*') return null;
  const step = /^\*\/(\d+)$/.exec(text);
  if (step) return `every ${step[1]} ${f.name}s`;
  const range = /^([^,/]+)-([^,/]+)$/.exec(text);
  if (range) return `${f.name} ${label(values[0])} through ${label(values[values.length - 1])}`;
  return `${f.name}${values.length > 1 ? 's' : ''} ${list(values.map(label))}`.replace('day of weeks', 'days of week').replace('day of months', 'days of month');
}

export function describeCron(c: Cron): string {
  const [min, hour, dom, mon, dow] = c.fields;
  const parts: string[] = [];
  const [mins, hours] = c.values;

  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) parts.push(`At ${pad(hours[0])}:${pad(mins[0])}`);
  else if (/^\d+$/.test(min) && hour === '*') parts.push(mins[0] === 0 ? 'At the start of every hour' : `At minute ${mins[0]} of every hour`);
  else if (min === '*' && hour === '*') parts.push('Every minute');
  else {
    if (/^\d+(,\d+)+$/.test(min) && /^[\d,]+$/.test(hour)) {
      parts.push(`At ${list(hours.flatMap((h) => mins.map((m) => `${pad(h)}:${pad(m)}`)))}`);
    } else {
      parts.push(describeField(min, mins, FIELDS[0], String)?.replace(/^./, (x) => x.toUpperCase()) ?? 'Every minute');
      const h = describeField(hour, hours, FIELDS[1], (v) => pad(v) + ':00');
      if (h) parts.push(`past ${h}`);
    }
  }
  const dayText = describeField(dom, c.values[2], FIELDS[2], String);
  const weekText = describeField(dow, c.values[4], FIELDS[4], (v) => DAYS[v]);
  if (dayText && weekText) parts.push(`on ${dayText} or on ${weekText.replace(/^days? of week /, '')}`);
  else if (dayText) parts.push(`on ${dayText}`);
  else if (weekText) parts.push(`on ${weekText.replace(/^days? of week /, '')}`);
  const monthText = describeField(mon, c.values[3], FIELDS[3], (v) => MONTHS[v - 1]);
  if (monthText) parts.push(`in ${monthText.replace(/^months? /, '')}`);
  return parts.join(', ').replace(/, past/, ' past') + '.';
}
