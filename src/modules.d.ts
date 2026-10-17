/** Type declarations for packages that ship without them. */

declare module '@ffmpeg/core' {
  /** Emscripten factory for the ffmpeg.wasm core; see engines/ffmpeg.ts for the parts we use. */
  const createFFmpegCore: (options: { mainScriptUrlOrBlob: string }) => Promise<unknown>;
  export default createFFmpegCore;
}

declare module 'gifenc' {
  export type Palette = number[][];
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean }): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
}
