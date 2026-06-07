// ══ books.js — 書庫（高質感書架版）══════════════════════════
// 依賴：db.js（_db, dp, dd, dg, logError, updateEbookProgress）
// 頁面：pg-books
// ════════════════════════════════════════════════════════════

// ── 狀態 ────────────────────────────────────────────────────
const _B = {
  filter:    'all',
  kw:        '',
  page:      0,
  PAGE:      30,
  allBooks:  [],
  mode:      'spine',
  bulkMode:  false,
  bulkSelected: new Set(),
};

// ── 尺寸換算 ─────────────────────────────────────────────────
// 1mm → px（基於手機螢幕合理顯示大小）
const MM_TO_PX = 1.7;
function mmToPx(mm){ return Math.round(mm * MM_TO_PX); }

// 預設尺寸（mm）：A5 平裝書
const _BOOK_DEFAULT_MM = {
  thickMM:  20,
  heightMM: 210,
  widthMM:  148,
};

// 書背視覺修正：書背厚度 × 1.5（讓書名可讀）
const SPINE_SCALE = 1.5;
// 書高顯示縮放（手機螢幕限制）
const HEIGHT_SCALE = 0.5;

// ── 書背顏色主題（依 id 分配）────────────────────────────────
const _SPINE_THEMES = [
  { bg:'#1e2d4e', light:'#4a7ab5', dark:'#0e1a2e' },  // 深藍
  { bg:'#2d1e1e', light:'#b54a4a', dark:'#1a0e0e' },  // 深紅
  { bg:'#1e2d1e', light:'#4ab54a', dark:'#0e1a0e' },  // 深綠
  { bg:'#2d241e', light:'#b5844a', dark:'#1a150e' },  // 深棕
  { bg:'#24182d', light:'#844ab5', dark:'#150e1a' },  // 深紫
  { bg:'#1e2d2d', light:'#4ab5b5', dark:'#0e1a1a' },  // 深青
  { bg:'#2d1e24', light:'#b54a84', dark:'#1a0e15' },  // 玫瑰
  { bg:'#242d1e', light:'#84b54a', dark:'#151a0e' },  // 橄欖
  { bg:'#2d2820', light:'#b5a050', dark:'#1a1610' },  // 金棕
  { bg:'#1e2028', light:'#5060b5', dark:'#0e1018' },  // 靛藍
];

// ════════════════════════════════════════════════════════════
// 書庫渲染入口
// ════════════════════════════════════════════════════════════
async function renderBooks(){
  try{
    _B.page     = 0;
    _B.allBooks = await _getBooksMetaList();
    _renderBooksPage();
  }catch(e){ logError('renderBooks',e); }
}

async function _getBooksMetaList(){
  const all = await _db.ebooks.toArray();
  // blob/coverBlob（大檔）和 coverThumb/spineThumb（縮圖）都排除
  // 縮圖透過 _getBookThumb(id) 按需讀取，避免清單載入時一次吃掉所有縮圖記憶體
  return all.map(({blob:_b, coverBlob:_cb, coverThumb:_ct, spineThumb:_st, ...meta}) => meta);
}

// 按需讀取單本縮圖（回傳 {coverThumb, spineThumb} 或 {}）
async function _getBookThumb(id){
  try{
    const row = await _db.ebooks.get(id);
    return { coverThumb: row?.coverThumb, spineThumb: row?.spineThumb };
  }catch(e){ return {}; }
}

// 書背縮圖 lazy 覆蓋（有 spineThumb 才覆蓋，無則保持純色書背）

// 非同步填充縮圖到指定元素
async function _fillThumb(el, id, type){
  try{
    const th = await _getBookThumb(id);
    const raw = type==='spine' ? th.spineThumb : th.coverThumb;
    if(!raw || !el || !el.isConnected) return;
    // 相容舊 base64 字串和新 Blob
    const src = (raw instanceof Blob) ? URL.createObjectURL(raw) : raw;
    const img = document.createElement('img');
    img.loading = 'lazy'; img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    if(raw instanceof Blob){
      img.onload = ()=> URL.revokeObjectURL(src);  // 顯示後立即釋放
    }
    img.src = src;
    if(el.isConnected){ el.innerHTML=''; el.appendChild(img); }
  }catch(e){}
}

// ── 主渲染邏輯 ───────────────────────────────────────────────
function _renderBooksPage(){
  const el  = document.getElementById('books-list');
  const cnt = document.getElementById('books-count');
  if(!el) return;

  const filtered = _filteredBooks();
  if(cnt) cnt.textContent = filtered.length ? `共 ${filtered.length} 本` : '';

  el.innerHTML = '';

  // 最近閱讀區（首次進入且無篩選時顯示）
  if(_B.filter==='all' && !_B.kw){
    const recent = [..._B.allBooks]
      .filter(b=>b.lastRead)
      .sort((a,b)=>(b.lastRead||0)-(a.lastRead||0))
      .slice(0,10);
    if(recent.length) el.appendChild(_mkRecentSection(recent));
  }

  // 模式切換列
  el.appendChild(_mkModeBar());

  if(!filtered.length){
    const emptyDiv = document.createElement('div');
    emptyDiv.className='empty';
    emptyDiv.style.cssText='padding:40px 0';
    emptyDiv.innerHTML='<span class="ic">📚</span><span>' +
      (_B.filter==='fav' ? '尚未收藏任何書籍' : '尚無書籍') + '</span>';
    el.appendChild(emptyDiv);
    return;
  }

  const batch = filtered.slice(0, (_B.page+1)*_B.PAGE);

  if(_B.mode === 'spine'){
    const shelfEl = _mkShelf(batch, filtered.length);
    el.appendChild(shelfEl);
    if(_sortMode) _enableDragSort(shelfEl, _B.allBooks);
  }
  else if(_B.mode === 'cover') el.appendChild(_mkCoverGrid(batch, filtered.length));
  else                          el.appendChild(_mkListView(batch, filtered.length));

  // 批量模式：底部確認列
  if(_B.bulkMode){
    const bar=document.createElement('div');
    bar.style.cssText=`position:sticky;bottom:0;background:var(--bg1);
      border-top:1px solid rgba(255,255,255,0.08);
      padding:12px 14px;display:flex;gap:10px;z-index:10`;
    bar.innerHTML=`
      <button onclick="toggleBooksBulk(document.getElementById('books-bulk-btn'))"
        style="flex:1;padding:11px;background:rgba(255,255,255,0.06);border:1px solid var(--bd);
        color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">取消</button>
      <button id="books-bulk-confirm" onclick="_executeBooksDelete()"
        style="flex:2;padding:11px;background:rgba(200,50,50,0.8);color:#fff;
        border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700">
        刪除 0 本</button>`;
    el.appendChild(bar);
  }

  // 無限捲動
  if(batch.length < filtered.length){
    const trig = document.createElement('div');
    trig.style.height='20px';
    el.appendChild(trig);
    const obs = new IntersectionObserver(entries=>{
      if(entries[0].isIntersecting){ obs.disconnect(); _B.page++; _renderBooksPage(); }
    },{rootMargin:'80px'});
    obs.observe(trig);
  }
}

// ── 最近閱讀橫向捲動區 ──────────────────────────────────────
function _mkRecentSection(books){
  const wrap = document.createElement('div');
  wrap.className = 'shelf-recent-wrap';
  wrap.innerHTML = `<div class="shelf-recent-title">📖 最近閱讀</div>`;
  const row = document.createElement('div');
  row.className = 'shelf-recent-row';
  books.forEach(b=>{
    const card = document.createElement('div');
    card.className = 'shelf-recent-card';
    card.onclick = ()=> openBookCover(b.id);
    const cover = document.createElement('div');
    cover.className = 'shelf-recent-cover';
    if(b.coverThumb){
      cover.innerHTML=`<img src="${b.coverThumb}" loading="lazy" alt="">`;
    } else if(b.id){
      // _B.allBooks 不含縮圖，非同步填充
      _fillThumb(cover, b.id, 'cover');
    } else {
      cover.innerHTML=`<div class="shelf-recent-cover-placeholder">${esc(b.title||'')}</div>`;
      const t = _SPINE_THEMES[(b.id||0) % _SPINE_THEMES.length];
      cover.style.background=`linear-gradient(160deg,${t.bg},${t.dark})`;
    }
    const name = document.createElement('div');
    name.className='shelf-recent-name';
    name.textContent = b.title||'未命名';
    card.appendChild(cover);
    card.appendChild(name);
    row.appendChild(card);
  });
  wrap.appendChild(row);
  return wrap;
}

