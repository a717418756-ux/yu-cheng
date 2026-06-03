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
  const cards  = ['exam','leisure','study'].map(z=>document.getElementById('zone-'+z));
  const panels = ['exam','leisure','study'].map(z=>document.getElementById('panel-'+z));
  const zones  = ['exam','leisure','study'];

  if(window._activeZone === zone){
    // 同區再點 → 全部收合
    window._activeZone = null;
    cards.forEach(c=>c.classList.remove('zone-active','zone-shrink'));
    panels.forEach(p=>p.classList.remove('open'));
    if(zone==='exam') _closeZoneQuiz();
  } else {
    window._activeZone = zone;
    const idx = zones.indexOf(zone);
    cards.forEach((c,i)=>{
      c.classList.remove('zone-active','zone-shrink');
      if(i===idx) c.classList.add('zone-active');
      else        c.classList.add('zone-shrink');
    });
    panels.forEach((p,i)=>{
      if(i===idx) p.classList.add('open');
      else        p.classList.remove('open');
    });
    if(zone!=='exam') _closeZoneQuiz();
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
const _F_DB    = {pg:'db',    icon:'🗃',  label:'資料庫'};
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
      if(window._activeZone==='leisure') return [_F_SET];
      if(window._activeZone==='study') return [_F_SET];
      return [_F_SET];           // 無選擇
    case 'list':   return [_F_HOME,_F_DB,_F_SET];
    case 'db':     return [_F_HOME,_F_LIST,_F_SET];
    case 'stats':  return [_F_HOME,_F_LIST,_F_DB,_F_SET];
    case 'set':    return [_F_HOME];
    case 'bulk':   return [_F_HOME,_F_SET];
    case 'leisure':return [_F_HOME,_F_SET];
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
    const container=document.getElementById('fab-items');
    if(container){
      document.querySelectorAll('#fab-items .fab-item').forEach(el=>el.classList.remove('vis'));
      const isEink=document.documentElement.getAttribute('data-theme')==='eink';
      setTimeout(()=>{ if(container) container.innerHTML=''; }, isEink?0:260);
    }
  }
}

function closeFab(){
  if(!_fabOpen)return;
  _fabOpen=false;
  document.getElementById('fab-main').classList.remove('open');
  document.getElementById('fab-overlay').classList.remove('open');
  const container=document.getElementById('fab-items');
  if(container){
    document.querySelectorAll('#fab-items .fab-item').forEach(el=>el.classList.remove('vis'));
    // 動畫結束後清空，避免佔空間（電子紙模式直接清）
    const isEink=document.documentElement.getAttribute('data-theme')==='eink';
    setTimeout(()=>{ if(container) container.innerHTML=''; }, isEink?0:260);
  }
}

function fabGo(pg){
  closeFab();
  goPage(pg,null);
}

function goPage(pg,btn){
  // bulk 是 overlay，不跳頁，直接開啟後返回
  if(pg==='bulk'){ openBulkQ(); return; }
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
  })[pg]?.();
}


const _splashStart=Date.now();

/* ══════════════════════════════════════════════════════════════
   主題系統（兩模式：dark / eink）
   儲存於 IndexedDB settings store，key: 'displayTheme'
   ══════════════════════════════════════════════════════════════ */

async function initTheme(){
  const saved = await getSetting('displayTheme', 'dark');
  _applyTheme(saved);
}

async function setTheme(theme){
  _applyTheme(theme);
  await setSetting('displayTheme', theme);
}

function _applyTheme(theme){
  const t = (theme === 'eink') ? 'eink' : 'dark';
  document.documentElement.setAttribute('data-theme', t === 'dark' ? '' : t);
  try{ localStorage.setItem('_themeCache', t); }catch(e){}
  ['dark','eink'].forEach(th => {
    const btn = document.getElementById(`theme-btn-${th}`);
    if(btn) btn.classList.toggle('active', th === t);
  });
}
async function init(){  try{
  await initDB();
  await initTheme();
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
  // 填入版本號（雙版本）
  const verEl = document.getElementById('app-ver');
  if(verEl){
    const av = typeof APP_VERSION  !== 'undefined' ? APP_VERSION  : '';
    const dv = typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '';
    verEl.innerHTML = `v${av} <span style="color:var(--t2);font-size:10px">題庫 ${dv}</span>`;
  }
  // 關閉載入畫面（至少顯示 2.6 秒讓動畫完整播完）
  const elapsed = Date.now() - _splashStart;
  const wait = Math.max(0, 2600 - elapsed);
  setTimeout(()=>{ if(typeof window._splashDismiss==='function') window._splashDismiss(); }, wait);
});

/* ── Service Worker 更新偵測 ── */
if('serviceWorker' in navigator){
  navigator.serviceWorker.ready.then(reg => {
    // 定期檢查更新（每 30 分鐘）
    setInterval(()=> reg.update(), 30 * 60 * 1000);
    // 偵測到新 SW 進入 waiting
    reg.addEventListener('updatefound', ()=>{
      const newWorker = reg.installing;
      if(!newWorker) return;
      newWorker.addEventListener('statechange', ()=>{
        if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
          _showUpdateBanner(reg);
        }
      });
    });
  });
  // 新 SW 接管後自動 reload
  let _swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(!_swRefreshing){ _swRefreshing = true; location.reload(); }
  });
}

function _showUpdateBanner(reg){
  if(document.getElementById('sw-update-banner')) return;
  const av = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '';
  const banner = document.createElement('div');
  banner.id = 'sw-update-banner';
  banner.innerHTML = `
    <div style="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
      z-index:8000;background:var(--bg1);border:1px solid var(--acc);
      border-radius:14px;padding:14px 18px;min-width:260px;max-width:90vw;
      box-shadow:0 4px 24px rgba(0,0,0,.5);text-align:center">
      <div style="font-size:13px;font-weight:700;color:var(--acc);margin-bottom:4px">🔄 發現新版本</div>
      <div style="font-size:11px;color:var(--t2);margin-bottom:12px">點擊更新載入最新版，題庫資料完全保留</div>
      <div style="display:flex;gap:8px;justify-content:center">
        <button onclick="document.getElementById('sw-update-banner').remove()"
          style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--t2);
          background:transparent;color:var(--t2);font-size:12px;cursor:pointer">稍後</button>
        <button id="sw-update-btn"
          style="flex:1;padding:8px;border-radius:8px;border:none;
          background:var(--acc);color:#fff;font-size:12px;font-weight:700;cursor:pointer">立即更新</button>
      </div>
    </div>`;
  document.body.appendChild(banner);
  document.getElementById('sw-update-btn').addEventListener('click', ()=>{
    if(reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    banner.remove();
  });
}



