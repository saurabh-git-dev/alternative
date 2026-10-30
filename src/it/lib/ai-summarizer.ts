/**
 * The browser's own on-device AI summarizer (the Summarizer API: Gemini Nano
 * in Chrome and Edge on desktop). The model runs on this device, and the
 * browser downloads it once, the first time any site uses it. Elsewhere
 * (Firefox, Safari, phones) `aiAvailability()` says 'unavailable' and the
 * tool picks key sentences instead (lib/summarize.ts).
 */
import { extractiveSummary, formatSentences, tidyModelOutput, wordCount, type SummaryFormat, type SummaryLength } from './summarize';

/** The parts of the Summarizer API used here (not in the DOM typings yet). */
interface SummarizerInstance {
  inputQuota?: number;
  summarize(text: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface SummarizerOptions {
  type: 'key-points' | 'tldr' | 'teaser' | 'headline';
  format: 'markdown' | 'plain-text';
  length: SummaryLength;
  sharedContext?: string;
  outputLanguage?: string;
  signal?: AbortSignal;
  monitor?: (m: EventTarget) => void;
}
interface SummarizerApi {
  availability(options?: Partial<SummarizerOptions>): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options: SummarizerOptions): Promise<SummarizerInstance>;
}

function api(): SummarizerApi | undefined {
  return (globalThis as { Summarizer?: SummarizerApi }).Summarizer;
}

export type AiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

/** Whether this browser can summarize with on-device AI, and whether its model is downloaded yet. */
export async function aiAvailability(): Promise<AiAvailability> {
  const s = api();
  if (!s) return 'unavailable';
  try {
    return await s.availability({ type: 'key-points', format: 'markdown', length: 'medium' });
  } catch {
    return 'unavailable';
  }
}

/** Characters per part sent to the model: well inside its input limit (tokens ≈ 4 characters). */
function partSize(quota: number | undefined): number {
  return Math.max(2000, Math.min(12_000, Math.floor((quota ?? 4000) * 2.5)));
}

/** Most parts summarized one by one; longer texts are first cut down to their key sentences. */
const MAX_PARTS = 8;

/** Paragraph-aligned parts of at most `size` characters. */
export function splitParts(text: string, size: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const para of text.split(/\n\s*\n/)) {
    for (let i = 0; i < para.length; i += size) {
      const piece = para.slice(i, i + size);
      if (current && current.length + piece.length + 2 > size) {
        parts.push(current);
        current = '';
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export interface AiOptions {
  length: SummaryLength;
  format: SummaryFormat;
  signal?: AbortSignal;
  onProgress?: (fraction: number, message: string) => void;
}

/**
 * Summarize with the on-device model. Long texts are summarized in parts,
 * then the parts' summaries are summarized together.
 */
export async function aiSummary(text: string, { length, format, signal, onProgress = () => {} }: AiOptions): Promise<string> {
  const s = api();
  if (!s) throw new Error("This browser doesn't have on-device AI. Use Key sentences instead.");
  const base = {
    format: 'markdown' as const,
    sharedContext: 'A document the reader wants to understand quickly.',
    outputLanguage: 'en',
    signal,
    monitor(m: EventTarget) {
      m.addEventListener('downloadprogress', (e) => onProgress((e as ProgressEvent).loaded * 0.3, 'Downloading the on-device AI model (once)'));
    },
  };
  onProgress(0, 'Starting the on-device AI');
  const final = await s.create({ ...base, type: format === 'bullets' ? 'key-points' : 'tldr', length });
  let partModel: SummarizerInstance | undefined;
  try {
    const size = partSize(final.inputQuota);
    let parts = splitParts(text, size);
    if (parts.length === 1) {
      onProgress(0.4, 'Summarizing');
      return checked(await final.summarize(text, { signal }), text, format);
    }
    if (parts.length > MAX_PARTS) {
      // Too long to read in full in reasonable time: keep the sentences that matter most.
      const keep = Math.round((MAX_PARTS * size) / 160);
      parts = splitParts(formatSentences(extractiveSummary(text, 'long', keep).sentences, 'paragraph'), size);
    }
    partModel = await s.create({ ...base, type: 'key-points', length: 'medium' });
    const notes: string[] = [];
    for (const [i, part] of parts.entries()) {
      onProgress(0.3 + (0.6 * i) / parts.length, `Summarizing part ${i + 1} of ${parts.length}`);
      notes.push(await partModel.summarize(part, { signal }));
    }
    onProgress(0.9, 'Putting it together');
    const joined = notes.join('\n');
    return checked(await final.summarize(joined.slice(0, size), { signal, context: 'These are notes on each part of a longer document.' }), text, format);
  } finally {
    final.destroy();
    partModel?.destroy();
  }
}

/**
 * The model's answer, tidied, if it is a summary at all. Builds without the
 * model (e.g. Chromium) answer with a placeholder and the text unchanged.
 */
function checked(output: string, input: string, format: SummaryFormat): string {
  if (!output.trim() || /model not available/i.test(output) || wordCount(output) >= wordCount(input) * 0.9) {
    throw new Error("the browser's model gave no summary");
  }
  return tidyModelOutput(output, format);
}
