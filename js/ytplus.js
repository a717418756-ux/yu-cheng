// ══ ytplus.js — YouTube 播放器的讀書輔助（v4.71）══════════════════════════════════
//   參考 RiMusic、Spotube、ncspot 的操作方式（只看做法，程式自己寫；RiMusic 是 GPL、Spotube 是 BSD-4，沒有用它們的程式碼）：
//   ①⏾ 睡眠定時：15／30／45／60／90 分鐘，或「這部播完」就停。App 由原生播放器計時（關螢幕也準），網頁版由網頁計時。
//   ②A-B 段落重複：按一下記 A、再按一下記 B，就在 A～B 之間一直重複（背法條、聽英文）；換下一部自動取消。
//   ③☰ 待播清單：看接下來播什麼，↑↓ 調整順序、「下一個播」、✕ 移除（目前這部不動）。
//   ④App 限定：🔇 跳過靜音（講課停頓自動跳過）、🔊 音量平均（小聲的影片拉大聲，大聲的有限幅不會爆音）。
//   ⑤鍵盤（電腦、平板接鍵盤）：空白／K 播放暫停、←→ 倒退快轉 10 秒、Shift+N／P 下一部上一部、
//     Shift+< > 調速度、A／B 設 A-B 段落、Esc 照返回鍵。
(function(){
'use strict';

const _ls = { get(k, d){ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(_){ return d; } },
              set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} } };
const PREF_K = 'yt_play_prefs';
const pref = Object.assign({ skipSilence:false, level:false }, _ls.get(PREF_K, {}) || {});
const YP = { sleepAt:0, stopAfter:false, a:-1, b:-1, t:0, npLeft:0 };
const NP = () => (typeof _ytNP === 'function' ? _ytNP() : null);
const isNP = () => !!(_YT.player && _YT.player.np);
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const cur = () => { try{ return _YT.player ? (_YT.player.getCurrentTime() || 0) : 0; }catch(_){ return 0; } };

// youtube.js 開播放器時帶給原生端
window._ypNative = () => ({ skipSilence:!!pref.skipSilence, level:!!pref.level });

// ── 網頁版（官方播放器、<video>）的計時：睡眠定時與 A-B 由這裡檢查 ──────────────
function _tick(){
  clearInterval(YP.t); YP.t = 0;
  if(isNP() || !document.getElementById('yt-player-ov')) return;
  if(!YP.sleepAt && !(YP.a >= 0 && YP.b > YP.a)) return;
  YP.t = setInterval(() => {
    if(!_YT.player || isNP() || !document.getElementById('yt-player-ov')){ clearInterval(YP.t); YP.t = 0; return; }
    if(YP.sleepAt && Date.now() >= YP.sleepAt){ YP.sleepAt = 0; YP.stopAfter = false; try{ _YT.player.pauseVideo(); }catch(_){} toast('睡眠定時到了，已暫停'); _label(); }
    if(YP.a >= 0 && YP.b > YP.a && cur() >= YP.b){ try{ _YT.player.seekTo(YP.a, true); }catch(_){} }
    if(YP.sleepAt) _label();
  }, 400);
}

// ── 播放器資訊區多一排按鈕（youtube.js _ytRenderPlayerInfo 呼叫）──────────────────
function _sleepTxt(){
  const left = isNP() ? YP.npLeft : (YP.sleepAt ? (YP.sleepAt - Date.now()) / 1000 : 0);
  if(YP.stopAfter) return '⏾ 播完停';
  return left > 0 ? '⏾ ' + Math.ceil(left / 60) + ' 分' : '⏾ 定時';
}
function _abTxt(){ return YP.a < 0 ? 'A-B' : YP.b < 0 ? 'A ' + fmt(YP.a) + '→B?' : 'A-B 重複中'; }
window._ypRow = () => {
  const np = isNP(), it = _YT.cur || {};
  return `<div class="ytp-ctrls ytp-ctrls3">
    <button id="yp-sleep" onclick="ypSleepSheet()" class="${YP.sleepAt || YP.npLeft > 0 || YP.stopAfter ? 'on' : ''}" aria-label="睡眠定時">${_sleepTxt()}</button>
    <button id="yp-ab" onclick="ypAB()" class="${YP.a >= 0 ? 'on' : ''}" aria-label="A-B 段落重複">${_abTxt()}</button>
    <button onclick="ypQueueSheet()" aria-label="待播清單">☰ 待播${_YT.queue.length > 1 ? ' ' + (_YT.queue.length - _YT.qi - 1) : ''}</button>
    ${np ? `<button onclick="ypToggle('skipSilence')" class="${pref.skipSilence ? 'on' : ''}" aria-label="跳過靜音">🔇 跳靜音</button>
      <button onclick="ypToggle('level')" class="${pref.level ? 'on' : ''}" aria-label="音量平均">🔊 音量平均</button>` : ''}
  </div>`;
};
function _label(){
  const b = document.getElementById('yp-sleep'); if(b){ b.textContent = _sleepTxt(); b.classList.toggle('on', !!(YP.sleepAt || YP.npLeft > 0 || YP.stopAfter)); }
  const a = document.getElementById('yp-ab'); if(a){ a.textContent = _abTxt(); a.classList.toggle('on', YP.a >= 0); }
}

