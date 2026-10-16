/**
 * Image engine: decode, resize, transform and encode raster images.
 *
 * Sources:
 *   - Decoding: the browser's own decoders via createImageBitmap (JPEG, PNG,
 *     WebP, AVIF, GIF, BMP, and HEIC on Safari). EXIF orientation is applied.
 *   - Encoding: Squoosh codecs from jSquash (Apache-2.0): MozJPEG, libwebp,
 *     libavif, and OxiPNG for lossless PNG optimisation.
 *   - Resizing: jSquash resize (Rust, Lanczos3 by default, linear-light).
 * Why: browser canvas encoders are fast but produce noticeably larger files at
 * the same visual quality; the Squoosh codecs are the best open-source encoders.
 *
 * Every codec is imported lazily, so converting to WebP never downloads AVIF.
 */

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

export const OUTPUT_FORMATS: OutputFormat[] = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export interface EncodeOptions {
  /** 0–100 for lossy formats. Ignored for PNG. */
  quality: number;
  /** PNG optimisation effort 1–6 (OxiPNG level). */
  pngLevel?: number;
  /** Fill colour for transparent pixels when encoding to JPEG. */
  background?: string;
  /** Progressive JPEG (loads blurry-to-sharp, usually slightly smaller). */
  progressive?: boolean;
}

/** Decode any browser-supported image to RGBA pixels, honouring EXIF orientation. */
export async function decode(bytes: Uint8Array, type: string): Promise<ImageData> {
  const blob = new Blob([bytes as BlobPart], { type });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  } catch {
    throw new Error("This image format can't be opened in this browser.");
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** True if any pixel is not fully opaque. */
export function hasTransparency(image: ImageData): boolean {
  const d = image.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
  return false;
}

/** Composite transparent pixels over a solid colour (JPEG has no alpha channel). */
export function flatten(image: ImageData, color = '#ffffff'): ImageData {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = d[i] * a + r * (1 - a);
    d[i + 1] = d[i + 1] * a + g * (1 - a);
    d[i + 2] = d[i + 2] * a + b * (1 - a);
    d[i + 3] = 255;
  }
  return out;
}

export async function encode(image: ImageData, format: OutputFormat, options: EncodeOptions): Promise<Uint8Array> {
  switch (format) {
    case 'image/jpeg': {
      const { encode } = await import('@jsquash/jpeg');
      const flat = hasTransparency(image) ? flatten(image, options.background) : image;
      return new Uint8Array(await encode(flat, { quality: options.quality, progressive: options.progressive ?? true }));
    }
    case 'image/webp': {
      const { encode } = await import('@jsquash/webp');
      return new Uint8Array(await encode(image, { quality: options.quality }));
    }
    case 'image/avif': {
      const { encode } = await import('@jsquash/avif');
      // speed 6 is Squoosh's default: good compression without minute-long encodes.
      return new Uint8Array(await encode(image, { quality: options.quality, speed: 6 }));
    }
    case 'image/png': {
      const { optimise } = await import('@jsquash/oxipng');
      return new Uint8Array(await optimise(image, { level: options.pngLevel ?? 2, optimiseAlpha: true }));
    }
  }
}

/** Losslessly re-optimise an existing PNG file (no decode/re-encode of pixels). */
export async function optimisePng(bytes: Uint8Array, level: number): Promise<Uint8Array> {
  const { optimise } = await import('@jsquash/oxipng');
  return new Uint8Array(await optimise(bytes.slice().buffer, { level, optimiseAlpha: true }));
}

export type ResizeMethod = 'lanczos3' | 'mitchell' | 'catrom' | 'triangle' | 'magicKernelSharp2021';

export async function resize(image: ImageData, width: number, height: number, method: ResizeMethod = 'lanczos3'): Promise<ImageData> {
  if (width === image.width && height === image.height) return image;
  const { default: resizeImage } = await import('@jsquash/resize');
  return resizeImage(image, { width, height, method, fitMethod: 'stretch', premultiply: true, linearRGB: true });
}

/** Rotate by a multiple of 90° clockwise and/or mirror. Exact pixel operations, no resampling. */
export function transform(image: ImageData, rotate: 0 | 90 | 180 | 270, flipH = false, flipV = false): ImageData {
  const { width: w, height: h, data: src } = image;
  const swap = rotate === 90 || rotate === 270;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new ImageData(ow, oh);
  const dst = new Uint32Array(out.data.buffer);
  const s = new Uint32Array(src.buffer, src.byteOffset, src.length / 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = flipH ? w - 1 - x : x;
      const fy = flipV ? h - 1 - y : y;
      let nx: number, ny: number;
      switch (rotate) {
        case 90: nx = h - 1 - fy; ny = fx; break;
        case 180: nx = w - 1 - fx; ny = h - 1 - fy; break;
        case 270: nx = fy; ny = w - 1 - fx; break;
        default: nx = fx; ny = fy;
      }
      dst[ny * ow + nx] = s[y * w + x];
    }
  }
  return out;
}

/** Normalise any MIME type to one we can encode, defaulting to JPEG for photos. */
export function encodableFormat(type: string): OutputFormat {
  return (OUTPUT_FORMATS as string[]).includes(type) ? (type as OutputFormat) : 'image/png';
}
