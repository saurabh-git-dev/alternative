/**
 * Share links: a whole file packed into a URL, so it can travel by QR code,
 * chat or email with no server in between.
 *
 * Link shapes (everything lives in the URL fragment, which browsers never
 * send to the server, so GitHub Pages only ever sees a request for the app):
 *
 *   <app>#/s/<base64url>   the copyable link: shortest text form.
 *   <app>#/q/<base43>      the QR form: the payload uses only characters of
 *                          the QR "alphanumeric" mode (0-9 A-Z $*+-./:),
 *                          which packs 5.5 bits per character instead of 8,
 *                          so a QR code holds ~29% more data than with base64.
 *
 * Both carry the same packed bytes:
 *
 *   byte 0      format: 1 = stored, 2 = deflate (whichever is smaller)
 *   then        (inflated) body:
 *               u8 type code (TYPE_CODES; 0 = custom type string follows)
 *               [u8 length + ASCII type, only for code 0]
 *               u8 name length + UTF-8 name (length 0 = no name)
 *               file bytes
 *
 * Pure functions only, so they run in workers, the UI and unit tests alike.
 */
import { deflateSync, inflateSync } from 'fflate';
import { TYPE_EXTENSIONS } from './files';
import type { FileData } from './types';

const FORMAT_STORED = 1;
const FORMAT_DEFLATE = 2;

/** One-byte codes for the common types, so they cost 1 byte instead of ~15. */
const TYPE_CODES = [
  '', // 0: custom, spelled out
  'text/plain',
  'text/csv',
  'application/json',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
] as const;

/** Route prefixes, without the leading `#`. */
export const LINK_ROUTE = '/s/';
export const QR_ROUTE = '/q/';

/**
 * Largest link we produce. Chrome and Firefox accept URLs of a few MB, but
 * the address bar and most apps become sluggish long before that.
 */
export const MAX_LINK_CHARS = 2_000_000;
/** Beyond this, chat apps and email clients may cut the link off. */
export const LONG_LINK_CHARS = 64_000;

export class ShareError extends Error {}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/** Pack a file into bytes, compressed when that makes it smaller. */
export function pack(file: FileData, options: { includeName?: boolean } = {}): Uint8Array {
  const code = TYPE_CODES.indexOf(file.type as (typeof TYPE_CODES)[number]);
  const typeBytes = code > 0 ? new Uint8Array([code]) : concat([new Uint8Array([0]), shortString(new TextEncoder().encode(file.type))]);
  const name = options.includeName === false ? new Uint8Array() : new TextEncoder().encode(file.name);
  const body = concat([typeBytes, shortString(truncateUtf8(name, 255)), file.bytes]);

  const deflated = deflateSync(body, { level: 9 });
  return deflated.length < body.length
    ? concat([new Uint8Array([FORMAT_DEFLATE]), deflated])
    : concat([new Uint8Array([FORMAT_STORED]), body]);
}

/** Reverse of `pack`. Throws ShareError for damaged or cut-off data. */
export function unpack(packed: Uint8Array): FileData {
  let body: Uint8Array;
  try {
    if (packed[0] === FORMAT_STORED) body = packed.subarray(1);
    else if (packed[0] === FORMAT_DEFLATE) body = inflateSync(packed.subarray(1));
    else throw new Error();
  } catch {
    throw new ShareError(damaged);
  }
  let at = 0;
  const read = (n: number) => {
    if (at + n > body.length) throw new ShareError(damaged);
    const part = body.subarray(at, at + n);
    at += n;
    return part;
  };
  const code = read(1)[0];
  const type = code === 0 ? new TextDecoder().decode(read(read(1)[0])) : TYPE_CODES[code];
  if (type === undefined) throw new ShareError(damaged);
  const name = new TextDecoder().decode(read(read(1)[0])) || `shared.${extensionFor(type)}`;
  return { name, type, bytes: body.slice(at) };
}

const damaged = 'This link is incomplete or damaged. It may have been cut off when it was sent; ask for it again.';

