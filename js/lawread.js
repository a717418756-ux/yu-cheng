// ══ lawread.js — 法規閱讀體驗（v4.66）══════════════════════════════════════
//   參考書庫閱讀器與專業法律資料庫 App（Lawsnote、法源、全國法規資料庫）的做法：
//   ①記住讀到哪一條：資料庫頁「繼續閱讀」大卡、「最近瀏覽」，法規卡片顯示讀到第幾條、百分比；
//     重新打開同一部法規自動回到上次那一條（從搜尋、連結、筆記點進來的照舊定位到指定條文）。
//   ②閱讀進度條。③📑 目錄：編章節＋每一條（條名或開頭幾個字），目前位置標出，可篩選，點一下跳過去。
//   ④Aa 閱讀設定：字級、行距、紙張（預設／白紙／羊皮紙／護眼綠／純黑），這台裝置記住。
//   ⑤條文裡的「第X條」「○○法第X條」可以點：跳出那一條的小視窗（不用離開目前位置）。
//   ⑥每一條 ⧉ 複製：連同出處（法規名＋條號＋條名），貼到筆記、報告直接可用。
//   讀到哪裡存在 settings 的 law_read（隨備份、雲端同步）；閱讀設定存在 localStorage（每台裝置各自）。
(function(){
'use strict';

const _ls = { get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(_){ return d; } },
              set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} } };
const LR = { read:{}, cur:null, loaded:false, saveT:0, scrollT:0 };
const _now = () => Date.now();
const _ago = t => {
  const s = (_now() - t) / 1000;
  if(s < 90) return '剛剛';
  if(s < 3600) return Math.round(s / 60) + ' 分鐘前';
  if(s < 86400) return Math.round(s / 3600) + ' 小時前';
  if(s < 86400 * 30) return Math.round(s / 86400) + ' 天前';
  const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate();
};
const _e = s => (typeof esc === 'function' ? esc(s) : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])));
const _ej = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');

async function _load(){
  if(LR.loaded) return LR.read;
  try{ const v = await getSetting('law_read', null); LR.read = (v && typeof v === 'object') ? v : {}; }catch(_){ LR.read = {}; }
  LR.loaded = true;
  return LR.read;
}
function _save(soon){
  clearTimeout(LR.saveT);
  LR.saveT = setTimeout(() => {
    // 只留最近 60 部
    const ks = Object.keys(LR.read).sort((a, b) => (LR.read[b].at || 0) - (LR.read[a].at || 0));
    ks.slice(60).forEach(k => delete LR.read[k]);
    setSetting('law_read', LR.read).catch?.(() => {});
  }, soon ? 0 : 1500);
}
_load();

// ── 讀到哪一條 ───────────────────────────────────────────────
const _lb = () => document.getElementById('lbody');
const _cards = () => [...(_lb()?.querySelectorAll('.law-art-card') || [])];
function _artLabel(card){
  const h = card.querySelector('.law-art-head > span');
  return (h ? h.textContent : '').trim().slice(0, 40);
}
// 畫面最上面那一條
function _topCard(){
  const lb = _lb(); if(!lb) return null;
  const top = lb.getBoundingClientRect().top + 48;
  const cs = _cards();
  let k = cs.findIndex(c => c.getBoundingClientRect().bottom > top);
  if(k < 0) k = cs.length - 1;
  return k < 0 ? null : { card:cs[k], k, n:cs.length };
}
function _track(){
  const lb = _lb(), name = LR.cur; if(!lb || !name) return;
  const max = lb.scrollHeight - lb.clientHeight;
  const pct = max > 0 ? Math.min(100, Math.max(0, lb.scrollTop / max * 100)) : 100;
  const bar = document.getElementById('lr-prog-i'); if(bar) bar.style.width = pct.toFixed(1) + '%';
  if(LR.full === false) return;   // 搜尋結果只列部分條文：不記
  const t = _topCard(); if(!t) return;
  const id = t.card.dataset.lawId;
  LR.read[name] = { id: /^\d+$/.test(id) ? +id : id, an:+t.card.dataset.an || 0, art:_artLabel(t.card), k:t.k, n:t.n, pct:Math.round(pct), at:_now() };
  _save();
  _tocMark();
}
function _onScroll(){ if(LR.scrollT) return; LR.scrollT = requestAnimationFrame(() => { LR.scrollT = 0; _track(); }); }

