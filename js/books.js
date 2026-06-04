// ══ books.js — 書庫（高質感書架版）══════════════════════════
// 依賴：db.js（_db, dp, dd, dg, logError, updateEbookProgress）
// 頁面：pg-books
// ════════════════════════════════════════════════════════════

// ── 狀態 ────────────────────────────────────────────────────
const _B = {
  filter:   'all',   // all | recent | fav | pdf | epub
  kw:       '',
  page:     0,
  PAGE:     30,
  allBooks: [],
  mode:     'spine', // spine | cover | list
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
  return all.map(({blob:_b, coverBlob:_cb, ...meta}) => meta);
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
    el.innerHTML += `<div class="empty" style="padding:30px 0"><span class="ic">📚</span><span>尚無書籍</span></div>`;
    return;
  }

  const batch = filtered.slice(0, (_B.page+1)*_B.PAGE);

  if(_B.mode === 'spine')      el.appendChild(_mkShelf(batch, filtered.length));
  else if(_B.mode === 'cover') el.appendChild(_mkCoverGrid(batch, filtered.length));
  else                          el.appendChild(_mkListView(batch, filtered.length));

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
  bar.innerHTML=`
    <div class="shelf-mode-title">藏書</div>
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

  const containerW = Math.min(window.innerWidth, 540) - 28;
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
    // 書背寬（加視覺修正）
    const dispW = Math.round(mmToPx(thickMM) * SPINE_SCALE);
    // 書高
    const dispH = Math.round(mmToPx(heightMM) * HEIGHT_SCALE);

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

  return shelf;
}

function _mkSpine(b, dispW, dispH){
  const div = document.createElement('div');
  div.className = 'book-spine';
  div.style.width  = dispW + 'px';
  div.style.height = dispH + 'px';
  div.title = b.title||'';

  const t = _SPINE_THEMES[(b.id||0) % _SPINE_THEMES.length];

  if(b.spineThumb){
    div.innerHTML=`<img src="${b.spineThumb}"
      style="width:100%;height:100%;object-fit:cover;display:block;">`;
  } else {
    // 純色書背 + 漸層光澤
    div.style.background=
      `linear-gradient(90deg,${t.dark} 0%,${t.bg} 30%,${t.light}22 50%,${t.bg} 70%,${t.dark} 100%)`;

    // 書名字體大小依書背寬度自動調整
    const fontSize = Math.max(9, Math.min(13, Math.round(dispW * 0.38)));
    const label = document.createElement('div');
    label.className='spine-label';
    label.style.fontSize = fontSize+'px';
    label.textContent = b.title||'未命名';
    div.appendChild(label);

    if(b.author && dispW >= 20){
      const auth = document.createElement('div');
      auth.className='spine-author';
      auth.textContent = b.author;
      div.appendChild(auth);
    }
  }

  // 抽書動畫
  div.onclick = ()=> _pullBook(b.id, div);
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
    card.onclick=()=>openBookCover(b.id);
    const t=_SPINE_THEMES[(b.id||0)%_SPINE_THEMES.length];
    const img=document.createElement('div');
    img.className='shelf-cover-img';
    if(b.coverThumb){
      img.innerHTML=`<img src="${b.coverThumb}" loading="lazy" alt="">`;
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
    card.appendChild(img);
    card.appendChild(name);
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
    item.onclick=()=>openBookDetail(b.id);
    const t=_SPINE_THEMES[(b.id||0)%_SPINE_THEMES.length];
    const cover=document.createElement('div');
    cover.className='shelf-list-cover';
    if(b.coverThumb){
      cover.innerHTML=`<img src="${b.coverThumb}" loading="lazy" alt="">`;
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
  let list = _B.allBooks;
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

function setBooksFilter(btn, filter){
  document.querySelectorAll('#books-chips .chip').forEach(c=>c.classList.remove('on'));
  btn.classList.add('on');
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
  const b = _B.allBooks.find(x=>x.id===id);
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
  const coverHtml = b.coverThumb
    ? `<img src="${b.coverThumb}"
        style="width:${dispW}px;height:${dispH}px;object-fit:cover;
        border-radius:4px 8px 8px 4px;
        box-shadow:-4px 0 0 rgba(0,0,0,0.6),6px 12px 40px rgba(0,0,0,0.8)">`
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
  if(coverInp?.files[0]){
    const pxW=mmToPx(widthMM), pxH=mmToPx(heightMM), pxS=mmToPx(thickMM);
    coverThumb = await _compressImage(coverInp.files[0], 200, Math.round(200*pxH/pxW));
    spineThumb = await _compressImage(coverInp.files[0], Math.round(pxS*SPINE_SCALE*2), pxH*2);
  }

  const book={
    title, author:document.getElementById('ab-author')?.value.trim()||'',
    category:document.getElementById('ab-category')?.value.trim()||'',
    fileType: fileInp?.files[0]?.name.split('.').pop().toLowerCase()||'',
    fileSize: fileInp?.files[0]?.size||0,
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
        resolve(canvas.toDataURL('image/jpeg',0.82));
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
  ov.innerHTML=`
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
      <div style="display:flex;gap:14px;margin-bottom:16px">
        ${book.coverThumb
          ?`<img src="${book.coverThumb}" style="width:60px;height:80px;object-fit:cover;border-radius:4px;flex-shrink:0">`
          :`<div style="width:60px;height:80px;border-radius:4px;background:rgba(255,255,255,0.06);
              display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">📚</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:4px">
            ${esc(book.title||'未命名')}</div>
          ${book.author?`<div style="font-size:12px;color:var(--t2);margin-bottom:4px">✍ ${esc(book.author)}</div>`:''}
          <div style="font-size:11px;color:var(--t2)">
            ${ext||'—'} · ${_fmtSize(book.fileSize||0)||'—'}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('book-detail-ov').remove()"
          style="flex:1;padding:11px;background:rgba(255,255,255,0.06);border:1px solid var(--bd);
          color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">關閉</button>
        ${book.blob?`<button onclick="downloadBook(${id})"
          style="flex:1;padding:11px;background:rgba(37,98,200,0.85);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:13px">⬇ 下載</button>`:''}
        <button onclick="confirmDeleteBook(${id})"
          style="flex:1;padding:11px;background:rgba(200,50,50,0.7);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:13px">🗑 刪除</button>
      </div>
    </div>`;
  ov.onclick=e=>{if(e.target===ov) ov.remove();};
  document.body.appendChild(ov);
  await updateEbookProgress(id, book.lastPage||0);
}

async function downloadBook(id){
  const book=await dg('ebooks',id);
  if(!book?.blob){toast('無附加檔案');return;}
  const url=URL.createObjectURL(book.blob);
  const a=document.createElement('a');
  a.href=url; a.download=(book.title||'book')+'.'+(book.fileType||'pdf');
  a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000);
}

async function toggleBookFav(id,btn){
  try{
    const book=await dg('ebooks',id); if(!book) return;
    book.favorite=!book.favorite; await dp('ebooks',book);
    const idx=_B.allBooks.findIndex(b=>b.id===id);
    if(idx>=0) _B.allBooks[idx].favorite=book.favorite;
  }catch(e){logError('toggleBookFav',e);}
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
