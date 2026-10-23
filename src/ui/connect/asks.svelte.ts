/**
 * Questions for the person about incoming files: "Accept 3 files (2.4 GB)
 * from Blue Otter?". Asked for any batch over 1 GB, on every kind of
 * connection, and for files from a Local share device that isn't paired
 * (LocalSend, or a copy of this app not paired yet). One shows at a time
 * (connect/AskDialog.svelte); the rest wait their turn.
 */
import { HUGE_BYTES } from '../../core/direct';

export interface Ask {
  id: string;
  from: string;
  files: { name: string; size: number; type: string }[];
  total: number;
  huge: boolean;
  /** Not paired, so it may be someone unexpected. */
  stranger: boolean;
  /** The device's key in the hub, if it has one. */
  device?: string;
  resolve: (accept: boolean) => void;
}

export const asks = $state<{ list: Ask[] }>({ list: [] });

/** Ask whether to accept these files; resolves with the answer. */
export function askToAccept(options: { from: string; files: Ask['files']; device?: string; stranger?: boolean; id?: string }): Promise<boolean> {
  const total = options.files.reduce((n, f) => n + f.size, 0);
  return new Promise((resolve) => {
    const id = options.id ?? crypto.randomUUID();
    asks.list.push({ id, from: options.from, files: options.files, total, huge: total > HUGE_BYTES, stranger: !!options.stranger, device: options.device, resolve });
  });
}

export function answer(id: string, accept: boolean) {
  const ask = asks.list.find((a) => a.id === id);
  if (!ask) return;
  asks.list = asks.list.filter((a) => a.id !== id);
  ask.resolve(accept);
}

/** The question went away by itself (the sender gave up, or it timed out). */
export function withdraw(id: string) {
  asks.list = asks.list.filter((a) => a.id !== id);
}
