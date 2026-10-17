/**
 * After a recording stops: fix the file so players can seek it, then add a
 * thumbnail and its exact length to the library entry.
 *
 * MediaRecorder's WebM has no duration or seek index; remuxing (copying the
 * packets into a fresh file, no re-encoding) adds both. MP4 recordings are
 * fragmented and play fine, so only their thumbnail is made. Any step can
 * fail without losing the recording itself.
 */
import { recordingBlob, replaceData, updateMeta, type RecordingMeta } from '../../core/recordings';
import { remuxVideo } from '../../core/runner';
import { videoPoster } from '../video-poster';

export async function finalizeRecording(meta: RecordingMeta): Promise<RecordingMeta> {
  let blob = await recordingBlob(meta.id, meta.type);
  if (meta.type === 'video/webm' && typeof VideoDecoder !== 'undefined') {
    try {
      const fixed = await remuxVideo({ name: 'recording.webm', type: meta.type, bytes: new Uint8Array(await blob.arrayBuffer()) });
      blob = new Blob([fixed.bytes as BlobPart], { type: fixed.type });
      await replaceData(meta.id, blob);
    } catch {
      /* keep the original: it still plays */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const poster = await videoPoster(url);
    const patch: Partial<RecordingMeta> = { size: blob.size };
    if (poster) {
      patch.thumb = await (await fetch(poster.thumb)).blob();
      URL.revokeObjectURL(poster.thumb);
      if (poster.duration > 0 && Number.isFinite(poster.duration)) patch.duration = poster.duration;
      patch.width = poster.width || meta.width;
      patch.height = poster.height || meta.height;
    }
    return (await updateMeta(meta.id, patch)) ?? meta;
  } finally {
    URL.revokeObjectURL(url);
  }
}
