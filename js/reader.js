// ══ reader.js — 書庫閱讀器（v4.59.0，foliate-js 引擎）══════════════════════
// 引擎：js/foliate/（foliate-js，MIT；Readest 用的同一套）。Readest 本身是 AGPL，這裡沒有用它的程式碼，
//   只參考它的操作方式：沉浸式閱讀、點中間叫出工具列、目錄／書籤／筆記／全書搜尋、選字畫重點與筆記、
//   字級行距邊距字型、四種底色、分頁／捲動、PDF 縮放、本章剩幾頁與預估時間。
// 支援：EPUB、MOBI、AZW3（KF8）、FB2、CBZ（漫畫）、PDF（PDF.js，App 也能看）。TXT 照舊用 books.js 的捲動閱讀。
// 資料：存在 ebooks 那一筆：lastCfi（位置）、progress（0～1）、annos（重點與筆記）、marks（書籤）。
//   書架、資料夾備份的 meta.json 都會帶著，不必另外處理。
// 安全：書的頁面在 sandbox iframe 裡，拿掉 allow-scripts，書裡的程式碼不會執行（見 js/foliate/NOTICE.md）。
// ════════════════════════════════════════════════════════════════════
const RD_EXT = ['epub', 'mobi', 'azw3', 'azw', 'kf8', 'prc', 'fb2', 'fbz', 'cbz', 'pdf'];
const _RD = { view:null, rec:null, id:null, ext:'', loc:null, saveT:null, bars:false, prefs:null, Overlayer:null,
              fixed:false, sel:null, idxOf:new Map(), searchGen:0, tocHref:'', opening:false };

const RD_THEMES = {
  dark:  { name:'夜間',   bg:'#141414', fg:'#d6d6d6', sub:'#8a8a8a', link:'#8ab4f8', ui:'dark' },
  sepia: { name:'羊皮紙', bg:'#f4ecd8', fg:'#4a3b2a', sub:'#8b7a62', link:'#7a4b16', ui:'light' },
  green: { name:'護眼綠', bg:'#cfe6d0', fg:'#1f2a20', sub:'#5b6f5c', link:'#1f5f8b', ui:'light' },
  light: { name:'白紙',   bg:'#fbfbf9', fg:'#1b1b1b', sub:'#7a7a7a', link:'#1a5fb4', ui:'light' },
};
const RD_FONTS = {
  sans:  { name:'黑體', css:'"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif' },
  serif: { name:'明體', css:'"Noto Serif TC","Songti TC","PMingLiU","MingLiU",serif' },
  book:  { name:'原書', css:'' },
};
const RD_MARGIN = { s:{ name:'窄', gap:.035 }, m:{ name:'中', gap:.06 }, l:{ name:'寬', gap:.1 } };
const RD_COLORS = { yellow:'#ffd54f', green:'#81c784', blue:'#64b5f6', pink:'#f48fb1', line:'#e53935' };
const RD_DEFAULT = { fontSize:19, lineHeight:1.8, margin:'m', font:'sans', theme:'dark', flow:'paginated',
                     cols:'auto', justify:true, indent:false, pdfZoom:'fit-page', pdfDark:false };

function rdSupports(ext){ return RD_EXT.includes(String(ext || '').toLowerCase()); }

async function _rdLoadPrefs(){
  let p = {};
  try{ p = JSON.parse(await getSetting('reader_prefs', '{}')) || {}; }catch(_){}
  _RD.prefs = { ...RD_DEFAULT, ...p };
  if(!RD_THEMES[_RD.prefs.theme]) _RD.prefs.theme = 'dark';
  return _RD.prefs;
}
function _rdSavePrefs(){ setSetting('reader_prefs', JSON.stringify(_RD.prefs)).catch(()=>{}); }

// ── 開書 ───────────────────────────────────────────────────────────
async function rdOpen(rec){
  if(_RD.opening) return;
  _RD.opening = true;
  try{
    await _rdLoadPrefs();
    await _rdFontsReady();
    const ext = String(rec.fileType || '').toLowerCase();
    Object.assign(_RD, { rec, id:rec.id, ext, loc:null, bars:false, sel:null, idxOf:new Map(), tocHref:'' });
    const ov = document.createElement('div');
    ov.id = 'book-reader-ov';
    ov.className = 'book-ov-full rd';
    ov.dataset.bookId = rec.id;
    ov.innerHTML = _rdShell(rec);
    document.body.appendChild(ov);
    document.documentElement.classList.add('reader-active');
    _rdApplyChrome();

    await import('./foliate/view.js');                 // 相對於這支 js/reader.js
    _RD.Overlayer = (await import('./foliate/overlayer.js')).Overlayer;
    const view = document.createElement('foliate-view');
    view.id = 'rd-view';
    ov.querySelector('.rd-stage').prepend(view);
    _RD.view = view;
    const file = new File([rec.blob], 'book.' + (ext || 'epub'), { type: rec.blob.type || '' });
    await view.open(file);
    if(_RD.view !== view) return;                       // 開檔途中被關掉
    _RD.fixed = !!view.isFixedLayout;
    window._ycBookTTS = _RD_TTS;
    ov.classList.toggle('rd-fixed', _RD.fixed);
    _rdBindView(view);
    _rdApplyLayout();
    _rdApplyStyles();
    let ok = false;
    if(rec.lastCfi){
      try{ await view.init({ lastLocation: rec.lastCfi }); ok = !!view.lastLocation; }catch(_){}
    }
    if(!ok){
      try{ await view.init({ showTextStart: !rec.lastCfi && !_RD.fixed }); }
      catch(_){ await view.init({}); }
    }
    ov.querySelector('.rd-loading')?.remove();
    _rdRenderToc();
    _rdTicks();
    _rdTimerStart();
    if(_RD.prefs.ruler && !_RD.fixed) _rdRulerShow(true);
    if(!rec.lastCfi) _rdShowBars(true);                  // 第一次打開：先露出工具列，讓人知道在哪
  }catch(e){
    logError('rdOpen', e);
    const ov = document.getElementById('book-reader-ov');
    const ld = ov?.querySelector('.rd-loading');
    if(ld) ld.innerHTML = `<div style="font-size:40px">📕</div><div>這本書打不開（${esc(e.message || String(e))}）</div>
      <div style="font-size:12px;opacity:.7">檔案可能損毀或有 DRM 加密。</div>
      <button class="rd-btn-pri" onclick="downloadBook(${+rec.id})">⬇ 下載檔案</button>`;
    // epub 打不開時改用舊的 epub.js 閱讀器試試
    if(String(rec.fileType).toLowerCase() === 'epub' && typeof _initEpubLegacy === 'function'){
      _rdTeardown();
      _initEpubLegacy(rec);
    }
  }finally{ _RD.opening = false; }
}

const _RD_ICO = {
  back:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  toc:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  search:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  mark:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  aa:'<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><text x="1" y="18" font-size="15" font-weight="700" font-family="Georgia,serif">A</text><text x="12.5" y="18" font-size="10.5" font-weight="700" font-family="Georgia,serif">A</text></svg>',
  tts:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  prev:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>',
  next:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>',
};

function _rdShell(rec){
  return `
  <div class="rd-stage"><div class="rd-loading"><div class="rd-spin"></div><div>開啟中…</div></div></div>
  <div class="rd-mini rd-mini-top" id="rd-mini-top"></div>
  <div class="rd-mini rd-mini-bot" id="rd-mini-bot"></div>
  <header class="rd-top" id="rd-top">
    <button class="rd-ib" onclick="closeBookReader(${+rec.id})" aria-label="返回">${_RD_ICO.back}</button>
    <div class="rd-ttl"><b>${esc(rec.title || '閱讀中')}</b><small id="rd-chap"></small></div>
    <button class="rd-ib" onclick="_rdSearchOpen()" aria-label="全書搜尋">${_RD_ICO.search}</button>
    <button class="rd-ib" id="rd-mark-btn" onclick="_rdToggleMark()" aria-label="書籤">${_RD_ICO.mark}</button>
    <button class="rd-ib" onclick="_rdTts()" id="tts-epub-btn" aria-label="朗讀">${_RD_ICO.tts}</button>
    <button class="rd-ib" onclick="_rdTools()" aria-label="更多工具"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
  </header>
  <footer class="rd-bot" id="rd-bot">
    <div class="rd-prog">
      <button class="rd-ib sm" onclick="_rdSection(-1)" aria-label="上一章">${_RD_ICO.prev}</button>
      <div class="rd-slider-wrap"><input type="range" id="rd-slider" min="0" max="1" step="0.0005" value="0"
        oninput="_rdSliderPreview(this.value)" onchange="_rdSliderGo(this.value)"><div class="rd-ticks" id="rd-ticks"></div></div>
      <button class="rd-ib sm" onclick="_rdSection(1)" aria-label="下一章">${_RD_ICO.next}</button>
    </div>
    <div class="rd-prog-txt" id="rd-prog-txt"></div>
    <nav class="rd-tabs">
      <button onclick="_rdSide('toc')">${_RD_ICO.toc}<span>目錄</span></button>
      <button onclick="_rdSide('marks')">${_RD_ICO.mark}<span>書籤</span></button>
      <button onclick="_rdSide('annos')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg><span>筆記</span></button>
      <button onclick="_rdAa()">${_RD_ICO.aa}<span>版面</span></button>
    </nav>
  </footer>
  <div class="rd-scrim" id="rd-scrim" onclick="_rdCloseLayers()"></div>
  <aside class="rd-side" id="rd-side"></aside>
  <section class="rd-sheet" id="rd-aa"></section>
  <section class="rd-sheet" id="rd-tools"></section>
  <div class="rd-pop" id="rd-pop"></div>`;
}