// ── 模式切換列 ───────────────────────────────────────────────
function _mkModeBar(){
  const bar = document.createElement('div');
  bar.className='shelf-mode-bar';
  // 「藏書 / 收藏」切換標題（點擊切換）
  const isShowingFav = _B.filter === 'fav';
  bar.innerHTML=`
    <div style="display:flex;align-items:center;gap:0">
      <button class="shelf-section-tab${!isShowingFav?' on':''}"
        onclick="toggleShelfSection('all')">藏書</button>
      <span style="color:rgba(255,200,80,0.3);font-size:14px;padding:0 4px">｜</span>
      <button class="shelf-section-tab${isShowingFav?' on':''}"
        onclick="toggleShelfSection('fav')">收藏</button>
    </div>
    <div class="shelf-mode-btns">
      <button class="shelf-mode-btn${_B.mode==='spine'?' on':''}"
        onclick="setBooksMode('spine',this)">書架</button>
      <button class="shelf-mode-btn${_B.mode==='cover'?' on':''}"
        onclick="setBooksMode('cover',this)">封面</button>
      <button class="shelf-mode-btn${_B.mode==='list'?' on':''}"
        onclick="setBooksMode('list',this)">清單</button>
    </div>`;
  return bar;
}

// 藏書 / 收藏 切換
function toggleShelfSection(section){
  _B.filter = section;
  _B.page = 0;
  _renderBooksPage();
}

