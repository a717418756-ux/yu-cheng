// ══ books.js — 書庫（書架書背模式）══════════════════════════
// 依賴：db.js（_db, dp, dd, dg, logError, updateEbookProgress）
// 頁面：pg-books
// ════════════════════════════════════════════════════════════

// ── 狀態 ────────────────────────────────────────────────────
const _B = {
  filter:   'all',   // all | recent | fav | pdf | epub
  kw:       '',
  page:     0,
  PAGE:     40,      // 書背小，每批多載
  allBooks: [],      // metadata only（不含 blob）
};

// 書本尺寸：使用者輸入 mm，自動換算成 px
// 換算比例：1mm ≈ 1.7px（96dpi * 0.45縮放）
const MM_TO_PX = 1.7;
function mmToPx(mm){ return Math.round(mm * MM_TO_PX); }

// 預設書本尺寸（mm）—— A5 平裝書標準
const _BOOK_DEFAULT_MM = {
  thickMM: 20,   // 書背厚度（mm）→ 書背寬
  heightMM: 210, // 書本高（mm）
  widthMM:  148, // 書本寬（mm）
};
// 轉成 px（渲染用）
const _BOOK_DEFAULT = {
  spineW: mmToPx(_BOOK_DEFAULT_MM.thickMM),   // ~34px
  bookH:  mmToPx(_BOOK_DEFAULT_MM.heightMM),   // ~357px → 壓縮顯示
  bookW:  mmToPx(_BOOK_DEFAULT_MM.widthMM),    // ~252px
};
// 書架顯示高度縮放（手機螢幕空間有限）
const SHELF_SCALE = 0.5;  // 顯示時縮放為50%

// ════════════════════════════════════════════════════════════
// 書庫渲染入口
// ════════════════════════════════════════════════════════════
async function renderBooks(){
  try{
    _B.page     = 0;
    _B.allBooks = await _getBooksMetaList();
    _renderShelf();
  }catch(e){ logError('renderBooks',e); }
}

// 取得不含大 Blob 的 metadata 列表
async function _getBooksMetaList(){
  const all = await _db.ebooks.toArray();
  // 排除 blob（大檔）、coverBlob（原圖），保留 coverThumb（已壓縮小圖）
  return all.map(({blob:_b, coverBlob:_cb, ...meta}) => meta);
}

// ════════════════════════════════════════════════════════════
// 篩選 + 搜尋
// ════════════════════════════════════════════════════════════
function _filteredBooks(){
  const kw = _B.kw.toLowerCase();
  let list = _B.allBooks;
  if(_B.filter === 'recent') list = [...list].filter(b=>b.lastRead).sort((a,b)=>(b.lastRead||0)-(a.lastRead||0));
  else if(_B.filter === 'fav')  list = list.filter(b=>b.favorite);
  else if(_B.filter === 'pdf')  list = list.filter(b=>b.fileType==='pdf');
  else if(_B.filter === 'epub') list = list.filter(b=>b.fileType==='epub');
  if(kw){
    list = list.filter(b=>
      (b.title||'').toLowerCase().includes(kw)||
      (b.author||'').toLowerCase().includes(kw)||
      (b.category||'').toLowerCase().includes(kw)||
      (b.tags||[]).join(' ').toLowerCase().includes(kw)
    );
  }
  return list;
}

