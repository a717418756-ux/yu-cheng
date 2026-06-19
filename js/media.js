// ══ media.js — 影音庫（黑膠播放器 + 海報牆）══════════════════
// 依賴：db.js（_db, dp, dd, dg, logError）
// 頁面：pg-media
// ════════════════════════════════════════════════════════════

// ── 狀態 ────────────────────────────────────────────────────
const _M = {
  filter:     'all',
  kw:         '',
  page:       0,
  PAGE:       20,
  allMedia:   [],
  expandMode:   null,
  expandPage:   0,    // 展開列表分頁（每頁 10 筆）
  EXPAND_PAGE:  10,
  bulkMode:     false,
  bulkSelected: new Set(),
  loopMode:   false,  // 單曲循環
  shuffleMode:false,  // 隨機播放
  // 正在播放
  nowId:    null,
  nowType:  null,   // 'audio' | 'video'
  playlist: [],     // 當前播放列表（同類型排序）
  playIdx:  0,
};

// 音頻播放器實例（全域唯一）
let _audioEl = null;
let _vinylTimer = null;   // 黑膠旋轉 animation
let _sleepTimer = null;   // 睡眠定時器

// ════════════════════════════════════════════════════════════
// 頁面渲染入口
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// 【影音庫：清單載入與渲染】
// ════════════════════════════════════════════════════════════
async function renderMedia(){
  try{
    showSkeleton('media-list', 5);  // 載入前先顯示骨架屏
    _M.page     = 0;
    _M.allMedia = await _getMediaMetaList();
    _renderMediaPage();
  }catch(e){ logError('renderMedia',e); }
}

// 批量填充影音縮圖（渲染後非同步填入）
async function _fillMediaThumbs(container){
  const els = (container||document).querySelectorAll('[data-mid]');
  for(const el of els){
    const id = parseInt(el.dataset.mid);
    if(!id || !el.isConnected) continue;
    const raw = await _getMediaThumb(id);
    if(!raw || !el.isConnected) continue;
    const src = (raw instanceof Blob) ? URL.createObjectURL(raw) : raw;
    // 影片展開卡 poster：保留播放圖示/時長 badge，只替換無封面佔位、插入背景縮圖
    if(el.dataset.vthumb){
      const noPoster = el.querySelector('.mvc-no-poster');
      if(noPoster) noPoster.remove();
      // 避免重複插入
      if(!el.querySelector('img.mvc-thumb-img')){
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.className = 'mvc-thumb-img';
        if(raw instanceof Blob){ img.onload = ()=> URL.revokeObjectURL(src); }
        img.src = src;
        el.insertBefore(img, el.firstChild);
      }
      continue;
    }
    // 音頻列唱盤 mar-vinyl：替換黑膠佔位為圓形縮圖
    if(el.dataset.athumb){
      if(!el.querySelector('img.mar-thumb-img')){
        const inner = el.querySelector('.mar-vinyl-inner');
        if(inner) inner.remove();
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.className = 'mar-thumb-img';
        if(raw instanceof Blob){ img.onload = ()=> URL.revokeObjectURL(src); }
        img.src = src;
        el.appendChild(img);
      }
      continue;
    }
    // 音頻橫向卡 / 其他：原邏輯（清空後放圓形/方形縮圖）
    const isAudio = el.classList.contains('audio');
    const durEl = el.querySelector('.media-hcard-dur');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.className = 'media-thumb-img'+(isAudio?' audio':'');
    if(raw instanceof Blob){ img.onload = ()=> URL.revokeObjectURL(src); }
    img.src = src;
    if(el.isConnected){ el.innerHTML=''; el.appendChild(img); }
    if(durEl && el.isConnected) el.appendChild(durEl);
  }
}

async function _getMediaMetaList(){
  const all = await _db.leisuremedia.toArray();
  // blob（大檔）和 thumbnail（縮圖）都排除
  // 縮圖透過 _getMediaThumb(id) 按需讀取
  return all.map(({blob:_b, thumbnail:_th, ...meta}) => meta);
}

// 按需讀取單筆縮圖
async function _getMediaThumb(id){
  try{
    const row = await _db.leisuremedia.get(id);
    return row?.thumbnail || null;
  }catch(e){ return null; }
}

function _filteredMedia(){
  const kw = _M.kw.toLowerCase();
  let list = _M.allMedia;
  if(_M.filter==='recent') list=[...list].filter(m=>m.lastPlay).sort((a,b)=>(b.lastPlay||0)-(a.lastPlay||0));
  else if(_M.filter==='fav')   list=list.filter(m=>m.favorite);
  else if(_M.filter==='video') list=list.filter(m=>m.type==='video');
  else if(_M.filter==='audio') list=list.filter(m=>m.type==='audio');
  if(kw) list=list.filter(m=>
    (m.title||'').toLowerCase().includes(kw)||
    (m.category||'').toLowerCase().includes(kw)||
    (m.tags||[]).join(' ').toLowerCase().includes(kw)
  );
  return list;
}

// ════════════════════════════════════════════════════════════
// 主頁渲染（首頁 = 四個橫向捲動區塊）
// 「更多」= 全螢幕純列表
// ════════════════════════════════════════════════════════════
function _renderMediaPage(){
  const el  = document.getElementById('media-list');
  const cnt = document.getElementById('media-count');
  if(!el) return;

  const all = _M.allMedia;
  if(cnt) cnt.textContent='';  // 首頁不顯示總計

  // 判斷目前是「更多」展開模式還是首頁模式
  if(_M.expandMode){
    _renderExpandMode(el);
    return;
  }

  // ── 首頁模式：確保清除展開模式殘留按鈕，還原標題 ──
  document.getElementById('expand-back-btn')?.remove();
  document.getElementById('expand-bulk-btn')?.remove();
  const _hdTitle = document.getElementById('media-hd-title');
  if(_hdTitle && _hdTitle.textContent !== '影音庫') _hdTitle.textContent = '影音庫';
  el.innerHTML='';

  if(!all.length){
    el.innerHTML=`<div class="empty"><span class="ic">🎬</span><span>尚無影音，點右上角＋新增</span></div>`;
    return;
  }

  // 最近播放（前10筆，依 lastPlay 排序，影片+音頻都包含）
  const recent = [...all].filter(m=>m.lastPlay)
    .sort((a,b)=>(b.lastPlay||0)-(a.lastPlay||0)).slice(0,10);

  // 收藏
  const favs = all.filter(m=>m.favorite);

  // 影片
  const videos = [...all].filter(m=>m.type==='video')
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  // 音頻
  const audios = [...all].filter(m=>m.type==='audio')
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  if(recent.length) el.appendChild(_mkHScrollSection('最近播放','recent',recent, false));
  el.appendChild(_mkHScrollSection('收藏','fav',favs));  // 無收藏也顯示（空狀態）
  if(videos.length) el.appendChild(_mkHScrollSection('影片','video',videos,true,true));
  if(audios.length) el.appendChild(_mkHScrollSection('音頻','audio',audios));
  setTimeout(()=>_fillMediaThumbs(el), 0);
}

// ── 橫向捲動 section ──────────────────────────────────────
// ════════════════════════════════════════════════════════════
// 【影音庫：首頁橫向捲動卡片】
// ════════════════════════════════════════════════════════════
function _mkHScrollSection(title, type, items, showMore=true, featured=false){
  // 外層 wrap 負責底部分隔線
  const wrap = document.createElement('div');
  wrap.className = 'media-sec-wrap';

  const hd = document.createElement('div');
  hd.className='media-sec-hd-row';
  hd.innerHTML=`
    <div class="media-sec-hd-big">${title}</div>
    ${showMore ? `<button class="media-sec-more" onclick="_openExpandMode('${type}')">更多 ›</button>` : ''}`;
  wrap.appendChild(hd);

  if(!items.length){
    const empty = document.createElement('div');
    empty.className='media-empty-sec';
    empty.textContent = title==='收藏' ? '尚未收藏任何影音' : '尚無內容';
    wrap.appendChild(empty);
    return wrap;
  }

  const preview = items.slice(0,5);
  const row = document.createElement('div');
  row.className='media-hscroll-row';
  preview.forEach((m, i)=>{
    if(m.type==='audio'){
      row.appendChild(_mkAudioCard(m));
    } else if(featured && i===0){
      row.appendChild(_mkVideoThumbCard(m, true));   // 第1張大卡
    } else {
      row.appendChild(_mkVideoThumbCard(m, false));
    }
  });
  wrap.appendChild(row);
  return wrap;
}

// 音頻卡片（橫向捲動用：黑膠唱片縮圖 + 名稱）
function _mkAudioCard(m){
  const div=document.createElement('div');
  div.className='media-hcard';
  div.onclick=()=>playAudio(m.id);
  div.innerHTML=`
    <div class="media-hcard-thumb audio" data-mid="${m.id}">
      <div class="media-hcard-vinyl"></div>
    </div>
    <div class="media-hcard-name">${esc(m.title||'未命名')}</div>`;
  return div;
}

// 影片縮圖卡片（橫向捲動用）
function _mkVideoThumbCard(m, isFeatured=false){
  const div=document.createElement('div');
  div.className = isFeatured ? 'media-hcard media-hcard-featured' : 'media-hcard';
  div.onclick=()=>playVideo(m.id);
  const dur=m.duration?_fmtDur(m.duration):'';
  div.innerHTML=`
    <div class="${isFeatured?'media-hcard-thumb video featured':'media-hcard-thumb video'}" data-mid="${m.id}">
      <div class="media-hcard-nothumb">🎬</div>
      ${dur?`<div class="media-hcard-dur">${dur}</div>`:''}
    </div>
    <div class="media-hcard-name">${esc(m.title||'未命名')}</div>`;
  return div;
}

