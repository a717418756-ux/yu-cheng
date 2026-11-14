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

// version(4)：英語學習庫
_db.version(4).stores({
  questions:   '++id, subject, createdAt, nextReview, reviewLevel, difficultyScore, type, starred',
  laws:        '++id, lawName, category, articleNumber',
  attempts:    '++id, qid, date, responseTime',
  settings:    'key',
  countdowns:  '++id',
  refbooks:    '++id, title, category, fileType, lastRead, createdAt',
  learnmedia:  '++id, title, mediaType, subject, lastPlay, createdAt',
  ebooks:      '++id, title, author, category, fileType, lastRead, createdAt, favorite',
  leisuremedia:'++id, title, type, category, lastPlay, createdAt, favorite',
  usageLogs:   '++id, [date+zone], date, zone',
  // 英語材料：標題、來源類型(text/pdf/ocr)、句子陣列(JSON)、建立時間
  englishMaterials: '++id, title, sourceType, createdAt, lastRead, favorite',
  // 單字本：單字、所屬材料、遺忘曲線欄位（第二階段用，先建表）
  englishVocab:     '++id, word, materialId, reviewLevel, nextReview, createdAt'
});

// version(5)：運動健康庫（healthLogs 以日期字串為主鍵，每日一筆）
_db.version(5).stores({
  questions:   '++id, subject, createdAt, nextReview, reviewLevel, difficultyScore, type, starred',
  laws:        '++id, lawName, category, articleNumber',
  attempts:    '++id, qid, date, responseTime',
  settings:    'key',
  countdowns:  '++id',
  refbooks:    '++id, title, category, fileType, lastRead, createdAt',
  learnmedia:  '++id, title, mediaType, subject, lastPlay, createdAt',
  ebooks:      '++id, title, author, category, fileType, lastRead, createdAt, favorite',
  leisuremedia:'++id, title, type, category, lastPlay, createdAt, favorite',
  usageLogs:   '++id, [date+zone], date, zone',
  englishMaterials: '++id, title, sourceType, createdAt, lastRead, favorite',
  englishVocab:     '++id, word, materialId, reviewLevel, nextReview, createdAt',
  // 健康數據：以日期 YYYY-MM-DD 為主鍵，每日一筆（運動時長/消耗/攝取/步數）
  healthLogs:  'id, updatedAt'
});

// version(6)：還原前自動快照（還原錯了可以一鍵復原；只存在這台裝置，不進備份）
_db.version(6).stores({
  questions:   '++id, subject, createdAt, nextReview, reviewLevel, difficultyScore, type, starred',
  laws:        '++id, lawName, category, articleNumber',
  attempts:    '++id, qid, date, responseTime',
  settings:    'key',
  countdowns:  '++id',
  refbooks:    '++id, title, category, fileType, lastRead, createdAt',
  learnmedia:  '++id, title, mediaType, subject, lastPlay, createdAt',
  ebooks:      '++id, title, author, category, fileType, lastRead, createdAt, favorite',
  leisuremedia:'++id, title, type, category, lastPlay, createdAt, favorite',
  usageLogs:   '++id, [date+zone], date, zone',
  englishMaterials: '++id, title, sourceType, createdAt, lastRead, favorite',
  englishVocab:     '++id, word, materialId, reviewLevel, nextReview, createdAt',
  healthLogs:  'id, updatedAt',
  snapshots:   '++id, createdAt'
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

// 記憶庫數字抽考、猜題庫預覽等「臨時題」（id 以 virt: 開頭）只借用測驗畫面，
//   不存進題庫、不留作答紀錄，避免污染複習排程與統計。
const isVirtualQ = q => String(q?.id || '').startsWith('virt:');
const _isVirtual = (st, data) => !!data && (
  (st === 'questions' && isVirtualQ(data)) ||
  (st === 'attempts'  && String(data.qid || '').startsWith('virt:')));
const dp = (st, data) => _isVirtual(st, data) ? Promise.resolve(data.id) :
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
    // 答錯時大幅降級而非只降一級。
    //   原本 level 6（180天）答錯只退到 5，隔天再答對就立刻跳回 180 天，
    //   等於「僥倖答對一次就視為完全熟練」，真正不熟的題目會太早離開複習池。
    //   改為退回一半（無條件捨去），高等級題目答錯後需要重新累積才會拉長間隔，
    //   低等級（0/1）行為與原本一致，仍是隔天重考。
    return { level: Math.max(0, Math.floor(level / 2)), next: Date.now() + 86400000 };
  }
  const newLevel = Math.min(level + 1, REVIEW_INTERVALS.length - 1);
  const days = REVIEW_INTERVALS[newLevel];
  return { level: newLevel, next: Date.now() + days * 86400000 };
}