function setBooksMode(mode, btn){
  _B.mode = mode;
  document.querySelectorAll('.shelf-mode-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  // 只重渲染內容區（不重跑 renderBooksPage 以免清掉最近閱讀）
  const el = document.getElementById('books-list');
  if(el) _renderBooksPage();
}

// ════════════════════════════════════════════════════════════
// 書架模式（spine）
// ════════════════════════════════════════════════════════════
function _mkShelf(books, total){
  const shelf = document.createElement('div');
  shelf.className = 'bookshelf';

  // 取書架容器的實際寬度，避免計算時容器還未渲染（fallback 用 window.innerWidth）
  const shelfEl = document.getElementById('books-list');
  const containerW = Math.min(
    (shelfEl ? shelfEl.clientWidth : window.innerWidth) || window.innerWidth,
    540
  ) - 28;
  const GAP = 2;

  let rowDiv = null, plankEl = null, topEl = null;
  let rowUsed = 0;
  let rowMaxH = 0;

  function _newRow(){
    if(rowDiv){
      // 結束上一排：加空位槽
      const slot = document.createElement('div');
      slot.className='shelf-empty-slot';
      rowDiv.appendChild(slot);
      shelf.appendChild(plankEl);
    }
    // 頂板
    topEl = document.createElement('div');
    topEl.className='shelf-top-plank';
    shelf.appendChild(topEl);

    rowDiv = document.createElement('div');
    rowDiv.className='shelf-row';
    shelf.appendChild(rowDiv);

    // 底板
    plankEl = document.createElement('div');
    plankEl.className='shelf-plank';

    rowUsed = 0;
    rowMaxH = 0;
  }

  _newRow(); // 起始第一排

  books.forEach(b=>{
    const thickMM  = b.thickMM  || _BOOK_DEFAULT_MM.thickMM;
    const heightMM = b.heightMM || _BOOK_DEFAULT_MM.heightMM;
    // 書架高度固定（讓所有書等高，視覺整齊）
    const SHELF_H = 160;   // 固定書架顯示高度（px）
    const MIN_W   = 18;    // 最薄書的最小寬度（px）
    const dispH = SHELF_H;
    // 書背寬按真實比例（厚度/高度），最小 MIN_W 避免太窄
    const dispW = Math.max(MIN_W, Math.round(SHELF_H * thickMM / heightMM));

    if(rowUsed + dispW + GAP > containerW && rowUsed > 0){
      _newRow();
    }
    rowDiv.appendChild(_mkSpine(b, dispW, dispH));
    rowUsed += dispW + GAP;
    rowMaxH  = Math.max(rowMaxH, dispH);
  });

  // 最後一排：加空位和底板
  if(rowDiv){
    const slot = document.createElement('div');
    slot.className='shelf-empty-slot';
    rowDiv.appendChild(slot);
    shelf.appendChild(plankEl);
  }

  // 填充層：讓書架延伸到 min-height 時不出現無書板的裸木背景
  // 加一個純空書架層（頂板 + 空位 + 底板）當視覺填充
  const fillTop = document.createElement('div');
  fillTop.className = 'shelf-top-plank';
  shelf.appendChild(fillTop);

  const fillRow = document.createElement('div');
  fillRow.className = 'shelf-row shelf-fill-row';
  fillRow.style.cssText = 'flex:1;min-height:60px';  // 撐滿剩餘空間
  const fillSlot = document.createElement('div');
  fillSlot.className = 'shelf-empty-slot';
  fillRow.appendChild(fillSlot);
  shelf.appendChild(fillRow);

  const fillPlank = document.createElement('div');
  fillPlank.className = 'shelf-plank';
  shelf.appendChild(fillPlank);

  return shelf;
}

function _mkSpine(b, dispW, dispH){
  const div = document.createElement('div');
  div.className = 'book-spine';
  div.style.width  = dispW + 'px';
  div.style.height = dispH + 'px';
  div.title = b.title||'';
  div.dataset.bid  = b.id||'';

  const t = _SPINE_THEMES[(b.id||0) % _SPINE_THEMES.length];

  // 底層：純色漸層+書名（當作佔位，有書背圖時 lazy 覆蓋）
  div.style.background =
    `linear-gradient(90deg,${t.dark} 0%,${t.bg} 30%,${t.light}22 50%,${t.bg} 70%,${t.dark} 100%)`;

  const fontSize = Math.max(9, Math.min(13, Math.round(dispW * 0.38)));
  const label = document.createElement('div');
  label.className = 'spine-label';
  label.style.fontSize = fontSize + 'px';
  label.textContent = b.title || '未命名';
  div.appendChild(label);

  if(b.author && dispW >= 20){
    const auth = document.createElement('div');
    auth.className = 'spine-author';
    auth.textContent = b.author;
    div.appendChild(auth);
  }

  // Lazy 讀取書背縮圖：
  // - hasSpineImg=true（有上傳書背圖）→ 覆蓋後隱藏書名（書背圖本身已有資訊）
  // - hasSpineImg=false（模糊封面）→ 覆蓋後保留書名疊在上面（模糊圖+書名）
  if(b.id){
    _getBookThumb(b.id).then(th=>{
      const raw = th.spineThumb;
      if(!raw || !div.isConnected) return;
      const src = (raw instanceof Blob) ? URL.createObjectURL(raw) : raw;
      const img = document.createElement('img');
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
      if(raw instanceof Blob) img.onload = ()=> URL.revokeObjectURL(src);
      img.src = src;
      if(div.isConnected){
        div.style.position = 'relative';
        if(b.hasSpineImg){
          // 有上傳書背圖：隱藏文字，書背圖本身就是書背
          div.querySelectorAll('.spine-label,.spine-author').forEach(el=>el.style.display='none');
          div.appendChild(img);
        } else {
          // 模糊封面：圖在最底層加 CSS blur，書名置中疊在上面（不顯示作者）
          img.style.zIndex    = '0';
          img.style.filter    = 'blur(8px)';    // 加大 blur，搭配 canvas 縮放雙重模糊
          img.style.transform = 'scale(1.25)';  // 放大避免 blur 邊緣透明
          const spineLabel = div.querySelector('.spine-label');
          const spineAuth  = div.querySelector('.spine-author');
          if(spineLabel){
            // 不覆蓋 position:absolute（CSS 已設 inset:0 確保填滿和水平置中）
            spineLabel.style.zIndex     = '2';
            spineLabel.style.color      = '#fff';
            spineLabel.style.textShadow = '0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.6)';
          }
          if(spineAuth) spineAuth.style.display = 'none';  // 作者不顯示
          div.insertBefore(img, div.firstChild);
        }
      }
    }).catch(()=>{});
  }

  // 收藏操作已移至書籍資訊視窗（openBookDetail）

  // 排序模式：cursor grab，不觸發點擊（拖拉才操作）
  // 批量模式：勾選；一般模式：抽書動畫
  if(_sortMode){
    // 排序模式：drag 已在 _enableDragSort 設定，onclick 不執行任何動作
    div.onclick = e => e.stopPropagation();
  } else if(_B.bulkMode){
    div.style.cursor='pointer';
    if(_B.bulkSelected.has(b.id)) div.style.outline='3px solid var(--acc)';
    div.onclick = ()=> _toggleBookSelect(b.id, div);
  } else {
    div.onclick = ()=> _pullBook(b.id, div);
  }
  return div;
}

// 抽書動畫後開啟詳情
function _pullBook(id, el){
  if(el.classList.contains('pulling')) return;
  el.classList.add('pulling');
  setTimeout(()=>{
    el.classList.remove('pulling');
    openBookCover(id);
  }, 200);
}

// ════════════════════════════════════════════════════════════
// 封面牆模式（cover）
// ════════════════════════════════════════════════════════════
function _mkCoverGrid(books, total){
  const grid = document.createElement('div');
  grid.className='shelf-cover-grid';
  books.forEach(b=>{
    const card=document.createElement('div');
    card.className='shelf-cover-card';
    card.onclick=()=>_B.bulkMode?_toggleBookSelect(b.id,card.querySelector('.shelf-cover-img')):openBookCover(b.id);
    const t=_SPINE_THEMES[(b.id||0)%_SPINE_THEMES.length];
    const img=document.createElement('div');
    img.className='shelf-cover-img';
    if(b.coverThumb){
      _fillThumb(img, b.id, 'cover');
    } else {
      img.style.background=`linear-gradient(160deg,${t.bg},${t.dark})`;
      img.innerHTML=`<div style="width:100%;height:100%;display:flex;align-items:center;
        justify-content:center;writing-mode:vertical-rl;font-size:11px;
        color:rgba(255,255,255,0.6);text-align:center;padding:6px;
        line-height:1.4;word-break:break-all">${esc(b.title||'未命名')}</div>`;
    }
    const name=document.createElement('div');
    name.className='shelf-cover-name';
    name.textContent=b.title||'未命名';
    // 底部操作列
    const actions=document.createElement('div');
    actions.style.cssText='display:flex;align-items:center;justify-content:center;margin-top:2px';
    const favBtn=document.createElement('button');
    favBtn.style.cssText='background:none;border:none;cursor:pointer;font-size:14px;padding:2px 6px';
    favBtn.textContent=b.favorite?'♥':'♡';
    favBtn.style.color=b.favorite?'#ec4899':'rgba(255,255,255,0.3)';
    favBtn.onclick=e=>{e.stopPropagation();_quickToggleBookFav(b.id,favBtn);};
    actions.appendChild(favBtn);
    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(actions);
    grid.appendChild(card);
  });
  return grid;
}

// ════════════════════════════════════════════════════════════
// 清單模式（list，適合 BOOX）
// ════════════════════════════════════════════════════════════
function _mkListView(books, total){
  const wrap=document.createElement('div');
  books.forEach(b=>{
    const item=document.createElement('div');
    item.className='shelf-list-item';
    item.onclick=()=>_B.bulkMode?_toggleBookSelect(b.id,item):openBookDetail(b.id);
    const t=_SPINE_THEMES[(b.id||0)%_SPINE_THEMES.length];
    const cover=document.createElement('div');
    cover.className='shelf-list-cover';
    if(b.coverThumb){
      cover.innerHTML=`<img src="${b.coverThumb}" loading="lazy" alt="">`;
    } else if(b.id){
      // _B.allBooks 不含縮圖，非同步填充
      _fillThumb(cover, b.id, 'cover');
    } else {
      cover.style.background=`linear-gradient(160deg,${t.bg},${t.dark})`;
    }
    const info=document.createElement('div');
    info.className='shelf-list-info';
    const pct = b.lastPage && b.totalPages ? Math.round(b.lastPage/b.totalPages*100) : 0;
    info.innerHTML=`
      <div class="shelf-list-title">${esc(b.title||'未命名')}</div>
      <div class="shelf-list-meta">
        ${b.author?esc(b.author)+' · ':''}${(b.fileType||'').toUpperCase()||'書'}
        ${b.fileSize?' · '+_fmtSize(b.fileSize):''}
      </div>
      ${pct>0?`<div class="shelf-list-progress">
        <div class="shelf-list-progress-fill" style="width:${pct}%"></div>
      </div>`:''}`;
    const favBtn=document.createElement('button');
    favBtn.style.cssText='background:none;border:none;cursor:pointer;font-size:18px;padding:8px;flex-shrink:0';
    favBtn.textContent=b.favorite?'♥':'♡';
    favBtn.style.color=b.favorite?'#ec4899':'rgba(255,255,255,0.25)';
    favBtn.onclick=e=>{e.stopPropagation();_quickToggleBookFav(b.id,favBtn);};
    item.appendChild(cover);
    item.appendChild(info);

    wrap.appendChild(item);
  });
  return wrap;
}

// ════════════════════════════════════════════════════════════
// 篩選 + 搜尋
// ════════════════════════════════════════════════════════════
function _filteredBooks(){
  const kw = _B.kw.toLowerCase();
  let list = _getSortedBooks(_B.allBooks);
  if(_B.filter==='recent') list=[...list].filter(b=>b.lastRead).sort((a,b)=>(b.lastRead||0)-(a.lastRead||0));
  else if(_B.filter==='fav')  list=list.filter(b=>b.favorite);
  else if(_B.filter==='pdf')  list=list.filter(b=>b.fileType==='pdf');
  else if(_B.filter==='epub') list=list.filter(b=>b.fileType==='epub');
  if(kw) list=list.filter(b=>
    (b.title||'').toLowerCase().includes(kw)||
    (b.author||'').toLowerCase().includes(kw)||
    (b.category||'').toLowerCase().includes(kw)||
    (b.tags||[]).join(' ').toLowerCase().includes(kw)
  );
  return list;
}

// setBooksFilter：chips 已移除，保留空函式防止殘留 HTML 呼叫報錯
function setBooksFilter(btn, filter){
  _B.filter=filter; _B.page=0; _renderBooksPage();
}
function searchBooks(){
  _B.kw=(document.getElementById('books-si')?.value||'').trim();
  _B.page=0; _renderBooksPage();
}

// ════════════════════════════════════════════════════════════
// 點書背 → 封面彈窗
// ════════════════════════════════════════════════════════════
async function openBookCover(id){
  const b = await dg('ebooks',id);
  if(!b) return;

  const bookW = b.widthMM  ? mmToPx(b.widthMM)  : (b.bookW||mmToPx(_BOOK_DEFAULT_MM.widthMM));
  const bookH = b.heightMM ? mmToPx(b.heightMM) : (b.bookH||mmToPx(_BOOK_DEFAULT_MM.heightMM));
  const dispH = Math.min(bookH * HEIGHT_SCALE * 1.8, window.innerHeight * 0.62);
  const dispW = Math.round(dispH * bookW / bookH);

  const ov=document.createElement('div');
  ov.id='book-cover-ov';
  ov.style.cssText=`position:fixed;inset:0;z-index:500;
    background:rgba(0,0,0,0.85);display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:16px`;
  ov.onclick=e=>{ if(e.target===ov) ov.remove(); };

  const t=_SPINE_THEMES[(b.id||0)%_SPINE_THEMES.length];
  const _thumbRaw = b.coverThumb;
  const _thumbSrc = _thumbRaw instanceof Blob ? URL.createObjectURL(_thumbRaw) : (_thumbRaw||'');
  const coverHtml = _thumbSrc
    ? `<img src="${_thumbSrc}"
        style="width:${dispW}px;height:${dispH}px;object-fit:cover;
        border-radius:4px 8px 8px 4px;
        box-shadow:-4px 0 0 rgba(0,0,0,0.6),6px 12px 40px rgba(0,0,0,0.8)"
        onload="if(this.src.startsWith('blob:'))URL.revokeObjectURL(this.src)">`
    : `<div style="width:${dispW}px;height:${dispH}px;border-radius:4px 8px 8px 4px;
        background:linear-gradient(160deg,${t.bg},${t.dark});
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:12px;box-shadow:-4px 0 0 rgba(0,0,0,0.6),6px 12px 40px rgba(0,0,0,0.8);
        padding:16px;box-sizing:border-box">
        <div style="font-size:18px;font-weight:700;color:#fff;text-align:center;line-height:1.4">
          ${esc(b.title||'未命名')}</div>
        ${b.author?`<div style="font-size:12px;color:rgba(255,255,255,0.5)">${esc(b.author)}</div>`:''}
      </div>`;

  ov.innerHTML=`
    ${coverHtml}
    <div style="display:flex;gap:10px">
      <button onclick="openBookDetail(${id});document.getElementById('book-cover-ov').remove()"
        style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);
        color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;cursor:pointer">
        📖 書籍資訊
      </button>
      <button onclick="document.getElementById('book-cover-ov').remove()"
        style="background:none;border:1px solid rgba(255,255,255,0.15);
        color:rgba(255,255,255,0.5);padding:8px 16px;border-radius:20px;
        font-size:13px;cursor:pointer">✕</button>
    </div>`;
  document.body.appendChild(ov);
}

// ════════════════════════════════════════════════════════════
// 新增書籍
// ════════════════════════════════════════════════════════════
function openAddBook(){
  const ov=document.createElement('div');
  ov.id='add-book-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end';
  ov.innerHTML=`
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:90vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
      <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:14px">新增書籍</div>

      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div id="ab-cover-preview" onclick="document.getElementById('ab-cover-inp').click()"
          style="width:72px;height:96px;border-radius:6px;background:rgba(255,255,255,0.06);
          border:1.5px dashed rgba(255,255,255,0.2);cursor:pointer;flex-shrink:0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:4px;font-size:10px;color:var(--t2)">
          <span style="font-size:22px">🖼</span>封面
        </div>
        <input type="file" id="ab-cover-inp" accept="image/*" style="display:none"
          onchange="previewBookCover(this)">
        <!-- 書背圖上傳 -->
        <div id="ab-spine-preview" onclick="document.getElementById('ab-spine-inp').click()"
          style="width:36px;height:96px;border-radius:4px;background:rgba(255,255,255,0.06);
          border:1.5px dashed rgba(255,255,255,0.2);cursor:pointer;flex-shrink:0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:2px;font-size:9px;color:var(--t2)">
          <span style="font-size:14px">📖</span>書背
        </div>
        <input type="file" id="ab-spine-inp" accept="image/*" style="display:none"
          onchange="_previewSpine(this)">
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
          <input id="ab-title" placeholder="書名 *" class="finput">
          <input id="ab-author" placeholder="作者" class="finput">
          <input id="ab-category" placeholder="分類" class="finput">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:6px">
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">厚度 mm</div>
          <input id="ab-thick" type="number" value="${_BOOK_DEFAULT_MM.thickMM}"
            min="5" max="100" class="finput" style="text-align:center">
        </div>
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">高度 mm</div>
          <input id="ab-height" type="number" value="${_BOOK_DEFAULT_MM.heightMM}"
            min="100" max="300" class="finput" style="text-align:center">
        </div>
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">寬度 mm</div>
          <input id="ab-width" type="number" value="${_BOOK_DEFAULT_MM.widthMM}"
            min="80" max="220" class="finput" style="text-align:center">
        </div>
      </div>
      <div style="font-size:10px;color:var(--t2);margin-bottom:12px">
        輸入實際書本尺寸（mm）。預設為 A5 平裝書（210×148mm，厚20mm）
      </div>

      <label style="font-size:11px;color:var(--t2);display:flex;align-items:center;
        gap:8px;margin-bottom:16px">
        <button onclick="document.getElementById('ab-file-inp').click()"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--bd);color:var(--t1);
          padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer">選擇檔案</button>
        <span id="ab-file-lbl" style="color:var(--t2);flex:1;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis">尚未選擇（可空）</span>
        <input type="file" id="ab-file-inp" accept=".pdf,.epub,.txt" style="display:none"
          onchange="document.getElementById('ab-file-lbl').textContent=this.files[0]?.name||'尚未選擇'">
      </label>

      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('add-book-ov').remove()"
          style="flex:1;padding:12px;background:rgba(255,255,255,0.06);border:1px solid var(--bd);
          color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">取消</button>
        <button onclick="saveNewBook()"
          style="flex:2;padding:12px;background:rgba(37,98,200,0.85);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700">儲存</button>
      </div>
    </div>`;
  ov.onclick=e=>{if(e.target===ov) ov.remove();};
  document.body.appendChild(ov);
}

function previewBookCover(inp){
  if(!inp.files[0]) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const p=document.getElementById('ab-cover-preview');
    if(p){
      p.innerHTML=`<img src="${e.target.result}"
        style="width:100%;height:100%;object-fit:cover;border-radius:6px">`;
      p.style.border='none';
    }
  };
  reader.readAsDataURL(inp.files[0]);
}

