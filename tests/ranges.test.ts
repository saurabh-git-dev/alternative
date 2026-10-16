import { describe, expect, it } from 'vitest';
import { parseRangeGroups, parseRanges, rangeSyntaxError } from '../src/core/ranges';

describe('page ranges', () => {
  it('parses lists, open ranges and "last"', () => {
    expect(parseRanges('1-3, 5', 10)).toEqual([1, 2, 3, 5]);
    expect(parseRanges('8-', 10)).toEqual([8, 9, 10]);
    expect(parseRanges('-2', 10)).toEqual([1, 2]);
    expect(parseRanges('last', 10)).toEqual([10]);
    expect(parseRanges('all', 3)).toEqual([1, 2, 3]);
    expect(parseRanges('', 3)).toEqual([1, 2, 3]);
  });

  it('keeps groups separate for splitting', () => {
    expect(parseRangeGroups('1-2,3-', 4)).toEqual([[1, 2], [3, 4]]);
  });

  it('explains bad input in plain words', () => {
    expect(() => parseRanges('12', 10)).toThrow("Page 12 doesn't exist");
    expect(() => parseRanges('5-2', 10)).toThrow('goes backwards');
    expect(rangeSyntaxError('1-3, 5')).toBeNull();
    expect(rangeSyntaxError('abc')).not.toBeNull();
  });
});
