/**
 * Unix file permissions: octal (755) ↔ symbolic (rwxr-xr-x), including the
 * setuid, setgid and sticky bits.
 */

export const WHO = ['owner', 'group', 'others'] as const;
export const WHAT = ['read', 'write', 'execute'] as const;

/** permissions[who][what], plus the three special bits. */
export interface Permissions {
  bits: [boolean, boolean, boolean][];
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
}

export function fromOctal(text: string): Permissions {
  const s = text.trim().replace(/^0o?/, '') || '0';
  if (!/^[0-7]{1,4}$/.test(s)) throw new Error('Use 3 or 4 octal digits (0–7), e.g. 755 or 4755.');
  const n = parseInt(s, 8);
  return {
    bits: [6, 3, 0].map((shift) => [2, 1, 0].map((b) => !!((n >> (shift + b)) & 1))) as Permissions['bits'],
    setuid: !!(n & 0o4000),
    setgid: !!(n & 0o2000),
    sticky: !!(n & 0o1000),
  };
}

export function toOctal(p: Permissions): string {
  const special = (p.setuid ? 4 : 0) + (p.setgid ? 2 : 0) + (p.sticky ? 1 : 0);
  const digits = p.bits.map(([r, w, x]) => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0)).join('');
  return special ? `${special}${digits}` : digits;
}

export function toSymbolic(p: Permissions): string {
  const specials = [p.setuid ? 's' : '', p.setgid ? 's' : '', p.sticky ? 't' : ''];
  return p.bits
    .map(([r, w, x], i) => {
      const exec = specials[i] ? (x ? specials[i] : specials[i].toUpperCase()) : x ? 'x' : '-';
      return `${r ? 'r' : '-'}${w ? 'w' : '-'}${exec}`;
    })
    .join('');
}

/** Accepts "rwxr-xr-x" or "-rwxr-xr-x" as printed by ls -l. */
export function fromSymbolic(text: string): Permissions {
  const s = text.trim().replace(/^[-dlcbps](?=.{9}$)/, '');
  if (!/^([r-][w-][xsS-]){2}[r-][w-][xtT-]$/.test(s)) throw new Error('Use 9 characters like rwxr-xr-x.');
  const bits = [0, 3, 6].map((i) => [s[i] === 'r', s[i + 1] === 'w', /[xst]/.test(s[i + 2])]) as Permissions['bits'];
  return { bits, setuid: /[sS]/.test(s[2]), setgid: /[sS]/.test(s[5]), sticky: /[tT]/.test(s[8]) };
}