async function saveNewBook(){
  const title=document.getElementById('ab-title')?.value.trim();
  if(!title){toast('請填寫書名');return;}

  const thickMM  = parseInt(document.getElementById('ab-thick')?.value)  || _BOOK_DEFAULT_MM.thickMM;
  const heightMM = parseInt(document.getElementById('ab-height')?.value) || _BOOK_DEFAULT_MM.heightMM;
  const widthMM  = parseInt(document.getElementById('ab-width')?.value)  || _BOOK_DEFAULT_MM.widthMM;
  const coverInp = document.getElementById('ab-cover-inp');
  const fileInp  = document.getElementById('ab-file-inp');

  let coverThumb=null, spineThumb=null;
  const spineInp = document.getElementById('ab-spine-inp');
  if(coverInp?.files[0]){
    const pxW=mmToPx(widthMM), pxH=mmToPx(heightMM), pxS=mmToPx(thickMM);
    coverThumb = await _compressImage(coverInp.files[0], 200, Math.round(200*pxH/pxW));
    // 書背圖：優先用上傳的書背圖，否則從封面裁切左側
    const spineTargetW = Math.round(pxS * SPINE_SCALE * 2);
    const spineTargetH = Math.round(pxH * 2);
    if(spineInp?.files[0]){
      // 有上傳書背圖：cover 模式填滿（置中裁切，不留空白）
      spineThumb = await _compressSpineCover(spineInp.files[0], spineTargetW, spineTargetH);
    } else {
      // 沒傳書背圖：封面 cover 填滿 + 模糊 + 半透明遮罩（書名作者由 _mkSpine DOM 疊加）
      spineThumb = await _makeBlurredSpineFromCover(coverInp.files[0], spineTargetW, spineTargetH);
    }
  }

  const book={
    title, author:document.getElementById('ab-author')?.value.trim()||'',
    category:document.getElementById('ab-category')?.value.trim()||'',
    fileType: fileInp?.files[0]?.name.split('.').pop().toLowerCase()||'',
    fileSize: fileInp?.files[0]?.size||0,
    hasSpineImg: !!(spineInp?.files[0]),  // 有上傳書背圖（true）vs 模糊封面（false）
    blob:     fileInp?.files[0]||null,
    coverThumb, spineThumb,
    thickMM, heightMM, widthMM,
    tags:[], favorite:false, lastRead:null, lastPage:0,
    createdAt:Date.now(),
  };
  try{
    await dp('ebooks',book);
    toast('已新增：'+title);
    document.getElementById('add-book-ov')?.remove();
    renderBooks();
  }catch(e){logError('saveNewBook',e);toast('儲存失敗：'+e.message);}
}

function _previewSpine(inp){
  if(!inp.files[0]) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const prev=document.getElementById('ab-spine-preview');
    if(prev) prev.innerHTML=`<img src="${e.target.result}"
      style="width:100%;height:100%;object-fit:cover;border-radius:4px">`;
  };
  reader.readAsDataURL(inp.files[0]);
}

