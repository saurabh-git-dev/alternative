/**
 * Where "share this" goes for a file: the Share page (QR code + link) when it
 * packs into one QR code, otherwise a direct, encrypted transfer (any size).
 * While a direct session is connected (ui/transfer.svelte.ts), files go over
 * it, whatever their size.
 * Used by tool results and by every IT tool's output.
 */
import type { FileData } from '../core/types';
import { QR_ROUTE, appUrl, pack, qrCapacity } from '../core/share';
import { handoff } from './handoff.svelte';
import { isConnected } from './transfer.svelte';

/** Biggest file that could still pack into one QR code; above it, skip the (costly) packing test. */
const QR_PRECHECK_BYTES = 64 * 1024;

let room: number | undefined;

/** Does this file fit in one QR code (normal error correction)? */
export function fitsQr(file: FileData): boolean {
  room ??= qrCapacity(`${appUrl(location)}#${QR_ROUTE}`, 'L');
  return file.bytes.length <= QR_PRECHECK_BYTES && pack(file).length <= room;
}

/** Open the right share page with this file loaded. While a device is connected, it goes straight to it. */
export function shareFile(file: FileData, fits = fitsQr(file)): void {
  handoff.file = file;
  location.hash = fits && !isConnected() ? '#/share' : '#/direct';
}

/** Send several files to a phone in one direct session. */
export function sendFiles(files: FileData[]): void {
  handoff.files = files;
  location.hash = '#/direct';
}
