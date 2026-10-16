/*
 * Starts BentoPDF's LibreOffice worker with its two big files served gzipped.
 *
 * LibreOffice asks for .../unpacked/soffice.wasm and .../unpacked/soffice.data.
 * Those URLs don't exist: this wrapper answers them by unpacking the .gz files
 * next to it, taking them from Cache Storage when src/engines/libreoffice.ts
 * has already downloaded them. (Handing LibreOffice blob: URLs instead makes
 * it hang while opening documents.)
 */
const CACHE = 'formatter-libreoffice-v1';
const TYPES = { 'soffice.wasm': 'application/wasm', 'soffice.data': 'application/octet-stream' };
const realFetch = self.fetch.bind(self);

self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const match = url.match(/\/unpacked\/(soffice\.(wasm|data))$/);
  if (!match) return realFetch(input, init);
  const packedUrl = url.replace(/unpacked\/soffice\.(wasm|data)$/, `soffice.$1.gz`);
  const cache = await caches.open(CACHE).catch(() => undefined);
  const packed = (await cache?.match(packedUrl)) ?? (await realFetch(packedUrl));
  const blob = await packed.blob();
  const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  // A host may have unpacked it already (Content-Encoding: gzip).
  const body = magic[0] === 0x1f && magic[1] === 0x8b ? blob.stream().pipeThrough(new DecompressionStream('gzip')) : blob.stream();
  return new Response(body, { headers: { 'Content-Type': TYPES[match[1]] } });
};

/*
 * LibreOffice starts extra threads (Web Workers) while it opens a document,
 * blocking until they run. When the page is isolated by coi-serviceworker,
 * starting a worker from a URL needs the service worker to answer, and that
 * stalls while this thread is blocked. So the threads are started from a
 * blob: copy of soffice.js (no network fetch), and more are started up front.
 */
const realImportScripts = self.importScripts.bind(self);
self.importScripts = (...urls) => {
  const url = urls[0];
  if (urls.length !== 1 || !/\/soffice\.js$/.test(url)) return realImportScripts(...urls);
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.send();
  const source = xhr.responseText.replace('var pthreadPoolSize=4;', 'var pthreadPoolSize=8;');
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  self.Module.mainScriptUrlOrBlob = blobUrl;
  return realImportScripts(blobUrl);
};

importScripts('browser.worker.global.js');
