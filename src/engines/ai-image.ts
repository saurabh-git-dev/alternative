/**
 * AI image tools: background removal and upscaling, on top of `onnx.ts`.
 *
 * Background removal: BRIA RMBG-1.4 (8-bit quantised, 44 MB). It predicts a
 *   soft 0–1 matte at 1024 × 1024, which is resized to the image and used as
 *   the alpha channel, so hair and soft edges stay soft. Chosen over IS-Net
 *   (used by imgly) after a side-by-side test: it keeps whole subjects where
 *   IS-Net left parts half-transparent. Licence: free for non-commercial use.
 * Upscaling: Real-ESRGAN "realesr-general-x4v3" blended 50/50 with its
 *   denoising variant (BSD-3-Clause, 5 MB), the general-photo model behind
 *   Real-ESRGAN's own demo. It always enlarges 4×; 2× and 3× are made by
 *   shrinking the 4× result with Lanczos, which looks better than running a
 *   smaller model. Images are processed in overlapping tiles so memory stays
 *   flat and progress is smooth.
 */
import { infer, loadModel, type ModelSpec, type ProgressFn } from './onnx';
import { resize } from './image';
import { pixelBudget } from '../core/device';

export const RMBG_MODEL: ModelSpec = {
  id: 'rmbg-1.4-quantized',
  files: [1, 2, 3, 4, 5].map((i) => `rmbg-1.4/briaai-${i}.onnx`),
  size: 44403226,
};

export const UPSCALE_MODEL: ModelSpec = {
  id: 'realesr-general-x4v3-wdn0.5',
  files: ['realesr-general-x4.onnx'],
  size: 4867271,
};

// ---------------------------------------------------------------------------
// Background removal
// ---------------------------------------------------------------------------

const MATTE_SIZE = 1024;

/** Soft foreground matte (0–255 per pixel) at the image's own size. */
export async function foregroundMatte(image: ImageData, onProgress?: ProgressFn): Promise<Uint8ClampedArray> {
  const session = await loadModel(RMBG_MODEL, (f, m) => onProgress?.(f * 0.6, m));
  onProgress?.(0.65, 'Finding the subject');
  const small = await resize(image, MATTE_SIZE, MATTE_SIZE, 'triangle');
  const n = MATTE_SIZE * MATTE_SIZE;
  const input = new Float32Array(3 * n);
  // RMBG-1.4 expects RGB in [-0.5, 0.5].
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = small.data[i * 4 + c] / 255 - 0.5;
  const { data } = await infer(session, input, [1, 3, MATTE_SIZE, MATTE_SIZE]);
  onProgress?.(0.9, 'Cutting out');

  // Stretch to the full 0–1 range, as BRIA's reference code does.
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const matte = new ImageData(MATTE_SIZE, MATTE_SIZE);
  for (let i = 0; i < n; i++) {
    const v = ((data[i] - min) / range) * 255;
    matte.data[i * 4] = matte.data[i * 4 + 1] = matte.data[i * 4 + 2] = v;
    matte.data[i * 4 + 3] = 255;
  }
  const full = image.width === MATTE_SIZE && image.height === MATTE_SIZE ? matte : await resize(matte, image.width, image.height, 'triangle');
  const alpha = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = full.data[i * 4];
  return alpha;
}

export interface CutoutOptions {
  /** Hex fill colour; omit for a transparent background. */
  background?: string;
  /** 0–100: higher removes more of the faint fringe around the subject. */
  edgeCleanup: number;
  /** Trim the output to the subject's bounding box plus this margin (px). Omit to keep the full canvas. */
  cropMargin?: number;
}

/** Apply a matte: transparent (or coloured) background, optional crop to subject. */
export function applyMatte(image: ImageData, matte: Uint8ClampedArray, options: CutoutOptions): ImageData {
  const { width, height } = image;
  // Edge cleanup: ramp the matte so values below `lo` vanish and above `hi` are solid.
  const lo = (options.edgeCleanup / 100) * 0.4 * 255;
  const hi = 255 - (options.edgeCleanup / 100) * 0.2 * 255;
  const fill = options.background ? [1, 3, 5].map((i) => parseInt(options.background!.slice(i, i + 2), 16)) : null;
  const out = new ImageData(width, height);
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let i = 0; i < matte.length; i++) {
    const a = Math.min(1, Math.max(0, (matte[i] - lo) / (hi - lo))) * (image.data[i * 4 + 3] / 255);
    if (a > 0.05) {
      const x = i % width;
      const y = (i / width) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    for (let c = 0; c < 3; c++) {
      const v = image.data[i * 4 + c];
      out.data[i * 4 + c] = fill ? v * a + fill[c] * (1 - a) : v;
    }
    out.data[i * 4 + 3] = fill ? 255 : a * 255;
  }
  if (options.cropMargin === undefined || x1 < 0) return out;
  const m = options.cropMargin;
  [x0, y0, x1, y1] = [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(width - 1, x1 + m), Math.min(height - 1, y1 + m)];
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cropped = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) cropped.data.set(out.data.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + cw) * 4), y * cw * 4);
  return cropped;
}

