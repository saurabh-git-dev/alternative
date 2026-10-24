/**
 * What a scanned QR code holds: a link, a Wi-Fi login, a contact, an email,
 * a phone number, a text message, a place, a calendar event, a two-factor
 * (authenticator) setup or plain text. Read from the de facto formats phone
 * cameras use (WIFI:, MECARD:, vCard, MATMSG:, SMSTO:, geo:, iCalendar,
 * otpauth://), so the QR code scanner can show the parts and offer the right
 * action.
 */

export type QrKind = 'url' | 'wifi' | 'contact' | 'email' | 'phone' | 'sms' | 'geo' | 'event' | 'otp' | 'text';

export interface QrField {
  label: string;
  value: string;
  /** A password or key: hidden until asked. */
  secret?: boolean;
}

export interface QrContent {
  kind: QrKind;
  /** What it is, for the heading ("Wi-Fi network", "Contact" …). */
  title: string;
  fields: QrField[];
  /** The main thing to do with it: a link to open (web page, mailto:, tel: …). */
  open?: { label: string; href: string };
  /** A file to save, for contacts (.vcf) and events (.ics). */
  file?: { name: string; type: string; text: string };
}

const KIND_TITLES: Record<QrKind, string> = {
  url: 'Link',
  wifi: 'Wi-Fi network',
  contact: 'Contact',
  email: 'Email',
  phone: 'Phone number',
  sms: 'Text message',
  geo: 'Location',
  event: 'Calendar event',
  otp: 'Two-factor login (authenticator)',
  text: 'Text',
};

const field = (label: string, value: string | undefined, secret = false): QrField[] =>
  value ? [{ label, value, ...(secret ? { secret } : {}) }] : [];

/**
 * Split `KEY:value;KEY:value;;` (WIFI:, MECARD:, MATMSG:) into pairs.
 * `\` escapes the next character (\; \, \: \\ \").
 */
export function parseKeyValues(body: string): [string, string][] {
  const pairs: [string, string][] = [];
  let key = '';
  let value = '';
  let inValue = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      (inValue ? (value += body[++i]) : (key += body[++i]));
    } else if (!inValue && c === ':') {
      inValue = true;
    } else if (c === ';') {
      if (key || value) pairs.push([key.trim().toUpperCase(), value]);
      key = value = '';
      inValue = false;
    } else if (inValue) value += c;
    else key += c;
  }
  if (key || value) pairs.push([key.trim().toUpperCase(), value]);
  return pairs;
}

function wifi(text: string): QrContent {
  const pairs = new Map(parseKeyValues(text.slice(5)));
  const security = (pairs.get('T') ?? '').toUpperCase();
  const label = security === 'WEP' ? 'WEP' : security === 'NOPASS' || security === '' ? (pairs.get('P') ? 'WPA / WPA2' : 'None (open)') : security === 'SAE' ? 'WPA3' : 'WPA / WPA2 / WPA3';
  return {
    kind: 'wifi',
    title: KIND_TITLES.wifi,
    fields: [
      ...field('Network name', pairs.get('S')),
      ...field('Password', pairs.get('P'), true),
      ...field('Security', label),
      ...(pairs.get('H')?.toLowerCase() === 'true' ? field('Hidden', 'Yes') : []),
    ],
  };
}

interface Contact {
  name?: string;
  phones: string[];
  emails: string[];
  org?: string;
  jobTitle?: string;
  address?: string;
  urls: string[];
  note?: string;
  birthday?: string;
}

function contactContent(c: Contact, vcard: string): QrContent {
  return {
    kind: 'contact',
    title: KIND_TITLES.contact,
    fields: [
      ...field('Name', c.name),
      ...c.phones.flatMap((p) => field('Phone', p)),
      ...c.emails.flatMap((e) => field('Email', e)),
      ...field('Organization', c.org),
      ...field('Job title', c.jobTitle),
      ...field('Address', c.address),
      ...c.urls.flatMap((u) => field('Website', u)),
      ...field('Birthday', c.birthday),
      ...field('Note', c.note),
    ],
    ...(c.phones[0] ? { open: { label: 'Call', href: `tel:${c.phones[0].replace(/[^\d+*#]/g, '')}` } } : {}),
    file: { name: `${(c.name || 'contact').replace(/[/\\:*?"<>|]/g, '_')}.vcf`, type: 'text/vcard', text: vcard },
  };
}

/** Unfold folded lines and split `NAME;PARAMS:value` (vCard, iCalendar). */
function contentLines(text: string): { name: string; params: string; value: string }[] {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon < 0) return null;
      const head = line.slice(0, colon);
      const semi = head.indexOf(';');
      return {
        name: (semi < 0 ? head : head.slice(0, semi)).toUpperCase().replace(/^ITEM\d+\./, ''),
        params: semi < 0 ? '' : head.slice(semi + 1),
        value: line.slice(colon + 1),
      };
    })
    .filter((l): l is { name: string; params: string; value: string } => !!l);
}

