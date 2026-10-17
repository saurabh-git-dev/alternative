import { describe, expect, it } from 'vitest';
import { Channel, authTag, deriveKeys, newSecret, sdpFingerprint, verifyTag } from '../src/core/direct-crypto';
import { inviteLink, parseInvite } from '../src/core/direct';

const HOST_FP = 'aa:bb:cc';
const GUEST_FP = 'dd:ee:ff';
const MITM_FP = '11:22:33';

describe('direct transfer security', () => {
  it('accepts tags from a peer that sees the same certificates', async () => {
    const secret = newSecret();
    const host = await deriveKeys(secret, 'host');
    const guest = await deriveKeys(secret, 'guest');
    const fromGuest = await authTag(guest, 'guest', GUEST_FP, HOST_FP);
    const fromHost = await authTag(host, 'host', HOST_FP, GUEST_FP);
    expect(await verifyTag(host, 'guest', HOST_FP, GUEST_FP, fromGuest)).toBe(true);
    expect(await verifyTag(guest, 'host', GUEST_FP, HOST_FP, fromHost)).toBe(true);
  });

  it('rejects a man in the middle, even one relaying real tags', async () => {
    const secret = newSecret();
    const host = await deriveKeys(secret, 'host');
    const guest = await deriveKeys(secret, 'guest');
    // The guest is really talking to the attacker's certificate.
    const fromGuest = await authTag(guest, 'guest', GUEST_FP, MITM_FP);
    // The host sees the attacker's certificate as its peer.
    expect(await verifyTag(host, 'guest', HOST_FP, MITM_FP, fromGuest)).toBe(false);
    // A tag made without the secret fails too.
    const wrong = await deriveKeys(newSecret(), 'guest');
    expect(await verifyTag(host, 'guest', HOST_FP, GUEST_FP, await authTag(wrong, 'guest', GUEST_FP, HOST_FP))).toBe(false);
  });

  it('seals and opens messages in order, and refuses replays', async () => {
    const secret = newSecret();
    const a = new Channel(await deriveKeys(secret, 'host'));
    const b = new Channel(await deriveKeys(secret, 'guest'));
    const one = await a.seal(new TextEncoder().encode('one'));
    const two = await a.seal(new TextEncoder().encode('two'));
    expect(new TextDecoder().decode(await b.open(one))).toBe('one');
    await expect(b.open(one)).rejects.toThrow(/security check/);
    // Reverse direction uses its own key: a host frame can't be opened as a guest frame.
    const c = new Channel(await deriveKeys(secret, 'host'));
    await expect(c.open(two)).rejects.toThrow(/security check/);
  });

  it('reads fingerprints from an SDP', () => {
    expect(sdpFingerprint('v=0\r\na=fingerprint:sha-256 AB:CD:EF\r\n')).toBe('ab:cd:ef');
    expect(() => sdpFingerprint('v=0')).toThrow();
  });

  it('round-trips invite links', () => {
    const invite = { peerId: 'fmt-0123abcd', secret: newSecret(), hostSends: false };
    const link = inviteLink('https://example.com/app/', invite);
    const parsed = parseInvite(link.slice(link.indexOf('#')));
    expect(parsed).toEqual(invite);
    expect(parseInvite('#/d/fmt-1.short.s')).toBeNull();
  });
});
