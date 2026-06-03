/* ══════════════════════════════════════════════════════════════
   sw.js — Y.C. 多功能專用平台
   ★ 每次更新程式只需修改 APP_VERSION
   ══════════════════════════════════════════════════════════════ */

const APP_VERSION = '1.4.1';
const CACHE_NAME  = `yc-cache-${APP_VERSION}`;

// ── 快取資源（不包含 index.html）────────────────────────────
// index.html 永遠從網路取得，確保 HTML 結構不落後於 JS/CSS
const ASSETS = [
  './manifest.json',
  './css/app.css',
  './css/splash.css',
  'https://cdnjs.cloudflare.com/ajax/libs/dexie/4.0.8/dexie.min.js',
  './js/db.js',
  './js/utils.js',
  './js/quiz.js',
  './js/data.js',
  './js/stats.js',
  './js/settings.js',
  './js/countdown.js',
  './js/app.js',
  './splash-logo-icon.png',
  './icons/splash-logo.png',
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

/* ── 安裝：預快取後進入 waiting，等待使用者確認才接管 ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
    // ★ 不呼叫 skipWaiting()：新 SW 進入 waiting 狀態，
    //   等使用者按「立即更新」後由主頁面透過 postMessage 觸發。
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
      .then(() => self.clients.claim())  // 立即接管，不等使用者重開頁面
  );
});

/* ── 攔截請求 ── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (!url.startsWith('http')) return;

  // index.html → 永遠優先走網路，失敗才用快取
  if (url.endsWith('/') || url.endsWith('/index.html') || url.endsWith('.io/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // 網路成功：不快取 index.html，直接回傳
          return res;
        })
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
