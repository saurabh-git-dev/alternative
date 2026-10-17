/**
 * Numbers and colours: integer bases (any size, via BigInt) and colour
 * formats (hex, RGB, HSL, HWB, CMYK).
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Parse an integer in base 2–36; `_`, spaces and 0x/0b/0o prefixes are allowed. */
export function parseBigInt(text: string, base: number): bigint {
  let s = text.trim().toLowerCase().replace(/[_\s]/g, '');
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const prefix = { 16: '0x', 2: '0b', 8: '0o' }[base];
  if (prefix && s.startsWith(prefix)) s = s.slice(2);
  if (!s) throw new Error('Enter a number.');
  let n = 0n;
  const b = BigInt(base);
  for (const c of s) {
    const d = DIGITS.indexOf(c);
    if (d < 0 || d >= base) throw new Error(`“${c}” is not a digit in base ${base}.`);
    n = n * b + BigInt(d);
  }
  return negative ? -n : n;
}

export function formatBigInt(n: bigint, base: number): string {
  return n.toString(base);
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** sRGB colour, channels 0–255, alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Parse #rgb(a), #rrggbb(aa), rgb(), hsl(), hwb() and a few CSS names. */
export function parseColor(text: string): Rgba {
  const s = text.trim().toLowerCase();
  const named: Record<string, string> = { black: '#000', white: '#fff', red: '#f00', lime: '#0f0', blue: '#00f', yellow: '#ff0', cyan: '#0ff', magenta: '#f0f', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', green: '#008000', navy: '#000080', transparent: '#0000' };
  if (named[s]) return parseColor(named[s]);
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? round(n(6) / 255, 3) : 1 };
  }
  const fn = /^(rgba?|hsla?|hwb)\(\s*([^)]*)\)$/.exec(s);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    const num = (p: string | undefined, scale: number) => (p === undefined ? NaN : p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p));
    const alpha = parts[3] === undefined ? 1 : clamp(num(parts[3], 1), 0, 1);
    if (fn[1].startsWith('rgb')) {
      const [r, g, b] = parts.slice(0, 3).map((p) => clamp(num(p, 255), 0, 255));
      if ([r, g, b].some(Number.isNaN)) throw new Error('rgb() needs three numbers, e.g. rgb(79 70 229).');
      return { r: round(r), g: round(g), b: round(b), a: alpha };
    }
    const h = parseFloat(parts[0]);
    const [x, y] = [num(parts[1], 100), num(parts[2], 100)];
    if ([h, x, y].some(Number.isNaN)) throw new Error(`${fn[1]}() needs three numbers.`);
    return { ...(fn[1] === 'hwb' ? hwbToRgb(h, x, y) : hslToRgb(h, x, y)), a: alpha };
  }
  throw new Error('Use a colour like #4f46e5, rgb(79 70 229), hsl(243 75% 59%) or a name like orange.');
}

function hslToRgb(h: number, s: number, l: number): Omit<Rgba, 'a'> {
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: round(f(0) * 255), g: round(f(8) * 255), b: round(f(4) * 255) };
}

function hwbToRgb(h: number, w: number, bl: number): Omit<Rgba, 'a'> {
  w = clamp(w, 0, 100) / 100;
  bl = clamp(bl, 0, 100) / 100;
  if (w + bl >= 1) {
    const g = round((w / (w + bl)) * 255);
    return { r: g, g, b: g };
  }
  const rgb = hslToRgb(h, 100, 50);
  const f = (c: number) => round(((c / 255) * (1 - w - bl) + w) * 255);
  return { r: f(rgb.r), g: f(rgb.g), b: f(rgb.b) };
}

function hue(r: number, g: number, b: number, max: number, d: number): number {
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return round((h * 60 + 360) % 360);
}

export function formatColor(c: Rgba): Record<'hex' | 'rgb' | 'hsl' | 'hwb' | 'cmyk', string> {
  const [r, g, b] = [c.r / 255, c.g / 255, c.b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const h = hue(r, g, b, max, d);
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const alpha = c.a < 1 ? ` / ${round(c.a, 3)}` : '';
  const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  const k = 1 - max;
  const cmy = (x: number) => (k === 1 ? 0 : round(((1 - x - k) / (1 - k)) * 100));
  return {
    hex: `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ''}`,
    rgb: `rgb(${c.r} ${c.g} ${c.b}${alpha})`,
    hsl: `hsl(${h} ${round(s * 100)}% ${round(l * 100)}%${alpha})`,
    hwb: `hwb(${h} ${round(min * 100)}% ${round((1 - max) * 100)}%${alpha})`,
    cmyk: `cmyk(${cmy(r)}% ${cmy(g)}% ${cmy(b)}% ${round(k * 100)}%)`,
  };
}

/** WCAG relative luminance and contrast ratio, for "readable on white/black". */
export function contrast(a: Rgba, b: Rgba): number {
  const lum = (c: Rgba) => {
    const ch = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return round((x + 0.05) / (y + 0.05), 2);
}
