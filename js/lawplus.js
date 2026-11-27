// ══ lawplus.js — 開源套件整合（v4.67）════════════════════════════════════
//   ①修法前後對照：桌面工具「官網一鍵更新」內容有改的條文會留下 prevContent／prevDate，
//     條文標題旁出現「修」，點開看紅綠對照（jsdiff，BSD-3，js/lib/diff.min.js）。
//   ②法規心智圖：把目前這部法規的編章節＋每一條畫成可展開收合的心智圖（markmap，MIT＋d3，ISC），
//     點條文直接跳過去。
//   ③（v4.69 拿掉）簡體搜尋：使用者打繁體，用不到，省下 1.1 MB。
//   套件都放在本機 js/lib/，第一次用到才載入（之後離線可用），平常不佔開啟速度。
(function(){
'use strict';

const _e = s => (typeof esc === 'function' ? esc(s) : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])));
const _loading = {};
// 第一次用到才載入的程式庫（同一個檔只載一次）
function loadScript(src){
  if(_loading[src]) return _loading[src];
  _loading[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = false;
    s.onload = () => res(); s.onerror = () => { delete _loading[src]; rej(new Error('載入失敗：' + src)); };
    document.head.appendChild(s);
  });
  return _loading[src];
}
window.ycLoadScript = loadScript;

function _sheet(id, html){
  let o = document.getElementById(id);
  if(!o){
    o = document.createElement('div'); o.id = id; o.className = 'lp-ov';
    o.addEventListener('click', e => { if(e.target === o) o.classList.remove('on'); });
    document.body.appendChild(o);
  }
  o.innerHTML = html;
  o.classList.add('on');
  return o;
}
const _close = id => document.getElementById(id)?.classList.remove('on');
const _isOn = id => !!document.getElementById(id)?.classList.contains('on');

// ── ①修法前後對照 ─────────────────────────────────────────────
// 條文卡片標題旁的「修」（data.js renderArtCard 呼叫）
window.lpAmendBadge = l => (l && l.prevContent != null && !String(l.content || '').startsWith('data:'))
  ? '<button class="lp-amd" onclick="event.stopPropagation();lpDiff(' + l.id + ')" title="修法前後對照' + (l.prevDate ? '（修正前：' + _e(l.prevDate) + '）' : '') + '" aria-label="修法前後對照">修</button>'
  : '';
let _diffMode = 'mix', _diffLaw = null;
window.lpDiff = async id => {
  const l = await _db.laws.get(id); if(!l || l.prevContent == null) return;
  _diffLaw = l;
  try{ await loadScript('js/lib/diff.min.js'); }catch(e){ toast('對照工具載入失敗（需要網路第一次下載）'); return; }
  _diffRender();
};
function _diffBody(){
  const l = _diffLaw, a = String(l.prevContent || ''), b = String(l.content || '');
  if(_diffMode === 'old') return '<div class="lp-dtxt">' + _e(a) + '</div>';
  if(_diffMode === 'new') return '<div class="lp-dtxt">' + _e(b) + '</div>';
  // 以「字」比對（中文沒有空格分詞），連續的小改動合併成一段好讀
  const parts = window.Diff.diffChars(a, b);
  let add = 0, del = 0;
  const html = parts.map(p => {
    if(p.added){ add += p.value.length; return '<ins>' + _e(p.value) + '</ins>'; }
    if(p.removed){ del += p.value.length; return '<del>' + _e(p.value) + '</del>'; }
    return _e(p.value);
  }).join('');
  return '<div class="lp-dsum">刪除 <b class="lp-del">' + del + '</b> 字、新增 <b class="lp-add">' + add + '</b> 字</div><div class="lp-dtxt">' + html + '</div>';
}
function _diffRender(){
  const l = _diffLaw;
  const head = (l.lawName || '') + ' ' + (l.article || '') + (l.title ? '（' + l.title + '）' : '');
  _sheet('lp-diff', `<div class="lp-p">
    <div class="lp-hd"><b>修法前後對照</b><button onclick="lpDiffClose()" aria-label="關閉">✕</button></div>
    <div class="lp-sub">${_e(head)}</div>
    <div class="lp-dates"><span class="lp-del">修正前　${_e(l.prevDate || '（日期不明）')}</span><span>→</span><span class="lp-add">修正後　${_e(l.amendDate || '（日期不明）')}</span></div>
    <div class="lp-seg">${[['mix', '對照'], ['old', '修正前'], ['new', '修正後']].map(([k, n]) =>
      `<button class="${_diffMode === k ? 'on' : ''}" onclick="lpDiffMode('${k}')">${n}</button>`).join('')}</div>
    <div class="lp-body">${_diffBody()}</div>
    <div class="lp-note">紅色刪除線＝刪掉的字，綠色底線＝新增的字。資料來自桌面工具「官網一鍵更新」時保留的修正前條文。</div>
  </div>`);
}
window.lpDiffMode = k => { _diffMode = k; _diffRender(); };
window.lpDiffClose = () => _close('lp-diff');

