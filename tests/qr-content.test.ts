import { describe, expect, it } from 'vitest';
import { parseKeyValues, parseQrContent } from '../src/it/lib/qr-content';

const value = (text: string, label: string) => parseQrContent(text).fields.find((f) => f.label === label)?.value;

describe('QR code content', () => {
  it('reads links', () => {
    const c = parseQrContent('https://example.com/a?b=1');
    expect(c.kind).toBe('url');
    expect(c.open?.href).toBe('https://example.com/a?b=1');
    expect(parseQrContent('www.example.com').open?.href).toBe('https://www.example.com');
    expect(parseQrContent('upi://pay?pa=a@b').title).toBe('App link');
    expect(parseQrContent('javascript://x%0Aalert(1)').kind).toBe('text');
  });

  it('reads Wi-Fi logins, with escapes', () => {
    const c = parseQrContent('WIFI:T:WPA;S:My\\;Net;P:pa\\:ss\\\\word;H:true;;');
    expect(c.kind).toBe('wifi');
    expect(value('WIFI:T:WPA;S:My\\;Net;P:pa\\:ss\\\\word;H:true;;', 'Network name')).toBe('My;Net');
    expect(c.fields.find((f) => f.label === 'Password')).toEqual({ label: 'Password', value: 'pa:ss\\word', secret: true });
    expect(value('WIFI:T:WPA;S:x;P:y;H:true;;', 'Hidden')).toBe('Yes');
    expect(value('WIFI:T:nopass;S:Cafe;;', 'Security')).toBe('None (open)');
    expect(value('wifi:S:Cafe;T:WEP;P:k;;', 'Security')).toBe('WEP');
  });

  it('splits key/value codes', () => {
    expect(parseKeyValues('TO:a@b.c;SUB:Hi\\; there;;')).toEqual([
      ['TO', 'a@b.c'],
      ['SUB', 'Hi; there'],
    ]);
  });

  it('reads vCards', () => {
    const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane;;Dr.;\r\nTEL;TYPE=CELL:+1 555 0100\r\nEMAIL:jane@example.com\r\nORG:Acme\\, Inc.\r\nADR:;;1 Main St;Springfield;;12345;USA\r\nEND:VCARD';
    const c = parseQrContent(card);
    expect(c.kind).toBe('contact');
    expect(value(card, 'Name')).toBe('Dr. Jane Doe');
    expect(value(card, 'Phone')).toBe('+1 555 0100');
    expect(value(card, 'Organization')).toBe('Acme, Inc.');
    expect(value(card, 'Address')).toBe('1 Main St, Springfield, 12345, USA');
    expect(c.open?.href).toBe('tel:+15550100');
    expect(c.file?.name).toBe('Dr. Jane Doe.vcf');
    expect(c.file?.text).toBe(card);
  });

  it('reads MECARDs and turns them into vCards', () => {
    const c = parseQrContent('MECARD:N:Doe,John;TEL:5550100;EMAIL:j@x.org;URL:https://x.org;;');
    expect(c.kind).toBe('contact');
    expect(value('MECARD:N:Doe,John;;', 'Name')).toBe('John Doe');
    expect(c.file?.text).toContain('FN:John Doe');
    expect(c.file?.text).toContain('TEL:5550100');
    expect(c.file?.text).toMatch(/^BEGIN:VCARD\r\n[\s\S]*END:VCARD$/);
  });

  it('reads email, phone and text message codes', () => {
    expect(parseQrContent('mailto:a@b.c?subject=Hi%20there').open?.href).toBe('mailto:a@b.c?subject=Hi%20there');
    expect(value('mailto:a@b.c?subject=Hi%20there', 'Subject')).toBe('Hi there');
    const m = parseQrContent('MATMSG:TO:a@b.c;SUB:Hello;BODY:Text;;');
    expect(m.kind).toBe('email');
    expect(m.open?.href).toBe('mailto:a@b.c?subject=Hello&body=Text');
    expect(parseQrContent('tel:+1-555-0100').open?.href).toBe('tel:+15550100');
    const s = parseQrContent('SMSTO:+15550100:Hi: there');
    expect(s.kind).toBe('sms');
    expect(value('SMSTO:+15550100:Hi: there', 'Message')).toBe('Hi: there');
    expect(parseQrContent('sms:+15550100?body=Yo').open?.href).toBe('sms:+15550100?body=Yo');
  });

  it('reads places', () => {
    const c = parseQrContent('geo:48.8584,2.2945?q=Eiffel+Tower');
    expect(c.kind).toBe('geo');
    expect(value('geo:48.8584,2.2945?q=Eiffel+Tower', 'Place')).toBe('Eiffel Tower');
    expect(c.open?.href).toContain('mlat=48.8584&mlon=2.2945');
  });

  it('reads calendar events and wraps them for saving', () => {
    const c = parseQrContent('BEGIN:VEVENT\nSUMMARY:Team lunch\nDTSTART:20261024T120000Z\nLOCATION:Cafe\nEND:VEVENT');
    expect(c.kind).toBe('event');
    expect(c.fields.map((f) => f.label)).toEqual(['Title', 'Starts', 'Where']);
    expect(c.file?.name).toBe('Team lunch.ics');
    expect(c.file?.text).toMatch(/^BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT[\s\S]*END:VCALENDAR$/);
  });

  it('reads authenticator setups, keeping the secret hidden', () => {
    const code = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
    const c = parseQrContent(code);
    expect(c.kind).toBe('otp');
    expect(value(code, 'Service')).toBe('Example');
    expect(value(code, 'Account')).toBe('alice@example.com');
    expect(c.fields.find((f) => f.label === 'Secret key')?.secret).toBe(true);
  });

  it('falls back to text', () => {
    expect(parseQrContent('Just some words').kind).toBe('text');
    expect(parseQrContent('Just some words').fields).toEqual([]);
  });
});
