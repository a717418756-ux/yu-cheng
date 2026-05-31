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
  const [qs, ls, ats, cds] = await Promise.all([
    da('questions'), da('laws'), da('attempts'), da('countdowns')
  ]);
  const motto  = await getSetting('examMotto','');
  const payload = {
    password: pwd,
    action:   'backup',
    filename: GAS_BACKUP_FILE,
    data: JSON.stringify({ questions:qs, laws:ls, attempts:ats, countdowns:cds, motto })
  };
  const res  = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if(json.ok){ toast('已備份到 Google Drive ✓'); }
  else{ toast('備份失敗：'+(json.error||'未知錯誤')); }
}catch(e){ logError('gdriveBackup',e); toast('備份失敗：'+e.message); }}

// ── 還原 ────────────────────────────────────────────────────
async function gdriveRestore(){ try{
  const { url, pwd } = await _gasGetConfig();
  if(!url){ toast('請先在設定頁填入 Apps Script 網址'); return; }
  cfm('從雲端還原','現有資料將被覆蓋，確定繼續？', async()=>{
    toast('還原中…');
    const res  = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password:pwd, action:'restore', filename:GAS_BACKUP_FILE })
    });
    const json = await res.json();
    if(!json.ok){ toast('還原失敗：'+(json.error||'未知錯誤')); return; }
    const bk = JSON.parse(json.data);
    await dc('questions'); await dc('laws'); await dc('attempts'); await dc('countdowns');
    if(bk.questions?.length) await bulkPut('questions', bk.questions);
    if(bk.laws?.length)      await bulkPut('laws',      bk.laws);
    if(bk.attempts?.length)  await bulkPut('attempts',  bk.attempts);
    if(bk.countdowns?.length)await bulkPut('countdowns',bk.countdowns);
    if(bk.motto) await setSetting('examMotto', bk.motto);
    _cacheInvalidate();
    toast('還原完成，重新整理頁面中…');
    setTimeout(()=>location.reload(), 1200);
  });
}catch(e){ logError('gdriveRestore',e); toast('還原失敗：'+e.message); }}


async function renderSet(){  try{
  const[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  document.getElementById('exp-info').textContent=`${qs.length} 題 · ${ls.length} 條法條 · ${ats.length} 筆作答`;
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
  document.getElementById('db-info').innerHTML=`總題數：${qs.length}<br>法條數：${ls.length}<br>作答記錄：${ats.length}<br>科目：${subs.join('、')||'無'}<br>題型：選擇 ${qs.filter(q=>q.type==='mc').length} / 申論 ${qs.filter(q=>q.type==='es').length}`;
  renderSetCountdown();
  _gasLoadSavedConfig();
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
  el.style.display = el.style.display === 'none' ? '' : 'none';
}
