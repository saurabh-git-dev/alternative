/**
 * Security for direct (device-to-device) transfers. See core/direct.ts for
 * the transfer itself.
 *
 * WebRTC already encrypts every connection with DTLS, but the two browsers
 * learn each other's DTLS certificate through the matchmaking server, so a
 * dishonest server could put itself in the middle. Two things stop that:
 *
 * 1. A 128-bit secret travels only in the QR code / link fragment, which no
 *    server ever sees. Right after connecting, each side sends
 *    HMAC(secret, role ‖ its certificate fingerprint ‖ the peer's fingerprint).
 *    Someone in the middle holds two different DTLS sessions, so the
 *    fingerprints each side sees don't match and the check fails; without the
 *    secret they can't forge a tag either. The transfer starts only after
 *    both checks pass.
 * 2. Every message after that is also sealed with AES-256-GCM under keys
 *    derived from the secret (one key per direction, a counter as the nonce),
 *    so the bytes stay private and in order even if DTLS were broken, and the
 *    TURN relay that carries traffic on strict networks sees only ciphertext.
 *
 * Pure WebCrypto, so it runs in the page, workers and unit tests alike.
 */

export type Role = 'host' | 'guest';

const SALT = new TextEncoder().encode('formatter-direct-v1');
const enc = new TextEncoder();

export function newSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export interface SessionKeys {
  auth: CryptoKey;
  /** Seals what this side sends. */
  send: CryptoKey;
  /** Opens what the other side sends. */
  receive: CryptoKey;
}

export async function deriveKeys(secret: Uint8Array, role: Role): Promise<SessionKeys> {
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey']);
  const derive = (info: string, algorithm: HmacImportParams | AesKeyAlgorithm, usages: KeyUsage[]) =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }, base, algorithm, false, usages);
  const aes = { name: 'AES-GCM', length: 256 };
  const [auth, hostToGuest, guestToHost] = await Promise.all([
    derive('auth', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign', 'verify']),
    derive('host->guest', aes, ['encrypt', 'decrypt']),
    derive('guest->host', aes, ['encrypt', 'decrypt']),
  ]);
  return role === 'host' ? { auth, send: hostToGuest, receive: guestToHost } : { auth, send: guestToHost, receive: hostToGuest };
}

/** SHA-256 certificate fingerprint from an SDP, normalised to lower case. */
export function sdpFingerprint(sdp: string | undefined): string {
  const match = sdp?.match(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/m);
  if (!match) throw new Error('The connection has no certificate fingerprint.');
  return match[1].toLowerCase();
}

function authMessage(role: Role, own: string, peer: string): Uint8Array {
  return enc.encode(`${role}|${own}|${peer}`);
}

/** Proof that this side, holding the secret, sees `own` and `peer` as the two certificates. */
export async function authTag(keys: SessionKeys, role: Role, own: string, peer: string): Promise<string> {
  const tag = await crypto.subtle.sign('HMAC', keys.auth, authMessage(role, own, peer) as BufferSource);
  return toB64url(new Uint8Array(tag));
}

/** Check the other side's tag: it must have seen the same two certificates, from its own point of view. */
export async function verifyTag(keys: SessionKeys, peerRole: Role, own: string, peer: string, tag: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', keys.auth, fromB64url(tag) as BufferSource, authMessage(peerRole, peer, own) as BufferSource);
  } catch {
    return false;
  }
}

function nonce(counter: number): Uint8Array {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setBigUint64(4, BigInt(counter));
  return iv;
}

/**
 * Seals outgoing messages and opens incoming ones. Each direction counts its
 * messages, and the count is the nonce, so a dropped, repeated or reordered
 * message fails to open.
 */
export class Channel {
  private sent = 0;
  private received = 0;
  constructor(private keys: SessionKeys) {}

  async seal(plain: Uint8Array): Promise<ArrayBuffer> {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(this.sent++) as BufferSource }, this.keys.send, plain as BufferSource);
  }

  async open(sealed: ArrayBuffer): Promise<Uint8Array> {
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(this.received++) as BufferSource }, this.keys.receive, sealed));
    } catch {
      throw new Error('A piece of the transfer failed its security check, so it was stopped.');
    }
  }
}
