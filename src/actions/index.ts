/**
 * The tool registry. To add a tool, create an action file and list it here;
 * the home page, routing and settings form pick it up automatically.
 */
import type { ActionCategory, ActionDefinition } from '../core/types';
import { mergePdf } from './pdf/merge';
import { splitPdf } from './pdf/split';
import { organizePdf } from './pdf/organize';
import { rotatePdf } from './pdf/rotate';
import { compressPdf } from './pdf/compress';
import { pdfToImages } from './pdf/to-images';
import { imagesToPdf } from './pdf/from-images';
import { watermarkPdf } from './pdf/watermark';
import { protectPdf } from './pdf/protect';
import { unlockPdf } from './pdf/unlock';
import { compressImage } from './image/compress';
import { resizeImage } from './image/resize';
import { convertImage } from './image/convert';
import { rotateImage } from './image/rotate';

export const ACTIONS: ActionDefinition[] = [
  mergePdf,
  splitPdf,
  compressPdf,
  organizePdf,
  rotatePdf,
  pdfToImages,
  imagesToPdf,
  watermarkPdf,
  protectPdf,
  unlockPdf,
  compressImage,
  resizeImage,
  convertImage,
  rotateImage,
];

export const CATEGORIES: { id: ActionCategory; label: string }[] = [
  { id: 'pdf-organize', label: 'Organize PDF' },
  { id: 'pdf-optimize', label: 'Optimize PDF' },
  { id: 'pdf-convert', label: 'Convert PDF' },
  { id: 'pdf-edit', label: 'Edit PDF' },
  { id: 'pdf-security', label: 'PDF security' },
  { id: 'image', label: 'Images' },
];

const byId = new Map(ACTIONS.map((a) => [a.id, a]));

export function getAction(id: string): ActionDefinition | undefined {
  return byId.get(id);
}
