import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  appendChunk,
  deleteRecording,
  fileNameFor,
  getRecording,
  listRecordings,
  recordingBlob,
  recoverInterrupted,
  replaceData,
  saveMeta,
  updateMeta,
  type RecordingMeta,
} from '../src/core/recordings';
import { pickMimeType } from '../src/core/recorder';

const meta = (id: string, createdAt: number, status: RecordingMeta['status'] = 'ready'): RecordingMeta => ({
  id, title: `Rec ${id}`, createdAt, duration: 3, size: 0, type: 'video/webm', width: 1280, height: 720, source: 'screen', status,
});

describe('recordings library', () => {
  it('stores chunks in order and lists newest first', async () => {
    await saveMeta(meta('a', 1));
    await saveMeta(meta('b', 2));
    await appendChunk('a', 1, new Blob(['world']));
    await appendChunk('a', 0, new Blob(['hello ']));
    await appendChunk('b', 0, new Blob(['other']));
    expect(await (await recordingBlob('a')).text()).toBe('hello world');
    expect((await listRecordings()).map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('renames, replaces data and deletes', async () => {
    await updateMeta('a', { title: 'Demo' });
    expect((await getRecording('a'))?.title).toBe('Demo');
    await replaceData('a', new Blob(['fixed']));
    expect(await (await recordingBlob('a')).text()).toBe('fixed');
    await deleteRecording('a');
    expect(await getRecording('a')).toBeUndefined();
    expect((await recordingBlob('a')).size).toBe(0);
    expect(await (await recordingBlob('b')).text()).toBe('other');
  });
  it('recovers recordings a closed tab left unfinished, and drops empty ones', async () => {
    await saveMeta(meta('c', 3, 'recording'));
    await appendChunk('c', 0, new Blob(['12345']));
    await saveMeta(meta('d', 4, 'recording'));
    await saveMeta(meta('live', 5, 'recording'));
    const recovered = await recoverInterrupted('live');
    expect(recovered.map((r) => [r.id, r.status, r.recovered, r.size])).toEqual([['c', 'ready', true, 5]]);
    expect(await getRecording('d')).toBeUndefined();
    expect((await getRecording('live'))?.status).toBe('recording');
  });
  it('makes safe file names', () => {
    expect(fileNameFor({ title: 'Bug: login/fails?', type: 'video/webm' })).toBe('Bug- login-fails-.webm');
    expect(fileNameFor({ title: '  ', type: 'video/mp4' })).toBe('recording.mp4');
  });
  it('records MP4 when the browser can, else WebM', () => {
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(pickMimeType(() => true)).toMatch(/^video\/mp4/);
    expect(pickMimeType(() => false)).toBe('');
  });
});
