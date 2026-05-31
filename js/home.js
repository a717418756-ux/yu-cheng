// ══ nav.js — 導覽與初始化 ══════════════════════════════
// 依賴：全部模組

// ── FAB 導覽 ─────────────────────────────────────────────────
// ── 加號下拉選單（題目管理）──────────────────────────────────
function toggleAddQMenu(){
  const m=document.getElementById('add-q-menu');
  const open=m.style.display==='none';
  m.style.display=open?'block':'none';
  if(open) setTimeout(()=>document.addEventListener('click',_closeAddQOutside,{once:true}),0);
}
function closeAddQMenu(){ document.getElementById('add-q-menu').style.display='none'; }
function _closeAddQOutside(e){
  const wrap=document.getElementById('add-q-wrap');
  if(wrap&&!wrap.contains(e.target)) closeAddQMenu();
}

// ── 加號下拉選單（資料庫）────────────────────────────────────
function toggleAddLawMenu(){
  const m=document.getElementById('add-law-menu');
  const open=m.style.display==='none';
  m.style.display=open?'block':'none';
  if(open) setTimeout(()=>document.addEventListener('click',_closeAddLawOutside,{once:true}),0);
}
function closeAddLawMenu(){ document.getElementById('add-law-menu').style.display='none'; }
function _closeAddLawOutside(e){
  const wrap=document.getElementById('add-law-wrap');
  if(wrap&&!wrap.contains(e.target)) closeAddLawMenu();
}

let _fabOpen=false;

// ── FAB 項目定義 ──────────────────────────────────────────────
const _F_HOME  = {pg:'home',  icon:'🏠', label:'首頁'};
const _F_LIST  = {pg:'list',  icon:'📚', label:'題目管理'};
const _F_DB    = {pg:'db',    icon:'🗄',  label:'資料庫'};
const _F_SET   = {pg:'set',   icon:'⚙️', label:'設定'};
const _F_STATS = {pg:'stats', icon:'📊', label:'分析'};

// ── FAB 規則：
// home（無選擇）→ 只有設定
// home（考試區展開）→ 題目管理、資料庫、設定
// home（學習區展開）→ 只有設定
// list  → 首頁、資料庫、設定
// db    → 首頁、題目管理、設定
// stats → 首頁、題目管理、資料庫、設定
// set   → 只有首頁
// bulk  → 首頁、設定
// 其餘  → 首頁、設定

function _fabItemsForPage(pg){
  switch(pg){
    case 'home':
      if(window._activeZone==='exam')  return [_F_LIST,_F_DB,_F_SET];
      if(window._activeZone==='study') return [_F_SET];
      return [_F_SET];           // 無選擇
    case 'list':   return [_F_HOME,_F_DB,_F_SET];
    case 'db':     return [_F_HOME,_F_LIST,_F_SET];
    case 'stats':  return [_F_HOME,_F_LIST,_F_DB,_F_SET];
    case 'set':    return [_F_HOME];
    case 'bulk':   return [_F_HOME,_F_SET];
    default:       return [_F_HOME,_F_SET];
  }
}

function _buildFabItems(curPg){
  const container=document.getElementById('fab-items');
  if(!container)return;
  const items=_fabItemsForPage(curPg);
  container.innerHTML=items.map((it,i)=>`
    <div class="fab-item" style="transition-delay:${i*35}ms">
      <span class="fab-label">${it.label}</span>
      <button class="fab-btn" onclick="fabGo('${it.pg}')">${it.icon}</button>
    </div>`).join('');
}

function toggleFab(){
  _fabOpen=!_fabOpen;
  const main=document.getElementById('fab-main');
  const overlay=document.getElementById('fab-overlay');
  main.classList.toggle('open',_fabOpen);
  overlay.classList.toggle('open',_fabOpen);
  if(_fabOpen){
    _buildFabItems(S.page||'home');
    requestAnimationFrame(()=>{
      document.querySelectorAll('#fab-items .fab-item').forEach((el,i)=>{
        setTimeout(()=>el.classList.add('vis'),i*35);
      });
    });
  } else {
    document.querySelectorAll('#fab-items .fab-item').forEach(el=>el.classList.remove('vis'));
  }
}

function closeFab(){
  if(!_fabOpen)return;
  _fabOpen=false;
  document.getElementById('fab-main').classList.remove('open');
  document.getElementById('fab-overlay').classList.remove('open');
  document.querySelectorAll('#fab-items .fab-item').forEach(el=>el.classList.remove('vis'));
}

function fabGo(pg){
  closeFab();
  goPage(pg,null);
}

function goPage(pg,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hide'));
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('on'));
  const el=document.getElementById('pg-'+pg);if(el)el.classList.remove('hide');
  if(btn)btn.classList.add('on');
  S.page=pg;
  ({
    home:renderHome,
    list:renderList,
    laws:renderDB,
    db:renderDB,
    stats:renderStats,
    set:renderSet,
    bulk:()=>{}
  })[pg]?.();
}


const _splashStart=Date.now();
async function init(){  try{
  await initDB();
  buildOpts({});
  goPage('home',document.querySelector('.nb'));
  }catch(e){
    logError('init',e);
    // 顯示錯誤提示但不讓畫面全黑，仍顯示 FAB
    const errDiv=document.createElement('div');
    errDiv.style.cssText='position:fixed;top:60px;left:0;right:0;margin:12px;background:#2a1010;border:1px solid var(--red);border-radius:10px;padding:14px;font-size:13px;color:#e05c57;z-index:9999;line-height:1.7';
    errDiv.innerHTML='⚠ 資料庫初始化失敗<br><span style="font-size:11px;color:#888">'+String(e.message||e)+'</span><br><button onclick="location.reload()" style="margin-top:8px;padding:6px 14px;background:#3a1212;border:1px solid #e05c57;color:#e05c57;border-radius:6px;cursor:pointer;font-size:12px">重新載入</button>';
    document.body.appendChild(errDiv);
    // 仍嘗試顯示首頁框架
    try{ goPage('home',null); }catch(_){}
    // 即使出錯也要關閉 splash
    if(typeof window._splashDismiss==='function')window._splashDismiss();
  }
}
init().then(()=>{
  // 填入版本號
  const verEl=document.getElementById('app-ver');
  if(verEl) verEl.textContent=typeof APP_VER!=='undefined'?APP_VER:'';
  // 關閉載入畫面（至少顯示 2.6 秒讓動畫完整播完）
  const elapsed=Date.now()-_splashStart;
  const wait=Math.max(0,2600-elapsed);
  setTimeout(()=>{if(typeof window._splashDismiss==='function')window._splashDismiss();},wait);
});
