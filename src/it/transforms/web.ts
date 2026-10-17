/** Web, network and time: URL parser, IPv4 subnets, cron, date-time. */
import type { OutputRow, TransformSpec } from '../types';
import { subnetRows, urlRows } from '../lib/network';
import { describeCron, nextRuns, parseCron } from '../lib/cron';
import { dateRows, parseDate } from '../lib/datetime';

export const urlParse: TransformSpec = {
  input: { sample: 'https://user:pass@example.com:8080/docs/page?lang=en&q=caf%C3%A9#intro', singleLine: true, label: 'URL' },
  run: (input) => (input.trim() ? urlRows(input) : []),
  output: { name: 'url' },
};

export const subnet: TransformSpec = {
  input: { sample: '192.168.1.42/24', singleLine: true, label: 'Address with prefix or netmask', placeholder: '10.0.0.0/8 or 10.0.0.1 255.0.0.0' },
  run: (input) => (input.trim() ? subnetRows(input) : []),
  output: { name: 'subnet' },
};

export const cron: TransformSpec = {
  input: { sample: '*/15 9-17 * * MON-FRI', singleLine: true, label: 'Cron expression', placeholder: 'minute hour day month weekday' },
  options: {
    count: { kind: 'number', label: 'Next runs to show', default: 5, min: 1, max: 50 },
  },
  run: (input, o): OutputRow[] => {
    if (!input.trim()) return [];
    const c = parseCron(input);
    const runs = nextRuns(c, Number(o.count));
    const fmt = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return [
      { label: 'Meaning', value: describeCron(c) },
      { label: 'Next runs (your time zone)', value: runs.length ? runs.map(fmt).join('\n') : 'Never within the next 5 years.' },
    ];
  },
  output: { name: 'cron' },
};

export const datetime: TransformSpec = {
  input: { singleLine: true, label: 'Date, time or timestamp', placeholder: 'Empty means now. e.g. 1760693400, 2026-10-17T09:30Z' },
  run: (input) => dateRows(parseDate(input)),
  output: { name: 'date' },
};