// 作答紀錄依題目分組（同一份紀錄陣列只分一次，順序與原陣列相同）。
//   ★ 原本每題都把全部作答紀錄從頭篩一遍，排序時一題又被比對很多次；
//   2400 題 × 1.5 萬筆紀錄，按「今日複習」光排序就要 1.6 秒（手機更久），而且紀錄越多越慢。
//   作答紀錄陣列來自 da() 的快取，有新紀錄時快取會換成新陣列，這裡也就自動重新分組。
const _atsGroups = new WeakMap();
function _atsOf(ats, qid) {
  let g = _atsGroups.get(ats);
  if (!g) {
    g = new Map();
    for (const a of ats) { const l = g.get(a.qid); l ? l.push(a) : g.set(a.qid, [a]); }
    _atsGroups.set(ats, g);
  }
  return g.get(qid) || [];
}

function getDangerLevel(q, recentAts) {
  // ★ 取「最近」3 次：date 是 'YYYY-MM-DD' 字串，原本 b.date - a.date 得到 NaN，
  //   排序無效 → 實際取到的是最舊的 3 次，近期已連對的題目仍被判成危險。
  //   同日多筆以 id（自增＝寫入先後）排序。
  //   correct 為 null（申論題、無標準答案）不算對錯，排除。
  const qa = _atsOf(recentAts, q.id)
    .filter(a => a.correct !== null && a.correct !== undefined)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0));
  const last3 = qa.slice(0, 3);
  const wrongStreak = last3.length >= 2 && last3.every(a => !a.correct);
  const lastWrong   = last3.length > 0 && !last3[0].correct;
  const hesitant    = last3.some(a => a.responseTime > 40000);
  if (wrongStreak) return '🔴';
  if (lastWrong)   return '🟠';
  if (hesitant)    return '🟡';
  return '🟢';
}

// 出題順序：以「單位」洗牌——題組整組是一個單位（組內依 groupOrder），其餘一題一單位。
//   rankOf(單位) 有給時再依它排序（小的先）；排序是穩定的，同等級內仍保持隨機。
//   ★ 題組代號是匯入時給的，不同年度可能重複，所以連同科目、年度、考試別一起比對，不會誤併。
//   回傳單位陣列：要固定題數的（模擬考）才能整組取捨，不把題組切斷。
function shuffleUnits(pool, rankOf) {
  const groups = new Map(), units = [];
  for (const q of pool) {
    if (!q.groupId) { units.push([q]); continue; }
    const k = [q.groupId, q.subject, q.year, q.exam].join('|');
    let u = groups.get(k);
    if (!u) { u = []; groups.set(k, u); units.push(u); }
    u.push(q);
  }
  for (const u of groups.values()) u.sort((a, b) => (a.groupOrder || 0) - (b.groupOrder || 0));
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }
  if (rankOf) { const r = new Map(units.map(u => [u, rankOf(u)])); units.sort((a, b) => r.get(a) - r.get(b)); }
  return units;
}

// ══ 首頁數字與出題共用的篩選（v4.40）══════════════════════════════
//   原本首頁「待複習」算全部題型（申論題建立時 reviewLevel=0、之後從不排程 → 永遠算到期），
//   今日複習卻只出選擇題、又多算沒有 reviewLevel 的舊題 → 兩邊數字對不起來。
//   「危險」標籤點下去出的是整個選擇題庫（只是危險題排前面）。改成兩邊都用下面這兩個判斷。
//   ・待複習：選擇題、有正確答案（沒答案的題目不排程，算進來會永遠到期）、到期
//   ・危險：選擇題、最近 3 次作答（至少 2 次）全錯（getDangerLevel 🔴）
const hasAnswerKey = q => !!String(q.answer || '').replace(/[\s,]/g, '');
const isReviewDue  = (q, now = Date.now()) => q.type === 'mc' && hasAnswerKey(q) && (q.nextReview || 0) <= now;
const isDangerQ    = (q, ats) => q.type === 'mc' && getDangerLevel(q, ats) === '🔴';

