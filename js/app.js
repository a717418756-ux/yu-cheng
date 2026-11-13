// ══ app.js — 導覽、區域系統、主題、初始化、SW 更新 ══════════
// 依賴：全部模組
//
// v2.8.2 重構：
// - IIFE 模組化，僅輸出公開 API（App.* 與相容別名）
// - FAB 項目、更新橫幅改事件委派（不再產生 inline onclick 字串）
// - _activeZone 改為模組私有變數
// - 功能與 v2.8.1 完全相同

(function(){
'use strict';

// ── 首頁小工具顯示控制 ─────────────────────────────────────
// ════════════════════════════════════════════════════════════
// 【首頁總覽元件顯示控制】
// ════════════════════════════════════════════════════════════
function _setHomeWidgets(show, zone){
  const dataBar = document.getElementById('h-data-bar');
  const heatmap = document.getElementById('heatmap-wrap');
  const dtask   = document.getElementById('dtask-wrap');
  const plan    = document.getElementById('plan-wrap');
  const cta     = document.getElementById('h-cta');
  if(cta) cta.style.display = show ? '' : 'none';   // 展開某一區時收起主要操作，區內選項緊接在三區下方
  if(!dataBar || !heatmap) return;
  if(show){
    dataBar.style.display = 'none';
    heatmap.style.display = '';
    if(dtask) dtask.style.display = '';
    if(plan) plan.style.display = '';
  } else {
    heatmap.style.display = 'none';
    if(dtask) dtask.style.display = 'none';
    if(plan) plan.style.display = 'none';
    dataBar.style.display = (zone === 'exam') ? '' : 'none';
  }
}

// ── 區域計時：記錄每個區域的使用時間 ──────────────────────
let _zoneTimer = null;
let _zoneTick  = 0;
let _zoneQuizOpen = false;
let _activeZone = null;

// ════════════════════════════════════════════════════════════
// 【區域使用計時】
// ════════════════════════════════════════════════════════════
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
  if(_zoneTick > 0 && _activeZone){
    const elapsed = Math.round((Date.now() - _zoneTick) / 1000);
    if(elapsed >= 3) logZoneUsage(_activeZone, elapsed).catch(()=>{});
    _zoneTick = 0;
  }
}

// ════════════════════════════════════════════════════════════
// 【三大區塊展開/收合】
// ════════════════════════════════════════════════════════════
function toggleZone(zone){
  const zones  = ['exam','leisure','study'];
  const cards  = zones.map(z=>document.getElementById('zone-'+z));
  const panels = zones.map(z=>document.getElementById('panel-'+z));

  if(_activeZone === zone){
    // 同區再點 → 全部收合，停止計時
    _stopZoneTimer();
    _activeZone = null;
    cards.forEach(c=>c.classList.remove('zone-active','zone-shrink'));
    panels.forEach(p=>p.classList.remove('open'));
    if(zone==='exam') _closeZoneQuiz();
    // 收合：顯示數據橫條 + 熱力圖
    _setHomeWidgets(true);
  } else {
    // 切換到新區：停止舊區計時，開始新區計時
    _stopZoneTimer();
    _activeZone = zone;
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
  _syncNav();
}

function toggleZoneQuiz(){
  _zoneQuizOpen = !_zoneQuizOpen;
  const menu  = document.getElementById('zone-quiz-menu');
  const arrow = document.getElementById('zone-quiz-arrow');
  if(menu)  menu.classList.toggle('open', _zoneQuizOpen);
  if(arrow) arrow.classList.toggle('open', _zoneQuizOpen);
  _syncNav();
}

function _closeZoneQuiz(){
  _zoneQuizOpen = false;
  const menu  = document.getElementById('zone-quiz-menu');
  const arrow = document.getElementById('zone-quiz-arrow');
  if(menu)  menu.classList.remove('open');
  if(arrow) arrow.classList.remove('open');
}

// ── 加號下拉選單（題目管理）──────────────────────────────────
// ════════════════════════════════════════════════════════════
// 【新增選單（題目/法規）】
// ════════════════════════════════════════════════════════════
function toggleAddQMenu(){
  const m = document.getElementById('add-q-menu');
  const open = m.style.display==='none';
  m.style.display = open ? 'block' : 'none';
  if(open) setTimeout(()=>document.addEventListener('click', _closeAddQOutside, {once:true}), 0);
}
function closeAddQMenu(){ document.getElementById('add-q-menu').style.display='none'; }
function _closeAddQOutside(e){
  const wrap = document.getElementById('add-q-wrap');
  if(wrap && !wrap.contains(e.target)) closeAddQMenu();
}

// ── 加號下拉選單（資料庫）────────────────────────────────────
function toggleAddLawMenu(){
  const m = document.getElementById('add-law-menu');
  const open = m.style.display==='none';
  m.style.display = open ? 'block' : 'none';
  if(open) setTimeout(()=>document.addEventListener('click', _closeAddLawOutside, {once:true}), 0);
}
function closeAddLawMenu(){ document.getElementById('add-law-menu').style.display='none'; }
function _closeAddLawOutside(e){
  const wrap = document.getElementById('add-law-wrap');
  if(wrap && !wrap.contains(e.target)) closeAddLawMenu();
}

// ── FAB 導覽 ─────────────────────────────────────────────────
let _fabOpen = false;

// v4.38：改為底部導覽列（首頁／測驗／題庫／資料庫／更多）。原本的圓形選單鈕隱藏，
//   它的彈出清單改由「更多」開啟，列出導覽列上沒有的考試區頁面與設定
const _F_MORE = [
  {pg:'memory',  icon:'🧠', label:'記憶庫'},
  {pg:'predict', icon:'📈', label:'考古題排名'},
  {pg:'stats',   icon:'📊', label:'分析'},
  {pg:'set',     icon:'⚙️', label:'設定'},
];
// ════════════════════════════════════════════════════════════
// 【浮動按鈕（FAB）】
// ════════════════════════════════════════════════════════════
function _fabItemsForPage(pg){
  return _F_MORE.filter(it => it.pg !== pg);
}

// v4.39：導覽列跟著「區」變。首頁三區都沒選時只留「設定」；選了某一區（或進到該區的頁面）
//   就換成該區的選項。設定頁等不屬於任何區的頁面，沿用剛才那一區的導覽列
const _SVG = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const _NAV_ICON = {
  home:  '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  quiz:  '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  list:  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  db:    '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7 2 14a3 3 0 0 0 6 0Z"/><path d="m19 7-3 7a3 3 0 0 0 6 0Z"/><path d="M8 21h8"/>',
  more:  '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  set:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  books: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2Z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7Z"/>',
  media: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
  english:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  fitness:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
};
const _NAV_SETS = {
  none:    [['set','設定']],
  exam:    [['home','首頁'],['quiz','測驗'],['list','題庫'],['db','資料庫'],['more','更多']],
  leisure: [['home','首頁'],['books','書庫'],['media','影音庫'],['set','設定']],
  study:   [['home','首頁'],['english','英語'],['fitness','運動'],['set','設定']],
};
// 頁面屬於哪一區（沒列出的頁面，例如設定，沿用目前那一區）
const _PAGE_ZONE = { list:'exam', db:'exam', laws:'exam', memory:'exam', predict:'exam', stats:'exam',
                     books:'leisure', media:'leisure', english:'study', fitness:'study' };
let _navZone = null;     // 導覽列目前顯示哪一區
let _navBuilt = '';

function _navClick(key){
  if(key === 'quiz') return navQuiz();
  if(key === 'more') return toggleFab();
  closeFab();
  if(key === 'home'){
    // 首頁：已在首頁就收回三區；在該區的頁面就回首頁並展開這一區
    const z = _navZone, away = S.page !== 'home';
    goPage('home', null);
    if(away && z) toggleZone(z);
    return;
  }
  goPage(key, null);
}

function _buildNav(zone){
  const id = zone || 'none';
  if(_navBuilt === id) return;
  const nav = document.getElementById('nav');
  if(!nav) return;
  nav.innerHTML = _NAV_SETS[id].map(([k,label]) =>
    `<button class="nb" data-nav="${k}"${k==='more' ? ' id="nav-more" aria-label="更多功能"' : ''} onclick="_navClick('${k}')">${_SVG(_NAV_ICON[k])}<span>${label}</span></button>`
  ).join('');
  nav.classList.toggle('nav-single', id === 'none');
  _navBuilt = id;
}

// 導覽列：先決定顯示哪一區的選項，再決定亮哪一格
function _syncNav(){
  const pg = S.page || 'home';
  if(pg === 'home') _navZone = _activeZone;
  else if(_PAGE_ZONE[pg]) _navZone = _PAGE_ZONE[pg];
  _buildNav(_navZone);
  let key;
  if(pg === 'home') key = (_activeZone === 'exam' && _zoneQuizOpen) ? 'quiz' : 'home';
  else if(_navZone === 'exam') key = ({ list:'list', db:'db', laws:'db', set:'more' })[pg] || 'more';
  else key = pg;
  document.querySelectorAll('.nb').forEach(b => {
    const on = b.dataset.nav === key;
    b.classList.toggle('on', on);
    if(on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

// 「測驗」：回首頁並直接展開考試區的測驗專區（今日複習、加強複習、模擬考…）
function navQuiz(){
  closeFab();
  if(S.page !== 'home') goPage('home', null);
  if(_activeZone !== 'exam') toggleZone('exam');
  if(!_zoneQuizOpen) toggleZoneQuiz();
  _syncNav();
  setTimeout(() => document.getElementById('zone-quiz-menu')?.scrollIntoView({ block:'nearest', behavior:'smooth' }), 120);
}

function _buildFabItems(curPg){
  const container = document.getElementById('fab-items');
  if(!container) return;
  const items = _fabItemsForPage(curPg);
  container.innerHTML = items.map((it,i)=>`
    <div class="fab-item" style="transition-delay:${i*35}ms">
      <span class="fab-label">${it.label}</span>
      <button class="fab-btn" data-pg="${it.pg}">${it.icon}</button>
    </div>`).join('');
}

// FAB 項目點擊：事件委派（容器只綁一次）
function _initFabDelegation(){
  const container = document.getElementById('fab-items');
  if(!container || container._fabBound) return;
  container._fabBound = true;
  container.addEventListener('click', e=>{
    const btn = e.target.closest('.fab-btn');
    if(btn && btn.dataset.pg) fabGo(btn.dataset.pg);
  });
}

function toggleFab(){
  _fabOpen = !_fabOpen;
  const main    = document.getElementById('fab-main');
  const overlay = document.getElementById('fab-overlay');
  main.classList.toggle('open', _fabOpen);
  overlay.classList.toggle('open', _fabOpen);
  document.getElementById('nav-more')?.classList.toggle('open', _fabOpen);
  if(_fabOpen){
    _buildFabItems(S.page||'home');
    requestAnimationFrame(()=>{
      document.querySelectorAll('#fab-items .fab-item').forEach((el,i)=>{
        setTimeout(()=>el.classList.add('vis'), i*35);
      });
    });
  } else {
    _clearFabItems();
  }
}

function closeFab(){
  if(!_fabOpen) return;
  _fabOpen = false;
  document.getElementById('fab-main').classList.remove('open');
  document.getElementById('fab-overlay').classList.remove('open');
  document.getElementById('nav-more')?.classList.remove('open');
  _clearFabItems();
}

function _clearFabItems(){
  const container = document.getElementById('fab-items');
  if(!container) return;
  document.querySelectorAll('#fab-items .fab-item').forEach(el=>el.classList.remove('vis'));
  // 動畫結束後清空，避免佔空間（電子紙模式直接清）
  const isEink = document.documentElement.getAttribute('data-theme')==='eink';
  setTimeout(()=>{ if(container) container.innerHTML=''; }, isEink ? 0 : 260);
}

function fabGo(pg){
  closeFab();
  goPage(pg, null);
}

// ════════════════════════════════════════════════════════════
// 【頁面切換主控】
// ════════════════════════════════════════════════════════════
// JS 動態建立的面板類別（不是 .ov，各模組自己 createElement 後 append 到 body）
const _DYN_SHEETS = '.book-ov-sheet, .book-ov-center, .media-ov-sheet, .ov-sheet-c, .ov-full-col';
let _staticOv = null;   // 頁面載入時就存在的浮層（第一次換頁時記錄，此時尚無動態浮層）
function goPage(pg, btn, fromBack){
  // bulk 是 overlay，不跳頁，直接開啟後返回
  if(pg==='bulk'){ openBulkQ(); return; }
  // 換頁時收掉上一頁殘留的浮層（法條彈窗、底部面板），避免蓋在新頁面上
  const lp = document.getElementById('lawpop-ov');
  if(lp) lp.style.display = 'none';
  //   HTML 內建的只收起；JS 動態建立的（模擬考設定等）直接移除，否則下次開啟會出現重複 id
  _staticOv ||= new Set(document.querySelectorAll('.ov'));
  document.querySelectorAll('.ov.on').forEach(o=>{
    if(_staticOv.has(o)) o.classList.remove('on'); else o.remove();
  });
  document.querySelectorAll(_DYN_SHEETS).forEach(o=>o.remove());
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hide'));
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('on'));
  const el = document.getElementById('pg-'+pg); if(el) el.classList.remove('hide');
  if(btn) btn.classList.add('on');
  S.page = pg;
  // 應用層頁面堆疊：記錄「真正訪問過的頁面順序」，讓返回鍵能逐層回上一頁，
  // 而不是不管訪問了幾層都直接跳回首頁。
  //   fromBack=true 代表這次呼叫本身就是返回鍵觸發的回退，不可再往堆疊推入，
  //   否則會把剛彈出的頁面又推回去，堆疊永遠清不空。
  if(!fromBack && pg !== _pageStack[_pageStack.length-1]){
    _pageStack.push(pg);
    if(_pageStack.length > 30) _pageStack.splice(0, _pageStack.length - 30);  // 防止極端情況無限增長
  }
  ({
    home:()=>{
      // 回首頁：完整收合所有展開區塊，恢復三區未展開狀態
      ['exam','leisure','study'].forEach(z=>{
        document.getElementById('zone-'+z)?.classList.remove('zone-active','zone-shrink');
        document.getElementById('panel-'+z)?.classList.remove('open');
      });
      _stopZoneTimer();
      _activeZone = null;
      _closeZoneQuiz();
      _setHomeWidgets(true);
      renderHome();
    },
    list:renderList,
    laws:renderDB,
    db:renderDB,
    stats:renderStats,
    set:renderSet,
    books:renderBooks,
    media:renderMedia,
    english:renderEnglish,
    fitness:renderFitness,
    memory:renderMemory,
    predict:renderPredict,
    engexam:renderEngExam,
  })[pg]?.();
  _syncNav();
}

// 鍵盤操作：用 role="button" 的非按鈕元素（首頁標籤、數據橫條等）按 Enter／空白鍵也能觸發，與滑鼠點擊一致
document.addEventListener('keydown', e => {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if(!el || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
  if(el.getAttribute?.('role') !== 'button') return;
  e.preventDefault();
  el.click();
});

// 頁面背景/關閉時停止計時
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) _stopZoneTimer();
  else if(_activeZone) _startZoneTimer(_activeZone);
});

const _splashStart = Date.now();

/* ══════════════════════════════════════════════════════════════
   主題系統（兩模式：dark / eink）
   儲存於 IndexedDB settings store，key: 'displayTheme'
   ══════════════════════════════════════════════════════════════ */

// ════════════════════════════════════════════════════════════
// 【主題系統（深色/電子紙）】
// ════════════════════════════════════════════════════════════
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

/* ── 初始化 ── */
// ════════════════════════════════════════════════════════════
// 【App 啟動初始化】
// ════════════════════════════════════════════════════════════
/* ══════════════════════════════════════════════════════════════
   返回鍵處理（讓 PWA 的返回行為接近原生 App）
   原本按返回會直接離開回桌面；改為由上而下逐層關閉：
     彈窗 → 閱讀器/播放器 → 法條檢視 → 答題 → 非首頁回首頁
   已在首頁且無任何層級可關時，才讓返回鍵離開 App。
   作法：啟動時在歷史堆疊墊一筆「緩衝」，返回時攔截 popstate 自行處理，
        處理完再補一筆緩衝，維持可持續攔截。
   ══════════════════════════════════════════════════════════════ */
// 確保歷史堆疊上有一筆「緩衝」可供攔截返回鍵；已有就不重複推入
// 應用層頁面堆疊：紀錄真正訪問過的頁面順序（見 goPage 內的管理邏輯）
let _pageStack = ['home'];

// 返回鍵緩衝改用「預先推入大量筆數」，不再「動態重新推入」。
//   舊做法：每關閉一層就用 setTimeout 延後補回一筆緩衝。
//   問題：這個延遲會產生空窗期——如果系統判斷「沒有更多歷史紀錄」的時機
//         剛好落在這個空窗期內（尤其是原生 Android WebView 對 PWA 的返回鍵
//         處理，會在 popstate 事件之外自行判斷是否要直接關閉 Activity），
//         系統可能繞過我們的 JS 邏輯，直接把整個 App 關掉——不管我們的邏輯
//         想不想關。這正是「有時候連首頁都沒到就直接退出」的成因：不是判斷
//         錯誤，是系統搶先關閉，JS 根本沒機會處理。
// 新做法：一次性預先推入 GUARD_COUNT 筆緩衝。之後每次返回鍵消耗掉的紀錄，
//         全部由瀏覽器原生處理（同步、即時、不需要我們的 JS 介入補回），
//         我們只需要同步判斷「這一層該做什麼」。徹底消除時序風險。
const GUARD_COUNT = 60;   // 正常使用不可能疊這麼多層，足夠用一整個 session

function _pushBackGuard(){
  for(let i = 0; i < GUARD_COUNT; i++){
    try{ history.pushState({ ycGuard: true }, ''); }catch(e){ break; }
  }
}

//   
function _callIf(name){
  const fn = window[name];
  if(typeof fn === 'function'){ fn(); return true; }
  return false;
}
//   
//   position:fixed fixed   offsetParent  null
//   offsetParent  
function _isShown(el){
  if(!el || !el.isConnected) return false;
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
}
//   true
function _handleBackLayer(){
  // 1) 
  const cfmOv = document.getElementById('cfm-ov');
  if(cfmOv && cfmOv.classList.contains('on')){ _callIf('closeCfm'); return true; }
  const askIn = document.getElementById('ask-in-ov');   // askInput 輸入視窗（永遠在最上層）
  if(askIn){ askIn._close ? askIn._close() : askIn.remove(); return true; }

  // 1-1) 法條小視窗（疊在答題、法規頁之上）：從清單點進來的先回清單，與按 ✕ 相同
  //      ★ 原本沒攔，答題中看法條按返回會直接離開測驗
  if(_isShown(document.getElementById('lawpop-ov'))){ _callIf('closeLawPop'); return true; }

  // 2) FAB 
  const fabOv = document.getElementById('fab-overlay');
  if(fabOv && fabOv.classList.contains('open')){ _callIf('closeFab'); return true; }

  // 3)  
  for(const [id, fn] of [['add-q-menu','closeAddQMenu'], ['add-law-menu','closeAddLawMenu']]){
    const m = document.getElementById(id);
    if(m && m.style.display !== 'none' && m.style.display !== ''){ _callIf(fn); return true; }
  }

  // 3-1) JS 動態建立的底部面板／彈窗（書籍詳情、新增／編輯書籍、新增影音、英語上傳、新增考試倒數…）
  //      ★ 原本沒攔：按返回會切換底下的頁面，面板卻還留在畫面上。取最上層（最後加入）的關閉
  const sheets = [...document.querySelectorAll(_DYN_SHEETS)].filter(_isShown);
  if(sheets.length){
    const top = sheets[sheets.length - 1];
    top._close ? top._close() : top.remove();
    return true;
  }

  // 4)  / PDF 
  if(document.documentElement.classList.contains('reader-active') || document.getElementById('book-reader-ov')){
    if(_callIf('closeBookReader')) return true;
  }

  // 5)  
  //      remove() 
  for(const [id, fn] of [
    ['vinyl-player-ov','closeVinylPlayer'],
    ['video-player-ov','closeVideoPlayer'],
    ['media-detail-ov', null],            //  App 
  ]){
    const el = document.getElementById(id);
    if(_isShown(el)){
      if(!(fn && _callIf(fn))) el.remove();
      return true;
    }
  }

  // 6) 
  //     .cov cfm  .ov
  //    
  const ovMap = {
    'heatmap-ov':'closeHeatmapOv', 'bulk-ov':'closeBulkQ',
    'add-ov':'closeAdd', 'law-ov':'closeLawSh', 'blaw-ov':'closeBulkLaw',
    'subj-ov':'closeSubjPick', 'qnote-ov':'closeQNote', 'exp-ov':'closeExportOv', 'lcat-ov':'closeLawCat', 'ltt-ov':'closeLawTitles', 'linfo-ov':'closeLawInfo', 'spd-ov':'closeSpeed',
  };
  const opened = [...document.querySelectorAll('.ov.on, .cov.on')];
  if(opened.length){
    const top = opened[opened.length - 1];
    // 動態產生的視窗（如還原完成）帶有自己的 _close：返回鍵與按鈕走同一條路（例如關閉後要重新整理）
    if(!_callIf(ovMap[top.id])) top._close ? top._close() : top.classList.remove('on');   // 
    return true;
  }

  // 6-1) 法規頁的 ⋮ 選單、本法搜尋列：先收起，不直接離開法規頁
  const lvMenu = document.getElementById('lv-menu');
  if(lvMenu && lvMenu.style.display === 'block'){ _callIf('closeLvMenu'); return true; }
  const lvFind = document.getElementById('lv-find');
  if(lvFind && !lvFind.classList.contains('hide')){ _callIf('closeLvFind'); return true; }

  // 7)   display:flex  exitLaw
  const lv = document.getElementById('lv');
  const qvOn = (document.getElementById('qv')?.style.display || 'none') !== 'none';   // 從法規頁開始練習時，測驗蓋在法規頁上 → 先結束測驗
  if(lv && lv.style.display === 'flex' && !qvOn){
    if(!_callIf('exitLaw')) lv.style.display = 'none';
    return true;
  }

  // 8) 英語閱讀器（成長區教材，以 display:flex 顯示的覆蓋層）
  //    先前未納入攔截，導致朗讀教材時按返回沒有任何反應。
  const engReader = document.getElementById('eng-reader');
  if(engReader && engReader.style.display === 'flex'){
    if(!_callIf('closeMaterial')) engReader.style.display = 'none';
    return true;
  }

  // 9) 
  const qink = document.getElementById('qink');
  if(qink && qink.classList.contains('on')){
    _callIf('toggleInk');   // toggleInk 
    return true;
  }

  // 10)    #qv  page
  const qv = document.getElementById('qv');
  if(qv && qv.style.display !== 'none' && qv.style.display !== ''){
    if(!_callIf('exitQ')) qv.style.display = 'none';
    return true;
  }

  // 11)   
  //       'home'  App
  //     S.page   
  if(_pageStack.length > 1 || S.page !== 'home'){
    if(_pageStack.length > 1) _pageStack.pop();
    else _pageStack = ['home'];   // 
    const prevPg = _pageStack[_pageStack.length - 1];
    const btn = document.querySelector(`.nb[onclick*="'${prevPg}'"]`);
    goPage(prevPg, btn, true);   // fromBack=true
    return true;
  }
  return false;   //   
}

function _initBackHandler(){
  _pushBackGuard();   // 一次性推入 60 筆緩衝，之後不再需要動態補回

  window.addEventListener('popstate', ()=>{
    try{
      // 有可關閉的層級：交給瀏覽器原生消耗掉這筆歷史紀錄即可，
      // 不需要我們的 JS 補回任何東西——這是徹底避免時序問題的關鍵。
      if(_handleBackLayer()) return;

      // 已在首頁且沒有更多層級 → 真正離開 App。
      // 同步呼叫（不用 setTimeout）：這是延續同一次使用者操作的自然導覽，
      // 不是「新增歷史紀錄」，不受 popstate 處理中呼叫 pushState 會被
      // 吞掉的限制（那個限制只針對 pushState，不影響 back/go）。
      try{ history.back(); }catch(e){}
    }catch(e){
      // 任何例外都不做額外處理：緩衝一次推入 60 筆，單次例外不影響整體攔截能力
    }
  });

  // 從背景/bfcache 回來時，若緩衝所剩不多（正常使用不會發生，這裡當保險），
  // 補滿一輪；用「剩餘量檢查」避免每次都無謂地推入。
  const _healIfLow = ()=>{
    try{
      if(!history.state || !history.state.ycGuard) _pushBackGuard();
    }catch(e){}
  };
  window.addEventListener('pageshow', _healIfLow);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) _healIfLow(); });
}

