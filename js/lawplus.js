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
};

// 返回鍵：先關對照、心智圖
window.lpBack = () => {
  if(_isOn('lp-diff')){ _close('lp-diff'); return true; }
  if(_isOn('lp-map')){ _close('lp-map'); return true; }
  return false;
};
})();
