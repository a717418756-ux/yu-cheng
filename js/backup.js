// ══ settings.js — 設定與匯出 ══════════════════════════
// 依賴：db.js, utils.js


// ══════════════════════════════════════════════════════════════
// Google Drive 雲端同步
// Client ID 由使用者在設定頁輸入，存於 localStorage
// ══════════════════════════════════════════════════════════════
const GDRIVE_SCOPES      = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_BACKUP_FILE = '警察考題庫_backup.json';
const GDRIVE_CID_KEY     = 'gdriveClientId';

// 讀取 Client ID（優先從 localStorage）
function getGDriveClientId(){
  return (localStorage.getItem(GDRIVE_CID_KEY)||'').trim();
}

let _gToken = null;   // access token

// ── Client ID 輸入欄位操作 ────────────────────────────────────
function gdriveClientIdChanged(){
  // 即時存入（每次輸入都先暫存，按儲存才正式存）
}
function saveClientId(){
  const val=(document.getElementById('gdrive-client-id-input')?.value||'').trim();
  if(!val){ toast('請輸入 Client ID'); return; }
  try{ localStorage.setItem(GDRIVE_CID_KEY,val); }catch(e){}
  toast('Client ID 已儲存 ✓');
  // 如果已有 token，重設（可能換了 ID）
  if(_gToken){ gdriveLogout(); }
}
function toggleClientIdHelp(){
  const el=document.getElementById('gdrive-client-id-help');
  if(el) el.style.display=el.style.display==='none'?'':'none';
}
// 載入已儲存的 Client ID 到輸入框
function _gdriveLoadSavedId(){
  const saved=getGDriveClientId();
  const el=document.getElementById('gdrive-client-id-input');
  if(el&&saved) el.value=saved;
}

