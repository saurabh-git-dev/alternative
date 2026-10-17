<!--
  Annotation editor for Annotate PDF: pen, highlighter, text boxes, boxes,
  ellipses, arrows, white-out and comments, drawn straight on the page.
  "Select" moves or deletes a mark; Ctrl/Cmd+Z undoes.

  Geometry is stored in fractions of the page (see types.ts Annotation), so it
  is independent of zoom; line widths and font sizes are fractions of the page
  width, which the engine turns back into points.
-->
<script lang="ts">
  import type { Annotation } from '../../core/types';
  import PdfPageView from './PdfPageView.svelte';
  import { drawBox, relative } from './BoxDrag';

  let {
    bytes,
    pageCount,
    annotations,
    onChange,
  }: { bytes: Uint8Array; pageCount: number; annotations: Annotation[]; onChange: (a: Annotation[]) => void } = $props();

  type Tool = 'select' | Annotation['kind'];
  const TOOLS: { id: Tool; icon: string; label: string; hint: string }[] = [
    { id: 'select', icon: '👆', label: 'Select', hint: 'Click a mark to move it, or delete it with ✕ or the Delete key' },
    { id: 'text', icon: 'T', label: 'Text', hint: 'Click where the text should go, then type' },
    { id: 'highlight', icon: '🖍️', label: 'Highlight', hint: 'Drag over text to highlight it' },
    { id: 'pen', icon: '✏️', label: 'Pen', hint: 'Draw freely' },
    { id: 'box', icon: '▭', label: 'Box', hint: 'Drag to draw a box' },
    { id: 'ellipse', icon: '◯', label: 'Circle', hint: 'Drag to draw a circle or ellipse' },
    { id: 'arrow', icon: '↗', label: 'Arrow', hint: 'Drag from the start to where the arrow points' },
    { id: 'whiteout', icon: '⬜', label: 'White-out', hint: 'Drag to cover something with white (it is still in the file underneath; use Redact PDF to remove it)' },
    { id: 'comment', icon: '💬', label: 'Comment', hint: 'Click to pin a note; it opens as a comment in PDF viewers' },
  ];
  const COLORS = ['#111827', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#fde047'];
  /** Letter-size widths (612 pt) as reference for the presets. */
  const WIDTHS = [
    { label: 'Thin', value: 1 / 612 },
    { label: 'Medium', value: 2.5 / 612 },
    { label: 'Thick', value: 5 / 612 },
  ];
  const SIZES = [
    { label: 'S', value: 10 / 612 },
    { label: 'M', value: 14 / 612 },
    { label: 'L', value: 22 / 612 },
  ];

  let page = $state(1);
  let tool = $state<Tool>('text');
  /** Each tool remembers its own colour. */
  let colors = $state<Record<string, string>>({ highlight: '#fde047', text: '#111827', comment: '#f59e0b', default: '#e11d48' });
  let width = $state(WIDTHS[1].value);
  let size = $state(SIZES[1].value);
  let selected = $state<number | null>(null);
  let editing = $state<number | null>(null);
  let draft = $state<Annotation | null>(null);
  let history: Annotation[][] = [];
  let surfaceW = $state(1);
  let surfaceH = $state(1);

  const color = $derived(colors[tool] ?? colors.default);
  const hint = $derived(TOOLS.find((t) => t.id === tool)!.hint);

  function setColor(c: string) {
    colors[tool in colors ? tool : 'default'] = c;
    if (selected !== null) update(selected, { color: c });
  }

  function commit(next: Annotation[]) {
    history.push(annotations);
    if (history.length > 100) history.shift();
    onChange(next);
  }

  function update(i: number, patch: Partial<Annotation>) {
    commit(annotations.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }

  function remove(i: number) {
    commit(annotations.filter((_, j) => j !== i));
    selected = null;
    editing = null;
  }

  function undo() {
    const prev = history.pop();
    if (prev) onChange(prev);
    selected = null;
    editing = null;
  }

  function base(kind: Annotation['kind']): Annotation {
    return { page, kind, color: colors[kind] ?? colors.default, width, x: 0, y: 0, w: 0, h: 0 };
  }

  /** Text box size from its content, in page fractions. */
  function textBox(text: string, fontSize: number): { w: number; h: number } {
    const lines = text.split('\n');
    const longest = Math.max(4, ...lines.map((l) => l.length));
    const aspect = surfaceW / surfaceH;
    return { w: Math.min(0.95, longest * fontSize * 0.55 + fontSize), h: lines.length * fontSize * 1.3 * aspect + fontSize * 0.4 * aspect };
  }

  function onPointerDown(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    if (editing !== null) {
      // Clicking away ends editing (removing a focused textarea fires no blur).
      stopEditing();
      return;
    }
    selected = null;
    if (tool === 'select') return;
    const p = relative(el, e);

    if (tool === 'text' || tool === 'comment') {
      e.preventDefault();
      const a: Annotation =
        tool === 'text'
          ? { ...base('text'), x: p.x, y: p.y, ...textBox('', size), text: '', size }
          : { ...base('comment'), x: p.x, y: p.y, text: '' };
      const index = annotations.length;
      commit([...annotations, a]);
      editing = index;
      return;
    }
    if (tool === 'pen') {
      e.preventDefault();
      const stroke: [number, number][] = [[p.x, p.y]];
      draft = { ...base('pen'), points: [stroke] };
      const move = (ev: PointerEvent) => {
        const q = relative(el, ev);
        const [lx, ly] = stroke[stroke.length - 1];
        if (Math.hypot((q.x - lx) * surfaceW, (q.y - ly) * surfaceH) < 2) return;
        stroke.push([q.x, q.y]);
        draft = { ...draft!, points: [[...stroke]] };
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        if (stroke.length > 1) {
          const xs = stroke.map((s) => s[0]);
          const ys = stroke.map((s) => s[1]);
          const [x, y] = [Math.min(...xs), Math.min(...ys)];
          commit([...annotations, { ...draft!, points: [stroke], x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }]);
        }
        draft = null;
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      return;
    }
    if (tool === 'arrow') {
      e.preventDefault();
      const start: [number, number] = [p.x, p.y];
      draft = { ...base('arrow'), points: [[start, start]] };
      const move = (ev: PointerEvent) => {
        const q = relative(el, ev);
        draft = { ...draft!, points: [[start, [q.x, q.y]]] };
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        const [[a, b]] = draft!.points!;
        if (Math.hypot((b[0] - a[0]) * surfaceW, (b[1] - a[1]) * surfaceH) > 8) {
          commit([...annotations, { ...draft!, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }]);
        }
        draft = null;
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      return;
    }
    // Box-shaped tools.
    const kind = tool;
    drawBox(
      el,
      e,
      (b) => (draft = { ...base(kind), ...b }),
      (b) => {
        draft = null;
        if (b.w * surfaceW > 4 && b.h * surfaceH > 4) commit([...annotations, { ...base(kind), ...b }]);
      },
    );
  }

  /** Select a mark and let it be dragged. */
  function grab(e: PointerEvent, i: number) {
    if (tool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    selected = i;
    const surface = (e.currentTarget as Element).closest('.surface') as HTMLElement;
    const origin = relative(surface, e);
    const start = annotations[i];
    let moved = false;
    const move = (ev: PointerEvent) => {
      const q = relative(surface, ev);
      const dx = q.x - origin.x;
      const dy = q.y - origin.y;
      if (!moved && Math.abs(dx * surfaceW) + Math.abs(dy * surfaceH) < 3) return;
      if (!moved) history.push(annotations);
      moved = true;
      const shifted: Annotation = {
        ...start,
        x: start.x + dx,
        y: start.y + dy,
        points: start.points?.map((s) => s.map(([x, y]): [number, number] => [x + dx, y + dy])),
      };
      onChange(annotations.map((a, j) => (j === i ? shifted : a)));
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  /**
   * Focus a new text field once the click that created it has finished
   * (the pointerdown is cancelled to stop text selection, which also stops
   * the browser from moving focus).
   */
  function focusSoon(el: HTMLTextAreaElement) {
    el.focus();
    requestAnimationFrame(() => document.activeElement !== el && el.focus());
  }

  /** Live update while typing (not an undo step); the box grows with the text. */
  function typeText(i: number, text: string) {
    onChange(annotations.map((x, j) => (j === i ? { ...x, text, ...(x.kind === 'text' ? textBox(text, x.size ?? size) : {}) } : x)));
  }

  /** Leave editing; an empty text box or comment is removed. */
  function stopEditing() {
    const i = editing;
    editing = null;
    if (i !== null && annotations[i] && !annotations[i].text?.trim()) remove(i);
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
        e.preventDefault();
        remove(selected);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const onPage = $derived(annotations.map((a, i) => ({ a, i })).filter(({ a }) => a.page === page));
  const px = (fx: number) => fx * surfaceW;
  const py = (fy: number) => fy * surfaceH;

  /** Arrowhead as a path: two short strokes back from the tip. */
  function arrowHead([[x0, y0], [x1, y1]]: [number, number][], w: number): string {
    const [ax, ay, bx, by] = [px(x0), py(y0), px(x1), py(y1)];
    const angle = Math.atan2(by - ay, bx - ax);
    const len = Math.max(10, w * 4);
    const p = (da: number) => `${bx - len * Math.cos(angle + da)},${by - len * Math.sin(angle + da)}`;
    return `M${p(0.45)} L${bx},${by} L${p(-0.45)}`;
  }
</script>

<div class="tools" role="toolbar" aria-label="Annotation tools">
  {#each TOOLS as t (t.id)}
    <button class="tool" class:active={tool === t.id} onclick={() => { tool = t.id; selected = null; stopEditing(); }} title={t.label} aria-pressed={tool === t.id}>
      <span class="ticon">{t.icon}</span><span class="tlabel">{t.label}</span>
    </button>
  {/each}
</div>
<div class="options">
  <div class="swatches" role="radiogroup" aria-label="Colour">
    {#each COLORS as c (c)}
      <button class="swatch" class:active={(selected !== null ? annotations[selected]?.color : color) === c} style="background:{c}" aria-label="Colour {c}" onclick={() => setColor(c)}></button>
    {/each}
  </div>
  {#if ['pen', 'box', 'ellipse', 'arrow'].includes(tool)}
    <div class="seg">
      {#each WIDTHS as w (w.label)}
        <button class:active={width === w.value} onclick={() => (width = w.value)}>{w.label}</button>
      {/each}
    </div>
  {/if}
  {#if tool === 'text'}
    <div class="seg" aria-label="Text size">
      {#each SIZES as s (s.label)}
        <button class:active={size === s.value} onclick={() => (size = s.value)}>{s.label}</button>
      {/each}
    </div>
  {/if}
  <span class="spacer"></span>
  <button class="btn small" disabled={!history.length} onclick={undo} title="Undo (Ctrl+Z)">↶ Undo</button>
</div>
<p class="hint muted">{hint}</p>

<PdfPageView {bytes} {pageCount} bind:page>
  {#snippet toolbar()}
    <span class="muted count">{annotations.length} mark{annotations.length === 1 ? '' : 's'}</span>
    {#if annotations.length}<button class="btn" onclick={() => commit([])}>Clear all</button>{/if}
  {/snippet}
  {#snippet overlay()}
    <div
      class="surface tool-{tool}"
      role="application"
      aria-label="Annotate page"
      bind:clientWidth={surfaceW}
      bind:clientHeight={surfaceH}
      onpointerdown={onPointerDown}
    >
      <svg width={surfaceW} height={surfaceH} viewBox="0 0 {surfaceW} {surfaceH}">
        {#each [...onPage, ...(draft ? [{ a: draft, i: -1 }] : [])] as { a, i } (i)}
          {@const sw = Math.max(1, a.width * surfaceW)}
          <g class="mark" class:selected={selected === i} onpointerdown={(e) => i >= 0 && grab(e, i)} role="presentation">
            {#if a.kind === 'pen'}
              {#each a.points ?? [] as stroke, k (k)}
                <polyline points={stroke.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} fill="none" stroke={a.color} stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" />
                <polyline class="hit" points={stroke.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} fill="none" stroke-width={sw + 12} />
              {/each}
            {:else if a.kind === 'highlight'}
              <rect x={px(a.x)} y={py(a.y)} width={px(a.w)} height={py(a.h)} fill={a.color} opacity="0.45" style="mix-blend-mode: multiply" />
            {:else if a.kind === 'box'}
              <rect x={px(a.x)} y={py(a.y)} width={px(a.w)} height={py(a.h)} fill="transparent" stroke={a.color} stroke-width={sw} />
            {:else if a.kind === 'ellipse'}
              <ellipse cx={px(a.x + a.w / 2)} cy={py(a.y + a.h / 2)} rx={px(a.w / 2)} ry={py(a.h / 2)} fill="transparent" stroke={a.color} stroke-width={sw} />
            {:else if a.kind === 'whiteout'}
              <rect x={px(a.x)} y={py(a.y)} width={px(a.w)} height={py(a.h)} fill="#fff" stroke="#cbd5e1" stroke-dasharray="4 3" stroke-width="1" />
            {:else if a.kind === 'arrow' && a.points}
              {@const [[x0, y0], [x1, y1]] = a.points[0]}
              <line x1={px(x0)} y1={py(y0)} x2={px(x1)} y2={py(y1)} stroke={a.color} stroke-width={sw} stroke-linecap="round" />
              <path d={arrowHead(a.points[0], sw)} fill="none" stroke={a.color} stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" />
              <line class="hit" x1={px(x0)} y1={py(y0)} x2={px(x1)} y2={py(y1)} stroke-width={sw + 12} />
            {/if}
          </g>
        {/each}
      </svg>

      {#each onPage as { a, i } (i)}
        {#if a.kind === 'text'}
          {#if editing === i}
            <textarea
              class="text-edit"
              style="left:{a.x * 100}%;top:{a.y * 100}%;font-size:{(a.size ?? size) * surfaceW}px;color:{a.color};min-width:{Math.max(a.w, 0.2) * 100}%"
              value={a.text}
              use:focusSoon
              onpointerdown={(e) => e.stopPropagation()}
              oninput={(e) => typeText(i, e.currentTarget.value)}
              onblur={stopEditing}
              onkeydown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
            ></textarea>
          {:else}
            <div
              class="text"
              class:selected={selected === i}
              role="presentation"
              style="left:{a.x * 100}%;top:{a.y * 100}%;font-size:{(a.size ?? size) * surfaceW}px;color:{a.color}"
              onpointerdown={(e) => grab(e, i)}
              ondblclick={() => (editing = i)}
            >{a.text}</div>
          {/if}
        {:else if a.kind === 'comment'}
          <div class="comment" class:selected={selected === i} role="presentation" style="left:{a.x * 100}%;top:{a.y * 100}%;--c:{a.color}" onpointerdown={(e) => grab(e, i)} ondblclick={() => (editing = i)}>
            💬
            {#if editing === i}
              <textarea
                class="note"
                placeholder="Write a comment…"
                value={a.text}
                use:focusSoon
                onpointerdown={(e) => e.stopPropagation()}
                oninput={(e) => typeText(i, e.currentTarget.value)}
                onblur={stopEditing}
              ></textarea>
            {:else if a.text}
              <span class="bubble">{a.text}</span>
            {/if}
          </div>
        {/if}
        {#if selected === i}
          <button
            class="remove"
            style="left:{(a.x + Math.max(a.w, 0.02)) * 100}%;top:{a.y * 100}%"
            aria-label="Delete this mark"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => remove(i)}>✕</button
          >
        {/if}
      {/each}
    </div>
  {/snippet}
</PdfPageView>
<p class="muted small tip">Tip: double-click a text box or comment to edit it.</p>

<style>
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--text-2);
    font-size: 13.5px;
    font-weight: 550;
  }
  .tool.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .ticon {
    font-weight: 800;
    min-width: 1em;
    text-align: center;
  }
  @media (max-width: 700px) {
    .tlabel {
      display: none;
    }
  }
  .options {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .swatches {
    display: flex;
    gap: 6px;
  }
  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
  }
  .swatch.active {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--surface-2);
  }
  .seg button {
    padding: 4px 10px;
    border: none;
    border-radius: 6px;
    background: none;
    font-size: 13px;
    color: var(--text-2);
  }
  .seg button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .spacer {
    flex: 1;
  }
  .btn.small {
    padding: 5px 12px;
    font-size: 13.5px;
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
    cursor: crosshair;
  }
  .surface.tool-select {
    cursor: default;
  }
  .surface.tool-text {
    cursor: text;
  }
  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  .mark .hit {
    stroke: transparent;
  }
  .tool-select .mark {
    cursor: move;
  }
  .mark.selected {
    filter: drop-shadow(0 0 2px var(--accent));
  }
  .text {
    position: absolute;
    white-space: pre;
    line-height: 1.3;
    font-family: Helvetica, Arial, sans-serif;
    padding: 0 0.15em;
  }
  .tool-select .text,
  .tool-select .comment {
    cursor: move;
  }
  .text.selected,
  .comment.selected {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }
  .text-edit {
    position: absolute;
    z-index: 2;
    font-family: Helvetica, Arial, sans-serif;
    line-height: 1.3;
    padding: 0 0.15em;
    border: 1px dashed var(--accent);
    background: rgb(255 255 255 / 85%);
    resize: both;
    field-sizing: content;
    min-height: 1.6em;
  }
  .comment {
    position: absolute;
    transform: translate(-4px, -4px);
    font-size: 20px;
    line-height: 1;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 30%));
  }
  .bubble,
  .note {
    position: absolute;
    left: 26px;
    top: 0;
    width: 200px;
    padding: 6px 8px;
    border-radius: 8px;
    background: #fffbe6;
    border: 1px solid var(--c);
    color: #1d2130;
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
  }
  .bubble {
    display: none;
  }
  .comment:hover .bubble {
    display: block;
  }
  .note {
    z-index: 2;
    min-height: 70px;
    font-family: inherit;
  }
  .remove {
    position: absolute;
    z-index: 3;
    transform: translate(-50%, -50%);
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: none;
    background: #e11d48;
    color: white;
    font-size: 11px;
    display: grid;
    place-items: center;
  }
</style>
