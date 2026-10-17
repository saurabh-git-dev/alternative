/**
 * Random identifiers and secrets: UUID v4/v7, ULID, passwords and tokens.
 * All randomness comes from `crypto.getRandomValues`, with rejection sampling
 * so every character is equally likely.
 */

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Uniform random integer in [0, max), max ≤ 2^32. */
export function randomInt(max: number): number {
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function formatUuid(bytes: Uint8Array): string {
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function uuidV4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

/** RFC 9562 v7: 48-bit Unix milliseconds, then random bits. Sorts by creation time. */
export function uuidV7(now = Date.now()): string {
  const b = randomBytes(16);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 10 characters of timestamp + 16 random, Crockford Base32. */
export function ulid(now = Date.now()): string {
  let time = '';
  for (let i = 0, t = now; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[randomInt(32)];
  return time + rand;
}

/** Timestamp inside a UUID v7 or ULID, or null for other ids. */
export function idTimestamp(id: string): Date | null {
  const s = id.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return new Date(parseInt(s.replace(/-/g, '').slice(0, 12), 16));
  }
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(s)) {
    let t = 0;
    for (const c of s.slice(0, 10).toUpperCase()) t = t * 32 + CROCKFORD.indexOf(c);
    return new Date(t);
  }
  return null;
}

export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>/?~',
} as const;
/** Characters people mix up when reading or typing a password. */
const AMBIGUOUS = /[Il1O0o|`'"]/g;

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Leave out I, l, 1, O, 0 … so the password is easy to read off a screen. */
  readable: boolean;
}

/** A random password with at least one character from every chosen set. */
export function password(o: PasswordOptions): string {
  const sets = (['lower', 'upper', 'digits', 'symbols'] as const)
    .filter((k) => o[k])
    .map((k) => (o.readable ? CHARSETS[k].replace(AMBIGUOUS, '') : CHARSETS[k]));
  if (!sets.length) throw new Error('Pick at least one kind of character.');
  const all = sets.join('');
  const length = Math.max(o.length, sets.length);
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Fisher–Yates, so the guaranteed characters aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Bits of entropy of a random password of `length` drawn from `alphabet` characters. */
export function entropyBits(length: number, alphabet: number): number {
  return alphabet > 1 ? Math.round(length * Math.log2(alphabet)) : 0;
}

export function token(bytes: number, encoding: 'hex' | 'base64url'): string {
  const b = randomBytes(bytes);
  if (encoding === 'hex') return hex(b);
  let binary = '';
  for (const x of b) binary += String.fromCharCode(x);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