// ── 版面（外框跟著底色）──────────────────────────────────────────────
function _rdApplyChrome(){
  const ov = document.getElementById('book-reader-ov'); if(!ov || !_RD.prefs) return;
  const t = RD_THEMES[_RD.prefs.theme];
  ov.style.setProperty('--rd-bg', t.bg);
  ov.style.setProperty('--rd-fg', t.fg);
  ov.style.setProperty('--rd-sub', t.sub);
  ov.dataset.ui = t.ui;
  ov.classList.toggle('rd-pdf-dark', !!(_RD.fixed && _RD.prefs.pdfDark));
}
function _rdApplyLayout(view){
  view = view || _RD.view;
  const r = view?.renderer; if(!r) return;
  const p = _RD.prefs;
  if(view.isFixedLayout){ r.setAttribute('zoom', p.pdfZoom || 'fit-page'); return; }
  r.setAttribute('flow', p.flow === 'scrolled' ? 'scrolled' : 'paginated');
  r.setAttribute('gap', ((RD_MARGIN[p.margin] || RD_MARGIN.m).gap * 100) + '%');
  r.setAttribute('margin', '34px');
  r.setAttribute('max-inline-size', '720px');
  r.setAttribute('max-column-count', p.cols === '1' || view !== _RD.view ? '1' : '2');
  r.toggleAttribute('animated', true);
}
function _rdBookCSS(){
  const p = _RD.prefs, t = RD_THEMES[p.theme];
  const uf = String(p.font).startsWith('u:') ? _RDF.list.find(x => 'u:' + x.id === p.font) : null;
  const f = uf ? { css:`"ycf-${uf.id}", "Noto Sans TC", sans-serif` } : (RD_FONTS[p.font] || RD_FONTS.sans);
  return `@namespace epub "http://www.idpf.org/2007/ops";
  ${uf && _RDF.urls.get(uf.id) ? `@font-face { font-family:"ycf-${uf.id}"; src:url("${_RDF.urls.get(uf.id)}"); font-display:swap; }` : ''}
  html { color-scheme:${t.ui}; font-size:${p.fontSize}px !important; }
  html, body { background:${t.bg} !important; color:${t.fg} !important; }
  body *:not(img):not(svg):not(svg *):not(video) { color:inherit !important; background-color:transparent !important; }
  a, a * { color:${t.link} !important; }
  body { font-size:1rem !important; -webkit-text-size-adjust:none; }
  ${f.css ? `body, p, div, span, li, td, th, blockquote, dd, dt, h1, h2, h3, h4, h5, h6 { font-family:${f.css} !important; }` : ''}
  p, li, blockquote, dd, div { line-height:${p.lineHeight} !important; }
  p { text-align:${p.justify ? 'justify' : 'start'}; ${p.indent ? 'text-indent:2em;' : ''} widows:2; orphans:2; }
  h1, h2, h3, h4 { line-height:1.4 !important; }
  img, svg, video { max-width:100% !important; height:auto; }
  pre { white-space:pre-wrap !important; }
  ::selection { background:rgba(100,149,237,.35); }
  .tts-reading-hl { background:rgba(255,213,79,.32) !important; border-radius:3px; }
  aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display:none; }`;
}
function _rdApplyStyles(){
  _rdApplyChrome();
  for(const v of [_RD.view, _RD2.view]){
    if(v?.renderer && !v.isFixedLayout) v.renderer.setStyles?.(_rdBookCSS());
  }
  _rdRulerPlace();
}

// ── 事件 ───────────────────────────────────────────────────────────
function _rdBindView(view){
  view.addEventListener('relocate', e => _rdOnRelocate(e.detail));
  view.addEventListener('load', e => _rdOnDocLoad(e.detail));
  view.addEventListener('link', e => _rdOnLink(e));
  view.addEventListener('external-link', e => { e.preventDefault(); toast('外部連結：' + (e.detail.href_ || '').slice(0, 60)); });
  view.addEventListener('create-overlay', e => _rdDrawAnnos(e.detail.index));
  view.addEventListener('draw-annotation', e => {
    const { draw, annotation } = e.detail;
    if(annotation.color === 'line') draw(_RD.Overlayer.underline, { color: RD_COLORS.line, width: 2 });
    else draw(_RD.Overlayer.highlight, { color: RD_COLORS[annotation.color] || RD_COLORS.yellow });
  });
  view.addEventListener('show-annotation', e => { _RD.annoHit = Date.now(); _rdAnnoPop(e.detail.value, e.detail.range); });
  document.addEventListener('keydown', _rdKey);
}
function _rdOnDocLoad({ doc, index }){
  doc.addEventListener('keydown', _rdKey);
  // 點一下：左右翻頁、中間叫出工具列（有選字、點到連結或重點時不處理）
  doc.addEventListener('click', e => setTimeout(() => {    // 等重點的點擊（show-annotation）先處理
    if(e.defaultPrevented) return;
    if(e.target.closest?.('a[href]')) return;
    if(Date.now() - (_RD.annoHit || 0) < 400) return;
    const sel = doc.getSelection?.();
    if(sel && !sel.isCollapsed) return;
    if(_rdLayerOpen()){ _rdCloseLayers(); return; }
    const fr = doc.defaultView.frameElement?.getBoundingClientRect();
    const vr = _RD.view.getBoundingClientRect();
    const x = (fr ? fr.left : 0) + e.clientX - vr.left;
    const w = vr.width;
    if(_RD.prefs.flow !== 'scrolled' || _RD.fixed){
      if(x < w * .28){ _rdHideBars(); _RD.view.goLeft(); return; }
      if(x > w * .72){ _rdHideBars(); _RD.view.goRight(); return; }
    }
    _rdShowBars(!_RD.bars);
  }, 0));
  // 選字 → 畫重點選單
  let selT = null;
  const onSel = () => {
    clearTimeout(selT);
    selT = setTimeout(() => {
      const sel = doc.getSelection?.();
      if(!sel || sel.isCollapsed || !sel.toString().trim()){ if(_RD.sel?.doc === doc && !_RD.sel.anno) _rdPopHide(); return; }
      const range = sel.getRangeAt(0);
      _RD.sel = { doc, index, range, text: sel.toString().trim() };
      _rdSelPop();
    }, 350);
  };
  doc.addEventListener('selectionchange', onSel);
  doc.addEventListener('pointerup', onSel);
}
function _rdLayerOpen(){
  return ['rd-side','rd-aa','rd-pop','rd-tools'].some(id => document.getElementById(id)?.classList.contains('on'));
}
function _rdShowBars(on){
  _RD.bars = !!on;
  document.getElementById('book-reader-ov')?.classList.toggle('bars', _RD.bars);
}
function _rdHideBars(){ if(_RD.bars) _rdShowBars(false); }
function _rdKey(e){
  if(!_RD.view || e.target?.matches?.('input,textarea')) return;
  const k = e.key;
  if(document.getElementById('rd-speed')){ if(k === ' '){ e.preventDefault(); _rdSpeedToggle(); } else if(k === 'Escape') _rdSpeedClose(); return; }
  if(k === 'ArrowLeft' || k === 'PageUp'){ e.preventDefault(); _RD.view.goLeft(); }
  else if(k === 'ArrowRight' || k === 'PageDown' || k === ' '){ e.preventDefault(); _RD.view.goRight(); }
  else if(k === 'Escape'){ if(_rdLayerOpen()) _rdCloseLayers(); else _rdShowBars(!_RD.bars); }
}

// 註腳：點了在下方小視窗顯示，不跳頁（Readest 的 footnote popover）
async function _rdOnLink(e){
  const { a, href } = e.detail;
  const isNote = /noteref|footnote|endnote/.test((a.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '') + ' ' + (a.getAttribute('role') || ''))
    || a.closest('sup') || /^\[?\d{1,3}\]?$/.test((a.textContent || '').trim());
  if(!isNote) return;                                  // 一般連結照常跳過去
  e.preventDefault();
  try{
    const book = _RD.view.book;
    const { index, anchor } = await book.resolveHref(href);
    const doc = await book.sections[index].createDocument();
    let el = anchor(doc);
    if(el && !(el instanceof Range)){
      while(el && el.parentElement && /^(A|SPAN|SUP|SUB|EM|STRONG|I|B|SMALL)$/.test(el.tagName)) el = el.parentElement;
    }
    const text = el instanceof Range ? el.toString() : (el?.textContent || '');
    if(!text.trim()) throw new Error('empty');
    _rdPopShow(`<div class="rd-note-pop"><div class="rd-pop-hd">註解</div><div class="rd-note-body">${esc(text.trim()).replace(/\n{2,}/g,'<br>')}</div>
      <div class="rd-pop-row"><button onclick="_rdPopHide();_RD.view.goTo('${String(href).replace(/['\\]/g, '')}')">跳到註解</button></div></div>`, null, true);
  }catch(_){ _RD.view.goTo(href); }
}