// exams：考試別陣列（v4.33；null/空 = 全部考試別）。準備好幾種國考時，只練某一種考試的題目
async function getPriorityPool(mode = 'all', subjects = null, exams = null) { try {
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  if (!qs.length) return [];
  const now = Date.now();
  // 科目篩選（subjects 為陣列且非空時才套用；null/空 = 全部科目）
  const subjSet = (Array.isArray(subjects) && subjects.length) ? new Set(subjects) : null;
  // 空科目一律正規化為「未分類」，與 getSubjectList 顯示的名稱一致，
  // 否則使用者勾選「未分類」會比對不到（傳入'未分類'但題目是''）而查無題目
  const exSet = (Array.isArray(exams) && exams.length) ? new Set(exams) : null;
  const bySubj  = q => (!subjSet || subjSet.has(q.subject || '未分類')) && (!exSet || exSet.has(q.exam || '未分類'));
  const mcQs = qs.filter(q => q.type === 'mc' && bySubj(q));
  let pool = mcQs;
  if      (mode === 'wrong')  { const ws = getWrong(qs, ats); pool = mcQs.filter(q => ws.has(q.id)); }
  else if (mode === 'star')   { pool = mcQs.filter(q => q.starred); }
  else if (mode === 'review') { pool = mcQs.filter(q => isReviewDue(q, now)); }
  else if (mode === 'danger') { pool = mcQs.filter(q => isDangerQ(q, ats)); }   // 首頁「危險」標籤：只出危險題
  else if (mode === 'new')    { pool = mcQs.filter(q => !q.reviewLevel && q.reviewLevel !== 0); }
  // 加強複習：錯誤率高（危險題）∪ 收藏題，去重
  else if (mode === 'focus')  {
    const ws = getWrong(qs, ats);
    pool = mcQs.filter(q => ws.has(q.id) || q.starred);
  }
  // 申論練習：只取申論題（不受 mc 篩選限制，需另行取用）
  else if (mode === 'essay')  {
    pool = qs.filter(q => q.type === 'es' && bySubj(q));
    return pool;   // 申論不套用危險度排序
  }
  // 危險題先出；同一等級內隨機（原本照題庫順序，每次都同一年度先出）。題組以組內最危險的一題排序。
  //   危險等級每題只算一次（原本每次比較都重算）
  const levelOrder = { '🔴': 0, '🟠': 1, '🟡': 2, '🟢': 3 };
  const rank = new Map(pool.map(q => [q, levelOrder[getDangerLevel(q, ats)] ?? 3]));
  return shuffleUnits(pool, u => Math.min(...u.map(q => rank.get(q)))).flat();
} catch(e) { logError('getPriorityPool', e); return []; } }

// 取得題庫中所有科目（依題數多寡排序，供科目多選用）；exams 有值時只算那些考試別的題目
async function getSubjectList(type, exams = null) { try {
  const qs = await da('questions');
  const exSet = (Array.isArray(exams) && exams.length) ? new Set(exams) : null;
  const cnt = {};
  qs.forEach(q => {
    if (type && q.type !== type) return;
    if (exSet && !exSet.has(q.exam || '未分類')) return;
    const s = q.subject || '未分類';
    cnt[s] = (cnt[s] || 0) + 1;
  });
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
} catch(e) { logError('getSubjectList', e); return []; } }

// 取得題庫中所有考試別（依題數多寡排序）
async function getExamList(type) { try {
  const cnt = {};
  (await da('questions')).forEach(q => {
    if (type && q.type !== type) return;
    const s = q.exam || '未分類';
    cnt[s] = (cnt[s] || 0) + 1;
  });
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
} catch(e) { logError('getExamList', e); return []; } }

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

