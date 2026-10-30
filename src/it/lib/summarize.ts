/**
 * Extractive summaries: pick the sentences that best represent a text, with
 * no model and no download. Sentences are compared by the words they share
 * (TF-IDF), and TextRank (PageRank over that similarity graph) scores the
 * ones most connected to the rest. The picks come back in their original
 * order, so the summary reads like the text.
 */

export type SummaryLength = 'short' | 'medium' | 'long';
export type SummaryFormat = 'bullets' | 'paragraph';

/** Share of the sentences kept, with a floor and ceiling, per length. */
const LENGTHS: Record<SummaryLength, { ratio: number; min: number; max: number }> = {
  short: { ratio: 0.05, min: 3, max: 5 },
  medium: { ratio: 0.1, min: 5, max: 10 },
  long: { ratio: 0.2, min: 8, max: 20 },
};

/** How many sentences a summary of `total` sentences keeps. */
export function sentenceCount(total: number, length: SummaryLength): number {
  const { ratio, min, max } = LENGTHS[length];
  return Math.min(total, Math.max(min, Math.min(max, Math.round(total * ratio))));
}

// Common English words that say little about what a text is about.
const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
    'may might must shall one two also however thus therefore etc per via within without upon among us get got make made many much like well even still yet'
  ).split(/\s+/),
);

/**
 * Text as it comes out of PDFs and plain files: words split across lines
 * joined again, hard line breaks inside a paragraph turned into spaces.
 * Blank lines and lines that look like headings or list items stay breaks.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/­/g, '')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/([^\n.!?:;])\n(?![\n\-•*\d])/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Sentences of a text, in order. Each line break also ends one (headings, list items). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null;
  for (const line of normalizeText(text).split('\n')) {
    if (!line.trim()) continue;
    const parts = segmenter ? Array.from(segmenter.segment(line), (s) => s.segment) : line.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [line];
    for (const p of parts) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Content words of a sentence, lower-cased and roughly stemmed ("summaries" ≈ "summary"). */
export function terms(sentence: string): string[] {
  const words = sentence.toLowerCase().match(/\p{L}[\p{L}\p{N}'’]*/gu) ?? [];
  return words.filter((w) => w.length > 2 && !STOPWORDS.has(w)).map(stem);
}

function stem(word: string): string {
  return word
    .replace(/['’]s$/, '')
    .replace(/ies$/, 'y')
    .replace(/(?<=..)(ing|ed|ly|es|s)$/, '');
}

/** A sentence that reads on its own: not a heading, page number or fragment. */
function isCandidate(sentence: string, termCount: number): boolean {
  const words = sentence.split(/\s+/).length;
  return words >= 5 && words <= 80 && termCount >= 2;
}

type Vector = Map<string, number>;

function cosine(a: Vector, b: Vector): number {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const v = big.get(t);
    if (v) dot += w * v;
  }
  return dot;
}

/** Above this many sentences the full graph gets slow; score against the whole text instead. */
const GRAPH_LIMIT = 1200;

/**
 * Score every sentence (higher = more central). TextRank for normal texts;
 * for very long ones, similarity to the text as a whole.
 */
export function scoreSentences(sentences: string[]): number[] {
  const bags = sentences.map(terms);
  const df = new Map<string, number>();
  for (const bag of bags) for (const t of new Set(bag)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = sentences.length;
  const vectors: Vector[] = bags.map((bag) => {
    const v: Vector = new Map();
    for (const t of bag) v.set(t, (v.get(t) ?? 0) + 1);
    let norm = 0;
    for (const [t, tf] of v) {
      const w = tf * Math.log(1 + n / df.get(t)!);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  const usable = sentences.map((s, i) => isCandidate(s, bags[i].length));

  if (n > GRAPH_LIMIT) {
    const centroid: Vector = new Map();
    vectors.forEach((v, i) => {
      if (usable[i]) for (const [t, w] of v) centroid.set(t, (centroid.get(t) ?? 0) + w);
    });
    return vectors.map((v, i) => (usable[i] ? cosine(v, centroid) : 0));
  }

  // Weighted PageRank over sentence similarity.
  const edges: { j: number; w: number }[][] = Array.from({ length: n }, () => []);
  const outWeight = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!usable[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (!usable[j]) continue;
      const w = cosine(vectors[i], vectors[j]);
      if (w > 0.01) {
        edges[i].push({ j, w });
        edges[j].push({ j: i, w });
        outWeight[i] += w;
        outWeight[j] += w;
      }
    }
  }
  const d = 0.85;
  let scores: number[] = usable.map((u) => (u ? 1 : 0));
  for (let iter = 0; iter < 40; iter++) {
    const next = usable.map((u) => (u ? 1 - d : 0));
    for (let i = 0; i < n; i++) {
      if (!outWeight[i]) continue;
      const share = (d * scores[i]) / outWeight[i];
      for (const { j, w } of edges[i]) next[j] += share * w;
    }
    scores = next;
  }
  return scores;
}

export interface ExtractiveSummary {
  /** The picked sentences, in the order they appear in the text. */
  sentences: string[];
  /** Sentences in the whole text. */
  total: number;
}

/** The most representative sentences of `text`. */
export function extractiveSummary(text: string, length: SummaryLength, count?: number): ExtractiveSummary {
  const sentences = splitSentences(text);
  const want = count ?? sentenceCount(sentences.length, length);
  const scores = scoreSentences(sentences);
  const ranked = sentences.map((_, i) => i).filter((i) => scores[i] > 0).sort((a, b) => scores[b] - scores[a]);
  const picked: number[] = [];
  const seen: Set<string>[] = [];
  for (const i of ranked) {
    if (picked.length >= want) break;
    // Skip near-repeats of a sentence already picked (running headers, restated points).
    const bag = new Set(terms(sentences[i]));
    if (seen.some((s) => overlap(s, bag) > 0.7)) continue;
    picked.push(i);
    seen.push(bag);
  }
  // A text too short or fragmented to rank: keep it in order.
  if (!picked.length) return { sentences: sentences.slice(0, want), total: sentences.length };
  return { sentences: picked.sort((a, b) => a - b).map((i) => sentences[i]), total: sentences.length };
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of b) if (a.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** Sentences as bullet points or one paragraph. */
export function formatSentences(sentences: string[], format: SummaryFormat): string {
  return format === 'bullets' ? sentences.map((s) => `• ${s}`).join('\n') : sentences.join(' ');
}

/**
 * Model output (Markdown) as plain text in the chosen format: list markers
 * become bullets, bold and headings lose their markup.
 */
export function tidyModelOutput(text: string, format: SummaryFormat): string {
  const lines = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .split('\n')
    .map((l) => l.trim().replace(/^#+\s*/, ''))
    .filter(Boolean);
  if (format === 'paragraph') return lines.map((l) => l.replace(/^[-*•]\s+/, '')).join(' ');
  return lines.map((l) => (/^[-*•]\s+/.test(l) ? l.replace(/^[-*•]\s+/, '• ') : `• ${l}`)).join('\n');
}

/** Rough word count, for "1,240 words → 120 words". */
export function wordCount(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}
