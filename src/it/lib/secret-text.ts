/**
 * Encrypt text with a password, e.g. to send a secret through a QR code or
 * chat. AES-256-GCM with a key from PBKDF2-SHA-256 (600 000 iterations, the
 * OWASP 2023 figure), all in Web Crypto.
 *
 * Output: Base64 of  1-byte version (1) | 16-byte salt | 12-byte IV | ciphertext+tag
 */
import { base64ToBytes, bytesToBase64 } from './encoding';

const VERSION = 1;
const ITERATIONS = 600_000;

async function keyFor(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(text: string, password: string): Promise<string> {
  if (!password) throw new Error('Enter a password to encrypt with.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(password, salt), new TextEncoder().encode(text)),
  );
  const out = new Uint8Array(1 + 16 + 12 + sealed.length);
  out[0] = VERSION;
  out.set(salt, 1);
  out.set(iv, 17);
  out.set(sealed, 29);
  return bytesToBase64(out);
}

export async function decryptText(encoded: string, password: string): Promise<string> {
  if (!password) throw new Error('Enter the password.');
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(encoded);
  } catch {
    throw new Error('This is not text encrypted by this tool.');
  }
  if (bytes[0] !== VERSION || bytes.length < 29 + 16) throw new Error('This is not text encrypted by this tool.');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(17, 29) as BufferSource },
      await keyFor(password, bytes.subarray(1, 17)),
      bytes.subarray(29) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Wrong password, or the text was changed.');
  }
}