// ── ①睡眠定時 ─────────────────────────────────────────────
function _sheet(id, html){
  document.getElementById(id)?.remove();
  const ov = document.createElement('div'); ov.id = id; ov.className = 'media-ov-sheet z700';
  ov.innerHTML = '<div class="yt-sheet yt-menu">' + html + '</div>';
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
  return ov;
}
window.ypSleepSheet = () => {
  const on = YP.sleepAt || YP.npLeft > 0 || YP.stopAfter;
  _sheet('yp-sleep-ov', '<div class="yp-h">⏾ 睡眠定時' + (on ? '（' + _sleepTxt().replace('⏾ ', '') + '）' : '') + '</div>'
    + [15, 30, 45, 60, 90].map(m => `<button onclick="ypSleep(${m})">${m} 分鐘後暫停</button>`).join('')
    + '<button onclick="ypSleep(-1)">這部播完就停</button>'
    + (on ? '<button onclick="ypSleep(0)">取消定時</button>' : '')
    + '<button onclick="document.getElementById(\'yp-sleep-ov\').remove()">關閉</button>');
};
window.ypSleep = m => {
  document.getElementById('yp-sleep-ov')?.remove();
  YP.sleepAt = 0; YP.stopAfter = false; YP.npLeft = 0;
  if(m > 0) YP.sleepAt = Date.now() + m * 60000;
  if(m < 0) YP.stopAfter = true;
  if(isNP()){
    NP().control({ cmd:'sleep', ms:m > 0 ? m * 60000 : 0, end:m < 0 }).catch(() => {});
    YP.npLeft = m > 0 ? m * 60 : 0;
    if(m > 0) YP.sleepAt = 0;   // App 由原生端計時，網頁不再另外算
  }
  _tick(); _label();
  toast(m > 0 ? m + ' 分鐘後暫停' : m < 0 ? '這部播完就停' : '已取消睡眠定時');
};
// youtube.js：官方播放器／<video> 播完時問「要不要停」（這部播完就停）
window._ypStopAfter = () => { if(!YP.stopAfter || isNP()) return false; YP.stopAfter = false; YP.sleepAt = 0; _label(); toast('睡眠定時：這部播完了，已停止'); return true; };
// youtube.js：原生端的狀態、睡眠到時
window._ypNPState = s => {
  const left = +s.sleepLeft || 0, sa = !!s.stopAfter;
  if(Math.ceil(left / 60) !== Math.ceil(YP.npLeft / 60) || sa !== YP.stopAfter){ YP.npLeft = left; YP.stopAfter = sa; _label(); }
  else YP.npLeft = left;
};
window._ypSleepFired = () => { YP.npLeft = 0; YP.stopAfter = false; _label(); toast('睡眠定時到了，已暫停'); };

// ── ②A-B 段落重複 ─────────────────────────────────────────
window.ypAB = () => {
  const t = cur();
  if(YP.a < 0){ YP.a = t; YP.b = -1; toast('A 點：' + fmt(t) + '，到段落結尾再按一次設 B'); }
  else if(YP.b < 0){
    if(t <= YP.a + 1){ toast('B 點要在 A 點之後，請播到段落結尾再按'); return; }
    YP.b = t; toast('A-B 重複：' + fmt(YP.a) + '～' + fmt(YP.b) + '（再按一次取消）');
    if(isNP()) NP().control({ cmd:'ab', a:YP.a, b:YP.b }).catch(() => {});
    else try{ _YT.player.seekTo(YP.a, true); }catch(_){}
  }else{ _abClear(); toast('已取消 A-B 重複'); }
  _tick(); _label();
};
function _abClear(){
  const had = YP.a >= 0; YP.a = YP.b = -1;
  if(had && isNP()) NP().control({ cmd:'ab', a:-1, b:-1 }).catch(() => {});
}
// youtube.js：換一部開始播時（A-B 是那一部的段落，清掉；原生端換部時自己也會清）
window._ypOnStart = () => { YP.a = YP.b = -1; _tick(); };
// youtube.js：完全關掉播放器（不是背景播放）
window._ypOnClose = () => { YP.a = YP.b = -1; YP.sleepAt = 0; YP.stopAfter = false; YP.npLeft = 0; clearInterval(YP.t); YP.t = 0; };