// 條號索引一次性修復（版本 2）：
//   ①v4.17.2 以前的「批次匯入」只存主號（第12條→12），其餘各處都用 art2n 的「主號×1000＋子號」
//   ②v4.22 起 art2n 認得「第X點」（行政規則）與官網寫法「第 7-1 條」，先前這兩種存成 0
async function healLawNums() {
  if ((+await getSetting('lawNumHealed', 0)) >= 2) return;
  const bad = (await da('laws')).filter(l => { const n = art2n(l.article); return n && l.articleNumber !== n; });
  bad.forEach(l => { l.articleNumber = art2n(l.article); });
  if (bad.length) await bulkPut('laws', bad);
  await setSetting('lawNumHealed', 2);
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
    const from = (()=>{ const d=new Date(); d.setDate(d.getDate()-days); return ymd(d); })();
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
const APP_VERSION  = '4.46.0';    // ⓪SOP 流程圖線條粗細統一：原檔的箭頭線（實心細長方形）和其他線（框線）是兩種畫法，放大後一粗一細、像斷成幾段；現在所有線、框、跨頁接線都是同一個粗細，箭頭線和接線接成一條，放大縮小粗細一起變；更新後到設定「考古題答案更正 → 檢查」套用⓪（4.45.0）SOP、補充資料可由桌面掃題「📄 匯入 SOP PDF／匯入補充資料 PDF」在電腦上轉好，圖包在資料裡（data URI）隨備份走，不必推 GitHub、離線也看得到：整理版的流程圖、附表圖片行認得 data:image/svg+xml／jpeg／png，原檔整頁照常顯示；整頁 SVG 有內嵌圖片（掃描、印章）時不內嵌、維持原圖 ⓪（4.44.0）⓪SOP 流程圖版面放鬆：整張圖只往垂直方向等比例拉高 1.25 倍（框、線、箭頭的相對位置與連線不變），字略縮小，行距和框邊都留出空隙，原檔字疊在一起的地方也分開了；跨頁接點拿掉停在線中間、原本指向圓圈的箭頭，接線從真正的線頭接，接起來是一條完整的線⓪（4.43.0）SOP 流程圖改成文字＋線條：框、箭頭、是／否都是原檔的線條，照原檔座標搬過來（不重畫、不重排），裡面的字是真的文字，可以選取、搜尋，跟著深色／淺色／電子紙主題變色；「🔍 放大」可看單張；原檔因為一頁放不下而用Ａ／Ｂ／Ｃ圓圈跨頁的地方，直接用線連起來，好幾頁接成一張完整流程圖⓪（4.42.0）SOP 整理版：流程圖和作業內容分開、兩邊都完整——流程圖（含權責人員）從原檔原樣裁出，手機上放大顯示、可左右滑動、點圖放大；作業內容、使用表單、注意事項是原檔逐字文字（程式逐頁核對字數）；附表是整頁圖。上方可切到「原檔整頁」對照。取代先前手動重排的版本。設定頁按「考古題答案更正 → 檢查」套用 ⓪（4.41.0）⓪SOP 原檔頁面：PDF 每一頁直接轉成圖顯示，樣式、流程圖、箭頭和原檔完全一樣，點圖可放大；搜尋用的文字由程式從 PDF 逐字抽出，不經人工重排。原本有文字排版的（取締疑似施用毒品後駕車作業程序）可切換「原檔／文字排版」。設定頁按「考古題答案更正 → 檢查」套用；頁面圖看過一次就留在裝置裡，離線可看 ⓪放大的圖片按返回鍵會先關閉圖片 ⓪（4.40.0）⓪備份還原逐項回報：題庫、法規、作答、電子書、影音各自顯示已還原／缺檔／失敗（失敗的那一類維持原本資料，其他照常還原）；資料夾缺檔時沿用這台原本的檔案；還原中途被關掉，下次開啟告知哪幾類完成 ⓪首頁「待複習」與今日複習同一判斷（只算有答案的選擇題，不再把申論題算進去），「危險」只出危險題；首頁新增主要操作：繼續練習／開始今日複習，下方限時模擬考、法規搜尋捷徑；開放雙指縮放、鍵盤可操作首頁標籤 ⓪離線與更新：Dexie、Chart.js 列為必要快取；頁面一律用同一版快取，不再出現新 HTML 配舊程式；作答中不跳更新通知，離開作答畫面才顯示 ⓪法規附表【標題】3 個以上時列「跳到」段落按鈕，標題與表格間距加大；書庫空白與缺檔提示說明怎麼做；書的編號是文字時書架不再整個空白 ⓪（4.39.0）⓪底部導覽列跟著區變：首頁三區都沒選時只有「設定」；選考試區顯示首頁／測驗／題庫／資料庫／更多，休閒區顯示首頁／書庫／影音庫／設定，成長區顯示首頁／英語／運動／設定；在該區頁面按「首頁」會回首頁並展開該區 ⓪（4.38.0）底部導覽列：首頁／測驗／題庫／資料庫／更多（記憶庫、考古題排名、分析、設定），取代右下角圓形選單鈕，頁面按鈕不再被擋住；「測驗」直接展開測驗專區 ⓪首頁正確率改為只算有判對錯的作答（與分析頁一致） ⓪考試倒數：已過的顯示「N 天前」並排到最後 ⓪「接續上次的進度？」確認鈕改藍色 ⓪分析頁練習量圖標題不再被捲走，近 7 天沒作答時加說明 ⓪電子紙模式首頁標題改不透明（往下捲不再疊字） ⓪過小文字（10px 上下）放大到 11px、篩選籤加高 ⓪（4.37.0）⓪法規資料庫類別可自訂：新增資料、大量新增、變更類別的選單最後一項「＋ 新增類別…」，篩選列自動列出用過的自訂類別（自訂類別比照補充資料，可用圖片、【標題】與表格排版） ⓪「考古題答案更正」可新增法規資料庫資料（lawNew）：新增 SOP「取締疑似施用毒品後駕車作業程序」（115.5.13 修正版，流程圖、作業內容、注意事項、附表一～三） ⓪修正：離線快取（sw.js）原本一律先用快取，「考古題答案更正」讀不到只改資料的新版 exam_fixes.json；改為帶 no-store 的請求先連網路 ⓪（4.36.0）⓪法規資料庫的警勤加給表、尿液毒品濃度值、警械種類、特種工商業範圍表排成表格（GPT 第二版文字＋Claude 排版，內容逐詞核對無遺漏）；已套用 4.35.0 文字版的，按「考古題答案更正」會換成表格版 ⓪補充資料、行政規則等（法規條文以外）有【標題】或「|」表格時照 SOP 排版顯示（不畫流程圖）；兩欄的表在手機上維持表格，三欄以上才改卡片 ⓪（4.35.0）⓪考古題解析覆核：139 題解析把「⚠待查」補成有出處的公布／施行日期、條號與裁判字號（GPT 覆核、Claude 對照法規資料庫與原始文件複核；GPT 刪掉但沒錯的選項解說以「原解析（覆核前版本）」保留；109 二技勤務第24題性侵害犯罪防治法登記報到條號更正為§41） ⓪法規資料庫 4 筆以圖片存的表（警勤加給表、尿液毒品濃度值、警械種類、特種工商業範圍表）改成可搜尋的文字 ⓪設定「考古題答案更正」可整段更新解析與法規文字，自己改過的解析不覆蓋並列出，套用前先存快照 ⓪（4.34.1）⓪有手寫標註的題目不再打亂選項（標註照原題版面畫，原本選完答案選項會跳回原順序） ⓪解析選項字母改為一次換算（「答案為A選項」這類寫法不會被換兩次） ⓪SOP 表格不在開頭時也能辨識 ⓪（4.34.0）⓪⓪選項隨機排列時，答案與解析直接用本次的選項字母，不再顯示「原題字母」與換算對照；解析裡「選項A」「答案為B」「官方答案：A、C」也一併換算，每行一個選項的解析（(A)錯：…⏎(B)錯：…）照本次 A→E 重排；查證狀態的官方答案字母同步換算 ⓪資料庫 SOP 可用文字新增：【標題】、○ 起訖、◇ 判斷（是／否分支）、步驟方框自動畫箭頭、「|」分隔的表格（手機上每列變卡片），排成接近實際標準作業程序的流程圖與表格，文字照樣搜尋得到；新增資料表單有範本與預覽；SOP 仍可改用圖片 ⓪資料夾還原也能讀從 Google Drive 下載的壓縮雲端備份 ⓪（4.33.0）⓪⓪題庫新增（逐一、大量、批次修改）的「考試別」改成和科目一樣可自訂：點欄位列出題庫已有的考試別與科目（附題數），打字即時篩選，沒有的名稱直接輸入就是新的一類；科目選單改用同一種清單（不再用手機上常被擋住的原生下拉） ⓪選科目練習（今日複習、加強複習、申論等）可再選「考試別」，只練某一種考試；題庫分類頁的考試別只列有題目的 ⓪移除猜題庫（116 猜題、變化題、二類方向）與篇章練習的猜題按鈕，考試區入口改名「📈 考古題排名」（歷屆高頻法條、趨勢與對應考古題練習）；設定「資料維護」可一鍵移除以前匯入題庫的猜題（連同作答紀錄，刪除前存快照） ⓪移除升官等記憶樹連結 ⓪雲端備份壓縮後上傳（約剩 4 成，不必更新 Apps Script，舊備份照樣能還原）；資料夾備份裡已有、大小相同的書籍與影音檔不再重寫 ⓪（4.32.0）⓪新增「🎯 考前衝刺」：錯兩次以上、目前仍是錯題、標了錯因、答對但猜的、收藏、申論自評未掌握，收成一份可勾選的清單，並列出最常考的法規 ⓪答對後可標「猜對的」，申論看完參考答案可自評（掌握／部分／不會）並顯示作答時間 ⓪分析頁新增「📆 本週學習報告」（作答量、正確率、練習天數與上週比較、最弱的法規、下週建議）與「📜 修法提醒」（法規修正年度晚於出題年度的考古題；作答後也會提醒） ⓪設定頁新增「考試規則」：各考試別的模擬考預設計分可自訂 ⓪首頁超過 7 天沒備份會提醒 ⓪篇章練習：沒有關聯法條的觀念題一律歸「其他」，不再用關鍵字硬對篇章 ⓪題目卡片題幹超過上限時以「……」結尾 ⓪「考古題答案更正」確認視窗不再蓋滿螢幕：先列分類統計（答案更正／官方另接受／解析／關聯法條各幾項），細項在視窗內捲動、答案有變的排最前，按鈕固定在下方；所有確認視窗內容過長時都改為內文捲動 ⓪設定頁頂端加分區快速跳轉；設定列右側按鈕不再被擠成兩行；首頁幾處過小的說明字放大 ⓪（4.31.0）⓪限時模擬考升級：可選「整份考古題」（考試別／年度／科目，照原題號）或隨機抽題；可略過不答；計分照考試規則（警大二技、警佐班：單選答錯倒扣 1/3、多選每選項獨立計分；升官等不倒扣）；交卷後成績單（分數、答對／答錯／未答、倒扣失分、各科得分、逐題狀況）、「檢討錯題與未答」直接看解析並標出當時選的答案；最近成績留存 ⓪答錯後可點「這題錯在」標記錯因（觀念不會／記錯數字或要件／看錯題目／二選一猜錯／粗心），分析頁新增「錯因分布」與分類練習 ⓪記憶庫新增「📝 篇章練習」：考古題與猜題依關聯法條（無法條者用篇章關鍵字）對到法條樹各章，顯示每章題數、已做、待加強，可只練沒做過＋錯題 ⓪（4.30.2）⓪猜題庫回到 800 題（四科各 200）：國文 10 題移除（國文改練考古題）；警佐二類補寫的社維法 3 題、刑法 5 題併入原規劃，替換 8 題重複或冷門題（刑訴§116-2、§348Ⅲ、§416、§119，刑法§42，警察法施行細則§13，補償辦法與拘留所辦法各 1 題）；已匯入猜題庫的題目按匯入時會一併移除這 18 題 ⓪（4.30.1）⓪存檔題庫全面複核（5,647 題）：答案全數已對照官方答案；刑法§321 刪除「夜間」修法日期更正為 108.5.29（4 題解析）；115 題「分析建議答案、非官方」改為「官方答案已核對」；113 警佐勤務 6、7 題舊句改擇一給分說明；9 題只有簡短筆記的警察法規題補完整解題（保留原筆記）；猜題庫 425 題只寫條號的詳解補上法規庫條文原文（長條文只摘相關款項）、大法官解釋附解釋文 ⓪（4.30.0）⓪考古題整合 GPT 研究主檔（5,647 題 V1～V6 累積）並由 Claude 對照官方答案原檔複核：108 警佐刑法 6 題原為分析建議答案，依警大修正版(二)更正（第5、23、24、32、33、37題）並重寫解析；官方「A或B」擇一給分 16 題改為可接受多組答案（選任一組都算對）、官方一律給分 8 題作答任選皆算對；5 題空白解析、1 題「測試」補上解析，6 題補關聯法條，113 警佐國文補題號；作答後解析下方新增「官方答案核對狀態」與可展開的「🔎 查證紀錄」（GPT 來源與限制說明，不併入解析）；在設定按「考古題答案更正」套用 ⓪（4.29.0）⓪考古題 5,647 題對照官方答案：有官方答案檔的 3,965 題選擇題逐題比對（考選部、中央警察大學答案 PDF 及釋疑結果），6 題仍為舊公告答案已更正（109 二技勤務 24、29、30、刑法 23；115 警佐憲法 18、勤務 26），2 題送分補說明、2 題英文補題號；設定新增「考古題答案更正」一鍵套用（保留作答紀錄、不蓋過自己改的答案）；猜題 police_v1#15 補註母題官方見解 ⓪（4.28.0）⓪猜題庫 800 題由 Claude 逐題核對：對照法規庫條文原文（含 115.5.13 刑訴、115.8.17 道交條例）及大法官解釋、憲法判決全文，另修正 2 題（釋461 應邀說明對象、刑法§227-1「十八歲以下」）；依 GPT 警佐二類題型補寫 18 題：國文 10 題（錯字、字音、成語、出處、文言閱讀）、社維法管轄與特種工商業 3 題、刑法聚眾施強暴、妨害公務、酒駕再犯 5 題，可在「🧭 二類方向」練習 ⓪（4.27.0）⓪猜題庫整合 GPT 第12～18輪覆核與警佐二類研究：6 題依法條修題（警察命令發布機關改 ABC、偶發集會禁制區核准例外、竊盜罪數補事實、路檢順序限定作業程序、外籍配偶補就服法§48、波士頓警察年代）、8 題補強詳解（快速組合警力計畫 115.1.2 新名稱、114.7.3 刑案報告修正等）；最後 77 題詳解附 GPT 第18輪覆核等級，可只練「本科未定案題」；警佐班新增「🧭 二類方向」：40 個題型（國文與憲法、警察法規、警察勤務、刑法刑訴各 10）、考科與計分說明、每個題型連到相關猜題 ⓪（4.26.1）⓪跨裝置介面調整：電腦版選單鈕改靠內容欄右側（做題時不再露在畫面外側）；平板、電腦做題字級與留白加大，滑鼠懸停有回饋；做題可用鍵盤（1–6／A–F 選答、Enter 送出或下一題、→ 下一題）；記憶庫篩選下拉改並排（手機兩個一列、寬螢幕一列）；手機橫放（S23+ 等）做題畫面壓縮上下留白、維持手機字級；手機觸控的小按鈕加大點擊範圍；平板轉向、視窗縮放時版型即時切換 ⓪（4.26.0）⓪記憶庫新增第六科「期限時效（警法＋行政法）」：整合 Claude 時效期間總整理與 GPT 期限時效考古題復核包——GPT 官方抽核 12 項易混期限（已對條文）、考前記憶圖 5 張、易錯 19 則、修法時間軸；新分頁「📋 期限總表」（45 部法規 1,853 筆期限原句，可依科別／類型／法規／關鍵字篩選，同數字反查、法源查漏）與「📝 考古對照」（284 題時間題、341 題修法提醒、升官等 500 題官答比對含 3 題複數給分），每筆可直接連到題庫練習；原稿行訴§106 項次更正、集遊法加註釋字718 ⓪（4.25.6）⓪猜題庫依 GPT 第1～11輪覆核完整封存包補修 39 題：§319-3散布性影像須告訴乃論（無正解題改正）、修憲複決須「超過」半數、刑訴§205-2採尿須檢察官許可（114.11.11修正）、勤休要點第6點、警察人員人事條例§27加給、釋653、釋718緊急性集會等；歷史判決題補註現行法 ⓪（4.25.5）⓪猜題庫補修 GPT 第6、7、9輪標記但未改的 20 題：組織基準法§21獨立機關改5～11人（答案更正）、§319-6性影像罪告訴乃論（無正解題改正）、警職法§11雙解、提審駁回與拒絕區分、檢察官命具結、特勤§12地區等 ⓪（4.25.4）⓪猜題庫依 GPT 第11輪覆核修正 8 題：身家調查免查要件、擴張解釋例改兇器、§121／§122 受賄條號、酒測器檢定期間與 1,000 次、Ratcliffe 4I（Intent）、同車乘客 70 歲例外、§35 強制抽血要件、115.5.13 唾液快篩新制 ⓪（4.25.3）⓪介面與操作優化：猜題庫考試別改為獨立分段按鈕、記住上次的考試別／科目／分頁（記憶庫、考試英文亦同）、每次練習題數可選（10／20／50／全部）、公平洗牌；已匯入猜題改以穩定編號同步更新，使用者自改題幹不會被刪；記憶樹🔥標示加註警佐班題數；修正跨科重複題（113憲判2） ⓪（4.25.2）⓪猜題庫註明二技與警佐班共用同一份題庫，並列出變化題母題來源 ⓪（4.25.1）⓪猜題庫依 GPT＋Claude 全數複核報告第3版修正：預防性羈押罪名題改正答案選項、題幹用語與詳解補強（113憲判5要件、114採尿修法、刑法§78、111憲判9字號等） ⓪（4.25.0）⓪猜題庫改版：116 年二技＋警佐班猜題庫（憲法、警察法規、警察勤務、刑法刑訴各猜題 100＋變化題 100，取代升官等題庫，可刪除舊題）；二技／警佐班切換（警佐班條文排名）；趨勢分頁加入近三年出題理由回測與交互驗證 ⓪（4.24.0）⓪依警大二技＋警佐班統計補強記憶庫（社維法分則、法律性質與救濟途徑、基本國策與憲法訴訟、勤務與刑法高頻條文）；GPT 複核修正（緊急避難§24Ⅱ、§63、勤前教育等）；猜題庫新增「📈 趨勢」 ⓪（4.23.1）⓪內容複核：補社維§29、修正引用條號、法條標籤只對法規做按鈕；臨時題收藏與備註提示；電子紙樣式 ⓪（4.23.0）⓪考試區新增記憶庫（法條樹連結資料庫、對照表、易錯爭點、數字口訣、閃卡）與猜題庫（預測資料包排名、押題練習、猜題變化題匯入）；成長區新增考試英文重點；臨時題（virt:）不寫入題庫 ⓪（4.22.38）⓪多裝置防誤蓋：備份記錄時間／裝置／筆數，覆蓋前讀取雲端（資料夾）現有那份並排比較、紅色警告；裝置名稱與同步紀錄只存本機；檢查同步狀態 ⓪還原前自動快照、可一鍵復原（db version 6：snapshots） ⓪資料夾備份保留 history 10 份、還原可選版本；新版 Apps Script（docs/gas-backup.gs）雲端保留 10 份 ①法條↔考題雙向：題幹自動偵測引用、法條彈窗／條文卡顯示相關考題與答對率、一鍵練習；分析頁弱點法條排行；法條彈窗關聯與法規頁一致；查無時連到全國法規資料庫 ②法規頁 onclick 跳脫修正
const DATA_VERSION = '1150614-01';   // 題庫版本（題庫/法條資料更新時遞增）
