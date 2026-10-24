/**
 * A2B in the native apps: the page the app serves to browsers on the same
 * network (src-tauri/src/local/web.rs). Kept here so it stays on, with its
 * offered files, while you move around the app.
 */
import * as local from '../../core/local';

export interface OfferedFile {
  /** Set once the file is copied in and browsers can download it. */
  id: string;
  name: string;
  size: number;
  done: number;
  error: string;
}

export const webShare = $state<{ on: boolean; starting: boolean; error: string; urls: string[]; offered: OfferedFile[] }>({
  on: false,
  starting: false,
  error: '',
  urls: [],
  offered: [],
});

export async function startWebShare() {
  webShare.starting = true;
  webShare.error = '';
  try {
    const started = await local.webStart();
    webShare.urls = started.urls;
    webShare.on = true;
  } catch (e) {
    webShare.error = String(e);
  } finally {
    webShare.starting = false;
  }
}

export async function stopWebShare() {
  await local.webStop().catch(() => {});
  webShare.on = false;
  webShare.urls = [];
  webShare.offered = [];
}

/** Offer files to the browsers, one after another. */
export async function offerFiles(files: File[]) {
  const entries = files.map((f) => {
    webShare.offered.push({ id: '', name: f.name, size: f.size, done: 0, error: '' });
    return webShare.offered.at(-1)!;
  });
  for (const [i, file] of files.entries()) {
    const entry = entries[i];
    try {
      entry.id = await local.webOffer(file, (done) => (entry.done = done));
      entry.done = file.size;
    } catch (e) {
      entry.error = String(e);
    }
  }
}

export async function unoffer(entry: OfferedFile) {
  if (entry.id) await local.webUnoffer(entry.id).catch(() => {});
  webShare.offered = webShare.offered.filter((o) => o !== entry);
}