const unescapeText = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function vcard(text: string): QrContent {
  const c: Contact = { phones: [], emails: [], urls: [] };
  let structured = '';
  for (const { name, value } of contentLines(text)) {
    const v = unescapeText(value).trim();
    if (!v) continue;
    if (name === 'FN') c.name = v;
    else if (name === 'N') structured = value;
    else if (name === 'TEL') c.phones.push(v.replace(/^tel:/i, ''));
    else if (name === 'EMAIL') c.emails.push(v);
    else if (name === 'ORG') c.org = unescapeText(value.split(/(?<!\\);/).filter(Boolean).join(', '));
    else if (name === 'TITLE') c.jobTitle = v;
    else if (name === 'ADR') c.address = value.split(/(?<!\\);/).map(unescapeText).map((s) => s.trim()).filter(Boolean).join(', ');
    else if (name === 'URL') c.urls.push(v);
    else if (name === 'NOTE') c.note = v;
    else if (name === 'BDAY') c.birthday = v;
  }
  if (!c.name && structured) {
    const [family = '', given = '', middle = '', prefix = '', suffix = ''] = structured.split(/(?<!\\);/).map(unescapeText);
    c.name = [prefix, given, middle, family, suffix].map((s) => s.trim()).filter(Boolean).join(' ') || undefined;
  }
  return contactContent(c, text.trim());
}

const vcardEscape = (s: string) => s.replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');

function mecard(text: string): QrContent {
  const c: Contact = { phones: [], emails: [], urls: [] };
  for (const [key, raw] of parseKeyValues(text.slice(7))) {
    const v = raw.trim();
    if (!v) continue;
    if (key === 'N') {
      // "Family,Given" in MECARD.
      const [family, given] = v.split(',');
      c.name = given ? `${given.trim()} ${family.trim()}` : v;
    } else if (key === 'TEL' || key === 'TEL-AV') c.phones.push(v);
    else if (key === 'EMAIL') c.emails.push(v);
    else if (key === 'ORG') c.org = v;
    else if (key === 'TITLE') c.jobTitle = v;
    else if (key === 'ADR') c.address = v;
    else if (key === 'URL') c.urls.push(v);
    else if (key === 'NOTE') c.note = v;
    else if (key === 'BDAY') c.birthday = v;
  }
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcardEscape(c.name ?? '')}`,
    ...c.phones.map((p) => `TEL:${vcardEscape(p)}`),
    ...c.emails.map((e) => `EMAIL:${vcardEscape(e)}`),
    ...(c.org ? [`ORG:${vcardEscape(c.org)}`] : []),
    ...(c.jobTitle ? [`TITLE:${vcardEscape(c.jobTitle)}`] : []),
    ...(c.address ? [`ADR:;;${vcardEscape(c.address)};;;;`] : []),
    ...c.urls.map((u) => `URL:${vcardEscape(u)}`),
    ...(c.birthday ? [`BDAY:${c.birthday}`] : []),
    ...(c.note ? [`NOTE:${vcardEscape(c.note)}`] : []),
    'END:VCARD',
  ];
  return contactContent(c, lines.join('\r\n'));
}

/** Percent-decode; `+` is a space only in query values (not in phone numbers). */
function decode(s: string, plusIsSpace = false): string {
  try {
    return decodeURIComponent(plusIsSpace ? s.replace(/\+/g, ' ') : s);
  } catch {
    return s;
  }
}

function email(to: string, subject?: string, body?: string, cc?: string): QrContent {
  const query = new URLSearchParams();
  if (subject) query.set('subject', subject);
  if (body) query.set('body', body);
  if (cc) query.set('cc', cc);
  const qs = query.toString().replace(/\+/g, '%20');
  return {
    kind: 'email',
    title: KIND_TITLES.email,
    fields: [...field('To', to), ...field('Cc', cc), ...field('Subject', subject), ...field('Message', body)],
    open: { label: 'Write email', href: `mailto:${to}${qs ? `?${qs}` : ''}` },
  };
}

function mailto(text: string): QrContent {
  const [address, query = ''] = text.slice(7).split('?');
  const params = new URLSearchParams(query);
  return email(decode(address), params.get('subject') ?? undefined, params.get('body') ?? undefined, params.get('cc') ?? undefined);
}

function sms(number: string, message?: string): QrContent {
  return {
    kind: 'sms',
    title: KIND_TITLES.sms,
    fields: [...field('To', number), ...field('Message', message)],
    open: { label: 'Write message', href: `sms:${number}${message ? `?body=${encodeURIComponent(message)}` : ''}` },
  };
}

function geo(text: string): QrContent | null {
  const m = text.match(/^geo:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:,[^?;]*)?(?:;[^?]*)?(?:\?(.*))?$/i);
  if (!m) return null;
  const [, lat, lon, query] = m;
  const q = query ? new URLSearchParams(query).get('q') ?? undefined : undefined;
  return {
    kind: 'geo',
    title: KIND_TITLES.geo,
    fields: [...field('Place', q), ...field('Coordinates', `${lat}, ${lon}`)],
    open: { label: 'Show on map', href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}` },
  };
}