// 書背圖壓縮：強制拉伸填滿書背（不維持比例，完整填滿 targetW×targetH）
// 用於有上傳書背圖的情況
function _compressSpineCover(file, targetW, targetH){
  return new Promise(resolve=>{
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        const canvas = document.createElement('canvas');
        canvas.width  = targetW;
        canvas.height = targetH;
        // 強制拉伸：直接用 targetW×targetH 繪製，不維持比例
        canvas.getContext('2d').drawImage(img, 0, 0, targetW, targetH);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// 從封面圖生成模糊書背（用於無書背圖時）
// 做法：封面 cover 填滿書背，多次縮放疊加產生強烈模糊，保持原始亮度
// 書名由 _mkSpine DOM 疊加在模糊圖上
function _makeBlurredSpineFromCover(file, targetW, targetH){
  return new Promise(resolve=>{
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        // 步驟1：先把封面 cover 填滿縮到 targetW x targetH（正確尺寸的基準圖）
        const step1 = document.createElement('canvas');
        step1.width  = targetW;
        step1.height = targetH;
        const scaleX = targetW / img.width;
        const scaleY = targetH / img.height;
        const scale  = Math.max(scaleX, scaleY);
        const drawW  = img.width  * scale;
        const drawH  = img.height * scale;
        const offX   = (targetW - drawW) / 2;
        const offY   = (targetH - drawH) / 2;
        step1.getContext('2d').drawImage(img, offX, offY, drawW, drawH);

        // 步驟2：縮到極小尺寸（1/8），再放大回來，產生強烈模糊
        // 用 imageSmoothingEnabled=false 讓像素化更明顯，
        // 再次縮放時自動平滑化 → 色塊清楚但細節消失
        // 多次縮放疊加：8→4→2→1（每次縮半，累積模糊效果）
        const factors = [8, 4, 2, 1];
        let current = step1;
        for(const f of factors){
          const tmp = document.createElement('canvas');
          tmp.width  = Math.max(1, Math.round(targetW / f));
          tmp.height = Math.max(1, Math.round(targetH / f));
          const tc = tmp.getContext('2d');
          tc.imageSmoothingEnabled = true;
          tc.imageSmoothingQuality = 'low';
          tc.drawImage(current, 0, 0, tmp.width, tmp.height);
          current = tmp;
        }
        const tiny = current;

        // 最終：放大回原尺寸，'high' 平滑化讓邊緣柔和
        const final = document.createElement('canvas');
        final.width  = targetW;
        final.height = targetH;
        const fCtx = final.getContext('2d');
        fCtx.imageSmoothingEnabled = true;
        fCtx.imageSmoothingQuality = 'high';
        fCtx.drawImage(tiny, 0, 0, targetW, targetH);

        final.toBlob(blob => resolve(blob), 'image/jpeg', 0.82);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _compressImage(file,maxW,maxH){
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        let w=img.width,h=img.height;
        const scale=Math.min(maxW/w,maxH/h,1);
        canvas.width=Math.round(w*scale);
        canvas.height=Math.round(h*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        // Blob 比 base64 少 33% 空間
        canvas.toBlob(blob=>resolve(blob),'image/jpeg',0.82);
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════
// 書籍詳情視窗
// ════════════════════════════════════════════════════════════
async function openBookDetail(id){
  const book=await dg('ebooks',id);
  if(!book){toast('找不到書籍');return;}

  const ov=document.createElement('div');
  ov.id='book-detail-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end';
  const ext=(book.fileType||'').toUpperCase();
  // coverThumb 可能是 Blob（新版）或 base64 字串（舊版）
  const coverSrc = book.coverThumb instanceof Blob
    ? URL.createObjectURL(book.coverThumb)
    : (book.coverThumb || '');
  const detailPanel = document.createElement('div');
  detailPanel.style.cssText='width:100%;max-width:520px;margin:0 auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px';
  // 封面圖：用 DOM 操作，避免 blob URL 在 template literal 裡斷裂
  const coverEl = coverSrc
    ? (() => {
        const img = document.createElement('img');
        img.src = coverSrc;
        img.style.cssText='width:60px;height:80px;object-fit:cover;border-radius:4px;flex-shrink:0';
        if(book.coverThumb instanceof Blob){
          img.onload=()=>URL.revokeObjectURL(coverSrc);
        }
        return img.outerHTML;
      })()
    : '<div style="width:60px;height:80px;border-radius:4px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">📚</div>';

  detailPanel.innerHTML=`
    <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
    <div style="display:flex;gap:14px;margin-bottom:16px">
      ${coverEl}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:4px">
            ${esc(book.title||'未命名')}</div>
          ${book.author?`<div style="font-size:12px;color:var(--t2);margin-bottom:4px">✍ ${esc(book.author)}</div>`:''}
          <div style="font-size:11px;color:var(--t2)">
            ${ext||'—'} · ${_fmtSize(book.fileSize||0)||'—'}
          </div>
          <button onclick="_openBookEdit(${id})"
            style="margin-top:8px;padding:4px 10px;font-size:11px;
            background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
            color:var(--t2);border-radius:8px;cursor:pointer">
            ✏ 編輯資訊
          </button>
        </div>
      </div>
      <!-- 收藏按鈕 -->
      <button id="book-det-fav" onclick="_detailToggleBookFav(${id},this)"
        style="width:100%;padding:10px;margin-bottom:8px;
          background:${book.favorite?'rgba(236,72,153,0.12)':'rgba(255,255,255,0.05)'};
          border:1px solid ${book.favorite?'rgba(236,72,153,0.3)':'rgba(255,255,255,0.1)'};
          color:${book.favorite?'#ec4899':'rgba(255,255,255,0.5)'};
          border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;
          display:flex;align-items:center;justify-content:center;gap:8px">
        ${book.favorite?'♥ 已收藏':'♡ 加入收藏'}
      </button>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${book.blob
          ?`<button onclick="openBookReader(${id});document.getElementById('book-detail-ov').remove()"
              style="flex:2;padding:11px;background:rgba(37,98,200,0.85);color:#fff;
              border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700">
              📖 閱讀</button>
            <button onclick="downloadBook(${id})"
              style="flex:1;padding:11px;background:rgba(255,255,255,0.08);border:1px solid var(--bd);
              color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">⬇</button>`
          :`<button onclick="_attachBookFile(${id})"
              style="flex:2;padding:11px;background:rgba(255,180,60,0.2);border:1px solid rgba(255,180,60,0.3);
              color:rgba(255,200,100,0.9);border-radius:10px;cursor:pointer;font-size:13px">
              📎 附加檔案以閱讀</button>`}
        <button onclick="confirmDeleteBook(${id})"
          style="flex:1;padding:11px;background:rgba(200,50,50,0.7);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:13px">🗑</button>
        <button onclick="document.getElementById('book-detail-ov').remove()"
          style="width:100%;padding:10px;background:rgba(255,255,255,0.04);border:1px solid var(--bd);
          color:var(--t2);border-radius:10px;cursor:pointer;font-size:12px">關閉</button>
      </div>
    </div>`;
  ov.onclick=e=>{if(e.target===ov) ov.remove();};
  ov.appendChild(detailPanel);
  document.body.appendChild(ov);
  await updateEbookProgress(id, book.lastPage||0);
}

// 補充附加檔案（書本無 blob 時）
// 書籍資訊編輯視窗
async function _openBookEdit(id){
  const book = await dg('ebooks', id);
  if(!book) return;
  document.getElementById('book-detail-ov')?.remove();

  const ov = document.createElement('div');
  ov.id = 'book-edit-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:610;background:rgba(0,0,0,0.8);display:flex;align-items:flex-end';
  ov.innerHTML=`
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 16px"></div>
      <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:16px">編輯書籍資訊</div>

      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--t2);margin-bottom:4px">書名</div>
        <input id="bedit-title" class="finput" value="${esc(book.title||'')}"
          style="width:100%;box-sizing:border-box">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--t2);margin-bottom:4px">作者</div>
        <input id="bedit-author" class="finput" value="${esc(book.author||'')}"
          style="width:100%;box-sizing:border-box">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--t2);margin-bottom:4px">分類</div>
        <input id="bedit-category" class="finput" value="${esc(book.category||'')}"
          style="width:100%;box-sizing:border-box">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--t2);margin-bottom:4px">標籤（逗號分隔）</div>
        <input id="bedit-tags" class="finput" value="${esc((book.tags||[]).join(','))}"
          style="width:100%;box-sizing:border-box">
      </div>
      <div style="font-size:11px;color:var(--t2);margin-bottom:6px">書本尺寸（mm）</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">厚度</div>
          <input id="bedit-thick" type="number" class="finput" min="5" max="100"
            value="${book.thickMM||20}" style="text-align:center;box-sizing:border-box;width:100%">
        </div>
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">高度</div>
          <input id="bedit-height" type="number" class="finput" min="100" max="300"
            value="${book.heightMM||210}" style="text-align:center;box-sizing:border-box;width:100%">
        </div>
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">寬度</div>
          <input id="bedit-width" type="number" class="finput" min="80" max="220"
            value="${book.widthMM||148}" style="text-align:center;box-sizing:border-box;width:100%">
        </div>
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('book-edit-ov').remove();openBookDetail(${id})"
          style="flex:1;padding:11px;background:rgba(255,255,255,0.06);
          border:1px solid var(--bd);color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">
          取消
        </button>
        <button onclick="_saveBookEdit(${id})"
          style="flex:2;padding:11px;background:rgba(37,98,200,0.85);
          color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700">
          儲存
        </button>
      </div>
    </div>`;
  ov.onclick=e=>{if(e.target===ov){ov.remove();openBookDetail(id);}};
  document.body.appendChild(ov);
}

async function _saveBookEdit(id){
  const book = await dg('ebooks', id);
  if(!book) return;
  const title    = document.getElementById('bedit-title')?.value.trim();
  const author   = document.getElementById('bedit-author')?.value.trim();
  const category = document.getElementById('bedit-category')?.value.trim();
  const tagsRaw  = document.getElementById('bedit-tags')?.value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];

  const thickMM  = parseInt(document.getElementById('bedit-thick')?.value)  || 20;
  const heightMM = parseInt(document.getElementById('bedit-height')?.value) || 210;
  const widthMM  = parseInt(document.getElementById('bedit-width')?.value)  || 148;

  if(!title){ toast('書名不能為空'); return; }
  book.title    = title;
  book.author   = author;
  book.category = category;
  book.tags     = tags;
  book.thickMM  = thickMM;
  book.heightMM = heightMM;
  book.widthMM  = widthMM;
  await dp('ebooks', book);

  // 同步更新 allBooks 快取
  const idx = _B.allBooks.findIndex(b=>b.id===id);
  if(idx>=0) Object.assign(_B.allBooks[idx], {title, author, category, tags, thickMM, heightMM, widthMM});

  toast('書籍資訊已更新');
  document.getElementById('book-edit-ov')?.remove();
  openBookDetail(id);
  _renderBooksPage();
}

// 書籍資訊視窗收藏切換
async function _detailToggleBookFav(id, btn){
  try{
    const book = await dg('ebooks', id); if(!book) return;
    book.favorite = !book.favorite;
    await dp('ebooks', book);
    const idx = _B.allBooks.findIndex(b=>b.id===id);
    if(idx>=0) _B.allBooks[idx].favorite = book.favorite;
    btn.innerHTML = book.favorite ? '♥ 已收藏' : '♡ 加入收藏';
    btn.style.background = book.favorite ? 'rgba(236,72,153,0.12)' : 'rgba(255,255,255,0.05)';
    btn.style.borderColor = book.favorite ? 'rgba(236,72,153,0.3)' : 'rgba(255,255,255,0.1)';
    btn.style.color = book.favorite ? '#ec4899' : 'rgba(255,255,255,0.5)';
    toast(book.favorite ? '已加入收藏' : '已移除收藏');
    // 若目前在收藏模式，重新渲染讓書架同步
    if(_B.filter==='fav') _renderBooksPage();
  }catch(e){ logError('_detailToggleBookFav',e); }
}

async function _attachBookFile(id){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,.epub,.txt';
  inp.onchange = async e=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      const book = await dg('ebooks', id); if(!book) return;
      book.blob = file;
      book.fileType = file.name.split('.').pop().toLowerCase();
      book.fileSize = file.size;
      await dp('ebooks', book);
      // 更新快取
      const idx = _B.allBooks.findIndex(b=>b.id===id);
      if(idx>=0){ _B.allBooks[idx].fileType=book.fileType; _B.allBooks[idx].fileSize=book.fileSize; }
      toast('已附加檔案，可以開始閱讀');
      document.getElementById('book-detail-ov')?.remove();
      openBookDetail(id);
    }catch(err){ logError('_attachBookFile',err); toast('附加失敗'); }
  };
  inp.click();
}

async function downloadBook(id){
  const book=await dg('ebooks',id);
  if(!book?.blob){toast('無附加檔案');return;}
  const url=URL.createObjectURL(book.blob);
  const a=document.createElement('a');
  a.href=url; a.download=(book.title||'book')+'.'+(book.fileType||'pdf');
  a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000);
}

// 快速收藏切換（只更新按鈕外觀，不重渲染整頁）
async function _quickToggleBookFav(id, btn){
  try{
    const book=await dg('ebooks',id); if(!book) return;
    book.favorite=!book.favorite; await dp('ebooks',book);
    const idx=_B.allBooks.findIndex(b=>b.id===id);
    if(idx>=0) _B.allBooks[idx].favorite=book.favorite;
    // 更新按鈕外觀
    if(btn){
      btn.textContent=book.favorite?'♥':'♡';
      btn.style.color=book.favorite?'#ec4899':'rgba(255,255,255,0.3)';
    }
    // 若目前在收藏模式，重渲染
    if(_B.filter==='fav') _renderBooksPage();
  }catch(e){logError('_quickToggleBookFav',e);}
}

async function confirmDeleteBook(id){
  if(!confirm('確定刪除這本書？此操作無法復原。')) return;
  await dd('ebooks',id);
  _B.allBooks=_B.allBooks.filter(b=>b.id!==id);
  _renderBooksPage(); toast('已刪除');
  document.getElementById('book-detail-ov')?.remove();
  document.getElementById('book-cover-ov')?.remove();
}

function _fmtSize(bytes){
  if(!bytes) return '';
  if(bytes<1048576) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1048576).toFixed(1)+'MB';
}

// ════════════════════════════════════════════════════════════
// 電子書閱讀器
// ════════════════════════════════════════════════════════════
async function openBookReader(id){
  const book = await dg('ebooks', id);
  if(!book?.blob){toast('無附加檔案');return;}

  const url = URL.createObjectURL(book.blob);
  const ext  = (book.fileType||'').toLowerCase();

  const ov = document.createElement('div');
  ov.id = 'book-reader-ov';
  ov.style.cssText = `position:fixed;inset:0;z-index:800;
    background:#111;display:flex;flex-direction:column`;

  // 啟動閱讀模式（關閉動畫/blur，最佳閱讀寬度）
  if(typeof setReadingMode === 'function') setReadingMode(true);

  // 點擊頁面中央切換工具列顯示/隱藏（閱讀模式下預設收合）
  ov.addEventListener('click', e=>{
    // 點工具列按鈕不觸發
    if(e.target.closest('.reader-topbar,.epub-bottom-bar,[id^="epub-"]')) return;
    document.documentElement.classList.toggle('reader-ui-visible');
  });

  // 頂部列
  ov.innerHTML = `
    <div class="reader-topbar" id="reader-topbar">
      <button class="reader-btn" onclick="closeBookReader(${id})">←</button>
      <div class="reader-title">${esc(book.title||'閱讀中')}</div>
      <button class="reader-btn" onclick="_toggleReaderUI()">Aa</button>
    </div>
    <div id="reader-body" style="flex:1;overflow:hidden;position:relative;background:#111">
      ${ext==='pdf'
        ? `<iframe id="reader-iframe" src="${url}#toolbar=0&navpanes=0"
            style="width:100%;height:100%;border:none;background:#111"></iframe>`
        : ext==='epub'
        ? `<div id="reader-epub-wrap"
            style="width:100%;height:100%;position:relative;
            background:var(--reader-bg,#111);display:flex;flex-direction:column">
            <!-- epub.js 渲染區 -->
            <div id="epub-viewer"
              style="flex:1;overflow:hidden;position:relative;
              height:0;min-height:0"></div>
            <!-- 左右翻頁觸控區 -->
            <div id="epub-prev-zone"
              style="position:absolute;left:0;top:0;width:30%;height:100%;
              z-index:5;cursor:pointer;-webkit-tap-highlight-color:transparent"
              onclick="_epubPrev()"></div>
            <div id="epub-next-zone"
              style="position:absolute;right:0;top:0;width:30%;height:100%;
              z-index:5;cursor:pointer;-webkit-tap-highlight-color:transparent"
              onclick="_epubNext()"></div>
            <!-- 底部進度列 -->
            <div id="epub-progress-bar"
              style="height:2px;background:rgba(255,255,255,0.1);position:relative;flex-shrink:0">
              <div id="epub-progress-fill"
                style="height:100%;background:var(--acc);width:0%;transition:width .3s"></div>
            </div>
            <!-- 頁碼提示 -->
            <div id="epub-page-info" class="hide"
              style="text-align:center;font-size:11px;color:rgba(255,255,255,0.3);
              padding:4px 0 6px;flex-shrink:0;font-variant-numeric:tabular-nums">
            </div>
          </div>`
        : ext==='txt'
        ? `<div id="reader-txt"
            style="width:100%;height:100%;overflow-y:auto;
            background:var(--reader-bg,#111);color:var(--reader-fg,#e8e8e8);
            font-size:var(--reader-fs,17px);line-height:1.8;
            padding:20px 20px 60px;box-sizing:border-box;white-space:pre-wrap;
            font-family:Georgia,serif;max-width:680px;margin:0 auto"></div>`
        : `<div style="display:flex;align-items:center;justify-content:center;
            height:100%;flex-direction:column;gap:12px;color:rgba(255,255,255,0.5)">
            <div style="font-size:48px">📄</div>
            <div>此格式暫不支援直接閱讀</div>
            <button onclick="downloadBook(${id})"
              style="padding:10px 24px;background:rgba(37,98,200,0.85);color:#fff;
              border:none;border-radius:10px;cursor:pointer;font-size:14px">⬇ 下載後閱讀</button>
          </div>`}
    </div>
    <!-- 閱讀設定面板 -->
    <div id="reader-settings" class="hide" style="position:absolute;top:52px;right:0;
      background:rgba(20,20,28,0.97);border-radius:0 0 0 12px;
      padding:14px 16px;z-index:10;min-width:180px;
      border-left:1px solid rgba(255,255,255,0.08);
      border-bottom:1px solid rgba(255,255,255,0.08)">
      <div style="font-size:11px;color:rgba(255,255,255,0.4);
        margin-bottom:10px;letter-spacing:.06em">閱讀設定</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <button onclick="_readerFontSize(-2)"
          style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.08);
          border:none;color:#fff;font-size:14px;cursor:pointer">A-</button>
        <div id="reader-fs-lbl" style="flex:1;text-align:center;font-size:13px;color:#fff">17px</div>
        <button onclick="_readerFontSize(2)"
          style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.08);
          border:none;color:#fff;font-size:16px;cursor:pointer">A+</button>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="_readerTheme('dark')"
          style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);
          background:#111;color:#e8e8e8;font-size:11px;cursor:pointer">深色</button>
        <button onclick="_readerTheme('sepia')"
          style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);
          background:#2d2416;color:#d4b896;font-size:11px;cursor:pointer">護眼</button>
        <button onclick="_readerTheme('light')"
          style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(0,0,0,0.1);
          background:#f5f5f0;color:#222;font-size:11px;cursor:pointer">白色</button>
      </div>
    </div>`;

  document.body.appendChild(ov);
  ov._objectUrl = url;

  // eink 模式：自動套用白色主題（最適合電子紙閱讀）
  if(document.documentElement.dataset.theme==='eink'){
    setTimeout(()=>{ _readerTheme('light'); }, 80);
  }

  // 載入文字內容（txt / epub 純文字模式）
  if(ext==='txt'){
    const reader = new FileReader();
    reader.onload = e=>{
      const el=document.getElementById('reader-txt');
      if(el) el.textContent=e.target.result;
    };
    reader.readAsText(book.blob,'UTF-8');
  } else if(ext==='epub'){
    // epub.js 初始化
    _initEpubReader(url, book.lastPage||0);
  }

  // 恢復閱讀位置（txt：scrollTop 數字；epub：由 _initEpubReader 處理）
  if(ext==='txt' && book.lastPage>0){
    setTimeout(()=>{
      const el=document.getElementById('reader-txt');
      if(el) el.scrollTop = book.lastPage;
    },300);
  }
}

// ════════════════════════════════════════════════════════════
// epub.js 閱讀器
// ════════════════════════════════════════════════════════════

async function _initEpubReader(url, savedCfi){
  // 確認 epub.js 已載入
  if(typeof ePub === 'undefined'){
    const el=document.getElementById('epub-viewer');
    if(el) el.innerHTML=`<div style="padding:30px;text-align:center;color:rgba(255,255,255,0.4)">
      epub.js 載入失敗，請確認網路連線後重試。<br><br>
      <button onclick="location.reload()" style="padding:8px 20px;background:rgba(37,98,200,0.8);
      color:#fff;border:none;border-radius:8px;cursor:pointer">重新載入</button></div>`;
    return;
  }

  try{
    // epub.js 對 blob:// URL 支援不穩定，改用 ArrayBuffer 方式
    const resp = await fetch(url);
    const buf  = await resp.arrayBuffer();
    const book = ePub(buf);
    window._epubBook = book;

    // 取得容器實際高度（epub.js 需要明確像素高度）
    const viewerEl = document.getElementById('epub-viewer');
    const viewerH = viewerEl ? viewerEl.parentElement.clientHeight - 40 : window.innerHeight - 120;
    const rendition = book.renderTo('epub-viewer', {
      width:  viewerEl ? viewerEl.clientWidth || (window.innerWidth) : window.innerWidth,
      height: Math.max(400, viewerH),
      spread: 'none',
      flow:   'paginated',
    });
    window._epubRendition = rendition;

    // 設定主題（深色預設）
    rendition.themes.register('dark', {
      'body': {
        'background': '#111 !important',
        'color': '#e8e8e8 !important',
        'font-family': "'Noto Serif TC', 'Noto Serif SC', Georgia, serif !important",
        'font-size': '17px !important',
        'line-height': '1.85 !important',
        'padding': '0 8px !important',
      },
      'p': { 'text-indent': '2em', 'margin': '0.4em 0' },
      'h1,h2,h3,h4': { 'color': '#fff !important', 'margin': '1em 0 0.5em' },
      'a': { 'color': '#6ea8fe !important' },
    });
    rendition.themes.register('sepia', {
      'body': {
        'background': '#2d2416 !important',
        'color': '#d4b896 !important',
        'font-family': "'Noto Serif TC', Georgia, serif !important",
        'font-size': '17px !important',
        'line-height': '1.85 !important',
      },
      'p': { 'text-indent': '2em', 'margin': '0.4em 0' },
    });
    rendition.themes.register('light', {
      'body': {
        'background': '#f5f5f0 !important',
        'color': '#222 !important',
        'font-family': "'Noto Serif TC', Georgia, serif !important",
        'font-size': '17px !important',
        'line-height': '1.85 !important',
      },
      'p': { 'text-indent': '2em', 'margin': '0.4em 0' },
    });
    rendition.themes.select('dark');

    // 顯示（從上次位置或開頭）
    if(savedCfi && typeof savedCfi === 'string' && savedCfi.startsWith('epubcfi')){
      await rendition.display(savedCfi);
    } else {
      await rendition.display();
    }

    // 生成位置索引（讓 percentageFromCfi 能正確計算進度）
    book.locations.generate(1024).then(()=>{
      const loc = rendition.currentLocation();
      if(loc) _updateEpubProgress(book, loc);
    }).catch(()=>{});

    // 翻頁後更新進度
    rendition.on('relocated', loc=>{
      _updateEpubProgress(book, loc);
    });

    // 觸控滑動翻頁
    rendition.on('touchstart', e=>{ _epubTouchStart = e.touches[0].clientX; });
    rendition.on('touchend',   e=>{
      if(_epubTouchStart === null) return;
      const diff = e.changedTouches[0].clientX - _epubTouchStart;
      if(diff > 50)       rendition.prev();
      else if(diff < -50) rendition.next();
      _epubTouchStart = null;
    });

  }catch(err){
    logError('_initEpubReader', err);
    const el=document.getElementById('epub-viewer');
    if(el) el.innerHTML=`<div style="padding:30px;text-align:center;color:rgba(255,255,255,0.4)">
      epub 載入失敗（${esc(err.message||'未知錯誤')}）<br><br>
      可能原因：epub 格式不標準或檔案損壞。</div>`;
  }
}

