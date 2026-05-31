/* ══════════════════════════════════════════════════════════════
   sw.js — Y.C. 多功能專用平台 Service Worker
   ══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'yc-platform-v1';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './css/splash.css',
  './js/db.js',
  './js/utils.js',
  './js/quiz.js',
  './js/data.js',
  './js/stats.js',
  './js/settings.js',
  './js/countdown.js',
  './js/app.js',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
];

/* ── 安裝：預快取所有資源 ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── 啟動：清除舊版快取 ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── 攔截請求：Cache First，失敗才走網路 ── */
self.addEventListener('fetch', e => {
  // 非 GET 或 chrome-extension 略過
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // 只快取成功的回應
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => {
        // 離線且無快取：若是 HTML 導向首頁
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