// ── 「更多」展開模式：全螢幕縱向列表 ──────────────────────
// ════════════════════════════════════════════════════════════
// 【影音庫：展開列表與分頁】
// ════════════════════════════════════════════════════════════
function _openExpandMode(type){
  _M.expandMode = type;
  _M.expandPage = 0;  // 進入展開模式回到第一頁
  _renderMediaPage();
}

// 通用分頁列：‹ 頁碼 ›，當前頁高亮，智慧省略中間頁碼
function _mkPagerBar(current, total, scope){
  const bar = document.createElement('div');
  bar.className = 'pager-bar';
  const go = p => {
    if(scope==='expand'){
      _M.expandPage = p;
      _renderMediaPage();  // 走正確流程，重建 header（返回鍵/搜尋）+ 內容
      const el = document.getElementById('media-list');
      if(el) el.scrollTo({top:0,behavior:'smooth'});
    }
  };
  const pages = [];
  const win = 1;
  for(let i=0;i<total;i++){
    if(i===0 || i===total-1 || (i>=current-win && i<=current+win)) pages.push(i);
    else if(pages[pages.length-1] !== '...') pages.push('...');
  }
  const prev = document.createElement('button');
  prev.className = 'pager-btn pager-nav';
  prev.textContent = '\u2039';
  prev.disabled = current===0;
  prev.onclick = ()=>go(current-1);
  bar.appendChild(prev);
  pages.forEach(p=>{
    if(p==='...'){
      const dots = document.createElement('span');
      dots.className = 'pager-dots'; dots.textContent = '\u2026';
      bar.appendChild(dots);
    } else {
      const btn = document.createElement('button');
      btn.className = 'pager-btn'+(p===current?' active':'');
      btn.textContent = p+1;
      btn.onclick = ()=>go(p);
      bar.appendChild(btn);
    }
  });
  const next = document.createElement('button');
  next.className = 'pager-btn pager-nav';
  next.textContent = '\u203a';
  next.disabled = current===total-1;
  next.onclick = ()=>go(current+1);
  bar.appendChild(next);
  return bar;
}

function _renderExpandMode(el){
  const type = _M.expandMode;
  let items = [..._M.allMedia];
  let title = '';

  if(type==='recent'){
    items=items.filter(m=>m.lastPlay).sort((a,b)=>(b.lastPlay||0)-(a.lastPlay||0)).slice(0,10);
    title='最近播放';
  } else if(type==='fav'){
    items=items.filter(m=>m.favorite);
    title='收藏';
  } else if(type==='video'){
    items=items.filter(m=>m.type==='video').sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    title='影片';
  } else if(type==='audio'){
    items=items.filter(m=>m.type==='audio').sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    title='音頻';
  } else if(type==='search'){
    title=`搜尋「${_M.kw}」`;
  }
  // 套用搜尋關鍵字（所有模式）
  if(_M.kw){
    const kw=_M.kw.toLowerCase();
    items=items.filter(m=>
      (m.title||'').toLowerCase().includes(kw)||
      (m.category||'').toLowerCase().includes(kw)||
      (m.tags||[]).join(' ').toLowerCase().includes(kw)
    );
  }

  el.innerHTML='';

  const isFavMode = (type==='fav');
  const isSearchMode = (type==='search');

  // 展開模式：操作固定的 hd 三區容器
  const hdLeft  = document.getElementById('media-hd-left');
  const hdTitle = document.getElementById('media-hd-title');
  const hdRight = document.getElementById('media-hd-right');
  if(hdLeft && hdTitle && hdRight){
    // 清除舊的返回和批量按鈕
    document.getElementById('expand-back-btn')?.remove();
    document.getElementById('expand-bulk-btn')?.remove();
    // 左側：返回按鈕
    const backBtn = document.createElement('button');
    backBtn.id='expand-back-btn';
    backBtn.className='hd-btn bg';
    backBtn.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
    backBtn.onclick=()=>_closeExpandMode();
    hdLeft.appendChild(backBtn);
    // 中間：標題改為主旨
    hdTitle.textContent = title;
    // 右側：批量刪除（新增按鈕前面）
    if(!isSearchMode){
      const bulkBtn = document.createElement('button');
      bulkBtn.id='expand-bulk-btn';
      bulkBtn.className='hd-btn red';
      // fav 模式：移除收藏圖示（愛心劃叉）；一般模式：垃圾桶
      bulkBtn.innerHTML=isFavMode
        ?'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><line x1="4" y1="4" x2="20" y2="20"/></svg>'
        :'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
      bulkBtn.onclick=()=>_toggleBulkMode();
      // 插在新增按鈕前面
      const addBtn = hdRight.querySelector('.hd-btn.blue');
      if(isFavMode && addBtn) addBtn.style.display = 'none';  // fav 模式不需要新增
      if(addBtn) hdRight.insertBefore(bulkBtn, addBtn);
      else hdRight.appendChild(bulkBtn);
    }
  }

  // 類別標籤（影片和音頻模式下才顯示）
  if(type==='video'||type==='audio'){
    const cats=[...new Set(items.map(m=>m.category||'').filter(Boolean))];
    if(cats.length>0){
      const catRow=document.createElement('div');
      catRow.className='media-expand-cats';
      catRow.innerHTML=`
        <button class="mec-chip on" onclick="_setExpandCat(this,'')">全部</button>
        ${cats.map(c=>`<button class="mec-chip" onclick="_setExpandCat(this,'${escJs(c)}')">${esc(c)}</button>`).join('')}`;
      el.appendChild(catRow);
    }
  }

  // 計數
  const cntDiv=document.createElement('div');
  cntDiv.className='media-count';
  cntDiv.textContent=`共 ${items.length} 筆`;
  el.appendChild(cntDiv);

  // ── 分頁：每頁 10 筆 ──
  const totalPages = Math.max(1, Math.ceil(items.length / _M.EXPAND_PAGE));
  if(_M.expandPage >= totalPages) _M.expandPage = totalPages - 1;
  if(_M.expandPage < 0) _M.expandPage = 0;
  const pageStart = _M.expandPage * _M.EXPAND_PAGE;
  const pageItems = items.slice(pageStart, pageStart + _M.EXPAND_PAGE);

  // 列表
  const list=document.createElement('div');
  list.id='expand-list';

  if(type==='audio'){
    list.className='media-audio-list';
    pageItems.forEach((m,i)=>{
      const row = _mkAudioRow(m,i);
      if(_M.bulkMode){
        const cb=document.createElement('input');
        cb.type='checkbox'; cb.id=`bulk-cb-${m.id}`;
        cb.className='media-bulk-cb';
        cb.checked=_M.bulkSelected.has(m.id);
        cb.onchange=()=>_toggleBulkSelect(m.id);
        row.insertBefore(cb, row.firstChild);
        // 批量模式：攔截整列點擊→切換勾選，並阻止內部 playAudio 觸發
        row.classList.add('bulk-selecting');
        row.addEventListener('click', (e)=>{
          // 點到 checkbox 本身則交給它的 onchange 處理，不重複切換
          if(e.target.tagName==='INPUT') return;
          e.preventDefault();
          e.stopPropagation();
          _toggleBulkSelect(m.id);
        }, true);  // capture：在內部 onclick 之前攔截
      }
      list.appendChild(row);
    });
  } else {
    list.className='media-video-grid';
    pageItems.forEach(m=>{
      const card=_mkVideoCard(m);
      if(_M.bulkMode){
        card.style.position='relative';
        const cb=document.createElement('input');
        cb.type='checkbox'; cb.id=`bulk-cb-${m.id}`;
        cb.className='media-bulk-cb-card';
        cb.checked=_M.bulkSelected.has(m.id);
        cb.onchange=e=>{e.stopPropagation();_toggleBulkSelect(m.id);};
        card.appendChild(cb);
        // 批量模式：攔截卡片點擊→切換勾選，並阻止內部 playVideo 觸發
        card.classList.add('bulk-selecting');
        card.addEventListener('click', (e)=>{
          if(e.target.tagName==='INPUT') return;
          e.preventDefault();
          e.stopPropagation();
          _toggleBulkSelect(m.id);
        }, true);
      }
      list.appendChild(card);
    });
  }
  el.appendChild(list);
  // 填充縮圖（音頻圓形/影片方形，按需讀取）
  setTimeout(()=>_fillMediaThumbs(list), 0);

  // ── 底部分頁列（多於一頁才顯示）──
  if(totalPages > 1){
    el.appendChild(_mkPagerBar(_M.expandPage, totalPages, 'expand'));
  }
  if(_M.bulkMode){
    const bar=document.createElement('div');
    bar.className='media-bulk-bar';
    bar.innerHTML=`
      <button onclick="_toggleBulkMode()" class="media-bulk-cancel">取消</button>
      <button id="bulk-confirm-btn" onclick="_executeBulk()" class="media-bulk-confirm"
        style="background:${_M.expandMode==='fav'?'rgba(37,98,200,0.85)':'rgba(200,50,50,0.8)'}">
        ${_M.expandMode==='fav'?'移除收藏 (0)':'刪除 (0)'}
      </button>`;
    el.appendChild(bar);
  }
}

