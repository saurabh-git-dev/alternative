<!--
  Video workspace: a player with the editor a video tool needs.

  - `trim`: a timeline with start and end handles (Trim, Video to GIF).
  - `time`: pick one moment (Save a frame).
  - `crop`: a crop box over the video, with aspect ratios (Crop video).
  - `masks`: draw boxes to hide; each has its own time span (Blur or hide area).
    Boxes preview the effect live (blur via CSS backdrop-filter).

  Values are plain data (seconds, fractions of the frame), so the action
  applies them the same way in either engine.
-->
<script lang="ts">
  import type { Box } from '../../core/types';
  import { formatTime, maskActive, type MaskBox, type MaskStyle, type TimeRange } from '../../core/video';
  import { dragBox, drawBox, type Handle } from './BoxDrag';

  type Mode = 'trim' | 'time' | 'crop' | 'masks';
  type Value = TimeRange | number | Box | MaskBox[];

  let {
    src,
    mode,
    value,
    onChange,
    initialLength,
    maxLength,
    effect: look,
  }: {
    src: string;
    mode: Mode;
    value: Value;
    onChange: (v: Value) => void;
    initialLength?: number;
    maxLength?: number;
    effect?: { style: MaskStyle; strength: number; color: string };
  } = $props();

  let video = $state<HTMLVideoElement>();
  let stage = $state<HTMLElement>();
  let timeline = $state<HTMLElement>();
  let duration = $state(0);
  let current = $state(0);
  let playing = $state(false);
  let natural = $state({ w: 0, h: 0 });
  let failed = $state(false);
  let ratio = $state<number | null>(null);
  let selected = $state<number | null>(null);
  let drafting = $state<Box | null>(null);

  const range = $derived(mode === 'trim' ? (value as TimeRange) : null);
  const rangeEnd = $derived(range ? (range.end > 0 ? range.end : duration) : 0);
  const masks = $derived(mode === 'masks' ? (value as MaskBox[]) : []);
  const box = $derived(mode === 'crop' ? (value as Box) : null);

  function loaded() {
    const v = video!;
    duration = Number.isFinite(v.duration) ? v.duration : 0;
    natural = { w: v.videoWidth, h: v.videoHeight };
    // MediaRecorder WebM files report Infinity until the end is reached once.
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9;
      v.addEventListener('timeupdate', () => {
        duration = v.duration;
        v.currentTime = 0;
      }, { once: true });
    }
    if (mode === 'trim' && range && range.end === 0 && initialLength && duration > initialLength) {
      onChange({ start: 0, end: initialLength });
    }
    if (mode === 'time') seek(Math.min(value as number, duration));
  }

  function seek(t: number) {
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(t, duration || t));
    current = video.currentTime;
  }

  function toggle() {
    if (!video) return;
    if (video.paused) {
      if (range && (current < range.start || current >= rangeEnd - 0.05)) seek(range.start);
      video.play();
    } else video.pause();
  }

  function tick() {
    current = video!.currentTime;
    // Trim previews only the kept part.
    if (range && playing && current >= rangeEnd) {
      video!.pause();
      seek(range.start);
    }
    if (mode === 'time' && !playing) onChange(current);
  }

  function setRange(start: number, end: number) {
    start = Math.max(0, Math.min(start, duration));
    end = Math.max(start + 0.1, Math.min(end, duration));
    if (maxLength && end - start > maxLength) end = start + maxLength;
    onChange({ start: round(start), end: end >= duration - 0.01 ? 0 : round(end) });
  }

  const round = (t: number) => Math.round(t * 1000) / 1000;

  function timeAt(e: PointerEvent): number {
    const r = timeline!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  }

  /** Drag a trim handle (or the playhead when `which` is 'seek'). */
  function dragTime(e: PointerEvent, which: 'start' | 'end' | 'seek') {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: PointerEvent) => {
      const t = timeAt(ev);
      if (which === 'seek' || !range) seek(t);
      else if (which === 'start') {
        setRange(Math.min(t, rangeEnd - 0.1), rangeEnd);
        seek(Math.min(t, rangeEnd - 0.1));
      } else {
        setRange(range.start, Math.max(t, range.start + 0.1));
        seek(Math.max(t, range.start + 0.1));
      }
    };
    move(e);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // Crop ------------------------------------------------------------------
  const RATIOS: [string, number | null][] = [
    ['Free', null],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['4:3', 4 / 3],
  ];

  function setRatio(r: number | null) {
    ratio = r;
    if (!r || !natural.w) return;
    const own = natural.w / natural.h;
    let w = 1, h = 1;
    if (r > own) h = own / r;
    else w = r / own;
    onChange({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }

  function startCrop(e: PointerEvent, handle: Handle) {
    dragBox(stage!, e, box!, handle, onChange, ratio ?? undefined);
  }

  // Masks -----------------------------------------------------------------
  function updateMask(i: number, patch: Partial<MaskBox>) {
    onChange(masks.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  function startDraw(e: PointerEvent) {
    if (e.target !== e.currentTarget) return;
    video?.pause();
    drawBox(stage!, e, (b) => (drafting = b), (b) => {
      drafting = null;
      if (b.w < 0.01 || b.h < 0.01) {
        selected = null;
        return;
      }
      onChange([...masks, { ...b, start: 0, end: 0 }]);
      selected = masks.length;
    });
  }

  function moveMask(e: PointerEvent, i: number, handle: Handle) {
    selected = i;
    video?.pause();
    dragBox(stage!, e, masks[i], handle, (b) => updateMask(i, b));
  }

  function removeMask(i: number) {
    onChange(masks.filter((_, j) => j !== i));
    selected = null;
  }

  const sel = $derived(selected !== null ? masks[selected] : undefined);
  const backdrop = $derived(
    !look || look.style === 'solid' ? '' : `backdrop-filter: blur(${Math.round(4 + look.strength / 6)}px); -webkit-backdrop-filter: blur(${Math.round(4 + look.strength / 6)}px);`,
  );

  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : '0%');
  const px = $derived(box && natural.w ? `${Math.round(box.w * natural.w)} × ${Math.round(box.h * natural.h)} px` : '');

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) removeMask(selected);
      else if (e.key === 'ArrowLeft') seek(current - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'ArrowRight') seek(current + (e.shiftKey ? 1 : 1 / 30));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
</script>

{#if failed}
  <p class="warn">
    This browser can't play this video format, so it can't be previewed here. Use
    <a href="#/tool/video.convert">Convert video</a> to make an MP4 first, then come back.
  </p>
{:else}
  {#if mode === 'crop'}
    <div class="toolbar">
      {#each RATIOS as [label, r] (label)}
        <button class="chip" class:active={ratio === r} onclick={() => setRatio(r)}>{label}</button>
      {/each}
      <span class="muted size">{px}</span>
      <button class="chip" onclick={() => { ratio = null; onChange({ x: 0, y: 0, w: 1, h: 1 }); }}>Reset</button>
    </div>
  {:else if mode === 'masks'}
    <p class="hint muted">Drag on the video to cover an area. Pick a box to move it, resize it or set when it shows.</p>
  {/if}

  <div class="stage-wrap">
    <div class="stage" bind:this={stage}>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={video}
        {src}
        playsinline
        preload="auto"
        onloadedmetadata={loaded}
        ontimeupdate={tick}
        onseeked={tick}
        onplay={() => (playing = true)}
        onpause={() => (playing = false)}
        onerror={() => (failed = true)}
        onclick={mode === 'trim' || mode === 'time' ? toggle : undefined}
      ></video>

      {#if box}
        <div
          class="crop"
          role="application"
          aria-label="Crop area"
          style="left:{box.x * 100}%;top:{box.y * 100}%;width:{box.w * 100}%;height:{box.h * 100}%"
          onpointerdown={(e) => startCrop(e, 'move')}
        >
          {#each ['nw', 'ne', 'sw', 'se'] as h (h)}
            <span class="handle {h}" role="presentation" onpointerdown={(e) => startCrop(e, h as Handle)}></span>
          {/each}
        </div>
      {/if}

      {#if mode === 'masks'}
        <div class="surface" role="application" aria-label="Draw areas to hide" onpointerdown={startDraw}>
          {#each masks as m, i (i)}
            {@const on = maskActive(m, current)}
            <div
              class="mask"
              class:selected={selected === i}
              class:off={!on}
              role="button"
              tabindex="0"
              aria-label="Hidden area {i + 1}"
              style="left:{m.x * 100}%;top:{m.y * 100}%;width:{m.w * 100}%;height:{m.h * 100}%;{on ? (look?.style === 'solid' ? `background:${look.color}` : backdrop) : ''}"
              onpointerdown={(e) => moveMask(e, i, 'move')}
            >
              {#if look?.style === 'pixelate' && on}<span class="pixels"></span>{/if}
              {#if selected === i}
                {#each ['nw', 'ne', 'sw', 'se'] as h (h)}
                  <span class="handle small {h}" role="presentation" onpointerdown={(e) => moveMask(e, i, h as Handle)}></span>
                {/each}
              {/if}
            </div>
          {/each}
          {#if drafting}
            <div class="mask draft" style="left:{drafting.x * 100}%;top:{drafting.y * 100}%;width:{drafting.w * 100}%;height:{drafting.h * 100}%"></div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="controls">
    <button class="icon-btn play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '⏸' : '▶'}</button>
    <span class="clock">{formatTime(current, 1)} / {formatTime(duration)}</span>
    <div
      class="timeline"
      bind:this={timeline}
      role="slider"
      tabindex="0"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      onpointerdown={(e) => dragTime(e, 'seek')}
    >
      {#if range}
        <div class="kept" style="left:{pct(range.start)};width:calc({pct(rangeEnd)} - {pct(range.start)})"></div>
        <span class="grip start" role="presentation" style="left:{pct(range.start)}" onpointerdown={(e) => dragTime(e, 'start')}></span>
        <span class="grip end" role="presentation" style="left:{pct(rangeEnd)}" onpointerdown={(e) => dragTime(e, 'end')}></span>
      {/if}
      {#if sel}
        <div class="kept mask-span" style="left:{pct(sel.start)};width:calc({pct(sel.end > 0 ? sel.end : duration)} - {pct(sel.start)})"></div>
      {/if}
      <span class="head" style="left:{pct(current)}"></span>
    </div>
  </div>

  {#if range}
    <div class="row">
      <button class="btn" onclick={() => setRange(current, rangeEnd)}>⇤ Start here</button>
      <span class="muted span">Keeping {formatTime(range.start, 1)} – {formatTime(rangeEnd, 1)} · <strong>{formatTime(rangeEnd - range.start, 1)}</strong></span>
      <button class="btn" onclick={() => setRange(range.start, current)}>End here ⇥</button>
    </div>
  {:else if mode === 'time'}
    <p class="muted row">Pause on the moment you want, or use ← → to step one frame. Saving the frame at <strong>{formatTime(current, 2)}</strong>.</p>
  {:else if mode === 'masks'}
    <div class="row">
      {#if sel && selected !== null}
        {@const i = selected}
        <span class="muted">Box {i + 1} shows {formatTime(sel.start, 1)} – {sel.end > 0 ? formatTime(sel.end, 1) : 'end'}</span>
        <button class="btn" onclick={() => updateMask(i, { start: round(current), end: sel.end > 0 && sel.end <= current ? 0 : sel.end })}>From here</button>
        <button class="btn" onclick={() => updateMask(i, { end: current > sel.start ? round(current) : 0 })}>Until here</button>
        <button class="btn" onclick={() => updateMask(i, { start: 0, end: 0 })}>Whole video</button>
        <button class="btn danger" onclick={() => removeMask(i)}>Remove</button>
      {:else}
        <span class="muted">{masks.length} area{masks.length === 1 ? '' : 's'} hidden for the whole video unless you set a time.</span>
        {#if masks.length}<button class="btn" onclick={() => onChange([])}>Clear all</button>{/if}
      {/if}
    </div>
  {/if}
{/if}

<style>
  .toolbar,
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 0;
    font-size: 14px;
  }
  .row .btn {
    padding: 6px 12px;
    font-size: 13.5px;
  }
  .span {
    flex: 1;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .danger {
    color: var(--danger);
  }
  .hint {
    margin: 0;
    font-size: 14px;
  }
  .chip {
    padding: 5px 12px;
    border-radius: 99px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 13.5px;
    font-weight: 550;
  }
  .chip.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .size {
    margin-left: auto;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .stage-wrap {
    display: grid;
    place-items: center;
    padding: 12px;
    border-radius: var(--radius);
    background: #0b0c10;
  }
  .stage {
    position: relative;
    touch-action: none;
    user-select: none;
    overflow: hidden;
    line-height: 0;
  }
  video {
    display: block;
    max-width: 100%;
    max-height: 60vh;
  }
  .crop {
    position: absolute;
    cursor: move;
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 55%);
    outline: 2px solid white;
  }
  .surface {
    position: absolute;
    inset: 0;
    cursor: crosshair;
  }
  .mask {
    position: absolute;
    cursor: move;
    outline: 2px solid rgb(255 255 255 / 85%);
    background: rgb(255 255 255 / 8%);
  }
  .mask.off {
    outline-style: dashed;
    outline-color: rgb(255 255 255 / 45%);
    background: none;
  }
  .mask.selected {
    outline-color: var(--accent);
  }
  .mask.draft {
    outline-style: dashed;
  }
  .pixels {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to right, rgb(0 0 0 / 18%) 1px, transparent 1px) 0 0 / 12px 12px,
      linear-gradient(to bottom, rgb(0 0 0 / 18%) 1px, transparent 1px) 0 0 / 12px 12px;
  }
  .handle {
    position: absolute;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
  }
  .handle.small {
    width: 12px;
    height: 12px;
  }
  .nw { left: -8px; top: -8px; cursor: nwse-resize; }
  .ne { right: -8px; top: -8px; cursor: nesw-resize; }
  .sw { left: -8px; bottom: -8px; cursor: nesw-resize; }
  .se { right: -8px; bottom: -8px; cursor: nwse-resize; }
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .play {
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 15px;
  }
  .clock {
    flex: none;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .timeline {
    position: relative;
    flex: 1;
    height: 34px;
    border-radius: 8px;
    background: var(--surface-2);
    cursor: pointer;
    touch-action: none;
  }
  .kept {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border: 2px solid var(--accent);
    border-radius: 8px;
  }
  .kept.mask-span {
    top: 22px;
    bottom: 4px;
    border-width: 0;
    background: var(--accent);
    opacity: 0.6;
  }
  .grip {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 14px;
    margin-left: -7px;
    border-radius: 5px;
    background: var(--accent);
    cursor: ew-resize;
    touch-action: none;
  }
  .grip::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 30%;
    bottom: 30%;
    width: 2px;
    background: var(--on-accent);
  }
  .head {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    pointer-events: none;
  }
  .warn {
    margin: 0;
    color: var(--warning);
  }
  @media (max-width: 560px) {
    .clock {
      display: none;
    }
    .span {
      flex-basis: 100%;
      order: -1;
    }
  }
</style>