// ── ②法規心智圖 ──────────────────────────────────────────────
let _mm = null, _mmItems = [];
window.lpMap = async () => {
  const lb = document.getElementById('lbody'); if(!lb) return;
  const name = (typeof S === 'object' && S.curLawName) || '';
  window.lrTocClose?.();
  // 依版面順序收集：編章節標題（縮排＝層級）與條文
  _mmItems = [];
  const root = { content:'<b>' + _e(name) + '</b>', children:[] };
  const stack = [{ lv:-1, node:root }];
  lb.querySelectorAll('[id^="ch-"], .law-art-card').forEach(el => {
    if(el.classList.contains('law-art-card')){
      const head = (el.querySelector('.law-art-head > span')?.textContent || '').trim();
      let label = head;
      if(!/[—－]/.test(head)){
        const t = (el.querySelector('.law-art-body')?.textContent || '').replace(/\s+/g, '').slice(0, 16);
        if(t) label += '　' + t + '…';
      }
      const i = _mmItems.push(el) - 1;
      stack[stack.length - 1].node.children.push({ content:'<span class="lp-mi" data-i="' + i + '">' + _e(label.slice(0, 40)) + '</span>', children:[] });
    }else{
      const lv = parseFloat(el.style.marginLeft) || 0;
      while(stack.length > 1 && stack[stack.length - 1].lv >= lv) stack.pop();
      const node = { content:_e(el.textContent.trim().replace(/^[編章節]\s*(?=第)/, '').slice(0, 30)), children:[] };
      stack[stack.length - 1].node.children.push(node);
      stack.push({ lv, node });
    }
  });
  if(!_mmItems.length){ toast('這部法規沒有條文可以畫'); return; }
  const hasHead = root.children.some(c => !/lp-mi/.test(c.content));
  const o = _sheet('lp-map', `<div class="lp-mp">
    <div class="lp-hd"><b>🧠 ${_e(name)}</b><span class="lp-mhint">點圓點展開收合・點條文跳過去・兩指縮放</span>
      <button onclick="lpMapFit()" aria-label="置中">⤢</button><button onclick="lpMapClose()" aria-label="關閉">✕</button></div>
    <svg id="lp-svg"></svg></div>`);
  try{
    await loadScript('js/lib/d3.min.js');
    await loadScript('js/lib/markmap-view.js');
  }catch(e){ toast('心智圖載入失敗（需要網路第一次下載）'); o.classList.remove('on'); return; }
  const svg = o.querySelector('#lp-svg');
  try{ _mm?.destroy?.(); }catch(_){}
  _mm = window.markmap.Markmap.create(svg, {
    autoFit:true, duration:300, paddingX:8, spacingVertical:8, fitRatio:0.96,
    maxWidth: innerWidth < 600 ? 150 : 260, spacingHorizontal: innerWidth < 600 ? 40 : 80,   // 手機：文字窄一點換行，整張圖才放得大
    // 條文不多（≤60）全部展開；很多又有編章節：先只展開到章，點圓點再展開
    initialExpandLevel: (hasHead && _mmItems.length > 60) ? 2 : -1,
  }, root);
  setTimeout(() => _mm?.fit?.(), 350);
};
// 點條文 → 關掉心智圖、跳到那一條
document.addEventListener('click', e => {
  // 條文名稱換行時，點到行與行之間或字旁空白，target 是外層 div（不是 .lp-mi），也要算點到這一條
  const t = e.target.closest?.('#lp-map .lp-mi') || e.target.closest?.('#lp-map foreignObject')?.querySelector('.lp-mi'); if(!t) return;
  const el = _mmItems[+t.dataset.i]; if(!el) return;
  e.preventDefault(); e.stopPropagation();
  _close('lp-map');
  el.scrollIntoView({ block:'start' });
  el.classList.remove('lv-flash'); void el.offsetWidth; el.classList.add('lv-flash');
}, true);
window.lpMapFit = () => _mm?.fit?.();
window.lpMapClose = () => _close('lp-map');

