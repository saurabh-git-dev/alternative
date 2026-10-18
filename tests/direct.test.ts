import { describe, expect, it } from 'vitest';
import { Channel, authKey, authTag, channelKeys, newNonce, newSecret, sdpFingerprint, verifyTag } from '../src/core/direct-crypto';
import { inviteLink, parseInvite } from '../src/core/direct';

const HOST_FP = 'aa:bb:cc';
const GUEST_FP = 'dd:ee:ff';
const MITM_FP = '11:22:33';

describe('direct transfer security', () => {
  it('accepts tags from a peer that sees the same certificates', async () => {
    const secret = newSecret();
    const key = await authKey(secret);
    const [hn, gn] = [newNonce(), newNonce()];
    const fromGuest = await authTag(key, 'guest', GUEST_FP, HOST_FP, gn);
    const fromHost = await authTag(key, 'host', HOST_FP, GUEST_FP, hn);
    expect(await verifyTag(key, 'guest', HOST_FP, GUEST_FP, gn, fromGuest)).toBe(true);
    expect(await verifyTag(key, 'host', GUEST_FP, HOST_FP, hn, fromHost)).toBe(true);
    // A swapped nonce breaks the tag.
    expect(await verifyTag(key, 'guest', HOST_FP, GUEST_FP, hn, fromGuest)).toBe(false);
  });

  it('rejects a man in the middle, even one relaying real tags', async () => {
    const secret = newSecret();
    const key = await authKey(secret);
    const gn = newNonce();
    // The guest is really talking to the attacker's certificate.
    const fromGuest = await authTag(key, 'guest', GUEST_FP, MITM_FP, gn);
    // The host sees the attacker's certificate as its peer.
    expect(await verifyTag(key, 'guest', HOST_FP, MITM_FP, gn, fromGuest)).toBe(false);
    // A tag made without the secret fails too.
    const wrong = await authKey(newSecret());
    expect(await verifyTag(key, 'guest', HOST_FP, GUEST_FP, gn, await authTag(wrong, 'guest', GUEST_FP, HOST_FP, gn))).toBe(false);
  });

  it('seals and opens messages in order, refuses replays, and uses new keys per connection', async () => {
    const secret = newSecret();
    const [hn, gn] = [newNonce(), newNonce()];
    const a = new Channel(await channelKeys(secret, 'host', hn, gn));
    const b = new Channel(await channelKeys(secret, 'guest', hn, gn));
    const one = await a.seal(new TextEncoder().encode('one'));
    const two = await a.seal(new TextEncoder().encode('two'));
    expect(new TextDecoder().decode(await b.open(one))).toBe('one');
    await expect(b.open(one)).rejects.toThrow(/security check/);
    // Reverse direction uses its own key: a host frame can't be opened as a guest frame.
    const c = new Channel(await channelKeys(secret, 'host', hn, gn));
    await expect(c.open(two)).rejects.toThrow(/security check/);
    // A reconnect (new nonces) can't open frames from the old connection.
    const d = new Channel(await channelKeys(secret, 'guest', newNonce(), gn));
    await expect(d.open(one)).rejects.toThrow(/security check/);
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

describe('scanned codes', () => {
  it('opens invites and share links, from any copy of the site', async () => {
    const { routeFromScan } = await import('../src/core/direct');
    expect(routeFromScan('https://x.github.io/alternative/#/d/fmt-1.AAAAAAAAAAAAAAAAAAAAAA.s')).toBe('#/d/fmt-1.AAAAAAAAAAAAAAAAAAAAAA.s');
    expect(routeFromScan('http://localhost:5173/#/q/ABC')).toBe('#/q/ABC');
    expect(routeFromScan('https://example.com/page')).toBeNull();
    expect(routeFromScan('hello')).toBeNull();
  });
});

describe('device names', () => {
  it('names common phones, tablets and computers with their browser', async () => {
    const { deviceName } = await import('../src/core/device');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 5)).toBe('iPhone · Safari');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 5)).toBe('iPad · Safari');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', 5)).toBe('Android phone · Chrome');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0', 0)).toBe('Windows · Edge');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0', 0)).toBe('Mac · Firefox');
  });
});
