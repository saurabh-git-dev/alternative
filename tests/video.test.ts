import { describe, expect, it } from 'vitest';
import {
  bitrateForSize,
  blurRadius,
  containerFor,
  cropPixels,
  ffmpegArgs,
  fitSize,
  formatTime,
  maskActive,
  needsReencode,
  outputSize,
  rotateBox,
  type SourceInfo,
} from '../src/core/video';
import { parseProbe } from '../src/engines/ffmpeg';
import { VIDEO_ACTIONS, VIDEO_CATEGORIES, ACTIONS, getAction } from '../src/actions';
import { initialValues, validate } from '../src/core/params';
import { sectionHref, sectionOf } from '../src/ui/section';

const hd: SourceInfo = { width: 1920, height: 1080, duration: 10, hasAudio: true, fps: 30 };

describe('video geometry', () => {
  it('shrinks to the shorter side, never enlarges, keeps even sizes', () => {
    expect(fitSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(fitSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(fitSize(640, 360, 720)).toEqual({ width: 640, height: 360 });
    expect(fitSize(1001, 563)).toEqual({ width: 1002, height: 564 });
  });
  it('turns crop fractions into even pixel boxes inside the frame', () => {
    expect(cropPixels({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1920, 1080)).toEqual({ left: 480, top: 270, width: 960, height: 540 });
    const edge = cropPixels({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }, 100, 100);
    expect(edge.left + edge.width).toBeLessThanOrEqual(100);
    expect(edge.top + edge.height).toBeLessThanOrEqual(100);
  });
  it('rotates a crop box with the frame', () => {
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(rotateBox(box, 0)).toEqual(box);
    expect(rotateBox(box, 90)).toEqual({ x: 1 - 0.2 - 0.4, y: 0.1, w: 0.4, h: 0.3 });
    expect(rotateBox(rotateBox(box, 90), 270)).toEqual(expect.objectContaining({ w: 0.3, h: 0.4 }));
    const half = rotateBox(box, 180);
    expect(half.x).toBeCloseTo(0.6);
    expect(half.y).toBeCloseTo(0.4);
  });
  it('computes the output size of crop + rotate + resize', () => {
    expect(outputSize({ container: 'mp4', audio: 'keep', crop: { x: 0, y: 0, w: 0.5, h: 1 }, rotate: 90 }, 1920, 1080)).toEqual({ width: 1080, height: 960 });
    expect(outputSize({ container: 'mp4', audio: 'keep', maxSide: 480 }, 1920, 1080)).toEqual({ width: 854, height: 480 });
  });
});

describe('video jobs', () => {
  it('knows when the video can be copied', () => {
    expect(needsReencode({ container: 'mp4', audio: 'remove', copy: true })).toBe(false);
    expect(needsReencode({ container: 'mp4', audio: 'keep', copy: true, trim: { start: 1, end: 2 }, rotate: 90 })).toBe(false);
    expect(needsReencode({ container: 'mp4', audio: 'keep', copy: true, flipH: true })).toBe(true);
    expect(needsReencode({ container: 'mp4', audio: 'keep' })).toBe(true);
  });
  it('shows masks only in their time span', () => {
    const m = { x: 0, y: 0, w: 1, h: 1, start: 2, end: 4 };
    expect([1, 2, 3.9, 4].map((t) => maskActive(m, t))).toEqual([false, true, true, false]);
    expect(maskActive({ ...m, end: 0 }, 100)).toBe(true);
  });
  it('picks a bitrate for a target size, or refuses an impossible one', () => {
    const rate = bitrateForSize(10 * 1024 * 1024, 60, true)!;
    expect(rate).toBeGreaterThan(1_000_000);
    expect(rate).toBeLessThan(1_400_000);
    expect(bitrateForSize(100_000, 600, true)).toBeNull();
  });
  it('keeps MP4, WebM and MOV, and turns other formats into MP4', () => {
    expect(['video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mp4'].map(containerFor)).toEqual(['webm', 'mov', 'mp4', 'mp4']);
  });
  it('keeps the box blur radius within what ffmpeg accepts', () => {
    expect(blurRadius(192, 108, 60)).toBeLessThanOrEqual(108 / 4 - 1);
    expect(blurRadius(8, 8, 100)).toBe(1);
  });
});

describe('ffmpeg command lines', () => {
  it('copies for a fast trim', () => {
    const args = ffmpegArgs({ container: 'mp4', audio: 'keep', copy: true, trim: { start: 1.5, end: 3 } }, hd, 'in.mov', 'out.mp4');
    expect(args.slice(0, 6)).toEqual(['-ss', '1.5', '-to', '3', '-i', 'in.mov']);
    expect(args).toContain('copy');
    expect(args.at(-1)).toBe('out.mp4');
  });
  it('re-encodes crop, rotation and resize with x264', () => {
    const args = ffmpegArgs({ container: 'mp4', audio: 'keep', crop: { x: 0, y: 0, w: 0.5, h: 1 }, rotate: 90, maxSide: 480, quality: 'medium' }, hd, 'in.mp4', 'out.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toBe('[0:v]crop=960:1080:0:0,transpose=1,scale=540:480,format=yuv420p[vout]');
    expect(args).toEqual(expect.arrayContaining(['libx264', '-crf', '27', 'aac']));
  });
  it('hides areas with timed overlays', () => {
    const masks = { boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, start: 1, end: 2 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, start: 0, end: 0 }], style: 'blur' as const, strength: 50, color: '#000000' };
    const graph = ffmpegArgs({ container: 'webm', audio: 'remove', masks }, hd, 'a', 'b.webm').join(' ');
    expect(graph).toContain('split=3[base][m0][m1]');
    expect(graph).toContain("enable='between(t,1,2)'");
    expect(graph).toContain("enable='gte(t,0)'");
    expect(graph).toContain('libvpx');
    expect(graph).toContain('-an');
    const solid = ffmpegArgs({ container: 'mp4', audio: 'keep', masks: { ...masks, style: 'solid', color: '#ff0000' } }, hd, 'a', 'b.mp4').join(' ');
    expect(solid).toContain('drawbox=x=192:y=108:w=384:h=216:color=0xff0000@1:t=fill');
  });
  it('reads size, length, rotation and sound from ffmpeg -i output', () => {
    const text = `Duration: 00:01:02.50, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 4000 kb/s, 29.97 fps
    side data: displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo`;
    expect(parseProbe(text)).toEqual({ width: 1080, height: 1920, duration: 62.5, hasAudio: true, fps: 29.97 });
    expect(() => parseProbe('Stream #0:0: Audio: mp3')).toThrow();
  });
  it('formats times', () => {
    expect(formatTime(75.5)).toBe('1:15');
    expect(formatTime(75.25, 1)).toBe('1:15.3');
    expect(formatTime(3725)).toBe('1:02:05');
  });
});

describe('video tools', () => {
  it('are registered apart from the PDF & image tools, in known categories', () => {
    const categories = new Set(VIDEO_CATEGORIES.map((c) => c.id));
    for (const a of VIDEO_ACTIONS) {
      expect(categories.has(a.category), a.id).toBe(true);
      expect(getAction(a.id)).toBe(a);
      expect(ACTIONS).not.toContain(a);
    }
  });
  it('blocks Blur or hide area until a box is drawn', () => {
    const blur = getAction('video.blur')!;
    const values = initialValues(blur);
    expect(validate(blur, values).masks).toBeTruthy();
    values.masks = [{ x: 0, y: 0, w: 0.1, h: 0.1, start: 0, end: 0 }];
    expect(validate(blur, values).masks).toBeUndefined();
  });
});

describe('sections', () => {
  it('tells sections apart by path', () => {
    expect(sectionOf('/alternative/')).toBe('home');
    expect(sectionOf('/alternative/pdf/')).toBe('pdf');
    expect(sectionOf('/image/index.html')).toBe('image');
    expect(sectionOf('/alternative/video/')).toBe('video');
    expect(sectionOf('/record/index.html')).toBe('record');
    expect(sectionOf('/alternative/it/')).toBe('it');
    // chat/ is gone: Connect has chat and calls now.
    expect(sectionOf('/alternative/chat/')).toBe('home');
  });
  it('links between sections relatively', () => {
    expect(sectionHref('video', '#/', 'home')).toBe('video/');
    expect(sectionHref('home', '#/', 'video')).toBe('../');
    expect(sectionHref('pdf', '#/tool/pdf.merge', 'image')).toBe('../pdf/#/tool/pdf.merge');
    expect(sectionHref('record', '#/', 'it')).toBe('../record/');
    expect(sectionHref('video', '#/tool/video.trim', 'record')).toBe('../video/#/tool/video.trim');
    expect(sectionHref('video', '#/x', 'video')).toBe('#/x');
  });
});
