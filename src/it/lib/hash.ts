/**
 * Hashes and HMAC. SHA-1/256/384/512 use the browser's Web Crypto; MD5 isn't
 * in Web Crypto (it's broken for security) but is still everywhere as a
 * checksum, so it's implemented here (RFC 1321).
 */
import { bytesToBase64 } from './encoding';

export const HASH_ALGORITHMS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];
export type DigestEncoding = 'hex' | 'HEX' | 'base64';

export async function digest(algorithm: HashAlgorithm, data: Uint8Array): Promise<Uint8Array> {
  if (algorithm === 'MD5') return md5(data);
  return new Uint8Array(await crypto.subtle.digest(algorithm, data as BufferSource));
}

export async function hmac(algorithm: Exclude<HashAlgorithm, 'MD5'>, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}

export function encodeDigest(bytes: Uint8Array, encoding: DigestEncoding): string {
  if (encoding === 'base64') return bytesToBase64(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return encoding === 'HEX' ? hex.toUpperCase() : hex;
}

// ---------------------------------------------------------------------------
// MD5
// ---------------------------------------------------------------------------

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(data: Uint8Array): Uint8Array {
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (data.length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(data.length / 0x20000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) (f = (b & c) | (~b & d)), (g = i);
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) % 16);
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) % 16);
      else (f = c ^ (b | ~d)), (g = (7 * i) % 16);
      const s = S[(i >> 4) * 4 + (i % 4)];
      const sum = (a + f + K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return out;
}
