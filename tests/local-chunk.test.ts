import { describe, expect, it } from 'vitest';
import { chunkPayload } from '../src/core/local';

/** What Tauri's postMessage bridge (used on Android) does to a payload: JSON with Uint8Arrays as number arrays. */
const throughAndroidBridge = (payload: unknown) =>
  JSON.parse(JSON.stringify({ payload }, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v))).payload;

const sample = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);

describe('chunkPayload', () => {
  it('passes the bytes straight through on computers', () => {
    const bytes = sample(10);
    expect(chunkPayload(bytes, false)).toBe(bytes);
  });

  it('sends base64 on Android that survives the JSON bridge', () => {
    // Bigger than one String.fromCharCode batch, with every byte value.
    const bytes = sample(100_000);
    const sent = throughAndroidBridge(chunkPayload(bytes, true));
    expect(typeof sent.data).toBe('string');
    expect(Uint8Array.from(atob(sent.data), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it('a raw Uint8Array would not arrive as raw bytes on Android', () => {
    // The original bug: the native side only took a raw body ("expected raw bytes").
    expect(Array.isArray(throughAndroidBridge(sample(3)))).toBe(true);
  });

  it('handles an empty file', () => {
    expect(throughAndroidBridge(chunkPayload(new Uint8Array(0), true))).toEqual({ data: '' });
  });
});
