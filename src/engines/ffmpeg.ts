/**
 * ffmpeg.wasm: the compatibility path for video tools.
 *
 * Used only when WebCodecs can't do a job (see engines/video.ts): formats
 * such as AVI, WMV, FLV or MPEG, codecs the browser can't decode, and
 * browsers without WebCodecs. It's the single-threaded @ffmpeg/core build
 * (32 MB, downloaded once and cached by the browser), loaded straight into
 * the job worker so Cancel stops it instantly.
 *
 * The command line for a job comes from `ffmpegArgs` in core/video.ts.
 */
import type { FileData, OutputFile } from '../core/types';
import { baseName, extensionOf } from '../core/files';
import { VIDEO_TYPES, ffmpegArgs, type SourceInfo, type TimeRange, type VideoJob } from '../core/video';
import type { AudioFormat, Progress } from './video';

interface Core {
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
  exec(...args: string[]): number;
  ret: number;
  reset(): void;
  setLogger(fn: (log: { type: string; message: string }) => void): void;
  setProgress(fn: (p: { progress: number; time: number }) => void): void;
}

let core: Promise<Core> | undefined;
let log: string[] = [];
let onProgress: ((p: { progress: number; time: number }) => void) | undefined;

function load(): Promise<Core> {
  core ??= (async () => {
    const [{ default: createCore }, { default: wasmURL }] = await Promise.all([import('@ffmpeg/core'), import('@ffmpeg/core/wasm?url')]);
    // The core finds its .wasm through a JSON blob after the "#" of this URL.
    const wasm = new URL(wasmURL, self.location.href).href;
    const instance = (await createCore({ mainScriptUrlOrBlob: `ffmpeg-core.js#${btoa(JSON.stringify({ wasmURL: wasm }))}` })) as Core;
    instance.setLogger(({ message }) => {
      log.push(message);
      if (log.length > 60) log.shift();
    });
    instance.setProgress((p) => onProgress?.(p));
    return instance;
  })();
  return core;
}

/** Run ffmpeg with `args`, reading `input` and returning the file it writes to `output`. */
async function run(file: FileData, inputName: string, args: string[], outputName: string, progress: Progress, duration?: number): Promise<Uint8Array> {
  const ffmpeg = await load();
  log = [];
  ffmpeg.FS.writeFile(inputName, file.bytes);
  onProgress = ({ progress: p, time }) => {
    // `time` is in microseconds of output; `progress` is only right when the whole file is converted.
    const fraction = duration ? time / 1e6 / duration : p;
    progress(Math.min(0.99, Math.max(0, fraction)), 'Converting');
  };
  progress(0, 'Converting');
  try {
    ffmpeg.exec(...args);
    const code = ffmpeg.ret;
    ffmpeg.reset();
    if (code !== 0) {
      // A failed run can leave the WebAssembly memory in a bad state; start fresh next time (the .wasm is cached).
      core = undefined;
      throw new Error(friendlyError(log));
    }
    return ffmpeg.FS.readFile(outputName);
  } catch (e) {
    core = undefined;
    throw e;
  } finally {
    for (const name of [inputName, outputName]) {
      try {
        ffmpeg.FS.unlink(name);
      } catch {
        /* not created */
      }
    }
  }
}

function friendlyError(lines: string[]): string {
  const text = lines.join('\n');
  if (/Invalid data found|could not find codec|Unknown format/i.test(text)) return "This file couldn't be read as a video. It may be damaged or in a format that isn't supported.";
  if (/out of memory|Cannot allocate/i.test(text)) return 'This video is too large for the memory available in this tab. Try a shorter clip or a computer.';
  return `The video couldn't be converted. ${lines.filter((l) => /error/i.test(l)).slice(-1)[0] ?? ''}`.trim();
}

function inputName(file: FileData): string {
  return `input.${extensionOf(file.name) || 'bin'}`;
}