// ── 位置、進度 ─────────────────────────────────────────────────────
function _rdOnRelocate(d){
  _RD.loc = d;
  _RD.act = Date.now();
  const r = _RD.view.renderer;
  const pct = Math.round((d.fraction || 0) * 1000) / 10;
  const chap = d.tocItem?.label || '';
  const ch = document.getElementById('rd-chap'); if(ch) ch.textContent = chap;
  const sl = document.getElementById('rd-slider'); if(sl && !sl._drag) sl.value = d.fraction || 0;
  let pageTxt = '';
  if(_RD.fixed){
    const idx = (d.section?.current ?? d.index ?? 0) + 1, tot = d.section?.total || _RD.view.book.sections.length;
    pageTxt = `第 ${idx} / ${tot} 頁`;
  } else if(r && !r.scrolled && r.pages > 2){
    const pg = Math.min(Math.max(r.page, 1), r.pages - 2), pgs = r.pages - 2;
    const left = pgs - pg;
    pageTxt = left > 0 ? `本章還有 ${left} 頁` : '本章最後一頁';
  }
  const mins = d.time?.section;
  const timeTxt = !_RD.fixed && mins > 0.5 ? `約 ${Math.max(1, Math.round(mins))} 分鐘讀完本章` : '';
  const pt = document.getElementById('rd-prog-txt');
  if(pt) pt.textContent = [pct.toFixed(pct < 10 ? 1 : 0) + '%', pageTxt, timeTxt].filter(Boolean).join('　·　');
  // 不叫出工具列時的頁首、頁尾（細字）
  const mt = document.getElementById('rd-mini-top'), mb = document.getElementById('rd-mini-bot');
  if(mt) mt.textContent = _RD.fixed ? '' : chap;
  if(mb) mb.textContent = _RD.fixed ? pageTxt + '　' + Math.round(pct) + '%' : (pageTxt ? pageTxt + '　·　' : '') + Math.round(pct) + '%';
  if(d.tocItem?.href && d.tocItem.href !== _RD.tocHref){ _RD.tocHref = d.tocItem.href; _rdTocMark(); }
  _rdMarkBtn();
  if(_RD.sel && !_RD.sel.anno) _rdPopHide();
  _rdSaveSoon();
}
function _rdSaveSoon(){
  clearTimeout(_RD.saveT);
  _RD.saveT = setTimeout(_rdSaveNow, 1200);
}
async function _rdSaveNow(extra){
  clearTimeout(_RD.saveT); _RD.saveT = null;
  const id = _RD.id; if(id == null) return;
  try{
    const b = await dg('ebooks', id); if(!b) return;
    if(_RD.loc?.cfi) b.lastCfi = _RD.loc.cfi;
    if(typeof _RD.loc?.fraction === 'number') b.progress = Math.round(_RD.loc.fraction * 10000) / 10000;
    b.lastRead = Date.now();
    if(extra) Object.assign(b, extra);
    _rdAddTime(b);
    await dp('ebooks', b);
    Object.assign(_RD.rec, { lastCfi:b.lastCfi, progress:b.progress, lastRead:b.lastRead, annos:b.annos, marks:b.marks, readSec:b.readSec, readDays:b.readDays });
    const i = (_B.allBooks || []).findIndex(x => x.id === id);
    if(i >= 0) Object.assign(_B.allBooks[i], { lastCfi:b.lastCfi, progress:b.progress, lastRead:b.lastRead, readSec:b.readSec, readDays:b.readDays });
  }catch(e){ logError('rdSave', e); }
}
function _rdTicks(){
  const box = document.getElementById('rd-ticks'); if(!box || _RD.fixed) return;
  const fr = _RD.view.getSectionFractions?.() || [];
  box.innerHTML = fr.length < 80 ? fr.slice(1).map(f => `<i style="left:${(f * 100).toFixed(2)}%"></i>`).join('') : '';
}
function _rdSliderPreview(v){
  const s = document.getElementById('rd-slider'); if(s) s._drag = true;
  const pt = document.getElementById('rd-prog-txt'); if(pt) pt.textContent = '跳到 ' + Math.round(v * 100) + '%';
}
async function _rdSliderGo(v){
  const s = document.getElementById('rd-slider'); if(s) s._drag = false;
  if(_RD.fixed){
    const n = _RD.view.book.sections.length;
    await _RD.view.goTo(Math.min(n - 1, Math.round(v * (n - 1))));
  } else await _RD.view.goToFraction(+v);
}
async function _rdSection(dir){
  const r = _RD.view?.renderer; if(!r) return;
  if(_RD.fixed){ dir > 0 ? _RD.view.next() : _RD.view.prev(); return; }
  if(dir > 0) await r.nextSection?.(); else await r.prevSection?.();
}

// ── 側欄：目錄、書籤、筆記 ─────────────────────────────────────────
function _rdSide(tab){
  const side = document.getElementById('rd-side'); if(!side) return;
  side.dataset.tab = tab;
  side.innerHTML = `<div class="rd-side-hd">
      <div class="rd-seg">${[['toc','目錄'],['marks','書籤'],['annos','筆記']].map(([k, n]) => `<button class="${k === tab ? 'on' : ''}" onclick="_rdSide('${k}')">${n}</button>`).join('')}</div>
      <button class="rd-ib sm" onclick="_rdCloseLayers()" aria-label="關閉">✕</button></div>
    <div class="rd-side-body" id="rd-side-body"></div>`;
  if(tab === 'toc') _rdRenderToc();
  else if(tab === 'marks') _rdRenderMarks();
  else _rdRenderAnnos();
  side.classList.add('on'); document.getElementById('rd-scrim')?.classList.add('on');
}
function _rdRenderToc(){
  const body = document.getElementById('rd-side-body');
  if(!body || document.getElementById('rd-side')?.dataset.tab !== 'toc') return;
  const toc = _RD.view?.book?.toc || [];
  if(!toc.length){
    body.innerHTML = _RD.fixed
      ? `<div class="rd-empty">這份 PDF 沒有目錄。可以用下方的進度條或搜尋。</div>`
      : `<div class="rd-empty">這本書沒有目錄。</div>`;
    return;
  }
  const walk = (items, lv) => items.map(it => `<button class="rd-toc-it lv${Math.min(lv, 3)}" data-href="${esc(it.href || '')}" onclick="_rdGo(this.dataset.href)">${esc((it.label || '').trim() || '（未命名）')}</button>`
    + (it.subitems?.length ? walk(it.subitems, lv + 1) : '')).join('');
  body.innerHTML = `<div class="rd-book-meta">${_rdMetaHtml()}</div>` + walk(toc, 0);
  _rdTocMark(true);
}
function _rdMetaHtml(){
  const r = _RD.rec, pct = Math.round((_RD.loc?.fraction ?? r.progress ?? 0) * 100);
  return `<b>${esc(r.title || '')}</b><small>${esc(r.author || '')}${r.author ? '　·　' : ''}已讀 ${pct}%</small>`;
}
function _rdTocMark(scroll){
  const body = document.getElementById('rd-side-body'); if(!body) return;
  body.querySelectorAll('.rd-toc-it.on').forEach(x => x.classList.remove('on'));
  const it = [...body.querySelectorAll('.rd-toc-it')].find(x => x.dataset.href === _RD.tocHref);
  if(it){ it.classList.add('on'); if(scroll) it.scrollIntoView({ block:'center' }); }
}
async function _rdGo(target){
  _rdCloseLayers(); _rdHideBars();
  if(target == null || target === '') return;
  await _RD.view.goTo(target);
}

