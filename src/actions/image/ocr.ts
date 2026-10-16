/**
 * Image to text (OCR): read the text in photos, screenshots and scans.
 *
 * Engine: Tesseract.js (LSTM). Output is a .txt file, or a searchable PDF
 * (the image with an invisible text layer you can select and search).
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';
import { OCR_LANGUAGES } from '../../engines/ocr-languages';

export const ocrImage: ActionDefinition = {
  id: 'image.ocr',
  title: 'Image to text (OCR)',
  description: 'Pull the text out of photos, screenshots and scans.',
  category: 'image',
  icon: '🔤',
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'],
  mode: 'each',
  verb: 'Extract text',
  produces: (_, p) => (p.output === 'pdf' ? 'application/pdf' : 'text/plain'),
  engines: ['Tesseract.js'],
  params: {
    language: {
      kind: 'enum',
      label: 'Language of the text',
      help: 'English is built in. Other languages download once (2–4 MB), then work offline.',
      default: 'eng',
      display: 'select',
      options: OCR_LANGUAGES,
    },
    second: {
      kind: 'enum',
      label: 'Second language',
      help: 'For documents that mix two languages. Slower.',
      default: '',
      display: 'select',
      options: [{ value: '', label: 'None' }, ...OCR_LANGUAGES],
      advanced: true,
    },
    output: {
      kind: 'enum',
      label: 'Output',
      default: 'txt',
      options: [
        { value: 'txt', label: 'Text file' },
        { value: 'pdf', label: 'Searchable PDF' },
      ],
    },
  },
  async run([file], params, ctx) {
    const { recognize } = await import('../../engines/ocr');
    const langs = [params.language as string, params.second as string].filter(Boolean);
    ctx.progress(0.05, 'Starting OCR');
    const result = await recognize(new Blob([file.bytes as BlobPart], { type: file.type }), langs, {
      pdf: params.output === 'pdf',
      onProgress: (f, m) => ctx.progress(0.05 + f * 0.3, m),
    });
    const note = result.words.length === 0
      ? 'No text was found. Check the language setting, or try a sharper image.'
      : result.confidence < 60 ? 'Some text may be misread: the image is blurry or low-contrast.' : undefined;
    if (params.output === 'pdf' && result.pdf) {
      return [{ name: `${baseName(file.name)}-ocr.pdf`, type: 'application/pdf', bytes: result.pdf, note }];
    }
    return [{ name: `${baseName(file.name)}.txt`, type: 'text/plain', bytes: new TextEncoder().encode(result.text), note }];
  },
};
