// ══ settings.js — 設定與匯出 ══════════════════════════
// 依賴：db.js, utils.js, data.js(getWrong), countdown.js(renderSetCountdown)
//
// v2.8.2 重構：
// - IIFE 模組化，內部函式私有化（_gasGetConfig、buildHTML、_blobToBase64 等）
// - 偵錯面板按鈕改 addEventListener（不再依賴全域 _debugLogs/_debugCopyAll）
// - 匯出 HTML / 設定頁 innerHTML 補上 esc()（防止題目含 < > 字元時版面壞掉）
// - 雲端備援補 HTTP 狀態檢查（錯誤訊息更明確）
// - 功能與 v2.8.1 完全相同

(function(){
'use strict';

// ══════════════════════════════════════════════════════════════
// ══ 雲端備份（Google Apps Script）══════════════════════════════
// 架構：PWA → POST → Apps Script → Google Drive
// 不需要 OAuth 登入，只需 Script URL + 自訂密碼
// ══════════════════════════════════════════════════════════════

const GAS_URL_KEY      = 'gasWebAppUrl';
const GAS_PWD_KEY      = 'gasPassword';
const GAS_BACKUP_FILE  = 'YC_Platform_backup.json';
const GAS_SIZE_WARN    = 30 * 1048576;   // Apps Script 上傳約 50MB 上限，30MB 起提醒

// ══ 備份共用規則 ════════════════════════════════════════════════
// 備份用的設定：清掉 7 天前的每日任務勾選紀錄
//   dtask_done_日期 每天新增一筆，只有「當天」會被讀取（歷史達成率另存
//   dtask_history，自己只留 30 天），舊的留著只會讓設定越積越多。
async function _backupSettings(){
  const cut = new Date(); cut.setDate(cut.getDate() - 7);
  const cutKey = 'dtask_done_' + cut.getFullYear() + '-' + String(cut.getMonth()+1).padStart(2,'0')
               + '-' + String(cut.getDate()).padStart(2,'0');
  const keep = [];
  for(const st of await da('settings')){
    if(/^dtask_done_\d{4}-\d{2}-\d{2}$/.test(st.key) && st.key < cutKey){ await dd('settings', st.key); continue; }
    keep.push(st);
  }
  return keep;
}

// 搜尋索引 searchBlob 由其他欄位算得，不寫進備份（約省 1/4 容量），還原時重建。
// ★ 題目公式必須與 data.js 的 saveQ 完全一致（法條直接用 data.js 的 _lawBlob）。
const _noBlob = rows => rows.map(({ searchBlob, ...r }) => r);
// 檔案類清單去掉檔案本體與縮圖（JSON 存不了 Blob，原本只會變成空物件 {}）
const _noFile = ({ blob, coverBlob, coverThumb, spineThumb, thumbnail, ...r }) => r;
const _blobQ = q => ((q.stem||'')+' '+(q.groupStem||'')+' '+(q.subject||'')+' '+(q.year||'')+' '
  +(q.exam||'')+' '+(q.num||'')+' '+(q.keywords||[]).join(' ')).toLowerCase();

// 還原一個資料表：檔案「有這個表」就以檔案為準，空陣列也會清空；
// 檔案「沒有這個表」（舊版備份、雲端備份沒有學習區）才略過，保留手機現有資料。
// ★ 原本空陣列也略過：備份時是空的表，還原後手機上的舊資料仍留著，與備份不一致。
async function _restoreTable(name, rows){
  if(!Array.isArray(rows)) return 0;
  if(name === 'questions') rows = rows.map(q => ({ ...q, searchBlob: _blobQ(q) }));
  if(name === 'laws')      rows = rows.map(l => {   // 條號一律以 art2n 為準（舊備份、桌面版寫回的可能是舊格式）
    const r = { ...l, articleNumber: art2n(l.article) || l.articleNumber || 0 };
    r.searchBlob = _lawBlob(r); return r;   // 公式在 data.js
  });
  await dc(name);
  if(rows.length) await bulkPut(name, rows);
  return rows.length;
}
// 設定逐筆覆蓋、不清空
// 設定逐筆覆蓋、不清空。
//   ★ 連線設定（雲端網址、密碼、Azure 金鑰）只在手機上「還沒設定」時才從備份補上：
//   新手機還原一次就能用；但已經設好的不會被舊備份蓋回舊值
//   （Apps Script 重新部署會換網址，用舊備份還原後網址變回舊的 → 雲端一直 HTTP 404）
const _CONN_KEYS = [GAS_URL_KEY, GAS_PWD_KEY, 'tts_azure_key'];
// 舊版把「上次備份／還原時間」存在設定裡，會跟著備份跑到別台裝置，造成誤判 → 還原時略過
const _DEVICE_LOCAL_KEYS = ['lastBackupTime', 'lastRestoreTime'];
async function _restoreSettings(rows){
  let n = 0;
  for(const st of (Array.isArray(rows) ? rows : [])){
    if(!st || st.key == null) continue;
    if(_DEVICE_LOCAL_KEYS.includes(st.key)) continue;
    if(_CONN_KEYS.includes(st.key) && String((await dg('settings', st.key))?.value || '').trim()) continue;
    await dp('settings', st); n++;
  }
  return n;
}
const _mb = n => (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';

// 整批還原資料表＋設定：包在同一個資料庫交易裡，全部寫入成功才生效；
//   中途失敗（空間不足、資料有誤）會整批復原成還原前的樣子。
//   ★ 原本逐表「先清空再寫入」，寫到一半失敗就留下被清空的表，資料等於消失。
async function _restoreAll(bk, tables){
  const names = tables.filter(t => Array.isArray(bk[t]) && _db.tables.some(x => x.name === t));
  let n = 0;
  await _db.transaction('rw', [...names, 'settings'].map(t => _db[t]), async () => {
    for(const t of names) n += await _restoreTable(t, bk[t]);
    n += await _restoreSettings(bk.settings);
  });
  _cacheInvalidate();
  return n;
}

// 備份、還原期間保持螢幕常亮：手機關螢幕或切到背景，上傳／下載會被系統中斷（常見的失敗原因）
async function _keepAwake(fn){
  let lock = null;
  try{ lock = await navigator.wakeLock?.request('screen'); }catch(e){}
  try{ return await fn(); }
  finally{ lock?.release().catch(()=>{}); }
}

// 呼叫 Apps Script。網路中斷、Google 端暫時錯誤自動重試（共 4 次）；
//   有回 JSON 就交給呼叫端判斷（密碼錯誤等不重試）。錯誤訊息改成看得懂的說明。
// ★ HTTP 404 也要重試：Apps Script 回應時會把請求轉到 Google 的暫存網址取結果，
//   這一步偶爾回 404（回傳資料大的「還原」最常見），重按幾次就成功，網址本身沒壞。
//   只有每次都 404 才可能是網址失效。
async function _gasCall(url, payload){
  let err, n404 = 0;
  const TRIES = 4;
  for(let i = 0; i < TRIES; i++){
    if(i){ toast('Google 暫時沒回應，第 ' + i + ' 次重試…'); await new Promise(r => setTimeout(r, 2000 * i)); }
    try{
      const res = await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain'}, body: payload });
      const txt = await res.text();
      try{ return JSON.parse(txt); }catch(e){}
      if(/accounts\.google\.com|ServiceLogin/.test(txt))
        throw Object.assign(new Error('Apps Script 需要登入：部署時「存取權」要選「任何人」'), { fatal:true });
      if(res.status === 404) n404++;
      err = new Error(res.ok ? 'Apps Script 沒有回傳資料（可能執行逾時）' : 'HTTP ' + res.status);
      if([400, 401, 403, 405].includes(res.status)) break;   // 請求或權限錯誤，重試也沒用
    }catch(e){
      if(e.fatal) throw e;
      err = new Error('網路連線中斷' + (document.hidden ? '（畫面關閉或切到背景時系統會中斷連線）' : ''));
    }
  }
  if(n404 === TRIES) err = new Error('連續 ' + TRIES + ' 次 HTTP 404：可能是 Google 暫時異常，請稍後再試；'
    + '若一直如此，代表網址已失效（重新部署會換網址），請到 script.google.com → 部署 → 管理部署，複製目前的網址（結尾是 /exec）貼到設定頁後按儲存');
  throw err;
}

// ════════════════════════════════════════════════════════════
// 【雲端備份：GAS 設定】
// ════════════════════════════════════════════════════════════
async function _gasGetConfig(){
  const url = await getSetting(GAS_URL_KEY,'');
  const pwd = await getSetting(GAS_PWD_KEY,'');
  return { url: url.trim(), pwd: pwd.trim() };
}

async function saveGasConfig(){
  const url = (document.getElementById('gas-url-input')?.value||'').trim();
  const pwd = (document.getElementById('gas-pwd-input')?.value||'').trim();
  if(!url){ toast('請填入 Apps Script 網址'); return; }
  await setSetting(GAS_URL_KEY, url);
  await setSetting(GAS_PWD_KEY, pwd);
  toast('設定已儲存 ✓');
}

async function _gasLoadSavedConfig(){
  const { url, pwd } = await _gasGetConfig();
  const urlEl = document.getElementById('gas-url-input');
  const pwdEl = document.getElementById('gas-pwd-input');
  if(urlEl && url) urlEl.value = url;
  if(pwdEl && pwd) pwdEl.value = pwd;
}

// ══ 備份辨識：裝置名稱、備份資訊、同步紀錄 ═══════════════════════
//   問題：三台裝置共用同一份雲端備份。原本「上次備份時間」存在資料庫設定裡，
//   會跟著備份／還原在裝置間搬來搬去，看到的不是雲端檔案真正的備份時間，容易誤蓋。
//   做法：①每份備份都寫入 meta：備份時間、哪台裝置、各類筆數、最後作答日
//        ②裝置名稱、這台「上次同步的是哪一份」存在 localStorage——不進備份，每台各自一份
//        ③備份前先讀雲端（或資料夾）現有那份的 meta，與本機並排比較，有風險就醒目警告
//        ④還原前自動保留本機快照，還原錯了可一鍵復原
const _DEV_KEY = 'yc_device', _ANCHOR_KEY = 'yc_sync_anchor', _GAS_FEAT_KEY = 'yc_gas_features';
const _ls = {
  get(k){ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
};
function _guessDevName(){
  const ua = navigator.userAgent || '';
  if(/iPad|Tablet|BOOX|Android(?!.*Mobile)/i.test(ua)) return '平板';
  if(/Mobi|iPhone|Android/i.test(ua)) return '手機';
  return '電腦';
}
function _device(){
  let d = _ls.get(_DEV_KEY);
  if(!d || !d.id){
    d = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: _guessDevName(), named: false };
    _ls.set(_DEV_KEY, d);
  }
  return d;
}
// 第一次備份前請使用者為裝置命名（三台裝置才分得清楚）；取消 → null
async function _ensureDeviceName(){
  const d = _device();
  if(d.named) return d;
  const v = await askInput('為這台裝置命名', '備份檔會記錄是哪台裝置備份的，多台裝置才不會搞混。\n例如：手機、平板、電腦', d.name, { okText:'確定', placeholder:'手機' });
  if(v === null) return null;
  d.name = (v.trim() || d.name).slice(0, 20); d.named = true;
  _ls.set(_DEV_KEY, d);
  return d;
}
async function renameDevice(){
  const d = _device();
  const v = await askInput('裝置名稱', '只存在這台裝置，不會被備份或還原覆蓋', d.name, { okText:'儲存' });
  if(v === null) return;
  d.name = (v.trim() || d.name).slice(0, 20); d.named = true;
  _ls.set(_DEV_KEY, d);
  toast('裝置名稱：' + d.name);
  _renderSyncStatus();
}
// 這台裝置上次與 target（'cloud'／'local'）同步的是哪一份備份
const _anchor = target => (_ls.get(_ANCHOR_KEY) || {})[target] || null;
function _setAnchor(target, sum, op){
  const a = _ls.get(_ANCHOR_KEY) || {};
  a[target] = { id: sum.id || '', at: sum.at, device: sum.device, deviceId: sum.deviceId, op, when: new Date().toISOString() };
  _ls.set(_ANCHOR_KEY, a);
}

// 備份檔的 meta（寫進備份）
function _buildMeta(d){
  const dev = _device();
  return {
    // 每份備份的唯一編號：判斷「是不是同一份」靠它，不靠時間（各裝置時鐘可能差好幾分鐘）
    backupId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
    device: dev.name, deviceId: dev.id, app: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '',
    counts: { questions: d.questions.length, laws: d.laws.length, attempts: d.attempts.length,
              englishMaterials: (d.englishMaterials || []).length },
    lastAttempt: (d.attempts || []).reduce((m, a) => a.date && a.date > m ? a.date : m, ''),
  };
}
// 一份備份（或本機目前資料）的摘要：優先用 meta；舊版備份沒有 meta 就從資料本身數
function _summ(bk){
  if(!bk) return null;
  const c = bk.meta?.counts || {};
  const n = k => Array.isArray(bk[k]) ? bk[k].length : (c[k] ?? null);
  return {
    id: bk.meta?.backupId || '', at: bk.exportedAt || '', device: bk.meta?.device || '', deviceId: bk.meta?.deviceId || '',
    q: n('questions'), l: n('laws'), a: n('attempts'), e: n('englishMaterials'),
    lastAttempt: bk.meta?.lastAttempt || (Array.isArray(bk.attempts) ? bk.attempts.reduce((m, a) => a.date && a.date > m ? a.date : m, '') : ''),
  };
}
async function _localSumm(){
  const [questions, laws, attempts, englishMaterials] = await Promise.all([da('questions'), da('laws'), da('attempts'), da('englishMaterials')]);
  return { ..._summ({ questions, laws, attempts, englishMaterials }), device: _device().name, deviceId: _device().id };
}
// 時間：2026/11/04 10:20（3 小時前）
function _fmtAt(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d)) return String(iso);
  const p = n => String(n).padStart(2, '0');
  const s = d.getFullYear() + '/' + p(d.getMonth()+1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  const m = Math.round((Date.now() - d) / 60000);
  const rel = m < 1 ? '剛剛' : m < 60 ? m + ' 分鐘前' : m < 1440 ? Math.round(m/60) + ' 小時前' : Math.round(m/1440) + ' 天前';
  return s + '（' + rel + '）';
}

// 並排比較視窗：left／right 是摘要；warns：[{lv:'danger'|'warn'|'ok'|'info', t:'文字'}]
//   有 danger 時「確認」變紅色、改成明確的字，預設焦點在取消 → 不會順手按下去
function _syncCompare({ title, left, right, leftLabel, rightLabel, warns = [], okText = '確認', cnText = '取消', infoOnly = false }){
  return new Promise(resolve => {
    document.getElementById('sync-cmp-ov')?._close?.();
    const danger = warns.some(w => w.lv === 'danger');
    const row = (label, a, b, hi) => '<tr' + (hi ? ' class="sc-diff"' : '') + '><th>' + label + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
    const num = v => v == null ? '—' : Number(v).toLocaleString();
    const L = left || {}, R = right || {};
    const cell = (s, k) => !s ? '—' : k === 'at' ? esc(_fmtAt(s.at)).replace('（', '<br><small>').replace('）', '</small>') : k === 'device' ? esc(s.device || '（未記錄）') : esc(s[k] || '—');
    const ov = document.createElement('div');
    ov.className = 'cov on'; ov.id = 'sync-cmp-ov'; ov.style.zIndex = '880';
    ov.innerHTML = '<div class="cbox sc-box">'
      + '<div class="cbt">' + esc(title) + '</div>'
      + '<table class="sc-tbl"><thead><tr><th></th><th>' + esc(leftLabel) + '</th><th>' + esc(rightLabel) + '</th></tr></thead><tbody>'
      + row('備份時間', left ? cell(L, 'at') : '<span class="sc-none">沒有備份</span>', cell(R, 'at'))
      + row('裝置', cell(left, 'device'), cell(right, 'device'))
      + row('題目', num(L.q), num(R.q), left && right && L.q !== R.q)
      + row('法條', num(L.l), num(R.l), left && right && L.l !== R.l)
      + row('作答紀錄', num(L.a), num(R.a), left && right && L.a !== R.a)
      + row('最後作答日', cell(left, 'lastAttempt'), cell(right, 'lastAttempt'), left && right && L.lastAttempt !== R.lastAttempt)
      + '</tbody></table>'
      + warns.map(w => '<div class="sc-warn ' + w.lv + '">' + ({ danger:'⚠ ', warn:'⚠ ', ok:'✓ ', info:'ⓘ ' }[w.lv] || '') + esc(w.t) + '</div>').join('')
      + '<div class="cbn" style="margin-top:14px">'
      + (infoOnly ? '' : '<button class="btn ' + (danger ? 'bp' : 'bg') + ' bw" data-a="cn">' + esc(cnText) + '</button>')
      + '<button class="btn ' + (infoOnly ? 'bp' : danger ? 'br sc-danger' : 'bp') + ' bw" data-a="ok">' + esc(infoOnly ? '知道了' : okText) + '</button>'
      + '</div></div>';
    let done = false;
    const finish = v => { if(done) return; done = true; ov.remove(); resolve(v); };
    ov._close = () => finish(false);
    ov.addEventListener('click', e => {
      if(e.target === ov) return finish(false);
      const a = e.target.closest('[data-a]')?.dataset.a;
      if(a) finish(a === 'ok' && !infoOnly);
    });
    document.body.appendChild(ov);
  });
}

// target 是不是這台上次同步的那一份：有備份編號就比編號；舊版備份沒有編號才退回比時間
const _isSynced = (target, an) => !!(target && an) && (target.id && an.id ? target.id === an.id : !!(target.at && an.at && target.at <= an.at));
// 備份前的風險判斷：target＝目的地現有那份（可能 null）、local＝本機、an＝這台上次同步紀錄
function _backupWarns(target, local, an, where){
  const w = [], me = _device();
  if(!target){ w.push({ lv:'info', t: where + '目前沒有備份，這會是第一份。' }); }
  else{
    const mine = target.deviceId && target.deviceId === me.id;
    const synced = _isSynced(target, an);
    if(synced) w.push({ lv:'ok', t: where + '這份就是這台上次' + (an.op === 'restore' ? '還原' : '備份') + '的版本，之後沒有其他裝置備份過，可以放心覆蓋。' });
    else if(!mine)
      w.push({ lv: target.deviceId ? 'danger' : 'warn', t: where + '這份是「' + (target.device || '其他裝置／舊版') + '」在 ' + _fmtAt(target.at)
        + ' 備份的' + (an ? '，不是這台上次同步（' + _fmtAt(an.when) + '）的那一份' : '，這台裝置還沒同步過')
        + '。直接覆蓋，那台裝置之後的進度會不見。建議先「還原」再繼續使用。' });
    const less = [['q','題目'],['l','法條'],['a','作答紀錄']].filter(([k]) => target[k] != null && local[k] < target[k]);
    if(less.length) w.push({ lv:'danger', t: where + '的' + less.map(([k, n]) => n + '比本機多 ' + (target[k] - local[k]).toLocaleString() + ' 筆').join('、') + '，覆蓋後就少了這些資料。' });
    if(target.lastAttempt && local.lastAttempt && target.lastAttempt > local.lastAttempt)
      w.push({ lv:'warn', t: where + '最後作答日（' + target.lastAttempt + '）比本機（' + local.lastAttempt + '）新。' });
  }
  if(!local.q && !local.l) w.push({ lv:'danger', t:'本機沒有題目與法條，上傳會把備份變成空的！' });
  return w;
}
// 還原前的風險判斷
function _restoreWarns(src, local, an){
  const w = [], me = _device();
  if(src.deviceId && src.deviceId === me.id) w.push({ lv:'info', t:'這份是這台裝置自己備份的。' });
  else if(src.device) w.push({ lv:'info', t:'這份是「' + src.device + '」備份的。' });
  const more = [['q','題目'],['l','法條'],['a','作答紀錄']].filter(([k]) => src[k] != null && local[k] > src[k]);
  if(more.length) w.push({ lv:'danger', t:'本機的' + more.map(([k, n]) => n + '比備份多 ' + (local[k] - src[k]).toLocaleString() + ' 筆').join('、') + '，還原後會不見。' });
  if(local.lastAttempt && src.lastAttempt && local.lastAttempt > src.lastAttempt)
    w.push({ lv:'warn', t:'本機最後作答日（' + local.lastAttempt + '）比備份（' + src.lastAttempt + '）新。' });
  if(an && src.at && an.at > src.at && !_isSynced(src, an)) w.push({ lv:'warn', t:'這份比這台裝置上次同步的版本（' + _fmtAt(an.at) + '）還舊。' });
  w.push({ lv:'info', t:'還原前會自動保留目前資料的快照，還原錯了可到設定頁「復原」。' });
  return w;
}

// ══ 還原前快照（只存在這台裝置；保留最近 2 份）══════════════════
const _SNAP_TABLES = ['questions','laws','attempts','countdowns','usageLogs','englishVocab','healthLogs','englishMaterials'];
async function _takeSnapshot(reason){
  if(!_db.snapshots) return;
  const data = {};
  for(const t of _SNAP_TABLES) data[t] = await da(t);
  data.settings = await da('settings');
  const summary = { ..._summ(data), device: _device().name };
  await _db.snapshots.add({ createdAt: Date.now(), reason, summary, data });
  const all = await _db.snapshots.orderBy('createdAt').primaryKeys();
  if(all.length > 2) await _db.snapshots.bulkDelete(all.slice(0, all.length - 2));
}
// 還原前建快照；失敗（例如裝置空間不足）時說明清楚，讓使用者決定要不要在沒有快照的情況下繼續
async function _snapOrAsk(reason){
  try{ await _takeSnapshot(reason); return true; }
  catch(e){
    logError('snapshot', e);
    return await askConfirm('無法建立還原前快照', '原因：' + e.message + '\n\n繼續還原的話，還原錯了就無法一鍵復原。建議先取消，清出空間或先備份後再試。', '仍要還原');
  }
}
async function _latestSnapshot(){
  if(!_db.snapshots) return null;
  return (await _db.snapshots.orderBy('createdAt').last()) || null;
}
async function restoreSnapshot(){ try{
  const snap = await _latestSnapshot();
  if(!snap){ toast('沒有可復原的快照'); return; }
  const cur = await _localSumm();
  const ok = await _syncCompare({
    title:'復原到還原前的資料', leftLabel:'快照', rightLabel:'目前本機',
    left: { ...snap.summary, at: new Date(snap.createdAt).toISOString() }, right: { ...cur, at:'' },
    warns: [{ lv:'info', t:'快照建立於「' + (snap.reason || '還原') + '」之前。復原只影響題庫、法條、作答紀錄、設定、倒數、統計、英語、健康數據（書庫、影音檔案不在快照內）。' },
            { lv:'info', t:'復原前會先把目前資料再存一份快照，可以來回切換。' }],
    okText:'復原'
  });
  if(!ok) return;
  await _keepAwake(async () => {
    const data = snap.data;
    if(!await _snapOrAsk('復原快照')) return;
    await _restoreAll(data, _SNAP_TABLES);
    _showDoneDialog('已復原 ✓', ['資料已回到 ' + _fmtAt(new Date(snap.createdAt).toISOString()) + ' 的狀態。', '', '按「知道了」後會重新整理頁面。'], () => location.reload());
  });
}catch(e){ logError('restoreSnapshot', e); toast('復原失敗：' + e.message); }}

// ══ 雲端讀取 ═════════════════════════════════════════════════
//   新版 Apps Script（docs/gas-backup.gs）回應會帶 features：['info','list','history']，
//   有宣告才用 info／list；舊版程式碼不認識的動作，可能被當成「備份」把雲端蓋成空的，絕不亂送。
const _gasFeat = url => ((_ls.get(_GAS_FEAT_KEY) || {})[url]) || [];
function _rememberFeat(url, json){
  if(!json || typeof json !== 'object') return;
  const all = _ls.get(_GAS_FEAT_KEY) || {};
  if(Array.isArray(json.features)) all[url] = json.features;
  else delete all[url];   // 換回舊版程式碼：不再送 info／list
  _ls.set(_GAS_FEAT_KEY, all);
}
// 雲端備份壓縮（v4.33）：備份內容 gzip 後轉 base64，前面加「gz1:」，Apps Script 照樣存成一個字串檔，不用更新部署。
//   中文 JSON 壓縮後約剩 4 成（18MB → 約 7MB），上傳、下載都快很多。
//   還原時看開頭：有「gz1:」就先解壓；舊的未壓縮備份照舊讀。瀏覽器不支援壓縮時改傳未壓縮的內容。
const _GZ = 'gz1:';
async function _gzPack(str){
  if(typeof CompressionStream === 'undefined') return str;
  const blob = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return _GZ + await _blobToBase64(blob);
}
async function _gzUnpack(s){
  if(typeof s !== 'string' || !s.startsWith(_GZ)) return s;
  if(typeof DecompressionStream === 'undefined') throw new Error('這個瀏覽器無法解壓縮雲端備份，請改用 Chrome 或 Edge');
  const bin = await (await fetch('data:application/octet-stream;base64,' + s.slice(_GZ.length))).blob();
  return await new Response(bin.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
const _parseBk = async json => (typeof json.data === 'string') ? JSON.parse(await _gzUnpack(json.data)) : json.data;
// 讀雲端那份的摘要：{ sum, bk(完整資料，只有完整下載時才有), none(雲端沒有檔案), error }
async function _cloudRead(url, pwd, full, fileId){
  if(!full && !fileId && _gasFeat(url).includes('info')){
    const j = await _gasCall(url, JSON.stringify({ password:pwd, action:'info', filename:GAS_BACKUP_FILE }));
    _rememberFeat(url, j);
    if(!j.ok) return { error: j.error || '未知錯誤' };
    if(!j.info) return { none:true };
    return { sum: _summ(j.info) };
  }
  const j = await _gasCall(url, JSON.stringify({ password:pwd, action:'restore', filename:GAS_BACKUP_FILE, ...(fileId ? { fileId } : {}) }));
  _rememberFeat(url, j);
  if(!j.ok) return /找不到|not\s*found|no\s*file|不存在|沒有備份/i.test(j.error || '') ? { none:true } : { error: j.error || '未知錯誤' };
  if(!j.data) return { none:true };
  const bk = await _parseBk(j);
  if(!bk || typeof bk !== 'object') return { error:'備份資料格式錯誤' };
  return { sum: _summ(bk), bk };
}

// ── 備份 ────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════
// 【雲端備份：備份/還原】
// ════════════════════════════════════════════════════════════
async function gdriveBackup(){ try{
  const { url, pwd } = await _gasGetConfig();
  if(!url){ toast('請先在設定頁填入 Apps Script 網址'); return; }
  if(!await _ensureDeviceName()) return;
  // 雲端備份：考試區 + 答題記錄 + 倒數日 + 使用統計 + 設定（不含 blob 類大檔）
  //   englishVocab（單字本，含自己的遺忘曲線進度）與 healthLogs（健康數據）
  //   都是純文字、無 blob 欄位，理應納入雲端備份；先前漏掉會導致還原後這兩塊資料消失。
  const [qs, ls, ats, countdowns, usageLogs, englishVocab, healthLogs, engMats] = await Promise.all([
    da('questions'), da('laws'), da('attempts'),
    da('countdowns'), da('usageLogs'),
    da('englishVocab'), da('healthLogs'), da('englishMaterials')
  ]);
  // 先讀雲端「現在那一份」的真正備份時間與裝置，和本機並排比較（避免誤蓋其他裝置的進度）
  toast('讀取雲端目前的備份…');
  const cloud = await _keepAwake(() => _cloudRead(url, pwd, false));
  if(cloud.error){
    if(/密碼|password/i.test(cloud.error)){ toast('無法讀取雲端：' + cloud.error); return; }
    // 舊版程式碼「雲端還沒有檔案」的訊息各有不同，讀不到不一定是壞掉：說清楚後讓使用者決定
    if(!await askConfirm('讀不到雲端現有的備份', 'Apps Script 回應：' + cloud.error
        + '\n\n如果這是第一次備份，可以繼續；如果雲端應該已經有其他裝置的備份，請先取消並確認網址與密碼。', '仍要備份')) return;
    cloud.sum = null;
  }
  const local = await _localSumm();
  const ok = await _syncCompare({
    title:'備份到雲端（覆蓋雲端）', leftLabel:'雲端目前', rightLabel:'這台（' + _device().name + '）',
    left: cloud.sum || null, right: { ...local, at: new Date().toISOString() },
    warns: _backupWarns(cloud.sum, local, _anchor('cloud'), '雲端'), okText:'覆蓋雲端'
  });
  if(!ok) return;
  await _keepAwake(async () => { try{
      toast('備份中…請保持畫面開啟');
      const settings = await _backupSettings();
      const exportedAt = new Date().toISOString();
      const meta = _buildMeta({ questions:qs, laws:ls, attempts:ats, englishMaterials:engMats });
      const body = JSON.stringify({
          version: 3,
          exportedAt,
          meta,
          questions: _noBlob(qs),
          laws: _noBlob(ls),
          attempts: ats,
          countdowns: countdowns,
          usageLogs: usageLogs,
          settings: settings,
          englishVocab: englishVocab,
          healthLogs: healthLogs,
          // englishMaterials 存的是切分後的句子陣列（純文字、無 blob），
          // 資料量遠小於題庫，納入雲端備份不會造成負擔
          englishMaterials: engMats
      });
      const raw = new Blob([body]).size;
      const packed = await _gzPack(body);
      // info：新版 Apps Script 會存成檔案說明，之後不用下載整份就能看備份時間與裝置（舊版忽略此欄）
      const payload = JSON.stringify({ password: pwd, action: 'backup', filename: GAS_BACKUP_FILE, data: packed,
                                       info: { exportedAt, meta } });
      // 大小以實際送出的內容計算（備份字串再包一層，引號會被跳脫，比原檔大）
      const size = new Blob([payload]).size;
      if(size > GAS_SIZE_WARN && !await askConfirm('備份檔偏大', '雲端備份檔 ' + _mb(size) + '，接近 Google Apps Script 的上傳上限，可能會失敗。\n'
          + '建議改用「本機完整備份」。', '仍要上傳')) return;
      const json = await _gasCall(url, payload);
      _rememberFeat(url, json);
      if(!json.ok){ toast('備份失敗：'+(json.error||'未知錯誤')); return; }
      _setAnchor('cloud', _summ({ exportedAt, meta }), 'backup');
      _showDoneDialog('雲端備份完成 ✓', [
        '已上傳到你的 Google Drive。',
        '',
        '備份時間：' + _fmtAt(exportedAt),
        '裝置：' + meta.device,
        '題目 ' + qs.length + '、法條 ' + ls.length + '、作答紀錄 ' + ats.length,
        '大小：' + _mb(size) + (packed !== body ? '（壓縮前 ' + _mb(raw) + '）' : ''),
        _gasFeat(url).includes('history') ? '雲端已自動保留前幾份備份，可在還原時選擇。' : '',
      ]);
      renderSet();
    }catch(e){ logError('gdriveBackup',e); toast('備份失敗：'+e.message); } });
}catch(e){ logError('gdriveBackup',e); toast('備份失敗：'+e.message); }}

// 選擇要還原哪一份（新版 Apps Script 才有歷史版本）
function _pickVersion(title, items){
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'cov on'; ov.id = 'ver-pick-ov'; ov.style.zIndex = '870';
    ov.innerHTML = '<div class="cbox sc-box"><div class="cbt">' + esc(title) + '</div>'
      + '<div class="cbs">選擇要還原的版本（最新的在最上面）</div>'
      + '<div class="ver-list">' + items.map((it, i) => '<button class="ver-item" data-i="' + i + '">'
        + '<div class="ver-t">' + esc(_fmtAt(it.sum?.at || it.time || it.updated)) + (it.current ? '<span class="ver-cur">目前</span>' : '') + '</div>'
        + '<div class="ver-s">' + esc((it.sum?.device || '未記錄裝置') + (it.sum?.q != null ? '・題目 ' + it.sum.q + '・作答 ' + it.sum.a : '')) + '</div>'
        + '</button>').join('') + '</div>'
      + '<div class="cbn" style="margin-top:12px"><button class="btn bg bw" data-cn>取消</button></div></div>';
    let done = false;
    const finish = v => { if(done) return; done = true; ov.remove(); resolve(v); };
    ov._close = () => finish(null);
    ov.addEventListener('click', e => {
      if(e.target === ov || e.target.closest('[data-cn]')) return finish(null);
      const b = e.target.closest('[data-i]');
      if(b) finish(items[+b.dataset.i]);
    });
    document.body.appendChild(ov);
  });
}

// ── 還原 ────────────────────────────────────────────────────
async function gdriveRestore(){ try{
  const { url, pwd } = await _gasGetConfig();
  if(!url){ toast('請先在設定頁填入 Apps Script 網址'); return; }
  let fileId = null;
  // 新版 Apps Script：列出雲端保留的各個版本供選擇
  if(_gasFeat(url).includes('list')){
    toast('讀取雲端備份清單…');
    const j = await _gasCall(url, JSON.stringify({ password:pwd, action:'list', filename:GAS_BACKUP_FILE }));
    if(!j.ok){ toast('讀取失敗：' + (j.error || '未知錯誤')); return; }
    const files = (j.files || []).map(f => ({ ...f, sum: f.info ? _summ(f.info) : null }));
    if(!files.length){ toast('雲端還沒有備份'); return; }
    if(files.length > 1){
      const pick = await _pickVersion('從雲端還原', files);
      if(!pick) return;
      if(!pick.current) fileId = pick.id;
    }
  }
  toast('下載雲端備份…請保持畫面開啟');
  const cloud = await _keepAwake(() => _cloudRead(url, pwd, true, fileId));
  if(cloud.none){ toast('雲端還沒有備份'); return; }
  if(cloud.error){ toast('還原失敗：' + cloud.error); return; }
  const bk = cloud.bk;
  // 至少要有題目或法規，避免把空的（或壞掉的）備份蓋回來
  if(!(bk.questions?.length || bk.laws?.length)){ toast('還原失敗：備份資料為空，請先備份再還原'); return; }
  const local = await _localSumm();
  const ok = await _syncCompare({
    title:'從雲端還原（覆蓋這台）', leftLabel:'雲端備份', rightLabel:'這台（' + _device().name + '）',
    left: cloud.sum, right: { ...local, at:'' },
    warns: _restoreWarns(cloud.sum, local, _anchor('cloud')), okText:'還原'
  });
  if(!ok) return;
  await _keepAwake(async()=>{ try{
      toast('還原中…請保持畫面開啟');
      if(!await _snapOrAsk('雲端還原')) return;
      await _restoreAll(bk, ['questions','laws','attempts','countdowns','usageLogs',
                             'englishVocab','healthLogs','englishMaterials']);
      if(!fileId) _setAnchor('cloud', cloud.sum, 'restore');   // 還原舊版本不算同步到最新
      _showDoneDialog('雲端還原完成 ✓', [
        '已還原「' + (cloud.sum.device || '未記錄裝置') + '」在 ' + _fmtAt(cloud.sum.at) + ' 的備份。',
        '',
        '還原前的資料已存成快照，需要時可到設定頁「復原」。',
        '按「知道了」後會重新整理頁面。',
      ], ()=> location.reload());
    } catch(innerErr){
      logError('gdriveRestore-inner', innerErr);
      toast('還原失敗：'+innerErr.message+'（手機資料維持原樣）');
    }
  });
}catch(e){ logError('gdriveRestore',e); toast('還原失敗：'+e.message); }}

// ── 檢查同步狀態：不做任何變更，只比較雲端與本機並給建議 ──────────
async function gdriveCheck(){ try{
  const { url, pwd } = await _gasGetConfig();
  if(!url){ toast('請先在設定頁填入 Apps Script 網址'); return; }
  toast('讀取雲端目前的備份…');
  const cloud = await _keepAwake(() => _cloudRead(url, pwd, false));
  if(cloud.error){ toast('無法讀取雲端：' + cloud.error); return; }
  const local = await _localSumm(), an = _anchor('cloud'), c = cloud.sum;
  const w = [];
  if(!c) w.push({ lv:'info', t:'雲端還沒有備份，建議現在備份一次。' });
  else{
    const otherNewer = !_isSynced(c, an) && c.deviceId !== _device().id;
    const known = c.a != null && c.q != null;   // 舊版備份（沒有筆數資訊）無法比較多寡
    const localMore = known && (local.a > c.a || local.q > c.q);
    if(otherNewer && localMore) w.push({ lv:'danger', t:'兩邊都有對方沒有的新資料（雲端有「' + (c.device || '其他裝置') + '」的新備份，這台也有新作答）。請先決定以哪台為主：以雲端為主就還原，以這台為主就備份。' });
    else if(otherNewer) w.push({ lv:'warn', t:'雲端有「' + (c.device || '其他裝置') + '」較新的備份 → 建議「從雲端還原」。' });
    else if(localMore) w.push({ lv:'ok', t:'這台有較新的資料 → 建議「備份到雲端」。' });
    else if(!known) w.push({ lv:'info', t:'雲端這份是舊版格式（沒有筆數資訊），無法比較多寡；下次備份後就能比較。' });
    else w.push({ lv:'ok', t:'雲端與這台一致，不需要動作。' });
  }
  if(an) w.push({ lv:'info', t:'這台上次同步：' + _fmtAt(an.when) + '（' + (an.op === 'restore' ? '還原' : '備份') + '）' });
  await _syncCompare({ title:'雲端同步狀態', leftLabel:'雲端', rightLabel:'這台（' + _device().name + '）',
    left: c || null, right: { ...local, at:'' }, warns: w, infoOnly: true });
}catch(e){ logError('gdriveCheck', e); toast('讀取失敗：' + e.message); }}

// 設定頁：裝置名稱、上次同步、快照
async function _renderSyncStatus(){
  const el = document.getElementById('sync-status');
  if(!el) return;
  const d = _device(), cl = _anchor('cloud'), lo = _anchor('local'), snap = await _latestSnapshot().catch(()=>null);
  const line = (k, v) => '<div class="ss-row"><span class="ss-k">' + k + '</span><span class="ss-v">' + v + '</span></div>';
  el.innerHTML =
    line('這台裝置', esc(d.name) + ' <button class="ss-btn" onclick="renameDevice()">改名</button>')
    + line('雲端同步', cl ? esc((cl.op === 'restore' ? '還原 ' : '備份 ') + _fmtAt(cl.at)) + (cl.op === 'restore' && cl.device ? '<small>（來自 ' + esc(cl.device) + '）</small>' : '') : '<span class="ss-none">尚未同步</span>')
    + line('資料夾備份', lo ? esc((lo.op === 'restore' ? '還原 ' : '備份 ') + _fmtAt(lo.at)) : '<span class="ss-none">尚未備份</span>')
    + (snap ? line('還原前快照', esc(_fmtAt(new Date(snap.createdAt).toISOString())) + ' <button class="ss-btn" onclick="restoreSnapshot()">復原</button>') : '');
}

// 複製新版 Apps Script 程式碼（支援雲端版本紀錄）
async function copyGasScript(){
  try{
    const res = await fetch('docs/gas-backup.gs', { cache:'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const code = await res.text();
    await navigator.clipboard.writeText(code);
    toast('已複製 Apps Script 程式碼 ✓（記得改密碼）');
  }catch(e){
    // 剪貼簿被擋（部分瀏覽器、未授權）→ 直接開檔案，長按全選複製
    toast('無法自動複製，已開啟程式碼檔案，請全選後複製');
    window.open('docs/gas-backup.gs', '_blank', 'noopener');
  }
}


// ════════════════════════════════════════════════════════════
// 【設定頁渲染】
// ════════════════════════════════════════════════════════════
// 移除題庫裡的猜題（v4.33 起不再提供猜題庫）：以前從猜題庫匯入的題目都帶「猜題」標籤
//   （考試別 116猜題、116變化題，或舊版的 猜題（原題）、猜題（變化題））。連同這些題目的作答紀錄一起刪，
//   避免統計還算到已不存在的題目。刪除前先存快照，可在設定頁「復原」。
const _isGuessQ = q => (q.tags||[]).includes('猜題');
async function removeGuessQs(){ try{
  const qs = (await da('questions')).filter(_isGuessQ);
  if(!qs.length){ toast('題庫裡沒有猜題'); return; }
  const ids = new Set(qs.map(q => q.id));
  const ats = (await da('attempts')).filter(a => ids.has(a.qid));
  const ex = [...new Set(qs.map(q => q.exam || '未分類'))].join('、');
  if(!await askConfirm('移除題庫裡的猜題', '刪除 ' + qs.length + ' 題猜題（考試別：' + ex + '）' + (ats.length ? '與它們的 ' + ats.length + ' 筆作答紀錄' : '') +
      '。\n考古題不受影響。刪除前會存快照，需要時可到「雲端同步」的「復原」找回。', '刪除')) return;
  if(!await _snapOrAsk('移除猜題')) return;
  await _db.transaction('rw', _db.questions, _db.attempts, async () => {
    await _db.questions.bulkDelete([...ids]);
    if(ats.length) await _db.attempts.bulkDelete(ats.map(a => a.id));
  });
  _cacheInvalidate();
  toast('已移除 ' + qs.length + ' 題猜題');
  renderSet();
}catch(e){ logError('removeGuessQs', e); toast('移除失敗：' + e.message); }}

async function renderSet(){  _renderAzureKey().catch(()=>{}); try{
  const[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  const gRow = document.getElementById('guess-row'), gN = qs.filter(_isGuessQ).length;
  if(gRow){ gRow.style.display = gN ? '' : 'none'; const b = document.getElementById('guess-n'); if(b) b.textContent = gN; }
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
  document.getElementById('db-info').innerHTML=`總題數：${qs.length}<br>法條數：${ls.length}<br>作答記錄：${ats.length}<br>科目：${esc(subs.join('、'))||'無'}<br>題型：選擇 ${qs.filter(q=>q.type==='mc').length} / 申論 ${qs.filter(q=>q.type==='es').length}`;
  renderSetCountdown();
  _gasLoadSavedConfig();
  _renderSyncStatus().catch(()=>{});
  // 版本號（備份／還原時間改顯示在「雲端同步」區，且以這台裝置自己的紀錄為準）
  const verInfoEl = document.getElementById('set-ver-info');
  if(verInfoEl){
    const av = typeof APP_VERSION  !== 'undefined' ? APP_VERSION  : '';
    const dv = typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '';
    verInfoEl.innerHTML =
      `程式版本：<b>v${av}</b>　題庫版本：<b>${dv}</b>`;

    // 診斷資訊：錯誤日誌
    const diagEl = document.getElementById('set-diag-info');
    if(diagEl){
      const errs = typeof _errLog !== 'undefined' ? _errLog : [];
      if(errs.length === 0){
        diagEl.innerHTML = '<span style="color:var(--grn)">✓ 無錯誤記錄</span>';
      } else {
        const errHtml = errs.slice(-5).reverse().map(e=>
          `<div style="color:var(--red2,#c00);font-size:11px;border-left:2px solid var(--red);padding-left:6px;margin-bottom:4px">` +
          `<b>${esc(e.ctx)}</b>：${esc(e.msg)}<br><span style="color:var(--t2)">${esc(e.t.replace('T',' ').slice(0,19))}</span></div>`
        ).join('');
        diagEl.innerHTML = `<div style="color:var(--t2);font-size:11px;margin-bottom:4px">最近 ${errs.length} 筆錯誤（顯示最後5筆）：</div>${errHtml}`;
      }
    }
  }
  }catch(e){ logError('renderSet',e); }}

// ════════════════════════════════════════════════════════════
// 【資料匯出/匯入】
// ════════════════════════════════════════════════════════════
// ── 匯出題目 HTML（一個入口，選題型 → 範圍 → 科目）────────────
//   選擇題：全部／錯題／科目選擇；申論題：全部／科目選擇（參考答案保留答案卷格式）
const _exp = { type:'mc', range:'all', subj:new Set(), qs:[], wrong:new Set() };
const _EXP_RANGE = { mc:[['all','全部'],['wrong','錯題'],['subj','科目選擇']], es:[['all','全部'],['subj','科目選擇']] };

async function openExport(){  try{
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  if(!qs.length){ toast('題庫是空的'); return; }
  Object.assign(_exp, { type:'mc', range:'all', subj:new Set(), qs, wrong:getWrong(qs, ats) });
  _expRender();
  document.getElementById('exp-ov').classList.add('on');
  }catch(e){ logError('openExport', e); }}
function closeExportOv(){ document.getElementById('exp-ov')?.classList.remove('on'); }

// 目前條件下的題目；noSubj：不套科目篩選（列科目清單用）
function _expPool(noSubj){
  const { type, range, subj, qs, wrong } = _exp;
  return qs.filter(q => q.type === type
    && (range !== 'wrong' || wrong.has(q.id))
    && (noSubj || range === 'all' || !subj.size || subj.has(q.subject || '未分類')));
}
function _expSet(k, v){
  if(_exp[k] === v) return;
  _exp[k] = v;
  if(k === 'type') _exp.range = 'all';
  _exp.subj.clear();
  _expRender();
}
function _expToggleSubj(btn){
  const n = btn.dataset.n;
  _exp.subj.has(n) ? _exp.subj.delete(n) : _exp.subj.add(n);
  btn.classList.toggle('on');
  _expCount();
}
function _expCount(){
  document.getElementById('exp-count').textContent = '將匯出 ' + _expPool().length + ' 題';
}
function _expRender(){
  const chip = (k, v, label) => '<button class="chip' + (_exp[k] === v ? ' on' : '') + '" onclick="_expSet(\'' + k + '\',\'' + v + '\')">' + label + '</button>';
  document.getElementById('exp-type').innerHTML = chip('type','mc','選擇題') + chip('type','es','申論題');
  document.getElementById('exp-range').innerHTML = _EXP_RANGE[_exp.type].map(([v, l]) => chip('range', v, l)).join('');
  const cnt = {};
  _expPool(true).forEach(q => { const n = q.subject || '未分類'; cnt[n] = (cnt[n] || 0) + 1; });
  document.getElementById('exp-subj').innerHTML = Object.entries(cnt).sort((a,b) => b[1]-a[1]).map(([n, c]) =>
    '<button class="subj-item" data-n="' + esc(n) + '" onclick="_expToggleSubj(this)"><span class="subj-name">' + esc(n)
    + '</span><span class="subj-cnt">' + c + '</span></button>').join('') || '<div class="cbs">沒有符合的題目</div>';
  document.getElementById('exp-subj-wrap').style.display = _exp.range === 'all' ? 'none' : '';
  _expCount();
}
function doExport(){  try{
  const pool = _expPool(), isEs = _exp.type === 'es';
  if(!pool.length){ toast('沒有符合的題目'); return; }
  const title = (_exp.range === 'wrong' ? '錯題整理' : '警察考題庫') + '・' + (isEs ? '申論題' : '選擇題')
    + (_exp.range !== 'all' && _exp.subj.size ? '（' + [..._exp.subj].join('、') + '）' : '');
  dl(_buildHTML(pool, title, isEs), title.replace(/[（）、・]+/g, '_').replace(/_$/, '') + '_' + today() + '.html', 'text/html');
  closeExportOv();
  toast('匯出 ' + pool.length + ' 題');
  }catch(e){ logError('doExport', e); }}

// 依科目分組輸出可列印的 HTML。申論題的參考答案用與 App 相同的答案卷（樣式從 quiz.css 取出內嵌）
function _buildHTML(qs, title, isEs){
  const grp={};qs.forEach(q=>{const s=q.subject||'未分類';if(!grp[s])grp[s]=[];grp[s].push(q);});
  const d=new Date().toLocaleDateString('zh-TW');
  const esCss = isEs ? [...document.styleSheets].flatMap(sh => { try{ return [...sh.cssRules]; }catch(e){ return []; } })
    .filter(r => /^\.es-(?!kw)/.test(r.selectorText || '')).map(r => r.cssText).join('')
    + '.es-paper,.es-paper-hd,.es-paper-body{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    // 版面與平台答題畫面一致：題目 16px、外框拿掉讓答案卷用滿寬度（原本卡片內距使答案卷變窄、字顯得小）
    + 'body{padding:14px 12px}.q{border:0;padding:0;margin:0 0 30px}.qs{font-size:16px;line-height:1.85;font-weight:500;margin-bottom:4px}' : '';
  let out='<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>html{-webkit-text-size-adjust:100%;text-size-adjust:100%}body{font-family:"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif;max-width:800px;margin:0 auto;padding:24px;line-height:1.8;color:#111}h1{font-size:22px;border-bottom:2px solid #333;padding-bottom:7px}h2{font-size:17px;color:#1f6feb;margin-top:28px}.q{margin:14px 0;padding:14px;border:1px solid #ddd;border-radius:8px}.qn{font-size:11px;color:#666}.qs{font-size:14px;font-weight:600;margin-bottom:8px;white-space:pre-wrap}.opt{font-size:13px;margin:3px 0}.ans{margin-top:8px;font-size:12px;color:#1f6feb;font-weight:600}.note{font-size:11px;color:#666;white-space:pre-wrap}'+esCss+'</style></head><body><h1>'+esc(title)+' — '+d+'</h1>';
  Object.entries(grp).forEach(([sub,sqs])=>{
    out+='<h2>'+esc(sub)+'</h2>';
    sqs.forEach((q,i)=>{
      const meta=[q.year,q.exam,q.num?'第'+q.num+'題':''].filter(Boolean).join(' · ');
      out+='<div class="q"><div class="qn">'+esc(meta)+'</div><div class="qs">'+(i+1)+'. '+esc(q.stem||'')+'</div>';
      if(isEs) out+=window._esPaperHtml(q);
      else{
        Object.entries(q.options||{}).forEach(([k,v])=>{out+='<div class="opt">('+esc(k)+') '+esc(v)+'</div>';});
        if(q.answer)out+='<div class="ans">答案：'+esc(q.answer)+'</div>';
        if(q.answerEs)out+='<div class="note">解析：'+esc(q.answerEs)+'</div>';
      }
      if(q.note)out+='<div class="note">備註：'+esc(q.note)+'</div>';
      out+='</div>';
    });
  });
  return out+'\n</body></html>';
}

// ════════════════════════════════════════════════════════════
// 【資料清除】
// ════════════════════════════════════════════════════════════
async function clearAts(){  try{
  await dc('attempts');
  toast('作答記錄已清除');
  renderSet();
  }catch(e){ logError('clearAts',e); }}

async function delAll(){  try{
  await dc('questions');
  await dc('attempts');
  await dc('laws');
  toast('已全部刪除');
  renderSet();
  }catch(e){ logError('delAll',e); }}


function toggleGasHelp(){
  const el = document.getElementById('gas-help');
  if(!el) return;
  el.classList.toggle('hide');
}

// ════════════════════════════════════════════════════════════
// 本地完整備份 / 還原（書庫 + 影音庫，含實際 Blob 檔案）
// 使用 File System Access API（Chrome/Edge/Android Chrome 支援）
// ════════════════════════════════════════════════════════════

// 備份：選擇本地資料夾，將所有書庫和影音庫逐檔案寫入
async function localBackup(){
  if(!window.showDirectoryPicker){
    toast('你的瀏覽器不支援資料夾存取，請用 Chrome 或 Edge');
    return;
  }
  if(!await _ensureDeviceName()) return;
  // 先選資料夾，讀出裡面現有那份的備份時間與裝置，和本機並排比較後才覆蓋
    try{
      const dirHandle = await window.showDirectoryPicker({ mode:'readwrite' });
      const existing = await _readExamFile(dirHandle, 'exam_data.json').catch(()=>null);
      const local = await _localSumm();
      const tSum = existing ? { ..._summ(existing.data), at: existing.data.exportedAt || new Date(existing.file.lastModified).toISOString() } : null;
      if(!await _syncCompare({
        title:'備份到資料夾「' + dirHandle.name + '」', leftLabel:'資料夾目前', rightLabel:'這台（' + _device().name + '）',
        left: tSum, right: { ...local, at: new Date().toISOString() },
        warns: [..._backupWarns(tSum, local, _anchor('local'), '資料夾裡'),
                { lv:'info', t:'舊的那份會移到 history 資料夾保留（最近 ' + _LOCAL_KEEP + ' 份），不會直接消失。' }],
        okText:'備份'
      })) return;
      await _keepAwake(async () => {
        toast('備份中…請保持畫面開啟');
        const [ebooks, media, qs, ls, ats, countdowns, usageLogs, refbooks, learnmedia, engMats,
               engVocab, healthLogs] = await Promise.all([
          da('ebooks'), da('leisuremedia'), da('questions'), da('laws'),
          da('attempts'), da('countdowns'), da('usageLogs'),
          da('refbooks'), da('learnmedia'), da('englishMaterials'),
          da('englishVocab'), da('healthLogs')
        ]);
        const settings = await _backupSettings();
        const exportedAt = new Date().toISOString();
        const meta = _buildMeta({ questions:qs, laws:ls, attempts:ats, englishMaterials:engMats });

        // ── 完整資料備份（JSON 單檔，含設定/答題/倒數/統計等非 blob 資料）──
        const examBody = JSON.stringify({
          version: 3,
          exportedAt,
          meta,
          questions: _noBlob(qs),
          laws: _noBlob(ls),
          attempts: ats,
          settings: settings,
          countdowns: countdowns,
          usageLogs: usageLogs,
          // 參考書、教材影音的檔案本體在 refbooks／learnmedia 子資料夾，這裡只放清單（不含檔案與縮圖）；
          //   鍵名保留：桌面工具靠「有沒有這兩個鍵」分辨本機檔與雲端檔
          refbooks: refbooks.map(_noFile),
          learnmedia: learnmedia.map(_noFile),
          englishMaterials: engMats,
          // 單字本與健康數據：純文字無 blob，先前漏備份會導致還原後資料消失
          englishVocab: engVocab,
          healthLogs: healthLogs
        });
        // 舊的 exam_data.json 先移進 history（檔名帶備份時間與裝置），再寫新的
        if(existing) await _archiveExam(dirHandle, existing);
        await _writeFile(dirHandle, 'exam_data.json', examBody);
        _setAnchor('local', _summ({ exportedAt, meta }), 'backup');

        // ── 書庫、影音、學習區（參考書／教材影音）：每筆一個說明檔＋實際檔案 ──
        _skipN = 0;
        const count = 1
          + await _backupDir(dirHandle, 'ebooks',     ebooks,     _EXT.ebooks)
          + await _backupDir(dirHandle, 'media',      media,      _EXT.leisuremedia)
          + await _backupDir(dirHandle, 'refbooks',   refbooks,   _EXT.refbooks)
          + await _backupDir(dirHandle, 'learnmedia', learnmedia, _EXT.learnmedia);

        _showDoneDialog('本機備份完成 ✓', [
          '共 ' + count + ' 個項目已寫入「' + dirHandle.name + '」。',
          '',
          '備份時間：' + _fmtAt(exportedAt),
          '裝置：' + meta.device,
          '內容：exam_data.json（' + _mb(new Blob([examBody]).size) + '）＋ ebooks／media／refbooks／learnmedia 四個資料夾',
          _skipN ? '其中 ' + _skipN + ' 個書籍、影音檔與資料夾裡的相同，沒有重寫。' : '',
          existing ? '上一份已移到 history 資料夾保留。' : '',
        ]);
        _renderSyncStatus().catch(()=>{});
      });
    }catch(e){
      if(e.name === 'AbortError') return;  // 使用者取消
      logError('localBackup', e);
      toast('備份失敗：' + e.message);
    }
}

// ── 資料夾備份的版本紀錄：history/exam_data_日期-時間.json，保留最近 _LOCAL_KEEP 份 ──
const _LOCAL_KEEP = 10;
async function _readExamFile(dir, name){
  const file = await (await dir.getFileHandle(name)).getFile();
  let data;
  try{ data = JSON.parse(await file.text()); }
  catch(e){ throw new Error(name + ' 內容損毀，無法讀取（' + e.message + '）'); }
  return { file, data, name };
}
function _stamp(iso){
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
async function _archiveExam(dirHandle, existing){
  const hist = await dirHandle.getDirectoryHandle('history', { create:true });
  const at = existing.data.exportedAt || new Date(existing.file.lastModified).toISOString();
  // 檔名只用英數（部分裝置的檔案系統不接受中文檔名）；裝置名稱記在檔案內容與 index.json
  const fname = 'exam_data_' + _stamp(at) + '.json';
  await _writeFile(hist, fname, existing.file);
  // 版本索引：還原時列清單用，不必每份都讀進來
  let idx = [];
  try{ idx = JSON.parse(await (await (await hist.getFileHandle('index.json')).getFile()).text()); }catch(e){}
  idx = (Array.isArray(idx) ? idx : []).filter(x => x && x.file);
  idx = idx.filter(x => x.file !== fname);
  idx.unshift({ file: fname, sum: { ..._summ(existing.data), at } });
  const drop = idx.slice(_LOCAL_KEEP);
  idx = idx.slice(0, _LOCAL_KEEP);
  for(const x of drop){ try{ await hist.removeEntry(x.file); }catch(e){} }
  await _writeFile(hist, 'index.json', JSON.stringify(idx));
}

// 各類檔案的副檔名（備份寫檔、還原找檔用同一套）
const _EXT = {
  ebooks:       m => m.fileType || 'bin',
  refbooks:     m => m.fileType || 'bin',
  leisuremedia: m => m.mimeType?.split('/')[1] || m.type || 'bin',
  learnmedia:   m => m.mimeType?.split('/')[1] || m.mediaType || 'bin',
};
// 縮圖欄位：Blob 轉 base64 寫進說明檔，並加註「_欄位IsBase64」，還原時轉回 Blob
const _THUMBS = ['coverThumb', 'spineThumb', 'thumbnail'];

async function _writeFile(dir, name, data){
  const w = await (await dir.getFileHandle(name, { create:true })).createWritable();
  await w.write(data);
  await w.close();
}

// 備份一類檔案到子資料夾：{id}.meta.json（不含檔案本體）＋ {id}.{副檔名}（檔案本體）
//   v4.33：資料夾裡已有同名、同大小的檔案本體就不再重寫（書、影音動輒幾十 MB，每次全部重寫是本機備份慢的主因）；
//   說明檔很小，照樣每次重寫（書籤、進度等會變）。
let _skipN = 0;
async function _sameFile(dir, name, blob){
  try{ return (await (await dir.getFileHandle(name)).getFile()).size === blob.size; }
  catch(e){ return false; }
}
async function _backupDir(dirHandle, dirName, rows, extOf){
  const dir = await dirHandle.getDirectoryHandle(dirName, { create:true });
  for(const r of rows){
    const { blob, coverBlob, ...meta } = r;
    for(const f of _THUMBS)
      if(meta[f] instanceof Blob){ meta[f] = await _blobToBase64(meta[f]); meta['_' + f + 'IsBase64'] = true; }
    await _writeFile(dir, r.id + '.meta.json', JSON.stringify(meta));
    if(!blob) continue;
    const name = r.id + '.' + extOf(r);
    if(await _sameFile(dir, name, blob)){ _skipN++; continue; }
    await _writeFile(dir, name, blob);
  }
  return rows.length;
}

// 從子資料夾還原一類檔案：先把每一筆都讀好，再一次換掉資料表。
//   ★ 原本先清空資料表再逐筆讀檔寫入，讀到一半出錯，手機上原有的書、影音就沒了。
async function _restoreDir(dirHandle, dirName, table, extOf){
  let dir;
  try{ dir = await dirHandle.getDirectoryHandle(dirName); }
  catch(e){ if(e.name === 'NotFoundError') return 0; throw e; }   // 舊版備份沒有這個資料夾 → 略過、保留手機現有資料
  const rows = [];
  for await(const [name, handle] of dir.entries()){
    if(!name.endsWith('.meta.json')) continue;
    const meta = JSON.parse(await (await handle.getFile()).text());
    for(const f of _THUMBS){
      const flag = '_' + f + 'IsBase64';
      if(meta[flag] && meta[f]) meta[f] = await _base64ToBlob(meta[f], 'image/jpeg');
      delete meta[flag];
    }
    try{ meta.blob = await (await dir.getFileHandle(meta.id + '.' + extOf(meta))).getFile(); }
    catch(e){ meta.blob = null; }
    rows.push(meta);
  }
  await _db.transaction('rw', _db[table], () => _restoreTable(table, rows));
  return rows.length;
}

// 還原：選擇備份資料夾，讀取並還原所有項目
//   先選資料夾、讀出 exam_data.json，再確認：顯示資料夾名稱、檔案最後修改時間與題目數，
//   選錯資料夾或讀到舊檔（例如桌面工具存到別處）時，還沒覆蓋前就看得出來
async function localRestore(){
  if(!window.showDirectoryPicker){
    toast('你的瀏覽器不支援資料夾存取，請用 Chrome 或 Edge');
    return;
  }
  try{
    const dirHandle = await window.showDirectoryPicker({ mode:'read' });

    // ── 題庫、法條等（exam_data.json）：只有真的沒有這個檔才略過，損毀則中止 ──
    let main = null;
    try{ main = await _readExamFile(dirHandle, 'exam_data.json'); }
    catch(e){ if(e.name !== 'NotFoundError') throw e; }
    // history 資料夾有舊版本 → 讓使用者選要還原哪一份
    let hist = null, idx = [];
    try{
      hist = await dirHandle.getDirectoryHandle('history');
      idx = JSON.parse(await (await (await hist.getFileHandle('index.json')).getFile()).text());
    }catch(e){}
    let chosen = main;
    if(Array.isArray(idx) && idx.length){
      const items = [...(main ? [{ current:true, sum: { ..._summ(main.data), at: main.data.exportedAt || new Date(main.file.lastModified).toISOString() } }] : []),
                     ...idx.map(x => ({ file: x.file, sum: x.sum }))];
      const pick = await _pickVersion('從資料夾「' + dirHandle.name + '」還原', items);
      if(!pick) return;
      if(!pick.current) chosen = await _readExamFile(hist, pick.file);
    }
    const examFile = chosen?.file || null, examData = chosen?.data || null;
    const src = examData ? { ..._summ(examData), at: examData.exportedAt || new Date(examFile.lastModified).toISOString() } : null;
    const local = await _localSumm();
    if(!await _syncCompare({
      title:'從資料夾還原（覆蓋這台）', leftLabel:'備份', rightLabel:'這台（' + _device().name + '）',
      left: src, right: { ...local, at:'' },
      warns: src ? [..._restoreWarns(src, local, _anchor('local')),
                    { lv:'info', t:'書庫、影音、學習教材檔案也會以這個資料夾為準（這些檔案不在快照內）。' }]
                 : [{ lv:'warn', t:'這個資料夾沒有 exam_data.json，只會還原書庫、影音等檔案。' }],
      okText:'還原'
    })) return;

    await _keepAwake(async () => {
      toast('還原中…請保持畫面開啟');
      if(examData && !await _snapOrAsk('資料夾還原')) return;
      let count = examData ? await _restoreAll(examData, ['questions','laws','attempts','countdowns','usageLogs',
        'refbooks','learnmedia','englishMaterials','englishVocab','healthLogs']) : 0;

      // ── 書庫、影音、學習區（實際檔案）──
      count += await _restoreDir(dirHandle, 'ebooks',     'ebooks',       _EXT.ebooks)
             + await _restoreDir(dirHandle, 'media',      'leisuremedia', _EXT.leisuremedia)
             + await _restoreDir(dirHandle, 'refbooks',   'refbooks',     _EXT.refbooks)
             + await _restoreDir(dirHandle, 'learnmedia', 'learnmedia',   _EXT.learnmedia);

      if(src && chosen === main) _setAnchor('local', src, 'restore');
      _showDoneDialog('本機還原完成 ✓', [
        '共 ' + count + ' 個項目已還原。',
        '',
        src ? '已還原「' + (src.device || '未記錄裝置') + '」在 ' + _fmtAt(src.at) + ' 的備份。' : '',
        examData ? '還原前的資料已存成快照，需要時可到設定頁「復原」。' : '',
        '按「知道了」後會重新整理頁面。',
      ], ()=> location.reload());
    });
  }catch(e){
    if(e.name === 'AbortError') return;
    logError('localRestore', e);
    toast('還原失敗：' + e.message);
  }
}

// 輔助：Blob → base64 字串
function _blobToBase64(blob){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload  = ()=> resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 輔助：base64 字串 → Blob
function _base64ToBlob(b64, mimeType='image/jpeg'){
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for(let i=0; i<bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return Promise.resolve(new Blob([arr], { type:mimeType }));
}

// ── Azure TTS Key 設定 ───────────────────────────────────────
async function saveAzureKey(value){
  const v = value.trim();
  await setSetting('tts_azure_key', v);
  if(v.length > 10) toast('Azure Key 已儲存（'+v.length+'字元）✓');
}
async function _renderAzureKey(){
  const key = await getSetting('tts_azure_key','');
  const el  = document.getElementById('tts-azure-key');
  if(el && key) el.value = key;
  _renderAzureUsage().catch(()=>{});
}

// Azure 用量估算顯示（免費層 F0 為每月 50 萬字元）
//   ★ 估算值：SSML 標籤是否計入、失敗重試、跨月時區都可能與微軟後台有出入，
//     用途是「快用完前有個警覺」，精確數字仍以 Azure 後台為準。
async function _renderAzureUsage(){
  const box = document.getElementById('azure-usage');
  if(!box) return;
  const u = await getSetting('azure_usage', null);
  const ym = today().slice(0, 7);
  const chars = (u && u.ym === ym) ? (u.chars || 0) : 0;
  const FREE = 500000;
  const pct  = Math.min(100, Math.round(chars / FREE * 100));
  const warn = pct >= 80;
  box.innerHTML =
    '本月已用約 <b style="color:' + (warn ? 'var(--org)' : 'var(--t1)') + '">'
    + chars.toLocaleString() + '</b> 字元 ／ 免費 ' + FREE.toLocaleString()
    + '（' + pct + '%）'
    + '<div style="height:5px;border-radius:3px;background:var(--bg2);margin-top:5px;overflow:hidden">'
    + '<div style="height:100%;width:' + pct + '%;background:' + (warn ? 'var(--org)' : 'var(--acc)') + '"></div></div>'
    + '<div style="margin-top:4px;opacity:.8">估算值，實際用量以 Azure 後台為準</div>';
}


// ── 需手動關閉的完成提示 ──────────────────────────────────────
//   備份是重要操作，用 toast 幾秒就消失，沒注意到就不確定成功了沒。
//   改用彈窗，必須按「知道了」才關閉，並顯示完成時間供核對。
//   onClose：關閉後要執行的動作（例如還原完成後重新整理頁面）
function _showDoneDialog(title, lines, onClose){
  const ov = document.createElement('div');
  ov.className = 'ov on';   // 沿用既有說明彈窗的樣式（.ov + .sh），確保外觀一致
  ov.id = 'done-dialog-ov';
  const close = ()=>{ ov.remove(); if(typeof onClose === 'function') onClose(); };
  ov.innerHTML =
    '<div class="sh" onclick="event.stopPropagation()" style="max-width:420px">'
    + '<div class="shdl"></div>'
    + '<div class="sht"><span>' + esc(title) + '</span></div>'
    + '<div style="padding:2px 18px 8px;font-size:13px;line-height:1.9;color:var(--t1)">'
    +   lines.map(l => l ? esc(l) : '').join('<br>')
    + '</div>'
    + '<div style="padding:6px 18px 22px">'
    +   '<button class="btn bp bw" id="done-dialog-ok" '
    +   'style="width:100%;padding:11px;font-size:14px;font-weight:600">知道了</button>'
    + '</div>'
    + '</div>';
  ov.onclick = (e)=>{ if(e.target === ov) close(); };
  ov._close = close;   // 手機返回鍵也走同一個關閉（還原後要重新整理）
  document.body.appendChild(ov);
  document.getElementById('done-dialog-ok').onclick = close;
}

// ══ 偵錯面板 ══════════════════════════════════════════════════
const _debugLogs = [];
const _MAX_LOGS = 200;

// 攔截 console.error / console.warn 與未捕獲錯誤
(function(){
  const _origError = console.error.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _push = (level, args) => {
    const msg = args.map(a => {
      if(a instanceof Error) return a.stack || a.message;
      if(typeof a === 'object'){ try{ return JSON.stringify(a); }catch(e){ return String(a); } }
      return String(a);
    }).join(' ');
    _debugLogs.unshift({ t: new Date().toLocaleTimeString('zh-TW'), level, msg });
    if(_debugLogs.length > _MAX_LOGS) _debugLogs.pop();
    // 紅點提示
    const dot = document.getElementById('debug-dot');
    if(dot && level==='error') dot.style.display = 'inline-block';
  };
  console.error = (...a) => { _push('error', a); _origError(...a); };
  console.warn  = (...a) => { _push('warn',  a); _origWarn(...a); };
  // 攔截未捕獲的錯誤
  window.addEventListener('error', e => {
    _push('error', [e.message + ' (' + (e.filename||'').split('/').pop() + ':' + e.lineno + ')']);
  });
  window.addEventListener('unhandledrejection', e => {
    _push('error', ['Promise rejected: ' + (e.reason?.message || e.reason || e)]);
  });
})();

function _debugCopyAll(){
  const txt = _debugLogs.map(l=>'['+l.t+']['+l.level+'] '+l.msg).join('\n');
  if(navigator.clipboard){
    navigator.clipboard.writeText(txt).then(()=>toast('已複製')).catch(()=>{
      _debugFallbackCopy(txt);
    });
  } else {
    _debugFallbackCopy(txt);
  }
}
function _debugFallbackCopy(txt){
  const ta = document.createElement('textarea');
  ta.value = txt; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('已複製'); }
  catch(e){ toast('複製失敗，請手動長按選取'); }
  document.body.removeChild(ta);
}

function openDebugPanel(){
  document.getElementById('debug-panel-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'debug-panel-ov';
  ov.className = 'ov-full-col';
  const dot = document.getElementById('debug-dot');
  if(dot) dot.style.display = 'none';

  const header = document.createElement('div');
  header.className = 'log-viewer-header';
  header.innerHTML = `
    <span style="font-size:13px;font-weight:700;color:#fff;flex:1">偵錯紀錄（最新在上）</span>
    <button data-dbg="copy" title="全部複製" style="background:none;border:none;cursor:pointer;color:#aaa;padding:6px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    </button>
    <button data-dbg="clear" title="清除紀錄" style="background:none;border:none;cursor:pointer;color:#aaa;padding:6px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </button>
    <button data-dbg="close" title="關閉" style="background:none;border:none;cursor:pointer;color:#aaa;padding:6px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  // 事件委派：偵錯面板按鈕（不再依賴全域函式）
  header.addEventListener('click', e=>{
    const btn = e.target.closest('[data-dbg]');
    if(!btn) return;
    if(btn.dataset.dbg === 'copy') _debugCopyAll();
    else if(btn.dataset.dbg === 'clear'){ _debugLogs.length = 0; openDebugPanel(); }
    else if(btn.dataset.dbg === 'close') ov.remove();
  });
  ov.appendChild(header);

  const list = document.createElement('div');
  list.className = 'log-viewer-list';
  if(!_debugLogs.length){
    list.innerHTML = '<div style="color:#555;padding:20px 16px">目前無錯誤紀錄</div>';
  } else {
    _debugLogs.forEach(l => {
      const div = document.createElement('div');
      div.className = 'log-viewer-row';
      div.style.cssText =
        (l.level==='error' ? 'background:rgba(200,50,50,0.12);color:#f87171;' : 'color:#fbbf24;');
      div.innerHTML = '<span style="opacity:.5;margin-right:8px">' + l.t + '</span>'
        + '<span style="opacity:.6;margin-right:8px;font-size:10px;text-transform:uppercase">[' + l.level + ']</span>'
        + esc(l.msg).replace(/\n/g,'<br>');
      list.appendChild(div);
    });
  }
  ov.appendChild(list);
  document.body.appendChild(ov);
}

// ════════ 公開 API ════════
const Settings = {
  saveGasConfig, gdriveBackup, gdriveRestore, gdriveCheck, renameDevice, restoreSnapshot, copyGasScript,
  renderSet, openExport, closeExportOv, doExport, _expSet, _expToggleSubj,
  clearAts, delAll, toggleGasHelp,
  localBackup, localRestore, saveAzureKey, openDebugPanel, removeGuessQs
};
window.Settings = Settings;
Object.assign(window, Settings);

})();

// 設定頁頂端的分區跳轉：依頁面上的 .sec 標題產生，點了捲到該區
function buildSetJump(){
  const pg = document.getElementById('pg-set'), box = document.getElementById('set-jump');
  if(!pg || !box) return;
  const short = t => t.replace(/（.*?）/g, '').replace(/^本地完整/, '').trim();
  box.innerHTML = '';
  pg.querySelectorAll('.sec').forEach(sec => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = short(sec.textContent);
    b.onclick = () => sec.scrollIntoView({ block:'start' });
    box.appendChild(b);
  });
}
document.addEventListener('DOMContentLoaded', buildSetJump);
if(document.readyState !== 'loading') buildSetJump();
