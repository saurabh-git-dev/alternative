/**
 * Open a saved recording as a file, e.g. to load it into a video tool
 * (`#/tool/<id>/recording/<recording id>`, see App.svelte).
 */
import { fileNameFor, getRecording, recordingBlob } from '../../core/recordings';

export async function recordingFile(id: string): Promise<File> {
  const meta = await getRecording(id);
  if (!meta) throw new Error('It may have been deleted, or was made in another browser.');
  const blob = await recordingBlob(id, meta.type);
  return new File([blob], fileNameFor(meta), { type: meta.type });
}
