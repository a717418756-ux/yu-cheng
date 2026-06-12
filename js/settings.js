// ══ settings.js — 設定與匯出 ══════════════════════════
// 依賴：db.js, utils.js


// ══════════════════════════════════════════════════════════════
// ══ 雲端備份（Google Apps Script）══════════════════════════════
// 架構：PWA → POST → Apps Script → Google Drive
// 不需要 OAuth 登入，只需 Script URL + 自訂密碼
// ══════════════════════════════════════════════════════════════

const GAS_URL_KEY      = 'gasWebAppUrl';
const GAS_PWD_KEY      = 'gasPassword';
const GAS_BACKUP_FILE  = 'YC_Platform_backup.json';

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

// ── 備份 ────────────────────────────────────────────────────
async function gdriveBackup(){ try{
  const { url, pwd } = await _gasGetConfig();
  if(!url){ toast('請先在設定頁填入 Apps Script 網址'); return; }
  toast('備份中…');
  // 雲端備份只含考試區：題庫 + 法條
  const [qs, ls] = await Promise.all([da('questions'), da('laws')]);
  const payload = {
    password: pwd,
    action:   'backup',
    filename: GAS_BACKUP_FILE,
    data: JSON.stringify({ questions:qs, laws:ls })
  };
  const res  = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'text/plain'},
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if(json.ok){
    const t = new Date().toLocaleString('zh-TW');
    await setSetting('lastBackupTime', t);
    toast('已備份到 Google Drive ✓');
    renderSet();
  }
  else{ toast('備份失敗：'+(json.error||'未知錯誤')); }
}catch(e){ logError('gdriveBackup',e); toast('備份失敗：'+e.message); }}

// ── 還原 ────────────────────────────────────────────────────
async function gdriveRestore(){ try{
  const { url, pwd } = await _gasGetConfig();
  if(!url){ toast('請先在設定頁填入 Apps Script 網址'); return; }
  cfm('從雲端還原','現有資料將被覆蓋，確定繼續？', async()=>{
    // ── callback 內有獨立的 try-catch（cfm 是非同步，外層 catch 無法攔截）──
    try{
      toast('還原中…');
      const res  = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({ password:pwd, action:'restore', filename:GAS_BACKUP_FILE })
      });
      const json = await res.json();
      if(!json.ok){ toast('還原失敗：'+(json.error||'未知錯誤')); return; }

      // json.data 可能是字串或已解析的物件（依 GAS 實作而定）
      const bk = (typeof json.data === 'string') ? JSON.parse(json.data) : json.data;
      if(!bk || typeof bk !== 'object'){
        toast('還原失敗：備份資料格式錯誤'); return;
      }

      // 驗證資料有效性（雲端備份只含 questions + laws）
      const hasData = (bk.questions?.length || bk.laws?.length);
      if(!hasData){
        toast('還原失敗：備份資料為空，請先備份再還原'); return;
      }

      // 清除並還原 questions + laws
      await dc('questions'); await dc('laws');
      if(bk.questions?.length) await bulkPut('questions', bk.questions);
      if(bk.laws?.length)      await bulkPut('laws',      bk.laws);

      _cacheInvalidate();
      const rt = new Date().toLocaleString('zh-TW');
      await setSetting('lastRestoreTime', rt);
      toast('還原完成，重新整理頁面中…');
      setTimeout(()=>location.reload(), 1200);
    } catch(innerErr){
      logError('gdriveRestore-inner', innerErr);
      toast('還原失敗：'+innerErr.message);
    }
  });
}catch(e){ logError('gdriveRestore',e); toast('還原失敗：'+e.message); }}