// ════════════════════════════════════════════════════════════
// 書架渲染（書背模式）
// ════════════════════════════════════════════════════════════
function _renderShelf(){
  const el  = document.getElementById('books-list');
  const cnt = document.getElementById('books-count');
  if(!el) return;

  const list  = _filteredBooks();
  const total = list.length;
  if(cnt) cnt.textContent = total ? `共 ${total} 本` : '';

  if(!total){
    el.innerHTML=`<div class="empty"><span class="ic">📚</span><span>尚無書籍，點右上角＋新增</span></div>`;
    return;
  }

  const batch = list.slice(0, (_B.page+1)*_B.PAGE);
  el.innerHTML = '';

  const shelf = document.createElement('div');
  shelf.className = 'bookshelf';

  // 書背依顯示寬度分行（每行填滿後換行，下方加木板）
  const containerW = Math.min(window.innerWidth, 540) - 28; // 14px padding *2
  let rowDiv = null;
  let rowUsed = 0;
  const GAP = 3;

  batch.forEach(b => {
    const thickMM  = b.thickMM  || _BOOK_DEFAULT_MM.thickMM;
    const heightMM = b.heightMM || _BOOK_DEFAULT_MM.heightMM;
    const dispW = Math.round(mmToPx(thickMM) * SHELF_SCALE);
    const dispH = Math.round(mmToPx(heightMM) * SHELF_SCALE);

    if(!rowDiv || rowUsed + dispW + GAP > containerW){
      if(rowDiv){
        // 填充空白（讓最後一本書也有書架感）
        const spacer = document.createElement('div');
        spacer.style.cssText='flex:1;min-width:0';
        rowDiv.appendChild(spacer);
        // 加木板
        const plank = document.createElement('div');
        plank.className = 'shelf-plank';
        shelf.appendChild(plank);
      }
      rowDiv = document.createElement('div');
      rowDiv.className = 'shelf-row';
      shelf.appendChild(rowDiv);
      rowUsed = 0;
    }
    rowDiv.appendChild(_mkSpine(b));
    rowUsed += dispW + GAP;
  });

  // 最後一行也加木板（書沒滿時補空白）
  if(rowDiv){
    const spacer = document.createElement('div');
    spacer.style.cssText='flex:1;min-width:0';
    rowDiv.appendChild(spacer);
    const plank = document.createElement('div');
    plank.className = 'shelf-plank';
    shelf.appendChild(plank);
  }

  el.appendChild(shelf);

  // 無限捲動觸發點
  if(batch.length < total){
    const trigger = document.createElement('div');
    trigger.style.height = '20px';
    el.appendChild(trigger);
    const obs = new IntersectionObserver(entries=>{
      if(entries[0].isIntersecting){ obs.disconnect(); _B.page++; _renderShelf(); }
    },{rootMargin:'80px'});
    obs.observe(trigger);
  }
}

// 書背卡片
function _mkSpine(b){
  // 若有 mm 尺寸就換算，否則用舊 px 值相容
  const spineW = b.thickMM ? mmToPx(b.thickMM) : (b.spineW || _BOOK_DEFAULT.spineW);
  const bookH  = b.heightMM? mmToPx(b.heightMM): (b.bookH  || _BOOK_DEFAULT.bookH);
  const bookW  = b.widthMM ? mmToPx(b.widthMM) : (b.bookW  || _BOOK_DEFAULT.bookW);

  // 顯示高度縮放（保持比例，書背寬不縮放太多）
  const dispH  = Math.round(bookH * SHELF_SCALE);
  const dispW  = Math.round(spineW * SHELF_SCALE);

  const div = document.createElement('div');
  div.className   = 'book-spine';
  div.style.width = dispW + 'px';
  div.style.height= dispH + 'px';
  div.dataset.bookId = b.id;
  div.title       = b.title || '未命名';
  div.onclick     = () => openBookCover(b.id);

  // 書背色：依分類或 id 決定顏色
  const colors = [
    ['#1a3a5c','#4a8ab5'],['#3a1a1a','#b54a4a'],['#1a3a1a','#4ab54a'],
    ['#3a2a1a','#b5844a'],['#2a1a3a','#844ab5'],['#1a3a3a','#4ab5b5'],
    ['#3a1a2a','#b54a84'],['#2a3a1a','#84b54a'],
  ];
  const [bg, accent] = colors[(b.id||0) % colors.length];

  // 書背圖（壓縮成書背尺寸的縮圖）或純色+書名
  if(b.spineThumb){
    div.innerHTML=`<img src="${b.spineThumb}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
  } else {
    div.style.background=`linear-gradient(180deg,${bg} 0%,${accent}44 100%)`;
    div.style.borderLeft=`2px solid ${accent}66`;
    // 書名垂直顯示
    const label = document.createElement('div');
    label.className = 'spine-label';
    label.textContent = b.title || '未命名';
    div.appendChild(label);
    // 作者（小字）
    if(b.author){
      const auth = document.createElement('div');
      auth.className = 'spine-author';
      auth.textContent = b.author;
      div.appendChild(auth);
    }
  }
  return div;
}

// ════════════════════════════════════════════════════════════
// 點書背 → 彈出封面大圖
// ════════════════════════════════════════════════════════════
async function openBookCover(id){
  // metadata 只需從快取找，不讀大 Blob
  const b = _B.allBooks.find(x=>x.id===id);
  if(!b) return;

  const bookW = b.widthMM  ? mmToPx(b.widthMM)  : (b.bookW || _BOOK_DEFAULT.bookW);
  const bookH = b.heightMM ? mmToPx(b.heightMM) : (b.bookH  || _BOOK_DEFAULT.bookH);
  // 封面彈窗顯示比例（放大3倍顯示）
  const dispH = Math.min(bookH * 3, window.innerHeight * 0.65);
  const dispW = Math.round(dispH * bookW / bookH);

  const ov = document.createElement('div');
  ov.id = 'book-cover-ov';
  ov.style.cssText = `position:fixed;inset:0;z-index:500;
    background:rgba(0,0,0,0.82);display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:16px`;
  ov.onclick = e=>{ if(e.target===ov) ov.remove(); };

  // 封面圖（coverThumb 是壓縮後封面，非書背）
  const coverHtml = b.coverThumb
    ? `<img src="${b.coverThumb}" style="width:${dispW}px;height:${dispH}px;
        object-fit:cover;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,0.7)">`
    : `<div style="width:${dispW}px;height:${dispH}px;border-radius:6px;
        background:linear-gradient(135deg,#1a3a5c,#4a8ab5);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:12px;box-shadow:0 12px 40px rgba(0,0,0,0.7);padding:16px;box-sizing:border-box">
        <div style="font-size:18px;font-weight:700;color:#fff;text-align:center;line-height:1.4">${esc(b.title||'未命名')}</div>
        ${b.author?`<div style="font-size:12px;color:rgba(255,255,255,0.6)">${esc(b.author)}</div>`:''}
      </div>`;

  ov.innerHTML = `
    ${coverHtml}
    <div style="display:flex;gap:10px">
      <button onclick="openBookDetail(${id});document.getElementById('book-cover-ov').remove()"
        style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);
        color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;cursor:pointer">
        📖 書籍資訊
      </button>
      <button onclick="document.getElementById('book-cover-ov').remove()"
        style="background:none;border:1px solid rgba(255,255,255,0.2);
        color:rgba(255,255,255,0.6);padding:8px 16px;border-radius:20px;font-size:13px;cursor:pointer">
        ✕
      </button>
    </div>`;
  document.body.appendChild(ov);
}

