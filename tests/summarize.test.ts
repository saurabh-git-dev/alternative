import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractiveSummary, formatSentences, normalizeText, sentenceCount, splitSentences, tidyModelOutput } from '../src/it/lib/summarize';
import { docxText, odtText } from '../src/it/lib/document-text';
import { splitParts } from '../src/it/lib/ai-summarizer';
import { compareVersions } from '../src/pwa/updates';
import { suggestItTools } from '../src/it/suggest';

const ARTICLE = `Solar power is now the cheapest source of new electricity in most of the world.
The cost of solar panels has fallen by about ninety percent over the last decade.
My neighbour painted his fence blue last weekend and the colour looks lovely.
Cheaper solar panels mean that new solar farms undercut coal and gas power plants on price.
Storage is the remaining challenge, because solar power is only produced while the sun shines.
Battery prices are falling too, which makes storing solar power for the evening affordable.
The weather on Tuesday was mild with a light breeze in the afternoon.
Analysts expect solar power and battery storage together to supply a large share of electricity by 2040.`;

describe('extractive summaries', () => {
  it('splits sentences and joins lines broken inside a paragraph', () => {
    expect(normalizeText('A sum-\nmary of the\nreport.\n\nNext part')).toBe('A summary of the report.\n\nNext part');
    expect(splitSentences('One fine day. Two more days! Three?')).toEqual(['One fine day.', 'Two more days!', 'Three?']);
  });

  it('keeps more sentences for longer summaries, within limits', () => {
    expect(sentenceCount(100, 'short')).toBe(5);
    expect(sentenceCount(100, 'medium')).toBe(10);
    expect(sentenceCount(100, 'long')).toBe(20);
    expect(sentenceCount(2, 'medium')).toBe(2);
  });

  it('picks the central sentences, in their original order', () => {
    const { sentences, total } = extractiveSummary(ARTICLE, 'short', 3);
    expect(total).toBe(8);
    expect(sentences).toHaveLength(3);
    expect(sentences.join(' ')).not.toMatch(/fence|weather/);
    const order = sentences.map((s) => ARTICLE.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('formats as bullets or a paragraph, and tidies model Markdown', () => {
    expect(formatSentences(['A.', 'B.'], 'bullets')).toBe('• A.\n• B.');
    expect(formatSentences(['A.', 'B.'], 'paragraph')).toBe('A. B.');
    expect(tidyModelOutput('* **Cost** fell.\n* Storage next.', 'bullets')).toBe('• Cost fell.\n• Storage next.');
    expect(tidyModelOutput('## Summary\nCost fell.', 'paragraph')).toBe('Summary Cost fell.');
  });

  it('splits long text into parts for the on-device model', () => {
    const parts = splitParts('a'.repeat(900) + '\n\n' + 'b'.repeat(900) + '\n\n' + 'c'.repeat(2500), 1000);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join('').replace(/\s/g, '').length).toBe(4300);
  });
});

describe('document text', () => {
  it('reads Word and OpenDocument files', () => {
    const docx = zipSync({
      'word/document.xml': strToU8(
        '<w:document><w:body><w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r><w:r><w:t xml:space="preserve"> meet.</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t><w:tab/><w:t>para</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    expect(docxText(docx)).toBe('Tom & Jerry meet.\nSecond\tpara');
    const odt = zipSync({ 'content.xml': strToU8('<office:text><text:h>Title</text:h><text:p>Body&lt;1&gt;</text:p></office:text>') });
    expect(odtText(odt)).toBe('Title\nBody<1>');
    expect(() => docxText(zipSync({ 'x.txt': strToU8('x') }))).toThrow(/no text/);
  });
});

describe('updates', () => {
  it('compares versions', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });
});

describe('suggestions', () => {
  it('offers Summarize for long received text only', () => {
    expect(suggestItTools('text/plain', ARTICLE.repeat(2)).map((s) => s.tool)).toContain('summarize');
    expect(suggestItTools('text/plain', 'short note').map((s) => s.tool)).not.toContain('summarize');
  });
});