function extensionFor(type: string): string {
  return TYPE_EXTENSIONS[type] ?? { 'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[type] ?? 'bin';
}

function shortString(bytes: Uint8Array): Uint8Array {
  return concat([new Uint8Array([bytes.length]), bytes]);
}

/** Cut UTF-8 bytes to at most `max` without splitting a character. */
function truncateUtf8(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes;
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text encodings
// ---------------------------------------------------------------------------

/** RFC 4648 base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  let binary: string;
  try {
    binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  } catch {
    throw new ShareError(damaged);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * QR alphanumeric characters that are also safe, unescaped, in a URL
 * fragment (the QR set minus space and `%`). Two bytes become three
 * characters, the same scheme as base45 (RFC 9285) with a 43-letter alphabet:
 * 65 535 < 43³.
 */
const BASE43 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';

export function toBase43(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = bytes[i] * 256 + bytes[i + 1];
    for (let k = 0; k < 3; k++, n = Math.floor(n / 43)) out += BASE43[n % 43];
  }
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1];
    out += BASE43[n % 43] + BASE43[Math.floor(n / 43)];
  }
  return out;
}

export function fromBase43(text: string): Uint8Array {
  if (text.length % 3 === 1) throw new ShareError(damaged);
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 ? 1 : 0));
  const digit = (c: string) => {
    const d = BASE43.indexOf(c);
    if (d < 0) throw new ShareError(damaged);
    return d;
  };
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    if (i + 2 < text.length) {
      const n = digit(text[i]) + digit(text[i + 1]) * 43 + digit(text[i + 2]) * 1849;
      if (n > 0xffff) throw new ShareError(damaged);
      out[o++] = n >> 8;
      out[o++] = n & 255;
    } else {
      const n = digit(text[i]) + digit(text[i + 1]) * 43;
      if (n > 0xff) throw new ShareError(damaged);
      out[o++] = n;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links and QR capacity
// ---------------------------------------------------------------------------

/** `https://host/app/` for the running app, without any fragment. */
export function appUrl(location: { origin: string; pathname: string }): string {
  return location.origin + location.pathname;
}

export function linkFor(base: string, packed: Uint8Array): string {
  return `${base}#${LINK_ROUTE}${toBase64Url(packed)}`;
}

/** QR content as two segments: the URL prefix in byte mode, the payload in alphanumeric mode. */
export function qrSegmentsFor(base: string, packed: Uint8Array): { prefix: string; payload: string } {
  return { prefix: `${base}#${QR_ROUTE}`, payload: toBase43(packed) };
}

/** Decode a `#/s/…` or `#/q/…` fragment; null if the fragment isn't a share link. */
export function decodeFragment(hash: string): FileData | null {
  const route = hash.replace(/^#/, '');
  if (route.startsWith(LINK_ROUTE)) return unpack(fromBase64Url(route.slice(LINK_ROUTE.length)));
  if (route.startsWith(QR_ROUTE)) return unpack(fromBase43(decodeURIComponent(route.slice(QR_ROUTE.length))));
  return null;
}

export type QrErrorCorrection = 'L' | 'M' | 'Q';

/** Data bits of a version-40 QR code per error-correction level (ISO/IEC 18004 table 7). */
const V40_DATA_BITS: Record<QrErrorCorrection, number> = { L: 2956 * 8, M: 2334 * 8, Q: 1666 * 8 };

/**
 * Most packed bytes a single QR code can carry after the URL prefix, for the
 * largest QR version (40, 177×177 modules). Byte-mode segment: 4-bit mode +
 * 16-bit count + 8 bits/char. Alphanumeric: 4 + 13 + 11 bits per 2 chars.
 */
export function qrCapacity(prefix: string, level: QrErrorCorrection): number {
  const prefixBits = 4 + 16 + 8 * new TextEncoder().encode(prefix).length;
  const free = V40_DATA_BITS[level] - prefixBits - 4 - 13;
  if (free <= 0) return 0;
  const chars = Math.floor(free / 11) * 2 + (free % 11 >= 6 ? 1 : 0);
  return Math.floor(chars / 3) * 2 + (chars % 3 === 2 ? 1 : 0);
}
