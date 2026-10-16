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
import { officeToPdf } from './pdf/from-office';
import { watermarkPdf } from './pdf/watermark';
import { protectPdf } from './pdf/protect';
import { unlockPdf } from './pdf/unlock';
import { compressImage } from './image/compress';
import { resizeImage } from './image/resize';
import { convertImage } from './image/convert';
import { rotateImage } from './image/rotate';
import { pageNumbersPdf } from './pdf/page-numbers';
import { repairPdf } from './pdf/repair';
import { webViewPdf } from './pdf/web-view';
import { metadataPdf } from './pdf/metadata';
import { ocrPdf } from './pdf/ocr';
import { signPdf } from './pdf/sign';
import { annotatePdf } from './pdf/annotate';
import { pdfToPdfa } from './pdf/pdfa';
import { digitalSignPdf } from './pdf/digital-sign';
import { redactPdf } from './pdf/redact';
import { fillFormPdf } from './pdf/fill-form';
import { watermarkImage } from './image/watermark';
import { editImage } from './image/edit';
import { cropImage } from './image/crop';
import { stripMetadata } from './image/metadata';
import { ocrImage } from './image/ocr';
import { removeBackground } from './image/remove-background';
import { upscaleImage } from './image/upscale';

/** Order here is the order on the home page (within each category). */
export const ACTIONS: ActionDefinition[] = [
  mergePdf,
  splitPdf,
  organizePdf,
  rotatePdf,
  compressPdf,
  repairPdf,
  webViewPdf,
  pdfToImages,
  imagesToPdf,
  officeToPdf,
  ocrPdf,
  signPdf,
  annotatePdf,
  pdfToPdfa,
  digitalSignPdf,
  fillFormPdf,
  watermarkPdf,
  pageNumbersPdf,
  metadataPdf,
  protectPdf,
  unlockPdf,
  redactPdf,
  compressImage,
  resizeImage,
  cropImage,
  removeBackground,
  upscaleImage,
  convertImage,
  editImage,
  rotateImage,
  watermarkImage,
  stripMetadata,
  ocrImage,
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
