// ══ db.js — Dexie 資料層 ═══════════════════════════════════════
//
// 外部 API（dg/da/dp/dd/dc/bulkPut/getSetting/setSetting/
//           getCountdowns/saveCountdowns）呼叫端 6 個 JS 零修改。
// ═══════════════════════════════════════════════════════════════

const DB_NAME = 'Y.C. All-in-one';

const _db = new Dexie(DB_NAME);

// version(1)：原始 schema（不動）
_db.version(1).stores({
  questions: '++id, subject, createdAt, nextReview, reviewLevel, difficultyScore, type, starred',
  laws:      '++id, lawName, category, articleNumber',
  attempts:  '++id, qid, date, responseTime',
  settings:  'key',
  countdowns:'++id'
});

// version(2)：新增學習區/休閒區 store
_db.version(2).stores({
  questions:  '++id, subject, createdAt, nextReview, reviewLevel, difficultyScore, type, starred',
  laws:       '++id, lawName, category, articleNumber',
  attempts:   '++id, qid, date, responseTime',
  settings:   'key',
  countdowns: '++id',
  // ── 學習區 ──────────────────────────────────────────────
  // 參考書/教材（PDF/epub，Blob 儲存）
  refbooks:   '++id, title, category, fileType, lastRead, createdAt',
  // 學習媒體（影片 or 音檔，二選一，Blob 儲存）
  learnmedia: '++id, title, mediaType, subject, lastPlay, createdAt',
  // ── 休閒區 ──────────────────────────────────────────────
  // 電子書（PDF/epub，Blob 儲存）
  ebooks:     '++id, title, category, fileType, lastRead, createdAt',
  // 休閒媒體（影片/音樂，Blob 儲存）
  leisuremedia:'++id, title, mediaType, lastPlay, createdAt',
  // ── 共用：使用時間記錄 ───────────────────────────────────
  // key = 'YYYY-MM-DD:zone'，value 累積秒數
  usageLogs:  '++id, [date+zone], date, zone'
});

// version(3)：ebooks/leisuremedia 補充索引，新增 favorites store
_db.version(3).stores({
  questions:   '++id, subject, createdAt, nextReview, reviewLevel, difficultyScore, type, starred',
  laws:        '++id, lawName, category, articleNumber',
  attempts:    '++id, qid, date, responseTime',
  settings:    'key',
  countdowns:  '++id',
  refbooks:    '++id, title, category, fileType, lastRead, createdAt',
  learnmedia:  '++id, title, mediaType, subject, lastPlay, createdAt',
  // ebooks：補充 author、tags 索引（搜尋用）
  ebooks:      '++id, title, author, category, fileType, lastRead, createdAt, favorite',
  // leisuremedia：補充 type、tags 索引（影片/音頻篩選用）
  leisuremedia:'++id, title, type, category, lastPlay, createdAt, favorite',
  usageLogs:   '++id, [date+zone], date, zone'
});

// ── 遺忘曲線間隔 ─────────────────────────────────────────────
const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 180];

async function initDB() {
  await _db.open();
  return _db;
}

// ════════════════════════════════════════════════════════════════
// 輕量快取（邏輯與舊版完全相同）
// ════════════════════════════════════════════════════════════════
const _cache = {};
const _CACHE_TTL = 30000;

function _cacheGet(key) {
  const c = _cache[key];
  if (!c) return null;
  if (Date.now() - c.ts > _CACHE_TTL) { delete _cache[key]; return null; }
  return c.data;
}
function _cacheSet(key, data) { _cache[key] = { data, ts: Date.now() }; }
function _cacheInvalidate(st) {
  if (st === undefined) {
    Object.keys(_cache).forEach(k => delete _cache[k]);
  } else {
    // 清除 store 本身 + 所有以 'store:' 開頭的條件快取
    Object.keys(_cache).forEach(k => {
      if (k === st || k.startsWith(st + ':')) delete _cache[k];
    });
  }
}

// ── 錯誤記錄 ─────────────────────────────────────────────────
const _errLog = [];
function logError(context, err) {
  const entry = { t: new Date().toISOString(), ctx: context, msg: err?.message || String(err) };
  _errLog.push(entry);
  if (_errLog.length > 50) _errLog.shift();
  console.error('[PoliceExam]', context, err);
}

// ════════════════════════════════════════════════════════════════
// CRUD API — 介面與 v2 100% 相同
// ════════════════════════════════════════════════════════════════

const dg = (st, k) => _db[st].get(k);

const da = (st, idx, qry) => {
  // 分條件快取 key：無條件用 store 名，有條件帶入參數
  const cacheKey = (idx && qry !== undefined) ? `${st}:${idx}=${qry}` : st;
  if (!idx && !qry) {
    const cached = _cacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);
    return _db[st].toArray().then(rows => { _cacheSet(cacheKey, rows); return rows; });
  }
  if (idx && qry !== undefined) {
    const cached = _cacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);
    return _db[st].where(idx).equals(qry).toArray()
      .then(rows => { _cacheSet(cacheKey, rows); return rows; });
  }
  return _db[st].toArray();
};

const dp = (st, data) =>
  _db[st].put(data).then(key => { _cacheInvalidate(st); return key; });

const dd = (st, k) =>
  _db[st].delete(k).then(() => { _cacheInvalidate(st); });

const dc = (st) =>
  _db[st].clear().then(() => { _cacheInvalidate(st); });

function bulkPut(st, items) {
  return _db[st].bulkPut(items).then(() => {
    _cacheInvalidate(st);
    return items.length;
  });
}

// ════════════════════════════════════════════════════════════════
// 遺忘曲線核心（邏輯完全不變）
// ════════════════════════════════════════════════════════════════

