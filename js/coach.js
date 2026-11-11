// ══ coach.js — 備考教練：考前衝刺清單／每週學習報告／修法提醒／考試計分規則／備份提醒 ══
// 依賴：db.js(da/getSetting/setSetting/shuffleUnits), utils.js(esc/escJs/toast/getWrong/ymd), quiz.js(startQWithPool)
// 公開 API：openCram / closeCram / cramToggle / cramStart / practiceWeekWeak / practiceAmend /
//           examRule / setExamRule / showAmendNote / bkHintGo / bkHintLater

(function(){
const DAY = 86400000;
const _isAns = a => a && (a.correct === true || a.correct === false);
const _pct = (a, b) => b ? Math.round(a / b * 100) : 0;
// 關聯法條 → 法規名稱（去掉條號、括號註記、書名號）
function _lawOf(ref){
  let s = String(typeof ref === 'string' ? ref : (ref && (ref.ref || ref.lawName)) || '')
    .replace(/\s*§.*$/, '')
    .replace(/\s*(?:第\s*[一二三四五六七八九十百千\d]+|\d+)\s*[條點].*$/, '').trim(), prev;
  do{ prev = s; s = s.replace(/\s*[（(][^）)]*[）)]\s*$/, ''); }while(s !== prev);
  return s.replace(/[《》〈〉「」『』"“”]/g, '').trim();
}
const _lawsOfQ = q => [...new Set((q.relatedLaws || []).map(_lawOf).filter(Boolean))];

// ════════ 🎯 考前衝刺清單 ════════
//   把「最該在考前再看一次」的題目收成一份：錯兩次以上、目前仍是錯題、標了錯因、答對但標「猜對的」、收藏、申論自評未掌握。
const _CRAM = [
  ['wrong2', '錯兩次以上',             (q, ws) => (q.wrongCount || 0) >= 2],
  ['weak',   '目前仍是錯題',           (q, ws) => ws.has(q.id)],
  ['why',    '標了錯因',               (q, ws) => !!q.wrongWhy],
  ['guess',  '答對但是猜的',           (q, ws) => !!q.guessed],
  ['star',   '收藏',                   (q, ws) => !!q.starred],
  ['es',     '申論自評「部分／不會」', (q, ws) => q.type === 'es' && q.esSelf != null && q.esSelf < 2],
];
let _cram = null;   // { qs, ws, on:{key:bool}, sub }
function _cramPool(){
  const c = _cram; if(!c) return [];
  return c.qs.filter(q => (!c.sub || q.subject === c.sub) && _CRAM.some(([k, , f]) => c.on[k] && f(q, c.ws)));
}
function _cramDraw(){
  const c = _cram, body = document.getElementById('cram-body');
  if(!c || !body) return;
  const inSub = q => !c.sub || q.subject === c.sub;
  const pool = _cramPool();
  const subs = [...new Set(c.qs.filter(q => _CRAM.some(([, , f]) => f(q, c.ws))).map(q => q.subject || '未分類'))].sort();
  const lawN = {};
  pool.forEach(q => _lawsOfQ(q).forEach(l => { lawN[l] = (lawN[l] || 0) + 1; }));
  const laws = Object.entries(lawN).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const mc = pool.filter(q => q.type !== 'es').length;
  body.innerHTML =
    '<div class="mk-note">考前只看這一份：把最容易再丟分的題目收在一起。勾選要納入的類別，同一題只會出現一次。</div>' +
    '<div class="cram-cats">' + _CRAM.map(([k, t, f]) => {
      const n = c.qs.filter(q => inSub(q) && f(q, c.ws)).length;
      return '<label class="cram-cat' + (n ? '' : ' off') + '"><input type="checkbox" data-cram="' + k + '"' + (c.on[k] ? ' checked' : '') + '>' +
        '<span>' + esc(t) + '</span><b>' + n + '</b></label>';
    }).join('') + '</div>' +
    '<div class="fg"><label class="fl">科目</label><select data-cram="sub"><option value="">全部科目</option>' +
      subs.map(s => '<option value="' + esc(s) + '"' + (c.sub === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
    (laws.length ? '<div class="cram-laws"><div class="fl">這些題目最常考的法規（考前先翻這幾部）</div>' +
      laws.map(([l, n]) => '<span class="cram-law">' + esc(l) + ' <b>' + n + '</b></span>').join('') + '</div>' : '') +
    '<button class="btn bp bw" style="margin-top:14px" ' + (pool.length ? '' : 'disabled ') + 'data-cram-go="1">▶ 開始衝刺（' + pool.length + ' 題' +
      (pool.length !== mc ? '，含申論 ' + (pool.length - mc) : '') + '）</button>' +
    (pool.length ? '' : '<div class="mk-hint">目前沒有符合的題目。多做題、答錯時標錯因、答對但不確定時點「猜對的」，這裡就會累積。</div>');
}
async function openCram(){  try{
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  let on = {}; try{ on = JSON.parse(localStorage.getItem('cramOn') || '{}') || {}; }catch(e){}
  _CRAM.forEach(([k]) => { if(on[k] === undefined) on[k] = true; });
  _cram = { qs, ws:getWrong(qs, ats), on, sub:'' };
  document.getElementById('cram-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'ov on'; ov.id = 'cram-ov';
  ov.onclick = e => { if(e.target === ov) closeCram(); };
  ov.innerHTML = '<div class="sh" style="max-width:460px"><div class="shdl"></div>' +
    '<div class="sht"><span>🎯 考前衝刺清單</span><button class="hd-btn bg" data-cram-x="1" aria-label="關閉">✕</button></div>' +
    '<div class="mk-body" id="cram-body"></div></div>';
  ov.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.cram; if(k) cramToggle(k, k === 'sub' ? e.target.value : e.target.checked); });
  ov.addEventListener('click', e => {
    if(e.target.closest('[data-cram-x]')) closeCram();
    else if(e.target.closest('[data-cram-go]')) cramStart();
  });
  document.body.appendChild(ov);
  _cramDraw();
  }catch(e){ logError('openCram', e); }}
function closeCram(){ document.getElementById('cram-ov')?.remove(); _cram = null; }
function cramToggle(k, v){
  if(!_cram) return;
  if(k === 'sub') _cram.sub = v;
  else { _cram.on[k] = !!v; try{ localStorage.setItem('cramOn', JSON.stringify(_cram.on)); }catch(e){} }
  _cramDraw();
}
function cramStart(){
  const pool = _cramPool();
  if(!pool.length){ toast('沒有符合的題目'); return; }
  closeCram();
  startQWithPool(shuffleUnits(pool).flat(), '🎯 考前衝刺');
}

// ════════ 📆 每週學習報告（分析頁最上方）════════
//   本週＝週一到今天；和上週同期（週一到同一個星期幾）比較。弱點＝本週作答的題目依關聯法規統計答對率（至少作答 3 次），取最低三部。
let _weekWeak = [];
function _monday(d){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function _renderWeek(qs, ats){
  const box = document.getElementById('week-box');
  if(!box) return;
  const qById = new Map(qs.map(q => [q.id, q]));
  const m0 = _monday(new Date()), a0 = ymd(m0), b0 = ymd(new Date(m0.getTime() - 7 * DAY));
  // 上週只取到「同一個星期幾」為止：週三看報告時，拿本週一～三比上週一～三，才不會因為本週還沒過完而顯得退步
  const b1 = ymd(new Date(Date.now() - 7 * DAY));
  const cur = ats.filter(a => a.date >= a0), prev = ats.filter(a => a.date >= b0 && a.date <= b1);
  const sum = list => {
    const an = list.filter(_isAns);
    return { n:an.length, ok:an.filter(a => a.correct).length, es:list.filter(a => a.correct === null).length, days:new Set(list.map(a => a.date)).size };
  };
  const c = sum(cur), p = sum(prev);
  if(!c.n && !c.es && !p.n && !p.es){
    box.innerHTML = '<div class="wk-empty">這兩週還沒有作答紀錄。開始練習後，這裡每週會整理作答量、正確率變化、最弱的法規和下週建議。</div>';
    return;
  }
  const law = {};
  cur.filter(_isAns).forEach(a => {
    const q = qById.get(a.qid); if(!q) return;
    _lawsOfQ(q).forEach(l => { const d = law[l] || (law[l] = { n:0, ok:0 }); d.n++; if(a.correct) d.ok++; });
  });
  const weak = Object.entries(law).filter(([, d]) => d.n >= 3 && d.ok < d.n).map(([l, d]) => ({ l, n:d.n, r:_pct(d.ok, d.n) }))
    .sort((x, y) => x.r - y.r || y.n - x.n).slice(0, 3);
  _weekWeak = weak.map(w => w.l);
  const accC = c.n ? _pct(c.ok, c.n) : null, accP = p.n ? _pct(p.ok, p.n) : null;
  const diff = (a, b, unit) => b == null || a == null ? '' : a === b ? '<i class="wk-d">持平</i>'
    : '<i class="wk-d ' + (a > b ? 'up' : 'dn') + '">' + (a > b ? '▲' : '▼') + Math.abs(a - b) + unit + '</i>';
  const cell = (v, l, d) => '<div class="wk-cell"><div class="wk-v">' + v + '</div><div class="wk-l">' + l + '</div>' + (d || '') + '</div>';
  const tips = [];
  if(!c.n && !c.es) tips.push('這週還沒開始作答，先做一回「今日複習」。');
  else {
    if(c.days <= 3 && (new Date().getDay() + 6) % 7 >= 4) tips.push('這週只練了 ' + c.days + ' 天，下週把練習分散到至少 5 天，記得比較牢。');
    if(accC != null && accP != null && accC < accP - 4) tips.push('正確率比上週低 ' + (accP - accC) + ' 個百分點，先停下新題，把這週的錯題重做一次。');
    if(accC != null && accC >= 85 && c.n >= 50) tips.push('正確率穩定，可以排一次「限時模擬考」驗收。');
    if(weak.length) tips.push('下週先補：' + weak.map(w => w.l).join('、') + '。');
    if(!tips.length) tips.push('維持這個節奏，錯題記得標錯因，考前衝刺清單才會準。');
  }
  box.innerHTML =
    '<div class="wk-range">' + a0.slice(5).replace('-', '/') + '（週一）到今天，和上週同期比較</div>' +
    '<div class="wk-grid">' +
      cell(c.n, '選擇題作答', diff(c.n, p.n, ' 題')) +
      cell(accC == null ? '—' : accC + '%', '正確率', diff(accC, accP, '%')) +
      cell(c.days, '練習天數', diff(c.days, p.days, ' 天')) +
      cell(c.es, '申論練習', diff(c.es, p.es, ' 題')) + '</div>' +
    (weak.length ? '<div class="wk-sub">本週最弱的法規</div>' + weak.map(w =>
      '<div class="wk-weak"><span>' + esc(w.l) + '</span><b>' + w.r + '%</b><i>作答 ' + w.n + ' 次</i></div>').join('') +
      '<button class="btn bg bw" style="margin-top:8px" onclick="practiceWeekWeak()">▶ 練這幾部法規的錯題與沒做過的題</button>' : '') +
    '<div class="wk-sub">下週建議</div><ul class="wk-tips">' + tips.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
}
async function practiceWeekWeak(){  try{
  if(!_weekWeak.length) return;
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  const ws = getWrong(qs, ats), want = new Set(_weekWeak);
  const pool = qs.filter(q => q.type !== 'es' && _lawsOfQ(q).some(l => want.has(l)) && (ws.has(q.id) || !q.lastReview));
  if(!pool.length){ toast('這幾部法規目前沒有錯題或沒做過的題'); return; }
  startQWithPool(shuffleUnits(pool).flat().slice(0, 40), '📆 本週弱點');
  }catch(e){ logError('practiceWeekWeak', e); }}

// ════════ 📜 修法提醒 ════════
//   資料庫裡的法規若填了修正日期，且修正年度晚於題目的出題年度 → 作答後提醒對照現行條文，分析頁列出受影響題數。
//   只比到「年度」：同一年修正的不提醒（無法判斷考試在修法前或後）。這是提醒，不代表答案一定變了。
let _amend = null, _amendAt = 0;
function _rocYear(s){
  s = String(s || '');
  let m = s.match(/民國\s*(\d{2,3})\s*年/); if(m) return +m[1];
  m = s.match(/(\d{4})\s*[-/.年]/); if(m) return +m[1] - 1911;
  m = s.match(/^\s*(\d{2,3})\s*[-/.年]/); if(m) return +m[1];
  return 0;
}
async function _amendMap(){
  if(_amend && Date.now() - _amendAt < 300000) return _amend;
  const map = new Map();
  try{
    (await da('laws')).forEach(l => {
      if(l && l.lawName && l.amendDate && !map.has(l.lawName)){ const y = _rocYear(l.amendDate); if(y) map.set(l.lawName, { y, d:l.amendDate }); }
    });
  }catch(e){}
  _amend = map; _amendAt = Date.now();
  return map;
}
const _qYear = q => { const y = parseInt(q.year, 10); return !y ? 0 : y > 1911 ? y - 1911 : y; };
function _amendHits(q, map){
  const y = _qYear(q); if(!y) return [];
  return _lawsOfQ(q).map(l => ({ l, a:map.get(l) })).filter(x => x.a && x.a.y > y);
}
async function showAmendNote(qu){  try{
  const el = document.getElementById('qamend');
  if(!el) return;
  el.style.display = 'none';
  if(!qu || !qu.relatedLaws || !qu.relatedLaws.length) return;
  const hits = _amendHits(qu, await _amendMap());
  if(!hits.length) return;
  el.innerHTML = '<b>📜 修法提醒</b>　' + hits.map(h => esc(h.l) + '（' + esc(h.a.d) + ' 修正）').join('、') +
    '，晚於本題出題年度（' + esc(String(qu.year)) + ' 年）。答案是當年的官方答案，複習時請對照現行條文。';
  el.style.display = '';
  }catch(e){ logError('showAmendNote', e); }}
let _amendPools = [];
async function _renderAmend(qs){
  const box = document.getElementById('amend-box');
  if(!box) return;
  const map = await _amendMap();
  if(!map.size){
    box.innerHTML = '<div class="wk-empty">資料庫的法規還沒有填修正日期。到「資料庫」點進法規，在「編輯法規資訊」填上修正日期後，這裡會列出出題年度早於修法的考古題。</div>';
    return;
  }
  const by = {};
  qs.forEach(q => _amendHits(q, map).forEach(h => { (by[h.l] || (by[h.l] = { a:h.a, qs:[] })).qs.push(q); }));
  const rows = Object.entries(by).sort((a, b) => b[1].qs.length - a[1].qs.length);
  if(!rows.length){ box.innerHTML = '<div class="wk-empty">目前沒有出題年度早於法規修正年度的考古題。</div>'; return; }
  _amendPools = rows.map(([l, d]) => ({ l, qs:d.qs }));
  box.innerHTML = rows.slice(0, 12).map(([l, d], i) =>
    '<div class="am-row"><span class="am-name">' + esc(l) + '<i>' + esc(d.a.d) + ' 修正</i></span>' +
    '<button class="btn bg" onclick="practiceAmend(' + i + ')">▶ ' + d.qs.length + ' 題</button></div>').join('') +
    (rows.length > 12 ? '<div class="wl-hint">另有 ' + (rows.length - 12) + ' 部法規未列出。</div>' : '') +
    '<div class="wl-hint">列的是「出題年度早於法規修正年度」的考古題，不代表答案一定變了；作答後請對照現行條文。只比年度，同一年修正的不列。</div>';
}
function practiceAmend(i){
  const p = _amendPools[i];
  if(!p || !p.qs.length) return;
  startQWithPool(shuffleUnits(p.qs).flat(), '📜 ' + p.l);
}

// ════════ ⚖ 考試計分規則（模擬考預設計分，可在設定頁依考試別調整）════════
let _rules = {}, _ruleExams = [];
function examRule(ex){ return _rules[ex] || (/升官等/.test(ex || '') ? 'none' : 'neg'); }
async function _renderRules(){
  const box = document.getElementById('exam-rules');
  if(!box) return;
  try{ _rules = (await getSetting('exam_rules', {})) || {}; }catch(e){}
  const cnt = {};
  (await da('questions')).forEach(q => { if(q.exam && q.type !== 'es') cnt[q.exam] = (cnt[q.exam] || 0) + 1; });
  _ruleExams = Object.keys(cnt).sort();
  if(!_ruleExams.length){ box.innerHTML = '<div class="ssb" style="padding:0 12px 10px">題庫還沒有標考試別的選擇題。</div>'; return; }
  box.innerHTML = _ruleExams.map((ex, i) => '<div class="srow"><div><div class="slb">' + esc(ex) + '</div><div class="ssb">選擇題 ' + cnt[ex] + ' 題</div></div>' +
    '<select class="rule-sel" onchange="setExamRule(' + i + ', this.value)">' +
    [['neg', '答錯倒扣'], ['none', '不倒扣']].map(([v, t]) => '<option value="' + v + '"' + (examRule(ex) === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>').join('');
}
async function setExamRule(i, v){
  const ex = _ruleExams[i];
  if(!ex) return;
  _rules[ex] = v === 'none' ? 'none' : 'neg';
  await setSetting('exam_rules', _rules);
  toast(ex + '：模擬考預設' + (v === 'none' ? '不倒扣' : '答錯倒扣'));
}

// ════════ 💾 備份提醒（首頁）════════
//   這台裝置超過 7 天沒有備份或還原（雲端、資料夾都算）且有作答紀錄 → 首頁顯示一行提醒；可延後 3 天。
async function _renderBkHint(){
  const box = document.getElementById('bk-hint');
  if(!box) return;
  box.innerHTML = '';
  let an = {}; try{ an = JSON.parse(localStorage.getItem('yc_sync_anchor') || '{}') || {}; }catch(e){}
  const last = Math.max(0, ...['cloud', 'local'].map(k => an[k] && an[k].when ? Date.parse(an[k].when) || 0 : 0));
  const snooze = +localStorage.getItem('bkHintLater') || 0;
  if(Date.now() < snooze) return;
  const days = last ? Math.floor((Date.now() - last) / DAY) : -1;
  if(last && days < 7) return;
  let n = 0; try{ n = (await da('attempts')).length; }catch(e){}
  if(n < 20) return;
  box.innerHTML = '<div class="bk-hint"><span>💾 ' + (last ? '已經 ' + days + ' 天沒有備份' : '這台裝置還沒有備份過') + '（作答紀錄 ' + n + ' 筆）</span>' +
    '<button class="btn bg" onclick="bkHintGo()">去備份</button><button class="bk-x" onclick="bkHintLater()">稍後</button></div>';
}
function bkHintGo(){
  goPage('set');
  setTimeout(() => { const s = [...document.querySelectorAll('#pg-set .sec')].find(x => /雲端同步/.test(x.textContent)); if(s) s.scrollIntoView({ block:'start' }); }, 80);
}
function bkHintLater(){
  try{ localStorage.setItem('bkHintLater', String(Date.now() + 3 * DAY)); }catch(e){}
  const b = document.getElementById('bk-hint'); if(b) b.innerHTML = '';
}

// ── 頁面切換時更新（看頁面的 hide class，不必改動各頁原本的 render）──
function _onShow(id){
  if(id === 'pg-home') _renderBkHint().catch(e => logError('bkHint', e));
  else if(id === 'pg-set') _renderRules().catch(e => logError('examRules', e));
  else if(id === 'pg-stats') Promise.all([da('questions'), da('attempts')]).then(([qs, ats]) => {
    try{ _renderWeek(qs, ats); }catch(e){ logError('renderWeek', e); }
    return _renderAmend(qs);
  }).catch(e => logError('coachStats', e));
}
function _watch(){
  ['pg-home', 'pg-set', 'pg-stats'].forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    let was = el.classList.contains('hide');
    new MutationObserver(() => { const h = el.classList.contains('hide'); if(was && !h) _onShow(id); was = h; })
      .observe(el, { attributes:true, attributeFilter:['class'] });
    if(!was) setTimeout(() => _onShow(id), 1500);
  });
  setTimeout(() => getSetting('exam_rules', {}).then(r => { _rules = r || {}; }).catch(() => {}), 1200);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _watch); else _watch();

const Coach = { openCram, closeCram, cramToggle, cramStart, practiceWeekWeak, practiceAmend, examRule, setExamRule, showAmendNote, bkHintGo, bkHintLater };
Object.assign(window, Coach);
})();
