/**
 * Hands a file from one page to another (e.g. a tool's result → Share).
 * The receiving page takes it once and clears it.
 */
import type { FileData } from '../core/types';

export const handoff = $state<{ file: FileData | null }>({ file: null });

export function takeHandoff(): FileData | null {
  const file = handoff.file;
  handoff.file = null;
  return file;
}
