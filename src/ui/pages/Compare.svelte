<!--
  Compare PDFs: what changed between two versions of a document.
  - Text: word-level differences, with the page each change is on.
  - Visual: per-page pixel comparison (removed ink red, added ink green),
    side by side, or a slider. Catches changes text can't see: images,
    signatures, layout, scanned pages.
  Both run in a worker on the user's device.
-->
<script lang="ts">
  import type { FileData } from '../../core/types';
  import { formatBytes, readFile } from '../../core/files';
  import { compareApi, inspectPdf, resetCompare } from '../../core/runner';
  import { compareTexts, displayText, type DiffPart, type TextDiff } from '../../core/text-diff';
  import Dropzone from '../components/Dropzone.svelte';

  type Slot = { data: FileData; pages: number } | null;
  let a = $state<Slot>(null);
  let b = $state<Slot>(null);
  let error = $state('');
  let busy = $state('');
  let text = $state<TextDiff | null>(null);
  /** Changed pixels per page pair at scan size (pages present in both). */
  let pageChanges = $state<number[]>([]);
  let tab = $state<'text' | 'visual'>('text');
  let page = $state(1);
  let mode = $state<'highlight' | 'side' | 'slider'>('highlight');
  let images = $state<{ before: string; after: string; diff: string; changed: number } | null>(null);
  let split = $state(50);
  let expanded = $state(new Set<number>());
  let run = 0;

  async function load(which: 'a' | 'b', files: File[]) {
    error = '';
    const data = await readFile(files[0]);
    try {
      const info = await inspectPdf(data.bytes);
      if (info.encrypted) {
        error = `${data.name} is password-protected. Unlock it first.`;
        return;
      }
      const slot = { data, pages: info.pageCount };
      if (which === 'a') a = slot;
      else b = slot;
      if (a && b) analyse();
    } catch {
      error = `${data.name} couldn't be read. It may be damaged or not a real PDF.`;
    }
  }

  function swap() {
    [a, b] = [b, a];
    if (a && b) analyse();
  }

  function clear(which: 'a' | 'b') {
    if (which === 'a') a = null;
    else b = null;
    resetCompare();
    text = null;
    pageChanges = [];
    images = null;
  }

  async function analyse() {
    const ticket = ++run;
    resetCompare();
    const api = compareApi();
    const [docA, docB] = [a!, b!];
    text = null;
    pageChanges = [];
    images = null;
    expanded = new Set();
    busy = 'Reading the text';
    try {
      const [ta, tb] = await Promise.all([api.pageTexts(docA.data.bytes.slice()), api.pageTexts(docB.data.bytes.slice())]);
      if (ticket !== run) return;
      text = compareTexts(ta, tb);
      const pairs = Math.min(docA.pages, docB.pages);
      const changes: number[] = [];
      for (let p = 1; p <= pairs; p++) {
        busy = `Comparing page ${p} of ${pairs}`;
        const r = await api.visualDiff(docA.data.bytes.slice(), docB.data.bytes.slice(), p, p, SCAN_WIDTH, false);
        if (ticket !== run) return;
        changes.push(r.changedPixels);
      }
      pageChanges = changes;
      const firstChanged = changes.findIndex(isChanged);
      page = firstChanged >= 0 ? firstChanged + 1 : 1;
      if (!text.changes && firstChanged >= 0) tab = 'visual';
      busy = '';
      showPage(page);
    } catch (e) {
      if (ticket === run) {
        busy = '';
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  /**
   * Identical content renders identically, so a handful of differing pixels
   * at scan size already means a real change (e.g. one edited digit).
   * Below 3 pixels it's treated as noise.
   */
  const SCAN_WIDTH = 600;
  const isChanged = (pixels: number) => pixels >= 3;

  async function showPage(p: number) {
    page = p;
    if (!a || !b || p > Math.min(a.pages, b.pages)) {
      images = null;
      return;
    }
    const ticket = run;
    const r = await compareApi().visualDiff(a.data.bytes.slice(), b.data.bytes.slice(), p, p, 1100, true);
    if (ticket !== run || page !== p) return;
    const url = (bytes?: Uint8Array) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    if (images) [images.before, images.after, images.diff].forEach((u) => URL.revokeObjectURL(u));
    images = { before: url(r.before), after: url(r.after), diff: url(r.diff), changed: r.changed };
  }

  const slots = $derived([
    ['a', 'Original', a],
    ['b', 'Changed version', b],
  ] as const);
  const changedPages = $derived(pageChanges.flatMap((c, i) => (isChanged(c) ? [i + 1] : [])));
  const maxPages = $derived(Math.max(a?.pages ?? 0, b?.pages ?? 0));

  /** Text parts with long unchanged stretches shortened to their ends. */
  const CONTEXT = 25;
  type Shown = { part: DiffPart; index: number; text: string; hidden?: number; after?: string; lead?: boolean; label?: string };
  const shown = $derived.by((): Shown[] => {
    if (!text) return [];
    const out: Shown[] = [];
    let inChange = false;
    text.parts.forEach((part, index) => {
      if (part.kind !== 'same') {
        // One page label per change, at its start.
        const label = inChange
          ? undefined
          : part.pageA !== part.pageB
            ? `Page ${part.pageB} (page ${part.pageA} in the original)`
            : `Page ${part.pageB}`;
        out.push({ part, index, text: displayText(part.text), label });
        inChange = true;
        return;
      }
      inChange = false;
      const words = part.text.split(/(\s+)/);
      const n = words.length;
      const keep = CONTEXT * 2;
      const join = (from: number, to?: number) => displayText(words.slice(from, to).join(''));
      if (expanded.has(index) || n <= keep * 2) out.push({ part, index, text: displayText(part.text) });
      else if (index === 0) out.push({ part, index, text: join(n - keep), hidden: Math.round((n - keep) / 2), lead: true });
      else if (index === text!.parts.length - 1) out.push({ part, index, text: join(0, keep), hidden: Math.round((n - keep) / 2) });
      else out.push({ part, index, text: join(0, keep), hidden: Math.round((n - keep * 2) / 2), after: join(n - keep) });
    });
    return out;
  });
</script>

<a class="back" href="#/">← All tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">🔀</span>
  <div>
    <h1>Compare PDFs</h1>
    <p class="muted">See exactly what changed between two versions: edited words, and anything that looks different on the page.</p>
  </div>
</div>

<div class="slots">
  {#each slots as [key, label, slot] (key)}
    <div class="slot card">
      <span class="tag">{label}</span>
      {#if slot}
        <div class="name">{slot.data.name}</div>
        <div class="muted small">{slot.pages} page{slot.pages === 1 ? '' : 's'} · {formatBytes(slot.data.bytes.length)}</div>
        <button class="btn small" onclick={() => clear(key)}>Change</button>
      {:else}
        <Dropzone compact accept="application/pdf" multiple={false} label={`Drop the ${label.toLowerCase()} here`} onFiles={(f) => load(key, f)} />
      {/if}
    </div>
  {/each}
  {#if a && b}<button class="icon-btn swap" onclick={swap} aria-label="Swap original and changed" title="Swap">⇄</button>{/if}
</div>

{#if error}<p class="error">{error}</p>{/if}
{#if busy}<p class="muted busy">⏳ {busy}…</p>{/if}

{#if text && !busy}
  <div class="summary card">
    {#if text.changes === 0 && changedPages.length === 0 && a?.pages === b?.pages}
      <strong class="same">✓ No differences found.</strong>
    {:else}
      <div>
        <strong>{text.changes} text change{text.changes === 1 ? '' : 's'}</strong>
        <span class="muted">· <span class="add">{text.added} word{text.added === 1 ? '' : 's'} added</span>, <span class="del">{text.removed} removed</span></span>
      </div>
      <div class="muted">
        {#if changedPages.length}Pages that look different: {changedPages.join(', ')}{:else}Every page looks the same.{/if}
        {#if a && b && a.pages !== b.pages} · The original has {a.pages} pages, the changed version {b.pages}.{/if}
      </div>
    {/if}
  </div>

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'text'} class:active={tab === 'text'} onclick={() => (tab = 'text')}>Text changes</button>
    <button role="tab" aria-selected={tab === 'visual'} class:active={tab === 'visual'} onclick={() => (tab = 'visual')}>Visual comparison</button>
  </div>

  {#if tab === 'text'}
    <div class="card textdiff">
      {#if text.parts.every((p) => !p.text.trim())}
        <p class="muted">Neither file has text to compare (scanned pages?). Use the visual comparison, or make them searchable with <a href="#/tool/pdf.ocr">OCR PDF</a> first.</p>
      {:else if text.changes === 0}
        <p class="muted">The text is identical.</p>
      {:else}
        <p class="legend small muted"><ins>added</ins> <del>removed</del> · ¶ marks a page break</p>
        <div class="flow">
          {#each shown as s (s.index)}
            {#if s.label}<span class="page">{s.label}</span>{/if}
            {#if s.part.kind === 'added'}<ins>{s.text}</ins>{:else if s.part.kind === 'removed'}<del>{s.text}</del>{:else}
              {@const more = s.hidden ? `… ${s.hidden} unchanged words …` : ''}
              {#if s.lead}<button class="more" onclick={() => (expanded = new Set([...expanded, s.index]))}>{more}</button>{/if}<span>{s.text}</span>{#if s.hidden && !s.lead}<button class="more" onclick={() => (expanded = new Set([...expanded, s.index]))}>{more}</button>{/if}{#if s.after}<span>{s.after}</span>{/if}
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="card visual">
      <div class="controls">
        <div class="pages">
          {#each Array.from({ length: maxPages }, (_, i) => i + 1) as p (p)}
            <button class="pg" class:active={page === p} class:changed={changedPages.includes(p)} class:missing={p > Math.min(a?.pages ?? 0, b?.pages ?? 0)} onclick={() => showPage(p)}>{p}</button>
          {/each}
        </div>
        <div class="seg">
          <button class:active={mode === 'highlight'} onclick={() => (mode = 'highlight')}>Highlight</button>
          <button class:active={mode === 'side'} onclick={() => (mode = 'side')}>Side by side</button>
          <button class:active={mode === 'slider'} onclick={() => (mode = 'slider')}>Slider</button>
        </div>
      </div>
      {#if a && b && page > Math.min(a.pages, b.pages)}
        <p class="muted">Page {page} is only in the {a.pages > b.pages ? 'original' : 'changed version'}.</p>
      {:else if images}
        {#if mode === 'highlight'}
          <p class="legend small muted"><span class="del">red</span>: only in the original · <span class="add">green</span>: only in the changed version</p>
          <img class="page-img" src={images.diff} alt="Differences on page {page}" />
        {:else if mode === 'side'}
          <div class="side">
            <figure><figcaption class="muted small">Original</figcaption><img class="page-img" src={images.before} alt="Original page {page}" /></figure>
            <figure><figcaption class="muted small">Changed</figcaption><img class="page-img" src={images.after} alt="Changed page {page}" /></figure>
          </div>
        {:else}
          <div class="slider">
            <img class="page-img" src={images.after} alt="Changed page {page}" draggable="false" />
            <img class="page-img top" src={images.before} alt="Original page {page}" draggable="false" style="clip-path: inset(0 {100 - split}% 0 0)" />
            <div class="divider" style="left: {split}%"></div>
            <input type="range" min="0" max="100" bind:value={split} aria-label="Slide between original and changed" />
          </div>
          <p class="muted small">Left of the line: original. Right: changed version.</p>
        {/if}
      {:else}
        <p class="muted">Rendering page {page}…</p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .back {
    display: inline-block;
    margin-bottom: 12px;
    text-decoration: none;
    font-size: 14px;
  }
  .head {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-bottom: 24px;
  }
  .head h1 {
    margin: 0;
    font-size: 26px;
  }
  .head p {
    margin: 2px 0 0;
  }
  .icon {
    font-size: 28px;
    width: 56px;
    height: 56px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: var(--accent-soft);
  }
  .slots {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  @media (max-width: 700px) {
    .slots {
      grid-template-columns: 1fr;
    }
  }
  .slot {
    padding: 16px;
    display: grid;
    gap: 6px;
    justify-items: start;
    align-content: start;
  }
  .tag {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
  }
  .slot :global(.zone) {
    width: 100%;
  }
  .name {
    font-weight: 600;
    word-break: break-all;
  }
  .swap {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .small {
    font-size: 13px;
  }
  .btn.small {
    padding: 5px 12px;
    font-size: 13.5px;
  }
  .error {
    color: var(--danger);
  }
  .busy {
    margin-top: 16px;
  }
  .summary {
    margin-top: 18px;
    padding: 14px 18px;
    display: grid;
    gap: 2px;
  }
  .same {
    color: var(--success);
  }
  .add,
  ins {
    color: var(--success);
  }
  .del,
  del {
    color: var(--danger);
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin: 18px 0 10px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    padding: 8px 14px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-2);
    font-weight: 600;
  }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .textdiff,
  .visual {
    padding: 18px;
  }
  .legend {
    margin: 0 0 10px;
  }
  .flow {
    line-height: 1.8;
    white-space: pre-wrap;
    word-break: break-word;
  }
  ins {
    background: var(--success-soft);
    text-decoration: none;
    border-radius: 3px;
    padding: 1px 2px;
  }
  del {
    background: var(--danger-soft);
    border-radius: 3px;
    padding: 1px 2px;
  }
  .page {
    display: inline-block;
    margin: 0 6px 0 2px;
    padding: 0 8px;
    border-radius: 99px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
    line-height: 1.7;
  }
  .more {
    border: none;
    background: var(--surface-2);
    color: var(--text-2);
    border-radius: 6px;
    padding: 0 8px;
    margin: 0 4px;
    font-size: 13px;
  }
  .controls {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .pages {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pg {
    min-width: 34px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    position: relative;
  }
  .pg.changed::after {
    content: '';
    position: absolute;
    top: -3px;
    right: -3px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--danger);
  }
  .pg.missing {
    border-style: dashed;
    color: var(--text-3);
  }
  .pg.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
  }
  .seg {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .seg button {
    padding: 5px 10px;
    border: none;
    border-radius: 7px;
    background: none;
    color: var(--text-2);
    font-size: 13.5px;
    font-weight: 550;
  }
  .seg button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .page-img {
    display: block;
    max-width: 100%;
    margin: 0 auto;
    border: 1px solid var(--border);
    background: white;
  }
  .side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  figure {
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .slider {
    position: relative;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
  }
  .slider .top {
    position: absolute;
    inset: 0;
  }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    pointer-events: none;
  }
  .slider input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: ew-resize;
  }
</style>