// 書籤：目前這頁有沒有書籤（書籤位置落在這頁的範圍內）
function _rdPageHasMark(){
  const L = _RD.loc?.location; if(!L) return -1;
  return (_RD.rec.marks || []).findIndex(m => m.loc >= L.current && (m.loc < L.next || m.loc === L.current));
}
function _rdMarkBtn(){
  document.getElementById('rd-mark-btn')?.classList.toggle('on', _rdPageHasMark() >= 0);
  document.getElementById('book-reader-ov')?.classList.toggle('rd-marked', _rdPageHasMark() >= 0);
}
async function _rdToggleMark(){
  if(!_RD.loc?.cfi) return;
  const marks = [...(_RD.rec.marks || [])];
  const i = _rdPageHasMark();
  if(i >= 0){ marks.splice(i, 1); toast('已移除書籤'); }
  else{
    const ex = (_RD.loc.range?.toString?.() || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    marks.push({ cfi:_RD.loc.cfi, loc:_RD.loc.location?.current ?? 0, fraction:_RD.loc.fraction || 0,
                 label:_RD.loc.tocItem?.label || '', text:ex, at:Date.now() });
    marks.sort((a, b) => (a.fraction || 0) - (b.fraction || 0));
    toast('已加書籤');
  }
  _RD.rec.marks = marks;
  _rdMarkBtn();
  await _rdSaveNow({ marks });
  if(document.getElementById('rd-side')?.dataset.tab === 'marks') _rdRenderMarks();
}
function _rdRenderMarks(){
  const body = document.getElementById('rd-side-body'); if(!body) return;
  const marks = _RD.rec.marks || [];
  body.innerHTML = marks.length ? marks.map((m, i) => `<div class="rd-li" onclick="_rdGo(_RD.rec.marks[${i}].cfi)">
      <div class="rd-li-hd"><span>${esc(m.label || '書籤')}</span><em>${Math.round((m.fraction || 0) * 100)}%</em></div>
      ${m.text ? `<div class="rd-li-tx">${esc(m.text)}…</div>` : ''}
      <button class="rd-li-x" onclick="event.stopPropagation();_rdDelMark(${i})" aria-label="刪除">✕</button></div>`).join('')
    : `<div class="rd-empty">還沒有書籤。看到想留的地方，按上方的 🔖 就會記下這一頁。</div>`;
}
async function _rdDelMark(i){
  const marks = [...(_RD.rec.marks || [])]; marks.splice(i, 1);
  _RD.rec.marks = marks; await _rdSaveNow({ marks }); _rdRenderMarks(); _rdMarkBtn();
}

// ── 重點與筆記 ─────────────────────────────────────────────────────
async function _rdIndexOf(cfi){
  if(_RD.idxOf.has(cfi)) return _RD.idxOf.get(cfi);
  let i = -1;
  try{ i = (await _RD.view.resolveNavigation(cfi))?.index ?? -1; }catch(_){}
  _RD.idxOf.set(cfi, i);
  return i;
}
async function _rdDrawAnnos(index){
  for(const a of _RD.rec.annos || []){
    if(await _rdIndexOf(a.cfi) === index) _RD.view.addAnnotation({ value:a.cfi, color:a.color, note:a.note }).catch(()=>{});
  }
}
function _rdPopShow(html, rect, bottom){
  const pop = document.getElementById('rd-pop'); if(!pop) return;
  pop.innerHTML = html;
  pop.classList.add('on');
  pop.classList.toggle('dock', !!bottom || !rect);
  if(rect && !bottom){
    const W = innerWidth, ph = pop.offsetHeight, pw = pop.offsetWidth;
    let top = rect.top - ph - 10;
    if(top < 60) top = rect.bottom + 10;
    if(top + ph > innerHeight - 10) top = Math.max(10, innerHeight - ph - 10);
    pop.style.top = top + 'px';
    pop.style.left = Math.min(Math.max(8, rect.left + rect.width / 2 - pw / 2), W - pw - 8) + 'px';
  } else { pop.style.top = ''; pop.style.left = ''; }
}
function _rdPopHide(){
  const pop = document.getElementById('rd-pop');
  pop?.classList.remove('on', 'dock');
  _RD.sel = null;
}
function _rdRangeRect(range, doc){
  const r = range.getBoundingClientRect();
  const fr = doc.defaultView.frameElement?.getBoundingClientRect() || { left:0, top:0 };
  return { left:fr.left + r.left, top:fr.top + r.top, width:r.width, height:r.height, bottom:fr.top + r.bottom };
}
function _rdColorRow(cur){
  return `<div class="rd-colors">${Object.keys(RD_COLORS).map(c => `<button class="rd-c ${c}${c === cur ? ' on' : ''}" style="--c:${RD_COLORS[c]}" onclick="_rdHighlight('${c}')" aria-label="${c === 'line' ? '底線' : '畫重點'}"></button>`).join('')}</div>`;
}
function _rdSelPop(){
  const s = _RD.sel; if(!s) return;
  _rdPopShow(`${_rdColorRow('')}
    <div class="rd-pop-row">
      <button onclick="_rdHighlight('yellow', true)">✎ 筆記</button>
      <button onclick="_rdCopySel()">複製</button>
      <button onclick="_rdLookupSel()">查詢</button>
      <button onclick="_rdSearchSel()">搜尋</button>
      <button onclick="_rdSpeakSel()">朗讀</button>
    </div>`, _rdRangeRect(s.range, s.doc));
}
async function _rdHighlight(color, withNote){
  const s = _RD.sel; if(!s) return;
  const annos = [...(_RD.rec.annos || [])];
  if(s.anno){                                            // 改既有重點的顏色
    const a = annos.find(x => x.cfi === s.anno); if(!a) return;
    a.color = color;
    _RD.rec.annos = annos;
    await _RD.view.addAnnotation({ value:a.cfi, color:a.color });
    await _rdSaveNow({ annos }); _rdPopHide(); return;
  }
  const cfi = _RD.view.getCFI(s.index, s.range);
  let note = '';
  if(withNote){
    const v = await askInput('寫筆記', '「' + s.text.slice(0, 40) + (s.text.length > 40 ? '…' : '') + '」', '', { multiline:true });
    if(v == null) return;
    note = String(v).trim();
  }
  const a = { cfi, color, note, text:s.text.slice(0, 500), label:_RD.loc?.tocItem?.label || '', fraction:_RD.loc?.fraction || 0, at:Date.now() };
  annos.push(a); annos.sort((x, y) => (x.fraction || 0) - (y.fraction || 0));
  _RD.rec.annos = annos; _RD.idxOf.set(cfi, s.index);
  await _RD.view.addAnnotation({ value:cfi, color, note });
  try{ s.doc.getSelection().removeAllRanges(); }catch(_){}
  _rdPopHide();
  await _rdSaveNow({ annos });
  toast(note ? '已存筆記' : '已畫重點');
}
function _rdAnnoPop(cfi, range){
  const a = (_RD.rec.annos || []).find(x => x.cfi === cfi); if(!a) return;
  const doc = range?.startContainer?.ownerDocument;
  _RD.sel = { anno:cfi, doc, range };
  _rdPopShow(`${_rdColorRow(a.color)}
    ${a.note ? `<div class="rd-note-body small">${esc(a.note)}</div>` : ''}
    <div class="rd-pop-row">
      <button onclick="_rdEditNote('${esc(cfi)}')">✎ ${a.note ? '改筆記' : '寫筆記'}</button>
      <button onclick="_rdCopyText(_RD.rec.annos.find(x=>x.cfi==='${esc(cfi)}')?.text)">複製</button>
      <button class="danger" onclick="_rdDelAnno('${esc(cfi)}')">刪除</button>
    </div>`, range && doc ? _rdRangeRect(range, doc) : null);
}
async function _rdEditNote(cfi){
  const annos = [...(_RD.rec.annos || [])], a = annos.find(x => x.cfi === cfi); if(!a) return;
  const v = await askInput('筆記', '「' + (a.text || '').slice(0, 40) + '」', a.note || '', { multiline:true });
  if(v == null) return;
  a.note = String(v).trim();
  _RD.rec.annos = annos; _rdPopHide();
  await _rdSaveNow({ annos });
  if(document.getElementById('rd-side')?.dataset.tab === 'annos') _rdRenderAnnos();
}
async function _rdDelAnno(cfi){
  const annos = (_RD.rec.annos || []).filter(x => x.cfi !== cfi);
  _RD.rec.annos = annos;
  try{ await _RD.view.deleteAnnotation({ value:cfi }); }catch(_){}
  _rdPopHide();
  await _rdSaveNow({ annos });
  if(document.getElementById('rd-side')?.dataset.tab === 'annos') _rdRenderAnnos();
}
function _rdRenderAnnos(){
  const body = document.getElementById('rd-side-body'); if(!body) return;
  const annos = _RD.rec.annos || [];
  body.innerHTML = annos.length ? `<div class="rd-side-tools"><button onclick="_rdExportAnnos()">匯出全部（Markdown）</button></div>` + annos.map((a, i) => `<div class="rd-li" onclick="_rdGo(_RD.rec.annos[${i}].cfi)">
      <div class="rd-li-hd"><span>${esc(a.label || '')}</span><em>${Math.round((a.fraction || 0) * 100)}%</em></div>
      <div class="rd-li-q" style="--c:${RD_COLORS[a.color] || RD_COLORS.yellow}">${esc(a.text || '')}</div>
      ${a.note ? `<div class="rd-li-note">✎ ${esc(a.note)}</div>` : ''}
      <button class="rd-li-x" onclick="event.stopPropagation();_rdDelAnno(_RD.rec.annos[${i}].cfi)" aria-label="刪除">✕</button></div>`).join('')
    : `<div class="rd-empty">還沒有重點或筆記。長按（或用滑鼠拖曳）選取文字，就能畫重點、寫筆記。</div>`;
}
function _rdExportAnnos(){
  const r = _RD.rec, annos = r.annos || [];
  const md = `# ${r.title || ''}\n\n` + annos.map(a => `> ${(a.text || '').replace(/\n+/g, ' ')}\n\n${a.note ? a.note + '\n\n' : ''}— ${a.label || ''}（${Math.round((a.fraction || 0) * 100)}%）\n`).join('\n---\n\n');
  dl(new Blob([md], { type:'text/markdown' }), (r.title || 'book') + '_筆記.md');
}
function _rdCopyText(t){
  if(!t) return;
  (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast('已複製')).catch(() => toast('複製失敗'));
  _rdPopHide();
}
function _rdCopySel(){ const t = _RD.sel?.text; try{ _RD.sel.doc.getSelection().removeAllRanges(); }catch(_){} _rdCopyText(t); }
function _rdSearchSel(){ const t = _RD.sel?.text || ''; _rdPopHide(); _rdSearchOpen(t.slice(0, 60)); }
function _rdSpeakSel(){
  const t = _RD.sel?.text || ''; _rdPopHide();
  if(t && typeof ttsReadSegs === 'function') ttsReadSegs(t.split(/\n+/).map(s => s.trim()).filter(Boolean), '📖 朗讀選取的文字');
}

// ── 全書搜尋 ───────────────────────────────────────────────────────
function _rdSearchOpen(q){
  const side = document.getElementById('rd-side'); if(!side) return;
  side.dataset.tab = 'search';
  side.innerHTML = `<div class="rd-side-hd"><div class="rd-search">
      ${_RD_ICO.search}<input id="rd-q" type="search" placeholder="搜尋全書" enterkeyhint="search" value="${esc(q || '')}"
        onkeydown="if(event.key==='Enter'){event.preventDefault();_rdSearch(this.value)}"></div>
      <button class="rd-ib sm" onclick="_rdCloseLayers()" aria-label="關閉">✕</button></div>
    <div class="rd-side-body" id="rd-side-body"><div class="rd-empty">輸入關鍵字後按 Enter。</div></div>`;
  side.classList.add('on'); document.getElementById('rd-scrim')?.classList.add('on');
  const inp = document.getElementById('rd-q');
  if(q) _rdSearch(q); else setTimeout(() => inp?.focus(), 250);
}
async function _rdSearch(q){
  q = String(q || '').trim();
  const body = document.getElementById('rd-side-body'); if(!body || !q) return;
  const gen = ++_RD.searchGen;
  body.innerHTML = `<div class="rd-empty" id="rd-s-st">搜尋中…</div>`;
  let n = 0, html = '';
  const items = [];
  if(_RD.fixed && _RD.view.book.ycPdf) return _rdSearchPdf(q, gen, body);
  try{
    for await (const r of _RD.view.search({ query:q })){
      if(gen !== _RD.searchGen) return;
      if(r === 'done') break;
      if(r.progress != null){ const st = document.getElementById('rd-s-st'); if(st) st.textContent = `搜尋中… ${Math.round(r.progress * 100)}%`; continue; }
      const subs = r.subitems || (r.cfi ? [r] : []);
      for(const s of subs){
        if(n >= 300) break;
        items.push(s.cfi);
        const ex = s.excerpt || {};
        html += `<button class="rd-sr" onclick="_rdGo(_RD.sres[${n}])">${r.label ? `<small>${esc(r.label)}</small>` : ''}<span>${esc(ex.pre || '')}<mark>${esc(ex.match || q)}</mark>${esc(ex.post || '')}</span></button>`;
        n++;
      }
      _RD.sres = items;
      body.innerHTML = `<div class="rd-empty" id="rd-s-st">搜尋中…</div>` + html;
    }
  }catch(e){ body.innerHTML = `<div class="rd-empty">搜尋失敗：${esc(e.message || String(e))}</div>`; return; }
  if(gen !== _RD.searchGen) return;
  _RD.sres = items;
  body.innerHTML = (n ? `<div class="rd-empty">找到 ${n >= 300 ? '300 筆以上（只列前 300 筆）' : n + ' 筆'}</div>` + html : `<div class="rd-empty">找不到「${esc(q)}」。</div>`);
}

// PDF 全文搜尋：foliate-js 的 PDF 沒有搜尋，直接讀 PDF.js 每頁的文字（去掉空白再比對，中文 PDF 常把字拆開）
async function _rdSearchPdf(q, gen, body){
  const pdf = _RD.view.book.ycPdf, N = pdf.numPages, key = q.replace(/\s+/g, '');
  const items = []; let html = '';
  for(let i = 1; i <= N; i++){
    if(gen !== _RD.searchGen) return;
    let text = '';
    try{ text = (await (await pdf.getPage(i)).getTextContent()).items.map(t => t.str).join('').replace(/\s+/g, ''); }catch(_){}
    let k = text.indexOf(key), cnt = 0;
    while(k >= 0 && cnt < 20 && items.length < 300){
      items.push(i - 1);
      html += `<button class="rd-sr" onclick="_rdGo(_RD.sres[${items.length - 1}])"><small>第 ${i} 頁</small><span>${esc(text.slice(Math.max(0, k - 24), k))}<mark>${esc(key)}</mark>${esc(text.slice(k + key.length, k + key.length + 40))}</span></button>`;
      k = text.indexOf(key, k + key.length); cnt++;
    }
    _RD.sres = items;
    body.innerHTML = `<div class="rd-empty">搜尋中… 第 ${i} / ${N} 頁</div>` + html;
  }
  if(gen !== _RD.searchGen) return;
  body.innerHTML = items.length ? `<div class="rd-empty">找到 ${items.length} 筆</div>` + html : `<div class="rd-empty">找不到「${esc(q)}」。（掃描成圖片的 PDF 沒有文字，搜尋不到）</div>`;
}

// ── 版面設定 ───────────────────────────────────────────────────────
function _rdAa(){
  const sh = document.getElementById('rd-aa'); if(!sh) return;
  const p = _RD.prefs;
  const seg = (key, opts) => `<div class="rd-seg">${opts.map(([v, n]) => `<button class="${String(p[key]) === String(v) ? 'on' : ''}" onclick="_rdSet('${key}','${v}')">${n}</button>`).join('')}</div>`;
  sh.innerHTML = `<div class="rd-grab"></div>
    ${_RD.fixed ? `
      <div class="rd-row"><label>縮放</label>${seg('pdfZoom', [['fit-page','整頁'],['fit-width','滿寬']])}</div>
      <div class="rd-row"><label>夜間反白</label>${seg('pdfDark', [['false','關'],['true','開']])}</div>
      <div class="rd-hint">PDF 是固定版面，字級、行距不能調；夜間反白把白底黑字反過來，晚上比較不刺眼。</div>` : `
      <div class="rd-row"><label>字級</label><div class="rd-step">
        <button onclick="_rdSet('fontSize', ${Math.max(12, p.fontSize - 1)})">A−</button><b>${p.fontSize}</b>
        <button onclick="_rdSet('fontSize', ${Math.min(36, p.fontSize + 1)})">A＋</button></div></div>
      <div class="rd-row"><label>行距</label>${seg('lineHeight', [[1.5,'緊'],[1.8,'標準'],[2.1,'鬆'],[2.4,'很鬆']])}</div>
      <div class="rd-row"><label>邊距</label>${seg('margin', Object.entries(RD_MARGIN).map(([k, v]) => [k, v.name]))}</div>
      <div class="rd-row"><label>字型</label>${seg('font', Object.entries(RD_FONTS).map(([k, v]) => [k, v.name]))}</div>
      <div class="rd-row"><label></label><div class="rd-fonts">${_RDF.list.map(f => `<button class="${p.font === 'u:' + f.id ? 'on' : ''}" onclick="_rdSet('font','u:${f.id}')" style="font-family:'ycf-${f.id}'">${esc(f.name)}<i onclick="event.stopPropagation();_rdFontDel('${f.id}')" aria-label="刪除字型">✕</i></button>`).join('')}
        <button class="add" onclick="_rdFontImport()">＋ 匯入字型</button></div></div>
      <div class="rd-row"><label>翻頁</label>${seg('flow', [['paginated','左右翻頁'],['scrolled','上下捲動']])}</div>
      <div class="rd-row"><label>欄數</label>${seg('cols', [['auto','自動（寬螢幕兩欄）'],['1','單欄']])}</div>
      <div class="rd-row"><label>對齊</label>${seg('justify', [['true','左右對齊'],['false','靠左']])}</div>
      <div class="rd-row"><label>縮排</label>${seg('indent', [['false','照原書'],['true','段首空兩字']])}</div>`}
    <div class="rd-row"><label>底色</label><div class="rd-themes">${Object.entries(RD_THEMES).map(([k, t]) => `<button class="${p.theme === k ? 'on' : ''}" style="background:${t.bg};color:${t.fg}" onclick="_rdSet('theme','${k}')">${t.name}</button>`).join('')}</div></div>`;
  sh.classList.add('on'); document.getElementById('rd-scrim')?.classList.add('on');
}
function _rdSet(key, v){
  const p = _RD.prefs;
  if(['fontSize','lineHeight'].includes(key)) v = +v;
  if(['justify','indent','pdfDark'].includes(key)) v = (v === true || v === 'true');
  p[key] = v;
  _rdSavePrefs();
  if(['flow','margin','cols','pdfZoom'].includes(key)){ _rdApplyLayout(); if(_RD2.view) _rdApplyLayout(_RD2.view); }
  _rdApplyStyles();
  _rdAa();
}

function _rdCloseLayers(){
  ['rd-side','rd-aa','rd-tools'].forEach(id => document.getElementById(id)?.classList.remove('on'));
  document.getElementById('rd-scrim')?.classList.remove('on');
  _rdPopHide();
  if(document.getElementById('rd-side')?.dataset.tab === 'search'){ _RD.searchGen++; try{ _RD.view?.clearSearch(); }catch(_){} }
}

// ── 朗讀（tts.js 讀 window._ycBookTTS）───────────────────────────────
window._ycBookTTS = null;
function _rdTts(){ _rdHideBars(); if(typeof ttsReadEpub === 'function') ttsReadEpub(); }
const _RD_TTS = {
  // 目前這頁開始的段落：{ text, el }
  paras(fromHere){
    const c = _RD.view?.renderer?.getContents?.()[0];
    const doc = c?.doc; if(!doc?.body) return [];
    const SEL = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,dt,dd,div,td';
    let list = [...doc.body.querySelectorAll(SEL)].filter(el => !el.querySelector(SEL))
      .map(el => ({ el, text:(el.textContent || '').replace(/\s+/g, ' ').trim() })).filter(x => x.text.length > 1);
    const start = fromHere ? _RD.loc?.range?.startContainer : null;
    if(start){
      const i = list.findIndex(x => x.el.contains(start) || (x.el.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_PRECEDING));
      if(i > 0) list = list.slice(i);
    }
    return list;
  },
  async next(){
    const r = _RD.view?.renderer; if(!r) return false;
    const before = r.getContents?.()[0]?.index;
    await r.nextSection?.();
    return r.getContents?.()[0]?.index !== before;
  },
  show(el){
    try{ const rg = el.ownerDocument.createRange(); rg.selectNodeContents(el); _RD.view.renderer.scrollToAnchor(rg); }catch(_){}
  },
};

// ── 關閉 ───────────────────────────────────────────────────────────
// 返回鍵：先關選單、面板，再關閱讀器
function rdBack(){
  if(document.getElementById('rd-speed')){ _rdSpeedClose(); return true; }
  if(_rdLayerOpen()){ _rdCloseLayers(); return true; }
  return false;
}
function _rdTeardown(keepOv){
  document.removeEventListener('keydown', _rdKey);
  clearInterval(_RD.timer); _RD.timer = null;
  _rdSpeedClose(true);
  _rdSplitClose(true);
  try{ _RD.view?.close?.(); }catch(_){}
  try{ _RD.view?.remove?.(); }catch(_){}
  _RD.view = null;
  window._ycBookTTS = null;
  if(!keepOv){
    document.getElementById('book-reader-ov')?.remove();
    document.documentElement.classList.remove('reader-active');
  }
}
async function rdClose(){
  if(_RD.saveT || _RD.loc) await _rdSaveNow();
  if(typeof _ttsStop === 'function') _ttsStop();
  _rdTeardown();
  _RD.rec = null; _RD.id = null; _RD.loc = null;
  if(typeof _renderBooksPage === 'function' && !document.getElementById('pg-books')?.classList.contains('hide')) _renderBooksPage();
}

// ════════════════════════════════════════════════════════════════════
// 【書的資訊與封面】從檔案讀書名、作者、封面（新增書時自動帶入；沒有封面的舊書在書庫頁背景補上）
//   EPUB／MOBI／FB2／CBZ 用書裡的封面；PDF 用第一頁。只補「沒有封面」的書，自己上傳的封面不動。
// ════════════════════════════════════════════════════════════════════
async function rdBookInfo(blob, ext){
  ext = String(ext || '').toLowerCase();
  if(!blob || !rdSupports(ext)) return null;
  const { makeBook } = await import('./foliate/view.js');
  const book = await makeBook(new File([blob], 'book.' + ext, { type: blob.type || '' }));
  const m = book.metadata || {};
  const one = x => !x ? '' : typeof x === 'string' ? x : Array.isArray(x) ? x.map(one).filter(Boolean).join('、')
    : typeof x === 'object' ? one(x.name ?? Object.values(x)[0]) : String(x);
  let cover = null;
  try{
    if(book.ycPdf){
      const page = await book.ycPdf.getPage(1);
      const vp0 = page.getViewport({ scale:1 }), scale = Math.min(2, 480 / vp0.width);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      // intent:'print'：不靠 requestAnimationFrame 分段畫（畫面在背景時 rAF 不跑，會一直畫不完）
      await page.render({ canvasContext:ctx, viewport:vp, intent:'print' }).promise;
      cover = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
    } else cover = await book.getCover?.() || null;
  }catch(_){ cover = null; }
  try{ book.destroy?.(); }catch(_){}
  // PDF 的書名、作者欄常是範本留下的別份文件標題或建檔人的電腦帳號 → 不用，改用檔名（呼叫端處理）
  if(book.ycPdf) return { title:'', author:'', cover };
  const clean = t => t.replace(/\s+/g, ' ').replace(/(?<=[㐀-鿿])\s+(?=[㐀-鿿])/g, '').trim();
  return { title:clean(one(m.title)), author:clean(one(m.author)), cover };
}
// 封面縮圖（寬 200，和手動上傳的一樣）＋模糊書背
async function rdMakeThumbs(cover, rec){
  if(!cover || !cover.size) return null;
  const wMM = rec.widthMM || _BOOK_DEFAULT_MM.widthMM, hMM = rec.heightMM || _BOOK_DEFAULT_MM.heightMM, tMM = rec.thickMM || _BOOK_DEFAULT_MM.thickMM;
  const pxW = mmToPx(wMM), pxH = mmToPx(hMM), pxS = mmToPx(tMM);
  const coverThumb = await _compressImage(cover, 200, Math.round(200 * pxH / pxW));
  const spineThumb = await _makeBlurredSpineFromCover(cover, Math.round(pxS * SPINE_SCALE * 2), Math.round(pxH * 2));
  return coverThumb ? { coverThumb, spineThumb } : null;
}
let _rdCoverBusy = false;
async function rdAutoCovers(){
  if(_rdCoverBusy || _RD.view) return;
  _rdCoverBusy = true;
  let n = 0;
  try{
    const ids = (_B.allBooks || []).filter(b => rdSupports(b.fileType) && !b.coverTried).map(b => b.id);
    for(const id of ids){
      if(_RD.view) break;                                   // 正在看書就先停，下次進書庫再補
      const rec = await dg('ebooks', id);
      if(!rec || rec.coverThumb || !rec.blob || rec.coverTried){
        if(rec && !rec.coverTried && rec.coverThumb){ rec.coverTried = 1; await dp('ebooks', rec); }
        continue;
      }
      let th = null;
      try{ const info = await rdBookInfo(rec.blob, rec.fileType); th = await rdMakeThumbs(info?.cover, rec); }catch(_){}
      const fresh = await dg('ebooks', id); if(!fresh) continue;
      if(th && !fresh.coverThumb){ Object.assign(fresh, th, { hasSpineImg:false, coverAuto:1 }); n++; }
      fresh.coverTried = 1;
      await dp('ebooks', fresh);
      const i = _B.allBooks.findIndex(b => b.id === id);
      if(i >= 0) _B.allBooks[i].coverTried = 1;
      await new Promise(r => setTimeout(r, 120));
    }
  }finally{ _rdCoverBusy = false; }
  if(n && !document.getElementById('pg-books')?.classList.contains('hide')){
    toast('已從檔案補上 ' + n + ' 本書的封面');
    renderBooks();
  }
}

// ════════════════════════════════════════════════════════════════════
// 【v4.60 閱讀工具】查詢（字典／維基百科／翻譯）、自訂字型、閱讀尺、速讀、並排閱讀、閱讀時間
//   參考 Readest 的功能，程式自己寫；查詢只在按下時把選取的字送到該網站（萌典、維基百科、MyMemory、Free Dictionary）
// ════════════════════════════════════════════════════════════════════

// ── 查詢 ───────────────────────────────────────────────────────────
const _RD_CJK = /[㐀-鿿豈-﫿]/;
function _rdLookupSel(){
  const t = (_RD.sel?.text || '').trim();
  try{ _RD.sel?.doc?.getSelection().removeAllRanges(); }catch(_){}
  _rdLookup(t);
}
function _rdLookup(text, tab){
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 480);
  if(!text) return;
  const cjk = _RD_CJK.test(text);
  const word = cjk ? text.replace(/[\s，。、；：！？「」『』（）()《》〈〉…—·.,;:!?"'\[\]]/g, '') : text.replace(/[^A-Za-z'\- ]/g, '').trim();
  tab = tab || ((cjk && word.length <= 6) || (!cjk && word && !/\s/.test(word)) ? 'dict' : 'tr');
  _RD.lk = { text, word, cjk, tab };
  const tabs = [['dict','字典'],['wiki','維基百科'],['tr','翻譯']];
  _rdPopShow(`<div class="rd-lk">
    <div class="rd-lk-hd"><div class="rd-seg">${tabs.map(([k, n]) => `<button class="${k === tab ? 'on' : ''}" onclick="_rdLookup(_RD.lk.text,'${k}')">${n}</button>`).join('')}</div>
      <button class="rd-ib sm" onclick="_rdPopHide()" aria-label="關閉">✕</button></div>
    <div class="rd-lk-q">${esc(text.length > 60 ? text.slice(0, 60) + '…' : text)}</div>
    <div class="rd-lk-body" id="rd-lk-body"><div class="rd-empty">查詢中…</div></div></div>`, null, true);
  if(!navigator.onLine){ document.getElementById('rd-lk-body').innerHTML = '<div class="rd-empty">目前沒有網路，連上網路後再查。</div>'; return; }
  const gen = (_RD.lkGen = (_RD.lkGen || 0) + 1);
  const put = html => { if(gen === _RD.lkGen){ const b = document.getElementById('rd-lk-body'); if(b) b.innerHTML = html; } };
  (tab === 'dict' ? _rdDict(word || text, cjk) : tab === 'wiki' ? _rdWiki(cjk ? word || text : text, cjk) : _rdTranslate(text, cjk))
    .then(put).catch(e => put(`<div class="rd-empty">查不到（${esc(e.message || String(e))}）</div>`));
}
async function _rdJson(url, opts){
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
  try{
    const r = await fetch(url, { ...(opts || {}), signal:ctl.signal });
    if(r.status === 404) return null;
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }catch(e){ if(e.name === 'AbortError') throw new Error('連線逾時'); throw e; }
  finally{ clearTimeout(to); }
}
async function _rdDict(w, cjk){
  if(cjk){
    w = w.slice(0, 8);
    const j = await _rdJson('https://www.moedict.tw/uni/' + encodeURIComponent(w));
    if(!j || !j.heteronyms?.length) return `<div class="rd-empty">萌典沒有「${esc(w)}」這個詞。可以試試「維基百科」，或選短一點的詞。</div>`;
    return j.heteronyms.slice(0, 3).map(h => `<div class="rd-dict">
      <div class="rd-dict-hd"><b>${esc(j.title || w)}</b>${h.bopomofo ? `<span>${esc(h.bopomofo)}</span>` : ''}${h.pinyin ? `<span>${esc(h.pinyin)}</span>` : ''}</div>
      <ol>${(h.definitions || []).slice(0, 8).map(d => `<li>${d.type ? `<em>${esc(d.type)}</em>` : ''}${esc(d.def || '')}
        ${(d.example || []).slice(0, 1).map(x => `<div class="rd-dict-ex">${esc(x)}</div>`).join('')}</li>`).join('')}</ol></div>`).join('')
      + `<div class="rd-src">資料：萌典（教育部《重編國語辭典修訂本》）· <a href="https://www.moedict.tw/${encodeURIComponent(w)}" target="_blank" rel="noopener">開啟網頁</a></div>`;
  }
  w = w.split(' ')[0].toLowerCase();
  const j = await _rdJson('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w));
  if(!j || !j.length) return `<div class="rd-empty">字典沒有「${esc(w)}」。可以試試「翻譯」。</div>`;
  const e = j[0], ph = e.phonetic || e.phonetics?.find(x => x.text)?.text || '';
  return `<div class="rd-dict"><div class="rd-dict-hd"><b>${esc(e.word)}</b>${ph ? `<span>${esc(ph)}</span>` : ''}</div>
    ${(e.meanings || []).slice(0, 4).map(m => `<div class="rd-dict-pos">${esc(m.partOfSpeech || '')}</div><ol>${(m.definitions || []).slice(0, 3).map(d => `<li>${esc(d.definition || '')}${d.example ? `<div class="rd-dict-ex">${esc(d.example)}</div>` : ''}</li>`).join('')}</ol>`).join('')}</div>
    <div class="rd-src">資料：Free Dictionary API（Wiktionary）· 英文解釋看不懂可以按「翻譯」</div>`;
}
async function _rdWiki(q, cjk){
  const host = cjk ? 'zh.wikipedia.org' : 'en.wikipedia.org';
  const s = await _rdJson(`https://${host}/w/api.php?action=query&format=json&origin=*&list=search&srlimit=5&srsearch=${encodeURIComponent(q.slice(0, 80))}`);
  const hits = s?.query?.search || [];
  if(!hits.length) return `<div class="rd-empty">維基百科找不到「${esc(q)}」。</div>`;
  const j = await _rdJson(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(hits[0].title)}`, cjk ? { headers:{ 'Accept-Language':'zh-TW' } } : undefined);
  const url = j?.content_urls?.mobile?.page || `https://${host}/wiki/${encodeURIComponent(hits[0].title)}`;
  return `<div class="rd-wiki"><b>${esc(j?.title || hits[0].title)}</b>${j?.description && !cjk ? `<small>${esc(j.description)}</small>` : ''}
    <p>${esc(j?.extract || '（沒有摘要）')}</p></div>
    ${hits.length > 1 ? `<div class="rd-wiki-more">其他：${hits.slice(1).map(h => `<button onclick="_rdLookup(${esc(JSON.stringify(h.title))},'wiki')">${esc(h.title)}</button>`).join('')}</div>` : ''}
    <div class="rd-src">資料：維基百科（CC BY-SA，內容可能有誤，考試以法條、教材為準）· <a href="${esc(url)}" target="_blank" rel="noopener">開啟網頁</a></div>`;
}
async function _rdTranslate(text, cjk){
  const pair = cjk ? 'zh-TW|en' : 'en|zh-TW';
  const j = await _rdJson('https://api.mymemory.translated.net/get?langpair=' + encodeURIComponent(pair) + '&q=' + encodeURIComponent(text.slice(0, 480)));
  const t = j?.responseData?.translatedText;
  if(!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error(t ? '今天的免費翻譯額度用完了' : '沒有結果');
  return `<div class="rd-tr">${esc(t)}</div>
    <div class="rd-src">${cjk ? '中 → 英' : '英 → 中'}　資料：MyMemory 免費翻譯（每天有字數上限，機器翻譯僅供參考）·
      <a href="https://translate.google.com/?sl=auto&tl=${cjk ? 'en' : 'zh-TW'}&text=${encodeURIComponent(text)}" target="_blank" rel="noopener">用 Google 翻譯開啟</a></div>`;
}

// ── 自訂字型（存在這台裝置的另一個小資料庫，不進備份；字型檔動輒幾 MB）────────
const _RDF = { db:null, list:[], urls:new Map(), ready:false };
function _rdFontDB(){
  return _RDF.db || (_RDF.db = new Promise((res, rej) => {
    const r = indexedDB.open('yc-reader-fonts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fonts', { keyPath:'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
function _rdFontTx(mode, fn){
  return _rdFontDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('fonts', mode), st = tx.objectStore('fonts');
    const q = fn(st);
    tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error);
  }));
}
async function _rdFontsReady(){
  if(_RDF.ready) return;
  try{
    _RDF.list = (await _rdFontTx('readonly', st => st.getAll())) || [];
    for(const f of _RDF.list) if(f.blob && !_RDF.urls.has(f.id)) _RDF.urls.set(f.id, URL.createObjectURL(f.blob));
    // 設定面板的按鈕也用該字型顯示名稱
    for(const f of _RDF.list){ try{ const ff = new FontFace('ycf-' + f.id, `url(${_RDF.urls.get(f.id)})`); document.fonts.add(ff); ff.load().catch(()=>{}); }catch(_){} }
  }catch(e){ logError('rdFonts', e); }
  _RDF.ready = true;
}
function _rdFontImport(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
  inp.onchange = () => inp.files[0] && _rdFontAdd(inp.files[0]);
  inp.click();
}
async function _rdFontAdd(f){
  {
    if(!/\.(ttf|otf|woff2?)$/i.test(f.name)){ toast('請選 TTF、OTF、WOFF 字型檔'); return; }
    if(f.size > 40 * 1024 * 1024){ toast('字型檔太大（超過 40MB）'); return; }
    const id = 'f' + Date.now().toString(36);
    const name = f.name.replace(/\.(ttf|otf|woff2?)$/i, '').slice(0, 24);
    try{
      const ff = new FontFace('ycf-' + id, await f.arrayBuffer());
      await ff.load();                                   // 先確認真的是能用的字型
      document.fonts.add(ff);
      await _rdFontTx('readwrite', st => st.put({ id, name, blob:f, at:Date.now() }));
      _RDF.list.push({ id, name, blob:f }); _RDF.urls.set(id, URL.createObjectURL(f));
      toast('已匯入字型：' + name);
      _rdSet('font', 'u:' + id);
    }catch(e){ toast('這個字型檔讀不了：' + (e.message || e)); }
  }
}
async function _rdFontDel(id){
  const f = _RDF.list.find(x => x.id === id); if(!f) return;
  if(!await askConfirm('刪除字型', '刪除「' + f.name + '」？（只刪這台裝置裡的字型檔）', '刪除')) return;
  await _rdFontTx('readwrite', st => st.delete(id));
  _RDF.list = _RDF.list.filter(x => x.id !== id);
  if(_RDF.urls.has(id)){ URL.revokeObjectURL(_RDF.urls.get(id)); _RDF.urls.delete(id); }
  if(_RD.prefs.font === 'u:' + id) _rdSet('font', 'sans'); else _rdAa();
}

// ── 工具面板（⋯）──────────────────────────────────────────────────
function _rdTools(){
  const sh = document.getElementById('rd-tools'); if(!sh) return;
  const p = _RD.prefs, r = _RD.rec;
  const today = _rdToday(), sec = (r.readDays || {})[today] || 0;
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return _rdToday(d); });
  const max = Math.max(60, ...days.map(d => (r.readDays || {})[d] || 0));
  sh.innerHTML = `<div class="rd-grab"></div>
    <div class="rd-tool-grid">
      <button class="${p.ruler ? 'on' : ''}" ${_RD.fixed ? 'disabled' : ''} onclick="_rdRulerShow(!_RD.prefs.ruler);_rdTools()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="9" width="20" height="6" rx="1.5"/><path d="M6 9v3M10 9v2M14 9v3M18 9v2"/></svg><span>閱讀尺</span><small>${p.ruler ? '開' : '關'}</small></button>
      <button ${_RD.fixed ? 'disabled' : ''} onclick="_rdCloseLayers();_rdSpeedOpen()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg><span>速讀</span><small>一次一段</small></button>
      <button onclick="_rdCloseLayers();_rdSplitPick()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg><span>並排閱讀</span><small>${_RD2.view ? '關閉並排' : '再開一本'}</small></button>
      <button onclick="_rdCloseLayers();_rdLookupAsk()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M9 7h6M9 11h4"/></svg><span>查字典</span><small>萌典・維基</small></button>
    </div>
    <div class="rd-stat">
      <div class="rd-stat-hd"><b>閱讀時間</b><span>這本累計 ${_rdFmtSec(r.readSec || 0)}　·　今天 ${_rdFmtSec(sec)}</span></div>
      <div class="rd-stat-bars">${days.map(d => { const v = (r.readDays || {})[d] || 0; return `<div><i style="height:${Math.round(v / max * 100)}%"></i><small>${d.slice(8)}</small></div>`; }).join('')}</div>
      <div class="rd-hint">只算書開著、而且最近 3 分鐘內有翻頁或點畫面的時間。</div>
    </div>`;
  sh.classList.add('on'); document.getElementById('rd-scrim')?.classList.add('on');
}
async function _rdLookupAsk(){
  const q = await askInput('查字典', '輸入要查的詞（中文查萌典，英文查英文字典）', '');
  if(q && q.trim()) _rdLookup(q.trim());
}

// ── 閱讀時間 ───────────────────────────────────────────────────────
function _rdToday(d){ d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _rdFmtSec(s){ s = Math.round(s || 0); if(s < 60) return s ? '不到 1 分鐘' : '0 分鐘'; const m = Math.round(s / 60); return m < 60 ? m + ' 分鐘' : Math.floor(m / 60) + ' 小時 ' + (m % 60) + ' 分'; }
function _rdTimerStart(){
  clearInterval(_RD.timer);
  _RD.act = Date.now(); _RD.pend = 0;
  _RD.timer = setInterval(() => {
    if(document.visibilityState === 'visible' && Date.now() - (_RD.act || 0) < 180000) _RD.pend = (_RD.pend || 0) + 15;
    if(_RD.pend >= 60) _rdSaveSoon();
  }, 15000);
}
function _rdAddTime(b){
  const add = _RD.pend || 0; if(!add) return;
  _RD.pend = 0;
  b.readSec = (b.readSec || 0) + add;
  const days = { ...(b.readDays || {}) }, t = _rdToday();
  days[t] = (days[t] || 0) + add;
  const keys = Object.keys(days).sort();
  while(keys.length > 120) delete days[keys.shift()];        // 只留最近約 4 個月
  b.readDays = days;
}

// ── 閱讀尺：一條橫帶，其他地方變暗；右邊的把手可上下拖 ───────────────
function _rdRulerShow(on){
  _RD.prefs.ruler = !!on; _rdSavePrefs();
  let el = document.getElementById('rd-ruler');
  if(!on){ el?.remove(); return; }
  if(!el){
    el = document.createElement('div');
    el.id = 'rd-ruler'; el.className = 'rd-ruler';
    el.innerHTML = '<i class="rd-ruler-grip" aria-label="拖曳閱讀尺"></i>';
    document.querySelector('#book-reader-ov .rd-stage')?.appendChild(el);
    const g = el.firstChild;
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      const st = el.parentElement.getBoundingClientRect();
      const mv = ev => { _RD.prefs.rulerY = Math.min(.95, Math.max(.03, (ev.clientY - st.top) / st.height)); _rdRulerPlace(); };
      const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); _rdSavePrefs(); };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
    });
  }
  _rdRulerPlace();
}
function _rdRulerPlace(){
  const el = document.getElementById('rd-ruler'); if(!el || !_RD.prefs) return;
  const p = _RD.prefs, h = Math.round(p.fontSize * p.lineHeight * 2 + 8);
  el.style.height = h + 'px';
  el.style.top = `calc(${((p.rulerY ?? .4) * 100).toFixed(2)}% - ${h / 2}px)`;
}

// ── 速讀：從這頁開始，一次顯示一小段，固定節奏往下走（Readest 的 speed reading）────
const _RDS = { chunks:[], i:0, on:false, t:null };
function _rdChunks(paras){
  const out = [];
  paras.forEach((p, pi) => {
    const parts = p.text.match(/[^，。、；：！？,.;:!?]+[，。、；：！？,.;:!?」』）)]*|[，。、；：！？,.;:!?]+/g) || [p.text];
    for(let s of parts){
      s = s.trim(); if(!s) continue;
      if(_RD_CJK.test(s)){
        while(s.length > 9){ const n = s.length > 14 ? 6 : Math.ceil(s.length / 2); out.push({ t:s.slice(0, n), pi }); s = s.slice(n); }
        out.push({ t:s, pi });
      } else s.split(/\s+/).forEach(w => w && out.push({ t:w, pi }));
    }
  });
  return out;
}
function _rdSpeedOpen(){
  const paras = _RD_TTS.paras(true);
  if(!paras.length){ toast('這頁沒有文字可以速讀'); return; }
  _RDS.paras = paras; _RDS.chunks = _rdChunks(paras); _RDS.i = 0;
  const ov = document.createElement('div');
  ov.id = 'rd-speed'; ov.className = 'rd-speed';
  ov.innerHTML = `<div class="rd-speed-top"><span id="rd-speed-pos"></span><button class="rd-ib sm" onclick="_rdSpeedClose()" aria-label="關閉">✕</button></div>
    <div class="rd-speed-word" id="rd-speed-word" onclick="_rdSpeedToggle()"></div>
    <div class="rd-speed-ctx" id="rd-speed-ctx"></div>
    <div class="rd-speed-ctl">
      <button class="rd-ib" onclick="_rdSpeedStep(-10)" aria-label="倒退">${_RD_ICO.prev}</button>
      <button class="rd-speed-play" id="rd-speed-play" onclick="_rdSpeedToggle()">▶</button>
      <button class="rd-ib" onclick="_rdSpeedStep(10)" aria-label="快轉">${_RD_ICO.next}</button>
    </div>
    <div class="rd-speed-rate"><span>慢</span><input type="range" min="150" max="1200" step="50" value="${_RD.prefs.speedCpm || 400}" oninput="_RD.prefs.speedCpm=+this.value;document.getElementById('rd-speed-cpm').textContent=this.value" onchange="_rdSavePrefs()"><span>快</span><b><i id="rd-speed-cpm">${_RD.prefs.speedCpm || 400}</i> 字／分</b></div>
    <div class="rd-hint" style="text-align:center">點中間的字暫停／繼續；關掉時書會停在讀到的那一段</div>`;
  document.getElementById('book-reader-ov')?.appendChild(ov);
  _rdHideBars();
  _rdSpeedShow();
}
function _rdSpeedShow(){
  const c = _RDS.chunks[_RDS.i]; if(!c) return;
  const w = document.getElementById('rd-speed-word'); if(w) w.textContent = c.t;
  const pos = document.getElementById('rd-speed-pos'); if(pos) pos.textContent = `${_RDS.i + 1} / ${_RDS.chunks.length}　·　${_RD.loc?.tocItem?.label || ''}`;
  const ctx = document.getElementById('rd-speed-ctx'); if(ctx) ctx.textContent = (_RDS.paras[c.pi]?.text || '').slice(0, 120);
}
function _rdSpeedToggle(){ _RDS.on ? _rdSpeedPause() : _rdSpeedPlay(); }
function _rdSpeedPlay(){
  _RDS.on = true; const b = document.getElementById('rd-speed-play'); if(b) b.textContent = '❚❚';
  const tick = async () => {
    if(!_RDS.on) return;
    _RD.act = Date.now();
    if(_RDS.i >= _RDS.chunks.length - 1){
      // 這章讀完 → 換下一章接著讀
      const ok = await _RD_TTS.next();
      const paras = ok ? _RD_TTS.paras(false) : [];
      if(!paras.length || !_RDS.on){ _rdSpeedPause(); if(!ok) toast('讀完了'); return; }
      _RDS.paras = paras; _RDS.chunks = _rdChunks(paras); _RDS.i = 0;
    } else _RDS.i++;
    _rdSpeedShow();
    const c = _RDS.chunks[_RDS.i], cpm = _RD.prefs.speedCpm || 400;
    const n = _RD_CJK.test(c.t) ? c.t.replace(/[，。、；：！？「」『』（）\s]/g, '').length : 2.2;
    let ms = Math.max(160, n / cpm * 60000);
    if(/[。！？.!?]$/.test(c.t)) ms *= 1.7; else if(/[，、；：,;:]$/.test(c.t)) ms *= 1.3;
    _RDS.t = setTimeout(tick, ms);
  };
  clearTimeout(_RDS.t); _RDS.t = setTimeout(tick, 400);
}
function _rdSpeedPause(){ _RDS.on = false; clearTimeout(_RDS.t); const b = document.getElementById('rd-speed-play'); if(b) b.textContent = '▶'; }
function _rdSpeedStep(n){ _RDS.i = Math.min(_RDS.chunks.length - 1, Math.max(0, _RDS.i + n)); _rdSpeedShow(); }
function _rdSpeedClose(silent){
  _rdSpeedPause();
  const ov = document.getElementById('rd-speed'); if(!ov) return;
  ov.remove();
  if(silent) return;
  const c = _RDS.chunks[_RDS.i], el = c && _RDS.paras[c.pi]?.el;
  if(el) _RD_TTS.show(el);                                   // 書翻到讀到的那一段
}