// ---------------------------------------------------------------------------
// Upscaling
// ---------------------------------------------------------------------------

const MODEL_SCALE = 4;
/** Input tile size and the overlap discarded at each inner edge. */
const TILE = 192;
const PAD = 12;

/** Largest result, in pixels, before memory gets risky in a desktop browser tab (phones get less, see device.ts). */
export const MAX_UPSCALED_PIXELS = 80_000_000;

/** Enlarge with Real-ESRGAN, then shrink to the requested scale if below 4×. */
export async function upscale(image: ImageData, scale: number, onProgress?: ProgressFn): Promise<ImageData> {
  const { width: w, height: h } = image;
  const budget = pixelBudget(MAX_UPSCALED_PIXELS);
  if (w * h * MODEL_SCALE * MODEL_SCALE > budget) {
    const maxSide = Math.floor(Math.sqrt(budget / 16));
    const where = budget < MAX_UPSCALED_PIXELS ? 'on this device' : 'in the browser';
    throw new Error(`This image is too large to upscale ${where}. Resize it to about ${maxSide} × ${maxSide} pixels or less first.`);
  }
  const session = await loadModel(UPSCALE_MODEL, (f, m) => onProgress?.(f * 0.1, m));
  const W = w * MODEL_SCALE;
  const H = h * MODEL_SCALE;
  const out = new ImageData(W, H);
  const cols = Math.ceil(w / TILE);
  const rows = Math.ceil(h / TILE);
  const opaque = !hasAlpha(image);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      onProgress?.(0.1 + (0.8 * (row * cols + col)) / (cols * rows), `Enhancing, tile ${row * cols + col + 1} of ${cols * rows}`);
      // Tile with padding, clamped to the image.
      const tx = col * TILE;
      const ty = row * TILE;
      const tw = Math.min(TILE, w - tx);
      const th = Math.min(TILE, h - ty);
      const px0 = Math.max(0, tx - PAD);
      const py0 = Math.max(0, ty - PAD);
      const px1 = Math.min(w, tx + tw + PAD);
      const py1 = Math.min(h, ty + th + PAD);
      const pw = px1 - px0;
      const ph = py1 - py0;
      const n = pw * ph;
      const input = new Float32Array(3 * n);
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const s = ((py0 + y) * w + px0 + x) * 4;
          const d = y * pw + x;
          input[d] = image.data[s] / 255;
          input[n + d] = image.data[s + 1] / 255;
          input[2 * n + d] = image.data[s + 2] / 255;
        }
      }
      const { data } = await infer(session, input, [1, 3, ph, pw]);
      // Copy the tile's own area (without padding) into the result.
      const N = n * 16;
      const OW = pw * MODEL_SCALE;
      const ox = (tx - px0) * MODEL_SCALE;
      const oy = (ty - py0) * MODEL_SCALE;
      for (let y = 0; y < th * MODEL_SCALE; y++) {
        for (let x = 0; x < tw * MODEL_SCALE; x++) {
          const s = (oy + y) * OW + ox + x;
          const d = ((ty * MODEL_SCALE + y) * W + tx * MODEL_SCALE + x) * 4;
          out.data[d] = data[s] * 255;
          out.data[d + 1] = data[N + s] * 255;
          out.data[d + 2] = data[2 * N + s] * 255;
          out.data[d + 3] = 255;
        }
      }
    }
  }

  if (!opaque) {
    // The model only sees colour; enlarge transparency with Lanczos.
    onProgress?.(0.9, 'Enlarging transparency');
    const alpha = await resize(image, W, H, 'lanczos3');
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = alpha.data[i];
  }
  if (scale === MODEL_SCALE) return out;
  onProgress?.(0.95, `Scaling to ${scale}×`);
  return resize(out, Math.round(w * scale), Math.round(h * scale), 'lanczos3');
}

function hasAlpha(image: ImageData): boolean {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) return true;
  return false;
}
