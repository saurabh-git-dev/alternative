/**
 * Remove image metadata (EXIF, GPS location, camera info, comments).
 *
 * JPEG and PNG are cleaned losslessly by dropping metadata segments/chunks,
 * so pixels are untouched. If a JPEG relies on its EXIF orientation flag, the
 * pixels are rotated upright first so the photo doesn't end up sideways.
 * Other formats are re-encoded at high quality, which drops metadata.
 */
import type { ActionDefinition, FileData } from '../../core/types';
import { renameFor } from '../../core/files';
import { jpegOrientation } from '../pdf/from-images';

export const stripMetadata: ActionDefinition = {
  id: 'image.metadata',
  title: 'Remove photo info',
  description: 'Strip location, camera and other hidden data before sharing.',
  category: 'image',
  icon: '🕵️',
  accepts: ['image/*'],
  mode: 'each',
  verb: 'Remove info',
  engines: ['Lossless segment filter', 'MozJPEG', 'libwebp'],
  params: {
    keepColorProfile: {
      kind: 'boolean',
      label: 'Keep colour profile',
      help: 'Recommended: keeps colours accurate. It contains no personal data.',
      default: true,
      advanced: true,
    },
  },
  async run([file], params) {
    const keepIcc = params.keepColorProfile as boolean;
    const name = renameFor(file.name, file.type, '-clean');
    if (file.type === 'image/jpeg' && jpegOrientation(file.bytes) <= 1) {
      return [{ name, type: file.type, bytes: stripJpeg(file.bytes, keepIcc) }];
    }
    if (file.type === 'image/png') {
      return [{ name, type: file.type, bytes: stripPng(file.bytes, keepIcc) }];
    }
    return [await reencode(file, name)];
  },
};

async function reencode(file: FileData, name: string) {
  const { decode, encode, encodableFormat } = await import('../../engines/image');
  const format = encodableFormat(file.type);
  const bytes = await encode(await decode(file.bytes, file.type), format, { quality: 95, pngLevel: 2 });
  return { name: renameFor(name, format), type: format, bytes, note: 'Re-saved at high quality to remove the info.' };
}

/** Drop APPn (except JFIF/Adobe colour markers and, optionally, ICC) and COM segments. */
export function stripJpeg(bytes: Uint8Array, keepIcc: boolean): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = view.getUint16(offset);
    if (marker === 0xffda || (marker & 0xff00) !== 0xff00) {
      parts.push(bytes.subarray(offset)); // image data: copy the rest verbatim
      break;
    }
    const end = offset + 2 + view.getUint16(offset + 2);
    const isApp = marker >= 0xffe1 && marker <= 0xffef; // APP0 (JFIF) is kept
    const isIcc = marker === 0xffe2 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 15)) === 'ICC_PROFILE';
    const isAdobe = marker === 0xffee; // carries the colour transform flag
    const drop = marker === 0xfffe || (isApp && !isAdobe && !(keepIcc && isIcc));
    if (!drop) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  return concat(parts);
}

/** Drop text, time and EXIF chunks (and iCCP unless kept) from a PNG. */
export function stripPng(bytes: Uint8Array, keepIcc: boolean): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const remove = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', ...(keepIcc ? [] : ['iCCP'])]);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (!remove.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
