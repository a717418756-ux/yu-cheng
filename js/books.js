// ══ books.js — 書庫模組 ══════════════════════════════════════
// 依賴：db.js（_db, dp, dd, dg, logError）
// 頁面：pg-books
// ════════════════════════════════════════════════════════════

// ── 狀態 ────────────────────────────────────────────────────
const _B = {
  filter: 'all',   // all | recent | fav | pdf | epub
  kw:     '',
  page:   0,
  PAGE:   24,
  allBooks: [],    // 含 metadata，不含 blob
  editId: null,
};

// ── 書庫列表渲染入口 ─────────────────────────────────────────
async function renderBooks(){
  try{
    _B.page  = 0;
    _B.allBooks = await _getBooksMetaList();
    _renderBooksList();
  }catch(e){ logError('renderBooks',e); }
}

// 取得不含 blob 的書目列表（效能：不載入大檔）
async function _getBooksMetaList(){
  const all = await _db.ebooks.toArray();
  return all.map(({blob:_b, coverBlob:_cb, ...meta}) => meta);
}

// ── 篩選 + 搜尋邏輯 ─────────────────────────────────────────
function _filteredBooks(){
  const kw = _B.kw.toLowerCase();
  let list = _B.allBooks;

  if(_B.filter === 'recent'){
    list = list.filter(b => b.lastRead).sort((a,b) => (b.lastRead||0)-(a.lastRead||0));
  } else if(_B.filter === 'fav'){
    list = list.filter(b => b.favorite);
  } else if(_B.filter === 'pdf'){
    list = list.filter(b => b.fileType === 'pdf');
  } else if(_B.filter === 'epub'){
    list = list.filter(b => b.fileType === 'epub');
  }

  if(kw){
    // 使用索引欄位做前端過濾（資料量有限，不需暴力掃）
    list = list.filter(b =>
      (b.title||'').toLowerCase().includes(kw) ||
      (b.author||'').toLowerCase().includes(kw) ||
      (b.category||'').toLowerCase().includes(kw) ||
      (b.tags||[]).join(' ').toLowerCase().includes(kw)
    );
  }
  return list;
}

// ── DOM 渲染 ─────────────────────────────────────────────────
function _renderBooksList(){
  const el    = document.getElementById('books-list');
  const cnt   = document.getElementById('books-count');
  if(!el) return;

  const list  = _filteredBooks();
  const total = list.length;
  if(cnt) cnt.textContent = total ? `共 ${total} 本` : '';

  if(!total){
    el.innerHTML = `<div class="empty"><span class="ic">📚</span><span>尚無書籍</span></div>`;
    return;
  }

  // 分批渲染（IntersectionObserver 無限捲動）
  const batch = list.slice(0, (_B.page+1) * _B.PAGE);
  el.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'books-grid';
  batch.forEach(b => grid.appendChild(_mkBookCard(b)));
  el.appendChild(grid);

  // 載入更多觸發點
  if(batch.length < total){
    const trigger = document.createElement('div');
    trigger.id = 'books-trigger';
    trigger.style.height = '20px';
    el.appendChild(trigger);
    const obs = new IntersectionObserver(entries => {
      if(entries[0].isIntersecting){
        obs.disconnect();
        _B.page++;
        _renderBooksList();
      }
    }, {rootMargin:'80px'});
    obs.observe(trigger);
  }
}

function _mkBookCard(b){
  const div = document.createElement('div');
  div.className = 'book-card';
  const ext    = (b.fileType||'').toUpperCase() || '書';
  const size   = b.fileSize ? _fmtSize(b.fileSize) : '';
  const lastR  = b.lastRead ? '上次：'+new Date(b.lastRead).toLocaleDateString('zh-TW') : '未讀';
  const favCls = b.favorite ? 'book-fav on' : 'book-fav';

  div.innerHTML = `
    <div class="book-cover" onclick="openBookDetail(${b.id})">
      ${b.coverThumb
        ? `<img src="${b.coverThumb}" class="book-cover-img" loading="lazy">`
        : `<div class="book-cover-placeholder"><div class="bcp-ext">${ext}</div><div class="bcp-title">${esc(b.title||'未命名')}</div></div>`
      }
    </div>
    <div class="book-info">
      <div class="book-title" onclick="openBookDetail(${b.id})">${esc(b.title||'未命名')}</div>
      ${b.author ? `<div class="book-author">${esc(b.author)}</div>` : ''}
      <div class="book-meta">${ext}${size ? ' · '+size : ''} · ${lastR}</div>
      <div class="book-actions">
        <button class="book-act-btn" onclick="openBookDetail(${b.id})">📖 閱讀</button>
        <button class="${favCls}" onclick="toggleBookFav(${b.id},this)">
          ${b.favorite ? '⭐' : '☆'}
        </button>
        <button class="book-act-btn del" onclick="confirmDeleteBook(${b.id})">🗑</button>
      </div>
    </div>`;
  return div;
}

