<!--
  Editor for Edit PDF text. Every line of text on the page is clickable:
  click to type over it, drag to move it, and use the bar above the page to
  change its font, size, weight, colour, or delete it. "Add text" places new
  text where you click.

  Only changed lines are emitted (see types.ts TextItem); a line put back the
  way it was drops out. Where a line changed, a patch of the page rendered
  without text hides the old letters, so the preview shows the real
  background behind the new text, as the saved file will.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { TextItem } from '../../core/types';
  import { pageText, pageWithoutText } from '../../core/runner';
  import PdfPageView from './PdfPageView.svelte';
  import { usePane } from '../pane';

  /** Window-wide shortcuts and drops go to the tab in use only (see pane.ts). */
  const pane = usePane();

  let {
    bytes,
    pageCount,
    edits,
    onChange,
  }: { bytes: Uint8Array; pageCount: number; edits: TextItem[]; onChange: (e: TextItem[]) => void } = $props();

  interface PageText {
    width: number;
    height: number;
    lines: TextItem[];
  }

  /** Must match engines/text-edit.ts. */
  const LINE_HEIGHT = 1.2;
  /** Distance from the top of a line box to the baseline, in font sizes (typical fonts). */
  const BASELINE = 0.1 + 0.8;
  const COLORS = ['#000000', '#374151', '#e11d48', '#2563eb', '#16a34a', '#ffffff'];
  const FAMILIES: { value: TextItem['family']; label: string }[] = [
    { value: 'sans', label: 'Sans (Helvetica)' },
    { value: 'serif', label: 'Serif (Times)' },
    { value: 'mono', label: 'Mono (Courier)' },
  ];
  const CSS_FAMILY = {
    sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
    serif: '"Times New Roman", Times, "Liberation Serif", serif',
    mono: '"Courier New", Courier, "Liberation Mono", monospace',
  };

  let page = $state(1);
  let mode = $state<'edit' | 'add'>('edit');
  let texts = $state<Record<number, PageText | 'error'>>({});
  let backgrounds = $state<Record<number, string>>({});
  const requested = new Set<string>();
  let selected = $state<string | null>(null);
  /** Style for new text; follows the last change made with the bar. */
  let style = $state({ family: 'sans' as TextItem['family'], bold: false, italic: false, sizePt: 12, color: '#000000' });
  let history: TextItem[][] = [];
  /** Typing records one undo step per selection, not one per key. */
  let typed = false;
  let surfaceW = $state(1);
  let surfaceH = $state(1);

  $effect(() => {
    const n = page;
    if (!requested.has(`t${n}`)) {
      requested.add(`t${n}`);
      pageText(bytes, n)
        .then((t) => (texts[n] = t))
        .catch(() => (texts[n] = 'error'));
    }
    if (!requested.has(`b${n}`)) {
      requested.add(`b${n}`);
      pageWithoutText(bytes, n).then((url) => (backgrounds[n] = url), () => {});
    }
  });
  $effect(() => () => Object.values(backgrounds).forEach((u) => URL.revokeObjectURL(u)));

  const current = $derived(typeof texts[page] === 'object' ? (texts[page] as PageText) : null);
  /** Page width in points, to show sizes in pt. */
  const pageWidth = $derived(current?.width ?? 612);

  interface Shown {
    item: TextItem;
    /** The line as read from the file (existing lines only). */
    original?: TextItem;
    changed: boolean;
  }
  const shown = $derived.by((): Shown[] => {
    const byId = new Map(edits.map((e) => [e.id, e]));
    const out: Shown[] = (current?.lines ?? []).map((line) => ({ item: byId.get(line.id) ?? line, original: line, changed: byId.has(line.id) }));
    for (const e of edits) if (!e.source && e.page === page) out.push({ item: e, changed: true });
    return out;
  });
  const active = $derived(shown.find((s) => s.item.id === selected) ?? null);
  const changedCount = $derived(edits.length);

  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const same = (a: TextItem, b: TextItem) =>
    a.text === b.text && close(a.x, b.x) && close(a.y, b.y) && a.family === b.family && a.bold === b.bold && a.italic === b.italic && close(a.size, b.size) && a.color === b.color;

  function commit(next: TextItem[]) {
    history.push(edits);
    if (history.length > 100) history.shift();
    onChange(next);
  }

  /** Store an item's new state. An existing line put back as it was drops out of the edits. */
  function put(item: TextItem, record = true) {
    const original = current?.lines.find((l) => l.id === item.id);
    const index = edits.findIndex((e) => e.id === item.id);
    const next = edits.filter((e) => e.id !== item.id);
    if (!(original && same(item, original))) next.splice(index >= 0 ? index : next.length, 0, item);
    if (record) commit(next);
    else onChange(next);
  }

  function undo() {
    const prev = history.pop();
    if (prev) onChange(prev);
    selected = null;
  }

  /** Change selection; new text left empty is dropped. */
  function select(id: string | null) {
    const prev = edits.find((e) => e.id === selected);
    if (prev && !prev.source && !prev.text.trim() && prev.id !== id) onChange(edits.filter((e) => e !== prev));
    selected = id;
    typed = false;
  }

  function onSurfaceDown(e: PointerEvent) {
    if (e.target !== e.currentTarget) return;
    if (mode !== 'add' || !current) return select(null);
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const size = style.sizePt / pageWidth;
    const item: TextItem = {
      id: `new-${crypto.randomUUID()}`,
      page,
      x: (e.clientX - r.left) / r.width,
      // The click marks the top of the text.
      y: (e.clientY - r.top + size * surfaceW * 0.8) / r.height,
      text: '',
      family: style.family,
      bold: style.bold,
      italic: style.italic,
      size,
      color: style.color,
    };
    select(null);
    commit([...edits, item]);
    selected = item.id;
    typed = true;
  }

  /** Press on a line: a drag moves it, a click selects it for typing. */
  function press(e: PointerEvent, s: Shown) {
    e.preventDefault();
    e.stopPropagation();
    const surface = (e.currentTarget as Element).closest('.surface') as HTMLElement;
    const r = surface.getBoundingClientRect();
    const start = s.item;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!moved) history.push(edits);
      moved = true;
      put({ ...start, x: start.x + (ev.clientX - e.clientX) / r.width, y: start.y + (ev.clientY - e.clientY) / r.height }, false);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (selected !== start.id) select(start.id);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function type(item: TextItem, text: string) {
    if (!typed) history.push(edits);
    typed = true;
    put({ ...item, text }, false);
  }

  /** Apply a style change to the selected line (if any) and to new text. */
  function restyle(patch: Partial<TextItem>) {
    if (patch.family && patch.family !== 'original') style.family = patch.family;
    if (patch.bold !== undefined) style.bold = patch.bold;
    if (patch.italic !== undefined) style.italic = patch.italic;
    if (patch.color) style.color = patch.color;
    if (patch.size) style.sizePt = Math.round(patch.size * pageWidth * 10) / 10;
    if (!active) return;
    const item = active.item;
    // The original font comes in one weight and slant; changing them needs a standard font.
    const leaves = (patch.bold !== undefined && patch.bold !== item.bold) || (patch.italic !== undefined && patch.italic !== item.italic);
    const family = item.family === 'original' && leaves ? item.source!.generic : item.family;
    put({ ...item, family, ...patch });
  }

  function remove() {
    if (!active) return;
    if (active.original) put({ ...active.item, text: '' });
    else commit(edits.filter((e) => e.id !== active!.item.id));
    selected = null;
  }

  function revert() {
    if (!active) return;
    commit(edits.filter((e) => e.id !== active!.item.id));
  }

  $effect(() => {
    page;
    untrack(() => select(null));
  });

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pane.active) return;
      if ((e.target as HTMLElement).closest('textarea, input, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  /** Focus the field for a line once the click that selected it has finished. */
  function focusSoon(el: HTMLTextAreaElement) {
    el.focus();
    requestAnimationFrame(() => {
      if (document.activeElement !== el) el.focus();
    });
  }

  /** CSS font for a line; for its own font, try the font's name before the closest standard one. */
  function fontCss(item: TextItem): string {
    const generic = item.family === 'original' ? (item.source?.generic ?? 'sans') : item.family;
    const own = item.family === 'original' && item.source ? `"${fontName(item.source.font).replace(/["\\]/g, '')}", ` : '';
    return `font-family:${own}${CSS_FAMILY[generic]};font-weight:${item.bold ? 700 : 400};font-style:${item.italic ? 'italic' : 'normal'};font-size:${item.size * surfaceW}px;color:${item.color}`;
  }

  /** "ABCDEF+Calibri-Bold" → "Calibri". */
  const fontName = (name: string) => name.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0];

  const at = (item: TextItem) => `left:${item.x * 100}%;top:calc(${item.y * 100}% - ${BASELINE}em)`;
  const box = (b: { x: number; y: number; w: number; h: number }) => `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`;

  /** A piece of the text-free page exactly behind `b`. */
  function patch(b: { x: number; y: number; w: number; h: number }): string {
    const bg = backgrounds[page];
    if (!bg) return `${box(b)};background:#fff`;
    return `${box(b)};background-image:url(${bg});background-size:${surfaceW}px ${surfaceH}px;background-position:${-b.x * surfaceW}px ${-b.y * surfaceH}px`;
  }

  const sizePt = $derived(active ? Math.round(active.item.size * pageWidth * 10) / 10 : style.sizePt);
  const look = $derived(active?.item ?? { ...style, family: style.family });
</script>

<div class="modes" role="toolbar" aria-label="Text tools">
  <button class="mode" class:active={mode === 'edit'} aria-pressed={mode === 'edit'} onclick={() => (mode = 'edit')}>
    <span class="micon">I</span>Edit text
  </button>
  <button class="mode" class:active={mode === 'add'} aria-pressed={mode === 'add'} onclick={() => (mode = 'add')}>
    <span class="micon">+</span>Add text
  </button>
  <span class="spacer"></span>
  <button class="btn small" disabled={!history.length} onclick={undo} title="Undo (Ctrl+Z)">↶ Undo</button>
</div>

<div class="bar" aria-label="Text style">
  <select
    aria-label="Font"
    value={look.family}
    onchange={(e) => restyle({ family: e.currentTarget.value as TextItem['family'] })}
  >
    {#if active?.item.source}
      <option value="original">Original ({fontName(active.item.source.font)})</option>
    {/if}
    {#each FAMILIES as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
  </select>
  <label class="size">
    <input
      type="number"
      min="4"
      max="200"
      step="0.5"
      value={sizePt}
      aria-label="Font size"
      onchange={(e) => {
        const v = Number(e.currentTarget.value);
        if (v >= 4 && v <= 200) restyle({ size: v / pageWidth });
      }}
    />
    pt
  </label>
  <button class="toggle" class:active={look.bold} aria-pressed={look.bold} title="Bold" onclick={() => restyle({ bold: !look.bold })}><b>B</b></button>
  <button class="toggle" class:active={look.italic} aria-pressed={look.italic} title="Italic" onclick={() => restyle({ italic: !look.italic })}><i>I</i></button>
  <div class="swatches" role="radiogroup" aria-label="Colour">
    {#each COLORS as c (c)}
      <button class="swatch" class:active={look.color === c} style="background:{c}" aria-label="Colour {c}" onclick={() => restyle({ color: c })}></button>
    {/each}
    <input type="color" value={look.color} aria-label="Other colour" onchange={(e) => restyle({ color: e.currentTarget.value })} />
  </div>
  {#if active}
    <span class="spacer"></span>
    {#if active.original && active.changed}
      <button class="btn small" onclick={revert} title="Put this line back as it was">Revert</button>
    {/if}
    <button class="btn small danger" onclick={remove}>Delete</button>
  {/if}
</div>

<p class="hint muted">
  {#if mode === 'add'}
    Click where the new text should start, then type.
  {:else if active}
    Type to change the line. Drag it to move it. Font, size and colour apply to this line.
  {:else}
    Click any text to change it, or drag it to move it.
  {/if}
</p>

<PdfPageView {bytes} {pageCount} bind:page>
  {#snippet toolbar()}
    <span class="muted count">{changedCount} change{changedCount === 1 ? '' : 's'}</span>
    {#if changedCount}<button class="btn" onclick={() => { commit([]); selected = null; }}>Discard all</button>{/if}
  {/snippet}
  {#snippet overlay()}
    <div
      class="surface mode-{mode}"
      role="application"
      aria-label="Edit text on the page"
      bind:clientWidth={surfaceW}
      bind:clientHeight={surfaceH}
      onpointerdown={onSurfaceDown}
    >
      <!-- Patches first, so they never cover text moved over another changed line. -->
      {#each shown as s (s.item.id)}
        {#if s.original?.source && (s.changed || selected === s.item.id)}
          <div class="patch" style={patch(s.original.source)}></div>
        {/if}
      {/each}
      {#each shown as s (s.item.id)}
        {@const item = s.item}
        {#if selected === item.id}
          <div class="editing" style="{at(item)};{fontCss(item)}">
            <button class="grip" title="Drag to move" aria-label="Move" onpointerdown={(e) => press(e, s)}>✥</button>
            <textarea
              rows="1"
              spellcheck="false"
              value={item.text}
              placeholder={s.original ? '(deleted)' : 'Type here'}
              use:focusSoon
              onpointerdown={(e) => e.stopPropagation()}
              oninput={(e) => type(item, e.currentTarget.value)}
              onkeydown={(e) => e.key === 'Escape' && select(null)}
            ></textarea>
          </div>
        {:else if s.changed && item.text}
          <div class="text" role="presentation" style="{at(item)};{fontCss(item)}" onpointerdown={(e) => press(e, s)}>{item.text}</div>
        {:else if s.original?.source}
          <div
            class="hit"
            class:deleted={s.changed}
            role="presentation"
            title={s.changed ? 'Deleted: click to bring back' : ''}
            style={box(s.original.source)}
            onpointerdown={(e) => press(e, s)}
          ></div>
        {/if}
      {/each}
    </div>
  {/snippet}
</PdfPageView>

{#if texts[page] === 'error'}
  <p class="error">The text on this page couldn't be read.</p>
{:else if !current}
  <p class="muted small tip">Reading text…</p>
{:else if current.lines.length === 0}
  <p class="muted small tip">
    No text found on this page. If it is a scan, run <a href="#/tool/pdf.ocr">OCR PDF</a> first. You can still add new text.
  </p>
{:else}
  <p class="muted small tip">
    Changed lines keep their font when it has every letter you type; otherwise the closest standard font is used. Lines are
    edited one at a time, so a longer line doesn't push the next ones down.
  </p>
{/if}

<style>
  .modes {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .mode {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--text-2);
    font-size: 13.5px;
    font-weight: 550;
  }
  .mode.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .micon {
    font-weight: 800;
    font-family: Georgia, serif;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .bar select,
  .size input {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
  }
  .size {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13.5px;
    color: var(--text-2);
  }
  .size input {
    width: 70px;
  }
  .toggle {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
  }
  .toggle.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .swatches {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
  }
  .swatch.active {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .swatches input[type='color'] {
    width: 28px;
    height: 26px;
    padding: 0;
    border: none;
    background: none;
  }
  .spacer {
    flex: 1;
  }
  .btn.small {
    padding: 5px 12px;
    font-size: 13.5px;
  }
  .btn.danger {
    color: var(--danger);
  }
  .hint,
  .tip {
    margin: 0;
    font-size: 13.5px;
  }
  .count {
    font-size: 14px;
  }
  .surface {
    position: absolute;
    inset: 0;
    touch-action: none;
  }
  .surface.mode-add {
    cursor: text;
  }
  .hit {
    position: absolute;
    cursor: text;
    border-radius: 2px;
  }
  .hit:hover {
    outline: 1.5px solid var(--accent);
    outline-offset: 1px;
    background: rgb(79 70 229 / 8%);
  }
  .hit.deleted {
    outline: 1px dashed var(--text-3);
    opacity: 0.6;
  }
  .patch {
    position: absolute;
    pointer-events: none;
    background-repeat: no-repeat;
    outline: 1px solid transparent;
  }
  .text,
  .editing {
    position: absolute;
    line-height: 1.2;
    white-space: pre;
  }
  .text {
    cursor: move;
  }
  .text:hover {
    outline: 1.5px dashed var(--accent);
    outline-offset: 1px;
  }
  .editing {
    z-index: 2;
  }
  .editing textarea {
    display: block;
    margin: 0;
    padding: 0;
    border: none;
    outline: 1.5px solid var(--accent);
    outline-offset: 1px;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: inherit;
    white-space: pre;
    overflow: hidden;
    resize: none;
    field-sizing: content;
    min-width: 3ch;
  }
  .editing textarea::placeholder {
    color: var(--text-3);
    font-style: italic;
  }
  .grip {
    position: absolute;
    right: 100%;
    top: 0;
    margin-right: 4px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    font: 12px/20px var(--font);
    font-style: normal;
    font-weight: 600;
    cursor: move;
    touch-action: none;
  }
</style>
