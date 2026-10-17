/**
 * Hands a file from one page to another (e.g. a tool's result → Share).
 * The receiving page takes it once and clears it.
 */
import type { FileData } from '../core/types';

export const handoff = $state<{ file: FileData | null; files: FileData[] }>({ file: null, files: [] });

export function takeHandoff(): FileData | null {
  const file = handoff.file;
  handoff.file = null;
  return file;
}

/** Several files at once (e.g. all results sent to a phone). Includes `file` if set. */
export function takeHandoffFiles(): FileData[] {
  const files = handoff.file ? [handoff.file, ...handoff.files] : handoff.files;
  handoff.file = null;
  handoff.files = [];
  return files;
}