let _epubTouchStart = null;

function _updateEpubProgress(book, loc){
  if(!loc) return;
  book.locations.percentageFromCfi(loc.start.cfi).then(pct=>{
    const fill=document.getElementById('epub-progress-fill');
    if(fill) fill.style.width=(pct*100).toFixed(1)+'%';
    const info=document.getElementById('epub-page-info');
    if(info){
      info.textContent=`${Math.round(pct*100)}%`;
      info.classList.remove('hide');  // 有進度才顯示
    }
  }).catch(()=>{});
}

function _epubNext(){
  if(window._epubRendition) window._epubRendition.next();
}
function _epubPrev(){
  if(window._epubRendition) window._epubRendition.prev();
}

let _readerFontSz = 17;
let _readerUIVisible = true;

function _toggleReaderUI(){
  const settings=document.getElementById('reader-settings');
  if(settings) settings.classList.toggle('hide');
}

function _readerFontSize(delta){
  _readerFontSz = Math.max(12, Math.min(28, _readerFontSz+delta));
  const lbl=document.getElementById('reader-fs-lbl');
  if(lbl) lbl.textContent=_readerFontSz+'px';
  document.getElementById('reader-txt')?.style.setProperty('font-size',_readerFontSz+'px');
  // epub.js 字體調整
  if(window._epubRendition){
    window._epubRendition.themes.fontSize(_readerFontSz+'px');
  }
}