// ── 並排閱讀：再開一本，左右（橫放）或上下（直放）對照，例如教科書對法條 ──────────
const _RD2 = { view:null, rec:null, loc:null, saveT:null };
function _rdSplitPick(){
  if(_RD2.view){ _rdSplitClose(); return; }
  const list = (_B.allBooks || []).filter(b => b.id !== _RD.id && rdSupports(b.fileType))
    .sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0));
  const side = document.getElementById('rd-side'); if(!side) return;
  side.dataset.tab = 'split';
  side.innerHTML = `<div class="rd-side-hd"><b style="flex:1;padding-left:4px">選一本並排閱讀</b><button class="rd-ib sm" onclick="_rdCloseLayers()" aria-label="關閉">✕</button></div>
    <div class="rd-side-body">${list.length ? list.map(b => `<button class="rd-toc-it" onclick="_rdSplitOpen(${+b.id})">${esc(b.title || '未命名')}<small style="display:block;color:var(--rd-sub);font-size:12px">${esc((b.fileType || '').toUpperCase())}${b.author ? '・' + esc(b.author) : ''}${_bookPct?.(b) ? '・已讀 ' + _bookPct(b) + '%' : ''}</small></button>`).join('')
      : '<div class="rd-empty">書庫裡沒有其他可以開的書。</div>'}</div>`;
  side.classList.add('on'); document.getElementById('rd-scrim')?.classList.add('on');
}
async function _rdSplitOpen(id){
  _rdCloseLayers(); _rdHideBars();
  const rec = await dg('ebooks', id);
  if(!rec?.blob){ toast('這本書沒有檔案'); return; }
  const ov = document.getElementById('book-reader-ov'); if(!ov) return;
  _rdSplitClose(true);
  const wide = innerWidth > innerHeight;
  ov.classList.add('rd-split', wide ? 'rd-split-h' : 'rd-split-v');
  const pane = document.createElement('div');
  pane.className = 'rd-pane2'; pane.id = 'rd-pane2';
  pane.innerHTML = `<div class="rd-pane2-hd"><b>${esc(rec.title || '')}</b><span id="rd-pane2-pct"></span>
    <button class="rd-ib sm" onclick="_rdSplitClose()" aria-label="關閉並排">✕</button></div><div class="rd-pane2-stage"><div class="rd-loading"><div class="rd-spin"></div></div></div>`;
  ov.querySelector('.rd-stage').after(pane);
  try{
    const view = document.createElement('foliate-view');
    pane.querySelector('.rd-pane2-stage').prepend(view);
    Object.assign(_RD2, { view, rec, loc:null });
    await view.open(new File([rec.blob], 'book.' + (rec.fileType || 'epub')));
    if(_RD2.view !== view) return;
    view.addEventListener('relocate', e => {
      _RD2.loc = e.detail;
      const el = document.getElementById('rd-pane2-pct');
      if(el) el.textContent = Math.round((e.detail.fraction || 0) * 100) + '%';
      clearTimeout(_RD2.saveT); _RD2.saveT = setTimeout(_rdSplitSave, 1500);
    });
    view.addEventListener('load', ({ detail:{ doc } }) => {
      doc.addEventListener('click', e => {
        if(e.target.closest?.('a[href]')) return;
        const sel = doc.getSelection?.(); if(sel && !sel.isCollapsed) return;
        const fr = doc.defaultView.frameElement?.getBoundingClientRect(), vr = view.getBoundingClientRect();
        const x = (fr ? fr.left : 0) + e.clientX - vr.left;
        if(x < vr.width * .4) view.goLeft(); else if(x > vr.width * .6) view.goRight();
      });
    });
    _rdApplyLayout(view);
    if(!view.isFixedLayout) view.renderer.setStyles?.(_rdBookCSS());
    try{ await view.init({ lastLocation: rec.lastCfi || undefined }); }catch(_){ await view.init({}); }
    pane.querySelector('.rd-loading')?.remove();
  }catch(e){ toast('這本打不開：' + (e.message || e)); _rdSplitClose(true); }
}
async function _rdSplitSave(){
  const r = _RD2.rec, l = _RD2.loc; if(!r || !l?.cfi) return;
  try{
    const b = await dg('ebooks', r.id); if(!b) return;
    b.lastCfi = l.cfi; b.progress = Math.round((l.fraction || 0) * 10000) / 10000; b.lastRead = Date.now();
    await dp('ebooks', b);
    const i = (_B.allBooks || []).findIndex(x => x.id === r.id);
    if(i >= 0) Object.assign(_B.allBooks[i], { lastCfi:b.lastCfi, progress:b.progress, lastRead:b.lastRead });
  }catch(_){}
}
function _rdSplitClose(silent){
  if(_RD2.saveT){ clearTimeout(_RD2.saveT); _RD2.saveT = null; _rdSplitSave(); }
  try{ _RD2.view?.close?.(); }catch(_){}
  _RD2.view = null; _RD2.rec = null; _RD2.loc = null;
  document.getElementById('rd-pane2')?.remove();
  document.getElementById('book-reader-ov')?.classList.remove('rd-split', 'rd-split-h', 'rd-split-v');
}
