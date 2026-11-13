/* ══════════════════════════════════════════════════════════════
   sw.js — Y.C. 多功能專用平台
   ★ 每次更新程式只需修改 APP_VERSION
   ★ v2.8.0 更新策略：
     - 新 SW 安裝後進入 waiting，不再強制 skipWaiting
     - 由 app.js 顯示「發現新版本」橫幅，使用者點擊後才接管+reload
     - 從此部署後不需手動清快取
   ══════════════════════════════════════════════════════════════ */

const APP_VERSION = '4.41.0';
const CACHE_NAME  = `yc-cache-${APP_VERSION}`;
const PAGES_CACHE = 'yc-pages-v1';   // SOP 原檔頁面圖：不跟版本走，更新 App 不清

// ── 核心本地資源（必須快取成功，任一失敗 SW 安裝即失敗重試）──
const CORE_ASSETS = [
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/books.css',
  './css/media.css',
  './css/quiz.css',
  './css/eink.css',
  './css/splash.css',
  './css/english.css',
  './css/fitness.css',
  './js/db.js',
  './js/books.js',
  './js/media.js',
  './js/utils.js',
  './js/quiz.js',
  './js/data.js',
  './js/english.js',
  './js/fitness.js',
  './js/dtask.js',
  './js/plan.js',
  './js/milestone.js',
  './js/stats.js',
  './js/coach.js',
  './js/settings.js',
  './js/countdown.js',
  './js/app.js',
  './js/layout.js',
  './js/tts.js',
  './css/memory.css',
  './js/memory.js',
  './js/predict.js',
  './js/engexam.js',
  './data/memory/index.json',
  './data/memory/police.min.json',
  './data/memory/constitution.min.json',
  './data/memory/criminal.min.json',
  './data/memory/procedure.min.json',
  './data/memory/duty.min.json',
  './data/memory/deadline.min.json',
  './data/predict.json',
  './data/exam_fixes.json',
  './data/exam_research.json',
  './data/english_exam.json',
  './data/english_police.json',
  // v4.40：Dexie（IndexedDB 存取，少了它整個 App 打不開）與 Chart.js 改列必要資源。
  //   原本是「可選」：安裝當下 CDN 剛好連不上就沒快取，之後也補不回來（script 標籤的回應是 opaque，下面不存），
  //   離線開啟就整個壞掉。列為必要後，CDN 連不上時新版先不安裝、繼續用舊版，下次再試
  'https://cdnjs.cloudflare.com/ajax/libs/dexie/4.0.8/dexie.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
];

// ── 可選資源（快取失敗不影響 SW 安裝）──────────────────────
const OPTIONAL_ASSETS = [
  './icons/splash-logo.png',
  './icons/vinyl-record.png',
  './icons/tonearm.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './splash-logo-icon.png',
  './data/memory/deadline_audit.json',   // 期限總表／考古對照（較大，選用）
  'https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;700&family=Dancing+Script:wght@600;700&family=Cormorant+Garamond:ital,wght@1,400;1,500&display=swap',
  './js/jszip.min.js',
  './js/epub.min.js',
];

/* ── 安裝：預快取核心資源 ── */
/* v3.2.7 限定：因前幾版快取卡住，本次啟用 skipWaiting 強制更新，
   讓使用者重開即生效，不需手動點更新橫幅。下版可視情況改回 waiting。 */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      const corePromise = cache.addAll(CORE_ASSETS);
      const optionalPromise = Promise.allSettled(
        OPTIONAL_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
      return Promise.all([corePromise, optionalPromise]);
    })
    // ★ 不在這裡呼叫 skipWaiting()：原本一裝好就強制接管，新版會在使用者
    //   還沒看到「立即更新」橫幅前就自己生效，那顆按鈕形同虛設，
    //   而且可能在作答或編輯到一半時抽換資源。
    //   改為停在 waiting 狀態，等使用者按下更新（收到 SKIP_WAITING）才接管。
  );
});

/* ── 啟動：清舊快取，接管所有頁面 ── */
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

  // 頁面導覽（index.html）→ 用「這一版」快取裡的 index.html（v4.40 起）
  //   ★ 原本網路優先：部署新版後第一次開啟，舊 SW 從網路拿到新版 index.html，JS／CSS 卻還是舊快取
  //     → 新 HTML 配舊 JS（按鈕呼叫不存在的函式、版面錯亂），還把新 HTML 存進舊版快取。
  //   現在 HTML 和 JS／CSS 一律來自同一版快取；新版由瀏覽器比對 sw.js 發現，裝好後跳「發現新版本」，
  //   按「立即更新」才整套換新。也順便解決慢速網路的白畫面：不必等網路。
  //   快取裡沒有（第一次安裝還沒完成）才走網路，離線又沒有快取時回傳錯誤頁由瀏覽器處理。
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      const res = await fetch(e.request);
      if (res && res.status === 200) cache.put('./index.html', res.clone());
      return res;
    })());
    return;
  }

  // v4.41 SOP 原檔頁面圖（data/sop/…）：放在獨立、不跟版本走的快取 yc-pages-v1。
  //   看過一次就留在裝置裡，App 更新版本時不會被清掉重抓（每份 SOP 約 1–2 MB，不預先全部下載）
  if (url.includes('/data/sop/')) {
    e.respondWith(caches.open(PAGES_CACHE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res && res.status === 200) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // 程式要求最新版的請求（fetch 帶 cache:'no-store'／'reload'，例：考古題答案更正讀 data/exam_fixes.json）
  //   → 網路優先、順便更新快取，離線才用快取。v4.37 前一律 Cache First，只改資料不升版號時手機讀不到新資料
  if (e.request.cache === 'no-store' || e.request.cache === 'reload') {
    e.respondWith(fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type !== 'opaque') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }

  // 其他資源：Cache First（有快取直接用，沒有才去網路並存快取）
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // opaque（跨網域、沒有 CORS）一般不存；cdnjs 的程式庫例外——固定版本號、內容不會變，存起來離線才開得了
        const cdn = url.startsWith('https://cdnjs.cloudflare.com/');
        if (!res || (res.type === 'opaque' ? !cdn : res.status !== 200)) return res;
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

/* ── 接收主頁面訊息（使用者確認更新）── */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