function _readerTheme(theme){
  const themes={
    dark:  {bg:'#111',fg:'#e8e8e8'},
    sepia: {bg:'#2d2416',fg:'#d4b896'},
    light: {bg:'#f5f5f0',fg:'#222'},
  };
  const t=themes[theme]||themes.dark;
  const ov=document.getElementById('book-reader-ov');
  if(!ov) return;
  ov.style.background=t.bg;
  const txt=document.getElementById('reader-txt');
  if(txt){txt.style.background=t.bg;txt.style.color=t.fg;}
  // epub.js 主題切換
  if(window._epubRendition){
    const epubTheme = (theme==='light')?'light':(theme==='sepia')?'sepia':'dark';
    window._epubRendition.themes.select(epubTheme);
    // epub-viewer 容器背景
    const viewer = document.getElementById('epub-viewer');
    if(viewer){ viewer.style.background=t.bg; }
    // iframe 背景強制設定（epub.js themes.select 有延遲，需直接操作 iframe DOM）
    const applyIframeTheme = ()=>{
      try{
        const iframes = viewer?.querySelectorAll('iframe');
        iframes?.forEach(iframe=>{
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if(doc?.body){
            doc.body.style.cssText += `;background:${t.bg}!important;color:${t.fg}!important`;
          }
          if(doc?.documentElement){
            doc.documentElement.style.cssText += `;background:${t.bg}!important`;
          }
        });
      }catch(e){}
    };
    applyIframeTheme();
    // 延遲再執行一次（epub.js 渲染後可能覆蓋）
    setTimeout(applyIframeTheme, 200);
    setTimeout(applyIframeTheme, 800);
    try{
    }catch(e){}
    // 重新 apply 一次確保生效
    setTimeout(()=>{
      try{
        const iframe = document.querySelector('#epub-viewer iframe');
        if(iframe?.contentDocument?.body){
          iframe.contentDocument.body.style.background=t.bg;
          iframe.contentDocument.body.style.color=t.fg;
        }
      }catch(e){}
    }, 100);
  }
}

