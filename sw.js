/* ══════════════════════════════════════════════════════════════
   sw.js — Y.C. 多功能專用平台
   ★ 每次更新程式只需修改 APP_VERSION
   ══════════════════════════════════════════════════════════════ */

const APP_VERSION = '2.2.1';
const CACHE_NAME  = `yc-cache-${APP_VERSION}`;

// ── 核心本地資源（必須快取成功，任一失敗會重試）────────────
const CORE_ASSETS = [
  './manifest.json',
  './css/base.css',
  './css/books.css',
  './css/media.css',
  './css/quiz.css',
  './css/eink.css',
  './css/splash.css',
  './js/db.js',
  './js/books.js',
  './js/media.js',
  './js/utils.js',
  './js/quiz.js',
  './js/data.js',
  './js/stats.js',
  './js/settings.js',
  './js/countdown.js',
  './js/app.js',
];

// ── 可選資源（快取失敗不影響 SW 安裝）──────────────────────
const OPTIONAL_ASSETS = [
  './icons/splash-logo.png',
  './icons/vinyl-record.png',
  './icons/tonearm.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './splash-logo-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/dexie/4.0.8/dexie.min.js',
  './js/jszip.min.js',
  './js/epub.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
];

/* ── 安裝：核心資源快取成功後立即 skipWaiting ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 核心資源：全部成功才繼續
      const corePromise = cache.addAll(CORE_ASSETS);
      // 可選資源：逐一嘗試，失敗不影響安裝
      const optionalPromise = Promise.allSettled(
        OPTIONAL_ASSETS.map(url =>
          cache.add(url).catch(() => {/* 靜默失敗 */})
        )
      );
      return Promise.all([corePromise, optionalPromise]);
    }).then(() => self.skipWaiting())  // 安裝完直接接管
  );
});

/* ── 啟動：清舊快取，立即接管所有頁面 ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('yc-cache-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── 攔截請求 ── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (!url.startsWith('http')) return;

  // index.html → 永遠優先走網路，失敗才用快取
  if (url.endsWith('/') || url.endsWith('/index.html') || url.endsWith('.io/') || url.endsWith('.io')) {
    e.respondWith(
      fetch(e.request)
        .then(res => res)
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 其他資源：Cache First（有快取直接用，沒有才去網路並存快取）
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      }).catch(() => {
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/* ── 接收主頁面訊息（立即更新指令）── */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
