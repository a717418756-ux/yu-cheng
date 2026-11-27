// ══ lawplus.js — 開源套件整合（v4.67）════════════════════════════════════
//   ①修法前後對照：桌面工具「官網一鍵更新」內容有改的條文會留下 prevContent／prevDate，
//     條文標題旁出現「修」，點開看紅綠對照（jsdiff，BSD-3，js/lib/diff.min.js）。
//   ②法規心智圖：把目前這部法規的編章節＋每一條畫成可展開收合的心智圖（markmap，MIT＋d3，ISC），
//     點條文直接跳過去。
//   ③簡體搜尋：搜尋找不到、而且打的是中文時，自動把簡體轉繁體再找一次（opencc-js，MIT／Apache-2.0）。
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

// ── ③簡體搜尋 → 自動轉繁體 ──────────────────────────────────────
let _cv = null;
window.ycS2T = async text => {
  if(!_cv){
    await loadScript('js/lib/opencc-cn2t.js');
    _cv = window.OpenCC.Converter({ from:'cn', to:'tw' });
  }
  return _cv(text);
};
// 搜尋沒結果時呼叫：有中文 → 轉繁體；和原本不同才換掉搜尋框的字再搜一次（同一個詞只試一次）
const _tried = new Set();
window.ycS2TRetry = async (inputId, rerun) => {
  const inp = document.getElementById(inputId); if(!inp) return;
  const q = inp.value || '';
  if(!/[一-鿿]/.test(q) || _tried.has(inputId + '\u0000' + q)) return;
  _tried.add(inputId + '\u0000' + q);
  let t;
  try{ t = await window.ycS2T(q); }catch(_){ return; }
  if(!t || t === q || inp.value !== q) return;   // 沒有簡體字，或使用者已經改了字
  inp.value = t;
  toast('找不到，已把簡體轉成繁體再找：' + t);
  try{ await rerun(); }catch(_){}
  return true;   // 已經換字重搜（重搜的結果自己處理後續，例如相近結果）
};

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

// ── ⑤數字挖空（背誦，v4.68）────────────────────────────────────
//   ⋮ 選單「🔢 數字挖空」：條文裡的期間、金額、年齡、倍數、百分比等數字變成色塊，點一下顯示。
//   只改畫面（包一層 span、不加寬度），不改資料；手寫筆記位置不會跑掉。「第十條」「前二項」這類條號、項次，「同一」「單一」這類詞不遮。
const _N = '[零〇一二兩三四五六七八九十百千萬億0-9０-９]';
const _CZ_RE = new RegExp(
  '(?<![第前後同任單唯統逐])(?:百分之' + _N + '+(?:點' + _N + '+)?|' + _N + '+分之' + _N + '+|'
  + _N + '+(?:[.,，．]' + _N + '+)*(?=(?:個月|個工作日|小時|分鐘|日|天|月|年|週|星期|歲|萬元|億元|千元|元|倍|次|公尺|公里|公分|公斤|公克|毫升|毫克|人|名|張|件|輛|公升|度)))', 'g');
let _cz = false, _czObs = null, _czT = 0;
function _czWrap(root){
  let n = 0;
  root.querySelectorAll('.law-art-body').forEach(body => {
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode: t =>
      t.parentElement.closest('.lp-cz, a, button, textarea, input, .ink-tl, [contenteditable]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while(w.nextNode()) nodes.push(w.currentNode);
    for(const t of nodes){
      const s = t.nodeValue; _CZ_RE.lastIndex = 0;
      if(!_CZ_RE.test(s)) continue;
      _CZ_RE.lastIndex = 0;
      const f = document.createDocumentFragment(); let last = 0, m;
      while((m = _CZ_RE.exec(s))){
        if(m.index > last) f.appendChild(document.createTextNode(s.slice(last, m.index)));
        const sp = document.createElement('span'); sp.className = 'lp-cz'; sp.textContent = m[0];
        f.appendChild(sp); n++; last = m.index + m[0].length;
      }
      if(last < s.length) f.appendChild(document.createTextNode(s.slice(last)));
      t.replaceWith(f);
    }
  });
  return n;
}
function _czUnwrap(){
  document.querySelectorAll('#lbody .lp-cz').forEach(sp => { const p = sp.parentNode; sp.replaceWith(document.createTextNode(sp.textContent)); p?.normalize?.(); });
}
function _czSync(){
  const it = document.getElementById('lp-cz-item');
  if(it) it.textContent = _cz ? '👁 顯示全部數字' : '🔢 數字挖空（背誦）';
  document.getElementById('lbody')?.classList.toggle('lp-cz-on', _cz);
}
window.lpCloze = on => {
  const lb = document.getElementById('lbody'); if(!lb) return;
  _cz = on == null ? !_cz : !!on;
  if(_cz){
    const n = _czWrap(lb);
    // 條文分批載入、編輯後重畫：新出現的條文也遮（自己包 span 引起的變動再掃一次也不會重複包）
    _czObs = _czObs || new MutationObserver(() => { clearTimeout(_czT); _czT = setTimeout(() => { if(_cz) _czWrap(lb); }, 80); });
    _czObs.observe(lb, { childList:true, subtree:true });
    toast(n ? '已遮住 ' + n + ' 個數字，點色塊顯示' : '這部法規畫面上沒有可遮的數字（期間、金額等）');
  }else{
    _czObs?.disconnect(); _czUnwrap();
  }
  _czSync();
};
// 點色塊 → 顯示／再遮
document.addEventListener('click', e => {
  const sp = e.target.closest?.('#lbody.lp-cz-on .lp-cz'); if(!sp) return;
  e.stopPropagation(); e.preventDefault();
  sp.classList.toggle('lp-czs');
}, true);
// 用「本法搜尋」時先關掉挖空（數字被拆開，找「三日」會找不到）；離開法規也關掉
document.addEventListener('focusin', e => { if(_cz && e.target?.id === 'lv-find-q'){ window.lpCloze(false); toast('已關閉數字挖空，方便搜尋'); } });
window.lpOnExit = () => { if(_cz) window.lpCloze(false); };

// 返回鍵：先關對照、心智圖
window.lpBack = () => {
  if(_isOn('lp-diff')){ _close('lp-diff'); return true; }
  if(_isOn('lp-map')){ _close('lp-map'); return true; }
  return false;
};
})();
