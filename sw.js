/* sw.js — Service Worker v2 */
const CACHE = 'kpod-v2';

const PRECACHE = [
  './',
  './index.html',
  './css/tokens.css',
  './css/base.css',
  './css/nav.css',
  './css/home.css',
  './css/import.css',
  './css/player.css',
  './css/library.css',
  './css/review.css',
  './css/settings.css',
  './css/components.css',
  './js/core/db.js',
  './js/core/store.js',
  './js/core/router.js',
  './js/core/toast.js',
  './js/core/modal.js',
  './js/core/app.js',
  './js/parsers/srt.js',
  './js/parsers/audio-utils.js',
  './js/features/spaced.js',
  './js/features/chunk.js',
  './js/features/ai.js',
  './js/ui/waveform.js',
  './js/pages/home.js',
  './js/pages/import.js',
  './js/pages/player.js',
  './js/pages/library.js',
  './js/pages/review.js',
  './js/pages/settings.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept Anthropic API
  if (url.hostname === 'api.anthropic.com') return;

  // Fonts: stale-while-revalidate
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        });
        return cached || network;
      })
    );
    return;
  }

  // App shell: cache-first, network fallback
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (r.ok && url.origin === self.location.origin) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
