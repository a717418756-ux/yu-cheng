// ── 閱覽區子選單（題目閱覽 / 資料閱覽）────────────────────────



function _setHomeWidgets(show, zone){
  const dataBar = document.getElementById('h-data-bar');
  const heatmap = document.getElementById('heatmap-wrap');
  if(!dataBar || !heatmap) return;
  if(show){
    // 無區展開：只顯示熱力圖，數據橫條屬於考試區不顯示
    dataBar.style.display = 'none';
    heatmap.style.display = '';
  } else {
    // 有區展開：熱力圖隱藏
    heatmap.style.display = 'none';
    // 數據橫條只在考試區顯示
    dataBar.style.display = (zone === 'exam') ? '' : 'none';
  }
}

// ── 區域計時：記錄每個區域的使用時間 ──────────────────────
let _zoneTimer = null;
let _zoneTick  = 0;

function _startZoneTimer(zone){
  _stopZoneTimer();
  _zoneTick = Date.now();
  _zoneTimer = setInterval(()=>{
    // 每60秒寫入一次，避免過於頻繁寫 DB
    const elapsed = Math.round((Date.now() - _zoneTick) / 1000);
    if(elapsed >= 60){
      logZoneUsage(zone, elapsed).catch(()=>{});
      _zoneTick = Date.now();
    }
  }, 10000); // 每10秒檢查一次
}

function _stopZoneTimer(){
  if(_zoneTimer){ clearInterval(_zoneTimer); _zoneTimer=null; }
  if(_zoneTick > 0 && window._activeZone){
    const elapsed = Math.round((Date.now() - _zoneTick) / 1000);
    if(elapsed >= 3) logZoneUsage(window._activeZone, elapsed).catch(()=>{});
    _zoneTick = 0;
  }
}

function toggleZone(zone){
  const cards  = ['exam','leisure','study'].map(z=>document.getElementById('zone-'+z));
  const panels = ['exam','leisure','study'].map(z=>document.getElementById('panel-'+z));
  const zones  = ['exam','leisure','study'];

  if(window._activeZone === zone){
    // 同區再點 → 全部收合，停止計時
    _stopZoneTimer();
    window._activeZone = null;
    cards.forEach(c=>c.classList.remove('zone-active','zone-shrink'));
    panels.forEach(p=>p.classList.remove('open'));
    if(zone==='exam') _closeZoneQuiz();
    // 收合：顯示數據橫條 + 熱力圖
    _setHomeWidgets(true);
  } else {
    // 切換到新區：停止舊區計時，開始新區計時
    _stopZoneTimer();
    window._activeZone = zone;
    _startZoneTimer(zone);
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
    // 展開：隱藏數據橫條 + 熱力圖（考試區顯示考試數據橫條）
    _setHomeWidgets(false, zone);
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
const _F_SET   = {pg:'set',   icon:'⚙️', label:'設定'};
const _F_STATS = {pg:'stats', icon:'📊', label:'分析'};

// ── FAB 規則（題庫/資料庫已移至主選單，FAB 只保留導航和設定）──定
// 其餘  → 首頁、設定

function _fabItemsForPage(pg){
  switch(pg){
    case 'home':   return [_F_SET];
    case 'list':   return [_F_HOME,_F_SET];
    case 'db':     return [_F_HOME,_F_SET];
    case 'stats':  return [_F_HOME,_F_SET];
    case 'set':    return [_F_HOME];
    case 'bulk':   return [_F_HOME,_F_SET];
    case 'leisure':return [_F_HOME,_F_SET];
    case 'books':  return [_F_HOME,_F_SET];
    case 'media':  return [_F_HOME,_F_SET];
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
    home:()=>{ _setHomeWidgets(true); renderHome(); },
    list:renderList,
    laws:renderDB,
    db:renderDB,
    stats:renderStats,
    set:renderSet,
    books:renderBooks,
    media:renderMedia,
  })[pg]?.();
}


// 頁面背景/關閉時停止計時
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) _stopZoneTimer();
  else if(window._activeZone) _startZoneTimer(window._activeZone);
});

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