/** "20261024T153000Z" → a readable local date and time. */
export function readIcalDate(value: string): string {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return value;
  const [, y, mo, d, h, mi, s = '00', z] = m;
  if (!h) return new Date(+y, +mo - 1, +d).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)) : new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function event(text: string): QrContent {
  let summary: string | undefined, start: string | undefined, end: string | undefined, place: string | undefined, about: string | undefined;
  for (const { name, value } of contentLines(text)) {
    const v = unescapeText(value).trim();
    if (name === 'SUMMARY') summary = v;
    else if (name === 'DTSTART') start = readIcalDate(v);
    else if (name === 'DTEND') end = readIcalDate(v);
    else if (name === 'LOCATION') place = v;
    else if (name === 'DESCRIPTION') about = v;
  }
  const body = text.trim();
  const calendar = /^BEGIN:VCALENDAR/i.test(body) ? body : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Tools//QR scanner//EN\r\n${body}\r\nEND:VCALENDAR`;
  return {
    kind: 'event',
    title: KIND_TITLES.event,
    fields: [...field('Title', summary), ...field('Starts', start), ...field('Ends', end), ...field('Where', place), ...field('Details', about)],
    file: { name: `${(summary || 'event').replace(/[/\\:*?"<>|]/g, '_')}.ics`, type: 'text/calendar', text: calendar },
  };
}

function otp(text: string): QrContent | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const label = decode(url.pathname.replace(/^\/+/, ''), true);
  const [labelIssuer, account] = label.includes(':') ? label.split(':', 2).map((s) => s.trim()) : [undefined, label];
  const p = url.searchParams;
  return {
    kind: 'otp',
    title: KIND_TITLES.otp,
    fields: [
      ...field('Service', p.get('issuer') ?? labelIssuer),
      ...field('Account', account),
      ...field('Type', url.host.toUpperCase() === 'HOTP' ? 'Counter (HOTP)' : 'Time-based (TOTP)'),
      ...field('Secret key', p.get('secret') ?? undefined, true),
      ...field('Digits', p.get('digits') ?? undefined),
      ...field('Period (seconds)', p.get('period') ?? undefined),
    ],
  };
}

/** Work out what a QR code's text is. */
export function parseQrContent(raw: string): QrContent {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (/^https?:\/\/\S+$/i.test(text)) {
    return { kind: 'url', title: KIND_TITLES.url, fields: field('Address', text), open: { label: 'Open link', href: text } };
  }
  if (/^www\.\S+\.\S+$/i.test(text)) {
    return { kind: 'url', title: KIND_TITLES.url, fields: field('Address', text), open: { label: 'Open link', href: `https://${text}` } };
  }
  if (lower.startsWith('wifi:')) return wifi(text);
  if (lower.startsWith('begin:vcard')) return vcard(text);
  if (lower.startsWith('mecard:')) return mecard(text);
  if (lower.startsWith('mailto:')) return mailto(text);
  if (lower.startsWith('matmsg:')) {
    const pairs = new Map(parseKeyValues(text.slice(7)));
    return email(pairs.get('TO') ?? '', pairs.get('SUB'), pairs.get('BODY'));
  }
  if (lower.startsWith('tel:')) {
    const number = decode(text.slice(4));
    return { kind: 'phone', title: KIND_TITLES.phone, fields: field('Number', number), open: { label: 'Call', href: `tel:${number.replace(/[^\d+*#,;]/g, '')}` } };
  }
  if (lower.startsWith('smsto:') || lower.startsWith('mmsto:')) {
    const [number, ...message] = text.slice(6).split(':');
    return sms(number, message.join(':') || undefined);
  }
  if (lower.startsWith('sms:')) {
    const [number, query = ''] = text.slice(4).split('?');
    return sms(decode(number), new URLSearchParams(query).get('body') ?? undefined);
  }
  if (lower.startsWith('geo:')) {
    const place = geo(text);
    if (place) return place;
  }
  if (/^begin:(vcalendar|vevent)/i.test(text)) return event(text);
  if (lower.startsWith('otpauth://')) {
    const setup = otp(text);
    if (setup) return setup;
  }
  // Other apps' links: upi://pay?…, market://details?…, spotify://… (never script or file links).
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text) && !/^(javascript|vbscript|data|file|blob):/i.test(text)) {
    return { kind: 'url', title: 'App link', fields: field('Address', text), open: { label: 'Open', href: text } };
  }
  return { kind: 'text', title: KIND_TITLES.text, fields: [] };
}
