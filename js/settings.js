// ══ settings.js — 設定與匯出 ══════════════════════════
// 依賴：db.js, utils.js


// ══════════════════════════════════════════════════════════════
// Google Drive 雲端同步
// Client ID 由使用者在設定頁輸入，存於 IndexedDB settings store
// ══════════════════════════════════════════════════════════════
const GDRIVE_SCOPES      = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_BACKUP_FILE = '警察考題庫_backup.json';
const GDRIVE_CID_KEY     = 'gdriveClientId';

// 讀取 Client ID
async function getGDriveClientId(){
  return (await getSetting(GDRIVE_CID_KEY, '')).trim();
}

let _gToken = null;   // access token

// ── Client ID 輸入欄位操作 ────────────────────────────────────
function gdriveClientIdChanged(){
  // 即時存入（每次輸入都先暫存，按儲存才正式存）
}
async function saveClientId(){
  const val=(document.getElementById('gdrive-client-id-input')?.value||'').trim();
  if(!val){ toast('請輸入 Client ID'); return; }
  await setSetting(GDRIVE_CID_KEY, val);
  toast('Client ID 已儲存 ✓');
  // 如果已有 token，重設（可能換了 ID）
  if(_gToken){ gdriveLogout(); }
}
function toggleClientIdHelp(){
  const el=document.getElementById('gdrive-client-id-help');
  if(el) el.style.display=el.style.display==='none'?'':'none';
}
// 載入已儲存的 Client ID 到輸入框
async function _gdriveLoadSavedId(){
  const saved=await getGDriveClientId();
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
  const cid=await getGDriveClientId();
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

