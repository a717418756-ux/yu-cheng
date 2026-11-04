/* ══════════════════════════════════════════════════════════════
   Y.C. 多功能專用平台 — 雲端備份 Apps Script（v2）
   ──────────────────────────────────────────────────────────────
   安裝：script.google.com → 新增專案 → 把這整份貼上（取代原本內容）
        → 改下面的 PASSWORD → 部署 → 新增部署 → 網路應用程式
        → 執行身分「我」、存取權「任何人」→ 部署，複製網址貼到 App 設定頁
   已在用舊版：部署 → 管理部署 → ✏ 編輯 → 版本選「新版本」→ 部署（網址不變）

   比舊版多的功能（App 會自動偵測，舊版程式碼仍可使用）：
     · 每次備份前，把雲端上一份移到「YC_Platform_backup_history」資料夾，保留最近 KEEP 份
       → 就算某台裝置誤蓋，前幾份都還在，還原時可以選版本
     · info：只讀備份時間、裝置、筆數（存在檔案說明），不用下載整份
     · list：列出目前備份與歷史版本
   ══════════════════════════════════════════════════════════════ */

const PASSWORD = '請改成你的密碼';          // ← 必須與 App 設定頁的「自訂密碼」相同
const KEEP = 10;                             // 歷史版本保留份數
const HIST_FOLDER = 'YC_Platform_backup_history';
const FEATURES = ['info', 'list', 'history'];

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return out_({ ok: false, error: '請求格式錯誤' }); }
  if (String(req.password || '') !== PASSWORD) return out_({ ok: false, error: '密碼錯誤' });
  const name = String(req.filename || 'YC_Platform_backup.json');
  const lock = LockService.getScriptLock();   // 兩台裝置同時備份時排隊，不會互相打架
  try {
    lock.waitLock(30000);
    switch (req.action) {
      case 'backup':  return out_(backup_(name, req.data, req.info));
      case 'restore': return out_(restore_(name, req.fileId));
      case 'info':    return out_(info_(name));
      case 'list':    return out_(list_(name));
      default:        return out_({ ok: false, error: '不支援的動作：' + req.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function doGet() { return out_({ ok: true, msg: 'Y.C. backup script v2' }); }

function out_(o) {
  o.features = FEATURES;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function mainFile_(name) {
  const it = DriveApp.getFilesByName(name);
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    if (inHistory_(f)) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best;
}

function histFolder_() {
  const it = DriveApp.getFoldersByName(HIST_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(HIST_FOLDER);
}

function inHistory_(f) {
  const ps = f.getParents();
  while (ps.hasNext()) if (ps.next().getName() === HIST_FOLDER) return true;
  return false;
}

// 檔案說明裡存 { exportedAt, meta }；舊檔沒有就回傳 null
function descInfo_(f) {
  try { const o = JSON.parse(f.getDescription() || ''); return o && typeof o === 'object' ? o : null; }
  catch (e) { return null; }
}

function stamp_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
}

function backup_(name, data, info) {
  if (typeof data !== 'string' || !data.length) return { ok: false, error: '沒有備份內容' };
  const old = mainFile_(name);
  if (old) {
    // 上一份移到歷史資料夾（改名帶時間），不是刪除
    const oi = descInfo_(old);
    const t = oi && oi.exportedAt ? new Date(oi.exportedAt) : old.getLastUpdated();
    old.setName(name.replace(/\.json$/i, '') + '_' + stamp_(t) + '.json');
    old.moveTo(histFolder_());
    prune_();
  }
  const f = DriveApp.createFile(Utilities.newBlob(data, 'application/json', name));
  if (info) { try { f.setDescription(JSON.stringify(info).slice(0, 4000)); } catch (e) {} }
  return { ok: true, id: f.getId() };
}

function prune_() {
  const files = [];
  const it = histFolder_().getFiles();
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) files.push(f); }
  files.sort((a, b) => b.getLastUpdated() - a.getLastUpdated());
  files.slice(KEEP).forEach(f => f.setTrashed(true));
}

function restore_(name, fileId) {
  let f;
  if (fileId) {
    f = DriveApp.getFileById(fileId);
    if (!inHistory_(f) && f.getName() !== name) return { ok: false, error: '不是備份檔' };
  } else {
    f = mainFile_(name);
  }
  if (!f) return { ok: false, error: '找不到備份檔' };
  return { ok: true, data: f.getBlob().getDataAsString('UTF-8'), info: descInfo_(f) };
}

function info_(name) {
  const f = mainFile_(name);
  if (!f) return { ok: true, info: null };
  const i = descInfo_(f) || {};
  if (!i.exportedAt) i.exportedAt = f.getLastUpdated().toISOString();   // 舊版備份：以檔案修改時間代替
  i.size = f.getSize();
  return { ok: true, info: i };
}

function list_(name) {
  const rows = [];
  const cur = mainFile_(name);
  if (cur) rows.push(row_(cur, true));
  const it = histFolder_().getFiles();
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) rows.push(row_(f, false)); }
  rows.sort((a, b) => (b.current - a.current) || (b.time < a.time ? -1 : 1));
  return { ok: true, files: rows };
}

function row_(f, current) {
  const i = descInfo_(f);
  return { id: f.getId(), name: f.getName(), current: current, size: f.getSize(),
           updated: f.getLastUpdated().toISOString(),
           time: (i && i.exportedAt) || f.getLastUpdated().toISOString(), info: i };
}
