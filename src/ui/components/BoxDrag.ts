/**
 * Pointer helpers for drawing and moving boxes measured in fractions (0–1)
 * of a container element. Shared by the crop, redact and signature editors.
 */
import type { Box } from '../../core/types';

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/** Pointer position as fractions of `el`. */
export function relative(el: HTMLElement, e: PointerEvent): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
}

export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/**
 * Track a drag on `el` and report the updated box. `aspect` (width/height in
 * the element's pixel space) keeps resized boxes at a fixed ratio.
 */
export function dragBox(
  el: HTMLElement,
  start: PointerEvent,
  box: Box,
  handle: Handle,
  onChange: (box: Box) => void,
  aspect?: number,
): void {
  start.preventDefault();
  start.stopPropagation();
  const rect = el.getBoundingClientRect();
  const origin = relative(el, start);
  const initial = { ...box };
  // Aspect ratio expressed in fractions of this element.
  const fracAspect = aspect ? aspect * (rect.height / rect.width) : undefined;

  const move = (e: PointerEvent) => {
    const p = relative(el, e);
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    let { x, y, w, h } = initial;
    if (handle === 'move') {
      x = clamp(initial.x + dx, 0, 1 - w);
      y = clamp(initial.y + dy, 0, 1 - h);
    } else {
      const left = handle === 'nw' || handle === 'sw';
      const top = handle === 'nw' || handle === 'ne';
      let x0 = left ? initial.x + dx : initial.x;
      let x1 = left ? initial.x + initial.w : initial.x + initial.w + dx;
      let y0 = top ? initial.y + dy : initial.y;
      let y1 = top ? initial.y + initial.h : initial.y + initial.h + dy;
      x0 = clamp(x0); x1 = clamp(x1); y0 = clamp(y0); y1 = clamp(y1);
      w = Math.max(0.02, x1 - x0);
      h = Math.max(0.02, y1 - y0);
      if (fracAspect) {
        h = w / fracAspect;
        if ((top ? y1 - h : y0 + h) < 0 || (top ? y1 : y0 + h) > 1) {
          h = top ? y1 : 1 - y0;
          w = h * fracAspect;
        }
      }
      x = left ? x1 - w : x0;
      y = top ? y1 - h : y0;
    }
    onChange({ x, y, w, h });
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

/** Draw a new box by dragging from an empty spot. */
export function drawBox(el: HTMLElement, start: PointerEvent, onChange: (box: Box) => void, onDone: (box: Box) => void): void {
  start.preventDefault();
  const origin = relative(el, start);
  let last: Box = { x: origin.x, y: origin.y, w: 0, h: 0 };
  const move = (e: PointerEvent) => {
    const p = relative(el, e);
    last = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) };
    onChange(last);
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    onDone(last);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}
