/**
 * Hiding part of a frame: blur, pixelate or a solid box, drawn on a 2D
 * canvas. Used for every frame of "Blur or hide area" and for its preview.
 *
 * Blur is done by shrinking the area and smoothly enlarging it again rather
 * than with `ctx.filter`, which Safari doesn't support on canvases. Both
 * effects throw away detail for real: nothing underneath can be recovered.
 */
import type { MaskStyle } from '../core/video';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = { left: number; top: number; width: number; height: number };

let scratch: OffscreenCanvas | undefined;

/** `strength` is 0–100: how coarse the blur or the blocks are. */
export function drawMask(ctx: Ctx, r: Rect, style: MaskStyle, strength: number, color: string): void {
  if (r.width < 2 || r.height < 2) return;
  if (style === 'solid') {
    ctx.fillStyle = color;
    ctx.fillRect(r.left, r.top, r.width, r.height);
    return;
  }
  const short = Math.min(r.width, r.height);
  // Block size in pixels: from 4% of the area's shorter side up to 30%.
  const block = Math.max(3, short * (0.04 + (strength / 100) * 0.26));
  const w = Math.max(1, Math.round(r.width / block));
  const h = Math.max(1, Math.round(r.height / block));
  scratch ??= new OffscreenCanvas(w, h);
  scratch.width = w;
  scratch.height = h;
  const small = scratch.getContext('2d')!;
  small.imageSmoothingEnabled = true;
  small.imageSmoothingQuality = 'high';
  small.drawImage(ctx.canvas, r.left, r.top, r.width, r.height, 0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = style === 'blur';
  if (style === 'blur') ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scratch, 0, 0, w, h, r.left, r.top, r.width, r.height);
  ctx.restore();
}
