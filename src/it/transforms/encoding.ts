/** Encoders and decoders: Base64, URL, HTML entities, binary, Unicode, NATO, Roman numerals. */
import type { TransformSpec } from '../types';
import {
  binaryToText,
  decodeBase64,
  decodeUrl,
  encodeBase64,
  escapeHtml,
  escapeUnicode,
  fromRoman,
  textToBinary,
  toNato,
  toRoman,
  unescapeHtml,
  unescapeUnicode,
} from '../lib/encoding';

const direction = (encode = 'Encode', decode = 'Decode') => ({
  kind: 'choice' as const,
  label: 'Direction',
  default: 'encode',
  choices: [
    { value: 'encode', label: encode },
    { value: 'decode', label: decode },
  ],
});

export const base64: TransformSpec = {
  input: { sample: 'Hello, world! 👋' },
  options: {
    mode: direction(),
    urlSafe: { kind: 'toggle', label: 'URL-safe (- and _, no padding)', default: false },
  },
  direction: 'mode',
  run: (input, o) => (o.mode === 'encode' ? encodeBase64(input, !!o.urlSafe) : decodeBase64(input)),
  output: { name: 'base64' },
};

export const url: TransformSpec = {
  input: { sample: 'https://example.com/search?q=café & crème' },
  options: {
    mode: direction(),
    whole: {
      kind: 'toggle',
      label: 'Keep URL structure (encodeURI)',
      default: false,
      help: 'Leaves : / ? & = # alone, so a whole URL stays usable. Off encodes a single query value.',
    },
  },
  direction: 'mode',
  run: (input, o) => (o.mode === 'decode' ? decodeUrl(input) : o.whole ? encodeURI(input) : encodeURIComponent(input)),
  output: { name: 'url' },
};

export const html: TransformSpec = {
  input: { sample: '<a href="/?q=1&b=2">Café “quotes”</a>' },
  options: {
    mode: direction('Escape', 'Unescape'),
    nonAscii: { kind: 'toggle', label: 'Also escape non-ASCII characters', default: false },
  },
  direction: 'mode',
  run: (input, o) => (o.mode === 'encode' ? escapeHtml(input, !!o.nonAscii) : unescapeHtml(input)),
  output: { name: 'html' },
};

export const binary: TransformSpec = {
  input: { sample: 'Hi!' },
  options: { mode: direction('Text → binary', 'Binary → text') },
  direction: 'mode',
  run: (input, o) => (o.mode === 'encode' ? textToBinary(input) : binaryToText(input)),
  output: { name: 'binary' },
};

export const unicode: TransformSpec = {
  input: { sample: 'Café ☕ 😀' },
  options: {
    mode: direction('Escape', 'Unescape'),
    style: {
      kind: 'choice',
      label: 'Style',
      default: 'js',
      choices: [
        { value: 'js', label: '\\uXXXX (JSON, Java, JS)' },
        { value: 'es6', label: '\\u{X} (modern JS)' },
      ],
    },
    all: { kind: 'toggle', label: 'Escape ASCII too', default: false },
  },
  direction: 'mode',
  run: (input, o) => (o.mode === 'encode' ? escapeUnicode(input, o.style as 'js' | 'es6', !o.all) : unescapeUnicode(input)),
  output: { name: 'unicode' },
};

export const nato: TransformSpec = {
  input: { sample: 'Ab3 XZ', label: 'Text to spell' },
  run: (input) => toNato(input),
  output: { name: 'nato' },
};

export const roman: TransformSpec = {
  input: { sample: '2026', singleLine: true, label: 'Number or Roman numeral' },
  run: (input) => {
    const s = input.trim();
    if (!s) return '';
    return /^\d+$/.test(s) ? toRoman(Number(s)) : String(fromRoman(s));
  },
  output: { name: 'roman' },
};
