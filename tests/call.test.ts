import { describe, expect, it } from 'vitest';
import { formatDuration, parseSignal } from '../src/core/call';

describe('call signalling', () => {
  it('accepts well-formed signals', () => {
    expect(parseSignal({ c: 'ring', id: 'a1', video: true })).toEqual({ c: 'ring', id: 'a1', video: true });
    expect(parseSignal({ c: 'decline', id: 'a1', reason: 'busy' })).toEqual({ c: 'decline', id: 'a1', reason: 'busy' });
    expect(parseSignal({ c: 'media', id: 'a1', audio: false, video: true })).toEqual({ c: 'media', id: 'a1', audio: false, video: true });
    expect(parseSignal({ c: 'sdp', id: 'a1', sdp: { type: 'offer', sdp: 'v=0' } })).toEqual({ c: 'sdp', id: 'a1', sdp: { type: 'offer', sdp: 'v=0' } });
  });

  it('drops anything else', () => {
    expect(parseSignal(null)).toBeNull();
    expect(parseSignal('ring')).toBeNull();
    expect(parseSignal({ c: 'explode', id: 'a1' })).toBeNull();
    expect(parseSignal({ c: 'ring' })).toBeNull();
    expect(parseSignal({ c: 'ring', id: 'x'.repeat(65) })).toBeNull();
    expect(parseSignal({ c: 'sdp', id: 'a1', sdp: { type: 'rollback', sdp: '' } })).toBeNull();
    expect(parseSignal({ c: 'sdp', id: 'a1' })).toBeNull();
    // Unknown fields and reasons are left out.
    expect(parseSignal({ c: 'decline', id: 'a1', reason: 'nope', extra: 1 })).toEqual({ c: 'decline', id: 'a1' });
    expect(parseSignal({ c: 'ring', id: 'a1', video: 'yes' })).toEqual({ c: 'ring', id: 'a1' });
  });

  it('formats call lengths', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