async function renderSet(){  renderAzureKey().catch(()=>{}); try{
  const[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  document.getElementById('exp-info').textContent=`${qs.length} 題 · ${ls.length} 條法條 · ${ats.length} 筆作答`;
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
  document.getElementById('db-info').innerHTML=`總題數：${qs.length}<br>法條數：${ls.length}<br>作答記錄：${ats.length}<br>科目：${subs.join('、')||'無'}<br>題型：選擇 ${qs.filter(q=>q.type==='mc').length} / 申論 ${qs.filter(q=>q.type==='es').length}`;
  renderSetCountdown();
  _gasLoadSavedConfig();
  // 版本號與備份時間
  const [lastBk, lastRs] = await Promise.all([
    getSetting('lastBackupTime','—'),
    getSetting('lastRestoreTime','—')
  ]);
  const verInfoEl = document.getElementById('set-ver-info');
  if(verInfoEl){
    const av = typeof APP_VERSION  !== 'undefined' ? APP_VERSION  : '';
    const dv = typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '';
    verInfoEl.innerHTML =
      `程式版本：<b>v${av}</b>　題庫版本：<b>${dv}</b><br>` +
      `最後備份：<span style="color:var(--t2)">${lastBk}</span>　` +
      `最後還原：<span style="color:var(--t2)">${lastRs}</span>`;

    // 診斷資訊：錯誤日誌
    const diagEl = document.getElementById('set-diag-info');
    if(diagEl){
      const errs = typeof _errLog !== 'undefined' ? _errLog : [];
      if(errs.length === 0){
        diagEl.innerHTML = '<span style="color:var(--grn)">✓ 無錯誤記錄</span>';
      } else {
        const errHtml = errs.slice(-5).reverse().map(e=>
          `<div style="color:var(--red2,#c00);font-size:11px;border-left:2px solid var(--red);padding-left:6px;margin-bottom:4px">` +
          `<b>${e.ctx}</b>：${e.msg}<br><span style="color:var(--t2)">${e.t.replace('T',' ').slice(0,19)}</span></div>`
        ).join('');
        diagEl.innerHTML = `<div style="color:var(--t2);font-size:11px;margin-bottom:4px">最近 ${errs.length} 筆錯誤（顯示最後5筆）：</div>${errHtml}`;
      }
    }
  }
  }catch(e){ logError('renderSet',e); }}
async function expJSON(){  try{
  const[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  dl(JSON.stringify({version:2,exportedAt:new Date().toISOString(),questions:qs,laws:ls,attempts:ats},null,2),'警察考題庫_'+today()+'.json','application/json');
  toast('已匯出 JSON');
  }catch(e){ logError('expJSON',e); }}

async function impJSON(e){
  const file=e.target.files[0]; if(!file) return;
  try{
    // 讀取並解析 JSON
    let data;
    try{ data=JSON.parse(await file.text()); }
    catch(pe){ toast('JSON 格式錯誤，無法解析'); return; }

    // 格式驗證
    if(typeof data!=='object'||data===null){ toast('匯入失敗：格式不正確'); return; }

    // 支援兩種格式：純陣列（舊版）或 {questions:[...]} 物件（新版）
    const qs = Array.isArray(data) ? data
              : Array.isArray(data.questions) ? data.questions
              : null;
    if(!qs){ toast('匯入失敗：找不到 questions 欄位'); return; }
    // questions 可能為 0（只匯入法條也合法）
    if(qs.length===0){
      const lawCount = Array.isArray(data.laws) ? data.laws.length : 0;
      if(lawCount===0){ toast('匯入的題目與法條數量均為 0'); return; }
      // 有法條就繼續
    } else {
      // 有題目時才驗證格式
      if(typeof qs[0]!=='object'||!qs[0].stem){ toast('匯入失敗：題目格式不正確（缺少 stem）'); return; }
    }

    // 版本提示（不阻止匯入）
    if(data.version&&data.version>3) toast('⚠ 此備份版本較新，部分欄位可能不相容');

    // ── 批量寫入（bulkPut 一次 transaction，比逐筆快得多）──────────
    // 去掉 id，讓 autoIncrement 重新分配
    const qItems    = qs.map(({id,...r})=>r);
    const lawItems  = Array.isArray(data.laws)    ? data.laws.map(({id,...r})=>r)    : [];
    const attItems  = Array.isArray(data.attempts) ? data.attempts.map(({id,...r})=>r) : [];

    await bulkPut('questions', qItems);
    if(lawItems.length)  await bulkPut('laws',     lawItems);
    if(attItems.length)  await bulkPut('attempts',  attItems);

    const msg = '已匯入 '+qItems.length+' 題'
      +(lawItems.length ? '、'+lawItems.length+' 條法條' : '')
      +(attItems.length ? '、'+attItems.length+' 筆作答記錄' : '')
      +' ✓';
    toast(msg);
    e.target.value='';
    renderSet();

  }catch(err){
    logError('impJSON',err);
    toast('匯入失敗：'+(err&&err.message?err.message:String(err)));
  }
}

async function expWrong(){  try{
  const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const wids=getWrong(qs,ats);const wqs=qs.filter(q=>wids.has(q.id));
  if(!wqs.length){toast('目前沒有錯題');return;}
  dl(buildHTML(wqs,'錯題整理'),'警察考題_錯題_'+today()+'.html','text/html');toast(`匯出 ${wqs.length} 題`);
  }catch(e){ logError('expWrong',e); }}

async function expAll(){  try{
  const qs=await da('questions');if(!qs.length){toast('題庫是空的');return;}
  dl(buildHTML(qs,'警察考題庫'),'警察考題庫_'+today()+'.html','text/html');toast(`匯出 ${qs.length} 題`);
  }catch(e){ logError('expAll',e); }}

function buildHTML(qs,title){
  const grp={};qs.forEach(q=>{const s=q.subject||'未分類';if(!grp[s])grp[s]=[];grp[s].push(q);});
  const d=new Date().toLocaleDateString('zh-TW');
  let out='<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>'+title+'</title><style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;line-height:1.8;color:#111}h1{font-size:22px;border-bottom:2px solid #333;padding-bottom:7px}h2{font-size:17px;color:#1f6feb;margin-top:28px}.q{margin:14px 0;padding:14px;border:1px solid #ddd;border-radius:8px}.qn{font-size:11px;color:#666}.qs{font-size:14px;font-weight:600;margin-bottom:8px}.opt{font-size:13px;margin:3px 0}.ans{margin-top:8px;font-size:12px;color:#1f6feb;font-weight:600}.note{font-size:11px;color:#666}</style></head><body><h1>'+title+' — '+d+'</h1>';
  Object.entries(grp).forEach(([sub,sqs])=>{
    out+='<h2>'+sub+'</h2>';
    sqs.forEach((q,i)=>{
      const meta=[q.year,q.exam,q.num?'第'+q.num+'題':''].filter(Boolean).join(' · ');
      out+='<div class="q"><div class="qn">'+meta+' · '+(q.type==='mc'?'選擇題':'申論題')+'</div><div class="qs">'+(i+1)+'. '+(q.stem||'')+'</div>';
      if(q.type==='mc')Object.entries(q.options||{}).forEach(([k,v])=>{out+='<div class="opt">('+k+') '+v+'</div>';});
      if(q.answer)out+='<div class="ans">答案：'+q.answer+'</div>';
      if(q.answerEs)out+='<div class="note">解析：'+q.answerEs+'</div>';
      if(q.note)out+='<div class="note">備註：'+q.note+'</div>';
      out+='</div>';
    });
  });
  return out+'\n</body></html>';
}

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
  try{
    const dirHandle = await window.showDirectoryPicker({ mode:'readwrite' });
    toast('備份中…請稍候');

    const [ebooks, media, qs, ls] = await Promise.all([
      da('ebooks'), da('leisuremedia'), da('questions'), da('laws')
    ]);

    let count = 0;

    // ── 題庫 + 法條備份（JSON 單檔）──
    const examHandle = await dirHandle.getFileHandle('exam_data.json', { create:true });
    const examWriter = await examHandle.createWritable();
    await examWriter.write(JSON.stringify({
      exportedAt: new Date().toISOString(),
      questions: qs,
      laws: ls
    }));
    await examWriter.close();

    // ── 書庫備份 ──
    const ebooksDir = await dirHandle.getDirectoryHandle('ebooks', { create:true });
    for(const book of ebooks){
      // metadata（不含 blob 欄位）寫成 JSON
      const { blob:_b, coverBlob:_cb, ...meta } = book;
      // 縮圖（coverThumb, spineThumb）是 Blob，轉成 base64 存在 meta JSON 裡
      const metaOut = { ...meta };
      if(meta.coverThumb instanceof Blob){
        metaOut.coverThumb = await _blobToBase64(meta.coverThumb);
        metaOut._coverThumbIsBase64 = true;
      }
      if(meta.spineThumb instanceof Blob){
        metaOut.spineThumb = await _blobToBase64(meta.spineThumb);
        metaOut._spineThumbIsBase64 = true;
      }
      const metaHandle = await ebooksDir.getFileHandle(`${book.id}.meta.json`, { create:true });
      const metaWriter = await metaHandle.createWritable();
      await metaWriter.write(JSON.stringify(metaOut));
      await metaWriter.close();

      // 實際書檔 blob
      if(book.blob){
        const ext = book.fileType || 'bin';
        const fileHandle = await ebooksDir.getFileHandle(`${book.id}.${ext}`, { create:true });
        const writer = await fileHandle.createWritable();
        await writer.write(book.blob);
        await writer.close();
      }
      count++;
    }

    // ── 影音庫備份 ──
    const mediaDir = await dirHandle.getDirectoryHandle('media', { create:true });
    for(const m of media){
      // metadata
      const { blob:_b, ...meta } = m;
      const metaOut = { ...meta };
      if(meta.thumbnail instanceof Blob){
        metaOut.thumbnail = await _blobToBase64(meta.thumbnail);
        metaOut._thumbnailIsBase64 = true;
      }
      const metaHandle = await mediaDir.getFileHandle(`${m.id}.meta.json`, { create:true });
      const metaWriter = await metaHandle.createWritable();
      await metaWriter.write(JSON.stringify(metaOut));
      await metaWriter.close();

      // 實際媒體 blob
      if(m.blob){
        const ext = m.mimeType?.split('/')[1] || m.type || 'bin';
        const fileHandle = await mediaDir.getFileHandle(`${m.id}.${ext}`, { create:true });
        const writer = await fileHandle.createWritable();
        await writer.write(m.blob);
        await writer.close();
      }
      count++;
    }

    toast(`備份完成！共 ${count} 個項目 ✓`);
  }catch(e){
    if(e.name === 'AbortError') return;  // 使用者取消
    logError('localBackup', e);
    toast('備份失敗：' + e.message);
  }
}

// 還原：選擇備份資料夾，讀取並還原所有項目
async function localRestore(){
  if(!window.showDirectoryPicker){
    toast('你的瀏覽器不支援資料夾存取，請用 Chrome 或 Edge');
    return;
  }
  cfm('本地完整還原', '所有資料（題庫、法條、書庫、影音庫）將被覆蓋，確定繼續？', async()=>{
    try{
      const dirHandle = await window.showDirectoryPicker({ mode:'read' });
      toast('還原中…請稍候');

      let count = 0;

      // ── 題庫 + 法條還原 ──
      try{
        const examHandle = await dirHandle.getFileHandle('exam_data.json');
        const examFile   = await examHandle.getFile();
        const examData   = JSON.parse(await examFile.text());
        if(examData.questions?.length){
          await dc('questions');
          await bulkPut('questions', examData.questions);
          count += examData.questions.length;
        }
        if(examData.laws?.length){
          await dc('laws');
          await bulkPut('laws', examData.laws);
          count += examData.laws.length;
        }
      }catch(e){ /* exam_data.json 不存在就跳過 */ }

      // ── 書庫還原 ──
      try{
        const ebooksDir = await dirHandle.getDirectoryHandle('ebooks');
        await dc('ebooks');
        for await(const [name, handle] of ebooksDir.entries()){
          if(!name.endsWith('.meta.json')) continue;
          const file = await handle.getFile();
          const meta = JSON.parse(await file.text());

          // 還原縮圖 Blob
          if(meta._coverThumbIsBase64 && meta.coverThumb){
            meta.coverThumb = await _base64ToBlob(meta.coverThumb, 'image/jpeg');
            delete meta._coverThumbIsBase64;
          }
          if(meta._spineThumbIsBase64 && meta.spineThumb){
            meta.spineThumb = await _base64ToBlob(meta.spineThumb, 'image/jpeg');
            delete meta._spineThumbIsBase64;
          }

          // 讀取書檔 blob
          const ext = meta.fileType || 'bin';
          try{
            const blobHandle = await ebooksDir.getFileHandle(`${meta.id}.${ext}`);
            meta.blob = await blobHandle.getFile();
          }catch(e){ meta.blob = null; }

          await dp('ebooks', meta);
          count++;
        }
      }catch(e){ /* ebooks 資料夾不存在就跳過 */ }

      // ── 影音庫還原 ──
      try{
        const mediaDir = await dirHandle.getDirectoryHandle('media');
        await dc('leisuremedia');
        for await(const [name, handle] of mediaDir.entries()){
          if(!name.endsWith('.meta.json')) continue;
          const file = await handle.getFile();
          const meta = JSON.parse(await file.text());

          // 還原縮圖 Blob
          if(meta._thumbnailIsBase64 && meta.thumbnail){
            meta.thumbnail = await _base64ToBlob(meta.thumbnail, 'image/jpeg');
            delete meta._thumbnailIsBase64;
          }

          // 讀取媒體 blob
          const ext = meta.mimeType?.split('/')[1] || meta.type || 'bin';
          try{
            const blobHandle = await mediaDir.getFileHandle(`${meta.id}.${ext}`);
            meta.blob = await blobHandle.getFile();
          }catch(e){ meta.blob = null; }

          await dp('leisuremedia', meta);
          count++;
        }
      }catch(e){ /* media 資料夾不存在就跳過 */ }

      _cacheInvalidate?.();
      toast(`還原完成！共 ${count} 個項目，重新整理中…`);
      setTimeout(()=>location.reload(), 1200);
    }catch(e){
      if(e.name === 'AbortError') return;
      logError('localRestore', e);
      toast('還原失敗：' + e.message);
    }
  });
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
async function renderAzureKey(){
  const key = await getSetting('tts_azure_key','');
  const el  = document.getElementById('tts-azure-key');
  if(el && key) el.value = key;
}

// ══ 偵錯面板 ══════════════════════════════════════════════════
const _debugLogs = [];
const _MAX_LOGS = 200;

// 攔截 console.error / console.warn
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
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column';
  const dot = document.getElementById('debug-dot');
  if(dot) dot.style.display = 'none';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;background:#0d0d0d;border-bottom:1px solid #333;flex-shrink:0';
  header.innerHTML = `
    <span style="font-size:13px;font-weight:700;color:#fff;flex:1">偵錯紀錄（最新在上）</span>
    <button id="dbg-copy-btn" title="全部複製" onclick="_debugCopyAll()" style="background:none;border:none;cursor:pointer;color:#aaa;padding:6px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    </button>
    <button title="清除紀錄" onclick="_debugLogs.length=0;openDebugPanel();" style="background:none;border:none;cursor:pointer;color:#aaa;padding:6px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </button>
    <button onclick="document.getElementById('debug-panel-ov').remove()" style="background:none;border:none;cursor:pointer;color:#aaa;padding:6px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  ov.appendChild(header);

  const list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;padding:8px 0;font-family:monospace;font-size:12px';
  if(!_debugLogs.length){
    list.innerHTML = '<div style="color:#555;padding:20px 16px">目前無錯誤紀錄</div>';
  } else {
    _debugLogs.forEach(l => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:6px 14px;border-bottom:1px solid #1a1a1a;'
        + (l.level==='error' ? 'background:rgba(200,50,50,0.12);color:#f87171;' : 'color:#fbbf24;');
      div.innerHTML = '<span style="opacity:.5;margin-right:8px">' + l.t + '</span>'
        + '<span style="opacity:.6;margin-right:8px;font-size:10px;text-transform:uppercase">[' + l.level + ']</span>'
        + esc(l.msg).replace(/\n/g,'<br>');
      list.appendChild(div);
    });
  }
  ov.appendChild(list);
  document.body.appendChild(ov);
}