// ── 外部觸發函式（HTML onclick 用）──────────────────────────
function setBooksFilter(btn, filter){
  document.querySelectorAll('#books-chips .chip').forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
  _B.filter = filter;
  _B.page   = 0;
  _renderBooksList();
}

function searchBooks(){
  _B.kw   = (document.getElementById('books-si')?.value || '').trim();
  _B.page = 0;
  _renderBooksList();
}

// ── 新增書籍（上傳檔案）────────────────────────────────────
function openAddBook(){
  const inp = document.createElement('input');
  inp.type   = 'file';
  inp.accept = '.pdf,.epub,.txt';
  inp.multiple = true;
  inp.onchange = async e => {
    const files = [...e.target.files];
    if(!files.length) return;
    let added = 0;
    for(const file of files){
      await _saveBookFile(file);
      added++;
    }
    toast(`已新增 ${added} 本書籍`);
    renderBooks();
  };
  inp.click();
}

async function _saveBookFile(file){
  try{
    const ext = file.name.split('.').pop().toLowerCase();
    const blob = file;
    // 封面縮圖：PDF 第一頁預覽（未來實作），現在留空
    const book = {
      title:      file.name.replace(/\.[^.]+$/, ''),
      author:     '',
      category:   '',
      fileType:   ext,
      fileSize:   file.size,
      blob:       blob,
      coverThumb: null,
      tags:       [],
      favorite:   false,
      lastRead:   null,
      lastPage:   0,
      createdAt:  Date.now(),
    };
    await dp('ebooks', book);
  }catch(e){ logError('_saveBookFile', e); toast('新增失敗：'+e.message); }
}

// ── 書籍詳情（目前：顯示資訊 + 下載）───────────────────────
async function openBookDetail(id){
  const book = await dg('ebooks', id);
  if(!book){ toast('找不到書籍'); return; }

  const modal = document.createElement('div');
  modal.id = 'book-detail-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.7);display:flex;align-items:flex-end';
  const ext = (book.fileType||'').toUpperCase();
  modal.innerHTML = `
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:85vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 16px"></div>
      <div style="font-size:16px;font-weight:700;color:var(--t0);margin-bottom:4px">${esc(book.title||'未命名')}</div>
      ${book.author ? `<div style="font-size:12px;color:var(--t2);margin-bottom:12px">✍ ${esc(book.author)}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:12px;color:var(--t2)">
        <div>格式：<b>${ext}</b></div>
        <div>大小：<b>${_fmtSize(book.fileSize||0)}</b></div>
        <div>上次閱讀：<b>${book.lastRead ? new Date(book.lastRead).toLocaleDateString('zh-TW') : '未讀'}</b></div>
        <div>新增時間：<b>${new Date(book.createdAt).toLocaleDateString('zh-TW')}</b></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn bg" style="flex:1;padding:12px" onclick="this.closest('#book-detail-modal').remove()">關閉</button>
        <button class="btn blue" style="flex:1;padding:12px;background:rgba(37,98,200,0.85);color:#fff"
          onclick="downloadBook(${id})">⬇ 下載</button>
        <button class="btn" style="flex:1;padding:12px;background:var(--red);color:#fff"
          onclick="confirmDeleteBook(${id});this.closest('#book-detail-modal').remove()">🗑 刪除</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  // 更新閱讀時間
  await updateEbookProgress(id, book.lastPage || 0);
}

async function downloadBook(id){
  const book = await dg('ebooks', id);
  if(!book?.blob){ toast('檔案不存在'); return; }
  const url = URL.createObjectURL(book.blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download= (book.title||'book') + '.' + (book.fileType||'pdf');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function toggleBookFav(id, btn){
  try{
    const book = await dg('ebooks', id);
    if(!book) return;
    book.favorite = !book.favorite;
    await dp('ebooks', book);
    // 更新按鈕
    btn.className = book.favorite ? 'book-fav on' : 'book-fav';
    btn.textContent = book.favorite ? '⭐' : '☆';
    // 更新本地快取
    const idx = _B.allBooks.findIndex(b => b.id === id);
    if(idx >= 0) _B.allBooks[idx].favorite = book.favorite;
  }catch(e){ logError('toggleBookFav',e); }
}

async function confirmDeleteBook(id){
  if(!confirm('確定刪除這本書？此操作無法復原。')) return;
  await dd('ebooks', id);
  _B.allBooks = _B.allBooks.filter(b => b.id !== id);
  _renderBooksList();
  toast('已刪除');
  document.getElementById('book-detail-modal')?.remove();
}

// ── 工具函式 ─────────────────────────────────────────────────
function _fmtSize(bytes){
  if(!bytes) return '';
  if(bytes < 1024) return bytes + 'B';
  if(bytes < 1048576) return (bytes/1024).toFixed(1) + 'KB';
  return (bytes/1048576).toFixed(1) + 'MB';
}