// openLawGroup 畫完後呼叫：hasKw＝搜尋結果（只列部分條文）
window.lrOnOpen = async (lawName, hasKw) => {
  await _load();
  const fresh = LR.cur !== lawName || document.getElementById('lv')?.dataset.lrOpen !== '1';
  LR.cur = lawName; LR.full = !hasKw;
  const lv = document.getElementById('lv'); if(lv) lv.dataset.lrOpen = '1';
  _applyPrefs();
  _ensureUi();
  const lb = _lb();
  if(lb && !lb._lrBound){ lb._lrBound = true; lb.addEventListener('scroll', _onScroll, { passive:true }); }
  _linkCites();
  if(fresh && !hasKw){
    const r = LR.read[lawName];
    const card = r && (_cards().find(c => String(c.dataset.lawId) === String(r.id)) || (r.an && _cards().find(c => +c.dataset.an === r.an)));
    if(card && r.k > 0){
      card.scrollIntoView({ block:'start' });
      lb.scrollTop = Math.max(0, lb.scrollTop - 8);
      toast('接續上次：' + (r.art || ''));
    }else if(lb && fresh) lb.scrollTop = 0;
  }
  requestAnimationFrame(_track);
};
window.lrOnExit = () => {
  if(LR.cur && LR.full !== false) _track();
  _save(true);
  const lv = document.getElementById('lv'); if(lv) lv.dataset.lrOpen = '';
  _tocClose(); _setClose();
};
// 資料庫列表：卡片上「讀到哪」那一行
window.lrLine = name => {
  const r = LR.read[name]; if(!r) return '';
  return '<div class="lr-line"><span class="lr-mini"><i style="width:' + (r.pct || 0) + '%"></i></span>讀到 ' + _e(r.art || '') + '・' + _ago(r.at) + '</div>';
};

