/* POLYGON GP service worker.
   Purpose: satisfy the PWA install criteria and keep the game launchable
   offline once it has been opened once. Strategy: network-first for the
   HTML/JS (so a new deploy is picked up on the next launch), cache-first
   for circuit data, icons and driver images (they change rarely and are
   the bulk of the bytes). */
const VERSION = 'pgp-20260909.37';
const SHELL = ['./', './index.html', './manifest.webmanifest'];
const VOICE_MANIFEST = './audio/voicepack/manifest.json';

async function cacheVoicePack(cache) {
  try {
    const res = await fetch(VOICE_MANIFEST, { cache: 'no-store' });
    if (!res.ok) return;
    await cache.put(VOICE_MANIFEST, res.clone());
    const data = await res.json();
    const files = (data.clips || []).map(c => c && c.file ? `./audio/voicepack/${c.file}` : null).filter(Boolean);
    for (const batch of files.reduce((a, f, i) => { if (i % 12 === 0) a.push([]); a[a.length - 1].push(f); return a; }, [])) {
      await Promise.all(batch.map(f => fetch(f).then(r => r.ok && cache.put(f, r)).catch(() => null)));
    }
  } catch {}
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => { await c.addAll(SHELL); await cacheVoicePack(c); }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // never touch OpenF1 / CDN calls
  const isStatic = /\/(data|assets|audio\/voicepack)\//.test(url.pathname) || /\.(png|jpg|webp|json|mp3|wav|ogg|woff2?)$/.test(url.pathname);
  if (isStatic) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  } else {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
  }
});