// ── 載入 Google Identity Services ────────────────────────────
function _loadGIS(){
  return new Promise((res,rej)=>{
    if(window.google?.accounts?.oauth2){ res(); return; }
    const s=document.createElement('script');
    s.src='https://accounts.google.com/gsi/client';
    s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}

// ── 登入 ─────────────────────────────────────────────────────
async function gdriveLogin(){
  const cid=getGDriveClientId();
  if(!cid){
    toast('請先在設定頁填入並儲存 Google Client ID');return;
  }
  try{
    await _loadGIS();
    const client=google.accounts.oauth2.initTokenClient({
      client_id:cid,
      scope:GDRIVE_SCOPES,
      callback:(resp)=>{
        if(resp.error){ toast('登入失敗：'+resp.error); return; }
        _gToken=resp.access_token;
        _gdriveUpdateUI(true);
        toast('Google 登入成功 ✓');
      }
    });
    client.requestAccessToken();
  }catch(e){ logError('gdriveLogin',e); toast('登入失敗，請檢查網路'); }
}

// ── 登出 ─────────────────────────────────────────────────────
function gdriveLogout(){
  if(_gToken) google.accounts.oauth2.revoke(_gToken,()=>{});
  _gToken=null;
  _gdriveUpdateUI(false);
  toast('已登出 Google');
}

// ── 更新 UI 狀態 ─────────────────────────────────────────────
function _gdriveUpdateUI(loggedIn){
  const status=document.getElementById('gdrive-status');
  const loginBtn=document.getElementById('gdrive-login-btn');
  const logoutBtn=document.getElementById('gdrive-logout-btn');
  const backupBtn=document.getElementById('gdrive-backup-btn');
  const restoreBtn=document.getElementById('gdrive-restore-btn');
  if(status) status.innerHTML=loggedIn
    ?'✅ 已登入 Google 帳號，可進行雲端同步'
    :'🔒 尚未登入 Google 帳號';
  if(loginBtn)  loginBtn.style.display=loggedIn?'none':'';
  if(logoutBtn) logoutBtn.style.display=loggedIn?'':'none';
  if(backupBtn)  backupBtn.disabled=!loggedIn;
  if(restoreBtn) restoreBtn.disabled=!loggedIn;
}

// ── 備份到 Google Drive ───────────────────────────────────────
async function gdriveBackup(){  try{
  if(!_gToken){ toast('請先登入 Google'); return; }
  toast('備份中…');
  const [qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  const data=JSON.stringify({version:2,exportedAt:new Date().toISOString(),questions:qs,laws:ls,attempts:ats});
  // 查找現有備份檔
  const searchRes=await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${GDRIVE_BACKUP_FILE}'+and+trashed=false&fields=files(id,name,modifiedTime)`,
    {headers:{Authorization:'Bearer '+_gToken}}
  );
  const searchData=await searchRes.json();
  const existing=searchData.files?.[0];
  let uploadUrl,method;
  if(existing){
    uploadUrl=`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`;
    method='PATCH';
  } else {
    // 先建立檔案 metadata
    const metaRes=await fetch('https://www.googleapis.com/drive/v3/files',{
      method:'POST',
      headers:{Authorization:'Bearer '+_gToken,'Content-Type':'application/json'},
      body:JSON.stringify({name:GDRIVE_BACKUP_FILE,mimeType:'application/json'})
    });
    const meta=await metaRes.json();
    uploadUrl=`https://www.googleapis.com/upload/drive/v3/files/${meta.id}?uploadType=media`;
    method='PATCH';
  }
  const upRes=await fetch(uploadUrl,{
    method,
    headers:{Authorization:'Bearer '+_gToken,'Content-Type':'application/json'},
    body:data
  });
  if(!upRes.ok){ toast('備份失敗：'+upRes.status); return; }
  toast('已備份到 Google Drive ✓');
}catch(e){ logError('gdriveBackup',e); toast('備份失敗：'+e.message); }}

// ── 從 Google Drive 還原 ──────────────────────────────────────
async function gdriveRestore(){  try{
  if(!_gToken){ toast('請先登入 Google'); return; }
  const searchRes=await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${GDRIVE_BACKUP_FILE}'+and+trashed=false&fields=files(id,name,modifiedTime)`,
    {headers:{Authorization:'Bearer '+_gToken}}
  );
  const searchData=await searchRes.json();
  const file=searchData.files?.[0];
  if(!file){ toast('找不到雲端備份檔案'); return; }
  const ts=new Date(file.modifiedTime).toLocaleString('zh-TW');
  if(!confirm(`找到備份檔案\n最後更新：${ts}\n\n確定還原？（不覆蓋已有題目）`)) return;
  toast('還原中…');
  const dlRes=await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    {headers:{Authorization:'Bearer '+_gToken}}
  );
  if(!dlRes.ok){ toast('下載失敗：'+dlRes.status); return; }
  const rawData=await dlRes.json();
  // 用現有 impJSON 邏輯直接處理
  await _importFromObj(rawData);
  toast('雲端還原完成 ✓');
  renderSet();
}catch(e){ logError('gdriveRestore',e); toast('還原失敗：'+e.message); }}

// ── 共用匯入邏輯（從物件而非 File）─────────────────────────────
async function _importFromObj(data){  try{
  if(typeof data!=='object'||data===null){ toast('資料格式不正確'); return; }
  let qs=[],ls=[],ats=[];
  if(Array.isArray(data)){ qs=data; }
  else {
    qs=data.questions||[]; ls=data.laws||[]; ats=data.attempts||[];
  }
  if(qs.length){
    const existing=await da('questions');
    const existIds=new Set(existing.map(q=>q.id).filter(Boolean));
    const newQs=qs.filter(q=>!q.id||!existIds.has(q.id));
    if(newQs.length) await bulkPut('questions',newQs);
  }
  if(ls.length){
    const existingL=await da('laws');
    const existLIds=new Set(existingL.map(l=>l.id).filter(Boolean));
    const newLs=ls.filter(l=>!l.id||!existLIds.has(l.id));
    if(newLs.length) await bulkPut('laws',newLs);
  }
  if(ats.length){
    const existingA=await da('attempts');
    const existAIds=new Set(existingA.map(a=>a.id).filter(Boolean));
    const newAts=ats.filter(a=>!a.id||!existAIds.has(a.id));
    if(newAts.length) await bulkPut('attempts',newAts);
  }
}catch(e){ logError('_importFromObj',e); throw e; }}