function _closeExpandMode(){
  document.getElementById('expand-back-btn')?.remove();
  document.getElementById('expand-bulk-btn')?.remove();
  // 還原新增按鈕（fav 模式可能被隱藏）
  const addBtn = document.querySelector('#media-hd-right .hd-btn.blue');
  if(addBtn) addBtn.style.display = '';
  const hdTitle = document.getElementById('media-hd-title');
  if(hdTitle) hdTitle.textContent = '影音庫';
  _M.expandMode = null;
  _M.bulkMode = false;
  _M.bulkSelected = new Set();
  _renderMediaPage();
}

// 批量模式切換
// ════════════════════════════════════════════════════════════
// 【影音庫：批量選取與刪除】
// ════════════════════════════════════════════════════════════
function _toggleBulkMode(){
  _M.bulkMode = !_M.bulkMode;
  _M.bulkSelected = new Set();
  // 重新渲染展開模式（加勾選框）
  const el = document.getElementById('media-list');
  if(el) _renderExpandMode(el);
  // 更新批量按鈕文字
  const bulkBtn = document.getElementById('expand-bulk-btn');
  if(bulkBtn) bulkBtn.style.color = _M.bulkMode ? 'rgba(255,255,255,0.5)' : '';
}

// 勾選切換
function _toggleBulkSelect(id){
  if(_M.bulkSelected.has(id)) _M.bulkSelected.delete(id);
  else _M.bulkSelected.add(id);
  const selected = _M.bulkSelected.has(id);
  // 更新勾選狀態 UI
  const cb = document.getElementById(`bulk-cb-${id}`);
  if(cb) cb.checked = selected;
  // 更新該列/卡片的選中高亮
  const row = document.getElementById(`arow-${id}`) || cb?.closest('.bulk-selecting');
  if(row) row.classList.toggle('bulk-selected', selected);
  // 更新確認按鈕
  const confirmBtn = document.getElementById('bulk-confirm-btn');
  if(confirmBtn) confirmBtn.textContent =
    _M.expandMode==='fav'
      ? `移除收藏 (${_M.bulkSelected.size})`
      : `刪除 (${_M.bulkSelected.size})`;
}

// 批量執行
async function _executeBulk(){
  if(!_M.bulkSelected.size){ toast('請先勾選項目'); return; }
  const ids = [..._M.bulkSelected];
  const isFav = _M.expandMode==='fav';
  if(isFav){
    // 批量移除收藏
    for(const id of ids){
      const m = await dg('leisuremedia', id);
      if(m){ m.favorite=false; await dp('leisuremedia', m); }
      const idx=_M.allMedia.findIndex(x=>x.id===id);
      if(idx>=0) _M.allMedia[idx].favorite=false;
    }
    toast(`已移除 ${ids.length} 項收藏`);
  } else {
    if(!confirm(`確定刪除 ${ids.length} 項？此操作無法復原。`)) return;
    for(const id of ids){
      await dd('leisuremedia', id);
      _M.allMedia = _M.allMedia.filter(x=>x.id!==id);
    }
    toast(`已刪除 ${ids.length} 項`);
  }
  _M.bulkMode=false; _M.bulkSelected=new Set();
  const el=document.getElementById('media-list');
  if(el) _renderExpandMode(el);
}



// 類別篩選（展開模式內）
function _setExpandCat(btn, cat){
  document.querySelectorAll('.mec-chip').forEach(c=>c.classList.remove('on'));
  btn.classList.add('on');
  const type=_M.expandMode;
  let items=[..._M.allMedia];
  if(type==='video') items=items.filter(m=>m.type==='video');
  else items=items.filter(m=>m.type==='audio');
  if(cat) items=items.filter(m=>(m.category||'')===cat);
  items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  const list=document.getElementById('expand-list');
  if(!list) return;
  list.innerHTML='';
  if(type==='audio'){
    items.forEach((m,i)=>list.appendChild(_mkAudioRow(m,i)));
  } else {
    items.forEach(m=>list.appendChild(_mkVideoCard(m)));
  }
  setTimeout(()=>_fillMediaThumbs(list), 0);
}

// _mkVideoSection 已整合至 _mkHScrollSection

// ════════════════════════════════════════════════════════════
// 【影音庫：展開列表卡片（影片/音頻列）】
// ════════════════════════════════════════════════════════════
function _mkVideoCard(m){
  const div=document.createElement('div');
  div.className='media-vcard';
  const dur=m.duration?_fmtDur(m.duration):'';
  div.innerHTML=`
    <div class="mvc-poster" data-mid="${m.id}" data-vthumb="1" onclick="playVideo(${m.id})">
      <div class="mvc-no-poster">🎬</div>
      ${dur?`<div class="mvc-dur-badge">${dur}</div>`:''}
      <div class="mvc-play-icon">▶</div>
    </div>
    <div class="mvc-meta-row">
      <div class="mvc-title-txt" onclick="playVideo(${m.id})">${esc(m.title||'未命名')}</div>
      <button class="mv-fav-btn${m.favorite?' on':''}"
        onclick="toggleMediaFav(${m.id},this)">${m.favorite?'★':'☆'}</button>
    </div>
    ${m.category?`<div class="mvc-cat">${esc(m.category)}</div>`:''}`;
  return div;
}

// ════════════════════════════════════════════════════════════
// 音頻黑膠列表區塊
// ════════════════════════════════════════════════════════════
// _mkAudioSection 已整合至 _mkHScrollSection

function _mkAudioRow(m,i){
  const div=document.createElement('div');
  div.className='media-arow';
  div.id=`arow-${m.id}`;
  const dur=m.duration?_fmtDur(m.duration):'';
  const isPlaying=_M.nowId===m.id && _audioEl && !_audioEl.paused;
  div.innerHTML=`
    <div class="mar-vinyl${isPlaying?' spinning':''}" data-mid="${m.id}" data-athumb="1" onclick="playAudio(${m.id})">
      <div class="mar-vinyl-inner"></div>
    </div>
    <div class="mar-info" onclick="playAudio(${m.id})">
      <div class="mar-title${isPlaying?' playing':''}">${esc(m.title||'未命名')}</div>
      <div class="mar-meta">${m.category||''}${dur?' · '+dur:''}</div>
    </div>
    <div class="mar-actions">
      ${dur?`<span class="mar-dur">${dur}</span>`:''}
      <button class="mv-fav-btn${m.favorite?' on':''}"
        onclick="toggleMediaFav(${m.id},this)">${m.favorite?'★':'☆'}</button>
      <button class="mar-more" onclick="openMediaDetail(${m.id})">⋯</button>
    </div>`;
  return div;
}

// ════════════════════════════════════════════════════════════
// 音頻播放器（黑膠模式）
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// 【音頻播放器（黑膠唱片）】
// ════════════════════════════════════════════════════════════
async function playAudio(id){
  let meta=_M.allMedia.find(m=>m.id===id);
  if(!meta) return;

  // 建立播放列表（同頁面所有音頻，按顯示順序）
  const audioList=_filteredMedia().filter(m=>m.type==='audio');
  _M.playlist=audioList;
  _M.playIdx =audioList.findIndex(m=>m.id===id);
  _M.nowId   =id;
  _M.nowType ='audio';

  // 讀取 Blob
  const full=await dg('leisuremedia',id);
  if(!full?.blob){
    // 無附加檔案：如果是自動播放（播放列表）就跳下一首，手動點擊才開詳情
    if(_M.playlist.length > 1){
      _vpNext();
    } else {
      openMediaDetail(id);
      toast('此音頻無附加檔案，可在詳情中刪除');
    }
    return;
  }

  // 停掉舊播放器
  if(_audioEl){_audioEl.pause();_audioEl.src='';}
  _clearVinyl();

  const url=URL.createObjectURL(full.blob);

  // 顯示黑膠播放器
  // thumbnail 可能是 Blob（新）或 base64 字串（舊），統一轉為可顯示的 URL
  if(full.thumbnail instanceof Blob){
    meta = {...meta, thumbnail: URL.createObjectURL(full.thumbnail)};
    meta._thumbIsBlob = true;  // 標記需要 revoke
  } else if(full.thumbnail){
    meta = {...meta, thumbnail: full.thumbnail};
  }
  _showVinylPlayer(meta, url, full);

  // 更新播放記錄
  full.lastPlay=Date.now();
  full.playCount=(full.playCount||0)+1;
  await dp('leisuremedia',full);
  const idx=_M.allMedia.findIndex(m=>m.id===id);
  if(idx>=0) _M.allMedia[idx].lastPlay=full.lastPlay;

  // 更新列表高亮
  _updateAudioRowHighlight(id);
  _showMiniBar(meta.title,'audio');
}

