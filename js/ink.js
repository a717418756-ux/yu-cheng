// ══ ink.js — 手寫標註引擎（答題標註、法規資料庫共用；v4.65）══════════════════════
//   參考手機相簿「編輯 → 畫筆／文字」與筆記 App 的做法：
//   筆、直線、螢光筆、橡皮擦、文字（打字）；復原／重做；工具列可收合；
//   文字方塊：點一下就地打字，可改顏色、大小、樣式（純文字／白底／色底），拖曳移動，點一下再改或刪除。
//   有手寫筆（S Pen 等）時：筆畫圖、手指捲動（防手掌誤觸）；法規卡片可兩指捲動。
//   資料：筆跡存成透明 PNG（img），文字另存成可再編輯的物件陣列（txt：[{id,x,y,t,c,s,st}]，座標為畫布座標）。
(function(){
'use strict';

const COLORS = ['#ff5a5a', '#ffd54a', '#4ade80', '#6ea8fe', '#111111', '#ffffff'];
const CNAME  = { '#ff5a5a':'紅', '#ffd54a':'黃', '#4ade80':'綠', '#6ea8fe':'藍', '#111111':'黑', '#ffffff':'白' };
const SIZES  = [1.6, 2.6, 4.5];
const TSIZE  = { s:22, m:30, l:42 };            // 文字大小（畫布寬 800 時的字級）
const TOOLS  = [['pen', '✎ 筆'], ['line', '╱ 直線'], ['marker', '▭ 螢光'], ['eraser', '⌫ 橡皮'], ['text', 'T 文字']];
const LS = 'yc_ink_pref';
const pref = Object.assign({ c:'#ff5a5a', w:2.6, tool:'pen', ts:'m', tst:'plain', mini:false },
  (() => { try{ return JSON.parse(localStorage.getItem(LS) || '{}') || {}; }catch(_){ return {}; } })());
if(!TOOLS.some(t => t[0] === pref.tool)) pref.tool = 'pen';
const savePref = () => { try{ localStorage.setItem(LS, JSON.stringify(pref)); }catch(_){} };
const _esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const _newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const _toast = m => { try{ (window.toast || (() => {}))(m); }catch(_){} };
let penSeen = false;     // 這台裝置用過手寫筆 → 手指改成捲動
let cur = null;          // 目前開著的畫板

// ── 文字方塊（畫板與唯讀顯示共用）────────────────────────────────
function _lum(hex){
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if(!m) return 0.5;
  const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function _tStyle(el, t, W, H){
  el.dataset.st = t.st || 'plain';
  el.style.left = (t.x / W * 100) + '%';
  el.style.top  = (t.y / H * 100) + '%';
  el.style.maxWidth = Math.max(8, (W - t.x) / W * 100) + '%';
  el.style.setProperty('--s', t.s || TSIZE.m);
  el.style.setProperty('--ic', t.c || '#ff5a5a');
  const light = _lum(t.c) > 0.6;
  el.style.setProperty('--halo', light ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.9)');
  el.style.setProperty('--on', light ? '#111' : '#fff');      // 色底上的字色
  el.style.setProperty('--boxc', light ? '#111' : (t.c || '#111')); // 白底上的字色（白字改黑）
  el.textContent = t.t;
}
function _tEl(t, W, H){
  const el = document.createElement('div');
  el.className = 'ink-t'; el.dataset.id = t.id;
  _tStyle(el, t, W, H);
  return el;
}
// 字級隨版面寬度縮放：--k = 每 1 畫布單位是幾 px
const _ro = typeof ResizeObserver === 'function' ? new ResizeObserver(es => {
  for(const e of es){ const el = e.target, W = +el.dataset.w || 800; el.style.setProperty('--k', (el.clientWidth / W) || 0.5); }
}) : null;
function _layer(W, H, stretch){
  const tl = document.createElement('div');
  tl.className = 'ink-tl' + (stretch ? ' ink-st' : '');
  tl.dataset.w = W;
  if(!stretch) tl.style.aspectRatio = W + ' / ' + H;
  if(_ro) _ro.observe(tl);
  requestAnimationFrame(() => tl.style.setProperty('--k', (tl.clientWidth / W) || 0.5));
  return tl;
}

// ── 唯讀顯示（法規卡片平常看到的筆記）──────────────────────────
//   data：{ img, w, h, txt }。寬度跟卡片一樣，高度照存檔時的比例
function view(data){
  const W = data.w || 800, H = data.h || 1200;
  const box = document.createElement('div');
  box.className = 'ink-view';
  box.style.aspectRatio = W + ' / ' + H;
  if(data.img){ const im = new Image(); im.className = 'ink-vimg'; im.alt = ''; im.src = data.img; box.appendChild(im); }
  if(data.txt?.length){
    const tl = _layer(W, H, false);
    data.txt.forEach(t => tl.appendChild(_tEl(t, W, H)));
    box.appendChild(tl);
  }
  return box;
}

// ── 畫板 ──────────────────────────────────────────────────────
//   host：要疊上去的容器（需 position:relative）
//   o.canvas：沿用既有 canvas（答題畫面）；o.stretch：畫布拉滿容器（答題畫面的舊格式 800×1200）
//   o.W／o.H：畫布解析度；o.pan：可兩指（或有筆時一指）捲動；o.barBottom：工具列離底部的距離
//   o.onDone：按「✓ 完成」或返回鍵
class Board{
  constructor(host, o){
    this.host = host; this.o = o || {};
    this.W = o.W || 800; this.H = o.H || 1200;
    this.cv = o.canvas || document.createElement('canvas');
    if(!o.canvas){ this.cv.className = 'ink-cv'; host.appendChild(this.cv); }
    this.cv.width = this.W; this.cv.height = this.H;
    if(!o.stretch) this.cv.style.aspectRatio = this.W + ' / ' + this.H;
    this.ctx = this.cv.getContext('2d');
    this.tl = _layer(this.W, this.H, !!o.stretch);
    host.appendChild(this.tl);
    this.txt = []; this.und = []; this.red = []; this.dirty = false; this.active = false;
    // 復原紀錄最多佔用約 48MB（大畫布自動少存幾步）
    this.maxUndo = Math.max(4, Math.min(30, Math.floor(48e6 / (this.W * this.H * 4) * 3)));
    this._bind();
  }
  // 載入既有內容（不記入復原）
  load(data){
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.txt = (data?.txt || []).map(t => Object.assign({}, t));
    this.und = []; this.red = []; this.dirty = false;
    // 存檔時的寬度和現在不同（換裝置／畫布縮小）→ 等比例換算
    const k = data?.w ? this.W / data.w : 1;
    if(k !== 1) this.txt.forEach(t => { t.x *= k; t.y *= k; t.s = (t.s || TSIZE.m) * k; });
    this._renderTxt();
    if(!data?.img) return Promise.resolve();
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        try{
          if(this.o.stretch) this.ctx.drawImage(im, 0, 0, this.W, this.H);
          else this.ctx.drawImage(im, 0, 0, this.W, im.height * (this.W / im.width));
        }catch(_){}
        res();
      };
      im.onerror = () => res();
      im.src = data.img;
    });
  }
  reset(){ this.load(null); }
  isBlank(){
    try{
      const d = this.ctx.getImageData(0, 0, this.W, this.H).data;
      for(let i = 3; i < d.length; i += 4) if(d[i] !== 0) return false;
      return true;
    }catch(_){ return false; }
  }
  // 匯出：{ img:PNG 或 null, txt:陣列或 null, w, h }
  export(){
    const img = this.isBlank() ? null : this.cv.toDataURL('image/png');
    const txt = this.txt.filter(t => t.t && t.t.trim()).map(t => ({ id:t.id, x:Math.round(t.x), y:Math.round(t.y), t:t.t, c:t.c, s:Math.round(t.s), st:t.st }));
    return { img, txt: txt.length ? txt : null, w:this.W, h:this.H };
  }
  start(){
    if(cur && cur !== this) cur._finish();
    cur = this; this.active = true;
    this.cv.classList.add('on'); this.tl.classList.add('on');
    this.host.classList.add('ink-editing');
    _bar(this); this._cursor();
  }
  stop(){
    _teClose(false);
    this.active = false;
    this.cv.classList.remove('on'); this.tl.classList.remove('on');
    this.host.classList.remove('ink-editing');
    if(cur === this){ cur = null; _barHide(); }
  }
  _finish(){ _teClose(true); if(this.o.onDone) this.o.onDone(); else this.stop(); }
  destroy(){
    this.stop();
    if(_ro) _ro.unobserve(this.tl);
    this.tl.remove(); this._tmp?.remove();
    if(!this.o.canvas) this.cv.remove();
  }
  show(on){ this.cv.style.display = on ? '' : 'none'; this.tl.style.display = on ? '' : 'none'; }
  _cursor(){ this.cv.dataset.tool = pref.tool; }

  // ── 復原／重做：只存變動區域（大畫布也不吃記憶體）──
  _snap(r, withTxt){
    const e = {};
    if(r){
      const x = Math.max(0, Math.floor(r[0])), y = Math.max(0, Math.floor(r[1]));
      const w = Math.min(this.W - x, Math.ceil(r[2])), h = Math.min(this.H - y, Math.ceil(r[3]));
      if(w > 0 && h > 0){ try{ e.r = [x, y, w, h]; e.d = this.ctx.getImageData(x, y, w, h); }catch(_){ delete e.r; } }
    }
    if(withTxt) e.t = JSON.stringify(this.txt);
    return e;
  }
  _push(e){
    this.und.push(e); this.red = [];
    if(this.und.length > this.maxUndo) this.und.shift();
    this.dirty = true; _barState();
  }
  _swap(from, to){
    const e = from.pop(); if(!e) return false;
    to.push(this._snap(e.r, e.t != null));
    if(e.r) this.ctx.putImageData(e.d, e.r[0], e.r[1]);
    if(e.t != null){ this.txt = JSON.parse(e.t); this._renderTxt(); }
    this.dirty = true; _barState();
    return true;
  }
  undo(){ if(!this._swap(this.und, this.red)) _toast('沒有可復原的步驟'); }
  redo(){ if(!this._swap(this.red, this.und)) _toast('沒有可重做的步驟'); }
  clearAll(){
    if(this.isBlank() && !this.txt.length){ _toast('已經是空白的'); return; }
    this._push(this._snap([0, 0, this.W, this.H], true));
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.txt = []; this._renderTxt();
    _toast('已清除（可按復原）');
  }

  // ── 文字 ──
  _renderTxt(){
    this.tl.querySelectorAll('.ink-t').forEach(x => x.remove());
    for(const t of this.txt) this.tl.appendChild(_tEl(t, this.W, this.H));
  }
  _tUpdate(t){
    const el = this.tl.querySelector(`.ink-t[data-id="${t.id}"]`);
    if(el) _tStyle(el, t, this.W, this.H); else this.tl.appendChild(_tEl(t, this.W, this.H));
  }
  _tRemove(id){ this.txt = this.txt.filter(t => t.id !== id); this.tl.querySelector(`.ink-t[data-id="${id}"]`)?.remove(); }

  // ── 繪圖 ──
  _tmpCv(){
    if(!this._tmp){
      const t = document.createElement('canvas');
      t.className = 'ink-tmp' + (this.o.stretch ? ' ink-st' : '');
      if(!this.o.stretch) t.style.aspectRatio = this.W + ' / ' + this.H;
      this.cv.after(t);
      this._tmp = t;
    }
    const t = this._tmp;
    if(t.width !== this.W || t.height !== this.H){ t.width = this.W; t.height = this.H; }
    return t;
  }
  _bind(){
    const cv = this.cv, pts = new Map();
    let st = null;   // 目前一筆：{ pid, tool, path:[], w, color, bb }
    let pan = null;  // 捲動中：{ y, x }
    const pos = e => {
      const r = cv.getBoundingClientRect();
      return { x:(e.clientX - r.left) * (this.W / r.width), y:(e.clientY - r.top) * (this.H / r.height) };
    };
    const scroller = () => {
      let el = this.host.parentElement;
      while(el && el !== document.body){
        const s = getComputedStyle(el);
        if(/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el;
        el = el.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };
    const avg = () => { let x = 0, y = 0; for(const p of pts.values()){ x += p.x; y += p.y; } return { x:x / pts.size, y:y / pts.size }; };
    const scale = () => this.W / (cv.getBoundingClientRect().width || this.W);
    const widthFor = tool => {
      const k = this.o.stretch ? 1 : this.W / 800;      // 法規畫布寬度不是 800 時，筆粗跟著換算
      if(tool === 'marker') return pref.w * 4 * k;
      if(tool === 'eraser') return Math.max(14, pref.w * 7) * k;
      return pref.w * k;
    };
    const drawPath = (ctx, s) => {
      const p = s.path;
      ctx.lineCap = s.tool === 'marker' ? 'butt' : 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = s.w; ctx.strokeStyle = s.tool === 'eraser' ? '#888' : s.color;
      ctx.beginPath();
      if(s.tool === 'line'){ ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y); }
      else if(p.length < 3){ ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[p.length - 1].x + 0.01, p[p.length - 1].y); }
      else{
        // 平滑：經過相鄰兩點中點的二次曲線（手繪字更順）
        ctx.moveTo(p[0].x, p[0].y);
        for(let i = 1; i < p.length - 1; i++){
          const mx = (p[i].x + p[i + 1].x) / 2, my = (p[i].y + p[i + 1].y) / 2;
          ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my);
        }
        ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
      }
      ctx.stroke();
    };
    const preview = () => {
      const t = this._tmpCv(), c = t.getContext('2d');
      c.clearRect(0, 0, t.width, t.height);
      t.style.opacity = st.tool === 'marker' ? '0.35' : st.tool === 'eraser' ? '0.45' : '1';
      drawPath(c, st);
    };
    const commit = () => {
      const s = st; st = null;
      const t = this._tmp; if(t) t.getContext('2d').clearRect(0, 0, t.width, t.height);
      if(!s || !s.path.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for(const p of (s.tool === 'line' ? [s.path[0], s.path[s.path.length - 1]] : s.path)){
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      const m = s.w + 4;
      this._push(this._snap([x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m], false));
      const ctx = this.ctx;
      ctx.save();
      if(s.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
      if(s.tool === 'marker') ctx.globalAlpha = 0.35;
      drawPath(ctx, Object.assign({}, s, { color: s.tool === 'eraser' ? '#000' : s.color }));
      ctx.restore();
    };
    const cancel = () => { st = null; const t = this._tmp; if(t) t.getContext('2d').clearRect(0, 0, t.width, t.height); };

    cv.addEventListener('pointerdown', e => {
      if(!this.active) return;
      e.preventDefault();
      if(e.pointerType === 'pen') penSeen = true;
      try{ cv.setPointerCapture(e.pointerId); }catch(_){}
      pts.set(e.pointerId, { x:e.clientX, y:e.clientY });
      // 有筆時手指只捲動；兩指一律捲動（法規卡片）
      const fingerPan = this.o.pan && e.pointerType === 'touch' && (penSeen || pts.size >= 2);
      if(fingerPan || (pts.size >= 2 && this.o.pan)){
        if(st) cancel();
        pan = avg(); return;
      }
      if(pts.size > 1) return;
      if(pref.tool === 'text'){ st = { pid:e.pointerId, tool:'text', at:pos(e) }; return; }
      st = { pid:e.pointerId, tool:pref.tool, path:[pos(e)], w:widthFor(pref.tool), color:pref.c };
      preview();
    });
    cv.addEventListener('pointermove', e => {
      if(!this.active || !pts.has(e.pointerId)) return;
      e.preventDefault();
      pts.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if(pan){
        const a = avg(), sc = scroller();
        sc.scrollBy(0, pan.y - a.y);
        pan = a; return;
      }
      if(!st || st.pid !== e.pointerId || st.tool === 'text') return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for(const ev of (evs.length ? evs : [e])) st.path.push(pos(ev));
      preview();
    });
    const up = e => {
      if(!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if(pan){ if(!pts.size) pan = null; return; }
      if(!st || st.pid !== e.pointerId) return;
      if(st.tool === 'text'){ const at = st.at; st = null; if(e.type === 'pointerup') _teOpen(this, null, at); return; }
      if(e.type === 'pointercancel'){ cancel(); return; }
      commit();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('lostpointercapture', e => { if(pts.has(e.pointerId)) up({ pointerId:e.pointerId, type:'pointerup' }); });

    // 文字方塊：拖曳移動、點一下編輯
    let drag = null;
    this.tl.addEventListener('pointerdown', e => {
      const el = e.target.closest('.ink-t');
      if(!this.active || !el) return;
      e.preventDefault(); e.stopPropagation();
      const t = this.txt.find(x => x.id === el.dataset.id); if(!t) return;
      try{ el.setPointerCapture(e.pointerId); }catch(_){}
      drag = { el, t, sx:e.clientX, sy:e.clientY, ox:t.x, oy:t.y, moved:false, before:JSON.stringify(this.txt) };
    });
    this.tl.addEventListener('pointermove', e => {
      if(!drag) return;
      e.preventDefault();
      const r = this.tl.getBoundingClientRect();
      const dx = (e.clientX - drag.sx) * (this.W / r.width), dy = (e.clientY - drag.sy) * (this.H / r.height);
      if(!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      drag.moved = true; drag.el.classList.add('drag');
      drag.t.x = Math.max(0, Math.min(this.W - 20, drag.ox + dx));
      drag.t.y = Math.max(0, Math.min(this.H - 10, drag.oy + dy));
      _tStyle(drag.el, drag.t, this.W, this.H);
    });
    const tup = () => {
      if(!drag) return;
      const d = drag; drag = null; d.el.classList.remove('drag');
      if(d.moved){ this.und.push({ t:d.before }); this.red = []; if(this.und.length > this.maxUndo) this.und.shift(); this.dirty = true; _barState(); }
      else _teOpen(this, d.t, null);
    };
    this.tl.addEventListener('pointerup', tup);
    this.tl.addEventListener('pointercancel', tup);
  }
}

// ── 工具列（螢幕下方，所有畫板共用一個）────────────────────────────
function _barEl(){
  let b = document.getElementById('ink-bar');
  if(!b){
    b = document.createElement('div'); b.id = 'ink-bar';
    b.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(b);
  }
  return b;
}
function _bar(board){
  const b = _barEl();
  b.style.bottom = `calc(${board.o.barBottom ?? 14}px + env(safe-area-inset-bottom, 0px))`;
  const custom = !COLORS.includes(pref.c);
  b.innerHTML = `
    <div class="ink-full">
      <div class="ink-row">
        <div class="ink-cs">${COLORS.map(c => `<button class="ink-c${pref.c === c ? ' on' : ''}" style="--c:${c}" data-c="${c}" onclick="YCInk._c('${c}')" aria-label="${CNAME[c]}"></button>`).join('')}
          <input type="color" class="ink-c ink-cc${custom ? ' on' : ''}" value="${custom ? pref.c : '#ff8c00'}" oninput="YCInk._c(this.value,1)" aria-label="自訂顏色" title="自訂顏色"></div>
        <div class="ink-ss">${SIZES.map((w, i) => `<button class="ink-s${pref.w === w ? ' on' : ''}" data-w="${w}" onclick="YCInk._w(${w})" aria-label="${['細', '中', '粗'][i]}"><i style="height:${[2, 4, 7][i]}px"></i></button>`).join('')}</div>
      </div>
      <div class="ink-row ink-tools">${TOOLS.map(([k, n]) => `<button class="ink-b ink-tool${pref.tool === k ? ' on' : ''}" data-t="${k}" onclick="YCInk._t('${k}')">${n}</button>`).join('')}</div>
      <div class="ink-row">
        <button class="ink-b" id="ink-und" onclick="YCInk._undo()">↶ 復原</button>
        <button class="ink-b" id="ink-red" onclick="YCInk._redo()">↷ 重做</button>
        <button class="ink-b" onclick="YCInk._clear()">清除</button>
        <button class="ink-b" onclick="YCInk._mini(1)" aria-label="收起工具列" title="收起工具列">▾</button>
        <button class="ink-b ink-done" onclick="YCInk._done()">✓ 完成</button>
      </div>
      <div class="ink-tip" id="ink-tip"></div>
    </div>
    <div class="ink-mini">
      <span class="ink-dot" style="--c:${pref.c}"></span><span class="ink-mname"></span>
      <button class="ink-b" onclick="YCInk._undo()" aria-label="復原">↶</button>
      <button class="ink-b" onclick="YCInk._mini(0)">▴ 工具</button>
      <button class="ink-b ink-done" onclick="YCInk._done()">✓ 完成</button>
    </div>`;
  b.classList.toggle('mini', !!pref.mini);
  b.classList.add('on');
  _barState();
}
function _barHide(){ document.getElementById('ink-bar')?.classList.remove('on'); }
function _barState(){
  const b = document.getElementById('ink-bar'); if(!b || !cur) return;
  b.querySelector('#ink-und')?.classList.toggle('dim', !cur.und.length);
  b.querySelector('#ink-red')?.classList.toggle('dim', !cur.red.length);
  const tip = b.querySelector('#ink-tip');
  if(tip) tip.textContent = pref.tool === 'text' ? '點一下要放文字的地方；文字可拖曳移動，點一下修改'
    : (cur.o.pan ? (penSeen ? '手寫筆畫圖、手指捲動' : '兩指可上下捲動') : '');
  const mn = b.querySelector('.ink-mname'); if(mn) mn.textContent = (TOOLS.find(t => t[0] === pref.tool) || ['', ''])[1];
  const md = b.querySelector('.ink-mini .ink-dot'); if(md) md.style.setProperty('--c', pref.c);
}
const api = {
  _c(c, custom){
    pref.c = c; savePref();
    document.querySelectorAll('#ink-bar .ink-c').forEach(x => x.classList.toggle('on', custom ? x.classList.contains('ink-cc') : x.dataset.c === c));
    if(pref.tool === 'eraser') api._t('pen');
    _barState();
  },
  _w(w){ pref.w = w; savePref(); document.querySelectorAll('#ink-bar .ink-s').forEach(x => x.classList.toggle('on', +x.dataset.w === w)); },
  _t(t){ pref.tool = t; savePref(); document.querySelectorAll('#ink-bar .ink-tool').forEach(x => x.classList.toggle('on', x.dataset.t === t)); cur?._cursor(); _barState();
    if(t === 'text') _toast('點一下要放文字的地方'); },
  _undo(){ cur?.undo(); }, _redo(){ cur?.redo(); }, _clear(){ cur?.clearAll(); },
  _mini(on){ pref.mini = !!on; savePref(); document.getElementById('ink-bar')?.classList.toggle('mini', !!on); },
  _done(){ cur?._finish(); },
};

// ── 文字編輯框（螢幕上方，鍵盤擋不到）────────────────────────────
let te = null;   // { board, t:編輯中的文字物件, isNew, before }
function _teEl(){
  let o = document.getElementById('ink-te');
  if(!o){
    o = document.createElement('div'); o.id = 'ink-te';
    o.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(o);
  }
  return o;
}
function _teOpen(board, t, at){
  _teClose(true);
  const isNew = !t;
  const before = JSON.stringify(board.txt);
  if(isNew){
    t = { id:_newId(), x:at.x, y:Math.max(0, at.y - (TSIZE[pref.ts] || 30) * (board.o.stretch ? 1 : board.W / 800) * 0.7),
      t:'', c:pref.c, s:(TSIZE[pref.ts] || 30) * (board.o.stretch ? 1 : board.W / 800), st:pref.tst };
    board.txt.push(t);
  }
  te = { board, t, isNew, before, orig:Object.assign({}, t) };
  const k = board.o.stretch ? 1 : board.W / 800;
  const sizeKey = Object.keys(TSIZE).reduce((a, b) => Math.abs(TSIZE[b] * k - t.s) < Math.abs(TSIZE[a] * k - t.s) ? b : a, 'm');
  const o = _teEl();
  o.innerHTML = `
    <textarea id="ink-te-ta" rows="3" placeholder="輸入文字（可換行）">${_esc(t.t)}</textarea>
    <div class="ink-row ink-te-cs">${COLORS.map(c => `<button class="ink-c${t.c === c ? ' on' : ''}" style="--c:${c}" data-c="${c}" onclick="YCInk._tc('${c}')" aria-label="${CNAME[c]}"></button>`).join('')}
      <input type="color" class="ink-c ink-cc${COLORS.includes(t.c) ? '' : ' on'}" value="${COLORS.includes(t.c) ? '#ff8c00' : t.c}" oninput="YCInk._tc(this.value,1)" aria-label="自訂顏色"></div>
    <div class="ink-row">
      <div class="ink-seg">${[['s', '小'], ['m', '中'], ['l', '大']].map(([k2, n]) => `<button class="ink-b${sizeKey === k2 ? ' on' : ''}" data-s="${k2}" onclick="YCInk._ts('${k2}')">${n}</button>`).join('')}</div>
      <div class="ink-seg">${[['plain', '文字'], ['box', '白底'], ['fill', '色底']].map(([k2, n]) => `<button class="ink-b${(t.st || 'plain') === k2 ? ' on' : ''}" data-st="${k2}" onclick="YCInk._tst('${k2}')">${n}</button>`).join('')}</div>
    </div>
    <div class="ink-row">
      ${isNew ? '' : '<button class="ink-b ink-del" onclick="YCInk._tdel()">🗑 刪除</button>'}
      <button class="ink-b" onclick="YCInk._tcancel()">取消</button>
      <button class="ink-b ink-done" onclick="YCInk._tok()">✓ 好了</button>
    </div>`;
  o.classList.add('on');
  board.tl.querySelector(`.ink-t[data-id="${t.id}"]`)?.classList.add('editing');
  board._tUpdate(t);
  const ta = o.querySelector('#ink-te-ta');
  ta.addEventListener('input', () => { t.t = ta.value; board._tUpdate(t); board.tl.querySelector(`.ink-t[data-id="${t.id}"]`)?.classList.add('editing'); });
  // 要在點擊當下 focus，手機才會跳出鍵盤
  const focus = () => { try{ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }catch(_){} };
  focus(); setTimeout(focus, 30);
  document.getElementById('ink-bar')?.classList.add('te-hide');
  _tePos();
}
// 編輯框貼在鍵盤上方（看得到上面正在打的字）；沒有鍵盤時在畫面下方
function _tePos(){
  const o = document.getElementById('ink-te'); if(!o || !o.classList.contains('on')) return;
  const vv = window.visualViewport, h = o.offsetHeight || 220;
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  o.style.top = Math.max(8, bottom - h - 8) + 'px';
}
if(window.visualViewport){ visualViewport.addEventListener('resize', _tePos); visualViewport.addEventListener('scroll', _tePos); }
// commit=true：保留目前內容（按「好了」或切到別處）；false：取消
function _teClose(commit){
  if(!te) return;
  const { board, t, isNew, before, orig } = te; te = null;
  document.getElementById('ink-te')?.classList.remove('on');
  document.getElementById('ink-bar')?.classList.remove('te-hide');
  try{ document.activeElement?.blur?.(); }catch(_){}
  board.tl.querySelectorAll('.ink-t.editing').forEach(x => x.classList.remove('editing'));
  if(!commit){
    if(isNew) board._tRemove(t.id);
    else{ Object.assign(t, orig); board._tUpdate(t); }
    return;
  }
  if(!t.t.trim()){ board._tRemove(t.id); if(isNew) return; }
  else board._tUpdate(t);
  if(JSON.stringify(board.txt) !== before){ board.und.push({ t:before }); board.red = []; if(board.und.length > board.maxUndo) board.und.shift(); board.dirty = true; _barState(); }
}
Object.assign(api, {
  _tc(c, custom){
    if(!te) return;
    te.t.c = c; te.board._tUpdate(te.t);
    document.querySelectorAll('#ink-te .ink-c').forEach(x => x.classList.toggle('on', custom ? x.classList.contains('ink-cc') : x.dataset.c === c));
    pref.c = c; savePref(); if(pref.tool === 'eraser') pref.tool = 'text';
  },
  _ts(k){
    if(!te) return;
    const kk = te.board.o.stretch ? 1 : te.board.W / 800;
    te.t.s = TSIZE[k] * kk; pref.ts = k; savePref(); te.board._tUpdate(te.t);
    document.querySelectorAll('#ink-te [data-s]').forEach(x => x.classList.toggle('on', x.dataset.s === k));
  },
  _tst(k){
    if(!te) return;
    te.t.st = k; pref.tst = k; savePref(); te.board._tUpdate(te.t);
    document.querySelectorAll('#ink-te [data-st]').forEach(x => x.classList.toggle('on', x.dataset.st === k));
  },
  _tok(){ _teClose(true); },
  _tcancel(){ _teClose(false); },
  _tdel(){ if(!te) return; te.t.t = ''; _teClose(true); },
});

// 返回鍵：先關文字框、再結束標註（app.js 的返回處理會先問這裡）
function back(){
  if(te){ _teClose(false); return true; }
  if(cur){ cur._finish(); return true; }
  return false;
}
Object.assign(api, { Board, view, back, TSIZE });
Object.defineProperty(api, 'active', { get: () => cur });   // 目前開著的畫板（給偵錯、其他模組查詢）
window.YCInk = api;
})();
