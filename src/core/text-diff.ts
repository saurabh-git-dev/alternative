/**
 * Word-level comparison of two documents' text, for Compare PDFs.
 *
 * Pages are joined with a form feed so page breaks line up in the diff
 * without adding noise; each part remembers which page it is on in both
 * documents. Layout-only differences (line breaks, spacing) are ignored by
 * collapsing whitespace first.
 */
import { diffWords } from 'diff';

export interface DiffPart {
  kind: 'same' | 'added' | 'removed';
  text: string;
  /** 1-based page in the original (A) and changed (B) document where the part starts. */
  pageA: number;
  pageB: number;
}

export interface TextDiff {
  parts: DiffPart[];
  added: number;
  removed: number;
  /** Number of separate places that changed. */
  changes: number;
}

const PAGE_BREAK = '\f';

function normalise(pages: string[]): string {
  return pages.map((p) => p.replace(/\s+/g, ' ').trim()).join(` ${PAGE_BREAK} `);
}

/** Words with at least one letter or digit, so punctuation-only edits don't inflate counts. */
const countWords = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function compareTexts(pagesA: string[], pagesB: string[]): TextDiff {
  const raw = diffWords(normalise(pagesA), normalise(pagesB));
  const parts: DiffPart[] = [];
  let [pageA, pageB] = [1, 1];
  let added = 0;
  let removed = 0;
  let changes = 0;
  let inChange = false;
  for (const r of raw) {
    const kind = r.added ? 'added' : r.removed ? 'removed' : 'same';
    // A part made only of page breaks/whitespace isn't a real change.
    const visible = /[^\s\f]/.test(r.value);
    if (kind === 'same' || visible) parts.push({ kind, text: r.value, pageA, pageB });
    if (kind === 'added') added += countWords(r.value);
    if (kind === 'removed') removed += countWords(r.value);
    // Adjacent removed+added parts are one change (a replacement).
    if (kind !== 'same' && visible && !inChange) changes++;
    if (kind !== 'same' && visible) inChange = true;
    else if (kind === 'same' && visible) inChange = false;
    const breaks = r.value.split(PAGE_BREAK).length - 1;
    if (!r.added) pageA += breaks;
    if (!r.removed) pageB += breaks;
  }
  return { parts, added, removed, changes };
}

/** Text without page-break markers, for display. */
export function displayText(text: string): string {
  return text.replaceAll(PAGE_BREAK, '¶');
}