function _showVinylPlayer(meta, url, full){
  document.getElementById('vinyl-player-ov')?.remove();

  const ov=document.createElement('div');
  ov.id='vinyl-player-ov';
  ov.className='media-ov-fullplayer';

  const lastPos=full.lastPos||0;

  const isFav = meta.favorite || false;
  ov.innerHTML=`
    <!-- ── 頂部列 ── -->
    <div class="vp-topbar">
      <button class="vp-back" onclick="closeVinylPlayer()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div style="text-align:center">
        <div class="vp-mode-lbl">黑膠模式</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <!-- 播放列表按鈕（在三點旁邊）-->
        <button class="vp-more" onclick="openVpPlaylist()" title="播放列表"
          style="font-size:16px">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </button>
        <!-- 三點選單 -->
        <button class="vp-more" onclick="_openAudioMenu(${meta.id})">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/>
            <circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ── 唱片台：唱盤圖 + 唱針圖 + 封面裁圓 ── -->
    <div class="vp-vinyl-wrap" id="vp-vinyl-wrap">
      <!-- 唱針圖片（絕對定位，右上角） -->
      <img class="vp-tonearm-img" id="vp-tonearm-img"
        src="icons/tonearm.png" alt="">
      <!-- 唱盤圖片（旋轉主體） -->
      <div class="vp-record-outer" id="vp-record">
        <img class="vp-record-img" src="icons/vinyl-record.png" alt="">
        <!-- 封面：點擊可裁剪 -->
        <div class="vp-record-cover" id="vp-cover-ring" onclick="_openCoverCrop(${meta.id})">
          ${meta.thumbnail
            ? `<img id="vp-cover-img" src="${meta.thumbnail}"
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;
                transform:scale(var(--cover-scale,1)) translate(var(--cover-x,0),var(--cover-y,0))">`
            : `<div class="vp-cover-empty">＋封面</div>`}
        </div>
      </div>
    </div>

    <!-- ── 曲目資訊列：[♡] [標題] [≡播放列表] ── -->
    <div class="vp-info">
      <!-- 標題（左側）-->
      <div class="vp-info-text" style="flex:1;min-width:0">
        <div class="vp-title">${esc(meta.title||'未命名')}</div>
        <div class="vp-artist">${esc(meta.category||'Y.C. 影音庫')}</div>
      </div>
      <!-- 收藏按鈕（右側，稍微向左）-->
      <button class="vp-fav-btn${isFav?' on':''}" id="vp-fav-btn"
        onclick="_vpToggleFav(${meta.id},this)" style="flex-shrink:0;margin-right:4px">
        <svg width="24" height="24" viewBox="0 0 24 24"
          fill="${isFav?'#ec4899':'none'}"
          stroke="${isFav?'#ec4899':'rgba(255,255,255,0.4)'}" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
    </div>

    <!-- ── 進度條 ── -->
    <div class="vp-progress-wrap">
      <input type="range" id="vp-seek" class="vp-seek"
        value="0" min="0" max="100" step="0.1"
        oninput="_vpSeek(this.value)" style="width:100%">
      <div class="vp-times">
        <span id="vp-cur">0:00</span>
        <span id="vp-dur">0:00</span>
      </div>
    </div>

    <!-- ── 控制列：倍速 | 循環 | ⏮ | ⏸(大) | ⏭ | 隨機 | 定時 ── -->
    <div class="vp-controls">
      <button class="vpc-btn vpc-sm vpt-speed-btn" onclick="_vpCycleSpeed(this)"
        style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.6)">1.0×</span>
      </button>
      <button id="vp-loop-btn" class="vpc-btn vpc-sm"
        onclick="_vpToggleLoop(this)" style="color:rgba(255,255,255,0.35)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      </button>
      <button class="vpc-btn vpc-side" onclick="_vpPrev()">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="19 20 9 12 19 4 19 20"/>
          <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>
      <button class="vpc-btn vpc-main" id="vp-play-btn" onclick="_vpToggle()">
        <svg id="vp-play-icon" width="26" height="26" viewBox="0 0 24 24" fill="white">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </button>
      <button class="vpc-btn vpc-side" onclick="_vpNext()">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 4 15 12 5 20 5 4"/>
          <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>
      <button id="vp-shuffle-btn" class="vpc-btn vpc-sm"
        onclick="_vpToggleShuffle(this)" style="color:rgba(255,255,255,0.35)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="16 3 21 3 21 8"/>
          <line x1="4" y1="20" x2="21" y2="3"/>
          <polyline points="21 16 21 21 16 21"/>
          <line x1="15" y1="15" x2="21" y2="21"/>
        </svg>
      </button>
      <button class="vpc-btn vpc-sm" onclick="_vpSleepTimer(this)" id="vp-sleep-btn"
        style="color:rgba(255,255,255,0.35);
          display:flex;flex-direction:column;align-items:center;gap:2px;
          min-width:32px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span id="vp-sleep-lbl"
          style="font-size:9px;line-height:1;white-space:nowrap;
          display:block;text-align:center;max-width:36px">定時</span>
      </button>
    </div>

    <!-- 播放列表容器（在控制列下方展開）-->
    <div id="vp-playlist-wrap"
      style="overflow:hidden;flex-shrink:0;max-height:0;
             transition:max-height .3s cubic-bezier(.4,0,.2,1);
             margin-top:20px"></div>

    <!-- 隱藏 audio 元素 -->
    <audio id="vp-audio" src="${url}" style="display:none"></audio>`;

  document.body.appendChild(ov);

  _audioEl=document.getElementById('vp-audio');
  if(lastPos>3) _audioEl.currentTime=lastPos;

  // 事件綁定
  _audioEl.ontimeupdate=_vpTimeUpdate;
  _audioEl.onloadedmetadata=()=>{
    document.getElementById('vp-dur').textContent=_fmtDurSec(_audioEl.duration);
    document.getElementById('vp-seek').max=_audioEl.duration;
    // 更新 MediaSession duration
    if('mediaSession' in navigator && _audioEl.duration){
      try{ navigator.mediaSession.setPositionState({duration:_audioEl.duration,position:_audioEl.currentTime||0}); }catch(_){}
    }
  };
  _audioEl.onended=()=>{
    // 播放列表只有1首時，停在最後不跳 miniBar
    if(_M.playlist.length>1){
      _vpNext();
    } else {
      _setPlayIcon(false);
      _stopVinylSpin();
    }
  };
  _audioEl.play().then(()=>{
    _setPlayIcon(true);
    _startVinylSpin();
    _setupMediaSession(meta);
  }).catch(()=>{});
}

// MediaSession API：通知列 / 鎖屏 控制
function _setupMediaSession(meta){
  if(!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  meta.title  || '未命名',
    artist: meta.category || 'Y.C. 影音庫',
    album:  'Y.C. All-in-one',
    artwork: meta.thumbnail ? [{src:meta.thumbnail,sizes:'192x192',type:'image/jpeg'}] : [],
  });
  navigator.mediaSession.setActionHandler('play',         ()=>{ if(_audioEl){_audioEl.play();_startVinylSpin();document.getElementById('vp-play-btn').textContent='⏸';} });
  navigator.mediaSession.setActionHandler('pause',        ()=>{ if(_audioEl){_audioEl.pause();_stopVinylSpin();document.getElementById('vp-play-btn').textContent='▶';} });
  navigator.mediaSession.setActionHandler('previoustrack',()=>_vpPrev());
  navigator.mediaSession.setActionHandler('nexttrack',    ()=>_vpNext());
  navigator.mediaSession.setActionHandler('seekto', e=>{ if(_audioEl && e.seekTime!=null) _audioEl.currentTime=e.seekTime; });
}

// 音頻三點選單（詳細資料 + 刪除）
function _openAudioMenu(id){
  document.getElementById('audio-menu-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.id = 'audio-menu-sheet';
  sheet.className = 'media-ov-sheet z700';
  sheet.onclick = e=>{ if(e.target===sheet) sheet.remove(); };
  dg('leisuremedia', id).then(m=>{
    if(!m) return;
    sheet.innerHTML = `
      <div style="width:100%;max-width:520px;margin:0 auto;
        background:#1a1a22;border-radius:20px 20px 0 0;padding:8px 0 32px">
        <div style="width:36px;height:4px;background:rgba(255,255,255,0.15);
          border-radius:2px;margin:10px auto 8px"></div>
        <div style="padding:10px 20px 14px;border-bottom:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:15px;font-weight:700;color:#fff">${esc(m.title||'')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:3px">
            🎵 音頻 · ${m.category||'未分類'} · ${_fmtSize(m.fileSize||0)}
          </div>
        </div>
        <button onclick="confirmDeleteMedia(${id});document.getElementById('audio-menu-sheet').remove()"
          style="width:100%;padding:14px 20px;text-align:left;background:none;border:none;
          color:#ff453a;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px">
          <span>🗑</span>刪除
        </button>
        <button onclick="document.getElementById('audio-menu-sheet').remove()"
          style="width:100%;padding:14px 20px;text-align:left;background:none;border:none;
          color:rgba(255,255,255,0.5);font-size:14px;cursor:pointer">
          取消
        </button>
      </div>`;
    document.body.appendChild(sheet);
  });
}

// 封面裁剪（點擊封面區域開啟）
function _openCoverCrop(mediaId){
  // 如果已有縮圖，允許重新上傳封面
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async e => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      _showCoverCropUI(ev.target.result, mediaId);
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

function _showCoverCropUI(dataUrl, mediaId){
  const existing = document.getElementById('cover-crop-ui');
  if(existing) existing.remove();

  const ui = document.createElement('div');
  ui.id = 'cover-crop-ui';
  ui.className = 'media-ov-zoom';

  let scale = 1, tx = 0, ty = 0;

  ui.innerHTML = `
    <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px">調整封面位置</div>
    <div style="position:relative;width:220px;height:220px;border-radius:50%;
      overflow:hidden;border:2px solid rgba(255,255,255,0.3);flex-shrink:0">
      <img id="crop-preview" src="${dataUrl}"
        style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)
          scale(${scale}) translate(${tx}px,${ty}px);
          width:100%;height:100%;object-fit:cover;touch-action:none">
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;width:240px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:rgba(255,255,255,0.5);width:30px">縮放</span>
        <input type="range" id="crop-scale" min="0.5" max="3" step="0.05" value="1"
          style="flex:1;accent-color:#a855f7" oninput="_cropUpdate()">
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:rgba(255,255,255,0.5);width:30px">左右</span>
        <input type="range" id="crop-x" min="-100" max="100" step="1" value="0"
          style="flex:1;accent-color:#a855f7" oninput="_cropUpdate()">
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:rgba(255,255,255,0.5);width:30px">上下</span>
        <input type="range" id="crop-y" min="-100" max="100" step="1" value="0"
          style="flex:1;accent-color:#a855f7" oninput="_cropUpdate()">
      </div>
    </div>
    <div style="display:flex;gap:10px">
      <button onclick="document.getElementById('cover-crop-ui').remove()"
        style="padding:10px 24px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
        color:#fff;border-radius:24px;font-size:13px;cursor:pointer">取消</button>
      <button onclick="_applyCoverCrop(${mediaId},'${dataUrl}')"
        style="padding:10px 28px;background:#a855f7;border:none;
        color:#fff;border-radius:24px;font-size:13px;font-weight:700;cursor:pointer">確定</button>
    </div>`;
  document.body.appendChild(ui);
}

function _cropUpdate(){
  const s = parseFloat(document.getElementById('crop-scale')?.value||1);
  const x = parseFloat(document.getElementById('crop-x')?.value||0);
  const y = parseFloat(document.getElementById('crop-y')?.value||0);
  const img = document.getElementById('crop-preview');
  if(img) img.style.transform =
    `translate(-50%,-50%) scale(${s}) translate(${x}px,${y}px)`;
}

async function _applyCoverCrop(mediaId, dataUrl){
  // 用 Canvas 裁出圓形封面縮圖
  const s = parseFloat(document.getElementById('crop-scale')?.value||1);
  const x = parseFloat(document.getElementById('crop-x')?.value||0);
  const y = parseFloat(document.getElementById('crop-y')?.value||0);

  const SIZE = 240; // 輸出尺寸（詳情頁顯示 120px 的 2x，清晰又省空間）
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const img = new Image(); img.src = dataUrl;
  await new Promise(r=>{ img.onload=r; });

  // 裁剪：畫圓形遮罩
  ctx.beginPath();
  ctx.arc(SIZE/2, SIZE/2, SIZE/2, 0, Math.PI*2);
  ctx.clip();

  const drawW = img.width * s;
  const drawH = img.height * s;
  const drawX = (SIZE - drawW)/2 + x * s;
  const drawY = (SIZE - drawH)/2 + y * s;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  // 裁剪後改存 Blob（比 base64 少 33%）
  const thumb = await new Promise(res=>canvas.toBlob(b=>res(b),'image/jpeg',0.88));

  // 存回 DB
  try{
    const m = await dg('leisuremedia', mediaId);
    if(m){ m.thumbnail = thumb; await dp('leisuremedia', m);
      // 更新播放器封面（Blob 需要 createObjectURL）
      const coverEl = document.getElementById('vp-cover-img');
      if(coverEl){
        const url = (thumb instanceof Blob) ? URL.createObjectURL(thumb) : thumb;
        coverEl.onload = ()=>{ if(thumb instanceof Blob) URL.revokeObjectURL(url); };
        coverEl.src = url;
      }
      // 更新列表縮圖
      const idx = _M.allMedia.findIndex(x=>x.id===mediaId);
      if(idx>=0) _M.allMedia[idx].thumbnail = thumb;
    }
    toast('封面已更新');
  }catch(e){ logError('_applyCoverCrop',e); }
  document.getElementById('cover-crop-ui')?.remove();
}

// 收藏切換（黑膠播放器內）
async function _vpToggleFav(id, btn){
  try{
    const m = await dg('leisuremedia', id); if(!m) return;
    m.favorite = !m.favorite;
    await dp('leisuremedia', m);
    btn.className = m.favorite ? 'vp-fav-btn on' : 'vp-fav-btn';
    btn.textContent = m.favorite ? '♥' : '♡';
    const idx = _M.allMedia.findIndex(x=>x.id===id);
    if(idx>=0) _M.allMedia[idx].favorite = m.favorite;
  }catch(e){ logError('_vpToggleFav',e); }
}

// 黑膠旋轉
function _startVinylSpin(){
  const rec=document.getElementById('vp-record');
  if(rec) rec.classList.add('spinning');
}
function _stopVinylSpin(){
  const rec=document.getElementById('vp-record');
  if(rec) rec.classList.remove('spinning');
}
function _clearVinyl(){
  _stopVinylSpin();
  if(_sleepTimer){clearTimeout(_sleepTimer);_sleepTimer=null;}
}

function closeVinylPlayer(){
  const ov=document.getElementById('vinyl-player-ov');
  if(!ov) return;
  // revoke 黑膠封面 blob URL（避免記憶體洩漏）
  const coverImg = document.getElementById('vp-cover-img');
  if(coverImg?.src?.startsWith('blob:')) URL.revokeObjectURL(coverImg.src);
  // 儲存播放位置
  if(_audioEl && _M.nowId){
    const pos=Math.floor(_audioEl.currentTime);
    dg('leisuremedia',_M.nowId).then(m=>{
      if(m){m.lastPos=pos;dp('leisuremedia',m);}
    }).catch(()=>{});
    _audioEl.pause();
    URL.revokeObjectURL(_audioEl.src);
  }
  _clearVinyl();
  ov.remove();
  _updateMiniBar();
}

// 進度相關
function _vpTimeUpdate(){
  if(!_audioEl) return;
  const cur=_audioEl.currentTime;
  const dur=_audioEl.duration||1;
  const seek=document.getElementById('vp-seek');
  if(seek && !seek.matches(':active')){
    seek.value=cur;
    // 更新已播放填色
    const pct=Math.round(cur/dur*1000)/10;
    seek.style.setProperty('--seek-pct', pct+'%');
  }
  const curEl=document.getElementById('vp-cur');
  if(curEl) curEl.textContent=_fmtDurSec(cur);
}
function _vpSeek(val){
  if(!_audioEl) return;
  _audioEl.currentTime=parseFloat(val);
  const pct=Math.round(parseFloat(val)/(_audioEl.duration||1)*1000)/10;
  const seek=document.getElementById('vp-seek');
  if(seek) seek.style.setProperty('--seek-pct', pct+'%');
}
function _vpToggle(){
  if(!_audioEl) return;
  if(_audioEl.paused){
    _audioEl.play();
    _setPlayIcon(true);
    _startVinylSpin();
  } else {
    _audioEl.pause();
    _setPlayIcon(false);
    _stopVinylSpin();
  }
}

function _setPlayIcon(playing){
  const icon = document.getElementById('vp-play-icon');
  if(!icon) return;
  if(playing){
    // 暫停圖示
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="white"/><rect x="14" y="4" width="4" height="16" fill="white"/>';
  } else {
    // 播放圖示
    icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="white"/>';
  }
}
function _vpPrev(){
  if(_M.playlist.length<2) return;
  if(_M.shuffleMode){
    let prev;
    do { prev=Math.floor(Math.random()*_M.playlist.length); }
    while(_M.playlist.length>1 && prev===_M.playIdx);
    _M.playIdx=prev;
  } else {
    _M.playIdx=(_M.playIdx-1+_M.playlist.length)%_M.playlist.length;
  }
  playAudio(_M.playlist[_M.playIdx].id);
}
function _vpNext(){
  if(!_M.playlist.length) return;
  if(_M.playlist.length===1){ 
    // 只有一首：循環模式重播，否則停止
    if(_M.loopMode && _audioEl){ _audioEl.currentTime=0; _audioEl.play(); }
    return; 
  }
  if(_M.loopMode){
    // 單曲循環
    if(_audioEl){ _audioEl.currentTime=0; _audioEl.play(); }
    return;
  }
  if(_M.shuffleMode){
    // 隨機
    let next;
    do { next=Math.floor(Math.random()*_M.playlist.length); }
    while(_M.playlist.length>1 && next===_M.playIdx);
    _M.playIdx=next;
  } else {
    _M.playIdx=(_M.playIdx+1)%_M.playlist.length;
  }
  playAudio(_M.playlist[_M.playIdx].id);
}
// 循環模式切換
function _vpToggleLoop(btn){
  _M.loopMode = !_M.loopMode;
  if(_M.loopMode) _M.shuffleMode = false; // 互斥
  btn.style.color = _M.loopMode ? '#fff' : 'rgba(255,255,255,0.35)';
  // 同步隨機按鈕
  const sh = document.getElementById('vp-shuffle-btn');
  if(sh) sh.style.color = 'rgba(255,255,255,0.35)';
}
// 隨機模式切換
function _vpToggleShuffle(btn){
  _M.shuffleMode = !_M.shuffleMode;
  if(_M.shuffleMode) _M.loopMode = false;
  btn.style.color = _M.shuffleMode ? '#fff' : 'rgba(255,255,255,0.35)';
  const lp = document.getElementById('vp-loop-btn');
  if(lp) lp.style.color = 'rgba(255,255,255,0.35)';
}

function _vpCycleSpeed(btn){
  if(!_audioEl) return;
  const speeds=[0.75,1,1.25,1.5,2];
  const cur=_audioEl.playbackRate;
  const nxt=speeds[(speeds.indexOf(cur)+1)%speeds.length];
  _audioEl.playbackRate=nxt;
  const sp = btn.querySelector('span') || btn;
  sp.textContent = nxt+'×';
  sp.style.color = nxt!==1 ? '#ffffff' : 'rgba(255,255,255,0.6)';
}
function _vpSleepTimer(btn){
  const opts=[15,30,60,0];
  const cur=parseInt(btn.dataset.min||'0');
  const nxt=opts[(opts.indexOf(cur)+1)%opts.length];
  btn.dataset.min=nxt;
  if(_sleepTimer){clearTimeout(_sleepTimer);_sleepTimer=null;}
  const lbl = document.getElementById('vp-sleep-lbl');
  if(nxt>0){
    if(lbl){ lbl.textContent=nxt+'分'; }
    btn.style.color='#fff';
    _sleepTimer=setTimeout(()=>{
      if(_audioEl) _audioEl.pause();
      _stopVinylSpin();
      _setPlayIcon(false);
      if(lbl) lbl.textContent='定時';
      btn.style.color='rgba(255,255,255,0.35)';
      btn.dataset.min='0';
    },nxt*60000);
  } else {
    if(lbl) lbl.textContent='定時';
    btn.style.color='rgba(255,255,255,0.35)';
  }
}

// 播放列表彈窗
// ════════════════════════════════════════════════════════════
// 【音頻播放器：播放清單面板】
// ════════════════════════════════════════════════════════════
function openVpPlaylist(){
  const wrap = document.getElementById('vp-playlist-wrap');
  if(!wrap) return;
  const isOpen = wrap.style.maxHeight !== '0px' && wrap.style.maxHeight !== '';
  if(isOpen){ wrap.style.maxHeight='0'; setTimeout(()=>{ wrap.innerHTML=''; },300); return; }

  // 橫向捲動卡片列表（唱盤縮圖 + 名稱）
  const panel = document.createElement('div');
  panel.id = 'vp-playlist-panel';
  panel.className = 'vp-pl-panel';

  // 標題列
  const titleBar = document.createElement('div');
  titleBar.className = 'vp-pl-titlebar';
  const _listCategory = _M.playlist[0]?.category || '';
  titleBar.innerHTML = `
    <div class="vp-pl-title">
      ${_listCategory ? esc(_listCategory) : '播放清單'}
    </div>
    <div class="vp-pl-count">
      共 ${_M.playlist.length} 首
    </div>`;
  panel.appendChild(titleBar);

  // 橫向捲動列
  const row = document.createElement('div');
  row.className = 'vp-pl-row';

  _M.playlist.forEach((m, i)=>{
    const isActive = (i === _M.playIdx);
    const card = document.createElement('div');
    card.className = 'vp-pl-card'+(isActive?' active':'');
    card.onclick = ()=>playAudio(m.id);

    // 唱盤縮圖（小圓形）
    const thumb = document.createElement('div');
    thumb.dataset.pthumb = '1';  // 供非同步 thumbnail 填充識別
    thumb.className = 'vp-pl-thumb'+(isActive?' active':'');
    if(m.thumbnail){
      const img = document.createElement('img');
      img.src = m.thumbnail;
      img.className = 'media-thumb-img audio';
      thumb.appendChild(img);
    } else {
      // 無封面：顯示黑膠紋路圖案
      const inner = document.createElement('div');
      inner.className = 'vp-pl-vinyl';
      thumb.appendChild(inner);
    }
    // 正在播放指示
    if(isActive){
      const dot = document.createElement('div');
      dot.className = 'vp-pl-dot';
      thumb.appendChild(dot);
    }

    // 名稱
    const name = document.createElement('div');
    name.className = 'vp-pl-name'+(isActive?' active':'');
    name.textContent = m.title||'未命名';

    card.appendChild(thumb);
    card.appendChild(name);
    row.appendChild(card);
  });

  panel.appendChild(row);
  wrap.innerHTML = '';
  wrap.appendChild(panel);
  wrap.style.maxHeight = '200px';

  // 非同步填充播放清單的 thumbnail（_M.playlist 沒有 thumbnail 欄位，需按需讀取）
  _M.playlist.forEach((m, i)=>{
    _getMediaThumb(m.id).then(raw=>{
      if(!raw) return;
      const card = row.children[i];
      if(!card) return;
      const thumbDiv = card.querySelector('[data-pthumb]');
      if(!thumbDiv) return;
      const src = (raw instanceof Blob) ? URL.createObjectURL(raw) : raw;
      const img = document.createElement('img');
      img.className = 'media-thumb-img audio';
      if(raw instanceof Blob){ img.onload = ()=> URL.revokeObjectURL(src); }
      img.src = src;
      thumbDiv.innerHTML = '';
      thumbDiv.appendChild(img);
    }).catch(()=>{});
  });

  // 捲動到當前播放項目
  setTimeout(()=>{
    const cards = row.children;
    if(cards[_M.playIdx]){
      cards[_M.playIdx].scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
    }
  },50);
}

// ════════════════════════════════════════════════════════════
// 影片播放器
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// 【影片播放器】
// ════════════════════════════════════════════════════════════
async function playVideo(id){
  const full=await dg('leisuremedia',id);
  if(!full?.blob){
    openMediaDetail(id);
    toast('此影片無附加檔案，可在詳情中刪除');
    return;
  }

  _M.nowId  =id;
  _M.nowType='video';

  const url=URL.createObjectURL(full.blob);
  const ov=document.createElement('div');
  ov.id='video-player-ov';
  ov.className='media-ov-fullplayer video';

  ov.innerHTML=`
    <div class="vvp-topbar">
      <button class="vvp-back" onclick="closeVideoPlayer(${id})"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
      <div class="vvp-title">${esc(full.title||'影片')}</div>
      <button class="vvp-more" onclick="_openVideoMenu(${id},this)">⋮</button>
    </div>
    <div style="flex:1;position:relative;background:#000;display:flex;align-items:center">
      <video id="video-el" controls playsinline preload="metadata"
        style="width:100%;height:100%;object-fit:contain"
        src="${url}"></video>
    </div>`;

  document.body.appendChild(ov);

  const vidEl=document.getElementById('video-el');
  if(full.lastPos>3) vidEl.currentTime=full.lastPos;

  // 更新播放記錄
  full.lastPlay=Date.now();
  full.playCount=(full.playCount||0)+1;
  await dp('leisuremedia',full);

  _showMiniBar(full.title,'video');
}

// 影片右上三點選單
async function _openVideoMenu(id, btn){
  document.getElementById('video-menu-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.id = 'video-menu-sheet';
  sheet.className = 'media-ov-sheet z700';
  sheet.onclick = e=>{ if(e.target===sheet) sheet.remove(); };
  // 先讀取資料再顯示
  const _m = await dg('leisuremedia', id);
  const _favTxt = _m?.favorite ? '已收藏' : '收藏';
  const _favClr = _m?.favorite ? '#ec4899' : 'rgba(255,255,255,0.7)';
  sheet.innerHTML = `
    <div style="width:100%;max-width:520px;margin:0 auto;
      background:var(--bg1);border-radius:20px 20px 0 0;padding:8px 0 32px">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:10px auto 14px"></div>
      <!-- 詳細資料（精簡一行）-->
      <div style="padding:10px 20px 14px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:4px">
          ${esc(_m?.title||'未命名')}
        </div>
        <div style="font-size:11px;color:var(--t2)">
          🎬 影片${_m?.category?' · '+esc(_m.category):''}${_m?.fileSize?' · '+_fmtSize(_m.fileSize):''}
        </div>
      </div>
      <!-- 操作按鈕 -->
      <button id="vvp-menu-fav-btn" onclick="_vvpToggleFavMenu(${id},this)"
        style="width:100%;padding:14px 20px;text-align:left;background:none;border:none;
        color:${_favClr};font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px">
        <span id="vvp-menu-fav-icon" style="font-size:18px">${_m?.favorite?'♥':'♡'}</span>
        <span id="vvp-menu-fav-lbl">${_favTxt}</span>
      </button>
      <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0"></div>
      <button onclick="confirmDeleteMedia(${id});document.getElementById('video-menu-sheet').remove()"
        style="width:100%;padding:14px 20px;text-align:left;background:none;border:none;
        color:var(--red);font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">🗑</span>刪除
      </button>
    </div>`;
  document.body.appendChild(sheet);
}

async function _vvpToggleFavMenu(id, btn){
  try{
    const m = await dg('leisuremedia', id); if(!m) return;
    m.favorite = !m.favorite;
    await dp('leisuremedia', m);
    const icon = document.getElementById('vvp-menu-fav-icon');
    const lbl  = document.getElementById('vvp-menu-fav-lbl');
    const favBtn = document.getElementById('vvp-menu-fav-btn');
    if(icon) icon.textContent = m.favorite ? '♥' : '♡';
    if(lbl)  lbl.textContent  = m.favorite ? '已收藏' : '收藏';
    if(favBtn) favBtn.style.color = m.favorite ? '#ec4899' : 'rgba(255,255,255,0.7)';
    const idx = _M.allMedia.findIndex(x=>x.id===id);
    if(idx>=0) _M.allMedia[idx].favorite = m.favorite;
    toast(m.favorite ? '已加入收藏' : '已取消收藏');
  }catch(e){ logError('_vvpToggleFavMenu',e); }
}

async function closeVideoPlayer(id){
  const ov=document.getElementById('video-player-ov');
  const vidEl=document.getElementById('video-el');
  if(vidEl && id){
    const pos=Math.floor(vidEl.currentTime);
    try{
      const m=await dg('leisuremedia',id);
      if(m){m.lastPos=pos;await dp('leisuremedia',m);}
    }catch(_){}
    vidEl.pause();
    URL.revokeObjectURL(vidEl.src);
  }
  ov?.remove();
  _updateMiniBar();
}

// ════════════════════════════════════════════════════════════
// 迷你播放列（底部常駐）
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// 【迷你播放列】
// ════════════════════════════════════════════════════════════
function _showMiniBar(title, type){
  let bar=document.getElementById('media-mini-bar');
  if(!bar){
    bar=document.createElement('div');
    bar.id='media-mini-bar';
    // 插在 pg-media 的 page 底部之上
    document.getElementById('pg-media').appendChild(bar);
  }
  bar.className='media-mini-bar';
  const icon=type==='audio'?'🎵':'🎬';
  bar.innerHTML=`
    <div class="${type==='audio'?'mmb-vinyl':'mmb-thumb'}"
      onclick="${type==='audio'?`document.getElementById('vinyl-player-ov')?.remove();playAudio(${_M.nowId})`:`document.getElementById('video-player-ov')?.remove();playVideo(${_M.nowId})`}">
      ${icon}
    </div>
    <div class="mmb-info"
      onclick="${type==='audio'?`document.getElementById('vinyl-player-ov')?.remove();playAudio(${_M.nowId})`:`document.getElementById('video-player-ov')?.remove();playVideo(${_M.nowId})`}">
      <div class="mmb-title">${esc(title||'')}</div>
      <div class="mmb-status">正在播放</div>
    </div>
    ${type==='audio'?`
    <button class="mmb-btn" onclick="_vpToggle()" title="播放/暫停">⏯</button>
    <button class="mmb-btn" onclick="_vpNext()" title="下一首">⏭</button>`
    :''}
    <button class="mmb-btn" onclick="${type==='audio'?'closeVinylPlayer()':'closeVideoPlayer('+_M.nowId+')'}">✕</button>`;
}

function _updateMiniBar(){
  const bar=document.getElementById('media-mini-bar');
  if(bar) bar.remove();
  _M.nowId=null; _M.nowType=null;
}

function _updateAudioRowHighlight(id){
  // 清除舊高亮
  document.querySelectorAll('.media-arow').forEach(r=>{
    r.querySelector('.mar-title')?.classList.remove('playing');
    r.querySelector('.mar-vinyl')?.classList.remove('spinning');
  });
  const row=document.getElementById(`arow-${id}`);
  if(row){
    row.querySelector('.mar-title')?.classList.add('playing');
    row.querySelector('.mar-vinyl')?.classList.add('spinning');
  }
}

// ════════════════════════════════════════════════════════════
// 新增影音（上傳表單）
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// 【新增影音：上傳表單】
// ════════════════════════════════════════════════════════════
function openAddMedia(){
  const ov=document.createElement('div');
  ov.id='add-media-ov';
  ov.className='media-ov-sheet z500';
  ov.innerHTML=`
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:90vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
      <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:14px">新增影音</div>

      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div id="am-thumb-preview" onclick="document.getElementById('am-thumb-inp').click()"
          style="width:72px;height:72px;border-radius:10px;background:rgba(255,255,255,0.06);
          border:1.5px dashed rgba(255,255,255,0.2);cursor:pointer;flex-shrink:0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          font-size:10px;color:var(--t2);gap:4px">
          <span style="font-size:22px">🖼</span>縮圖
        </div>
        <input type="file" id="am-thumb-inp" accept="image/*" style="display:none"
          onchange="previewMediaThumb(this)">
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
          <input id="am-title" placeholder="標題 *" class="finput">
          <input id="am-category" placeholder="分類（如：法律課程）" class="finput">
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--t2);margin-bottom:5px">類型</div>
        <div style="display:flex;gap:8px">
          <button id="am-type-video" onclick="setAmType('video',this)"
            style="flex:1;padding:8px;border-radius:8px;border:1.5px solid var(--acc);
            background:rgba(110,168,254,0.15);color:var(--acc);font-size:13px;cursor:pointer">🎬 影片</button>
          <button id="am-type-audio" onclick="setAmType('audio',this)"
            style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);
            background:rgba(255,255,255,0.04);color:var(--t2);font-size:13px;cursor:pointer">🎵 音頻</button>
        </div>
      </div>

      <label style="font-size:11px;color:var(--t2);display:flex;align-items:center;
        gap:8px;margin-bottom:16px">
        <button onclick="document.getElementById('am-file-inp').click()"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--bd);color:var(--t1);
          padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer">選擇檔案</button>
        <span id="am-file-lbl" style="color:var(--t2);flex:1;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis">尚未選擇（可空）</span>
        <input type="file" id="am-file-inp" accept="video/*,audio/*" style="display:none"
          onchange="am_onFileChange(this)">
      </label>

      <div id="am-compress-box" style="margin-bottom:16px">
        <div style="font-size:11px;color:var(--t2);margin-bottom:5px">儲存方式</div>
        <div style="display:flex;gap:8px">
          <button id="am-comp-none" onclick="setAmCompress(false,this)"
            style="flex:1;padding:8px;border-radius:8px;border:1.5px solid var(--acc);
            background:rgba(110,168,254,0.15);color:var(--acc);font-size:12px;cursor:pointer">
            原檔（音質最佳）</button>
          <button id="am-comp-on" onclick="setAmCompress(true,this)"
            style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);
            background:rgba(255,255,255,0.04);color:var(--t2);font-size:12px;cursor:pointer">
            壓縮（省空間）</button>
        </div>
        <div style="font-size:10px;color:var(--t2);margin-top:5px;line-height:1.5">
          壓縮會降低取樣率與聲道（適合人聲、課程錄音；音樂建議用原檔）。若壓縮後反而變大，將自動保留原檔。
        </div>
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('add-media-ov').remove()"
          style="flex:1;padding:12px;background:rgba(255,255,255,0.06);border:1px solid var(--bd);
          color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">取消</button>
        <button onclick="saveNewMedia()"
          style="flex:2;padding:12px;background:rgba(37,98,200,0.85);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700">儲存</button>
      </div>
    </div>`;
  ov.onclick=e=>{if(e.target===ov) ov.remove();};
  document.body.appendChild(ov);
  // 預設選影片
  window._amType='video';
  window._amCompress=false;  // 預設原檔
  // 預設影片，壓縮框先隱藏
  const _cbox=document.getElementById('am-compress-box');
  if(_cbox) _cbox.style.display='none';
}

function setAmCompress(on, btn){
  window._amCompress=on;
  const map={ 'am-comp-none':!on, 'am-comp-on':on };
  for(const id in map){
    const b=document.getElementById(id);
    if(!b) continue;
    const active=map[id];
    b.style.borderColor=active?'var(--acc)':'rgba(255,255,255,0.12)';
    b.style.background=active?'rgba(110,168,254,0.15)':'rgba(255,255,255,0.04)';
    b.style.color=active?'var(--acc)':'var(--t2)';
    b.style.borderWidth=active?'1.5px':'1px';
  }
}

function setAmType(type, btn){
  window._amType=type;
  ['video','audio'].forEach(t=>{
    const b=document.getElementById(`am-type-${t}`);
    if(!b) return;
    const on=t===type;
    b.style.borderColor=on?'var(--acc)':'rgba(255,255,255,0.12)';
    b.style.background=on?'rgba(110,168,254,0.15)':'rgba(255,255,255,0.04)';
    b.style.color=on?'var(--acc)':'var(--t2)';
  });
  // 壓縮選項僅音頻顯示（影片壓縮瀏覽器端不可靠，隱藏）
  const cbox=document.getElementById('am-compress-box');
  if(cbox) cbox.style.display = type==='audio' ? 'block' : 'none';
}

function previewMediaThumb(inp){
  if(!inp.files[0]) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const p=document.getElementById('am-thumb-preview');
    if(p){
      p.innerHTML=`<img src="${e.target.result}"
        style="width:100%;height:100%;object-fit:cover;border-radius:10px">`;
      p.style.border='none';
    }
  };
  reader.readAsDataURL(inp.files[0]);
}

function am_onFileChange(inp){
  const f=inp.files[0];
  if(!f) return;
  const lbl=document.getElementById('am-file-lbl');
  if(lbl) lbl.textContent=f.name;
  // 自動判斷類型
  const type=f.type.startsWith('video/')?'video':'audio';
  setAmType(type,document.getElementById(`am-type-${type}`));
}

async function saveNewMedia(){
  const title=document.getElementById('am-title')?.value.trim();
  if(!title){toast('請填寫標題');return;}
  const thumbInp=document.getElementById('am-thumb-inp');
  const fileInp =document.getElementById('am-file-inp');
  let thumbnail=null;
  if(thumbInp?.files[0]){
    thumbnail=await _compressMediaThumb(thumbInp.files[0]);
  }
  let blob = fileInp?.files[0]||null;
  let fileSize = blob?.size||0;
  // 音頻 + 選擇壓縮：降取樣率/單聲道重新編碼（只在確實變小時採用）
  if(blob && window._amType==='audio' && window._amCompress){
    try{
      toast('壓縮中…');
      const compressed = await _compressAudio(blob);
      if(compressed && compressed.size < blob.size){
        blob = compressed; fileSize = compressed.size;
        toast('壓縮完成，已省空間');
      } else {
        toast('壓縮後未變小，保留原檔');
      }
    }catch(e){ logError('_compressAudio',e); toast('壓縮失敗，保留原檔'); }
  }
  const media={
    title,
    type:     window._amType||'video',
    category: document.getElementById('am-category')?.value.trim()||'',
    fileType: fileInp?.files[0]?.name.split('.').pop().toLowerCase()||'',
    fileSize: fileSize,
    blob:     blob,
    thumbnail,
    duration: null,
    tags:     [],
    favorite: false,
    lastPlay: null,
    lastPos:  0,
    playCount:0,
    createdAt:Date.now(),
  };
  try{
    await dp('leisuremedia',media);
    toast('已新增：'+title);
    document.getElementById('add-media-ov')?.remove();
    renderMedia();
  }catch(e){logError('saveNewMedia',e);toast('儲存失敗：'+e.message);}
}

// 音訊壓縮：Web Audio 解碼 → 降取樣率(22050)+單聲道 → 編成 WAV
// 適合語音；瀏覽器原生不支援 MP3 編碼，故用 WAV（靠降規格省空間）
// ════════════════════════════════════════════════════════════
// 【新增影音：音訊壓縮（WebAudio→WAV）】
// ════════════════════════════════════════════════════════════
async function _compressAudio(file){
  const arrayBuf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const tmpCtx = new AC();
  const decoded = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
  tmpCtx.close();
  const targetRate = 22050;        // 降取樣率（語音足夠）
  const targetCh   = 1;            // 單聲道
  const duration   = decoded.duration;
  const frames     = Math.ceil(duration * targetRate);
  if(!frames || frames < 1) throw new Error('音檔長度為 0，無法壓縮');
  const offline = new OfflineAudioContext(targetCh, frames, targetRate);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = decoded;
  srcNode.connect(offline.destination);
  srcNode.start(0);
  const rendered = await offline.startRendering();
  return _audioBufferToWavBlob(rendered);
}

// AudioBuffer → WAV Blob（16-bit PCM）
function _audioBufferToWavBlob(buffer){
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const wStr=(off,s)=>{ for(let i=0;i<s.length;i++) view.setUint8(off+i, s.charCodeAt(i)); };
  wStr(0,'RIFF'); view.setUint32(4, 36+dataSize, true); wStr(8,'WAVE');
  wStr(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
  view.setUint16(22,numCh,true); view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*blockAlign,true); view.setUint16(32,blockAlign,true);
  view.setUint16(34,16,true); wStr(36,'data'); view.setUint32(40,dataSize,true);
  // 交錯寫入 16-bit PCM
  let offset=44;
  const chans=[];
  for(let c=0;c<numCh;c++) chans.push(buffer.getChannelData(c));
  for(let i=0;i<numFrames;i++){
    for(let c=0;c<numCh;c++){
      let s=Math.max(-1,Math.min(1,chans[c][i]));
      view.setInt16(offset, s<0 ? s*0x8000 : s*0x7FFF, true);
      offset+=2;
    }
  }
  return new Blob([ab], {type:'audio/wav'});
}

function _compressMediaThumb(file){
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        const maxW=240,maxH=240;  // 詳情頁顯示 120px，存 2x 供高解析螢幕清晰
        let w=img.width,h=img.height;
        const scale=Math.min(maxW/w,maxH/h,1);
        canvas.width=Math.round(w*scale);
        canvas.height=Math.round(h*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        // Blob 比 base64 少 33% 空間
        canvas.toBlob(blob=>resolve(blob),'image/jpeg',0.8);
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════
// 影音詳情 / 下載 / 收藏 / 刪除
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// 【影音詳情頁】
// ════════════════════════════════════════════════════════════
async function openMediaDetail(id){
  const m=await dg('leisuremedia',id);
  if(!m){toast('找不到');return;}
  document.getElementById('media-detail-ov')?.remove();
  // 縮圖按需讀取（與列表同機制）：可能是 Blob（新）或 base64（舊）
  const rawThumb = await _getMediaThumb(id);
  let thumbUrl='';
  if(rawThumb instanceof Blob) thumbUrl=URL.createObjectURL(rawThumb);
  else if(typeof rawThumb==='string') thumbUrl=rawThumb;
  const isAudio=m.type!=='video';
  // 有縮圖顯示圖；無縮圖：音頻顯示黑膠唱片圈+音符、影片顯示 🎬
  const thumbHtml=thumbUrl
    ? `<img src="${thumbUrl}" alt="" class="media-detail-thumb${isAudio?' audio':''}">`
    : isAudio
      ? `<div class="media-detail-thumb audio vinyl">🎵</div>`
      : `<div class="media-detail-thumb placeholder">🎬</div>`;
  const ov=document.createElement('div');
  ov.id='media-detail-ov';
  ov.className='media-ov-sheet z700-d';
  ov.innerHTML=`
    <div class="media-detail-panel">
      <div class="media-detail-handle"></div>
      <div class="media-detail-thumb-wrap">${thumbHtml}</div>
      <!-- 詳細資料 -->
      <div style="padding:0 20px 16px">
        <div style="font-size:16px;font-weight:700;color:var(--t0);margin-bottom:8px;text-align:center">
          ${esc(m.title||'未命名')}
        </div>
        <div style="font-size:12px;color:var(--t2);line-height:2">
          <div>${m.type==='video'?'🎬 影片':'🎵 音頻'}</div>
          ${m.category?`<div>分類：${esc(m.category)}</div>`:''}
          ${m.fileSize?`<div>大小：${_fmtSize(m.fileSize)}</div>`:''}
          <div>新增：${m.createdAt?new Date(m.createdAt).toLocaleDateString('zh-TW'):'-'}</div>
          ${m.lastPlay?`<div>上次播放：${new Date(m.lastPlay).toLocaleDateString('zh-TW')}</div>`:''}
          ${m.playCount?`<div>播放次數：${m.playCount}</div>`:''}
        </div>
      </div>
      <div style="height:1px;background:rgba(255,255,255,0.06);margin:0 0 8px"></div>
      <button onclick="document.getElementById('media-detail-ov').remove()"
        style="display:flex;align-items:center;justify-content:center;gap:8px;
        width:100%;padding:12px 20px;background:none;border:none;
        color:var(--t2);font-size:14px;cursor:pointer">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg> 關閉
      </button>
    </div>`;
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  document.body.appendChild(ov);
}

async function _detailToggleFav(id, btn){
  try{
    const m = await dg('leisuremedia',id); if(!m) return;
    m.favorite = !m.favorite;
    await dp('leisuremedia', m);
    btn.textContent = m.favorite ? '♥ 已收藏' : '♡ 收藏';
    btn.style.color = m.favorite ? '#ec4899' : 'rgba(255,255,255,0.7)';
    const idx = _M.allMedia.findIndex(x=>x.id===id);
    if(idx>=0) _M.allMedia[idx].favorite = m.favorite;
    toast(m.favorite ? '已加入收藏' : '已取消收藏');
  }catch(e){ logError('_detailToggleFav',e); }
}

async function toggleMediaFav(id,btn){
  try{
    const m=await dg('leisuremedia',id);if(!m)return;
    m.favorite=!m.favorite;await dp('leisuremedia',m);
    btn.className=`mv-fav-btn${m.favorite?' on':''}`;
    btn.textContent=m.favorite?'★':'☆';
    const idx=_M.allMedia.findIndex(x=>x.id===id);
    if(idx>=0) _M.allMedia[idx].favorite=m.favorite;
  }catch(e){logError('toggleMediaFav',e);}
}

async function confirmDeleteMedia(id){
  if(!confirm('確定刪除？此操作無法復原。')) return;
  await dd('leisuremedia',id);
  _M.allMedia=_M.allMedia.filter(m=>m.id!==id);
  _renderMediaPage();toast('已刪除');
  document.getElementById('media-detail-ov')?.remove();
}

// ════════════════════════════════════════════════════════════
// 篩選 / 搜尋觸發
// ════════════════════════════════════════════════════════════

// 點「更多」切換篩選；已在該篩選則切回全部（toggle）
function searchMedia(){
  _M.kw=(document.getElementById('media-si')?.value||'').trim();
  _M.page=0;
  _M.expandPage=0;  // 搜尋變動回到第一頁
  if(_M.kw){
    // 有關鍵字：進入搜尋展開模式
    _M.expandMode='search';
  } else if(_M.expandMode==='search'){
    // 清空搜尋：回首頁
    _M.expandMode=null;
  }
  _renderMediaPage();
}

// ════════════════════════════════════════════════════════════
// 工具
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// 【工具函式（時長/大小格式化）】
// ════════════════════════════════════════════════════════════
function _fmtDur(sec){
  if(!sec) return '';
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=Math.floor(sec%60);
  return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
function _fmtDurSec(sec){
  if(!sec||isNaN(sec)) return '0:00';
  const m=Math.floor(sec/60),s=Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
// _fmtSize 已於 books.js 定義（共用），此處不重複定義
