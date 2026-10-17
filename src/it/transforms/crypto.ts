/** Hashes, HMAC and password-encrypted text. */
import type { OutputRow, TransformSpec } from '../types';
import { HASH_ALGORITHMS, digest, encodeDigest, hmac as hmacBytes, type DigestEncoding, type HashAlgorithm } from '../lib/hash';
import { decryptText, encryptText } from '../lib/secret-text';

const encoding = {
  kind: 'choice' as const,
  label: 'Output',
  default: 'hex',
  choices: [
    { value: 'hex', label: 'hex' },
    { value: 'HEX', label: 'HEX' },
    { value: 'base64', label: 'Base64' },
  ],
};

export const hash: TransformSpec = {
  input: { sample: 'The quick brown fox jumps over the lazy dog' },
  options: { encoding },
  run: async (input, o): Promise<OutputRow[]> => {
    const bytes = new TextEncoder().encode(input);
    return Promise.all(
      HASH_ALGORITHMS.map(async (a) => ({ label: a, value: encodeDigest(await digest(a, bytes), o.encoding as DigestEncoding) })),
    );
  },
  output: { name: 'hashes' },
};

export const hmac: TransformSpec = {
  input: { sample: 'message to sign', label: 'Message' },
  options: {
    key: { kind: 'text', label: 'Secret key', default: '', placeholder: 'key', secret: true },
    algorithm: {
      kind: 'choice',
      label: 'Algorithm',
      default: 'SHA-256',
      choices: HASH_ALGORITHMS.filter((a) => a !== 'MD5').map((a) => ({ value: a, label: `HMAC-${a}` })),
    },
    encoding,
  },
  sensitive: true,
  run: async (input, o) => {
    if (!o.key) throw new Error('Enter the secret key to sign with.');
    const enc = new TextEncoder();
    const mac = await hmacBytes(o.algorithm as Exclude<HashAlgorithm, 'MD5'>, enc.encode(String(o.key)), enc.encode(input));
    return encodeDigest(mac, o.encoding as DigestEncoding);
  },
  output: { name: 'hmac' },
};

export const encrypt: TransformSpec = {
  input: { placeholder: 'Text to encrypt, or encrypted text to decrypt…', sample: 'The door code is 4821.' },
  options: {
    mode: {
      kind: 'choice',
      label: 'Direction',
      default: 'encode',
      choices: [
        { value: 'encode', label: 'Encrypt' },
        { value: 'decode', label: 'Decrypt' },
      ],
    },
    password: { kind: 'text', label: 'Password', default: '', placeholder: 'Shared password', secret: true },
  },
  direction: 'mode',
  sensitive: true,
  run: (input, o) => (!input ? '' : o.mode === 'encode' ? encryptText(input, String(o.password)) : decryptText(input.trim(), String(o.password))),
  output: { name: 'encrypted' },
};