// ── 資料庫頁上方：繼續閱讀＋最近瀏覽（像書庫）──────────────────────
window.lrHome = async (el) => {
  const box = document.createElement('div'); box.className = 'lr-home';
  el.prepend(box);
  await _load();
  let names = [];
  try{ names = await _db.laws.orderBy('lawName').uniqueKeys(); }catch(_){}
  const have = new Set(names);
  const recent = Object.entries(LR.read).filter(([n]) => have.has(n)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  if(!recent.length){ box.remove(); return; }
  const [n0, r0] = recent[0];
  let cat = 'statute';
  try{ cat = (await _db.laws.where('lawName').equals(n0).first())?.category || 'statute'; }catch(_){}
  const icon = cat === 'sop' ? '📋' : cat === 'supplement' ? '📄' : cat === 'admin' ? '📑' : '⚖';
  box.innerHTML = `<div class="lr-hero" onclick="lrResume('${_ej(n0)}')">
      <div class="lr-hero-ic">${icon}</div>
      <div class="lr-hero-b"><div class="lr-hero-k">繼續閱讀</div>
        <div class="lr-hero-t">${_e(n0)}</div>
        <div class="lr-hero-m">讀到 ${_e(r0.art || '')}　·　${_ago(r0.at)}</div>
        <div class="lr-bar"><i style="width:${r0.pct || 0}%"></i></div></div>
      <div class="lr-hero-go">▶</div></div>
    ${recent.length > 1 ? `<div class="lr-sec">最近瀏覽</div><div class="lr-recent">${recent.slice(1, 9).map(([n, r]) =>
      `<button class="lr-rc" onclick="lrResume('${_ej(n)}')"><b>${_e(n)}</b><span>${_e(r.art || '')}</span><span class="lr-mini"><i style="width:${r.pct || 0}%"></i></span></button>`).join('')}</div>` : ''}`;
};
window.lrResume = name => openLawGroup(name, true);

// ── 介面：進度條、目錄、Aa ────────────────────────────────────
function _ensureUi(){
  const lv = document.getElementById('lv'); if(!lv) return;
  if(!document.getElementById('lr-prog')){
    const p = document.createElement('div'); p.id = 'lr-prog'; p.innerHTML = '<i id="lr-prog-i"></i>';
    const lb = _lb(); lb?.parentNode.insertBefore(p, lb);
  }
}

// 目錄
function _tocItems(){
  const lb = _lb(); if(!lb) return [];
  const out = [];
  lb.querySelectorAll('[id^="ch-"], .law-art-card').forEach(el => {
    if(el.classList.contains('law-art-card')){
      const head = _artLabel(el);
      let sub = '';
      if(!/[—－]/.test(head)){
        const b = el.querySelector('.law-art-body');
        sub = (b ? b.textContent : '').replace(/\s+/g, '').slice(0, 22);
      }
      out.push({ el, t:'a', label:head, sub });
    }else out.push({ el, t:'h', label:el.textContent.trim().replace(/^[編章節]\s*(?=第)/, '').slice(0, 40), lv:parseFloat(el.style.marginLeft) || 0 });   // 去掉前面的「章」小標
  });
  return out;
}
let _toc = [];
window.lrToc = () => {
  if(document.getElementById('lr-toc')?.classList.contains('on')){ _tocClose(); return; }
  _setClose();
  _toc = _tocItems();
  let o = document.getElementById('lr-toc');
  if(!o){
    o = document.createElement('div'); o.id = 'lr-toc';
    o.addEventListener('click', e => { if(e.target === o) _tocClose(); });
    document.body.appendChild(o);
  }
  o.innerHTML = `<div class="lr-toc-p"><div class="lr-toc-hd"><b>📑 目錄</b><span>${_toc.filter(x => x.t === 'a').length} 條</span>
      <button onclick="lrTocClose()" aria-label="關閉">✕</button></div>
    <input type="search" class="lr-toc-q" placeholder="篩選條號、條名、內容" oninput="_lrTocF(this.value)">
    <div class="lr-toc-l">${_toc.map((x, i) => x.t === 'h'
      ? `<div class="lr-toc-h" style="padding-left:${10 + Math.min(24, x.lv)}px" data-i="${i}" onclick="_lrTocGo(${i})">${_e(x.label)}</div>`
      : `<div class="lr-toc-a" data-i="${i}" onclick="_lrTocGo(${i})"><b>${_e(x.label)}</b>${x.sub ? `<span>${_e(x.sub)}</span>` : ''}</div>`).join('')}</div></div>`;
  o.classList.add('on');
  _tocMark(true);
};
function _tocMark(scroll){
  const o = document.getElementById('lr-toc'); if(!o?.classList.contains('on')) return;
  const t = _topCard(); if(!t) return;
  const i = _toc.findIndex(x => x.el === t.card);
  o.querySelectorAll('.lr-toc-a.on').forEach(x => x.classList.remove('on'));
  const it = o.querySelector(`.lr-toc-a[data-i="${i}"]`);
  if(it){ it.classList.add('on'); if(scroll) it.scrollIntoView({ block:'center' }); }
}
window._lrTocGo = i => {
  const x = _toc[i]; if(!x) return;
  _tocClose();
  x.el.scrollIntoView({ block:'start' });
  if(x.t === 'a'){ x.el.classList.remove('lv-flash'); void x.el.offsetWidth; x.el.classList.add('lv-flash'); }
};
window._lrTocF = q => {
  q = q.trim().toLowerCase();
  document.querySelectorAll('#lr-toc .lr-toc-a, #lr-toc .lr-toc-h').forEach(el => {
    const x = _toc[+el.dataset.i];
    el.style.display = !q || (x.t === 'a' && (x.label + x.sub + (x.el.textContent || '')).toLowerCase().includes(q)) ? '' : 'none';
  });
};
function _tocClose(){ document.getElementById('lr-toc')?.classList.remove('on'); }
window.lrTocClose = _tocClose;

// 閱讀設定（每台裝置記住）
const THEMES = [['', '預設'], ['white', '白紙'], ['sepia', '羊皮紙'], ['green', '護眼綠'], ['black', '純黑']];
const LH = [['1.7', '緊湊'], ['1.95', '標準'], ['2.25', '寬鬆']];
function _prefs(){ return Object.assign({ fs:15, lh:'1.95', th:'' }, _ls.get('yc_law_read_pref', {})); }
function _applyPrefs(){
  const lv = document.getElementById('lv'); if(!lv) return;
  const p = _prefs();
  lv.style.setProperty('--lr-fs', p.fs + 'px');
  lv.style.setProperty('--lr-lh', p.lh);
  lv.dataset.lrtheme = p.th || '';
}
window.lrSettings = () => {
  if(document.getElementById('lr-set')?.classList.contains('on')){ _setClose(); return; }
  _tocClose();
  const p = _prefs();
  let o = document.getElementById('lr-set');
  if(!o){
    o = document.createElement('div'); o.id = 'lr-set';
    o.addEventListener('click', e => { if(e.target === o) _setClose(); });
    document.body.appendChild(o);
  }
  o.innerHTML = `<div class="lr-set-p">
    <div class="lr-set-r"><span>字級</span><button onclick="_lrSet('fs',-1)">A−</button><b id="lr-fs-v">${p.fs}</b><button onclick="_lrSet('fs',1)">A＋</button></div>
    <div class="lr-set-r"><span>行距</span>${LH.map(([v, n]) => `<button class="${p.lh === v ? 'on' : ''}" data-lh="${v}" onclick="_lrSet('lh','${v}')">${n}</button>`).join('')}</div>
    <div class="lr-set-r lr-themes"><span>紙張</span>${THEMES.map(([v, n]) => `<button class="lr-th ${p.th === v ? 'on' : ''}" data-th="${v}" onclick="_lrSet('th','${v}')"><i class="lr-sw lr-sw-${v || 'def'}"></i>${n}</button>`).join('')}</div>
    <div class="lr-set-note">手寫筆記是照目前版面畫的，改字級、行距後位置可能略偏</div>
  </div>`;
  o.classList.add('on');
};
window._lrSet = (k, v) => {
  const p = _prefs();
  if(k === 'fs') p.fs = Math.max(12, Math.min(24, p.fs + v));
  else p[k] = v;
  _ls.set('yc_law_read_pref', p);
  _applyPrefs();
  const o = document.getElementById('lr-set'); if(!o) return;
  const fv = o.querySelector('#lr-fs-v'); if(fv) fv.textContent = p.fs;
  o.querySelectorAll('[data-lh]').forEach(b => b.classList.toggle('on', b.dataset.lh === p.lh));
  o.querySelectorAll('[data-th]').forEach(b => b.classList.toggle('on', b.dataset.th === p.th));
};
function _setClose(){ document.getElementById('lr-set')?.classList.remove('on'); }

// ── 條文裡的「第X條」可以點（引用條文預覽）────────────────────────
const ART = /第([一二三四五六七八九十百千\d]+)([條點])(?:之([一二三四五六七八九十\d]+))?/g;
const LAWLIKE = /[\u4e00-\u9fa5]{1,20}(?:法|條例|規則|辦法|細則|要點|準則|規程|標準|章程|公約|通則)$/;
const SELF = /(?:本|該)(?:法|條例|規則|辦法|細則|要點|準則|規程|標準|通則)$|(?:依|依據|依照|準用|適用|違反|於|及|或|與|、|，|。|；|：|「|（|\(|^)$/;
let _names = null, _namesAt = 0;
async function _lawNames(){
  if(_names && _now() - _namesAt < 30000) return _names;
  try{ _names = (await _db.laws.orderBy('lawName').uniqueKeys()).filter(Boolean).sort((a, b) => b.length - a.length); }catch(_){ _names = []; }
  _namesAt = _now();
  return _names;
}
async function _linkCites(){
  const lb = _lb(), cur = LR.cur; if(!lb || !cur) return;
  const names = await _lawNames();
  lb.querySelectorAll('.law-art-body').forEach(body => {
    if(body.dataset.lrLinked === '1') return;
    body.dataset.lrLinked = '1';
    const myAn = +body.closest('.law-art-card')?.dataset.an || 0;
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement?.closest('svg,details,script,style,a,button,.lv-cite,.ln-x,figure,table') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; for(let n; (n = w.nextNode());) if(/第[一二三四五六七八九十百千\d]+[條點]/.test(n.nodeValue)) nodes.push(n);
    for(const node of nodes){
      const text = node.nodeValue; let last = 0; const frag = document.createDocumentFragment(); let any = false;
      for(const m of text.matchAll(ART)){
        let before = text.slice(Math.max(0, m.index - 40), m.index), prev;
        do{ prev = before; before = before.replace(/[（(][^）)]*[）)]\s*$/, ''); }while(before !== prev);
        let law = names.find(n => before.endsWith(n));
        if(!law){
          if(LAWLIKE.test(before) && !SELF.test(before)) continue;   // 別部法規、資料庫沒有 → 不連
          law = cur;
        }
        const ref = law + m[0];
        if(law === cur && typeof art2n === 'function' && art2n(m[0]) === myAn) continue;   // 自己這一條
        frag.append(text.slice(last, m.index));
        const a = document.createElement('span'); a.className = 'lv-cite'; a.dataset.ref = ref; a.textContent = m[0];
        frag.append(a); last = m.index + m[0].length; any = true;
      }
      if(!any) continue;
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  });
}
document.addEventListener('click', e => {
  const c = e.target.closest?.('#lbody .lv-cite'); if(!c) return;
  if(getSelection && !getSelection().isCollapsed) return;
  e.preventDefault(); e.stopPropagation();
  if(typeof showLawPop === 'function') showLawPop(c.dataset.ref);
}, true);
// #lbody 重畫（編輯存檔、切換模式）後補上連結
function _watch(){
  const lb = _lb(); if(!lb || lb._lrObs) return;
  lb._lrObs = new MutationObserver(() => { clearTimeout(lb._lrT); lb._lrT = setTimeout(() => { if(LR.cur) _linkCites(); }, 80); });
  lb._lrObs.observe(lb, { childList:true });
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _watch); else _watch();

// ── ⧉ 複製條文（含出處）──────────────────────────────────────
window.lrCopy = async id => {
  const l = await _db.laws.get(id); if(!l) return;
  const body = String(l.content || '').startsWith('data:') ? '（圖片）'
    : String(l.content || '').split('\n').filter(ln => !/^!\[[^\]]*\]\(/.test(ln.trim())).join('\n').trim();
  const head = (l.lawName || '') + (l.article || '') + (l.title ? '（' + l.title + '）' : '');
  const txt = head + '\n' + body;
  try{ await navigator.clipboard.writeText(txt); toast('已複製：' + head); }
  catch(_){
    const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); toast('已複製：' + head); }catch(__){ toast('複製失敗'); }
    ta.remove();
  }
};

// 返回鍵：先關目錄、設定
window.lrBack = () => {
  if(document.getElementById('lr-toc')?.classList.contains('on')){ _tocClose(); return true; }
  if(document.getElementById('lr-set')?.classList.contains('on')){ _setClose(); return true; }
  return false;
};
})();