async function init(){  try{
  await initDB();
  await initTheme();
  healLawNums().catch(e=>logError('healLawNums', e));
  _initFabDelegation();
  goPage('home', document.querySelector('.nb'));
  _initBackHandler();
  setTimeout(() => { try{ window.checkRestoreInterrupted?.(); }catch(e){} }, 1500);   // 上次還原途中被關掉 → 告知哪幾類完成
  }catch(e){
    logError('init', e);
    // 顯示錯誤提示但不讓畫面全黑，仍顯示 FAB
    const errDiv = document.createElement('div');
    errDiv.className = 'app-err-banner';
    errDiv.innerHTML = '⚠ 資料庫初始化失敗<br><span style="font-size:11px;color:#888">'+esc(String(e.message||e))+'</span><br><button id="init-reload-btn" style="margin-top:8px;padding:6px 14px;background:#3a1212;border:1px solid #e05c57;color:#e05c57;border-radius:6px;cursor:pointer;font-size:12px">重新載入</button>';
    document.body.appendChild(errDiv);
    document.getElementById('init-reload-btn')?.addEventListener('click', ()=>location.reload());
    // 仍嘗試顯示首頁框架
    try{ _initFabDelegation(); goPage('home', null); _initBackHandler(); }catch(_){}
    // 即使出錯也要關閉 splash
    if(typeof window._splashDismiss==='function') window._splashDismiss();
  }
}
init().then(()=>{
  // 填入版本號（雙版本）
  const verEl = document.getElementById('app-ver');
  if(verEl){
    const av = typeof APP_VERSION  !== 'undefined' ? APP_VERSION  : '';
    const dv = typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '';
    verEl.innerHTML = `v${av} <span style="color:var(--t2);font-size:11px">題庫 ${dv}</span>`;
  }
  // 關閉載入畫面（至少顯示 2.6 秒讓動畫完整播完）
  const elapsed = Date.now() - _splashStart;
  const wait = Math.max(0, 2600 - elapsed);
  setTimeout(()=>{ if(typeof window._splashDismiss==='function') window._splashDismiss(); }, wait);
});

