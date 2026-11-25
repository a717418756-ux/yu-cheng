// ══ lawnote.js — 法規資料庫筆記（v4.65 改成手寫）══════════════════════════════
//   每一條右上角 ✍：直接在條文上手寫、圈畫、打字（和答題的手寫標註同一套工具，ink.js）。
//   資料存在那一條的 ink：{ img:筆跡 PNG, w, h:畫布大小, txt:[文字方塊], at }，隨備份、雲端同步走。
//   「📝 筆記」總覽：有手寫、打字的條文依法規排列，可搜尋打的字，點一下跳回原條文；匯出 Markdown。
//   v4.64 的「選字畫重點」已停用（使用者要的是手寫）；以前畫的重點照樣顯示，點一下可改色、改筆記、刪除，
//   「遮住重點」也還能用（這部法規有舊重點才出現在選單）。
(function(){
'use strict';

const LN_COLORS = { yellow:'#ffd54f', green:'#81c784', blue:'#64b5f6', pink:'#f48fb1', purple:'#b39ddb' };
const LN_NAMES  = { yellow:'黃', green:'綠', blue:'藍', pink:'粉', purple:'紫' };
const _LN = { cur:null, cover:false, color:'yellow', ovFilter:{ c:'', q:'', law:'' } };

const _body = el => el?.closest?.('#lbody .law-art-body');
const _cardId = body => { const v = body?.closest('[data-law-id]')?.dataset.lawId; return v == null ? null : (/^\d+$/.test(v) ? +v : v); };
const _getRec = id => _db.laws.get(id);

// 條文裡可畫重點的文字節點（流程圖 SVG、展開的原檔文字、本工具加的小圖示不算）
function _nodes(body){
  const out = [], w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement?.closest('svg,details,script,style,.ln-x') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let n, pos = 0;
  while((n = w.nextNode())){ out.push({ n, pos }); pos += n.nodeValue.length; }
  return out;
}
const _text = nodes => nodes.map(x => x.n.nodeValue).join('');

// 原文第 n 次出現的位置；找不到第 n 次就用第一次；完全找不到回 -1
function _find(text, q, n){
  let i = -1, k = 0, first = -1;
  while((i = text.indexOf(q, i + 1)) >= 0){ if(first < 0) first = i; if(k++ === n) return i; }
  return first;
}

function _wrap(body, s, e, m){
  const segs = [];
  for(const { n, pos } of _nodes(body)){
    const len = n.nodeValue.length;
    if(pos + len <= s || pos >= e) continue;
    let mid = n;
    const a = Math.max(s, pos) - pos, b = Math.min(e, pos + len) - pos;
    if(a > 0) mid = mid.splitText(a);
    if(b - a < mid.nodeValue.length) mid.splitText(b - a);
    if(!mid.nodeValue.trim() && mid.parentElement?.closest('table,tr,tbody')) continue;   // 表格格子間的空白不能包
    const sp = document.createElement('span');
    sp.className = 'ln-mk' + (m.note ? ' ln-has-note' : '');
    sp.dataset.mid = m.id; sp.dataset.c = m.c;
    sp.style.setProperty('--lnc', LN_COLORS[m.c] || LN_COLORS.yellow);
    mid.replaceWith(sp); sp.appendChild(mid);
    segs.push(sp);
  }
  if(segs.length && m.note){
    const i = document.createElement('i'); i.className = 'ln-x ln-ni'; i.textContent = '✎'; i.dataset.mid = m.id;
    segs[segs.length - 1].after(i);
  }
  return segs.length;
}
function _unwrap(body){
  body.querySelectorAll('.ln-x').forEach(x => x.remove());
  body.querySelectorAll('.ln-mk').forEach(sp => sp.replaceWith(...sp.childNodes));
  body.normalize();
}
function _paint(body, rec){
  _unwrap(body);
  const marks = rec?.marks || [];
  if(!marks.length) return;
  const text = _text(_nodes(body));
  // 先畫長的，短的疊在上面也看得到
  for(const m of [...marks].sort((a, b) => b.q.length - a.q.length)){
    const i = _find(text, m.q, m.n || 0);
    if(i >= 0) _wrap(body, i, i + m.q.length, m);
  }
}
// #lbody 重畫後補上重點
let _paintT = 0;
async function _paintAll(){
  const lb = document.getElementById('lbody'); if(!lb) return;
  const cards = [...lb.querySelectorAll('[data-law-id]')];
  const ids = cards.map(c => _cardId(c.querySelector('.law-art-body') || c)).filter(v => v != null);
  if(!ids.length) return;
  // 正在手寫的那一條被重畫掉了（例如搜尋、切換篇章）→ 先存起來
  if(_INK.ed && !document.contains(_INK.ed.card)) await _inkEnd();
  const recs = await _db.laws.bulkGet(ids);
  recs.forEach((r, k) => {
    if(r?.marks?.length){
      const body = cards[k].querySelector('.law-art-body');
      if(body) _paint(body, r);
    }
    if(!(_INK.ed && _INK.ed.card === cards[k])) _inkPaint(cards[k], r);
  });
  _syncCover();
}
function _watch(){
  const lb = document.getElementById('lbody');
  if(!lb || lb._lnObs) return;
  lb._lnObs = new MutationObserver(() => { clearTimeout(_paintT); _paintT = setTimeout(_paintAll, 60); });
  lb._lnObs.observe(lb, { childList:true });
}

// ── 工具列（螢幕下方）──────────────────────────────────────────
function _bar(){
  let b = document.getElementById('ln-bar');
  if(!b){
    b = document.createElement('div'); b.id = 'ln-bar';
    // 按工具列不要讓選取消失
    b.addEventListener('pointerdown', e => { if(e.target.closest('button')) e.preventDefault(); });
    document.body.appendChild(b);
  }
  return b;
}
function _barHide(){ const b = document.getElementById('ln-bar'); if(b){ b.classList.remove('on'); } _LN.cur = null; }
const _dots = (on, fn) => Object.entries(LN_COLORS).map(([k, v]) =>
  `<button class="ln-dot${on === k ? ' on' : ''}" style="--lnc:${v}" onclick="${fn}('${k}')" aria-label="${LN_NAMES[k]}色"></button>`).join('');
async function _barEdit(id, mid){
  const rec = await _getRec(id), m = rec?.marks?.find(x => x.id === mid);
  if(!m) return;
  _LN.cur = { id, mid };
  const b = _bar();
  b.innerHTML = `${m.note ? `<div class="ln-note" onclick="_lnEditNote()">${esc(m.note)}</div>` : ''}
    <div class="ln-row">${_dots(m.c, '_lnRecolor')}<span class="ln-sep"></span>
    <button class="ln-b" onclick="_lnEditNote()">✎ ${m.note ? '改筆記' : '加筆記'}</button>
    <button class="ln-b" onclick="_lnCopyMark()">複製</button>
    <button class="ln-b ln-del" onclick="_lnDel()">刪除</button>
    <button class="ln-b" onclick="_lnBarClose()" aria-label="關閉">✕</button></div>`;
  b.classList.add('on');
}
window._lnBarClose = _barHide;

async function _save(id, fn){
  const rec = await _getRec(id);
  if(!rec) return null;
  rec.marks = fn(rec.marks || []) || [];
  if(!rec.marks.length) delete rec.marks;
  await dp('laws', rec);
  const body = document.querySelector(`#lbody [data-law-id="${CSS.escape(String(id))}"] .law-art-body`);
  if(body) _paint(body, rec);
  _syncCover();
  return rec;
}
const _newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
window._lnRecolor = async c => {
  const cur = _LN.cur; if(!cur) return;
  _LN.color = c;
  await _save(cur.id, ms => ms.map(m => m.id === cur.mid ? { ...m, c } : m));
  _barEdit(cur.id, cur.mid);
};
window._lnEditNote = async () => {
  const cur = _LN.cur; if(!cur) return;
  const rec = await _getRec(cur.id), m = rec?.marks?.find(x => x.id === cur.mid); if(!m) return;
  const note = await askInput('筆記', '「' + m.q.slice(0, 60) + (m.q.length > 60 ? '…' : '') + '」', m.note || '', { multiline:true, placeholder:'寫下重點、口訣、考點…（清空＝刪除筆記）' });
  if(note == null) return;
  await _save(cur.id, ms => ms.map(x => { if(x.id !== cur.mid) return x; const y = { ...x }; if(note.trim()) y.note = note.trim(); else delete y.note; return y; }));
  _barEdit(cur.id, cur.mid);
};
window._lnCopyMark = async () => {
  const cur = _LN.cur; if(!cur) return;
  const m = (await _getRec(cur.id))?.marks?.find(x => x.id === cur.mid); if(!m) return;
  (navigator.clipboard?.writeText(m.q + (m.note ? '\n' + m.note : '')) || Promise.reject()).then(() => toast('已複製')).catch(() => toast('複製失敗'));
};
window._lnDel = async () => {
  const cur = _LN.cur; if(!cur) return;
  const m = (await _getRec(cur.id))?.marks?.find(x => x.id === cur.mid);
  if(m?.note && !await askConfirm('刪除重點', '這個重點有筆記，刪除後筆記也會一起刪掉。', '刪除')) return;
  _barHide();
  await _save(cur.id, ms => ms.filter(x => x.id !== cur.mid));
  toast('已刪除');
};

// 點重點：遮住模式下顯示／遮回；平常跳出編輯列
document.addEventListener('click', e => {
  const mk = e.target.closest?.('#lbody .ln-mk, #lbody .ln-ni');
  if(!mk) return;
  const sel = getSelection();
  if(sel && !sel.isCollapsed) return;
  const body = _body(mk), id = _cardId(body), mid = mk.dataset.mid;
  if(_LN.cover && mk.classList.contains('ln-mk')){
    body.querySelectorAll(`.ln-mk[data-mid="${mid}"]`).forEach(x => x.classList.toggle('ln-show'));
    return;
  }
  _barEdit(id, mid);
}, true);
// 在條文以外的地方點一下就收起編輯列
document.addEventListener('pointerdown', e => {
  if(_LN.cur && !e.target.closest('#ln-bar, .ln-mk, .ln-ni, #ask-in-ov, #cfm-ov')) _barHide();
});

// ── 手寫筆記（v4.65）──────────────────────────────────────────
const _INK = { ed:null };   // 正在寫的：{ id, card, board }
const _cardOf = id => document.querySelector(`#lbody .law-art-card[data-law-id="${CSS.escape(String(id))}"]`);
// 卡片平常顯示的筆記（唯讀，不擋點選）
function _inkPaint(card, rec){
  card.querySelector(':scope > .ink-view')?.remove();
  const ink = rec?.ink;
  card.classList.toggle('has-ink', !!ink);
  card.style.minHeight = '';
  if(!ink || !window.YCInk) return;
  const v = YCInk.view(ink);
  card.appendChild(v);
  // 版面變窄、條文變短時，筆記不要超出卡片
  const need = card.clientWidth * (ink.h || 1) / (ink.w || 1);
  if(need > card.clientHeight + 1) card.style.minHeight = Math.ceil(need) + 'px';
}
window.lnInk = async id => {
  if(!window.YCInk){ toast('手寫工具還沒載入，請重新整理'); return; }
  if(_INK.ed){
    const same = _INK.ed.id === id;
    await _inkEnd();
    if(same) return;
  }
  const card = _cardOf(id), rec = await _getRec(id);
  if(!card || !rec) return;
  _barHide();
  card.querySelector(':scope > .ink-view')?.remove();
  card.style.minHeight = '';
  const cw = card.clientWidth || 360, ch = card.clientHeight || 200;
  // 畫布寬 800；高度照卡片比例（以前寫的比較高就用以前的）；超長的條文（SOP）降低解析度，最高 12000
  let W = 800, H = Math.round(800 * ch / cw);
  if(rec.ink?.w && rec.ink?.h) H = Math.max(H, Math.round(rec.ink.h * 800 / rec.ink.w));
  if(H > 12000){ W = Math.max(200, Math.round(800 * 12000 / H)); H = 12000; }
  const board = new YCInk.Board(card, { W, H, pan:true, barBottom:14, onDone:() => _inkEnd() });
  _INK.ed = { id, card, board };
  await board.load(rec.ink || null);
  board.start();
  card.scrollIntoView({ block:'nearest', behavior:'smooth' });
  toast('直接在這一條上寫、圈畫；選「T 文字」可以打字');
};
// 結束手寫：存檔、換回唯讀顯示
async function _inkEnd(){
  const ed = _INK.ed; if(!ed) return;
  _INK.ed = null;
  const { id, card, board } = ed;
  const dirty = board.dirty, d = dirty ? board.export() : null;
  board.destroy();
  let rec = await _getRec(id);
  if(dirty && rec){
    if(d.img || d.txt){
      rec.ink = { w:d.w, h:d.h, at:Date.now() };
      if(d.img) rec.ink.img = d.img;
      if(d.txt) rec.ink.txt = d.txt;
    } else delete rec.ink;
    await dp('laws', rec);
    toast(rec.ink ? '筆記已儲存' : '已清除這一條的筆記');
  }
  if(document.contains(card)) _inkPaint(card, rec);
}
window.lnInkEnd = _inkEnd;

// ── 遮住重點（背誦）──────────────────────────────────────────
function _syncCover(){
  const lb = document.getElementById('lbody'); if(!lb) return;
  lb.classList.toggle('ln-cover', _LN.cover);
  const n = lb.querySelectorAll('.ln-mk').length;
  const it = document.getElementById('ln-cover-item');
  if(it){ it.textContent = _LN.cover ? '👁 顯示全部重點' : '🙈 遮住重點（背誦）'; it.style.display = n || _LN.cover ? '' : 'none'; }
  const tip = document.getElementById('ln-cover-tip');
  if(tip) tip.classList.toggle('on', _LN.cover);
}
window.lnToggleCover = () => {
  _LN.cover = !_LN.cover;
  document.querySelectorAll('#lbody .ln-show').forEach(x => x.classList.remove('ln-show'));
  _syncCover();
  if(_LN.cover) toast('重點已遮住，點一下顯示');
};

// ── 筆記總覽 ────────────────────────────────────────────────
//   手寫（含打的字）、以前的選字重點、整條筆記（編輯表單的「備註」）
async function _allItems(){
  const laws = await da('laws'), out = [];
  for(const l of laws){
    if(!l.marks?.length && !l.note && !l.ink) continue;
    if(l.ink) out.push({ l, ink:true });
    const plain = String(l.content || '').startsWith('data:') ? '' : String(l.content || '').replace(/\s+/g, '');
    for(const m of l.marks || [])
      out.push({ l, m, lost: !!plain && !plain.includes(m.q.replace(/\s+/g, '')) });
    if(l.note) out.push({ l, artNote:true });
  }
  return out;
}
const _artLabel = l => (l.article || '') + (l.title ? ' ' + l.title : '');
const _inkText = l => (l.ink?.txt || []).map(t => t.t).join('\n');
const _KIND = { ink:'✍ 手寫', mark:'🖍 重點', note:'📝 整條筆記' };
const _kindOf = it => it.ink ? 'ink' : it.m ? 'mark' : 'note';
window.lnOpenAll = async (lawName) => {
  _LN.ovFilter = { c:'', q:'', law: lawName || '' };
  let ov = document.getElementById('ln-ov');
  if(!ov){
    ov = document.createElement('div'); ov.id = 'ln-ov'; ov.className = 'ln-ov';
    ov.addEventListener('click', e => { if(e.target === ov) lnCloseAll(); });
    document.body.appendChild(ov);
  }
  _LN.items = await _allItems();
  const kinds = Object.keys(_KIND).filter(k => _LN.items.some(it => _kindOf(it) === k));
  ov.innerHTML = `<div class="ln-sheet">
    <div class="ln-hd"><b>📝 法規筆記</b><span id="ln-cnt"></span>
      <button class="ln-b" onclick="_lnExport()">匯出</button><button class="ln-b" onclick="lnCloseAll()" aria-label="關閉">✕</button></div>
    <div class="ln-filters">
      <input id="ln-q" type="search" placeholder="搜尋打的字、筆記、法規名稱" oninput="_LNF('q',this.value)">
      ${kinds.length > 1 ? `<div class="ln-chips"><button class="ln-chip on" data-c="" onclick="_LNF('c','')">全部</button>${kinds.map(k =>
        `<button class="ln-chip" data-c="${k}" onclick="_LNF('c','${k}')">${_KIND[k]}</button>`).join('')}</div>` : ''}
      ${lawName ? `<label class="ln-scope"><input type="checkbox" checked onchange="_LNF('law',this.checked?${esc(JSON.stringify(lawName)).replace(/"/g, '&quot;')}:'')"> 只看「${esc(lawName)}」</label>` : ''}
    </div>
    <div class="ln-list" id="ln-list"></div></div>`;
  ov.classList.add('on');
  _renderAll();
};
window.lnCloseAll = () => document.getElementById('ln-ov')?.classList.remove('on');
window._LNF = (k, v) => {
  _LN.ovFilter[k] = v;
  if(k === 'c') document.querySelectorAll('#ln-ov .ln-chip').forEach(b => b.classList.toggle('on', b.dataset.c === v));
  _renderAll();
};
function _filtered(){
  const f = _LN.ovFilter, q = f.q.trim().toLowerCase();
  return (_LN.items || []).filter(it => {
    if(f.law && it.l.lawName !== f.law) return false;
    if(f.c && _kindOf(it) !== f.c) return false;
    if(q && ![it.l.lawName, _artLabel(it.l), it.m?.q, it.m?.note, it.artNote ? it.l.note : '', it.ink ? _inkText(it.l) : ''].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
function _renderAll(){
  const list = document.getElementById('ln-list'); if(!list) return;
  const items = _filtered();
  document.getElementById('ln-cnt').textContent = items.length + ' 則';
  if(!items.length){
    list.innerHTML = `<div class="ln-empty">${(_LN.items || []).length ? '沒有符合的筆記' : '還沒有筆記。<br>打開任一部法規，按條文右上角 ✍，就能直接在條文上手寫、圈畫、打字。'}</div>`;
    return;
  }
  // 依法規分組，組內依條號排（手寫在前）
  const groups = new Map();
  for(const it of items){ const k = it.l.lawName || ''; if(!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const an = l => l.articleNumber || (typeof art2n === 'function' ? art2n(l.article || '') : 0) || 0;
  const ord = { ink:0, note:1, mark:2 };
  let html = '';
  for(const [name, arr] of groups){
    arr.sort((a, b) => an(a.l) - an(b.l) || ord[_kindOf(a)] - ord[_kindOf(b)] || (a.m?.at || 0) - (b.m?.at || 0));
    html += `<div class="ln-gh">${esc(name)}<small>${arr.length}</small></div>`;
    html += arr.map(it => {
      const go = `_lnGo(${JSON.stringify(it.l.id)},${it.m ? JSON.stringify(it.m.id) : 'null'})`.replace(/"/g, '&quot;');
      if(it.ink){
        const tx = _inkText(it.l), d = it.l.ink.at ? new Date(it.l.ink.at) : null;
        return `<div class="ln-item ln-ink" onclick="${go}"><div class="ln-art">${esc(_artLabel(it.l))}・✍ 手寫${it.l.ink.img ? '' : '（只有打字）'}${d ? `<span class="ln-at">${d.getMonth() + 1}/${d.getDate()}</span>` : ''}</div>
          ${tx ? `<div class="ln-nt">${esc(tx)}</div>` : '<div class="ln-nt ln-dimt">（只有手寫筆跡，點一下看）</div>'}</div>`;
      }
      if(it.artNote) return `<div class="ln-item" onclick="${go}"><div class="ln-art">${esc(_artLabel(it.l))}・整條筆記</div><div class="ln-nt">📝 ${esc(it.l.note)}</div></div>`;
      const m = it.m;
      return `<div class="ln-item" style="--lnc:${LN_COLORS[m.c] || LN_COLORS.yellow}" onclick="${go}">
        <div class="ln-art">${esc(_artLabel(it.l))}・🖍 重點${it.lost ? '<span class="ln-lost">原文已修改</span>' : ''}</div>
        <div class="ln-q">${esc(m.q)}</div>${m.note ? `<div class="ln-nt">✎ ${esc(m.note)}</div>` : ''}</div>`;
    }).join('');
  }
  list.innerHTML = html;
}
// 跳回條文：打開那部法規、捲到那一條、閃一下
window._lnGo = async (id, mid) => {
  const rec = await _getRec(id); if(!rec) return;
  lnCloseAll();
  const lv = document.getElementById('lv');
  if(!(lv && lv.style.display !== 'none' && window.currentLawName === rec.lawName)) await openLawGroup(rec.lawName);
  await new Promise(r => setTimeout(r, 250));
  await _paintAll();
  const card = _cardOf(id);
  if(!card) return;
  const mk = mid && card.querySelector(`.ln-mk[data-mid="${CSS.escape(mid)}"]`);
  (mk || card).scrollIntoView({ block:'center', behavior:'smooth' });
  const els = mk ? card.querySelectorAll(`.ln-mk[data-mid="${CSS.escape(mid)}"]`) : [card];
  els.forEach(x => { x.classList.remove('ln-flash'); void x.offsetWidth; x.classList.add('ln-flash'); });
  setTimeout(() => els.forEach(x => x.classList.remove('ln-flash')), 1600);
};
window._lnExport = () => {
  const items = _filtered();
  if(!items.length){ toast('沒有可以匯出的筆記'); return; }
  let md = '# 法規筆記\n\n', last = null;
  for(const it of items){
    if(it.l.lawName !== last){ md += `\n## ${it.l.lawName}\n\n`; last = it.l.lawName; }
    if(it.ink){
      const tx = _inkText(it.l);
      md += `**${_artLabel(it.l)}**（手寫）\n\n${tx ? tx.split('\n').map(x => '- ' + x).join('\n') + '\n\n' : '（只有手寫筆跡）\n\n'}`;
      continue;
    }
    if(it.artNote){ md += `**${_artLabel(it.l)}**（整條筆記）\n\n${it.l.note}\n\n`; continue; }
    md += `**${_artLabel(it.l)}**〔重點・${LN_NAMES[it.m.c] || ''}〕\n\n> ${it.m.q.replace(/\n+/g, ' ')}\n\n${it.m.note ? it.m.note + '\n\n' : ''}`;
  }
  const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  dl(md, '法規筆記_' + ymd + '.md', 'text/markdown');
};

// 返回鍵：先關總覽、再關舊重點的編輯列（手寫由 YCInk.back 先處理）
window.lnBack = () => {
  if(document.getElementById('ln-ov')?.classList.contains('on')){ lnCloseAll(); return true; }
  if(document.getElementById('ln-bar')?.classList.contains('on')){ _barHide(); return true; }
  return false;
};
// 離開法規畫面：手寫先存、收起工具列、取消遮住
window.lnOnExit = () => { _inkEnd(); _barHide(); _LN.cover = false; _syncCover(); };

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _watch); else _watch();
})();
