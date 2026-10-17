/**
 * Every IT tool, in display order. Only metadata lives here (it's loaded with
 * the home page); each tool's code is fetched when the tool is opened.
 *
 * To add a tool, see docs/it-tools.md.
 */
import type { ItCategory, ItToolInfo, ItToolModule, TransformSpec } from './types';

export const IT_CATEGORIES: { id: ItCategory; label: string; icon: string }[] = [
  { id: 'crypto', label: 'Crypto & secrets', icon: '🔐' },
  { id: 'convert', label: 'Converters', icon: '🔄' },
  { id: 'web', label: 'Web & network', icon: '🌐' },
  { id: 'dev', label: 'Development', icon: '🛠️' },
  { id: 'text', label: 'Text', icon: '📝' },
];

/** Loader for a transform exported from one of the ./transforms modules. */
function transform<M>(load: () => Promise<M>, name: keyof M): () => Promise<ItToolModule> {
  return async () => ({ transform: (await load())[name] as TransformSpec });
}

const encoding = () => import('./transforms/encoding');
const data = () => import('./transforms/data');
const cryptoT = () => import('./transforms/crypto');
const text = () => import('./transforms/text');
const web = () => import('./transforms/web');

export const IT_TOOLS: ItToolInfo[] = [
  // Crypto & secrets
  { id: 'password', icon: '🔑', title: 'Password generator', description: 'Strong random passwords and tokens, then send one to your phone.', keywords: 'random token secret api key generate', category: 'crypto', load: () => import('../ui/it/tools/Password.svelte') },
  { id: 'uuid', icon: '🆔', title: 'UUID & ULID generator', description: 'Random v4, time-ordered v7 or ULID ids, one or many.', keywords: 'guid id unique identifier generate', category: 'crypto', load: () => import('../ui/it/tools/Uuid.svelte') },
  { id: 'hash', icon: '#️⃣', title: 'Hash text', description: 'MD5, SHA-1, SHA-256, SHA-384 and SHA-512 of any text.', keywords: 'digest checksum md5 sha sha256', category: 'crypto', load: transform(cryptoT, 'hash') },
  { id: 'checksum', icon: '🧾', title: 'File checksum', description: 'Hash a file to check a download, compare with an expected value.', keywords: 'hash md5 sha256 verify integrity download', category: 'crypto', load: () => import('../ui/it/tools/Checksum.svelte') },
  { id: 'hmac', icon: '✍️', title: 'HMAC generator', description: 'Sign a message with a secret key (HMAC-SHA-256 and others).', keywords: 'signature mac webhook', category: 'crypto', load: transform(cryptoT, 'hmac') },
  { id: 'encrypt', icon: '🔒', title: 'Encrypt text', description: 'Lock text with a password (AES-256) to send it safely, e.g. by QR code.', keywords: 'decrypt aes cipher secret password', category: 'crypto', load: transform(cryptoT, 'encrypt') },

  // Converters
  { id: 'base64', icon: '🔤', title: 'Base64', description: 'Encode text to Base64 or decode it back.', keywords: 'encode decode b64', category: 'convert', load: transform(encoding, 'base64') },
  { id: 'datetime', icon: '🕒', title: 'Date & time converter', description: 'Unix timestamps, ISO 8601 and local time, both ways.', keywords: 'timestamp epoch unix iso date time convert', category: 'convert', load: transform(web, 'datetime') },
  { id: 'number-base', icon: '🔢', title: 'Number base converter', description: 'Binary, octal, decimal, hex or any base, any size.', keywords: 'radix hex binary octal decimal convert integer', category: 'convert', load: () => import('../ui/it/tools/NumberBase.svelte') },
  { id: 'color', icon: '🎨', title: 'Color converter', description: 'HEX, RGB, HSL, HWB and CMYK, with a picker and contrast check.', keywords: 'colour css hex rgb hsl picker', category: 'convert', load: () => import('../ui/it/tools/Color.svelte') },
  { id: 'json-yaml', icon: '📑', title: 'JSON ↔ YAML', description: 'Convert JSON to YAML and back.', keywords: 'yml config convert', category: 'convert', load: transform(data, 'jsonYaml') },
  { id: 'json-csv', icon: '📊', title: 'JSON ↔ CSV', description: 'Turn an array of objects into a spreadsheet, or CSV into JSON.', keywords: 'spreadsheet excel table convert', category: 'convert', load: transform(data, 'jsonCsv') },
  { id: 'case', icon: '🔠', title: 'Case converter', description: 'camelCase, snake_case, kebab-case, Title Case and more at once.', keywords: 'camel snake kebab pascal upper lower title', category: 'convert', load: transform(text, 'caseConvert') },
  { id: 'binary', icon: '💾', title: 'Text ↔ binary', description: 'Text to 0s and 1s (UTF-8) and back.', keywords: 'bits bytes ascii', category: 'convert', load: transform(encoding, 'binary') },
  { id: 'unicode', icon: '🔣', title: 'Unicode escape', description: 'Escape text to \\u sequences, or turn them back into characters.', keywords: 'escape unescape utf emoji', category: 'convert', load: transform(encoding, 'unicode') },
  { id: 'roman', icon: '🏛️', title: 'Roman numerals', description: 'Numbers to Roman numerals and back.', keywords: 'numeral convert', category: 'convert', load: transform(encoding, 'roman') },
  { id: 'nato', icon: '📻', title: 'NATO alphabet', description: 'Spell text as Alfa, Bravo, Charlie… for reading out over the phone.', keywords: 'phonetic spelling radio', category: 'convert', load: transform(encoding, 'nato') },

  // Web & network
  { id: 'url', icon: '🔗', title: 'URL encode/decode', description: 'Percent-encode text for URLs, or decode it.', keywords: 'percent encoding uri query escape', category: 'web', load: transform(encoding, 'url') },
  { id: 'url-parse', icon: '🧩', title: 'URL parser', description: 'Split a URL into protocol, host, path, query parameters and more.', keywords: 'query string params parse', category: 'web', load: transform(web, 'urlParse') },
  { id: 'html', icon: '🏷️', title: 'HTML entities', description: 'Escape <, >, & and quotes for HTML, or unescape them.', keywords: 'escape unescape entity encode', category: 'web', load: transform(encoding, 'html') },
  { id: 'jwt', icon: '🎫', title: 'JWT decoder', description: 'Read the header, payload and expiry of a JSON Web Token.', keywords: 'json web token bearer auth decode', category: 'web', load: transform(data, 'jwt') },
  { id: 'qr', icon: '🔳', title: 'QR code generator', description: 'QR codes for text, links or Wi-Fi logins. Save as PNG.', keywords: 'qrcode wifi barcode generate', category: 'web', load: () => import('../ui/it/tools/Qr.svelte') },
  { id: 'subnet', icon: '🖧', title: 'IPv4 subnet calculator', description: 'Network, broadcast, host range and mask from a CIDR.', keywords: 'ip cidr netmask network address calculator', category: 'web', load: transform(web, 'subnet') },
  { id: 'http-status', icon: '🚦', title: 'HTTP status codes', description: 'Every common status code and what it means.', keywords: 'http response error 404 500 reference', category: 'web', load: () => import('../ui/it/tools/HttpStatus.svelte') },
  { id: 'device', icon: '📱', title: 'Device information', description: 'Screen, browser, language, time zone and hardware of this device.', keywords: 'user agent screen browser info resolution', category: 'web', load: () => import('../ui/it/tools/DeviceInfo.svelte') },

  // Development
  { id: 'json', icon: '📋', title: 'JSON formatter', description: 'Pretty-print, validate, sort keys or minify JSON.', keywords: 'prettify beautify minify validate lint', category: 'dev', load: transform(data, 'jsonFormat') },
  { id: 'regex', icon: '🔍', title: 'Regex tester', description: 'Test a regular expression live: matches, groups and replace.', keywords: 'regexp regular expression match replace', category: 'dev', load: () => import('../ui/it/tools/Regex.svelte') },
  { id: 'diff', icon: '🔀', title: 'Text diff', description: 'Compare two texts and see what changed, line by line or word by word.', keywords: 'compare difference changes', category: 'dev', load: () => import('../ui/it/tools/Diff.svelte') },
  { id: 'cron', icon: '⏰', title: 'Cron explainer', description: 'Read a cron expression in plain English and see its next runs.', keywords: 'crontab schedule job', category: 'dev', load: transform(web, 'cron') },
  { id: 'chmod', icon: '🗝️', title: 'Chmod calculator', description: 'Unix permissions: tick boxes, get 755 and rwxr-xr-x.', keywords: 'permissions unix linux octal file', category: 'dev', load: () => import('../ui/it/tools/Chmod.svelte') },

  // Text
  { id: 'stats', icon: '📏', title: 'Text statistics', description: 'Count characters, words, lines, bytes and reading time.', keywords: 'count length word counter characters', category: 'text', load: transform(text, 'stats') },
  { id: 'slug', icon: '🐌', title: 'Slugify', description: 'Turn a title into a clean URL slug.', keywords: 'url permalink slug', category: 'text', load: transform(text, 'slug') },
  { id: 'lorem', icon: '📜', title: 'Lorem ipsum', description: 'Placeholder text, as many paragraphs as you need.', keywords: 'placeholder dummy filler text generate', category: 'text', load: () => import('../ui/it/tools/Lorem.svelte') },
];

export function getItTool(id: string): ItToolInfo | undefined {
  return IT_TOOLS.find((t) => t.id === id);
}
