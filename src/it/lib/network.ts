/**
 * IPv4 subnets (CIDR), and URL parsing.
 */
import type { OutputRow } from '../types';

export function parseIpv4(text: string): number {
  const parts = text.trim().split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
    throw new Error(`“${text.trim()}” is not an IPv4 address like 192.168.1.10.`);
  }
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

export function formatIpv4(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
}

/** "192.168.1.10/24" or "192.168.1.10 255.255.255.0" (no mask means /32). */
export function parseCidr(text: string): { ip: number; prefix: number } {
  const [addr, mask] = text.trim().split(/\s*\/\s*|\s+/);
  const ip = parseIpv4(addr);
  if (mask === undefined) return { ip, prefix: 32 };
  if (/^\d{1,2}$/.test(mask) && Number(mask) <= 32) return { ip, prefix: Number(mask) };
  const m = parseIpv4(mask);
  const prefix = 32 - Math.log2(2 ** 32 - m);
  if (!Number.isInteger(prefix)) throw new Error(`${mask} is not a valid netmask (its 1 bits must come first).`);
  return { ip, prefix };
}

function ipClass(ip: number): string {
  const first = Math.floor(ip / 2 ** 24);
  if (first === 10 || (first === 172 && Math.floor(ip / 2 ** 20) % 16 === 1) || (first === 192 && Math.floor(ip / 2 ** 16) % 256 === 168)) return 'Private (RFC 1918)';
  if (first === 127) return 'Loopback';
  if (first === 169 && Math.floor(ip / 2 ** 16) % 256 === 254) return 'Link-local';
  if (first === 100 && Math.floor(ip / 2 ** 22) % 4 === 1) return 'Carrier-grade NAT (RFC 6598)';
  if (first >= 224 && first < 240) return 'Multicast';
  if (first >= 240) return 'Reserved';
  return 'Public';
}

export function subnetRows(text: string): OutputRow[] {
  const { ip, prefix } = parseCidr(text);
  const size = 2 ** (32 - prefix);
  const network = Math.floor(ip / size) * size;
  const broadcast = network + size - 1;
  const mask = 2 ** 32 - size;
  const [first, last] = prefix >= 31 ? [network, broadcast] : [network + 1, broadcast - 1];
  const hosts = prefix === 32 ? 1 : prefix === 31 ? 2 : size - 2;
  return [
    { label: 'CIDR', value: `${formatIpv4(network)}/${prefix}` },
    { label: 'Netmask', value: formatIpv4(mask) },
    { label: 'Wildcard mask', value: formatIpv4(size - 1) },
    { label: 'Network address', value: formatIpv4(network) },
    { label: 'Broadcast address', value: formatIpv4(broadcast) },
    { label: 'Usable hosts', value: `${formatIpv4(first)} – ${formatIpv4(last)}` },
    { label: 'Number of hosts', value: hosts.toLocaleString('en-US') },
    { label: 'Address type', value: ipClass(ip) },
    { label: 'Binary', value: [24, 16, 8, 0].map((s) => (Math.floor(ip / 2 ** s) % 256).toString(2).padStart(8, '0')).join('.') },
    { label: 'Integer', value: String(ip) },
    { label: 'Hex', value: `0x${ip.toString(16).padStart(8, '0').toUpperCase()}` },
  ];
}

export function urlRows(text: string): OutputRow[] {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error('Not a full URL. Include the scheme, e.g. https://example.com/path?q=1.');
  }
  const rows: OutputRow[] = [
    { label: 'Protocol', value: url.protocol },
    { label: 'Username', value: decodeURIComponent(url.username) },
    { label: 'Password', value: decodeURIComponent(url.password) },
    { label: 'Host', value: url.hostname },
    { label: 'Port', value: url.port },
    { label: 'Path', value: decodeURIComponent(url.pathname) },
    { label: 'Query', value: url.search },
    { label: 'Fragment', value: url.hash },
    { label: 'Origin', value: url.origin },
  ].filter((r) => r.value);
  for (const [key, value] of url.searchParams) rows.push({ label: `?${key}`, value });
  return rows;
}