async function renderSet(){  try{
  const[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  document.getElementById('exp-info').textContent=`${qs.length} 題 · ${ls.length} 條法條 · ${ats.length} 筆作答`;
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
  document.getElementById('db-info').innerHTML=`總題數：${qs.length}<br>法條數：${ls.length}<br>作答記錄：${ats.length}<br>科目：${subs.join('、')||'無'}<br>題型：選擇 ${qs.filter(q=>q.type==='mc').length} / 申論 ${qs.filter(q=>q.type==='es').length}`;
  renderSetCountdown();
  _gdriveLoadSavedId();
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

// ── countdown.js：考試倒數功能 ──────────────────────────────────────
// 依賴：utils.js（esc, today）
// 儲存：localStorage 'examCountdowns' = [{id, name, date}]

const COUNTDOWN_KEY = 'examCountdowns';

function _loadCountdowns(){
  try{ return JSON.parse(localStorage.getItem(COUNTDOWN_KEY)||'[]'); }
  catch(e){ return []; }
}
function _saveCountdowns(list){
  try{ localStorage.setItem(COUNTDOWN_KEY, JSON.stringify(list)); }
  catch(e){}
}

// 計算距離考試的天數
function _daysUntil(dateStr){
  const now  = new Date(); now.setHours(0,0,0,0);
  const exam = new Date(dateStr); exam.setHours(0,0,0,0);
  return Math.round((exam - now) / 86400000);
}

// 渲染倒數區塊（首頁：無框純文字樣式）
function renderCountdown(){
  const el = document.getElementById('h-countdown');
  if(!el) return;
  const list = _loadCountdowns().sort((a,b)=>new Date(a.date)-new Date(b.date));

  if(!list.length){
    el.innerHTML = '<div class="hcd-hint">尚未新增考試，可至設定頁新增 →</div>';
    return;
  }

  el.innerHTML = list.map(item=>{
    const days = _daysUntil(item.date);
    const isPast = days < 0;
    const isToday = days === 0;
    const col  = isPast ? 'var(--t2)' : isToday ? 'var(--red)' : days<=7 ? 'var(--org)' : 'var(--acc)';
    const icon = isPast ? '📋' : isToday ? '🎯' : days<=7 ? '🔥' : '📅';
    const dayNum = isPast ? `−${Math.abs(days)}` : isToday ? '0' : String(days);
    const unit = isPast ? '天前' : isToday ? '今天' : '天';

    return `<div class="hcd-row">
      <span class="hcd-icon">${icon}</span>
      <span class="hcd-name">${esc(item.name)}</span>
      <span class="hcd-days" style="color:${col}">${dayNum}</span>
      <span class="hcd-unit">${unit}</span>
    </div>`;
  }).join('');
}

// 渲染設定頁的考試倒數區塊
function renderSetCountdown(){
  const el=document.getElementById('set-countdown');
  if(!el)return;
  const list=_loadCountdowns().sort((a,b)=>new Date(a.date)-new Date(b.date));
  if(!list.length){
    el.innerHTML='<div style="color:var(--t2);font-size:13px;padding:4px 0 2px">尚未新增考試</div>';
    return;
  }
  el.innerHTML=list.map(item=>{
    const days=_daysUntil(item.date);
    const isPast=days<0;
    const isToday=days===0;
    const col=isPast?'var(--t2)':isToday?'var(--red)':days<=7?'var(--org)':'var(--acc)';
    const bg=isPast?'var(--bg2)':isToday?'rgba(248,81,73,0.10)':days<=7?'rgba(227,179,65,0.10)':'rgba(88,166,255,0.08)';
    const label=isPast?`已過 ${Math.abs(days)} 天`:isToday?'就是今天！':`還有 ${days} 天`;
    const icon=isPast?'📋':isToday?'🎯':days<=7?'🔥':'📅';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="width:34px;height:34px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--t0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:2px">${item.date} · <span style="color:${col};font-weight:600">${label}</span></div>
      </div>
      <button onclick="delCountdownSet('${item.id}')" style="background:none;border:none;color:var(--t2);font-size:18px;cursor:pointer;padding:4px 2px;flex-shrink:0;opacity:.7" title="刪除">×</button>
    </div>`;
  }).join('');
}

function delCountdownSet(id){
  const list=_loadCountdowns().filter(i=>i.id!==id);
  _saveCountdowns(list);
  renderCountdown();      // 更新首頁
  renderSetCountdown();   // 更新設定頁
  toast('已刪除');
}

// 新增考試 bottom sheet
function openCountdownMgr(){
  const existing=document.getElementById('countdown-add-modal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='countdown-add-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML=`
    <div onclick="event.stopPropagation()" style="width:100%;max-width:520px;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 18px 36px;animation:sup .23s cubic-bezier(.4,0,.2,1)">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 18px"></div>
      <div style="font-size:16px;font-weight:700;color:var(--t0);margin-bottom:18px">📅 新增考試倒數</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label class="fl">考試名稱</label>
          <input id="cd-name" placeholder="例：警佐二類升官等考試" autofocus>
        </div>
        <div>
          <label class="fl">考試日期</label>
          <input id="cd-date" type="date" style="color-scheme:dark">
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn bg" style="flex:1;padding:13px" onclick="document.getElementById('countdown-add-modal').remove()">取消</button>
        <button class="btn bp" style="flex:2;padding:13px;font-size:14px" onclick="_saveCountdownFromModal()">＋ 新增</button>
      </div>
    </div>`;
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(()=>document.getElementById('cd-name')?.focus(),300);
}

function _saveCountdownFromModal(){
  const name=(document.getElementById('cd-name')?.value||'').trim();
  const dateStr=(document.getElementById('cd-date')?.value||'').trim();
  if(!name){toast('請填寫考試名稱');return;}
  if(!dateStr){toast('請選擇考試日期');return;}
  const list=_loadCountdowns();
  list.push({id:Date.now().toString(),name,date:dateStr});
  _saveCountdowns(list);
  document.getElementById('countdown-add-modal')?.remove();
  renderCountdown();
  renderSetCountdown();
  toast('已新增「'+name+'」');
}

// 刪除考試
function delCountdown(id){
  const list = _loadCountdowns().filter(i=>i.id!==id);
  _saveCountdowns(list);
  renderCountdown();
}

// ── 勉勵語編輯 ──────────────────────────────────────────────
function editMotto(){
  const el=document.getElementById('h-motto');
  if(!el)return;
  const cur=el.textContent.trim();
  const nv=prompt('輸入你的備考勉勵語：',cur);
  if(nv===null)return;
  const val=nv.trim()||'備考如磨刃，臨陣方知銳';
  el.textContent=val;
  try{ localStorage.setItem('examMotto',val); }catch(e){}
  toast('勉勵語已更新 ✓');
}


// ── 閱覽區子選單（題目閱覽 / 資料閱覽）────────────────────────
let _browsSubOpen = false;
function toggleBrowseSub(){
  _browsSubOpen = !_browsSubOpen;
  const menu  = document.getElementById('browse-sub-menu');
  const arrow = document.getElementById('browse-sub-arrow');
  if(menu)  menu.classList.toggle('open', _browsSubOpen);
  if(arrow) arrow.classList.toggle('open', _browsSubOpen);
}

// ── 資料閱覽 overlay ─────────────────────────────────────────
let _lbCat = 'all';
let _lbAllLaws = [];

async function openLawBrowse(){  try{
  _lbAllLaws = await da('laws');
  _lbCat = 'all';
  // reset chips
  document.querySelectorAll('#lb-cat-chips .chip').forEach(c=>c.classList.remove('on'));
  const first = document.querySelector('#lb-cat-chips .chip');
  if(first) first.classList.add('on');
  const srEl = document.getElementById('lb-search');
  if(srEl) srEl.value = '';
  renderLawBrowse();
  const ov = document.getElementById('law-browse-ov');
  if(ov){ ov.style.display='flex'; }
}catch(e){ logError('openLawBrowse',e); }}

function closeLawBrowse(){
  const ov = document.getElementById('law-browse-ov');
  if(ov) ov.style.display = 'none';
}

function setLBCat(el, cat){
  document.querySelectorAll('#lb-cat-chips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  _lbCat = cat;
  renderLawBrowse();
}

function renderLawBrowse(){
  const kw = (document.getElementById('lb-search')?.value||'').toLowerCase().trim();
  let fl = _lbAllLaws.filter(l=>{
    if(_lbCat!=='all' && l.category!==_lbCat) return false;
    if(kw){
      const h = ((l.lawName||'')+(l.article||'')+(l.content||'')+(l.keywords||[]).join(' ')+(l.title||'')).toLowerCase();
      return h.includes(kw);
    }
    return true;
  }).sort((a,b)=>{
    if((a.lawName||'') < (b.lawName||'')) return -1;
    if((a.lawName||'') > (b.lawName||'')) return 1;
    return (a.articleNumber||0)-(b.articleNumber||0);
  });
  const el = document.getElementById('lb-list');
  if(!el) return;
  if(!fl.length){
    el.innerHTML='<div class="empty"><span class="ic">📂</span><span>查無資料</span></div>';
    return;
  }
  el.innerHTML = fl.map(l=>{
    const isImg = l.content && l.content.startsWith('data:image');
    const preview = isImg ? '🖼 圖片內容' : _hl((l.content||'').slice(0,80),kw);
    const kwTags=(l.keywords||[]).length
      ?'<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">'
        +(l.keywords||[]).map(k=>'<span class="tag" style="color:var(--pur);font-size:10px">'+_hl(k,kw)+'</span>').join('')
        +'</div>':'';
    return `<div class="card" style="margin:5px 12px;cursor:pointer" onclick="openLawGroup('${esc(l.lawName||'')}')">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;flex-wrap:wrap">
        <span class="tag" style="color:var(--pur)">${_hl(l.lawName||'未命名',kw)}</span>
        ${l.article?`<span class="tag">${_hl(l.article,kw)}</span>`:''}
        ${l.title?`<span class="tag">${_hl(l.title,kw)}</span>`:''}
        <span class="tag">${l.category==='statute'?'法規':l.category==='sop'?'SOP':l.category==='supplement'?'補充':l.category==='interpretation'?'函釋':'其他'}</span>
      </div>
      <div style="font-size:12px;color:var(--t2);line-height:1.6">${preview}${!isImg&&(l.content||'').length>80?'…':''}</div>
      ${kwTags}
    </div>`;
  }).join('');
}
const _debouncedLawBrowseSearch = debounce(renderLawBrowse, 200);

// ── 首頁兩大區塊展開/收合 ────────────────────────────────────
window._activeZone = null;  // 'exam' | 'study' | null
let _zoneQuizOpen = false;

function toggleZone(zone){
  const examCard  = document.getElementById('zone-exam');
  const studyCard = document.getElementById('zone-study');
  const examPanel = document.getElementById('panel-exam');
  const studyPanel= document.getElementById('panel-study');

  if(window._activeZone === zone){
    // 同區再點 → 收合
    window._activeZone = null;
    [examCard,studyCard].forEach(c=>{
      c.classList.remove('zone-active','zone-shrink');
    });
    [examPanel,studyPanel].forEach(p=>p.classList.remove('open'));
    if(zone==='exam') _closeZoneQuiz();
  } else {
    window._activeZone = zone;
    const isExam = zone==='exam';
    // 目標區：放大
    (isExam?examCard:studyCard).classList.add('zone-active');
    (isExam?examCard:studyCard).classList.remove('zone-shrink');
    // 另一區：縮小
    (isExam?studyCard:examCard).classList.add('zone-shrink');
    (isExam?studyCard:examCard).classList.remove('zone-active');
    // 面板
    (isExam?examPanel:studyPanel).classList.add('open');
    (isExam?studyPanel:examPanel).classList.remove('open');
    if(!isExam) _closeZoneQuiz();
  }
}

function toggleZoneQuiz(){
  _zoneQuizOpen=!_zoneQuizOpen;
  const menu=document.getElementById('zone-quiz-menu');
  const arrow=document.getElementById('zone-quiz-arrow');
  if(menu)  menu.classList.toggle('open',_zoneQuizOpen);
  if(arrow) arrow.classList.toggle('open',_zoneQuizOpen);
}

function _closeZoneQuiz(){
  _zoneQuizOpen=false;
  const menu=document.getElementById('zone-quiz-menu');
  const arrow=document.getElementById('zone-quiz-arrow');
  if(menu)  menu.classList.remove('open');
  if(arrow) arrow.classList.remove('open');
}