/** Size, length and audio presence, read from ffmpeg's description of the file. */
export async function probe(file: FileData): Promise<SourceInfo> {
  const ffmpeg = await load();
  log = [];
  const name = inputName(file);
  ffmpeg.FS.writeFile(name, file.bytes);
  try {
    ffmpeg.exec('-hide_banner', '-i', name);
    ffmpeg.reset();
  } finally {
    ffmpeg.FS.unlink(name);
  }
  return parseProbe(log.join('\n'));
}

/** Read width, height, duration, frame rate and audio from `ffmpeg -i` output. */
export function parseProbe(text: string): SourceInfo {
  const video = /Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(text);
  if (!video) throw new Error("This file doesn't contain a video track.");
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  const fps = /([\d.]+) fps/.exec(text);
  let width = Number(video[1]);
  let height = Number(video[2]);
  // Phone videos store rotation separately; ffmpeg applies it when reading.
  const rotation = /rotation of (-?[\d.]+) degrees|rotate\s*:\s*(-?\d+)/.exec(text);
  const angle = Math.abs(Number(rotation?.[1] ?? rotation?.[2] ?? 0)) % 180;
  if (angle === 90) [width, height] = [height, width];
  return {
    width,
    height,
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    hasAudio: /Stream #.*Audio:/.test(text),
    fps: fps ? Number(fps[1]) : undefined,
  };
}

export async function transcode(file: FileData, job: VideoJob, progress: Progress): Promise<OutputFile> {
  const info = await probe(file);
  const output = `output.${job.container}`;
  const span = job.trim ? (job.trim.end > 0 ? job.trim.end : info.duration) - job.trim.start : info.duration;
  const bytes = await run(file, inputName(file), ffmpegArgs(job, info, inputName(file), output), output, progress, span);
  return { name: `${baseName(file.name)}.${job.container}`, type: VIDEO_TYPES[job.container], bytes };
}

export async function toGif(file: FileData, range: TimeRange, fps: number, width: number, loop: boolean, maxSeconds: number, progress: Progress): Promise<OutputFile> {
  const info = await probe(file);
  const end = Math.min(range.end > 0 ? range.end : info.duration, range.start + maxSeconds);
  const w = Math.min(width || info.width, info.width, 800);
  const args = [
    '-ss', String(range.start), '-to', String(end), '-i', inputName(file),
    '-filter_complex', `fps=${fps},scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', loop ? '0' : '-1', 'output.gif',
  ];
  const bytes = await run(file, inputName(file), args, 'output.gif', progress, end - range.start);
  return { name: `${baseName(file.name)}.gif`, type: 'image/gif', bytes };
}

const AUDIO_ARGS: Record<AudioFormat, string[]> = {
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  m4a: ['-c:a', 'aac', '-b:a', '160k'],
  wav: ['-c:a', 'pcm_s16le'],
  ogg: ['-c:a', 'libopus', '-b:a', '128k'],
};

export async function extractAudio(file: FileData, format: AudioFormat, type: string, progress: Progress): Promise<OutputFile> {
  const info = await probe(file);
  if (!info.hasAudio) throw new Error('This video has no sound to extract.');
  const output = `output.${format}`;
  const bytes = await run(file, inputName(file), ['-i', inputName(file), '-vn', ...AUDIO_ARGS[format], output], output, progress, info.duration);
  return { name: `${baseName(file.name)}.${format}`, type, bytes };
}

export async function grabFrame(file: FileData, time: number, type: 'image/png' | 'image/jpeg', progress: Progress): Promise<OutputFile> {
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const output = `frame.${ext}`;
  const bytes = await run(file, inputName(file), ['-ss', String(time), '-i', inputName(file), '-frames:v', '1', '-q:v', '2', output], output, progress);
  const stamp = time.toFixed(1).replace('.', '_');
  return { name: `${baseName(file.name)}-${stamp}s.${ext}`, type, bytes };
}
