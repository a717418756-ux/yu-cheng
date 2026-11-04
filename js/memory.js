// ══ memory.js — 記憶庫（考試區）══════════════════════════════════
// 依賴：db.js(getSetting/setSetting/da), utils.js(esc/toast), data.js(showLawPop), quiz.js(startQWithPool)
// 資料：data/memory/index.json ＋ 各科 *.min.json（tools/build_data.py 產生）
//   刑法、刑訴、勤務取自 Promotion 升官等記憶樹；警察法規、憲法另行整理。
// 六個分頁：🌳 法條樹｜📊 對照表｜⚠️ 易錯爭點｜🔢 數字口訣｜🃏 閃卡｜🆕 修法
//   樹狀節點的法條標籤點下去開平台法條彈窗（showLawPop），並標示警大二技考過幾題（🔥，取自猜題庫資料）。
// 閃卡熟練度存在 settings 'memProgress'（隨雲端／本機備份）。
//
// 公開 API 見檔尾 window.Memory

(function(){
'use strict';

const TABS = [
  ['tree',  '🌳 法條樹'],
  ['cmp',   '📊 對照表'],
  ['trap',  '⚠️ 易錯爭點'],
  ['num',   '🔢 數字口訣'],
  ['card',  '🃏 閃卡'],
  ['upd',   '🆕 修法'],
];
const TAG_CLS = { '必考':'must', '易錯':'trap', '口訣':'mn', '新法':'new' };

let _index = null;          // index.json
const _subj = {};           // id → 科目資料
let _cur = { sid:'police', tab:'tree', recall:false, cardOnlyWeak:false, cardIdx:0, cardFlip:false, cardCh:'' };
let _heat = null;           // 'law|articleN' → { count, recent, last, ids }
let _prog = null;           // 閃卡熟練度

// ════════ 資料載入 ════════
async function _json(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}
async function _loadIndex(){
  if(!_index) _index = await _json('data/memory/index.json');
  return _index;
}
async function _loadSubj(sid){
  if(!_subj[sid]) _subj[sid] = await _json('data/memory/' + sid + '.min.json');
  return _subj[sid];
}
// 猜題庫的法條排名 → 熱度表（記憶樹的法條標籤用）
async function _loadHeat(){
  if(_heat) return _heat;
  _heat = {};
  try{
    const p = await _json('data/predict.json');
    (p.subjects||[]).forEach(s => (s.articles||[]).forEach(a => {
      const k = a.law + '|' + a.article_n;
      const o = _heat[k] || (_heat[k] = { count:0, recent:0, last:0, ids:[] });
      o.count += a.count; o.recent += a.recent_count || 0;
      o.last = Math.max(o.last, a.last_year || 0);
      o.ids.push(...(a.question_ids||[]));
    }));
  }catch(e){ logError('memory.heat', e); }
  return _heat;
}
async function _loadProg(){
  if(!_prog){
    try{ _prog = await getSetting('memProgress', null) || {}; }catch(e){ _prog = {}; }
  }
  return _prog;
}
let _progT = null;
function _saveProg(){
  clearTimeout(_progT);
  _progT = setTimeout(() => setSetting('memProgress', _prog).catch(e => logError('memProgress', e)), 400);
}

// ════════ 法條參照解析 ════════
// 「刑訴§420、§441」「警察法§16；警察法施行細則§13」「刑法§41Ⅰ②」→ [{label, ref, key}]
//   ref 給 showLawPop（法規全名＋第X條之Y），key 對熱度表（全名|條×1000＋之Y）。
const LAW_ALIAS = {
  '刑法':'中華民國刑法', '刑訴':'刑事訴訟法', '刑訴法':'刑事訴訟法',
  '憲法':'中華民國憲法', '增修':'中華民國憲法增修條文', '憲法增修條文':'中華民國憲法增修條文', '增修條文':'中華民國憲法增修條文',
  '勤務條例':'警察勤務條例', '社維法':'社會秩序維護法', '職權法':'警察職權行使法', '警職法':'警察職權行使法',
  '集遊法':'集會遊行法', '查訪辦法':'治安顧慮人口查訪辦法', '人事條例':'警察人員人事條例', '警械條例':'警械使用條例',
  '通保法':'通訊保障及監察法', '家暴法':'家庭暴力防治法', '道交條例':'道路交通管理處罰條例', '跟騷法':'跟蹤騷擾防制法',
  '施行法':'刑法施行法', '行執法':'行政執行法', '訪查辦法':'警察勤務區訪查辦法',
  '勤指中心作業規定':'警察機關勤務指揮中心作業規定', '勤休要點':'警察機關輪班輪休人員勤休實施要點',
  '訪查作業規定':'警察勤務區訪查作業規定', '設置基準':'警察分駐所派出所設置基準',
};
// 看起來是法規、行政規則、解釋或判決字號的才做成可點的按鈕；「讀家總複習」「學理」「108.2.19函」只顯示文字
const _LAWLIKE = /(法|律|條例|通則|規則|細則|辦法|綱要|標準|準則|規程|要點|規定|原則|基準)(第[\d一二三四五六七八九十百]+[點條](之\d+)?)?$|釋字|憲判/;
function _fullLaw(n){
  n = (n||'').replace(/[（(].*?[)）]/g,'').trim();
  return LAW_ALIAS[n] || n;
}
function parseRefs(ref){
  if(!ref) return [];
  const out = [];
  let lastLaw = '';
  String(ref).split(/[、；;，,]/).forEach(part => {
    const p = part.trim();
    if(!p) return;
    // 「刑法§19Ⅰ、Ⅱ」裡單獨的項次、款次：併回前一筆，不另做按鈕
    if(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ①-⑳]/.test(p) && out.length){ out[out.length-1].label += '、' + p; return; }
    let m = p.match(/^(.*?)§\s*(\d+)(?:[-－之](\d+))?/);
    if(!m) m = p.match(/^(.*?)第(\d+)條(?:之(\d+))?/);
    if(m){
      const law = _fullLaw(m[1]) || lastLaw;
      if(!law){ out.push({ label:p }); return; }
      lastLaw = law;
      const main = +m[2], sub = m[3] ? +m[3] : 0;
      out.push({ label:p, ref: law + '第' + main + '條' + (sub ? '之' + sub : ''), key: law + '|' + (main*1000 + sub) });
      return;
    }
    // 行政規則的「第N點」：法規名換成全名，條號照原樣交給 showLawPop
    const pt = p.match(/^(.*?)(第[\d一二三四五六七八九十百]+點.*)$/);
    if(pt && _LAWLIKE.test(p)){ out.push({ label:p, ref:_fullLaw(pt[1]) + pt[2], plain:true }); return; }
    if(_LAWLIKE.test(p)) out.push({ label:p, ref:/釋字|憲判/.test(p) ? p : _fullLaw(p), plain:true });
    else out.push({ label:p });   // 判決字號、教材名、日期函：只顯示
  });
  return out;
}
function _refChips(ref){
  return parseRefs(ref).map(r => {
    if(!r.ref) return '<span class="mem-ref plain">' + esc(r.label) + '</span>';
    const h = r.key && _heat && _heat[r.key];
    const hot = h ? ' <b class="mem-hot" title="警大二技考過 ' + h.count + ' 題（近3年 ' + h.recent + '）">🔥' + h.count + '</b>' : '';
    return '<button class="mem-ref" data-ref="' + esc(r.ref) + '">' + esc(r.label) + hot + '</button>';
  }).join('');
}

// ════════ 頁面骨架 ════════
async function renderMemory(){
  const el = document.getElementById('mem-body');
  if(!el) return;
  try{
    await Promise.all([_loadIndex(), _loadHeat(), _loadProg()]);
    _initDelegation();
    _renderSubjChips();
    _renderTabs();
    await _renderBody();
  }catch(e){
    logError('renderMemory', e);
    el.innerHTML = '<div class="mem-empty">記憶庫資料載入失敗，請確認網路後重新整理。<br><small>' + esc(e.message) + '</small></div>';
  }
}
function _renderSubjChips(){
  const box = document.getElementById('mem-subj');
  box.innerHTML = _index.subjects.map(s =>
    '<button class="chip' + (s.id===_cur.sid?' on':'') + '" data-sid="' + s.id + '">' + esc(s.name) + '</button>').join('');
}
function _renderTabs(){
  const box = document.getElementById('mem-tabs');
  box.innerHTML = TABS.map(([k, t]) =>
    '<button class="mem-tab' + (k===_cur.tab?' on':'') + '" data-tab="' + k + '">' + t + '</button>').join('');
}
async function _renderBody(){
  const el = document.getElementById('mem-body');
  const d = await _loadSubj(_cur.sid);
  const fn = { tree:_rTree, cmp:_rCmp, trap:_rTrap, num:_rNum, card:_rCard, upd:_rUpd }[_cur.tab];
  el.innerHTML = fn(d);
  el.scrollTop = 0;
}

// ════════ 🌳 法條樹 ════════
function _rTree(d){
  const tools = '<div class="mem-tools">' +
    '<button class="btn bg" data-act="expand">全部展開</button>' +
    '<button class="btn bg" data-act="collapse">全部收合</button>' +
    '<button class="btn ' + (_cur.recall?'bp':'bg') + '" data-act="recall" title="遮住說明，點一下才顯示">🙈 挖空回想' + (_cur.recall?'中':'') + '</button>' +
    '</div>';
  const intro = d.intro ? '<div class="mem-intro">' + esc(d.intro) + (d.source ? '<div class="mem-src">來源：' + esc(d.source) + '</div>' : '') + '</div>' : '';
  const legend = '<div class="mem-legend"><span class="mem-tag must">必考</span><span class="mem-tag trap">易錯</span><span class="mem-tag mn">口訣</span><span class="mem-tag new">新法</span><span class="mem-hot">🔥N</span>＝警大二技考過題數　點法條看條文</div>';
  return tools + intro + legend + d.chapters.map((ch, i) =>
    '<details class="mem-ch"' + (i===0?' open':'') + ' id="mem-ch-' + ch.id + '">' +
      '<summary><span class="mem-ch-t">' + esc(ch.title) + '</span>' + (ch.lead ? '<span class="mem-ch-lead">' + esc(ch.lead) + '</span>' : '') + '</summary>' +
      '<div class="mem-tree">' + _rNodes(ch.tree, ch.id) + '</div>' +
    '</details>').join('');
}
function _rNodes(nodes, path){
  return '<ul>' + (nodes||[]).map((n, i) => {
    const id = path + '-' + i;
    const kids = n.c && n.c.length;
    const tag = n.tag ? '<span class="mem-tag ' + (TAG_CLS[n.tag]||'') + '">' + esc(n.tag) + '</span>' : '';
    const desc = n.d ? '<div class="mem-d' + (_cur.recall?' hidden':'') + '" data-reveal="1">' + esc(n.d) + '</div>' : '';
    const refs = n.ref ? '<div class="mem-refs">' + _refChips(n.ref) + '</div>' : '';
    const head = '<div class="mem-n" data-nid="' + id + '"><span class="mem-t">' + esc(n.t) + '</span>' + tag + '</div>';
    if(kids) return '<li><details class="mem-node" open><summary>' + head + '</summary>' + desc + refs + _rNodes(n.c, id) + '</details></li>';
    return '<li class="leaf">' + head + desc + refs + '</li>';
  }).join('') + '</ul>';
}

// ════════ 📊 對照表 ════════
function _rCmp(d){
  if(!(d.compare||[]).length) return '<div class="mem-empty">本科尚無對照表</div>';
  return d.compare.map(c =>
    '<div class="cc mem-cmp"><div class="ct">' + esc(c.title) + '</div><div class="mem-tbl-wrap"><table class="mem-tbl">' +
      '<thead><tr><th></th>' + c.cols.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
      c.rows.map(r => '<tr><th>' + esc(r[0]) + '</th>' + r.slice(1).map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div></div>').join('');
}

// ════════ ⚠️ 易錯爭點 ════════
//   ①整理好的易錯（錯誤說法 vs 正確）②法條樹裡標「易錯」的節點，按章節列出
function _collectTagged(d, tag){
  const out = [];
  const walk = (nodes, ch, trail) => (nodes||[]).forEach(n => {
    const t = trail.concat(n.t);
    if(n.tag === tag) out.push({ ch, trail:t, n });
    walk(n.c, ch, t);
  });
  d.chapters.forEach(ch => walk(ch.tree, ch, []));
  return out;
}
function _rTrap(d){
  const traps = d.traps || [];
  let h = '';
  if(traps.length){
    h += '<div class="sec">常見錯誤說法（' + traps.length + '）</div>' + traps.map(t =>
      '<div class="card mem-trap"><div class="mem-trap-t">' + esc(t.title) + '</div>' +
      '<div class="mem-wrong">✗ ' + esc(t.wrong) + '</div>' +
      '<div class="mem-right' + (_cur.recall?' hidden':'') + '" data-reveal="1">✓ ' + esc(t.right) + '</div>' +
      (t.ref ? '<div class="mem-refs">' + _refChips(t.ref) + '</div>' : '') + '</div>').join('');
  }
  const tagged = _collectTagged(d, '易錯');
  if(tagged.length){
    h += '<div class="sec">法條樹裡的易錯點（' + tagged.length + '）</div>' + tagged.map(x =>
      '<div class="card mem-trap"><div class="mem-trail">' + esc(x.ch.title) + '　›　' + esc(x.trail.slice(0,-1).join(' › ')) + '</div>' +
      '<div class="mem-trap-t">' + esc(x.n.t) + '</div>' +
      (x.n.d ? '<div class="mem-right">' + esc(x.n.d) + '</div>' : '') +
      (x.n.ref ? '<div class="mem-refs">' + _refChips(x.n.ref) + '</div>' : '') + '</div>').join('');
  }
  const must = _collectTagged(d, '必考');
  if(must.length){
    h += '<div class="sec">必考爭點（' + must.length + '）</div><div class="card">' + must.map(x =>
      '<div class="mem-must-row"><span class="mem-tag must">必考</span><b>' + esc(x.n.t) + '</b>' +
      (x.n.ref ? ' ' + _refChips(x.n.ref) : '') + '</div>').join('') + '</div>';
  }
  return h || '<div class="mem-empty">本科尚無易錯整理</div>';
}

// ════════ 🔢 數字口訣 ════════
function _rNum(d){
  const mn = d.mnemonics || [];
  const nums = d.numbers || [];
  const tools = '<div class="mem-tools"><button class="btn ' + (_cur.recall?'bp':'bg') + '" data-act="recall">🙈 自我測驗' + (_cur.recall?'中（點卡片看答案）':'') + '</button></div>';
  let h = tools;
  if(mn.length){
    h += '<div class="sec">多款項目口訣（' + mn.length + '）</div>' + mn.map(m =>
      '<div class="card mem-mn">' +
        '<div class="mem-mn-head"><span class="mem-mn-t">' + esc(m.title) + '</span><span class="mem-kind">' + esc(m.kind||'') + '</span></div>' +
        '<div class="mem-code' + (_cur.recall?' hidden':'') + '" data-reveal="1">' + esc(m.code) + '</div>' +
        '<ol class="mem-items' + (_cur.recall?' hidden':'') + '" data-reveal="1">' + (m.items||[]).map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' +
        (m.logic ? '<div class="mem-logic' + (_cur.recall?' hidden':'') + '" data-reveal="1">💡 ' + esc(m.logic) + '</div>' : '') +
        (m.ref ? '<div class="mem-refs">' + _refChips(m.ref) + '</div>' : '') +
      '</div>').join('');
  }
  // Promotion 樹裡標「口訣」的節點也一併列出（刑法、刑訴、勤務）
  const tagged = _collectTagged(d, '口訣').filter(x => x.n.d);
  if(tagged.length){
    h += '<div class="sec">樹狀圖裡的口訣（' + tagged.length + '）</div><div class="card">' + tagged.map(x =>
      '<div class="mem-num-row"><div class="mem-num-k">' + esc(x.n.t) + '</div><div class="mem-num-v' + (_cur.recall?' hidden':'') + '" data-reveal="1">' + esc(x.n.d) + '</div>' +
      (x.n.ref ? '<div class="mem-refs">' + _refChips(x.n.ref) + '</div>' : '') + '</div>').join('') + '</div>';
  }
  if(nums.length){
    h += '<div class="sec">數字速記（' + nums.length + '）</div><div class="card">' + nums.map(n =>
      '<div class="mem-num-row"><div class="mem-num-k">' + esc(n.k) + '</div><div class="mem-num-v' + (_cur.recall?' hidden':'') + '" data-reveal="1">' + esc(n.v) + '</div>' +
      (n.ref ? '<div class="mem-refs">' + _refChips(n.ref) + '</div>' : '') + '</div>').join('') + '</div>' +
      '<div style="padding:4px 12px 14px"><button class="btn bg" style="width:100%" data-act="numquiz">🔢 數字隨機抽考（' + nums.length + ' 題）</button></div>';
  }
  return h;
}

// ════════ 🃏 閃卡 ════════
function _cardKey(c){ return (c.q||'').slice(0, 40); }
function _cardPool(d){
  const p = _prog[_cur.sid] || {};
  return (d.cards||[]).filter(c => (!_cur.cardCh || c.ch === _cur.cardCh) &&
    (!_cur.cardOnlyWeak || !(p[_cardKey(c)] && p[_cardKey(c)].ok >= 2 && !p[_cardKey(c)].ng)));
}
function _rCard(d){
  const pool = _cardPool(d);
  const p = _prog[_cur.sid] || {};
  const known = (d.cards||[]).filter(c => p[_cardKey(c)] && p[_cardKey(c)].ok >= 2 && !p[_cardKey(c)].ng).length;
  const chOpts = '<option value="">全部章節</option>' + d.chapters.map(ch =>
    '<option value="' + ch.id + '"' + (ch.id===_cur.cardCh?' selected':'') + '>' + esc(ch.title) + '</option>').join('');
  let h = '<div class="mem-tools"><select class="mem-sel" data-act="cardch">' + chOpts + '</select>' +
    '<button class="btn ' + (_cur.cardOnlyWeak?'bp':'bg') + '" data-act="weak">只看未熟</button></div>' +
    '<div class="mem-prog">已熟 ' + known + ' ／ ' + (d.cards||[]).length + ' 張（連續答對 2 次算熟；答錯就重來）</div>';
  if(!pool.length) return h + '<div class="mem-empty">這個範圍都熟了 🎉</div>';
  if(_cur.cardIdx >= pool.length) _cur.cardIdx = 0;
  const c = pool[_cur.cardIdx];
  const st = p[_cardKey(c)];
  h += '<div class="mem-flash' + (_cur.cardFlip?' flip':'') + '" data-act="flip">' +
    '<div class="mem-flash-n">' + (_cur.cardIdx+1) + ' / ' + pool.length + (st ? '　✓' + (st.ok||0) + ' ✗' + (st.ng||0) : '') + '</div>' +
    '<div class="mem-flash-q">' + esc(c.q) + '</div>' +
    (_cur.cardFlip ? '<div class="mem-flash-a">' + esc(c.a).replace(/\n/g,'<br>') + '</div>' + (c.ref ? '<div class="mem-refs">' + _refChips(c.ref) + '</div>' : '')
                   : '<div class="mem-flash-hint">點卡片看答案</div>') +
    '</div>' +
    '<div class="mem-flash-btns">' +
      (_cur.cardFlip ? '<button class="btn bg" data-act="ng">✗ 不熟</button><button class="btn bp" data-act="ok">✓ 記得</button>'
                     : '<button class="btn bg" data-act="prev">‹ 上一張</button><button class="btn bg" data-act="next">下一張 ›</button>') +
    '</div>';
  return h;
}
function _markCard(ok){
  const d = _subj[_cur.sid];
  const pool = _cardPool(d);
  const c = pool[_cur.cardIdx];
  if(!c) return;
  const p = _prog[_cur.sid] || (_prog[_cur.sid] = {});
  const k = _cardKey(c);
  const st = p[k] || (p[k] = { ok:0, ng:0 });
  if(ok){ st.ok = (st.ok||0) + 1; st.ng = 0; } else { st.ng = (st.ng||0) + 1; st.ok = 0; }
  st.t = Date.now();
  _saveProg();
  _cur.cardFlip = false;
  // 只看未熟時，剛熟的那張會從清單消失，索引不用前進
  const stillIn = _cardPool(d).includes(c);
  if(stillIn) _cur.cardIdx++;
  _renderBody();
}

// ════════ 🆕 修法 ════════
function _rUpd(d){
  const u = d.updates || [];
  const tagged = _collectTagged(d, '新法');
  let h = '';
  if(u.length) h += '<div class="sec">修法與憲法判決時間軸</div><div class="card mem-tl">' + u.map(x =>
    '<div class="mem-tl-row"><div class="mem-tl-d">' + esc(x.date) + '</div><div class="mem-tl-x">' + esc(x.text) +
    (x.ref ? '<div class="mem-refs">' + _refChips(x.ref) + '</div>' : '') + '</div></div>').join('') + '</div>';
  if(tagged.length) h += '<div class="sec">樹狀圖裡的新法（' + tagged.length + '）</div>' + tagged.map(x =>
    '<div class="card"><div class="mem-trail">' + esc(x.ch.title) + '</div><div class="mem-trap-t">' + esc(x.n.t) + '</div>' +
    (x.n.d ? '<div class="mem-right">' + esc(x.n.d) + '</div>' : '') + (x.n.ref ? '<div class="mem-refs">' + _refChips(x.n.ref) + '</div>' : '') + '</div>').join('');
  return h || '<div class="mem-empty">本科尚無修法整理</div>';
}

// ════════ 🔢 數字抽考（借用測驗畫面）════════
//   把數字速記轉成四選一題目，丟給 startQWithPool；這些題目不存進題庫、不計入複習進度。
function _numQuiz(){
  const d = _subj[_cur.sid];
  const nums = (d.numbers||[]).filter(n => n.v);
  // 錯誤選項從其他數字的答案挑，答案要至少 4 種才出得了四選一（否則下面的迴圈會停不下來）
  if(new Set(nums.map(n => n.v)).size < 4){ toast('數字太少，無法出題'); return; }
  const pick = arr => arr[Math.floor(Math.random()*arr.length)];
  const shuffled = nums.slice().sort(() => Math.random() - .5).slice(0, 20);
  const pool = shuffled.map((n, i) => {
    const wrong = [];
    while(wrong.length < 3){
      const w = pick(nums).v;
      if(w !== n.v && !wrong.includes(w)) wrong.push(w);
    }
    const opts = [n.v, ...wrong].sort(() => Math.random() - .5);
    const L = ['A','B','C','D'];
    const options = {}; opts.forEach((o, j) => options[L[j]] = o);
    return { id:'virt:mem-num-' + i, type:'mc', subject:d.name, exam:'記憶庫', year:'', num:String(i+1),
      stem: n.k + '？', options, answer: L[opts.indexOf(n.v)], note: (n.ref||''), keywords:[], relatedLaws: n.ref ? parseRefs(n.ref).filter(r=>!r.plain).map(r=>({ref:r.ref})) : [] };
  });
  startQWithPool(pool, '🔢 ' + d.name + '數字');
}

// ════════ 搜尋（跨科）════════
async function memSearch(kw){
  kw = (kw||'').trim();
  const el = document.getElementById('mem-body');
  if(!kw){ _renderBody(); return; }
  await Promise.all(_index.subjects.map(s => _loadSubj(s.id)));
  const k = kw.toLowerCase();
  const hit = s => (s||'').toLowerCase().includes(k);
  const res = [];
  _index.subjects.forEach(s => {
    const d = _subj[s.id];
    const walk = (nodes, ch, trail) => (nodes||[]).forEach(n => {
      if(hit(n.t) || hit(n.d) || hit(n.ref)) res.push({ s, kind:'樹', title:n.t, body:n.d, ref:n.ref, trail:ch.title + (trail.length ? ' › ' + trail.join(' › ') : '') });
      walk(n.c, ch, trail.concat(n.t));
    });
    d.chapters.forEach(ch => walk(ch.tree, ch, []));
    (d.mnemonics||[]).forEach(m => { if(hit(m.title)||hit(m.code)||hit((m.items||[]).join(' '))) res.push({ s, kind:'口訣', title:m.title, body:m.code + '｜' + (m.items||[]).join('、'), ref:m.ref }); });
    (d.numbers||[]).forEach(n => { if(hit(n.k)||hit(n.v)) res.push({ s, kind:'數字', title:n.k, body:n.v, ref:n.ref }); });
    (d.traps||[]).forEach(t => { if(hit(t.title)||hit(t.wrong)||hit(t.right)) res.push({ s, kind:'易錯', title:t.title, body:'✗ ' + t.wrong + '　✓ ' + t.right, ref:t.ref }); });
    (d.cards||[]).forEach(c => { if(hit(c.q)||hit(c.a)) res.push({ s, kind:'閃卡', title:c.q, body:c.a, ref:c.ref }); });
  });
  el.innerHTML = '<div class="mem-prog">「' + esc(kw) + '」共 ' + res.length + ' 筆' + (res.length > 150 ? '（只顯示前 150 筆）' : '') + '</div>' +
    res.slice(0, 150).map(r => '<div class="card"><div class="mem-trail">' + esc(r.s.name) + '・' + r.kind + (r.trail ? '・' + esc(r.trail) : '') + '</div>' +
      '<div class="mem-trap-t">' + esc(r.title) + '</div>' + (r.body ? '<div class="mem-right">' + esc(r.body).replace(/\n/g,'<br>') + '</div>' : '') +
      (r.ref ? '<div class="mem-refs">' + _refChips(r.ref) + '</div>' : '') + '</div>').join('');
}

// ════════ 由外部跳進來：猜題庫「🌳 記憶樹」→ 找到引用這一條的節點 ════════
async function openMemoryAt(key){
  await Promise.all([_loadIndex(), _loadHeat(), _loadProg()]);
  await Promise.all(_index.subjects.map(s => _loadSubj(s.id)));
  let found = null;
  for(const s of _index.subjects){
    const d = _subj[s.id];
    const walk = (nodes, ch, path) => (nodes||[]).some((n, i) => {
      const id = path + '-' + i;
      if(n.ref && parseRefs(n.ref).some(r => r.key === key)){ found = { sid:s.id, ch:ch.id, nid:id }; return true; }
      return walk(n.c, ch, id);
    });
    if(d.chapters.some(ch => walk(ch.tree, ch, ch.id))) break;
  }
  if(!found){ toast('記憶樹裡沒有引用這一條'); return false; }
  _cur.sid = found.sid; _cur.tab = 'tree';
  goPage('memory');
  setTimeout(() => {
    const ch = document.getElementById('mem-ch-' + found.ch);
    if(ch) ch.open = true;
    const n = document.querySelector('#mem-body [data-nid="' + found.nid + '"]');
    if(n){
      let p = n.parentElement;
      while(p && p.id !== 'mem-body'){ if(p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
      n.scrollIntoView({ block:'center' });
      n.classList.add('mem-flashhl');
      setTimeout(() => n.classList.remove('mem-flashhl'), 1800);
    }
  }, 250);
  return true;
}
// 法條是否出現在記憶樹（猜題庫用來決定要不要顯示「🌳」）
async function memoryKeys(){
  await _loadIndex();
  await Promise.all(_index.subjects.map(s => _loadSubj(s.id)));
  const keys = new Set();
  _index.subjects.forEach(s => {
    const walk = nodes => (nodes||[]).forEach(n => { if(n.ref) parseRefs(n.ref).forEach(r => r.key && keys.add(r.key)); walk(n.c); });
    _subj[s.id].chapters.forEach(ch => walk(ch.tree));
  });
  return keys;
}

// ════════ 事件委派 ════════
function _initDelegation(){
  const page = document.getElementById('pg-memory');
  if(!page || page._memBound) return;
  page._memBound = true;
  page.addEventListener('click', e => {
    const ref = e.target.closest('.mem-ref[data-ref]');
    if(ref){ e.preventDefault(); e.stopPropagation(); showLawPop(ref.dataset.ref); return; }
    const sid = e.target.closest('[data-sid]');
    if(sid){ _cur.sid = sid.dataset.sid; _cur.cardIdx = 0; _cur.cardFlip = false; _cur.cardCh = ''; _clearSearch(); _renderSubjChips(); _renderBody(); return; }
    const tab = e.target.closest('[data-tab]');
    if(tab){ _cur.tab = tab.dataset.tab; _clearSearch(); _renderTabs(); _renderBody(); return; }
    const rv = e.target.closest('[data-reveal].hidden');
    if(rv){ rv.classList.remove('hidden'); return; }
    // 自我測驗：點卡片任一處把這張卡的答案都打開
    if(_cur.recall){
      const card = e.target.closest('.mem-mn, .mem-num-row, .mem-trap');
      if(card && card.querySelector('[data-reveal].hidden')){ card.querySelectorAll('[data-reveal].hidden').forEach(x => x.classList.remove('hidden')); return; }
    }
    const act = e.target.closest('[data-act]');
    if(!act) return;
    const a = act.dataset.act;
    if(a === 'expand' || a === 'collapse') document.querySelectorAll('#mem-body details').forEach(x => x.open = a === 'expand');
    else if(a === 'recall'){ _cur.recall = !_cur.recall; _renderBody(); }
    else if(a === 'numquiz') _numQuiz();
    else if(a === 'flip'){ _cur.cardFlip = !_cur.cardFlip; _renderBody(); }
    else if(a === 'ok' || a === 'ng') _markCard(a === 'ok');
    else if(a === 'next' || a === 'prev'){
      const n = _cardPool(_subj[_cur.sid]).length || 1;
      _cur.cardIdx = (_cur.cardIdx + (a === 'next' ? 1 : n - 1)) % n; _cur.cardFlip = false; _renderBody();
    }
    else if(a === 'weak'){ _cur.cardOnlyWeak = !_cur.cardOnlyWeak; _cur.cardIdx = 0; _cur.cardFlip = false; _renderBody(); }
  });
  page.addEventListener('change', e => {
    if(e.target.dataset.act === 'cardch'){ _cur.cardCh = e.target.value; _cur.cardIdx = 0; _cur.cardFlip = false; _renderBody(); }
  });
  const inp = document.getElementById('mem-search');
  if(inp){
    let t = null;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => memSearch(inp.value), 250); });
  }
}
function _clearSearch(){
  const inp = document.getElementById('mem-search');
  if(inp && inp.value) inp.value = '';
}

const Memory = { renderMemory, memSearch, openMemoryAt, memoryKeys };
Object.assign(window, Memory);
})();
