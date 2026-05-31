// ── 警察考題庫 Pro — Service Worker ──────────────────────────
const CACHE_NAME = 'police-exam-v1';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/db.js',
  './js/app.js',
  './js/parser.js',
  './js/quiz.js',
  './js/law.js',
  './js/ui.js',
  './js/bulk.js',
  './js/stats.js',
  './js/backup.js',
  './js/home.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // IndexedDB 與 API 請求不攔截
  if (!e.request.url.startsWith('http')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // 只快取同源靜態資源
        if (res.ok && (e.request.url.startsWith(self.location.origin) ||
            e.request.url.includes('cdnjs.cloudflare.com'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
