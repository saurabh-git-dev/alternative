/**
 * Text helpers: case conversion, slugs, statistics and lorem ipsum.
 */

/** Split "helloWorld_foo-bar BAZ" into ["hello", "World", "foo", "bar", "BAZ"]. */
export function words(text: string): string[] {
  return (
    text
      .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export const CASES: { label: string; convert: (text: string) => string }[] = [
  { label: 'camelCase', convert: (t) => words(t).map((w, i) => (i ? cap(w) : w.toLowerCase())).join('') },
  { label: 'PascalCase', convert: (t) => words(t).map(cap).join('') },
  { label: 'snake_case', convert: (t) => words(t).map((w) => w.toLowerCase()).join('_') },
  { label: 'CONSTANT_CASE', convert: (t) => words(t).map((w) => w.toUpperCase()).join('_') },
  { label: 'kebab-case', convert: (t) => words(t).map((w) => w.toLowerCase()).join('-') },
  { label: 'dot.case', convert: (t) => words(t).map((w) => w.toLowerCase()).join('.') },
  { label: 'path/case', convert: (t) => words(t).map((w) => w.toLowerCase()).join('/') },
  { label: 'Title Case', convert: (t) => words(t).map(cap).join(' ') },
  { label: 'Sentence case', convert: (t) => cap(words(t).join(' ')) },
  { label: 'lower case', convert: (t) => t.toLowerCase() },
  { label: 'UPPER CASE', convert: (t) => t.toUpperCase() },
];

/** "Héllo, Wörld!" → "hello-world". */
export function slugify(text: string, separator = '-', lower = true): string {
  const plain = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const slug = (plain.match(/[\p{L}\p{N}]+/gu) ?? []).join(separator);
  return lower ? slug.toLowerCase() : slug;
}

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  sentences: number;
  paragraphs: number;
  bytes: number;
  readingMinutes: number;
}

export function textStats(text: string): TextStats {
  const wordCount = (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
  return {
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, '')].length,
    words: wordCount,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    sentences: (text.match(/[^.!?…\s][^.!?…]*(?:[.!?…]+|$)/g) ?? []).length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    bytes: new TextEncoder().encode(text).length,
    readingMinutes: wordCount / 230,
  };
}

const LOREM =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(
    ' ',
  );

/** Lorem ipsum; the first paragraph starts with the classic "Lorem ipsum dolor sit amet" when `classic` is set. */
export function lorem(paragraphs: number, sentencesPerParagraph: number, classic = true, random: () => number = Math.random): string {
  const pick = () => LOREM[Math.floor(random() * LOREM.length)];
  const sentence = () => {
    const n = 6 + Math.floor(random() * 10);
    const ws = Array.from({ length: n }, pick);
    if (n > 9) ws[Math.floor(n / 2)] += ',';
    const s = ws.join(' ');
    return s[0].toUpperCase() + s.slice(1) + '.';
  };
  return Array.from({ length: paragraphs }, (_, p) => {
    const sentences = Array.from({ length: sentencesPerParagraph }, sentence);
    if (p === 0 && classic) sentences[0] = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
    return sentences.join(' ');
  }).join('\n\n');
}