// ── ③待播清單 ─────────────────────────────────────────────
function _qSync(){
  if(isNP()) NP().setQueue({ items:_ytNPItems(), index:_YT.qi }).catch(() => {});
  _ytRenderPlayerInfo();
}
window.ypQueueSheet = () => {
  const q = _YT.queue, i0 = _YT.qi;
  const rows = q.map((x, i) => i < i0 ? '' : `<div class="yp-qr${i === i0 ? ' on' : ''}">
      <div class="yp-qt"><b>${i === i0 ? '▶ 正在播' : (i === i0 + 1 ? '下一個' : '第 ' + (i - i0) + ' 個')}</b>${esc(x.title || '')}</div>
      ${i === i0 ? '' : `<div class="yp-qb">
        ${i > i0 + 1 ? `<button onclick="ypQ('next',${i})" aria-label="下一個播">⤴ 下一個</button><button onclick="ypQ('up',${i})" aria-label="往上">↑</button>` : ''}
        ${i < q.length - 1 ? `<button onclick="ypQ('down',${i})" aria-label="往下">↓</button>` : ''}
        <button onclick="ypQ('del',${i})" aria-label="移除">✕</button></div>`}
    </div>`).join('');
  _sheet('yp-q-ov', '<div class="yp-h">☰ 待播清單' + (q.length - i0 - 1 > 0 ? '（還有 ' + (q.length - i0 - 1) + ' 部）' : '') + '</div>'
    + '<div class="yp-ql">' + (q.length - i0 - 1 > 0 ? rows : rows + '<div class="yp-qe">後面沒有待播的了。從影音庫、搜尋結果點播放清單，會照順序排進來。</div>') + '</div>'
    + '<button onclick="document.getElementById(\'yp-q-ov\').remove()">完成</button>');
};
window.ypQ = (op, i) => {
  const q = _YT.queue, i0 = _YT.qi; if(!q[i] || i <= i0) return;
  const [x] = q.splice(i, 1);
  if(op === 'up') q.splice(i - 1, 0, x);
  else if(op === 'down') q.splice(i + 1, 0, x);
  else if(op === 'next') q.splice(i0 + 1, 0, x);
  // del：已經拿掉
  _qSync(); window.ypQueueSheet();
};

// ── ④App：跳過靜音、音量平均 ─────────────────────────────────
window.ypToggle = k => {
  pref[k] = !pref[k]; _ls.set(PREF_K, pref);
  if(isNP()) NP().control({ cmd:k, on:pref[k] }).catch(() => {});
  toast(k === 'skipSilence' ? (pref.skipSilence ? '跳過靜音：開（講課停頓會自動跳過）' : '跳過靜音：關')
                            : (pref.level ? '音量平均：開（小聲的影片拉大聲）' : '音量平均：關'));
  _ytRenderPlayerInfo();
};

// ── ⑤鍵盤快捷鍵 ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if(!document.getElementById('yt-player-ov') || !_YT.player) return;
  const t = e.target, tag = (t && t.tagName) || '';
  if(/INPUT|TEXTAREA|SELECT/.test(tag) || t?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  if(document.querySelector('.media-ov-sheet')) return;   // 有選單開著：不搶按鍵
  const p = _YT.player, k = e.key;
  const seek = d => { try{ p.seekTo(Math.max(0, cur() + d), true); }catch(_){} };
  let done = true;
  if(k === ' ' || k === 'k' || k === 'K'){
    if(isNP()) NP().control({ cmd:'toggle' }).catch(() => {});
    else if(p.el) (p.el.paused ? p.playVideo() : p.pauseVideo());
    else try{ (p.getPlayerState && p.getPlayerState() === 1) ? p.pauseVideo() : p.playVideo(); }catch(_){}
  }
  else if(k === 'ArrowLeft' || k === 'j' || k === 'J') seek(-10);
  else if(k === 'ArrowRight' || k === 'l' || k === 'L') seek(10);
  else if(e.shiftKey && (k === 'N' || k === 'n')) ytNext();
  else if(e.shiftKey && (k === 'P' || k === 'p')) ytPrev();
  else if(k === '>' || k === '<'){
    const rs = [0.75, 1, 1.25, 1.5, 1.75, 2], i = rs.indexOf(_YT.rate);
    const n = rs[Math.max(0, Math.min(rs.length - 1, (i < 0 ? 1 : i) + (k === '>' ? 1 : -1)))];
    if(n !== _YT.rate){ _YT.rate = n; try{ p.setPlaybackRate(n); }catch(_){} _ytRenderPlayerInfo(); toast('速度 ' + n + '×'); }
  }
  else if(k === 'a' || k === 'A' || k === 'b' || k === 'B') window.ypAB();
  else done = false;
  if(done){ e.preventDefault(); e.stopPropagation(); }
}, true);
})();