async function closeBookReader(id){
  const ov=document.getElementById('book-reader-ov');
  if(!ov) return;
  // 儲存閱讀位置
  try{
    const txt=document.getElementById('reader-txt');
    const book=await dg('ebooks',id);
    if(book){
      book.lastRead=Date.now();
      if(txt){
        book.lastPage=txt.scrollTop;  // txt: scrollTop
      } else if(window._epubRendition){
        // epub: CFI 字串（存在 lastCfi 欄位）
        const loc=window._epubRendition.currentLocation();
        if(loc?.start?.cfi) book.lastCfi=loc.start.cfi;
      }
      await dp('ebooks',book);
      const idx=_B.allBooks.findIndex(b=>b.id===id);
      if(idx>=0){ _B.allBooks[idx].lastRead=book.lastRead; }
    }
  }catch(_){}
  // 清理 epub 實例
  if(window._epubBook){
    try{ window._epubBook.destroy(); }catch(_){}
    window._epubBook=null;
    window._epubRendition=null;
  }
  if(ov._objectUrl) URL.revokeObjectURL(ov._objectUrl);
  ov.remove();
  // 關閉閱讀模式，還原全域動畫設定
  if(typeof setReadingMode === 'function') setReadingMode(false);
  document.documentElement.classList.remove('reader-ui-visible');
}

// ════════════════════════════════════════════════════════════
// 書庫批量刪除
// ════════════════════════════════════════════════════════════
// ── 書庫排序模式 ─────────────────────────────────────────
// sortOrder：儲存在 localStorage，key = 'booksOrder'，值為 id 陣列
function _getSortedBooks(books){
  try{
    const order = JSON.parse(localStorage.getItem('booksOrder')||'[]');
    if(!order.length) return books;
    const map = new Map(books.map(b=>[b.id, b]));
    const sorted = order.map(id=>map.get(id)).filter(Boolean);
    const rest   = books.filter(b=>!order.includes(b.id));
    return [...sorted, ...rest];
  }catch(e){ return books; }
}
function _saveBooksOrder(books){
  localStorage.setItem('booksOrder', JSON.stringify(books.map(b=>b.id)));
}

let _sortMode = false;
function toggleBooksSort(btn){
  _sortMode = !_sortMode;
  btn.textContent = _sortMode ? '完成' : '排序';
  btn.style.color = _sortMode ? 'var(--grn)' : 'var(--acc)';
  // 批量刪除在排序模式下禁用
  const bulkBtn = document.getElementById('books-bulk-btn');
  if(bulkBtn) bulkBtn.disabled = _sortMode;
  _renderBooksPage();
}

// 排序模式下的拖拉邏輯（只在書架模式下運作）
function _enableDragSort(shelfEl, books){
  let dragId = null, dragEl = null;

  // touch 拖拉：記錄起始元素
  let touchStartEl = null;

  shelfEl.querySelectorAll('.book-spine').forEach(el=>{
    el.setAttribute('draggable','true');
    el.style.cursor = 'grab';

    // ── Desktop: HTML5 drag ──
    el.addEventListener('dragstart', e=>{
      dragId = parseInt(el.dataset.bid);
      dragEl = el;
      el.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', ()=>{
      el.style.opacity = '';
      dragEl = null;
    });
    el.addEventListener('dragover', e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', e=>{
      e.preventDefault();
      const targetId = parseInt(el.dataset.bid);
      if(dragId === targetId || !dragId) return;
      _doSwap(dragId, targetId, books);
    });

    // ── Mobile: touch events ──
    el.addEventListener('touchstart', e=>{
      touchStartEl = el;
      dragId = parseInt(el.dataset.bid);
      el.style.opacity = '0.5';
      el.style.transform = 'scale(1.05)';
    }, {passive:true});

    el.addEventListener('touchend', e=>{
      const touch = e.changedTouches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetSpine = target?.closest('.book-spine');
      if(touchStartEl) {
        touchStartEl.style.opacity = '';
        touchStartEl.style.transform = '';
      }
      if(targetSpine && targetSpine !== touchStartEl){
        const targetId = parseInt(targetSpine.dataset.bid);
        if(dragId && targetId && dragId !== targetId){
          _doSwap(dragId, targetId, books);
        }
      }
      touchStartEl = null;
      dragId = null;
    }, {passive:true});
    el.addEventListener('drop', e=>{
      e.preventDefault();
      const targetId = parseInt(el.dataset.bid);
      if(dragId === targetId || !dragId) return;
      _doSwap(dragId, targetId, books);
    });
  });
}

function _doSwap(dragId, targetId, books){
  const dragIdx   = books.findIndex(b=>b.id===dragId);
  const targetIdx = books.findIndex(b=>b.id===targetId);
  if(dragIdx<0||targetIdx<0) return;
  const [moved] = books.splice(dragIdx, 1);
  books.splice(targetIdx, 0, moved);
  _saveBooksOrder(books);
  _B.allBooks = _getSortedBooks(_B.allBooks);
  _renderBooksPage();
}

function toggleBooksBulk(btn){
  _B.bulkMode = !_B.bulkMode;
  _B.bulkSelected = new Set();
  btn.textContent = _B.bulkMode ? '取消' : '批量刪除';
  btn.style.color  = _B.bulkMode ? 'var(--acc)' : 'var(--red)';
  _renderBooksPage();
}

function _toggleBookSelect(id, el){
  if(_B.bulkSelected.has(id)) _B.bulkSelected.delete(id);
  else _B.bulkSelected.add(id);
  el.style.outline = _B.bulkSelected.has(id)
    ? '3px solid var(--acc)' : 'none';
  // 更新確認按鈕計數
  const confirmBtn=document.getElementById('books-bulk-confirm');
  if(confirmBtn) confirmBtn.textContent=`刪除 ${_B.bulkSelected.size} 本`;
}

async function _executeBooksDelete(){
  if(!_B.bulkSelected.size){toast('請先勾選書本');return;}
  if(!confirm(`確定刪除 ${_B.bulkSelected.size} 本書？此操作無法復原。`)) return;
  const ids=[..._B.bulkSelected];
  for(const id of ids){
    await dd('ebooks',id);
    _B.allBooks=_B.allBooks.filter(b=>b.id!==id);
  }
  toast(`已刪除 ${ids.length} 本`);
  _B.bulkMode=false; _B.bulkSelected=new Set();
  const btn=document.getElementById('books-bulk-btn');
  if(btn){btn.textContent='批量刪除';btn.style.color='var(--red)';}
  _renderBooksPage();
}
