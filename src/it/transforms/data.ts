/** Structured data: JSON format, JSON ↔ CSV, JSON ↔ YAML, JWT. */
import type { OutputRow, TransformSpec } from '../types';
import { csvToJson, decodeJwt, formatJson, jsonToCsv, jwtDateNotes, parseJson } from '../lib/data';

export const jsonFormat: TransformSpec = {
  input: { sample: '{"name":"Formatter","tools":["pdf","image","it"],"private":true,"version":{"major":1,"minor":0}}', label: 'JSON' },
  options: {
    indent: {
      kind: 'choice',
      label: 'Indent',
      default: '2',
      choices: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
        { value: 'tab', label: 'Tab' },
        { value: '0', label: 'Minify' },
      ],
    },
    sort: { kind: 'toggle', label: 'Sort keys A→Z', default: false },
  },
  run: (input, o) => (input.trim() ? formatJson(input, o.indent === 'tab' ? 'tab' : Number(o.indent), !!o.sort) : ''),
  output: { type: 'application/json', name: 'formatted' },
};

export const jsonCsv: TransformSpec = {
  input: { sample: '[{"id":1,"name":"Ada","address":{"city":"London"}},{"id":2,"name":"Linus","address":{"city":"Helsinki"}}]' },
  options: {
    mode: {
      kind: 'choice',
      label: 'Direction',
      default: 'encode',
      choices: [
        { value: 'encode', label: 'JSON → CSV' },
        { value: 'decode', label: 'CSV → JSON' },
      ],
    },
    delimiter: {
      kind: 'choice',
      label: 'CSV delimiter',
      default: ',',
      choices: [
        { value: ',', label: 'Comma' },
        { value: ';', label: 'Semicolon' },
        { value: '\t', label: 'Tab' },
      ],
    },
  },
  direction: 'mode',
  run: (input, o) => (!input.trim() ? '' : o.mode === 'encode' ? jsonToCsv(input, String(o.delimiter)) : csvToJson(input)),
  output: { type: (o) => (o.mode === 'encode' ? 'text/csv' : 'application/json'), name: 'data' },
};

export const jsonYaml: TransformSpec = {
  input: { sample: '{"server":{"port":8080,"hosts":["a.example","b.example"]},"debug":false}' },
  options: {
    mode: {
      kind: 'choice',
      label: 'Direction',
      default: 'encode',
      choices: [
        { value: 'encode', label: 'JSON → YAML' },
        { value: 'decode', label: 'YAML → JSON' },
      ],
    },
  },
  direction: 'mode',
  run: async (input, o) => {
    if (!input.trim()) return '';
    const YAML = await import('yaml');
    if (o.mode === 'encode') return YAML.stringify(parseJson(input));
    try {
      return JSON.stringify(YAML.parse(input), null, 2);
    } catch (e) {
      throw new Error(`Invalid YAML: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
  },
  output: { type: (o) => (o.mode === 'encode' ? 'text/yaml' : 'application/json'), name: 'data' },
};

export const jwt: TransformSpec = {
  input: {
    label: 'JWT',
    sample:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjo0MTAyNDQ0ODAwfQ.8zqsNwQ8lrmUYcF7zsl9UOhcadGmKa4uygw4SWtXd5Q',
  },
  sensitive: true,
  run: (input): OutputRow[] => {
    if (!input.trim()) return [];
    const { header, payload, signature } = decodeJwt(input);
    const notes = jwtDateNotes(payload);
    return [
      { label: 'Header', value: JSON.stringify(header, null, 2) },
      { label: 'Payload', value: JSON.stringify(payload, null, 2) },
      ...(notes.length ? [{ label: 'Dates', value: notes.join('\n') }] : []),
      { label: 'Signature (not verified)', value: signature },
    ];
  },
  output: { name: 'jwt' },
};
