/** Text tools: case, slugs, statistics. */
import type { OutputRow, TransformSpec } from '../types';
import { CASES, slugify, textStats } from '../lib/text';

export const caseConvert: TransformSpec = {
  input: { sample: 'user account ID', singleLine: true, label: 'Text' },
  run: (input): OutputRow[] => (input.trim() ? CASES.map((c) => ({ label: c.label, value: c.convert(input) })) : []),
  output: { name: 'cases' },
};

export const slug: TransformSpec = {
  input: { sample: 'Héllo Wörld: 10 Tips & Tricks!', singleLine: true, label: 'Title' },
  options: {
    separator: {
      kind: 'choice',
      label: 'Separator',
      default: '-',
      choices: [
        { value: '-', label: 'Hyphen -' },
        { value: '_', label: 'Underscore _' },
        { value: '.', label: 'Dot .' },
      ],
    },
    lower: { kind: 'toggle', label: 'Lower case', default: true },
  },
  run: (input, o) => slugify(input, String(o.separator), !!o.lower),
  output: { name: 'slug' },
};

export const stats: TransformSpec = {
  input: { placeholder: 'Paste or type text…', sample: 'The quick brown fox jumps over the lazy dog. It barked!\n\nA second paragraph.' },
  run: (input): OutputRow[] => {
    const s = textStats(input);
    const minutes = s.readingMinutes < 1 ? `${Math.max(1, Math.round(s.readingMinutes * 60))} s` : `${Math.round(s.readingMinutes)} min`;
    return [
      { label: 'Characters', value: s.characters.toLocaleString() },
      { label: 'Without spaces', value: s.charactersNoSpaces.toLocaleString() },
      { label: 'Words', value: s.words.toLocaleString() },
      { label: 'Sentences', value: s.sentences.toLocaleString() },
      { label: 'Lines', value: s.lines.toLocaleString() },
      { label: 'Paragraphs', value: s.paragraphs.toLocaleString() },
      { label: 'Bytes (UTF-8)', value: s.bytes.toLocaleString() },
      { label: 'Reading time', value: input.trim() ? minutes : '0 s' },
    ];
  },
  output: { name: 'stats' },
};
