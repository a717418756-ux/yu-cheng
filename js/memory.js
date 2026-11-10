// ══ memory.js — 記憶庫（考試區）══════════════════════════════════
// 依賴：db.js(getSetting/setSetting/da), utils.js(esc/toast), data.js(showLawPop), quiz.js(startQWithPool)
// 資料：data/memory/index.json ＋ 各科 *.min.json（tools/build_data.py 產生）
//   刑法、刑訴、勤務取自 Promotion 升官等記憶樹；警察法規、憲法另行整理。
// 七個分頁：🌳 法條樹｜📝 篇章練習（考古題、猜題依關聯法條對到各章）｜📊 對照表｜⚠️ 易錯爭點｜🔢 數字口訣｜🃏 閃卡｜🆕 修法
//   「期限時效」科目（index.json 標 audit）另有 📋 期限總表、📝 考古對照，讀 data/memory/deadline_audit.json（GPT 復核包）
//   樹狀節點的法條標籤點下去開平台法條彈窗（showLawPop），並標示警大二技考過幾題（🔥，取自猜題庫資料）。
// 閃卡熟練度存在 settings 'memProgress'（隨雲端／本機備份）。
//
// 公開 API 見檔尾 window.Memory

(function(){
'use strict';

const TABS = [
  ['tree',  '🌳 法條樹'],
  ['chap',  '📝 篇章練習'],
  ['cmp',   '📊 對照表'],
  ['trap',  '⚠️ 易錯爭點'],
  ['num',   '🔢 數字口訣'],
  ['card',  '🃏 閃卡'],
  ['upd',   '🆕 修法'],
];
const AUDIT_TABS = [
  ['tot',   '📋 期限總表'],
  ['exam',  '📝 考古對照'],
];
const TAG_CLS = { '必考':'must', '易錯':'trap', '口訣':'mn', '新法':'new' };

let _index = null;          // index.json
const _subj = {};           // id → 科目資料
let _cur = { sid:'police', tab:'tree', recall:false, cardOnlyWeak:false, cardIdx:0, cardFlip:false, cardCh:'' };
// 記住上次看的科目與分頁（只存本機）
try{
  const st = JSON.parse(localStorage.getItem('memState') || '{}');
  if(typeof st.sid === 'string') _cur.sid = st.sid;
  if(TABS.concat(AUDIT_TABS).some(t => t[0] === st.tab)) _cur.tab = st.tab;
}catch(e){}
function _saveState(){ try{ localStorage.setItem('memState', JSON.stringify({ sid:_cur.sid, tab:_cur.tab })); }catch(e){} }
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
      const o = _heat[k] || (_heat[k] = { count:0, recent:0, last:0, ids:[], zuo:0 });
      o.count += a.count; o.recent += a.recent_count || 0;
      o.last = Math.max(o.last, a.last_year || 0);
      o.ids.push(...(a.question_ids||[]));
    }));
    (p.subjects||[]).forEach(s => ((s.zuo||{}).articles||[]).forEach(a => {
      const k = a.law + '|' + a.article_n;
      const o = _heat[k] || (_heat[k] = { count:0, recent:0, last:0, ids:[], zuo:0 });
      o.zuo += a.count;
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
  // 期限時效科目用的簡稱
  '行程':'行政程序法', '行罰':'行政罰法', '行執':'行政執行法', '行訴':'行政訴訟法', '訴願':'訴願法',
  '國賠':'國家賠償法', '社維':'社會秩序維護法', '警職':'警察職權行使法', '集遊':'集會遊行法', '道交':'道路交通管理處罰條例',
  '公保':'公務人員保障法', '公懲':'公務員懲戒法', '政資':'政府資訊公開法', '跟騷':'跟蹤騷擾防制法', '警械':'警械使用條例',
  '家暴':'家庭暴力防治法', '考績法':'公務人員考績法', '處理辦法':'違反社會秩序維護法案件處理辦法',
  '社維處理辦法':'違反社會秩序維護法案件處理辦法', '警械補償辦法':'警械使用事件補償辦法',
  '調查小組辦法':'警械使用調查小組組織及運作辦法', '遴選第三人辦法':'警察遴選第三人蒐集資料辦法', '勤區訪查辦法':'警察勤務區訪查辦法',
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
    const hot = h && (h.count || h.zuo) ? ' <b class="mem-hot" title="警大二技考過 ' + h.count + ' 題（近3年 ' + h.recent + '）・警佐班 ' + (h.zuo||0) + ' 題">🔥' + (h.count || ('佐' + h.zuo)) + '</b>' : '';
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
  if(!_index.subjects.some(s => s.id === _cur.sid)) _cur.sid = _index.subjects[0].id;
  box.innerHTML = _index.subjects.map(s =>
    '<button class="chip' + (s.id===_cur.sid?' on':'') + '" data-sid="' + s.id + '">' + esc(s.name) + '</button>').join('');
  box.querySelector('.on')?.scrollIntoView({ block:'nearest', inline:'center' });
}
function _tabs(){
  const s = _index && _index.subjects.find(x => x.id === _cur.sid);
  return s && s.audit ? TABS.concat(AUDIT_TABS) : TABS;
}
function _renderTabs(){
  const box = document.getElementById('mem-tabs');
  const tabs = _tabs();
  if(!tabs.some(t => t[0] === _cur.tab)) _cur.tab = 'tree';
  box.innerHTML = tabs.map(([k, t]) =>
    '<button class="mem-tab' + (k===_cur.tab?' on':'') + '" data-tab="' + k + '">' + t + '</button>').join('');
}
async function _renderBody(keep){
  const el = document.getElementById('mem-body');
  _saveState();
  const d = await _loadSubj(_cur.sid);
  if(_cur.tab === 'tot' || _cur.tab === 'exam'){
    if(!_audit) el.innerHTML = '<div class="mem-empty">載入 GPT 復核資料…</div>';
    try{
      const [au, qm] = await Promise.all([_loadAudit(), _qmap()]);
      const top = el.scrollTop;
      el.innerHTML = _cur.tab === 'tot' ? _rTot(au, qm) : _rExam(au, qm);
      el.scrollTop = keep ? top : 0;
    }catch(e){
      logError('memory.audit', e);
      el.innerHTML = '<div class="mem-empty">復核資料載入失敗，請確認網路後重試。<br><small>' + esc(e.message) + '</small></div>';
    }
    return;
  }
  if(_cur.tab === 'chap'){
    if(!_chap || _chap.sid !== d.id) el.innerHTML = '<div class="mem-empty">整理篇章題目…</div>';
    const top = el.scrollTop;
    _chap = await _chapData(d);
    if(_cur.tab !== 'chap' || _cur.sid !== d.id) return;
    el.innerHTML = _rChap(d, _chap);
    el.scrollTop = keep ? top : 0;
    return;
  }
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

// ════════ 📝 篇章練習 ════════
//   把題庫的考古題、猜題庫的題目，依「關聯法條」對到法條樹的每個篇章：讀完一章就練那一章。
//   對應方式：篇章樹上出現的法條（法規全名|條號）、釋字／憲判字號，與題目的關聯法條有交集即歸入；
//   一題可能同時屬於好幾章。沒有關聯法條、或法條不在任何一章的題目列在最後「未歸入篇章」。
const _SUBJ_EXAM = { police:['警察法規'], constitution:['憲法、法學緒論'], criminal:['刑法與刑事訴訟法'], procedure:['刑法與刑事訴訟法'], duty:['警察勤務'], deadline:['警察法規', '行政法'] };
const _plainKey = s => String(s||'').replace(/[第號\s　]/g, '').replace(/^司法院|^大法官/, '');
function _refKeys(refs){
  const keys = new Set();
  (refs||[]).forEach(x => parseRefs(typeof x === 'string' ? x : (x && x.ref) || '').forEach(r => {
    if(r.key) keys.add(r.key); else if(r.ref) keys.add('p:' + _plainKey(r.ref));
  }));
  return keys;
}
function _chKeys(ch){
  const refs = [];
  const walk = ns => (ns||[]).forEach(n => { if(n.ref) refs.push(n.ref); walk(n.c); });
  walk(ch.tree);
  return _refKeys(refs);
}
// 沒有關聯法條的題目（勤務、憲法學理題居多）：改用篇章樹的節點名稱當關鍵字比對題幹與選項，
//   歸到命中最多的一章（至少命中一個 3 字以上的節點名稱）。太泛的詞不當關鍵字。
const _KW_STOP = /^(其他|定義|種類|要件|程序|效果|原則|例外|救濟|目的|性質|對象|範圍|方式|期間|期限|內容|概念|意義|主體|客體|罰則|總則|分則|通則|說明|比較|注意|重點|補充)$/;
function _chWords(ch){
  const ws = new Set();
  const add = t => String(t||'').replace(/[（(].*?[)）]/g, '').split(/[、，,／\/：:；;→＝=＋+\s]+/).forEach(w => {
    w = w.replace(/[「」『』《》〈〉.。?？!！]/g, '').replace(/§.*$/, '');
    if(w.length >= 3 && w.length <= 12 && !_KW_STOP.test(w) && !/^[\d.]+$/.test(w)) ws.add(w);
  });
  const walk = ns => (ns||[]).forEach(n => { add(n.t); walk(n.c); });
  add(ch.title); walk(ch.tree);
  return [...ws];
}
let _chap = null;      // 目前科目的篇章對應結果（切科目、重繪時重建）
async function _chapData(d){
  const names = _SUBJ_EXAM[d.id] || [d.name];
  // 同一個考科拆成兩個記憶科目時（刑法＋刑訴），「未歸入」要兩邊都對不到才算
  const sibs = (_index.subjects||[]).filter(s => s.id !== d.id && !s.audit && (_SUBJ_EXAM[s.id]||[]).some(n => names.includes(n)));
  const sibKeys = new Set();
  for(const s of sibs){ try{ (await _loadSubj(s.id)).chapters.forEach(ch => _chKeys(ch).forEach(k => sibKeys.add(k))); }catch(e){} }
  const chs = d.chapters.map(ch => ({ ch, keys:_chKeys(ch), words:_chWords(ch), exam:[], guess:[], kw:0 }));
  const byWord = text => {      // 關鍵字命中最多的一章（同分取字數較長者），沒命中回傳 null
    let best = null, bs = 0;
    chs.forEach(c => { let sc = 0; c.words.forEach(w => { if(text.includes(w)) sc += w.length; }); if(sc > bs){ bs = sc; best = c; } });
    return best;
  };
  const hit = (set, ks) => { for(const k of ks) if(set.has(k)) return true; return false; };
  const un = [];
  let qs = []; try{ qs = await da('questions'); }catch(e){}
  qs.filter(q => names.includes(q.subject) && !(q.tags||[]).includes('猜題')).forEach(q => {
    const ks = _refKeys(q.relatedLaws);
    let any = false;
    if(ks.size) chs.forEach(c => { if(hit(c.keys, ks)){ c.exam.push(q); any = true; } });
    if(any || (ks.size && hit(sibKeys, ks))) return;
    const c = byWord((q.groupStem||'') + (q.stem||'') + Object.values(q.options||{}).join(''));
    if(c){ c.exam.push(q); c.kw++; } else un.push(q);
  });
  let v = null; try{ v = await _json('data/variants.json'); }catch(e){}
  ((v && v.items)||[]).filter(it => names.includes(it.subject)).forEach(it => {
    const ks = _refKeys(it.laws);
    let any = false;
    if(ks.size) chs.forEach(c => { if(hit(c.keys, ks)){ c.guess.push(it.gid); any = true; } });
    if(!any && !(ks.size && hit(sibKeys, ks))){ const c = byWord((it.stem||'') + Object.values(it.options||{}).join('')); if(c) c.guess.push(it.gid); }
  });
  return { sid:d.id, chs, un, v };
}
const _qDone = q => !!q.lastReview;
const _qWeak = q => (q.wrongCount||0) > 0 && !((q.correctStreak||0) > 0);
function _rChap(d, cd){
  const row = (title, lead, exam, guess, i) => {
    const done = exam.filter(_qDone).length, weak = exam.filter(_qWeak).length, todo = exam.filter(q => !_qDone(q) || _qWeak(q)).length;
    const pct = exam.length ? Math.round(done / exam.length * 100) : 0;
    return '<div class="cc mem-chp"><div class="mem-chp-t">' + esc(title) + '</div>' +
      (lead ? '<div class="mem-ch-lead">' + esc(lead) + '</div>' : '') +
      '<div class="mem-chp-stat"><span>考古題 <b>' + exam.length + '</b></span><span>已做 <b>' + done + '</b></span>' +
        '<span' + (weak ? ' class="warn"' : '') + '>待加強 <b>' + weak + '</b></span>' + (guess.length ? '<span>猜題 <b>' + guess.length + '</b></span>' : '') + '</div>' +
      (exam.length ? '<div class="mem-chp-bar" role="img" aria-label="已做 ' + pct + '%"><i style="width:' + pct + '%"></i></div>' : '') +
      '<div class="mem-chp-acts">' +
        (exam.length ? '<button class="btn bp" data-chq="' + i + '" data-kind="all">▶ 考古題 ' + exam.length + '</button>' : '<span class="mem-au-miss">本章沒有對到考古題</span>') +
        (todo && todo < exam.length ? '<button class="btn bg" data-chq="' + i + '" data-kind="todo">沒做過＋錯題 ' + todo + '</button>' : '') +
        (guess.length ? '<button class="btn bg" data-chq="' + i + '" data-kind="guess">🎲 猜題 ' + guess.length + '</button>' : '') +
        (i >= 0 ? '<button class="btn bg" data-chq="' + i + '" data-kind="tree">🌳 看本章</button>' : '') +
      '</div></div>';
  };
  const total = new Set(cd.chs.flatMap(c => c.exam.map(q => q.id))).size;
  return '<div class="mem-intro">📝 <b>篇章練習</b>：讀完一章，直接練那一章的考古題和猜題。題目依「關聯法條」自動對到篇章（共對到 ' + total + ' 題），一題可能屬於好幾章；' +
    '沒有關聯法條的題目改用篇章關鍵字對應（' + cd.chs.reduce((a, c) => a + c.kw, 0) + ' 題），可能有少數不完全對應。作答會照常記入複習進度；猜題是臨時練習，不存題庫。<div class="mem-src">「待加強」＝答錯過、之後還沒再答對的題目。</div></div>' +
    cd.chs.map((c, i) => row(c.ch.title, c.ch.lead, c.exam, c.guess, i)).join('') +
    (cd.un.length ? row('未歸入篇章', '沒有關聯法條，或法條不在上面任何一章的題目', cd.un, [], -1) : '');
}
async function _chapGo(i, kind){
  const cd = _chap;
  if(!cd) return;
  const c = i < 0 ? { ch:{ title:'未歸入篇章' }, exam:cd.un, guess:[] } : cd.chs[i];
  if(!c) return;
  if(kind === 'tree'){
    _cur.tab = 'tree'; _renderTabs(); await _renderBody();
    const el = document.getElementById('mem-ch-' + c.ch.id);
    if(el){ document.querySelectorAll('#mem-body details.mem-ch').forEach(x => x.open = x === el); el.scrollIntoView({ block:'start' }); }
    return;
  }
  let pool;
  if(kind === 'guess'){
    const want = new Set(c.guess);
    if(typeof variantToQ !== 'function'){ toast('猜題庫尚未載入'); return; }
    pool = ((cd.v && cd.v.items)||[]).filter(it => want.has(it.gid)).map((it, n) => Object.assign(variantToQ(it), { id:'virt:ch-g-' + n, num:String(n + 1) }));
  } else {
    pool = (kind === 'todo' ? c.exam.filter(q => !_qDone(q) || _qWeak(q)) : c.exam).slice();
  }
  if(!pool.length){ toast('沒有對應的題目'); return; }
  for(let k = pool.length - 1; k > 0; k--){ const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
  startQWithPool(pool, (kind === 'guess' ? '🎲 ' : '📝 ') + c.ch.title);
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

// ════════ 📋 期限總表／📝 考古對照（GPT 期限時效復核包）════════
//   資料：data/memory/deadline_audit.json（tools/build_deadline.py 由 tools/deadline/gpt/ 產生）
//   dl 欄位：[id, 科別idx, 類型idx, 法規idx, 條號, 時間文字, 法條原句, 修正日idx, 考題數, 時間題數, 題庫ID[], 原稿附錄有列, 原稿主文有定位, 官方抽核, 注意, 優先]
//   題庫ID 對應使用者題庫（questions.id），按「▶ 練習」直接出題；題庫裡沒有的題目略過。
let _audit = null;
const _au = { view:'dl', kb:'', type:'', law:'', kw:'', onlyQ:false, onlyNote:false, lim:50 };
const _ex = { view:'tq', main:'', subj:'', kw:'', year:'', lim:40 };
const _KB = ['警察法規', '行政法', '跨科參照'];
async function _loadAudit(){
  if(!_audit) _audit = await _json('data/memory/deadline_audit.json');
  return _audit;
}
// 每次重繪都重建（da 本身有快取、寫入時會失效），題庫匯入或刪題後按鈕題數才會正確
async function _qmap(){
  try{ return new Map((await da('questions')).map(q => [String(q.id), q])); }catch(e){ return new Map(); }
}
function _goBtn(ids, label, qm){
  const n = [...new Set(ids)].filter(id => qm.has(String(id))).length;
  if(!n) return ids.length ? '<span class="mem-au-miss">題庫無此 ' + ids.length + ' 題</span>' : '';
  return '<button class="btn bg mem-au-go" data-qids="' + ids.join(',') + '" data-label="' + esc(label) + '">▶ 練習 ' + n + ' 題</button>';
}
function _auSeg(cur, list, key){
  return '<div class="mem-au-seg">' + list.map(([k, t]) =>
    '<button class="' + (k === cur ? 'on' : '') + '" data-' + key + '="' + k + '">' + t + '</button>').join('') + '</div>';
}
function _more(shown, total, act){
  return shown < total ? '<div style="padding:6px 12px 16px"><button class="btn bg" style="width:100%" data-act="' + act + '">顯示更多（' + shown + '／' + total + '）</button></div>'
                       : '<div class="mem-prog" style="text-align:center;padding-bottom:16px">共 ' + total + ' 筆</div>';
}
function _hit(kw, ...xs){ return !kw || xs.some(x => String(x||'').toLowerCase().includes(kw)); }
function _opt(v, cur, label){ return '<option value="' + esc(String(v)) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(String(label)) + '</option>'; }

function _rTot(au, qm){
  const m = au.metrics;
  let h = _auSeg(_au.view, [['dl','全部候選 ' + au.dl.length], ['pri','優先 ' + au.dl.filter(r => r[15]).length], ['same','同數字反查 ' + au.same.length], ['src','法源查漏 ' + au.src.length]], 'auv');
  h += '<details class="mem-intro mem-au-note"><summary>⚠️ 這是 GPT 工作底稿（' + esc(au.date) + '），使用前先看</summary><ul>' +
    au.notes.caution.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
    '<div class="mem-au-kpi">' + [['兩科題數', m['兩科全部題數']], ['期限候選', m['法條時間候選列數']], ['主法候選', m['兩科主法時間候選列數']],
      ['官方抽核', m['已抽核官方條文相關時間列數']], ['時間題', m['兩科時間文字題數']], ['修法提醒', m['舊法警示題數']]]
      .map(([k, v]) => '<div><b>' + v + '</b><span>' + k + '</span></div>').join('') + '</div>' +
    '<div class="mem-au-h">重大發現與本 App 處理</div>' +
    au.notes.findings.map(f => '<div class="mem-au-find"><b>' + esc(f[0]) + '</b>：' + esc(f[1]) + '<span>→ ' + esc(f[2]) + '</span></div>').join('') +
    '</details>';
  const kw = _au.kw.toLowerCase();
  if(_au.view === 'same'){
    const rows = au.same.filter(r => _hit(kw, r[0], r[2]));
    h += '<div class="mem-tools"><input class="mem-search" data-auf="kw" placeholder="篩選（如：三十日、訴願法）" value="' + esc(_au.kw) + '"></div>' +
      '<div class="mem-prog">同一個時間字樣出現在哪些法條：同數字不同起算點、對象、效果，要分開背。</div>' +
      rows.slice(0, _au.lim).map(r => '<div class="card mem-au"><div class="mem-au-head"><span class="mem-au-time">' + esc(r[0]) + '</span><span class="mem-au-sub">' + r[1] + ' 筆候選</span></div>' +
        '<div class="mem-refs">' + _refChips(r[2].replace(/；/g, '、')) + '</div></div>').join('') + _more(Math.min(_au.lim, rows.length), rows.length, 'aumore');
    return h;
  }
  if(_au.view === 'src'){
    const rows = au.src.filter(r => _hit(kw, r[0]));
    h += '<div class="mem-tools"><input class="mem-search" data-auf="kw" placeholder="篩選法源" value="' + esc(_au.kw) + '"></div>' +
      '<div class="mem-prog">兩科考古題引用的 ' + au.src.length + ' 種法源；「未抽出」多為釋字或不含期間的規定，不等於漏掉的期限。</div>' +
      '<div class="card"><table class="mem-tbl mem-au-tbl"><thead><tr><th>法源</th><th>考題引用</th><th>期限句</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + _refChips(r[0]) + '</td><td>' + r[1] + '</td><td>' + (r[2] ? '✓ 已抽出' : (r[3] ? '未抽出' : '釋字／憲判')) + '</td></tr>').join('') +
      '</tbody></table></div>';
    return h;
  }
  // 全部候選／優先
  const lawCnt = {};
  au.dl.forEach(r => lawCnt[r[3]] = (lawCnt[r[3]]||0) + 1);
  const lawOpts = Object.keys(lawCnt).sort((a, b) => lawCnt[b] - lawCnt[a]).map(i => _opt(i, _au.law, au.laws[i] + '（' + lawCnt[i] + '）')).join('');
  h += '<div class="mem-tools"><input class="mem-search" data-auf="kw" placeholder="搜尋時間或原句（如：三個月、補正）" value="' + esc(_au.kw) + '"></div>' +
    '<div class="mem-tools">' +
    '<select class="mem-sel" data-auf="kb"><option value="">全部科別</option>' + _KB.map((k, i) => _opt(i, _au.kb, k)).join('') + '</select>' +
    '<select class="mem-sel" data-auf="type"><option value="">全部類型</option>' + au.types.map((t, i) => _opt(i, _au.type, t)).join('') + '</select>' +
    '<select class="mem-sel" data-auf="law"><option value="">全部法規</option>' + lawOpts + '</select>' +
    '<button class="btn ' + (_au.onlyQ ? 'bp' : 'bg') + '" data-act="auq">有考題</button>' +
    '<button class="btn ' + (_au.onlyNote ? 'bp' : 'bg') + '" data-act="aunote">有注意事項</button>' +
    '</div>';
  const rows = au.dl.filter(r => (_au.view !== 'pri' || r[15]) && (_au.kb === '' || r[1] === +_au.kb) && (_au.type === '' || r[2] === +_au.type) &&
    (_au.law === '' || r[3] === +_au.law) && (!_au.onlyQ || r[8]) && (!_au.onlyNote || r[14]) && _hit(kw, r[5], r[6], au.laws[r[3]] + r[4], r[14]));
  const ids = [...new Set(rows.flatMap(r => r[10]))];
  h += '<div class="mem-au-sum"><span>' + rows.length + ' 筆，連到考古題 ' + ids.length + ' 題</span>' + _goBtn(ids, '期限候選篩選', qm) + '</div>';
  h += rows.slice(0, _au.lim).map(r => {
    const law = au.laws[r[3]];
    const pc = au.pcode[law];
    return '<div class="card mem-au">' +
      '<div class="mem-au-head"><span class="mem-au-time">' + esc(r[5]) + '</span>' + _refChips(law + r[4]) +
        (r[15] ? '<span class="mem-tag must">優先</span>' : '') + (r[13] ? '<span class="mem-tag new">官方抽核</span>' : '') + '</div>' +
      '<div class="mem-au-text">' + esc(r[6]) + '</div>' +
      (r[14] ? '<div class="mem-au-warn">⚠️ ' + esc(r[14]) + '</div>' : '') +
      '<div class="mem-au-meta">' + esc(r[0]) + '・' + _KB[r[1]] + '・' + esc(au.types[r[2]]) + '・法庫 ' + esc(au.dates[r[7]].replace('民國', '')) +
        '・原稿' + (r[11] ? '附錄有列' : (r[12] ? '主文有' : '未見')) + '</div>' +
      '<div class="mem-au-acts">' + (r[8] ? '<span class="mem-au-sub">考古 ' + r[8] + ' 題（時間題 ' + r[9] + '）</span>' + _goBtn(r[10], law + r[4] + ' ' + r[5], qm) : '<span class="mem-au-sub">無直接考題</span>') +
        (pc ? '<a class="mem-au-link" href="' + esc(pc) + '" target="_blank" rel="noopener">全國法規 ↗</a>' : '') + '</div>' +
      '</div>';
  }).join('');
  return h + _more(Math.min(_au.lim, rows.length), rows.length, 'aumore');
}

function _rExam(au, qm){
  let h = _auSeg(_ex.view, [['tq','時間題 ' + au.tq.length], ['risk','修法提醒 ' + au.risk.length], ['oa','官答比對 ' + au.oa.length]], 'exv');
  const kw = _ex.kw.toLowerCase();
  const mainSel = '<select class="mem-sel" data-exf="main"><option value="">全部考試</option>' + _opt('1', _ex.main, '主目標：升官等105–113') + _opt('0', _ex.main, '跨考補充') + '</select>';
  const subjSel = '<select class="mem-sel" data-exf="subj"><option value="">兩科</option>' + ['警察法規', '行政法'].map(s => _opt(s, _ex.subj, s)).join('') + '</select>';
  const search = '<input class="mem-search" data-exf="kw" placeholder="搜尋題幹或法條" value="' + esc(_ex.kw) + '">';
  if(_ex.view === 'oa'){
    const years = [...new Set(au.oa.map(r => r[0]))].sort();
    const rows = au.oa.filter(r => (!_ex.year || r[0] === _ex.year) && (!_ex.subj || r[1] === _ex.subj) && _hit(kw, r[4]));
    h += '<div class="mem-intro">105、107、109、111、113 年升官等「警察法規＋行政法」500 題，GPT 逐題對照考選部當年最終答案：<b>500／500 相符</b>。這只代表當年公告答案一致，現行法是否仍正確要看「修法提醒」。' +
      '<div class="mem-au-h">官方複數給分（題庫答案不要覆蓋）</div>' +
      au.notes.multi.map(x => '<div>・' + x.year + ' 年' + x.subj + ' 第' + x.num + ' 題：' + esc(x.off) + '</div>').join('') +
      '<div class="mem-refs" style="margin-top:6px">' + years.map(y => '<a class="mem-ref" href="' + esc(au.exam_links[y]) + '" target="_blank" rel="noopener">' + y + ' 年答案清冊 ↗</a>').join('') + '</div></div>' +
      '<div class="mem-tools">' + search + '</div><div class="mem-tools"><select class="mem-sel" data-exf="year"><option value="">全部年度</option>' +
      years.map(y => _opt(y, _ex.year, y + ' 年')).join('') + '</select>' + subjSel + '</div>';
    h += '<div class="mem-au-sum"><span>' + rows.length + ' 題</span>' + _goBtn(rows.map(r => r[3]), '升官等官答比對', qm) + '</div>';
    const lim = _ex.lim * 3;
    h += '<div class="card"><table class="mem-tbl mem-au-tbl"><thead><tr><th>題</th><th>題幹</th><th>答</th></tr></thead><tbody>' +
      rows.slice(0, lim).map(r => '<tr' + (r[7] ? ' class="mem-au-multi"' : '') + '><td>' + r[0] + esc(r[1].slice(0, 2)) + '<br>' + r[2] + '</td><td>' + esc(r[4]) +
        (r[7] ? '<div class="mem-au-warn">' + esc(r[7]) + '：官方 ' + esc(r[6]) + '</div>' : '') + '</td><td>' + esc(r[5]) + (r[5] === r[6] || r[7] ? ' ✓' : '／官 ' + esc(r[6])) + '</td></tr>').join('') +
      '</tbody></table></div>';
    return h + _more(Math.min(lim, rows.length), rows.length, 'exmore');
  }
  if(_ex.view === 'risk'){
    const rows = au.risk.filter(r => (_ex.main === '' || r[0] === +_ex.main) && (!_ex.subj || r[1].includes(_ex.subj)) && _hit(kw, r[4], r[6], r[7]));
    h += '<div class="mem-prog">題目註解出現「修法、舊法」等字樣的考古題。不代表答案錯，但要確認當年答案在現行法下是否仍成立。</div>' +
      '<div class="mem-tools">' + search + '</div><div class="mem-tools">' + mainSel + subjSel + '</div>' +
      '<div class="mem-au-sum"><span>' + rows.length + ' 題</span>' + _goBtn(rows.map(r => r[3]), '修法提醒題', qm) + '</div>' +
      rows.slice(0, _ex.lim).map(r => '<div class="card mem-au">' +
        '<div class="mem-au-head"><b>' + esc(r[1]) + ' 第' + esc(r[2]) + '題</b>' + (r[0] ? '<span class="mem-tag must">升官等</span>' : '') + '<span class="mem-au-sub">答 ' + esc(r[5]) + '</span></div>' +
        '<div class="mem-au-text">' + esc(r[4]) + '</div>' +
        (r[7] ? '<div class="mem-refs">' + _refChips(r[7]) + '</div>' : '') +
        '<details class="mem-au-det"><summary>原題註解（修法說明）</summary><div>' + esc(r[6]).replace(/\n/g, '<br>') + '</div></details>' +
        '<div class="mem-au-acts">' + _goBtn([r[3]], r[1] + ' 第' + r[2] + '題', qm) + '</div></div>').join('') +
      _more(Math.min(_ex.lim, rows.length), rows.length, 'exmore');
    return h;
  }
  const rows = au.tq.filter(r => (_ex.main === '' || r[1] === +_ex.main) && (!_ex.subj || r[2] === _ex.subj) && _hit(kw, r[7], r[8], r[10], r[12]));
  h += '<div class="mem-prog">題幹或選項有明確時間字樣的考古題（升官等、二技、警佐班、三等）。「優先複查」是 GPT 認為可能受修法影響的題目。</div>' +
    '<div class="mem-tools">' + search + '</div><div class="mem-tools">' + mainSel + subjSel + '</div>' +
    '<div class="mem-au-sum"><span>' + rows.length + ' 題</span>' + _goBtn(rows.map(r => r[6]), '時間考古題', qm) + '</div>' +
    rows.slice(0, _ex.lim).map(r => '<div class="card mem-au">' +
      '<div class="mem-au-head"><b>' + esc(r[3] + r[4] + ' ' + r[2] + ' 第' + r[5] + '題') + '</b>' +
        (r[1] ? '<span class="mem-tag must">升官等</span>' : '') + (r[13] ? '<span class="mem-tag trap">優先複查</span>' : '') +
        '<span class="mem-au-sub">答 ' + esc(r[9]) + (r[14] ? '（官答 ' + esc(r[14]) + (r[15].startsWith('符合') ? ' ✓' : '') + '）' : '') + '</span></div>' +
      '<div class="mem-au-text">' + esc(r[7]) + '</div>' +
      '<div class="mem-au-meta">選項時間：' + esc(r[8]) + '</div>' +
      (r[10] ? '<div class="mem-refs">' + _refChips(r[10]) + '</div>' : '') +
      (r[12] ? '<details class="mem-au-det"><summary>原題詳解摘錄</summary><div>' + esc(r[12]).replace(/\n/g, '<br>') + '</div></details>' : '') +
      '<div class="mem-au-acts">' + _goBtn([r[6]], r[3] + r[4] + ' 第' + r[5] + '題', qm) + '</div></div>').join('') +
    _more(Math.min(_ex.lim, rows.length), rows.length, 'exmore');
  return h;
}
async function _practiceQ(ids, label){
  const qm = await _qmap();
  const pool = [...new Set(ids)].map(id => qm.get(String(id))).filter(Boolean);
  if(!pool.length){ toast('題庫裡找不到這些題目'); return; }
  for(let i = pool.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  startQWithPool(pool, '⏱ ' + label);
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
    if(sid){ _cur.sid = sid.dataset.sid; _cur.cardIdx = 0; _cur.cardFlip = false; _cur.cardCh = ''; _clearSearch(); _renderSubjChips(); _renderTabs(); _renderBody(); return; }
    const tab = e.target.closest('[data-tab]');
    if(tab){ _cur.tab = tab.dataset.tab; _clearSearch(); _renderTabs(); _renderBody(); return; }
    const rv = e.target.closest('[data-reveal].hidden');
    if(rv){ rv.classList.remove('hidden'); return; }
    // 自我測驗：點卡片任一處把這張卡的答案都打開
    if(_cur.recall){
      const card = e.target.closest('.mem-mn, .mem-num-row, .mem-trap');
      if(card && card.querySelector('[data-reveal].hidden')){ card.querySelectorAll('[data-reveal].hidden').forEach(x => x.classList.remove('hidden')); return; }
    }
    // 期限總表／考古對照
    const au = e.target.closest('[data-auv],[data-exv],[data-qids]');
    if(au){
      const ds = au.dataset;
      if(ds.auv){ _au.view = ds.auv; _au.kw = ''; _au.lim = 50; _renderBody(); }
      else if(ds.exv){ _ex.view = ds.exv; _ex.lim = 40; _renderBody(); }
      else _practiceQ(ds.qids.split(','), ds.label || '');
      return;
    }
    const chq = e.target.closest('[data-chq]');
    if(chq){ _chapGo(+chq.dataset.chq, chq.dataset.kind); return; }
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
    else if(a === 'aumore'){ _au.lim += 50; _renderBody(true); }
    else if(a === 'exmore'){ _ex.lim += 40; _renderBody(true); }
    else if(a === 'auq'){ _au.onlyQ = !_au.onlyQ; _au.lim = 50; _renderBody(true); }
    else if(a === 'aunote'){ _au.onlyNote = !_au.onlyNote; _au.lim = 50; _renderBody(true); }
    else if(a === 'weak'){ _cur.cardOnlyWeak = !_cur.cardOnlyWeak; _cur.cardIdx = 0; _cur.cardFlip = false; _renderBody(); }
  });
  page.addEventListener('change', e => {
    const f = e.target.dataset.auf, g = e.target.dataset.exf;
    if(f && f !== 'kw'){ _au[f] = e.target.value; _au.lim = 50; _renderBody(true); return; }
    if(g && g !== 'kw'){ _ex[g] = e.target.value; _ex.lim = 40; _renderBody(true); return; }
    if(e.target.dataset.act === 'cardch'){ _cur.cardCh = e.target.value; _cur.cardIdx = 0; _cur.cardFlip = false; _renderBody(); }
  });
  // 總表／考古對照的文字篩選：防抖後重繪，游標放回輸入框
  let ft = null;
  page.addEventListener('input', e => {
    const f = e.target.dataset.auf, g = e.target.dataset.exf;
    if(f !== 'kw' && g !== 'kw') return;
    clearTimeout(ft);
    ft = setTimeout(async () => {
      if(f){ _au.kw = e.target.value; _au.lim = 50; } else { _ex.kw = e.target.value; _ex.lim = 40; }
      await _renderBody(true);
      const box = document.querySelector('#mem-body [data-' + (f ? 'auf' : 'exf') + '="kw"]');
      if(box){ box.focus(); const n = box.value.length; box.setSelectionRange(n, n); }
    }, 300);
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
