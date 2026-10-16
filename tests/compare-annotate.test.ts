import { describe, expect, it } from 'vitest';
import { compareTexts } from '../src/core/text-diff';

describe('compareTexts', () => {
  it('finds word changes and the page they are on', () => {
    const d = compareTexts(['Hello world.', 'The fee is 100 dollars per month.'], ['Hello   world.\n', 'The fee is 250 dollars per month, payable now.']);
    expect(d.changes).toBe(2);
    expect(d.added).toBe(3);
    expect(d.removed).toBe(1);
    const first = d.parts.find((p) => p.kind !== 'same')!;
    expect(first.pageB).toBe(2);
    expect(first.pageA).toBe(2);
  });
  it('ignores layout-only differences', () => {
    const d = compareTexts(['a b\nc'], ['a  b c']);
    expect(d.changes).toBe(0);
  });
  it('tracks an inserted page', () => {
    const d = compareTexts(['one', 'three'], ['one', 'two', 'three']);
    expect(d.added).toBe(1);
    const added = d.parts.find((p) => p.kind === 'added')!;
    expect(added.text).toContain('two');
    const last = d.parts.at(-1)!;
    expect(last.pageB).toBeGreaterThanOrEqual(2);
  });
});

import { PDFDocument } from 'pdf-lib';
import * as mupdf from 'mupdf';
import { annotate } from '../src/engines/mupdf';
import type { Annotation } from '../src/core/types';

describe('annotate', () => {
  const marks: Annotation[] = [
    { page: 1, kind: 'text', color: '#111827', width: 0.004, x: 0.1, y: 0.1, w: 0.3, h: 0.05, text: 'Hello note', size: 0.02 },
    { page: 1, kind: 'highlight', color: '#fde047', width: 0.004, x: 0.1, y: 0.2, w: 0.3, h: 0.03 },
    { page: 1, kind: 'pen', color: '#e11d48', width: 0.004, x: 0.1, y: 0.3, w: 0.2, h: 0.1, points: [[[0.1, 0.3], [0.2, 0.4], [0.3, 0.35]]] },
    { page: 1, kind: 'arrow', color: '#2563eb', width: 0.004, x: 0.5, y: 0.5, w: 0.1, h: 0.1, points: [[[0.5, 0.6], [0.6, 0.5]]] },
    { page: 2, kind: 'comment', color: '#f59e0b', width: 0.004, x: 0.8, y: 0.1, w: 0, h: 0, text: 'Check' },
  ];
  const blank = async () => {
    const d = await PDFDocument.create();
    d.addPage([612, 792]);
    d.addPage([612, 792]);
    return d.save();
  };

  it('adds real, editable annotations', async () => {
    const out = await annotate(await blank(), marks, { flatten: false, author: 'S' });
    const doc = new mupdf.PDFDocument(out);
    const types = doc.loadPage(0).getAnnotations().map((a) => a.getType());
    expect(types).toEqual(['FreeText', 'Highlight', 'Ink', 'Line']);
    const note = doc.loadPage(1).getAnnotations()[0];
    expect([note.getType(), note.getContents(), note.getAuthor()]).toEqual(['Text', 'Check', 'S']);
    // Text box sits where it was placed (fractions of a 612 × 792 page).
    const [x0, y0] = doc.loadPage(0).getAnnotations()[0].getRect();
    expect([Math.round(x0), Math.round(y0)]).toEqual([61, 79]);
  });

  it('flattens annotations into the page', async () => {
    const out = await annotate(await blank(), marks, { flatten: true, author: '' });
    const doc = new mupdf.PDFDocument(out);
    expect(doc.loadPage(0).getAnnotations()).toHaveLength(0);
    expect(doc.loadPage(0).toStructuredText('').asText()).toContain('Hello note');
  });
});
