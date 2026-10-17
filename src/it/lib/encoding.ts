/**
 * Text encodings: Base64, URL, HTML entities, binary, NATO alphabet, Unicode
 * escapes and Roman numerals. Pure functions, unit-tested in tests/it-encoding.test.ts.
 */

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(binary);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

/** Accepts standard and URL-safe Base64, with or without padding and whitespace. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new Error('This is not valid Base64.');
  const binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function encodeBase64(text: string, urlSafe = false): string {
  return bytesToBase64(utf8.encode(text), urlSafe);
}

export function decodeBase64(text: string): string {
  const bytes = base64ToBytes(text);
  try {
    return fromUtf8.decode(bytes);
  } catch {
    throw new Error('Decoded fine, but the result is binary data, not text.');
  }
}

export function decodeUrl(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    throw new Error('This contains a broken %-escape, e.g. a lone “%”.');
  }
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', cent: '¢',
  deg: '°', times: '×', divide: '÷', para: '¶', sect: '§', middot: '·', bull: '•',
};

/** Escape the five HTML-significant characters; optionally every non-ASCII character too. */
export function escapeHtml(text: string, allNonAscii = false): string {
  const out = text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  return allNonAscii ? out.replace(/[^\x00-\x7f]/gu, (c) => `&#${c.codePointAt(0)};`) : out;
}

export function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function textToBinary(text: string): string {
  return [...utf8.encode(text)].map((b) => b.toString(2).padStart(8, '0')).join(' ');
}

export function binaryToText(text: string): string {
  const bits = text.replace(/[^01]/g, '');
  if (!bits || bits.length % 8) throw new Error('Expected groups of 8 bits (0s and 1s).');
  const bytes = Uint8Array.from(bits.match(/.{8}/g)!, (b) => parseInt(b, 2));
  try {
    return fromUtf8.decode(bytes);
  } catch {
    throw new Error('These bits are not valid UTF-8 text.');
  }
}

const NATO: Record<string, string> = {
  a: 'Alfa', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot', g: 'Golf', h: 'Hotel', i: 'India',
  j: 'Juliett', k: 'Kilo', l: 'Lima', m: 'Mike', n: 'November', o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo',
  s: 'Sierra', t: 'Tango', u: 'Uniform', v: 'Victor', w: 'Whiskey', x: 'X-ray', y: 'Yankee', z: 'Zulu',
  0: 'Zero', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine',
};

/** Spell text with the NATO phonetic alphabet; capitals are marked, other characters kept as is. */
export function toNato(text: string): string {
  return [...text]
    .map((c) => {
      const word = NATO[c.toLowerCase()];
      if (!word) return c === ' ' ? '(space)' : c;
      return c !== c.toLowerCase() ? word.toUpperCase() : word;
    })
    .join(' ');
}

/** `é` → `é`, astral characters as surrogate pairs (JavaScript/JSON style) or `\u{1f600}`. */
export function escapeUnicode(text: string, style: 'js' | 'es6' = 'js', onlyNonAscii = true): string {
  let out = '';
  for (const c of text) {
    const code = c.codePointAt(0)!;
    if (onlyNonAscii && code < 0x80) out += c;
    else if (style === 'es6') out += `\\u{${code.toString(16)}}`;
    else for (let i = 0; i < c.length; i++) out += `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return out;
}

export function unescapeUnicode(text: string): string {
  return text
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new Error('Roman numerals go from 1 to 3999.');
  let out = '';
  for (const [value, letters] of ROMAN) while (n >= value) (out += letters), (n -= value);
  return out;
}

export function fromRoman(text: string): number {
  const s = text.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(s)) throw new Error('Use the letters M, D, C, L, X, V and I.');
  let n = 0;
  let rest = s;
  for (const [value, letters] of ROMAN) while (rest.startsWith(letters)) (n += value), (rest = rest.slice(letters.length));
  if (rest || toRoman(n) !== s) throw new Error(`“${s}” is not a well-formed Roman numeral.`);
  return n;
}
