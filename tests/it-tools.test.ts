import { describe, expect, it } from 'vitest';
import { md5, digest, encodeDigest, hmac } from '../src/it/lib/hash';
import { binaryToText, decodeBase64, encodeBase64, escapeHtml, escapeUnicode, fromRoman, textToBinary, toNato, toRoman, unescapeHtml, unescapeUnicode } from '../src/it/lib/encoding';
import { csvToJson, decodeJwt, formatJson, jsonToCsv, jwtDateNotes, parseJson } from '../src/it/lib/data';
import { CASES, slugify, textStats, words } from '../src/it/lib/text';
import { describeCron, nextRuns, parseCron } from '../src/it/lib/cron';
import { subnetRows, urlRows } from '../src/it/lib/network';
import { fromOctal, fromSymbolic, toOctal, toSymbolic } from '../src/it/lib/chmod';
import { contrast, formatColor, parseBigInt, parseColor } from '../src/it/lib/numbers';
import { idTimestamp, password, ulid, uuidV4, uuidV7 } from '../src/it/lib/ids';
import { decryptText, encryptText } from '../src/it/lib/secret-text';
import { parseDate } from '../src/it/lib/datetime';
import { decodeToolState, encodeToolState, publicOptions, resolveOptions } from '../src/it/links';
import { suggestItTools } from '../src/it/suggest';
import { IT_TOOLS } from '../src/it/registry';

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => encodeDigest(b, 'hex');