// ── ④找不到時列出「相近結果」（v4.68）──────────────────────────
//   原本的搜尋（每個詞都要出現）結果完全不變；只有「一筆都沒有」時，改用「相鄰兩個字」比對，
//   列出大部分字詞都有出現的條文、題目，依相符程度排序，標明「不完全符合」。
//   FlexSearch（Apache-2.0）實測過：中文逐字切，「臨檢要件」排出一堆無關條文，所以不用套件，自己比對。
const _fzNorm = s => String(s || '').replace(/身份/g, '身分').replace(/台(?=[灣北中南東])/g, '臺')
  .replace(/[\s　、，。；：「」『』（）()【】〔〕﹝﹞\[\]\-—_.,;:!?！？…·]/g, '').toLowerCase();
const _bi = s => { const a = new Set(); for(let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); if(s.length === 1) a.add(s); return [...a]; };
// 選項、關鍵字可能是陣列、物件（{A:…}）或字串
const _flat = v => Array.isArray(v) ? v.join(' ') : (v && typeof v === 'object') ? Object.values(v).join(' ') : String(v || '');
const _fzCache = new WeakMap();   // 資料陣列 → 正規化後的文字（陣列換了才重算）
function _fzRank(arr, q, prep, lim){
  const qb = _bi(_fzNorm(q)); if(qb.length < 2) return [];   // 太短（一兩個字）不猜
  let docs = _fzCache.get(arr);
  if(!docs){ docs = arr.map(x => ({ x, f:prep(x).map(([v, w]) => [_fzNorm(v), w]) })); _fzCache.set(arr, docs); }
  const out = [];
  for(const d of docs){
    let hit = 0, s = 0;
    for(const b of qb){
      let best = 0;
      for(const [v, w] of d.f) if(w > best && v.includes(b)) best = w;
      if(best){ hit++; s += best; }
    }
    const cov = hit / qb.length;
    if(cov < 0.6) continue;   // 六成以上的字詞有出現才列
    const len = d.f.reduce((n, [v]) => n + v.length, 0);
    out.push({ x:d.x, sc:cov * 10 + s / qb.length - Math.min(len, 600) / 3000 });
  }
  return out.sort((a, b) => b.sc - a.sc).slice(0, lim).map(o => o.x);
}
// 搜尋框的字還是同一個、清單還是「找不到」才畫（使用者已經改字就不畫）
const _fzStill = (inputId, el, kw) => {
  const v = document.getElementById(inputId)?.value;
  // 同 data.js 的 _kwNorm（全形英數轉半形、小寫、去頭尾空白；那個在 data.js 模組內，這裡拿不到）
  const norm = String(v || '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).toLowerCase().trim();
  return norm === kw && el.isConnected && el.querySelector(':scope > .empty') && !el.querySelector('.yc-fz');
};
const _fzHead = n => '<div class="law-search-head yc-fz">沒有完全符合的，以下 ' + n + ' 筆是大部分字詞有出現的（依相符程度）</div>';
window.ycFuzzyLaws = async (kw, el) => {
  const ls = (await da('laws')).filter(l => !String(l.content || '').startsWith('data:')
    && (typeof S !== 'object' || !S.lawCat || S.lawCat === 'all' || l.category === S.lawCat));
  const r = _fzRank(ls, kw, l => [[l.lawName, 1.5], [l.title, 2], [l.content, 1]], 20);
  if(!r.length || !_fzStill('lsi', el, kw)) return;
  el.insertAdjacentHTML('beforeend', _fzHead(r.length) + r.map(l =>
    '<div class="card law-search-card yc-fz-i" onclick="ycFuzzyOpenLaw(' + l.id + ')">'
    + '<div class="law-search-lawname">' + _e(l.lawName || '') + '</div>'
    + '<div class="law-search-article">' + _e(l.article || '') + (l.title ? ' <span class="law-search-title">' + _e(l.title) + '</span>' : '') + '</div>'
    + '<div class="law-search-preview">' + _e(String(l.content || '').slice(0, 80)) + '</div></div>').join(''));
};
// 打開整部法規、跳到那一條並閃一下
window.ycFuzzyOpenLaw = async id => {
  const l = await _db.laws.get(id); if(!l) return;
  await openLawGroup(l.lawName, true);
  setTimeout(() => {
    const c = document.querySelector('#lbody [data-law-id="' + id + '"]'); if(!c) return;
    c.scrollIntoView({ block:'start' });
    c.classList.remove('lv-flash'); void c.offsetWidth; c.classList.add('lv-flash');
  }, 350);
};
window.ycFuzzyQs = async (kw, el) => {
  const qs = await da('questions');
  const r = _fzRank(qs, kw, q => [[q.stem, 2], [q.groupStem, 1], [_flat(q.options), 1], [_flat(q.keywords), 2]], 20);
  if(!r.length || !_fzStill('si', el, kw)) return;
  el.insertAdjacentHTML('beforeend', _fzHead(r.length) + r.map(q =>
    '<div class="qc yc-fz-i"><div class="qch"><span class="badge ' + (q.type === 'mc' ? 'bmc' : 'bes') + '">' + (q.type === 'mc' ? '選擇' : '申論') + '</span>'
    + (q.year ? '<span class="tag">' + _e(q.year) + '</span>' : '') + (q.exam ? '<span class="tag">' + _e(q.exam) + '</span>' : '')
    + '<span class="tag">' + _e(q.subject || '未分類') + '</span></div>'
    + '<div class="qst">' + _e(String(q.stem || '').slice(0, 100)) + '</div>'
    + '<div class="qa"><button class="qabn" onclick="editQ(' + q.id + ')">✏ 編輯</button>'
    + '<button class="qabn" data-qid="' + q.id + '" onclick="startSingleQ(this)">▶ 練習</button></div></div>').join(''));
};

// ── ⑤背誦模式（v4.69：數字挖空＋法律用語＋我的挖空＋舊重點，一個入口，可調整）────────
//   ⋮ 選單「🙈 背誦模式」：勾要遮哪些 → 條文裡變成色塊，點一下顯示。
//   ✎ 調整：點色塊＝這個不要遮；選取一段字＝加進「我的挖空」。調整存在那一條的 cz 欄位（隨備份），條文內容一個字都不改。
//     cz = { add:[{t:'文字', n:第幾次出現}], off:[{t, n}] }；條文更新後原文還在就照樣遮，找不到的在背誦模式視窗列出、可清掉。
//   只改畫面（包一層 span、不加寬度），手寫筆記位置不跑掉。「第十條」「前二項」這類條號、項次，「同一」「單一」不遮。
const _N = '[零〇一二兩三四五六七八九十百千萬億0-9０-９]';
const _RX = {
  num: new RegExp('(?<![第前後同任單唯統逐])(?:百分之' + _N + '+(?:點' + _N + '+)?|' + _N + '+分之' + _N + '+|'
    + _N + '+(?:[.,，．]' + _N + '+)*(?=(?:個月|個工作日|小時|分鐘|日|天|月|年|週|星期|歲|萬元|億元|千元|元|倍|次|公尺|公里|公分|公斤|公克|毫升|毫克|人|名|張|件|輛|公升|度)))', 'g'),
  // 法律用語：考題最愛考「應」「得」「不得」的差別。取得、獲得、相應、適應這類一般用詞不遮（遮錯可用 ✎ 調整拿掉）
  word: /不得|準用|除外|(?<![取獲所習心懂值記使覺顯難曉博贏求免非捨])得(?![知悉到])|(?<![相對適反供因回答呼效報理順感照])應(?![用徵變付考允聘])|(?<=^|[。，；：、\n])但/g,
};
const _RC_LS = 'yc_recite';
const _rcPref = Object.assign({ num:true, word:false, mine:true, old:true },
  (() => { try{ return JSON.parse(localStorage.getItem(_RC_LS) || '{}') || {}; }catch(_){ return {}; } })());
const _rcSave = () => { try{ localStorage.setItem(_RC_LS, JSON.stringify(_rcPref)); }catch(_){} };
let _rc = false, _adj = false, _rcObs = null, _rcT = 0;
const _cz = new Map();   // 條文 id → { add, off }（目前這部法規）
const _nth = (s, t, end) => { let n = 0, i = -1; while((i = s.indexOf(t, i + 1)) >= 0 && i < end) n++; return n; };
const _at = (s, t, n) => { let i = -1; for(let k = 0; k <= n; k++){ i = s.indexOf(t, i + 1); if(i < 0) return -1; } return i; };
function _unwrap(body){
  body.querySelectorAll('.lp-cz').forEach(sp => sp.replaceWith(document.createTextNode(sp.textContent)));
  body.normalize();
  delete body.dataset.rcn;
}
// 一條條文：算出要遮的範圍（以整條文字的位置），再包成 span（跨好幾個文字節點的拆段包，同一組 data-g）
function _wrap(body){
  const card = body.closest('.law-art-card'); const id = card ? +card.dataset.lawId : 0;
  const s = body.textContent, cz = _cz.get(id) || { add:[], off:[] };
  const offSet = new Set(cz.off.map(o => o.t + '\u0000' + o.n));
  const rs = [];
  for(const k of ['num', 'word']){
    if(!_rcPref[k]) continue;
    const re = _RX[k]; re.lastIndex = 0; let m;
    while((m = re.exec(s))){
      if(!m[0]){ re.lastIndex++; continue; }
      const n = _nth(s, m[0], m.index);
      if(!offSet.has(m[0] + '\u0000' + n)) rs.push({ a:m.index, b:m.index + m[0].length, k, t:m[0], n });
    }
  }
  if(_rcPref.mine) for(const x of cz.add){ const i = _at(s, x.t, x.n); if(i >= 0) rs.push({ a:i, b:i + x.t.length, k:'mine', t:x.t, n:x.n }); }
  // 重疊時「我的挖空」優先，其他照位置先後
  rs.sort((x, y) => x.a - y.a || (y.k === 'mine') - (x.k === 'mine'));
  const keep = []; let end = -1;
  for(const r of rs) if(r.a >= end){ keep.push(r); end = r.b; }
  // 文字節點與位置對照
  const nodes = [], w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); let pos = 0;
  while(w.nextNode()){ const t = w.currentNode; nodes.push({ t, a:pos, b:pos + t.nodeValue.length }); pos += t.nodeValue.length; }
  let cnt = 0;
  keep.forEach((r, gi) => {
    for(const nd of nodes){
      if(nd.b <= r.a || nd.a >= r.b) continue;
      const p = nd.t.parentElement;
      if(p && p.closest('textarea, input, button, .ink-tl')) continue;
      const x0 = Math.max(r.a, nd.a) - nd.a, x1 = Math.min(r.b, nd.b) - nd.a;
      let mid = nd.t;
      if(x0 > 0) mid = mid.splitText(x0);
      const rest = mid.splitText(x1 - x0);
      const sp = document.createElement('span');
      sp.className = 'lp-cz' + (r.k === 'mine' ? ' lp-czm' : '');
      sp.dataset.g = gi; sp.dataset.k = r.k; sp.dataset.t = r.t; sp.dataset.n = r.n;
      mid.replaceWith(sp); sp.appendChild(mid); cnt++;
      // 這個節點切剩的部分（從範圍結尾開始）留給後面的範圍
      nd.t = rest; nd.a = nd.a + x1;
    }
  });
  body.dataset.rcn = cnt;
  return keep.length;
}
function _applyAll(force){
  const lb = document.getElementById('lbody'); if(!lb) return 0;
  let n = 0;
  lb.querySelectorAll('.law-art-body').forEach(body => {
    if(!force && body.dataset.rcn != null && body.querySelectorAll('.lp-cz').length === +body.dataset.rcn) return;
    _unwrap(body); n += _wrap(body);
  });
  return n;
}
async function _loadCz(){
  _cz.clear();
  const ids = [...document.querySelectorAll('#lbody .law-art-card')].map(c => +c.dataset.lawId).filter(Boolean);
  const rows = await _db.laws.bulkGet(ids);
  for(const r of rows) if(r && r.cz) _cz.set(r.id, { add:r.cz.add || [], off:r.cz.off || [] });
}
async function _saveCz(id){
  const rec = await _db.laws.get(id); if(!rec) return;
  const c = _cz.get(id);
  if(c && (c.add.length || c.off.length)) rec.cz = { add:c.add, off:c.off }; else delete rec.cz;
  await dp('laws', rec);
}
function _sync(){
  const lb = document.getElementById('lbody');
  lb?.classList.toggle('lp-rc', _rc);
  lb?.classList.toggle('lp-adj', _rc && _adj);
  const it = document.getElementById('lp-cz-item');
  if(it) it.textContent = _rc ? '🙈 背誦模式（開啟中）' : '🙈 背誦模式';
  let bar = document.getElementById('lp-rc-bar');
  if(_rc && _adj){
    if(!bar){ bar = document.createElement('div'); bar.id = 'lp-rc-bar'; document.body.appendChild(bar); }
    bar.innerHTML = '<span>✎ 調整挖空：點色塊＝不要遮；選取文字＝加挖空</span><button onclick="lpReciteAdj(false)">完成</button>';
    bar.classList.add('on');
  }else bar?.classList.remove('on');
  if(!_adj) _addBtn(null);
}
// 舊重點（v4.64 的選字重點）照 lawnote 的「遮住重點」
function _oldCover(on){
  const lb = document.getElementById('lbody'); if(!lb || !lb.querySelector('.ln-mk')) return;
  if(lb.classList.contains('ln-cover') !== !!on) window.lnToggleCover?.();
}
async function _start(){
  await _loadCz();
  _rc = true;
  const lb = document.getElementById('lbody');
  const n = _applyAll(true);
  _rcObs = _rcObs || new MutationObserver(() => { clearTimeout(_rcT); _rcT = setTimeout(() => { if(_rc) _applyAll(false); }, 80); });
  _rcObs.observe(lb, { childList:true, subtree:true });
  _oldCover(_rcPref.old);
  _sync();
  return n;
}
function _stop(){
  _rc = false; _adj = false;
  _rcObs?.disconnect();
  document.querySelectorAll('#lbody .law-art-body').forEach(_unwrap);
  _oldCover(false);
  _sync();
}
// 背誦模式視窗
window.lpRecite = async () => {
  const lb = document.getElementById('lbody'); if(!lb) return;
  window.closeLvMenu?.();
  if(!_rc) await _loadCz();
  // 自訂挖空找不到原文的（條文更新過）
  let lost = 0;
  for(const [id, c] of _cz){
    const body = lb.querySelector('.law-art-card[data-law-id="' + id + '"] .law-art-body'); if(!body) continue;
    const s = body.textContent;
    lost += c.add.filter(x => _at(s, x.t, x.n) < 0).length;
  }
  const hasOld = !!lb.querySelector('.ln-mk');
  const ck = (k, label) => '<label class="lp-rck"><input type="checkbox" ' + (_rcPref[k] ? 'checked' : '') + ' onchange="lpRecitePref(\'' + k + '\',this.checked)"> ' + label + '</label>';
  _sheet('lp-rc', '<div class="lp-p">'
    + '<div class="lp-hd"><b>🙈 背誦模式</b><button onclick="lpReciteClose()" aria-label="關閉">✕</button></div>'
    + '<div class="lp-sub">勾要遮的，條文裡變成色塊，點一下顯示</div>'
    + ck('num', '數字（期間、金額、年齡、倍數、百分比）')
    + ck('word', '法律用語（應、得、不得、準用、除外、但）')
    + ck('mine', '我的挖空（自己加的）')
    + (hasOld ? ck('old', '舊重點（以前選字畫的）') : '')
    + (lost ? '<div class="lp-note" style="color:#ffb74d">有 ' + lost + ' 個自己加的挖空，條文更新後找不到原文，不會遮。<button class="lp-rcx" onclick="lpReciteClearLost()">清掉</button></div>' : '')
    + '<div class="lp-seg" style="margin-top:12px">'
    + '<button class="on" onclick="lpReciteGo()">' + (_rc ? '套用' : '開始背誦') + '</button>'
    + '<button onclick="lpReciteAdj(true)">✎ 調整挖空</button>'
    + (_rc ? '<button onclick="lpReciteOff()">關閉背誦</button>' : '')
    + '</div>'
    + '<div class="lp-note">遮錯了：按「✎ 調整挖空」，點那個色塊就不遮；想多遮：調整時選取那段字，按「＋ 挖空」。調整存在這部法規的資料裡（會跟著備份），條文內容不會改。</div>'
    + '</div>');
};
window.lpRecitePref = (k, v) => { _rcPref[k] = !!v; _rcSave(); };
window.lpReciteClose = () => _close('lp-rc');
window.lpReciteGo = async () => {
  _close('lp-rc');
  const n = await _start();
  toast(n ? '已遮住 ' + n + ' 處，點色塊顯示' : '照目前勾的項目，這部法規沒有要遮的地方');
};
window.lpReciteOff = () => { _close('lp-rc'); _stop(); toast('已關閉背誦模式'); };
window.lpReciteAdj = async on => {
  _close('lp-rc');
  if(on && !_rc) await _start();
  _adj = !!on;
  document.querySelectorAll('#lbody .lp-czs').forEach(x => x.classList.remove('lp-czs'));
  _sync();
  if(on) toast('點色塊＝不要遮；選取文字＝加挖空');
};
window.lpReciteClearLost = async () => {
  const lb = document.getElementById('lbody');
  for(const [id, c] of _cz){
    const body = lb.querySelector('.law-art-card[data-law-id="' + id + '"] .law-art-body'); if(!body) continue;
    const s = body.textContent, before = c.add.length;
    c.add = c.add.filter(x => _at(s, x.t, x.n) >= 0);
    if(c.add.length !== before) await _saveCz(id);
  }
  toast('已清掉找不到原文的挖空'); window.lpRecite();
};
// 點色塊：背誦時＝顯示／再遮；調整時＝不要遮這個
document.addEventListener('click', async e => {
  const sp = e.target.closest?.('#lbody.lp-rc .lp-cz'); if(!sp) return;
  e.stopPropagation(); e.preventDefault();
  const body = sp.closest('.law-art-body');
  if(!_adj){ body.querySelectorAll('.lp-cz[data-g="' + sp.dataset.g + '"]').forEach(x => x.classList.toggle('lp-czs')); return; }
  const id = +sp.closest('.law-art-card').dataset.lawId; if(!id) return;
  const c = _cz.get(id) || { add:[], off:[] }; _cz.set(id, c);
  const t = sp.dataset.t, n = +sp.dataset.n;
  if(sp.dataset.k === 'mine') c.add = c.add.filter(x => !(x.t === t && x.n === n));
  else if(!c.off.some(x => x.t === t && x.n === n)) c.off.push({ t, n });
  _unwrap(body); _wrap(body);
  await _saveCz(id);
  toast('這個不遮了');
}, true);
// 調整時選取文字 → 浮出「＋ 挖空」
let _selT = 0, _selInfo = null;
function _addBtn(info){
  _selInfo = info;
  let b = document.getElementById('lp-rc-add');
  if(!info){ b?.classList.remove('on'); return; }
  if(!b){
    b = document.createElement('button'); b.id = 'lp-rc-add';
    b.addEventListener('mousedown', e => e.preventDefault());   // 按下去不要把選取清掉
    b.addEventListener('click', () => window.lpReciteAddSel());
    document.body.appendChild(b);
  }
  b.textContent = '＋ 挖空「' + (info.t.length > 8 ? info.t.slice(0, 8) + '…' : info.t) + '」';
  b.style.left = Math.max(8, Math.min(innerWidth - 190, info.x)) + 'px';
  b.style.top = Math.max(8, info.y - 46) + 'px';
  b.classList.add('on');
}
document.addEventListener('selectionchange', () => {
  if(!_adj) return;
  clearTimeout(_selT);
  _selT = setTimeout(() => {
    const sel = getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount){ _addBtn(null); return; }
    const r = sel.getRangeAt(0);
    const el = n => n.nodeType === 1 ? n : n.parentElement;
    const b0 = el(r.startContainer)?.closest('.law-art-body'), b1 = el(r.endContainer)?.closest('.law-art-body');
    const t = sel.toString();
    if(!b0 || b0 !== b1 || !t.trim() || t.length > 60 || !document.getElementById('lbody')?.contains(b0)){ _addBtn(null); return; }
    const pre = document.createRange(); pre.selectNodeContents(b0); pre.setEnd(r.startContainer, r.startOffset);
    const rc = r.getBoundingClientRect();
    _addBtn({ body:b0, t, start:pre.toString().length, x:rc.left, y:rc.top });
  }, 250);
});
window.lpReciteAddSel = async () => {
  const info = _selInfo; if(!info) return;
  const body = info.body, id = +body.closest('.law-art-card')?.dataset.lawId; if(!id) return;
  const s = body.textContent;
  if(s.substr(info.start, info.t.length) !== info.t){ toast('選取的位置變了，請再選一次'); _addBtn(null); return; }
  const n = _nth(s, info.t, info.start);
  const c = _cz.get(id) || { add:[], off:[] }; _cz.set(id, c);
  if(!c.add.some(x => x.t === info.t && x.n === n)) c.add.push({ t:info.t, n });
  c.off = c.off.filter(x => !(x.t === info.t && x.n === n));
  if(!_rcPref.mine){ _rcPref.mine = true; _rcSave(); }
  getSelection()?.removeAllRanges(); _addBtn(null);
  _unwrap(body); _wrap(body);
  await _saveCz(id);
  toast('已加進我的挖空');
};
// 用「本法搜尋」時先關掉（字被拆開，找「三日」會找不到）；離開法規也關掉
document.addEventListener('focusin', e => { if(_rc && e.target?.id === 'lv-find-q'){ _stop(); toast('已關閉背誦模式，方便搜尋'); } });
window.lpOnExit = () => { _close('lp-rc'); if(_rc) _stop(); };
// v4.68 的入口名稱（數字挖空）保留：開＝只要有勾數字就開始背誦
window.lpCloze = on => { if(on === false || (on == null && _rc)) _stop(); else { _rcPref.num = true; _rcSave(); window.lpReciteGo(); } };

// 返回鍵：先關對照、心智圖
window.lpBack = () => {
  if(_isOn('lp-diff')){ _close('lp-diff'); return true; }
  if(_isOn('lp-map')){ _close('lp-map'); return true; }
  if(_isOn('yc-exit')){ _close('yc-exit'); return true; }   // v4.69 離開前備份提醒（coach.js）
  if(_isOn('lp-rc')){ _close('lp-rc'); return true; }
  if(_adj){ window.lpReciteAdj(false); return true; }   // 調整挖空中 → 回到背誦
  return false;
};
})();