/* ── Service Worker 更新偵測 ── */
if('serviceWorker' in navigator){
  navigator.serviceWorker.ready.then(reg => {
    // 頁面載入時若已有新版在等待（上次點了「稍後」或關閉期間部署過）
    if(reg.waiting && navigator.serviceWorker.controller){
      _showUpdateBanner(reg);
    }
    // 定期檢查更新（每 30 分鐘）
    // 檢查更新失敗（網路不穩、GitHub Pages 暫時沒回應）不影響使用，下次再檢查即可；
    //   沒接 catch 會變成錯誤紀錄裡的「Promise rejected: Failed to update a ServiceWorker」
    setInterval(()=> reg.update().catch(()=>{}), 30 * 60 * 1000);
    // App 回到前景時也檢查（手機 PWA 最常見的更新時機）
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'visible') reg.update().catch(()=>{});
    });
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

// ════════════════════════════════════════════════════════════
// 【版本更新橫幅】
// ════════════════════════════════════════════════════════════
// v4.40：作答中（含限時模擬考）不跳更新通知——原本橫幅會蓋在題目選項上，按「立即更新」整頁重新整理，
//   正在做的那一題、模擬考計時都會中斷。改成等離開作答畫面再顯示（每 3 秒看一次）
let _updWait = null;
const _quizOnScreen = () => { const qv = document.getElementById('qv'); return !!qv && getComputedStyle(qv).display !== 'none'; };
function _showUpdateBanner(reg){
  if(document.getElementById('sw-update-banner')) return;
  if(_quizOnScreen()){
    if(!_updWait) _updWait = setInterval(() => {
      if(_quizOnScreen()) return;
      clearInterval(_updWait); _updWait = null;
      _showUpdateBanner(reg);
    }, 3000);
    return;
  }
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
        <button data-sw="later"
          style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--t2);
          background:transparent;color:var(--t2);font-size:12px;cursor:pointer">稍後</button>
        <button data-sw="update"
          style="flex:1;padding:8px;border-radius:8px;border:none;
          background:var(--acc);color:#fff;font-size:12px;font-weight:700;cursor:pointer">立即更新</button>
      </div>
    </div>`;
  banner.addEventListener('click', e=>{
    const btn = e.target.closest('[data-sw]');
    if(!btn) return;
    if(btn.dataset.sw === 'update' && reg.waiting){
      reg.waiting.postMessage({ type:'SKIP_WAITING' });
    }
    banner.remove();
  });
  document.body.appendChild(banner);
}

// ════════ 公開 API ════════
const App = {
  toggleZone, toggleZoneQuiz,
  toggleAddQMenu, closeAddQMenu, toggleAddLawMenu, closeAddLawMenu,
  toggleFab, closeFab, fabGo, navQuiz, _navClick, goPage, setTheme
};
window.App = App;
Object.assign(window, App);

})();
