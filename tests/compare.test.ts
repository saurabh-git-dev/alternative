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
