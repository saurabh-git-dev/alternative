/**
 * File helpers: MIME detection, naming, size formatting and ZIP packaging.
 */
import type { ActionDefinition, FileData } from './types';

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
};

export const TYPE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/zip': 'zip',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};

/** MIME type of a browser File, falling back to its extension. */
export function detectType(file: File): string {
  // Some systems report MKV, AVI or TS files with odd or generic types; the extension is more reliable.
  if ((!file.type || file.type === 'application/octet-stream' || file.type === 'video/vnd.dlna.mpeg-tts') && EXTENSION_TYPES[extensionOf(file.name)]) {
    return EXTENSION_TYPES[extensionOf(file.name)];
  }
  if (file.type) return file.type;
  return EXTENSION_TYPES[extensionOf(file.name)] ?? 'application/octet-stream';
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** `photo.png` + `image/webp` → `photo.webp`; optional suffix → `photo-small.webp`. */
export function renameFor(name: string, type: string, suffix = ''): string {
  const ext = TYPE_EXTENSIONS[type] ?? extensionOf(name);
  return `${baseName(name)}${suffix}.${ext}`;
}

/** Does `type` match one of the accepted patterns (supports `image/*`)? */
export function accepts(action: ActionDefinition, type: string): boolean {
  return action.accepts.some((pattern) =>
    pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type,
  );
}

export async function readFile(file: File): Promise<FileData> {
  return { name: file.name, type: detectType(file), bytes: new Uint8Array(await file.arrayBuffer()) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Make names unique within a set: `a.pdf`, `a (2).pdf`, … */
export function uniqueNames<T extends { name: string }>(files: T[]): T[] {
  const used = new Map<string, number>();
  return files.map((f) => {
    const count = used.get(f.name) ?? 0;
    used.set(f.name, count + 1);
    return count === 0 ? f : { ...f, name: `${baseName(f.name)} (${count + 1}).${extensionOf(f.name)}` };
  });
}

/** Package files into a ZIP (stored, not re-compressed: PDFs and images are already compressed). */
export async function zipFiles(files: FileData[]): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of uniqueNames(files)) entries[f.name] = [f.bytes, { level: 0 }];
  return new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' });
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function toBlob(file: FileData): Blob {
  return new Blob([file.bytes as BlobPart], { type: file.type });
}