// ════════════════════════════════════════════════════════════
// 新增書籍（表單 overlay）
// ════════════════════════════════════════════════════════════
function openAddBook(){
  const ov = document.createElement('div');
  ov.id = 'add-book-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end';
  ov.innerHTML = `
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:90vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
      <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:14px">新增書籍</div>

      <div style="display:flex;gap:12px;margin-bottom:12px">
        <!-- 封面預覽 -->
        <div id="ab-cover-preview" onclick="document.getElementById('ab-cover-inp').click()"
          style="width:72px;height:96px;border-radius:6px;background:rgba(255,255,255,0.06);
          border:1.5px dashed rgba(255,255,255,0.2);cursor:pointer;flex-shrink:0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
          font-size:10px;color:var(--t2)">
          <span style="font-size:22px">🖼</span>封面
        </div>
        <input type="file" id="ab-cover-inp" accept="image/*" style="display:none"
          onchange="previewBookCover(this)">
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
          <input id="ab-title" placeholder="書名 *" class="finput">
          <input id="ab-author" placeholder="作者" class="finput">
          <input id="ab-category" placeholder="分類（如：法律、歷史）" class="finput">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:6px">
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">厚度 mm</div>
          <input id="ab-thick" type="number" value="${_BOOK_DEFAULT_MM.thickMM}" min="5" max="100" class="finput" style="text-align:center">
        </div>
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">高度 mm</div>
          <input id="ab-height" type="number" value="${_BOOK_DEFAULT_MM.heightMM}" min="100" max="300" class="finput" style="text-align:center">
        </div>
        <div>
          <div style="font-size:10px;color:var(--t2);margin-bottom:3px">寬度 mm</div>
          <input id="ab-width" type="number" value="${_BOOK_DEFAULT_MM.widthMM}" min="80" max="220" class="finput" style="text-align:center">
        </div>
      </div>
      <div style="font-size:10px;color:var(--t2);margin-bottom:12px">
        ↑ 輸入實際書本尺寸（mm），系統自動換算。預設為 A5 平裝書（210×148mm，厚20mm）
      </div>

      <label style="font-size:11px;color:var(--t2);display:flex;align-items:center;gap:6px;margin-bottom:12px">
        <input type="file" id="ab-file-inp" accept=".pdf,.epub,.txt" style="display:none"
          onchange="document.getElementById('ab-file-lbl').textContent=this.files[0]?.name||'尚未選擇'">
        <button onclick="document.getElementById('ab-file-inp').click()"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--bd);color:var(--t1);
          padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer">選擇檔案</button>
        <span id="ab-file-lbl" style="color:var(--t2)">尚未選擇（可空）</span>
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
  ov.onclick = e=>{ if(e.target===ov) ov.remove(); };
  document.body.appendChild(ov);
}

// 封面預覽（選圖後立即顯示縮圖）
function previewBookCover(inp){
  if(!inp.files[0]) return;
  const reader = new FileReader();
  reader.onload = e=>{
    const preview = document.getElementById('ab-cover-preview');
    if(preview){
      preview.innerHTML=`<img src="${e.target.result}"
        style="width:100%;height:100%;object-fit:cover;border-radius:6px">`;
      preview.style.border='none';
    }
  };
  reader.readAsDataURL(inp.files[0]);
}

// 儲存新書
async function saveNewBook(){
  const title    = document.getElementById('ab-title')?.value.trim();
  if(!title){ toast('請填寫書名'); return; }

  const thickMM  = parseInt(document.getElementById('ab-thick')?.value)  || _BOOK_DEFAULT_MM.thickMM;
  const heightMM = parseInt(document.getElementById('ab-height')?.value) || _BOOK_DEFAULT_MM.heightMM;
  const widthMM  = parseInt(document.getElementById('ab-width')?.value)  || _BOOK_DEFAULT_MM.widthMM;
  const coverInp = document.getElementById('ab-cover-inp');
  const fileInp  = document.getElementById('ab-file-inp');

  let coverThumb = null;   // 封面縮圖（用於封面彈窗）
  let spineThumb = null;   // 書背縮圖（壓縮成書背尺寸）

  // 處理封面圖
  if(coverInp?.files[0]){
    const img = coverInp.files[0];
    // 封面縮圖：壓縮到最大 200px 寬
    const pxW = mmToPx(widthMM), pxH = mmToPx(heightMM), pxS = mmToPx(thickMM);
    coverThumb = await _compressImage(img, 200, Math.round(200 * pxH / pxW));
    // 書背縮圖：壓縮到書背尺寸
    spineThumb = await _compressImage(img, pxS * 2, pxH * 2);
  }

  const book = {
    title,
    author:     document.getElementById('ab-author')?.value.trim()||'',
    category:   document.getElementById('ab-category')?.value.trim()||'',
    fileType:   fileInp?.files[0]?.name.split('.').pop().toLowerCase()||'',
    fileSize:   fileInp?.files[0]?.size||0,
    blob:       fileInp?.files[0]||null,
    coverThumb,   // 封面縮圖（base64，約20-60KB）
    spineThumb,   // 書背縮圖（base64，極小）
    thickMM, heightMM, widthMM,
    tags:       [],
    favorite:   false,
    lastRead:   null,
    lastPage:   0,
    createdAt:  Date.now(),
  };

  try{
    await dp('ebooks', book);
    toast('已新增：'+title);
    document.getElementById('add-book-ov')?.remove();
    renderBooks();
  }catch(e){ logError('saveNewBook',e); toast('儲存失敗：'+e.message); }
}

// Canvas 壓縮圖片 → base64
function _compressImage(file, maxW, maxH){
  return new Promise((resolve)=>{
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        const canvas = document.createElement('canvas');
        // 維持原始比例，最大不超過 maxW × maxH
        let w = img.width, h = img.height;
        const scaleW = maxW/w, scaleH = maxH/h;
        const scale  = Math.min(scaleW, scaleH, 1);
        canvas.width  = Math.round(w*scale);
        canvas.height = Math.round(h*scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════
// 書籍詳情視窗
// ════════════════════════════════════════════════════════════
async function openBookDetail(id){
  const book = await dg('ebooks', id);
  if(!book){ toast('找不到書籍'); return; }

  const ov = document.createElement('div');
  ov.id = 'book-detail-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end';
  const ext = (book.fileType||'').toUpperCase();

  ov.innerHTML=`
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
      <div style="display:flex;gap:14px;margin-bottom:16px">
        ${book.coverThumb
          ?`<img src="${book.coverThumb}" style="width:72px;height:96px;object-fit:cover;border-radius:6px;flex-shrink:0">`
          :`<div style="width:72px;height:96px;border-radius:6px;background:rgba(255,255,255,0.06);
              display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">📚</div>`
        }
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:700;color:var(--t0);margin-bottom:4px">${esc(book.title||'未命名')}</div>
          ${book.author?`<div style="font-size:12px;color:var(--t2);margin-bottom:6px">✍ ${esc(book.author)}</div>`:''}
          ${book.category?`<div style="font-size:11px;color:var(--acc)">${esc(book.category)}</div>`:''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:12px;color:var(--t2)">
        <div>格式：<b style="color:var(--t1)">${ext||'—'}</b></div>
        <div>大小：<b style="color:var(--t1)">${_fmtSize(book.fileSize||0)||'—'}</b></div>
        <div>上次閱讀：<b style="color:var(--t1)">${book.lastRead?new Date(book.lastRead).toLocaleDateString('zh-TW'):'未讀'}</b></div>
        <div>新增時間：<b style="color:var(--t1)">${new Date(book.createdAt).toLocaleDateString('zh-TW')}</b></div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('book-detail-ov').remove()"
          style="flex:1;padding:12px;background:rgba(255,255,255,0.06);border:1px solid var(--bd);
          color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">關閉</button>
        ${book.blob?`<button onclick="downloadBook(${id})"
          style="flex:1;padding:12px;background:rgba(37,98,200,0.85);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600">⬇ 下載</button>`:''}
        <button onclick="confirmDeleteBook(${id})"
          style="flex:1;padding:12px;background:rgba(200,50,50,0.7);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:13px">🗑 刪除</button>
      </div>
    </div>`;
  ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
  document.body.appendChild(ov);
  await updateEbookProgress(id, book.lastPage||0);
}

async function downloadBook(id){
  const book = await dg('ebooks', id);
  if(!book?.blob){ toast('無附加檔案'); return; }
  const url = URL.createObjectURL(book.blob);
  const a = document.createElement('a');
  a.href = url; a.download = (book.title||'book')+'.'+(book.fileType||'pdf');
  a.click(); setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

// ════════════════════════════════════════════════════════════
// 篩選 / 搜尋觸發
// ════════════════════════════════════════════════════════════
function setBooksFilter(btn, filter){
  document.querySelectorAll('#books-chips .chip').forEach(c=>c.classList.remove('on'));
  btn.classList.add('on');
  _B.filter=filter; _B.page=0; _renderShelf();
}
function searchBooks(){
  _B.kw=(document.getElementById('books-si')?.value||'').trim();
  _B.page=0; _renderShelf();
}

// ════════════════════════════════════════════════════════════
// 收藏 / 刪除
// ════════════════════════════════════════════════════════════
async function toggleBookFav(id, btn){
  try{
    const book=await dg('ebooks',id); if(!book) return;
    book.favorite=!book.favorite; await dp('ebooks',book);
    btn.className=book.favorite?'book-fav on':'book-fav';
    btn.textContent=book.favorite?'⭐':'☆';
    const idx=_B.allBooks.findIndex(b=>b.id===id);
    if(idx>=0) _B.allBooks[idx].favorite=book.favorite;
  }catch(e){ logError('toggleBookFav',e); }
}

async function confirmDeleteBook(id){
  if(!confirm('確定刪除這本書？此操作無法復原。')) return;
  await dd('ebooks',id);
  _B.allBooks=_B.allBooks.filter(b=>b.id!==id);
  _renderShelf(); toast('已刪除');
  document.getElementById('book-detail-ov')?.remove();
  document.getElementById('book-cover-ov')?.remove();
}

// ════════════════════════════════════════════════════════════
// 工具
// ════════════════════════════════════════════════════════════
function _fmtSize(bytes){
  if(!bytes) return '';
  if(bytes<1024) return bytes+'B';
  if(bytes<1048576) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1048576).toFixed(1)+'MB';
}
