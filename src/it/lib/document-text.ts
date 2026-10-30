/**
 * Plain text out of the files people want summarized: PDFs (with OCR for
 * scanned pages), Word documents, web pages, images of text and any text
 * file. Everything is read on this device; the heavy engines (MuPDF,
 * Tesseract) load only for the files that need them.
 */
import { unzipSync } from 'fflate';

export const DOCUMENT_ACCEPT =
  '.pdf,.txt,.md,.markdown,.csv,.json,.log,.rtf,.docx,.odt,.html,.htm,.xml,.srt,.vtt,application/pdf,text/*,image/*';

/** Most pages OCR'd from one scanned PDF, to keep it to a few minutes. */
const MAX_OCR_PAGES = 30;

export type Progress = (fraction: number, message: string) => void;

export async function documentText(file: File, onProgress: Progress = () => {}): Promise<string> {
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1);
  if (file.type === 'application/pdf' || ext === 'pdf') return pdfText(new Uint8Array(await file.arrayBuffer()), onProgress);
  if (ext === 'docx') return docxText(new Uint8Array(await file.arrayBuffer()));
  if (ext === 'odt') return odtText(new Uint8Array(await file.arrayBuffer()));
  if (file.type.startsWith('image/')) {
    const { recognize } = await import('../../engines/ocr');
    return (await recognize(file, ['eng'], { onProgress })).text;
  }
  const text = await file.text();
  if (ext === 'html' || ext === 'htm' || file.type === 'text/html') return htmlText(text);
  if (ext === 'rtf') return rtfText(text);
  if (ext === 'srt' || ext === 'vtt') return subtitleText(text);
  if (text.includes('\u0000')) throw new Error(`Can't read text from ${file.name}. Try a PDF, Word (.docx) or text file.`);
  return text;
}

async function pdfText(bytes: Uint8Array, onProgress: Progress): Promise<string> {
  onProgress(0.05, 'Reading the PDF');
  const { inspectPdf, pageTexts, renderPages } = await import('../../engines/mupdf');
  if ((await inspectPdf(bytes)).encrypted) throw new Error('This PDF is password-protected. Unlock it first (PDF → Unlock).');
  const pages = await pageTexts(bytes);
  const scanned = pages.map((t, i) => (t.replace(/\s+/g, '').length < 20 ? i + 1 : 0)).filter(Boolean);
  // Mostly text: summarize that. Mostly scanned: read the scanned pages with OCR.
  if (scanned.length <= pages.length / 2) return pages.join('\n\n');
  const todo = scanned.slice(0, MAX_OCR_PAGES);
  const { recognize } = await import('../../engines/ocr');
  for (const [k, page] of todo.entries()) {
    onProgress(0.1 + (0.9 * k) / todo.length,`Reading scanned page ${k + 1} of ${todo.length} (OCR)`);
    const [image] = await renderPages(bytes, [page], { dpi: 200, format: 'png', maxPixels: 12_000_000 });
    const result = await recognize(new Blob([image as BlobPart], { type: 'image/png' }), ['eng']);
    pages[page - 1] = result.text;
  }
  return pages.join('\n\n');
}

/** Text of a Word document: one paragraph per `<w:p>`, tabs and line breaks kept. */
export function docxText(bytes: Uint8Array): string {
  const files = unzipFile(bytes, 'word/document.xml', 'This Word file');
  return files
    .split(/<\/w:p>/)
    .map((p) =>
      decodeXml(
        p
          .replace(/<w:tab\/>/g, '\t')
          .replace(/<w:(br|cr)\/>/g, '\n')
          .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<[^>]+>/g, (_, t: string | undefined) => t ?? ''),
      ),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text of an OpenDocument (LibreOffice) text file. */
export function odtText(bytes: Uint8Array): string {
  const xml = unzipFile(bytes, 'content.xml', 'This document');
  return decodeXml(
    xml
      .replace(/<text:(tab|s)\/>/g, ' ')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<\/text:(p|h)>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

function unzipFile(bytes: Uint8Array, path: string, what: string): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === path });
  } catch {
    throw new Error(`${what} looks damaged. Open it and save it again, then try once more.`);
  }
  if (!files[path]) throw new Error(`${what} has no text to read.`);
  return new TextDecoder().decode(files[path]);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Visible text of a web page, with block elements on their own lines. */
function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, template, svg, nav, footer').forEach((el) => el.remove());
  doc.querySelectorAll('p, div, br, li, h1, h2, h3, h4, h5, h6, tr, section, article, blockquote').forEach((el) => el.append('\n'));
  return (doc.body?.textContent ?? '').replace(/\n\s*\n+/g, '\n\n').trim();
}

/** RTF with the control words and groups taken out. Good enough for summarizing. */
function rtfText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info)[^]*?\}\s*\}/g, '')
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .trim();
}

/** Subtitles without numbers and timestamps: just what is said. */
function subtitleText(text: string): string {
  return text
    .replace(/^WEBVTT.*$/m, '')
    .split('\n')
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .join('\n');
}
