/**
 * Page range parsing, shared by every tool that takes a page selection.
 *
 * Syntax (1-based, whitespace ignored):
 *   `1-3,5`   pages 1, 2, 3 and 5
 *   `7-`      page 7 to the end
 *   `-3`      pages 1 to 3
 *   `last`    the last page (`5-last` also works)
 *   `all` or empty  every page
 */

export class PageRangeError extends Error {}

/** Parse a selection into groups of page numbers, one group per comma part. */
export function parseRangeGroups(input: string, pageCount: number): number[][] {
  const text = input.replace(/\s+/g, '').toLowerCase();
  if (text === '' || text === 'all') return [range(1, pageCount)];

  return text.split(',').filter(Boolean).map((part) => {
    const resolve = (token: string, fallback: number): number => {
      if (token === '') return fallback;
      if (token === 'last') return pageCount;
      const n = Number(token);
      if (!Number.isInteger(n) || n < 1) throw new PageRangeError(`"${part}" is not a valid page range.`);
      if (n > pageCount) throw new PageRangeError(`Page ${n} doesn't exist (the document has ${pageCount}).`);
      return n;
    };
    const [a, b, extra] = part.split('-');
    if (extra !== undefined) throw new PageRangeError(`"${part}" is not a valid page range.`);
    if (b === undefined) return [resolve(a, 1)];
    const start = resolve(a, 1);
    const end = resolve(b, pageCount);
    if (start > end) throw new PageRangeError(`"${part}" goes backwards; write it as ${end}-${start}.`);
    return range(start, end);
  });
}

/** Parse a selection into a flat, de-duplicated, ordered list of pages. */
export function parseRanges(input: string, pageCount: number): number[] {
  const seen = new Set<number>();
  for (const group of parseRangeGroups(input, pageCount)) for (const p of group) seen.add(p);
  return [...seen].sort((a, b) => a - b);
}

/** Lightweight syntax check for form validation (no page count needed). */
export function rangeSyntaxError(input: string): string | null {
  const text = input.replace(/\s+/g, '').toLowerCase();
  if (text === '' || text === 'all') return null;
  const ok = /^((\d+|last)?-?(\d+|last)?)(,((\d+|last)?-?(\d+|last)?))*$/.test(text);
  return ok ? null : 'Use page numbers and ranges like 1-3, 5, 8-';
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
