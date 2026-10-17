/**
 * Pieces shared by the video tools: accepted types, common settings and
 * running a job with the right engine.
 *
 * Every tool describes its work as a `VideoJob` (core/video.ts) and calls
 * `runJob`, which uses WebCodecs when it can and ffmpeg.wasm when it can't.
 */
import type { EnumParam, FileData, OutputFile, RunContext } from '../../core/types';
import { baseName } from '../../core/files';
import { containerFor, type VideoContainer, type VideoJob } from '../../core/video';

/** Any video the browser recognises; WebCodecs or ffmpeg sorts out the rest. */
export const VIDEO_ACCEPTS = ['video/*'];

export const VIDEO_ENGINES = ['WebCodecs (via Mediabunny)', 'ffmpeg.wasm for other formats'];

/** Shown on phones and low-memory computers. */
export const VIDEO_DEMANDING =
  'Videos are processed in this tab’s memory, so long or 4K clips (roughly over 200 MB) may fail on a phone.';

export const formatParam: EnumParam = {
  kind: 'enum',
  label: 'Save as',
  default: 'same',
  options: [
    { value: 'same', label: 'Same', hint: 'MP4, WebM and MOV stay as they are; other formats become MP4' },
    { value: 'mp4', label: 'MP4', hint: 'Plays everywhere' },
    { value: 'webm', label: 'WebM', hint: 'Open format, good for the web' },
  ],
  display: 'segmented',
  advanced: true,
};

export const audioParam: EnumParam = {
  kind: 'enum',
  label: 'Sound',
  default: 'keep',
  options: [
    { value: 'keep', label: 'Keep' },
    { value: 'remove', label: 'Remove' },
  ],
  display: 'segmented',
};

/** The container a "Save as" value means for this input. */
export function containerOf(value: unknown, file: FileData): VideoContainer {
  return value === 'mp4' || value === 'webm' || value === 'mov' ? value : containerFor(file.type);
}

/** Run a job: WebCodecs first, ffmpeg.wasm when the file or browser needs it. */
export async function runJob(file: FileData, job: VideoJob, ctx: RunContext, suffix = ''): Promise<OutputFile> {
  const video = await import('../../engines/video');
  const out = await video.withFallback(
    () => video.transcode(file, job, ctx.progress),
    async () => (await import('../../engines/ffmpeg')).transcode(file, job, ctx.progress),
    ctx.progress,
  );
  return { ...out, name: `${baseName(file.name)}${suffix}.${job.container}` };
}

/** Size, length and sound of a video, with either engine. */
export async function probeVideo(file: FileData) {
  const video = await import('../../engines/video');
  return video.withFallback(
    () => video.probe(file),
    async () => (await import('../../engines/ffmpeg')).probe(file),
    () => {},
  );
}
