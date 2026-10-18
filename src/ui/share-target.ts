/**
 * Where "Share" can send a file (see components/ShareMenu.svelte): a device
 * connected over a direct transfer (any size), a new device by QR code, or,
 * for small files, the Share page, which packs the file into a link and QR
 * code (core/share.ts).
 */
import type { FileData } from '../core/types';
import { MAX_LINK_CHARS, QR_ROUTE, appUrl, pack, qrCapacity } from '../core/share';
import { handoff } from './handoff.svelte';

/** Biggest file that could still pack into one QR code; above it, skip the (costly) packing test. */
const QR_PRECHECK_BYTES = 64 * 1024;
/** Raw files above this can't make a usable link (base64 adds a third). */
export const MAX_LINK_FILE_BYTES = Math.floor((MAX_LINK_CHARS * 3) / 4) - 1024;

let room: number | undefined;

/** Does this file fit in one QR code (normal error correction)? */
export function fitsQr(file: FileData): boolean {
  room ??= qrCapacity(`${appUrl(location)}#${QR_ROUTE}`, 'L');
  return file.bytes.length <= QR_PRECHECK_BYTES && pack(file).length <= room;
}

export function fitsLink(file: FileData): boolean {
  return file.bytes.length <= MAX_LINK_FILE_BYTES;
}

export function toFile(file: FileData | File): File {
  return file instanceof File ? file : new File([file.bytes as BlobPart], file.name, { type: file.type });
}

/** Open the Share page (link and QR code) with this file loaded. */
export function openSharePage(file: FileData): void {
  handoff.file = file;
  location.hash = '#/share';
}