describe('hashes', () => {
  it('MD5 matches RFC 1321 test vectors', () => {
    expect(hex(md5(enc('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(enc('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(md5(enc('The quick brown fox jumps over the lazy dog')))).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(hex(md5(enc('1234567890'.repeat(8))))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });
  it('SHA-256 and HMAC use Web Crypto', async () => {
    expect(hex(await digest('SHA-256', enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(await hmac('SHA-256', enc('key'), enc('The quick brown fox jumps over the lazy dog')))).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });
});

describe('encodings', () => {
  it('round-trips Base64 with Unicode, URL-safe too', () => {
    for (const s of ['', 'a', 'Hello, world! 👋', 'ÿ~?>']) {
      expect(decodeBase64(encodeBase64(s))).toBe(s);
      expect(decodeBase64(encodeBase64(s, true))).toBe(s);
    }
    expect(() => decodeBase64('abc$')).toThrow(/not valid Base64/);
  });
  it('escapes and unescapes HTML', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    expect(escapeHtml('é', true)).toBe('&#233;');
    expect(unescapeHtml('&lt;b&gt; &amp;amp; &#x1F600; &#233; &copy; &bogus;')).toBe('<b> &amp; 😀 é © &bogus;');
  });
  it('binary, unicode, NATO and Roman numerals', () => {
    expect(textToBinary('Hi')).toBe('01001000 01101001');
    expect(binaryToText('01001000 01101001')).toBe('Hi');
    expect(escapeUnicode('é😀')).toBe('\\u00e9\\ud83d\\ude00');
    expect(unescapeUnicode(escapeUnicode('é😀'))).toBe('é😀');
    expect(unescapeUnicode(escapeUnicode('é😀', 'es6'))).toBe('é😀');
    expect(toNato('Ab1')).toBe('ALFA Bravo One');
    expect(toRoman(2026)).toBe('MMXXVI');
    expect(fromRoman('mcmxciv')).toBe(1994);
    expect(() => fromRoman('IIII')).toThrow();
  });
});

describe('data', () => {
  it('formats JSON and reports where it is broken', () => {
    expect(formatJson('{"b":1,"a":[1,2]}', 0, true)).toBe('{"a":[1,2],"b":1}');
    expect(formatJson('{"a":1}', 2)).toBe('{\n  "a": 1\n}');
    expect(() => parseJson('{\n  "a": 1,\n}')).toThrow(/line 3/);
  });
  it('converts JSON to CSV (flattened) and back', () => {
    const csv = jsonToCsv('[{"id":1,"name":"Ada, L","a":{"b":true}},{"id":2,"x":null}]');
    expect(csv).toBe('id,name,a.b,x\n1,"Ada, L",true,\n2,,,');
    expect(JSON.parse(csvToJson('id;name\n1;Ada\n2;"B ""q"""'))).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: 'B "q"' },
    ]);
  });
  it('decodes a JWT and explains its dates', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiZXhwIjoxMDAwfQ.sig';
    const { header, payload } = decodeJwt(`Bearer ${token}`);
    expect(header.alg).toBe('HS256');
    expect(payload.sub).toBe('1');
    expect(jwtDateNotes(payload, 1_000_000 + 90_000_000)[0]).toMatch(/expired 1 day 1 hour ago/);
    expect(() => decodeJwt('a.b')).toThrow(/three parts/);
  });
});

describe('text', () => {
  it('splits words and converts case', () => {
    expect(words('parseHTTPResponse_code-v2')).toEqual(['parse', 'HTTP', 'Response', 'code', 'v2']);
    const byLabel = Object.fromEntries(CASES.map((c) => [c.label, c.convert('user account ID')]));
    expect(byLabel['camelCase']).toBe('userAccountId');
    expect(byLabel['CONSTANT_CASE']).toBe('USER_ACCOUNT_ID');
    expect(byLabel['kebab-case']).toBe('user-account-id');
  });
  it('slugifies and counts', () => {
    expect(slugify('Héllo Wörld: 10 Tips & Tricks!')).toBe('hello-world-10-tips-tricks');
    const s = textStats('One two. Three!\n\nFour');
    expect([s.words, s.sentences, s.paragraphs, s.lines]).toEqual([4, 3, 2, 3]);
  });
});

describe('cron', () => {
  it('describes common expressions', () => {
    expect(describeCron(parseCron('0 9 * * 1-5'))).toBe('At 09:00, on Monday through Friday.');
    expect(describeCron(parseCron('*/15 * * * *'))).toBe('Every 15 minutes.');
    expect(describeCron(parseCron('@monthly'))).toBe('At 00:00, on day of month 1.');
    expect(() => parseCron('61 * * * *')).toThrow(/out of range/);
  });
  it('finds the next runs, treating 7 as Sunday and OR-ing the day fields', () => {
    const from = new Date(2026, 0, 1, 10, 0); // Thursday
    expect(nextRuns(parseCron('30 10 * * 7'), 2, from).map((d) => d.getDate())).toEqual([4, 11]);
    expect(nextRuns(parseCron('0 0 13 * 5'), 3, from).map((d) => d.getDate())).toEqual([2, 9, 13]);
    expect(nextRuns(parseCron('0 0 29 2 *'), 1, from)[0].getFullYear()).toBe(2028);
  });
});

describe('network, permissions, numbers and colours', () => {
  it('computes IPv4 subnets', () => {
    const rows = Object.fromEntries(subnetRows('192.168.1.42/24').map((r) => [r.label, r.value]));
    expect(rows['Network address']).toBe('192.168.1.0');
    expect(rows['Broadcast address']).toBe('192.168.1.255');
    expect(rows['Number of hosts']).toBe('254');
    expect(rows['Address type']).toMatch(/Private/);
    expect(Object.fromEntries(subnetRows('10.0.0.1 255.255.255.252').map((r) => [r.label, r.value]))['CIDR']).toBe('10.0.0.0/30');
    expect(() => subnetRows('10.0.0.1/33')).toThrow();
  });
  it('parses URLs', () => {
    const rows = urlRows('https://example.com:8080/a?x=1&y=two#top');
    expect(rows.find((r) => r.label === '?y')?.value).toBe('two');
    expect(rows.find((r) => r.label === 'Port')?.value).toBe('8080');
  });
  it('converts chmod both ways', () => {
    expect(toSymbolic(fromOctal('755'))).toBe('rwxr-xr-x');
    expect(toOctal(fromSymbolic('-rwsr-xr-x'))).toBe('4755');
    expect(toSymbolic(fromOctal('1777'))).toBe('rwxrwxrwt');
    expect(toSymbolic(fromOctal('2640'))).toBe('rw-r-S---');
  });
  it('converts number bases exactly, any size', () => {
    expect(parseBigInt('0xff', 16)).toBe(255n);
    expect(parseBigInt('1111_1111', 2)).toBe(255n);
    expect(parseBigInt('18446744073709551615', 10).toString(16)).toBe('ffffffffffffffff');
    expect(() => parseBigInt('12', 2)).toThrow(/not a digit/);
  });
  it('converts colours', () => {
    expect(formatColor(parseColor('#4f46e5')).rgb).toBe('rgb(79 70 229)');
    expect(formatColor(parseColor('hsl(0 100% 50%)')).hex).toBe('#ff0000');
    expect(formatColor(parseColor('rgb(255 0 0 / 50%)')).hex).toBe('#ff000080');
    expect(formatColor(parseColor('hwb(120 0% 0%)')).hex).toBe('#00ff00');
    expect(contrast(parseColor('#000'), parseColor('#fff'))).toBe(21);
  });
});

describe('ids, passwords and encryption', () => {
  it('makes well-formed UUIDs and ULIDs with readable timestamps', () => {
    expect(uuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const t = Date.UTC(2026, 9, 17, 5, 30);
    expect(idTimestamp(uuidV7(t))?.getTime()).toBe(t);
    expect(idTimestamp(ulid(t))?.getTime()).toBe(t);
    expect(idTimestamp(uuidV4())).toBeNull();
  });
  it('generates passwords with every chosen kind of character', () => {
    for (let i = 0; i < 20; i++) {
      const p = password({ length: 8, lower: true, upper: true, digits: true, symbols: false, readable: true });
      expect(p).toHaveLength(8);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/\d/);
      expect(p).not.toMatch(/[Il1O0o]/);
    }
    expect(() => password({ length: 8, lower: false, upper: false, digits: false, symbols: false, readable: false })).toThrow();
  });
  it('encrypts text with a password', async () => {
    const sealed = await encryptText('secret ☕', 'pw');
    expect(sealed).toMatch(/^A[Q-Za-f]/);
    expect(await decryptText(sealed, 'pw')).toBe('secret ☕');
    await expect(decryptText(sealed, 'wrong')).rejects.toThrow(/Wrong password/);
    expect(suggestItTools('text/plain', sealed)[0]).toMatchObject({ tool: 'encrypt', options: { mode: 'decode' } });
  });
});

describe('dates', () => {
  it('reads seconds, milliseconds and ISO strings', () => {
    expect(parseDate('1760693400').toISOString()).toBe('2025-10-17T09:30:00.000Z');
    expect(parseDate('1760693400000').toISOString()).toBe('2025-10-17T09:30:00.000Z');
    expect(parseDate('2026-10-17T09:30:00Z').getTime()).toBe(Date.UTC(2026, 9, 17, 9, 30));
    expect(() => parseDate('not a date')).toThrow();
  });
});

describe('IT tool links and registry', () => {
  it('round-trips tool state in a link, without secrets', () => {
    const specs = { password: { kind: 'text' as const, label: 'p', default: '', secret: true }, mode: { kind: 'choice' as const, label: 'm', default: 'encode', choices: [{ value: 'encode', label: 'e' }, { value: 'decode', label: 'd' }] } };
    const state = { input: '{"a": "ü"}'.repeat(20), options: publicOptions(specs, { password: 'x', mode: 'decode' }) };
    expect(state.options).toEqual({ mode: 'decode' });
    expect(decodeToolState(encodeToolState(state))).toEqual(state);
    expect(decodeToolState('garbage!')).toBeNull();
    expect(resolveOptions(specs, { mode: 'bogus' }, { mode: 'decode' })).toEqual({ password: '', mode: 'decode' });
  });
  it('has unique ids that do not clash with app routes', () => {
    const ids = IT_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reserved of ['tool', 'share', 'scan', 'direct', 'compare', 'pipeline', 's', 'q', 'd']) expect(ids).not.toContain(reserved);
  });
  it('every transform runs its own example', async () => {
    for (const tool of IT_TOOLS) {
      if (tool.load.toString().includes('.svelte')) continue;
      const mod = await tool.load();
      if (!('transform' in mod)) continue;
      const spec = mod.transform;
      const options = resolveOptions(spec.options);
      if (spec.options?.password) options.password = 'pw';
      if (spec.options?.key) options.key = 'key';
      const out = await spec.run(spec.input?.sample ?? '', options);
      expect(out, tool.id).toBeTruthy();
    }
  });
});
