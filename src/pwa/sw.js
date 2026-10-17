/**
 * Service worker: makes the app work offline and installable.
 * vite.config.ts copies this file to sw.js at the site root and fills in
 * VERSION and PRECACHE from the build output.
 *
 * - The app shell (pages, scripts, styles, small engines; a few MB) is cached
 *   on install, so every section opens offline.
 * - Heavy engines and AI models (ffmpeg, Ghostscript, MuPDF, ONNX models, …)
 *   are cached the first time a tool loads them, so they work offline from
 *   then on without slowing the first visit.
 * - Pages are network-first so a deploy shows up on the next visit; hashed
 *   files never change, so they come from the cache.
 * A new build gets a new VERSION and drops the old caches.
 */
const VERSION = '__VERSION__';
/** @type {string[]} */
const PRECACHE = __PRECACHE__;
const CACHE = `tools-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tools-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only this site's own files; range requests (media seeking) go straight through.
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  if (!url.href.startsWith(self.registration.scope)) return;
  event.respondWith(req.mode === 'navigate' ? networkFirst(req) : cacheFirst(req));
});

/** @param {Request} req */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // Offline: the cached page, ignoring ?query (e.g. a share-target or UTM link).
    const hit = (await cache.match(req, { ignoreSearch: true })) ?? (await cache.match(new URL('./', req.url)));
    if (hit) return hit;
    throw e;
  }
}

/** @param {Request} req */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}