function calcNextReview(level, correct) {
  if (!correct) {
    return { level: Math.max(0, level - 1), next: Date.now() + 86400000 };
  }
  const newLevel = Math.min(level + 1, REVIEW_INTERVALS.length - 1);
  const days = REVIEW_INTERVALS[newLevel];
  return { level: newLevel, next: Date.now() + days * 86400000 };
}

function getDangerLevel(q, recentAts) {
  const qa = recentAts.filter(a => a.qid === q.id).sort((a, b) => b.date - a.date);
  const last3 = qa.slice(0, 3);
  const wrongStreak = last3.length >= 2 && last3.every(a => !a.correct);
  const lastWrong   = last3.length > 0 && !last3[0].correct;
  const hesitant    = last3.some(a => a.responseTime > 40000);
  if (wrongStreak) return '🔴';
  if (lastWrong)   return '🟠';
  if (hesitant)    return '🟡';
  return '🟢';
}

async function getPriorityPool(mode = 'all') { try {
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  if (!qs.length) return [];
  const now = Date.now();
  const mcQs = qs.filter(q => q.type === 'mc');
  let pool = mcQs;
  if      (mode === 'wrong')  { const ws = getWrong(qs, ats); pool = mcQs.filter(q => ws.has(q.id)); }
  else if (mode === 'star')   { pool = mcQs.filter(q => q.starred); }
  else if (mode === 'review') { pool = mcQs.filter(q => (q.nextReview || 0) <= now); }
  else if (mode === 'new')    { pool = mcQs.filter(q => !q.reviewLevel && q.reviewLevel !== 0); }
  const levelOrder = { '🔴': 0, '🟠': 1, '🟡': 2, '🟢': 3 };
  pool.sort((a, b) => {
    const da_ = getDangerLevel(a, ats);
    const db_ = getDangerLevel(b, ats);
    return (levelOrder[da_] || 3) - (levelOrder[db_] || 3);
  });
  return pool;
} catch(e) { logError('getPriorityPool', e); return []; } }

// ════════════════════════════════════════════════════════════════
// settings / countdowns helpers（介面完全不變）
// ════════════════════════════════════════════════════════════════

async function getSetting(key, fallback = '') {
  try {
    const r = await dg('settings', key);
    return (r && r.value !== undefined) ? r.value : fallback;
  } catch(e) { return fallback; }
}

async function setSetting(key, value) {
  try { await dp('settings', { key, value }); }
  catch(e) { logError('setSetting', e); }
}

async function getCountdowns() {
  try { return await da('countdowns'); } catch(e) { return []; }
}

async function saveCountdowns(list) {
  try {
    await dc('countdowns');
    if (list.length) await bulkPut('countdowns', list);
  } catch(e) { logError('saveCountdowns', e); }
}



// ════════════════════════════════════════════════════════════════
// usageLogs helpers（三區使用時間記錄）
// ════════════════════════════════════════════════════════════════

// 記錄使用秒數（累加）
async function logZoneUsage(zone, seconds) {
  if (!zone || seconds < 1) return;
  const date = today();
  try {
    // Dexie 複合索引查詢：where('[date+zone]').equals([date, zone])
    const rows = await _db.usageLogs.where('[date+zone]').equals([date, zone]).toArray();
    if (rows.length > 0) {
      const existing = rows[0];
      await _db.usageLogs.update(existing.id, { seconds: (existing.seconds || 0) + seconds });
    } else {
      await _db.usageLogs.add({ date, zone, seconds });
    }
    _cacheInvalidate('usageLogs');
  } catch(e) { logError('logZoneUsage', e); }
}

// 取得過去 N 天的所有記錄
async function getUsageLogs(days = 35) {
  try {
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return await _db.usageLogs.where('date').aboveOrEqual(from).toArray();
  } catch(e) { logError('getUsageLogs', e); return []; }
}

// 取得指定日期的各區時間
async function getDayUsage(date) {
  try {
    return await _db.usageLogs.where('date').equals(date).toArray();
  } catch(e) { return []; }
}

// ════════════════════════════════════════════════════════════════
// ebooks helpers（學習區電子書）
// ════════════════════════════════════════════════════════════════

// 取得電子書列表（不含 blob，避免一次載入所有大檔）
async function getEbookList() {
  try {
    const books = await _db.ebooks.toArray();
    // 回傳時排除 blob 欄位，只給清單用的 metadata
    return books.map(({ blob: _b, ...meta }) => meta);
  } catch(e) { logError('getEbookList', e); return []; }
}

// 取得單本電子書（含 blob）
async function getEbook(id) {
  try { return await dg('ebooks', id); }
  catch(e) { logError('getEbook', e); return null; }
}

// 儲存電子書（新增或更新）
async function saveEbook(book) {
  try {
    const key = await dp('ebooks', book);
    return key;
  } catch(e) { logError('saveEbook', e); return null; }
}

// 更新閱讀進度（不重寫整個 blob）
async function updateEbookProgress(id, lastPage) {
  try {
    await _db.ebooks.where('id').equals(id).modify({ lastPage, lastRead: Date.now() });
    _cacheInvalidate('ebooks');
  } catch(e) { logError('updateEbookProgress', e); }
}

// 刪除電子書
async function deleteEbook(id) {
  try { await dd('ebooks', id); }
  catch(e) { logError('deleteEbook', e); }
}

// ════════════════════════════════════════════════════════════════
// 版本常數
// ════════════════════════════════════════════════════════════════
const APP_VERSION  = '2.6.8';       // 程式版本（效能優化 + 休閒區 + ebooks）
const DATA_VERSION = '1150531-3';   // 題庫版本（題庫/法條資料更新時遞增）
