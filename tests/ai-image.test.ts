import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(() => {
  // Node has no ImageData; a minimal stand-in is enough for pixel maths.
  (globalThis as Record<string, unknown>).ImageData ??= class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
});

function solid(width: number, height: number, rgb: [number, number, number]): ImageData {
  const image = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) image.data.set([...rgb, 255], i * 4);
  return image;
}

describe('applyMatte', () => {
  it('makes the background transparent and keeps colour', async () => {
    const { applyMatte } = await import('../src/engines/ai-image');
    const image = solid(4, 1, [10, 20, 30]);
    const out = applyMatte(image, new Uint8ClampedArray([0, 255, 255, 0]), { edgeCleanup: 0 });
    expect([...out.data].filter((_, i) => i % 4 === 3)).toEqual([0, 255, 255, 0]);
    expect([...out.data.slice(4, 7)]).toEqual([10, 20, 30]);
  });

  it('fills with a colour and crops to the subject', async () => {
    const { applyMatte } = await import('../src/engines/ai-image');
    const image = solid(5, 5, [0, 0, 0]);
    const matte = new Uint8ClampedArray(25);
    matte[12] = 255; // centre pixel only
    const out = applyMatte(image, matte, { edgeCleanup: 30, background: '#ff0000', cropMargin: 1 });
    expect([out.width, out.height]).toEqual([3, 3]);
    expect([...out.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...out.data.slice(16, 20)]).toEqual([0, 0, 0, 255]);
  });

  it('edge cleanup removes a faint fringe', async () => {
    const { applyMatte } = await import('../src/engines/ai-image');
    const faint = new Uint8ClampedArray([20]);
    expect(applyMatte(solid(1, 1, [9, 9, 9]), faint, { edgeCleanup: 0 }).data[3]).toBe(20);
    expect(applyMatte(solid(1, 1, [9, 9, 9]), faint, { edgeCleanup: 50 }).data[3]).toBe(0);
  });
});
