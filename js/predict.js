// ══ predict.js — 考點排名（v4.74 起畫在「考點記憶庫」頁的分頁裡；原「考古題排名」頁）════════════
//   memory.js 呼叫 predictViews(考試, 科目) 取得這一科有哪些排名分頁、predictRenderInto(el, 考試, 科目, 分頁) 畫出來。
//   考試：二技／警佐／升官（警正升官等）。法條、法規排名依題庫的關聯法條（三個考試都有）；
//   題型、考點、回測、趨勢是 11/5 預測資料包的分析（只有二技、警佐班有）。
//   v4.33：猜題庫（116 猜題／變化題）與「二類方向」已移除，只保留依歷屆考古題統計的排名與練習
// 依賴：db.js(da/bulkPut/_db/_cacheInvalidate), utils.js(esc/toast), data.js(showLawPop), quiz.js(startQWithPool),
//       memory.js(openMemoryAt/memoryKeys)
// 資料：data/predict.json（警大二技預測資料包的排名與回測，題目只留 ID）
//       predict.json 各科 zuo（警佐班條文排名，題目以「年-題號」對應平台題庫）、reasons（近三年出題理由回測）、xval（交互驗證）
// 功能：
//   ①各科押題清單：法條（或題型、出處、規範、學理名詞）依考過題數排名，附近3年題數與年度分布
//   ②一鍵押題練習：前 K 名相關的歷屆考題（從平台題庫取），可只出答錯過的
//   ③回測命中率：誠實標示「押前 K 名」過去能蓋到幾成題目
//   ④二技／警佐班切換（警佐班只列佐二類的四科）
//   v4.73：⚖ 法條、📚 法規改成依「題庫」每一題的關聯法條即時統計（memory.js examStats，和記憶庫 🔥 同一份數字）：
//     不再只有前 120 條、警佐班也有法規排名、題庫更正後自動跟著變；回測、趨勢、出題理由仍是 11/5 預測資料包的分析（畫面上標明）。
//
// 公開 API 見檔尾 window.Predict

(function(){
'use strict';

let _data = null;
let _keys = null;                         // 記憶樹引用到的法條（顯示 🌳 用）
let _cur = { si:0, k:20, sort:'count', onlyWrong:false, view:'articles', exam:'二技', scope:'', scopeOwn:true, scopeRel:false, n:0 };   // v4.75 考試範圍預設只看所選考試的歷屆題   // n：每次練習題數（0＝全部）
// 記住上次的考試別、科目、分頁、押前幾條、練習題數（只存本機；讀不到就用預設）
try{
  const st = JSON.parse(localStorage.getItem('prState') || '{}');
  ['si','k','n'].forEach(k => { if(Number.isFinite(st[k])) _cur[k] = st[k]; });
  if(typeof st.view === 'string') _cur.view = st.view;
  if(typeof st.scope === 'string') _cur.scope = st.scope;
  ['scopeOwn','scopeRel'].forEach(k => { if(typeof st[k] === 'boolean') _cur[k] = st[k]; });
}catch(e){}
function _saveState(){
  try{ localStorage.setItem('prState', JSON.stringify({ si:_cur.si, k:_cur.k, exam:_cur.exam, view:_cur.view, scope:_cur.scope, scopeOwn:_cur.scopeOwn, scopeRel:_cur.scopeRel, n:_cur.n })); }catch(e){}
}
const _isZuo = () => _cur.exam === '警佐';
const _isUp = () => _cur.exam === '升官';
const _EXAM_LABEL = { '二技':'警大二技', '警佐':'警佐班', '升官':'升官等' };
// 預測資料包裡的科目（升官等、行政法等資料包沒有的，給一個只有名稱的科目）
const _packSubj = name => (_data && _data.subjects.find(x => x.name === name)) || { name };
let _lastExam = null;   // 上一次畫的考試（換考試才重設考試範圍）
let _host = null;   // { el, name }：考點記憶庫裡目前畫排名的位置
async function _load(){
  if(!_data){
    const r = await fetch('data/predict.json');
    if(!r.ok) throw new Error('predict.json ' + r.status);
    _data = await r.json();
  }
  if(!_keys){
    try{ _keys = await memoryKeys(); }catch(e){ _keys = new Set(); }
  }
  return _data;
}

// 平台題庫：預測資料包的題目 ID（字串）→ 題目
async function _qById(){
  const qs = await da('questions');
  const m = new Map();
  qs.forEach(q => m.set(String(q.id), q));
  return m;
}
async function _wrongSet(){
  const ats = await da('attempts');
  const s = new Set();
  ats.forEach(a => { if(a.correct === false) s.add(String(a.qid)); });
  return s;
}

// ════════ 考點記憶庫用的介面（v4.74）════════
async function predictViews(exam, name){
  await _load();
  const s = _packSubj(name), st = await examStats();
  const sj = st[{ '二技':'e2', '警佐':'zuo', '升官':'up' }[exam]].bySubj[name];
  const v = [];
  if(sj && sj.arts.size) v.push(['articles', '⚖ 法條排名'], ['laws', '📚 法規']);
  if(name === '警察法規') v.push(['scope', '🎯 考試範圍']);
  if(exam === '二技'){
    if(s.topics) v.push(['topics', '🧩 題型']);
    Object.keys(s.points||{}).forEach(k => v.push(['pt:' + k, '📌 ' + k]));
    if(s.trend) v.push(['trend', '📈 趨勢']);
  }else if(exam === '警佐' && (s.reasons||{})['警佐班']) v.push(['trend', '📈 趨勢']);
  return v;
}
async function predictRenderInto(el, exam, name, view){
  try{
    await _load();
    _bind(el.closest('.page'));
    _host = { el, name };
    // 換考試時，考試範圍跟著換成那個考試的公告範圍
    if(_lastExam !== exam) _cur.scope = { '二技':'2tech', '警佐':'zuo', '升官':'up' }[exam] || '';
    _lastExam = exam; _cur.exam = exam; _cur.view = view;
    const i = _data.subjects.findIndex(x => x.name === name); _cur.si = i < 0 ? 0 : i;
    await _rBody();
  }catch(e){
    logError('predictRenderInto', e);
    el.innerHTML = '<div class="mem-empty">考點排名資料載入失敗，請確認網路後重新整理。<br><small>' + esc(e.message) + '</small></div>';
  }
}

// ════════ 頁面（舊的考古題排名頁；v4.74 起導到考點記憶庫）════════
async function renderPredict(){
  goPage('memory');
}
async function _rBody(){
  if(!_host) return;
  const s = _packSubj(_host.name);
  _saveState();
  const el = _host.el;
  // 題型、考點、趨勢、回測是預測資料包的分析：標明來源；法條、法規、考試範圍依題庫（各自的說明在分頁裡）
  const pack = /^(topics|pt:|trend)/.test(_cur.view);
  const m = _data.meta;
  let h = pack ? '<div class="pr-note">📈 這一頁是預測資料包（' + esc(m.generated_at || '') + '）的分析：' + esc(_EXAM_LABEL[_cur.exam]) + ' ' + esc(s.name) + '。' +
    '排名只代表「優先順序」，不是必考清單。</div>' : '';
  if(_cur.view === 'articles') h += await _rArticles(s);
  else if(_cur.view === 'laws') h += await _rLaws(s);
  else if(_cur.view === 'scope') h += await _rScope(s);
  else if(_cur.view === 'topics') h += _rTopics(s);
  else if(_cur.view.startsWith('pt:')) h += await _rPoints(s, _cur.view.slice(3));
  else if(_cur.view === 'trend') h += await _rTrend(s);
  el.innerHTML = '<div class="pr-scope">' + h + '</div>';
}

// 回測命中率卡片
function _btCard(bt, level, label){
  const b = bt && bt[level];
  if(!b) return '';
  return '<div class="cc"><div class="ct">🎯 回測：只用以前的題目押前 K ' + esc(label) + '，隔年能蓋到幾成</div><div class="pr-bt">' +
    ['10','20','50'].filter(k => b[k]).map(k => '<div><b>' + Math.round(b[k].hit*100) + '%</b><span>前 ' + k + '（隨機 ' + Math.round(b[k].rand*100) + '%）</span></div>').join('') +
    '</div></div>';
}
function _yearBars(by, years){
  const max = Math.max(1, ...Object.values(by||{}));
  return '<div class="pr-years" title="各年度題數">' + years.map(y => {
    const n = (by||{})[y] || 0;
    return n ? '<i style="height:' + Math.round(4 + 14*n/max) + 'px" title="' + y + '年 ' + n + '題"></i>' : '<i class="z" title="' + y + '年 0題"></i>';
  }).join('') + '</div>';
}
function _kChips(){
  return '<div class="mem-tools pr-k">' + [10,20,50,120,0].map(k => '<button class="chip' + (k===_cur.k?' on':'') + '" data-k="' + k + '">' + (k ? '前 ' + k : '全部') + '</button>').join('') +
    '<button class="chip' + (_cur.sort==='recent'?' on':'') + '" data-sort="1">' + (_cur.sort==='recent'?'依近3年':'依總題數') + ' ⇅</button></div>';
}
function _sorted(rows){
  const r = rows.slice();
  if(_cur.sort === 'recent') r.sort((a, b) => (b.recent_count||0) - (a.recent_count||0) || b.count - a.count || (a.rank - b.rank));
  return _cur.k ? r.slice(0, _cur.k) : r;
}
// ── v4.73 題庫即時統計 → 排名列（依考過題數，同數依近3年、法規名、條號）──
const _EXN = () => _isZuo() ? 'zuo' : _isUp() ? 'up' : 'e2';
const _EXK = { e2:'警大二技', zuo:'警佐班', up:'升官等' };
let _lawText = null, _lawTextSrc = null;
async function _texts(){
  const ls = await da('laws');
  if(_lawText && _lawTextSrc === ls) return _lawText;
  _lawText = new Map();
  ls.forEach(l => { const c = String(l.content || ''); if(c && !c.startsWith('data:')) _lawText.set(l.lawName + '|' + (l.articleNumber || 0), c.replace(/\s+/g, ' ').slice(0, 160)); });
  _lawTextSrc = ls;
  return _lawText;
}
async function _bankRows(s, kind){
  const st = await examStats(), ex = st[_EXN()];
  const sj = ex.bySubj[s.name];
  if(!sj) return { rows:[], ex, sj:null };
  const tx = kind === 'arts' ? await _texts() : null;
  // 另外兩個考試同一科考過幾題（列在每一列，方便比較）
  const others = Object.keys(_EXK).filter(k => k !== _EXN()).map(k => ({ name:_EXK[k], m:((st[k].bySubj[s.name] || {})[kind]) }));
  const oc = key => others.map(o => ({ name:o.name, n:((o.m && o.m.get(key)) || {}).count || 0 })).filter(o => o.n);
  const rows = [...sj[kind].values()].map(a => ({ law:a.law, article:a.article, article_n:a.n, count:a.count, recent_count:a.recent, last_year:a.last,
      by_year:a.by, question_ids:a.ids, text:tx ? tx.get(a.law + '|' + a.n) : '', others:oc(kind === 'arts' ? a.law + '|' + a.n : a.law) }))
    .sort((a, b) => b.count - a.count || b.recent_count - a.recent_count || a.law.localeCompare(b.law, 'zh-TW') || (a.article_n || 0) - (b.article_n || 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows, ex, sj };
}
function _srcNote(ex, sj){
  return '<div class="mem-prog">依題庫 ' + esc(ex.exam) + ' 的考古題統計：本科 ' + sj.n + ' 題，其中 ' + sj.linked + ' 題有標關聯法條（其餘多是觀念、學理題，不列入）；' +
    '近3年＝' + ex.recent.join('、') + ' 年。題庫更正後會自動更新。</div>' + _oldNote(ex);
}
// v4.75 二技警察法規：108 學年度起不考行政執行法 → 105–107 年只考行政執行法的題目預設排除，可切換
function _oldNote(ex){
  if(_cur.exam !== '二技' || !_host || _host.name !== '警察法規') return '';
  const n = (ex.oldEx || {})['警察法規'] || 0, inc = kdIncOld();
  if(!n && !inc) return '';
  return '<div class="mem-prog">📅 二技 108 學年度起警察法規範圍<b>刪除行政執行法</b>、加入集會遊行法。' +
    (inc ? '目前<b>包含</b> 105–107 年只考行政執行法的舊範圍題目。' : '已排除 105–107 年只考行政執行法的 <b>' + n + '</b> 題（同時考職權法等現行範圍的照樣算）。') +
    ' <button class="btn bg" data-act="incold" style="padding:3px 10px;font-size:12px">' + (inc ? '改成排除' : '改成包含') + '</button></div>';
}

// ⚖ 法條（v4.73：二技、警佐班都依題庫的關聯法條統計）
async function _rArticles(s){
  const b = await _bankRows(s, 'arts');
  if(!b.sj || !b.rows.length) return '<div class="mem-empty">題庫裡沒有這一科「' + esc(b.ex.exam) + '」有標關聯法條的考古題。</div>';
  _cur._rows = _sorted(b.rows);
  const rows = _cur._rows;
  const [qmap, wrong] = await Promise.all([_qById(), _onlyWrongSet()]);
  const ids = [...new Set(rows.flatMap(a => a.question_ids||[]))];
  const have = ids.filter(id => qmap.has(id) && (!wrong || wrong.has(id)));
  let h = _srcNote(b.ex, b.sj) + (_cur.exam === '二技' ? _btCard(s.backtest, '法條', '條（回測依 11/5 預測資料包）') : '') + _kChips() +
    '<div class="mem-tools"><button class="btn bp" data-act="practice" style="flex:1">▶ 押題練習：這 ' + rows.length + ' 條的歷屆題（' + have.length + ' 題）</button>' +
    '<button class="btn ' + (_cur.onlyWrong?'bp':'bg') + '" data-act="wrong">只出答錯過的</button></div>' + _nChips();
  if(ids.length && have.length < ids.length && !_cur.onlyWrong)
    h += '<div class="mem-prog">題庫裡找到 ' + have.length + ' ／ ' + ids.length + ' 題（其餘可能已刪除或尚未匯入）</div>';
  const years = b.ex.years;
  h += '<div class="card">' + rows.map(a => {
    const key = a.law + '|' + a.article_n;
    const ref = a.law + a.article;
    const n = (a.question_ids||[]).filter(id => qmap.has(id) && (!wrong || wrong.has(id))).length;
    return '<div class="pr-row"><div class="pr-rank' + (a.rank<=10?' top':'') + '">' + a.rank + '</div><div class="pr-main">' +
      '<div class="pr-title">' + esc(a.law) + ' ' + esc(a.article) + '</div>' +
      '<div class="pr-meta">考過 ' + a.count + ' 題・近3年 ' + (a.recent_count||0) + ' 題・最近 ' + (a.last_year||'—') + ' 年' +
        a.others.map(o => '・' + o.name + ' ' + o.n + ' 題').join('') + '</div>' +
      _yearBars(a.by_year, years) +
      (a.text ? '<div class="pr-text" data-act="clamp">' + esc(a.text) + '</div>' : '<div class="pr-meta">（平台法規庫沒有這一條的條文）</div>') +
      '<div class="pr-acts">' +
        (n ? '<button class="go" data-qids="' + esc((a.question_ids||[]).join(',')) + '" data-label="' + esc(ref) + '">▶ 練習 ' + n + ' 題</button>' : '') +
        '<button data-ref="' + esc(ref) + '">📖 條文</button>' +
        (_keys && _keys.has(key) ? '<button data-mem="' + esc(key) + '">🌳 記憶樹</button>' : '') +
      '</div></div></div>';
  }).join('') + '</div>';
  return h;
}
// ⚖ 警佐班法條：題目以「年-題號」對應平台題庫裡考試別＝警佐班的題目
async function _zuoMap(sub){
  const [qs, wrong] = await Promise.all([da('questions'), _onlyWrongSet()]);
  const m = new Map();
  qs.forEach(q => { if(q.exam === '警佐班' && q.subject === sub && (!wrong || wrong.has(String(q.id)))) m.set(String(q.year) + '-' + String(q.num), q); });
  return m;
}
async function _rZuoArticles(s){
  const rows = _sorted(s.zuo.articles);
  const zm = await _zuoMap(s.name);
  const keys = [...new Set(rows.flatMap(a => a.keys||[]))];
  const have = keys.filter(k => zm.has(k));
  let h = _kChips() +
    '<div class="mem-tools"><button class="btn bp" data-act="zpractice" style="flex:1">▶ 押題練習：這 ' + rows.length + ' 條的警佐班歷屆題（' + have.length + ' 題）</button>' +
    '<button class="btn ' + (_cur.onlyWrong?'bp':'bg') + '" data-act="wrong">只出答錯過的</button></div>' + _nChips();
  if(keys.length && !have.length && !_cur.onlyWrong)
    h += '<div class="mem-prog">題庫裡找不到考試別「警佐班」的題目，練習按鈕會無效；請先匯入警佐班考古題。</div>';
  const years = (s.zuo.years||[]).map(String);
  const twoTech = new Map((s.articles||[]).map(a => [a.law + '|' + a.article_n, a.count]));
  h += '<div class="card">' + rows.map(a => {
    const key = a.law + '|' + a.article_n, ref = a.law + a.article;
    const n = (a.keys||[]).filter(k => zm.has(k)).length;
    return '<div class="pr-row"><div class="pr-rank' + (a.rank<=10?' top':'') + '">' + a.rank + '</div><div class="pr-main">' +
      '<div class="pr-title">' + esc(a.law) + ' ' + esc(a.article) + '</div>' +
      '<div class="pr-meta">考過 ' + a.count + ' 題・近3年 ' + (a.recent_count||0) + ' 題・最近 ' + (a.last_year||'—') + ' 年' +
        (twoTech.has(key) ? '・警大二技 ' + twoTech.get(key) + ' 題' : '') + '</div>' +
      _yearBars(a.by_year, years) +
      (a.text ? '<div class="pr-text" data-act="clamp">' + esc(a.text) + '</div>' : '') +
      '<div class="pr-acts">' +
        (n ? '<button class="go" data-zkeys="' + esc(a.keys.join(',')) + '" data-label="' + esc(ref) + '">▶ 練習 ' + n + ' 題</button>' : '') +
        '<button data-ref="' + esc(ref) + '">📖 條文</button>' +
        (_keys && _keys.has(key) ? '<button data-mem="' + esc(key) + '">🌳 記憶樹</button>' : '') +
      '</div></div></div>';
  }).join('') + '</div>';
  return h;
}
async function _practiceZuo(keys, label){
  const s = _data.subjects[_cur.si];
  const zm = await _zuoMap(s.name);
  const pool = [...new Set(keys)].map(k => zm.get(k)).filter(Boolean);
  if(!pool.length){ toast(_cur.onlyWrong ? '這個範圍沒有答錯過的題目' : '題庫裡找不到這些警佐班題目'); return; }
  _shuffle(pool);
  startQWithPool(_take(pool), '🎯 警佐班 ' + label);
}

function _yearsOf(s){
  const [a, b] = _data.meta.year_range;
  const ys = [];
  for(let y = a; y <= b; y++) if(!s.years || s.years.includes(y)) ys.push(String(y));
  return ys;
}
async function _onlyWrongSet(){ return _cur.onlyWrong ? _wrongSet() : null; }

// 📚 法規（v4.73：依題庫的關聯法條統計；一題引用同一部法規的好幾條只算一次）
async function _rLaws(s){
  const b = await _bankRows(s, 'laws');
  if(!b.sj || !b.rows.length) return '<div class="mem-empty">題庫裡沒有這一科「' + esc(b.ex.exam) + '」有標關聯法條的考古題。</div>';
  const rows = b.rows.slice(0, 40);
  const max = Math.max(1, ...rows.map(r => r.count));
  return _srcNote(b.ex, b.sj) + (_cur.exam === '二技' ? _btCard(s.backtest, '法規', '部法規（回測依 11/5 預測資料包）') : '') +
    '<div class="cc"><div class="ct">各法規考過題數（藍＝全部、橘＝近3年；點一下練這部法規的題目）</div>' + rows.map(r =>
    '<div class="pr-bar go" data-qids="' + esc(r.question_ids.join(',')) + '" data-label="' + esc(r.law) + '" style="cursor:pointer"><div class="pr-bar-l">' + esc(r.law) + '</div><div class="pr-bar-t"><i style="width:' + (100*r.count/max) + '%"></i><i class="r" style="width:' + (100*(r.recent_count||0)/max) + '%"></i></div>' +
    '<div class="pr-bar-n">' + r.count + '／近' + (r.recent_count||0) + '</div></div>').join('') + '</div>' +
    (b.rows.length > rows.length ? '<div class="mem-prog">只列前 ' + rows.length + ' 部，共 ' + b.rows.length + ' 部法規。</div>' : '');
}

// 🎯 考試範圍（警察法規）：各考試公告的重點法律不同，把題庫裡所有警察法規題依引用的法規分到各考試
//   本法題＝題目引用列出的法律本身；相關命令題＝只引用那些法律的施行細則、子法或作業規定（依主題歸類）
//   範圍外＝沒有引用列出的法律（例如警察人員人事條例、警察教育條例）
const _SCOPES = [
  { id:'zuo',   name:'警佐班招生考試',       src:'警佐班',   laws:['警察法','社會秩序維護法','警械使用條例','警察職權行使法'] },
  { id:'zheng', name:'警正班招生考試',       src:'',         laws:['警察法','行政程序法','警察職權行使法','行政執行法','社會秩序維護法','集會遊行法','警械使用條例'] },
  { id:'2tech', name:'二年制技術系入學考試', src:'警大二技', laws:['警察法','警械使用條例','警察職權行使法','社會秩序維護法','集會遊行法'], related:true },
  { id:'g4',    name:'一般警察人員四等特考', src:'',         laws:['警察法','行政執行法','社會秩序維護法','警械使用條例','集會遊行法','警察職權行使法','行政程序法','公務人員行政中立法'] },
  { id:'p34',   name:'警察人員三、四等特考', src:'三等考試', laws:['警察法','行政執行法','社會秩序維護法','警械使用條例','集會遊行法','警察職權行使法','公務人員行政中立法'] },
  { id:'up',    name:'警正警察人員升官等',   src:'升官等',   laws:['警察法','行政執行法','社會秩序維護法','槍砲彈藥刀械管制條例','集會遊行法','警械使用條例','警察職權行使法'] },
];
// 子法、作業規定 → 主題所屬的法律（施行細則另以名稱判斷）
const _RELATED = {
  '違反社會秩序維護法案件處理辦法':'社會秩序維護法', '拘留所設置管理辦法':'社會秩序維護法', '沒入物品處分規則':'社會秩序維護法',
  '警械使用事件補償辦法':'警械使用條例', '警械許可定製售賣持有管理辦法':'警械使用條例', '警械使用調查小組組織及運作辦法':'警械使用條例',
  '警察機關配備警械種類':'警械使用條例', '駐衛警察使用警械管理辦法':'警械使用條例', '警察人員使用槍械規範':'警械使用條例',
  '警察人員使用防護型應勤裝備注意要點':'警械使用條例', '警察人員使用警銬規範':'警械使用條例',
  '警察遴選第三人蒐集資料辦法':'警察職權行使法', '治安顧慮人口查訪辦法':'警察職權行使法',
  '偶發性及緊急性集會遊行處理原則':'集會遊行法',
  '槍砲彈藥刀械許可及管理辦法':'槍砲彈藥刀械管制條例', '槍砲彈藥及刀械收購價格標準':'槍砲彈藥刀械管制條例',
};
const _SCOPE_LAWS = [...new Set(_SCOPES.flatMap(x => x.laws))];
// 「社會秩序維護法§22」「警察法第3條」→ 法規名
function _refLaw(ref){
  return String(ref||'').replace(/[《》「」〈〉]/g, '').split(/§|第[0-9０-９一二三四五六七八九十百千]+/)[0].trim();
}
// 法規名 → { law: 所屬的範圍法律, own: 是否就是法律本身 }；與範圍法律無關回傳 null
function _family(name){
  if(_SCOPE_LAWS.includes(name)) return { law:name, own:true };
  const m = /^(.+)施行細則$/.exec(name);
  if(m && _SCOPE_LAWS.includes(m[1])) return { law:m[1], own:false };
  return _RELATED[name] ? { law:_RELATED[name], own:false } : null;
}
// 題目引用的法規名：優先用 relatedLaws；沒有時從題幹、解析、關鍵字找法規全名
const _SCAN_NAMES = [..._SCOPE_LAWS, ..._SCOPE_LAWS.map(l => l + '施行細則'), ...Object.keys(_RELATED)].sort((a, b) => b.length - a.length);
// （延伸考點只看題目的關聯法條，不從文字猜：見 _rScope）
function _qLaws(q){
  const refs = (q.relatedLaws||[]).map(r => _refLaw(r && r.ref)).filter(Boolean);
  if(refs.length) return [...new Set(refs)];
  let t = [q.stem, q.note, ...(q.keywords||[])].join(' ');
  const found = [];
  _SCAN_NAMES.forEach(n => { if(t.includes(n)){ found.push(n); t = t.split(n).join(' '); } });   // 先比長名，避免「警察法」吃掉「警察法施行細則」
  return found;
}
// 一題對某考試：{ tier:'own'|'rel'|'out', own:[直接引用的範圍法律], rel:[只引用其子法的範圍法律], other:[範圍外法規] }
function _qScope(q, sc){
  const own = new Set(), rel = new Set(), other = [];
  _qLaws(q).forEach(n => {
    const f = _family(n);
    if(f && sc.laws.includes(f.law)) (f.own ? own : rel).add(f.law);
    else if(n !== '釋字' && !/憲判字|^最高/.test(n)) other.push(n);
  });
  own.forEach(l => rel.delete(l));
  return { tier: own.size ? 'own' : rel.size ? 'rel' : 'out', own:[...own], rel:[...rel], other };
}
async function _rScope(s){
  const sc = _SCOPES.find(x => x.id === _cur.scope) || _SCOPES.find(x => x.id === ({ '二技':'2tech', '警佐':'zuo', '升官':'up' }[_cur.exam])) || _SCOPES[2];
  _cur.scope = sc.id;
  const [qs, wrong, ats] = await Promise.all([da('questions'), _onlyWrongSet(), da('attempts')]);
  // 每題最近一次有判對錯的作答（id 越大越新）→ 每部法律的「做過／答對率」
  const last = new Map();
  ats.slice().sort((a, b) => (a.id||0) - (b.id||0)).forEach(a => { if(typeof a.correct === 'boolean') last.set(String(a.qid), a.correct); });
  const all = qs.filter(q => q.subject === '警察法規' && (!wrong || wrong.has(String(q.id))) && !(sc.id === '2tech' && !kdIncOld() && kdOldScope(q)));
  const pool = _cur.scopeOwn && sc.src ? all.filter(q => q.exam === sc.src) : all;
  const withRel = sc.related || _cur.scopeRel;
  const per = new Map(sc.laws.map(l => [l, { own:[], rel:[], by:{} }]));
  const out = [], outLaws = {}, total = [];
  pool.forEach(q => {
    const r = _qScope(q, sc);
    if(r.tier === 'out'){ out.push(q); r.other.forEach(n => { outLaws[n] = (outLaws[n]||0) + 1; }); return; }
    if(r.tier === 'own' || withRel) total.push(q);
    r.own.forEach(l => per.get(l).own.push(q));
    r.rel.forEach(l => per.get(l).rel.push(q));
  });
  _scopePools = { all: total, laws: {} };
  let h = '<div class="mem-tools pr-k">' + _SCOPES.map(x => '<button class="chip' + (x.id===sc.id?' on':'') + '" data-scope="' + x.id + '">' + esc(x.name) + '</button>').join('') + '</div>' +
    '<div class="pr-note">📋 <b>' + esc(sc.name) + '</b>考試範圍：' + sc.laws.map(esc).join('、') + (sc.related ? '及相關命令' : '') + '。<br>' +
    '<small>題目依引用的法規分類（解析的法條欄），一題可同時算進好幾部法律。「相關命令」＝只引用施行細則、子法或作業規定的題目' +
    (sc.related ? '，本考試公告含相關命令，所以一起出。' : '，預設不出，可切換。') + '</small></div>' +
    '<div class="mem-tools">' +
      (sc.src ? '<button class="btn ' + (_cur.scopeOwn?'bp':'bg') + '" data-act="scopeown">' + (_cur.scopeOwn ? '只看' + esc(sc.src) + '歷屆題' : '所有考試的題目') + ' ⇅</button>' : '') +
      (sc.related ? '' : '<button class="btn ' + (_cur.scopeRel?'bp':'bg') + '" data-act="scoperel">' + (_cur.scopeRel ? '含相關命令' : '只出本法題') + ' ⇅</button>') +
      '<button class="btn ' + (_cur.onlyWrong?'bp':'bg') + '" data-act="wrong">只出答錯過的</button></div>' +
    (!sc.src ? '<div class="mem-prog">題庫還沒有' + esc(sc.name) + '的歷屆題，以下是其他考試考過、屬於這個範圍的題目。</div>' : '') +
    '<div class="mem-tools"><button class="btn bp" data-act="scopeall" style="flex:1">▶ 範圍內練習（' + total.length + ' 題' + (_cur.n && total.length > _cur.n ? '，每次隨機 ' + _cur.n + ' 題' : '') + '）</button></div>' + _nChips();
  const max = Math.max(1, ...[...per.values()].map(p => p.own.length + p.rel.length));
  h += '<div class="card">' + sc.laws.map(l => {
    const p = per.get(l), list = withRel ? [...p.own, ...p.rel] : p.own;
    list.forEach(q => { p.by[q.exam] = (p.by[q.exam]||0) + 1; });
    const done = list.filter(q => last.has(String(q.id))), ok = done.filter(q => last.get(String(q.id))).length;
    const prog = done.length ? '做過 ' + done.length + '／' + list.length + ' 題・最近一次答對 ' + Math.round(100*ok/done.length) + '%' : '還沒做過';
    _scopePools.laws[l] = list;
    const by = Object.entries(p.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => esc(k) + ' ' + v).join('・');
    return '<div class="pr-row"><div class="pr-main"><div class="pr-title">' + esc(l) + '</div>' +
      '<div class="pr-bar"><div class="pr-bar-t" style="margin:0"><i style="width:' + (100*p.own.length/max) + '%"></i><i class="r" style="width:' + (100*p.rel.length/max) + '%"></i></div></div>' +
      '<div class="pr-meta">本法 ' + p.own.length + ' 題・相關命令 ' + p.rel.length + ' 題' + (by ? '（' + by + '）' : '') + '</div>' +
      '<div class="pr-meta">' + prog + '</div>' +
      '<div class="pr-acts">' + (list.length ? '<button class="go" data-scopelaw="' + esc(l) + '">▶ 練習 ' + list.length + ' 題</button>' : '<span class="pr-meta">題庫裡沒有這部法律的題目</span>') + '</div>' +
    '</div></div>';
  }).join('') + '</div>';
  // v4.75 警察法延伸考點：不在公告範圍、但從警察法、職權法、警械條例延伸出去，三個考試年年都有
  _scopePools.ext = {};
  const extRows = _EXT.map(([law, why]) => {
    const list = out.filter(q => _qLaws(q).includes(law));
    _scopePools.ext[law] = list;
    return [law, why, list];
  }).filter(r => r[2].length);
  const extAll = [...new Set(extRows.flatMap(r => r[2]))];
  _scopePools.extAll = extAll;
  if(extRows.length) h += '<div class="sec">🔗 警察法延伸考點（不在公告範圍，但年年出現）</div>' +
    '<div class="mem-prog">這些題目引用的法律不在範圍內，題目卻是從範圍內的法律延伸出去的（例如警察法第 11 條的人事制度、作業規定的法律性質）。' +
    (_cur.scopeOwn && sc.src ? esc(sc.src) + '歷屆題共 ' + extAll.length + ' 題。' : '所有考試共 ' + extAll.length + ' 題。') + '</div>' +
    '<div class="mem-tools"><button class="btn bp" data-act="extall" style="flex:1">▶ 練全部延伸考點（' + extAll.length + ' 題）</button></div>' +
    '<div class="card">' + extRows.map(([law, why, list]) =>
      '<div class="pr-row"><div class="pr-main"><div class="pr-title">' + esc(law) + '</div><div class="pr-meta">' + esc(why) + '・' + list.length + ' 題</div>' +
      '<div class="pr-acts"><button class="go" data-scopeext="' + esc(law) + '">▶ 練習 ' + list.length + ' 題</button></div></div></div>').join('') + '</div>';
  const ol = Object.entries(outLaws).sort((a, b) => b[1] - a[1]).slice(0, 8);
  h += '<div class="mem-prog">' + (_cur.scopeOwn && sc.src ? esc(sc.src) + '歷屆題' : '題庫警察法規題') + '中有 <b>' + out.length + '</b> 題不在這個範圍' +
    (ol.length ? '，引用最多的是：' + ol.map(([k, v]) => esc(k) + ' ' + v).join('、') : '') + '。' +
    (_cur.scopeOwn && sc.src && out.length ? '這些是這個考試以前考過、但不在上面公告法律裡的題目，可當補充。' : '') + '</div>';
  return h;
}
let _scopePools = { all:[], laws:{}, ext:{}, extAll:[] };
// 延伸考點：範圍外法律 → 從哪裡延伸（依 v4.75 三考覆核）
const _EXT = [
  ['警察人員人事條例', '警察法第 11 條（人事制度）'],
  ['警察教育條例', '警察法（警察教育）'],
  ['行政程序法', '作業規定、要點的法律性質（行程法第 159 條）、行政處分'],
  ['國家賠償法', '違法行使職權、違法使用警械的賠償（職權法第 31 條、警械條例第 11 條）'],
  ['中華民國憲法', '警察機關的意義、人身自由與基本權（憲法第 8 條等）'],
];
function _practicePool(list, label){
  const pool = list.slice();
  if(!pool.length){ toast(_cur.onlyWrong ? '這個範圍沒有答錯過的題目' : '題庫裡沒有這個範圍的題目'); return; }
  _shuffle(pool);
  startQWithPool(_take(pool), '🎯 ' + label);
}

// 🧩 題型（國文、英文）
function _rTopics(s){
  const t = s.topics || {};
  const all = t.overall || {}, rec = t.recent || {};
  const tot = Object.values(all).reduce((a, b) => a + b, 0) || 1;
  const rtot = Object.values(rec).reduce((a, b) => a + b, 0) || 1;
  const keys = Object.keys(all).sort((a, b) => all[b] - all[a]);
  let h = '<div class="cc"><div class="ct">題型比重（藍＝全部年度、橘＝近3次）</div>' + keys.map(k =>
    '<div class="pr-bar"><div class="pr-bar-l">' + esc(k) + '</div><div class="pr-bar-t"><i style="width:' + (100*all[k]/tot) + '%"></i><i class="r" style="width:' + (100*(rec[k]||0)/rtot) + '%"></i></div>' +
    '<div class="pr-bar-n">' + Math.round(100*all[k]/tot) + '%／' + Math.round(100*(rec[k]||0)/rtot) + '%</div></div>').join('') + '</div>';
  if(t.misallocated_rate != null)
    h += '<div class="pr-note">用前 3 次考試的比重預測下一次，平均約 ' + Math.round(t.misallocated_rate*100) + '% 的題目會分錯題型：只適合抓大方向。</div>';
  if(s.name === '英文')
    h += '<div class="pr-note">⚠️ 115 年題型大改：第 21–40 題幾乎都是<b>警察專業概念</b>的英文複選題（往年每年 0–2 題）。猜 116 年請把「警察專業英文」列為必讀 → 成長區「英語學習庫」的〈考試英文重點〉。</div>' +
      '<div style="padding:0 12px 12px"><button class="btn bp" style="width:100%" data-act="goeng">📘 前往考試英文重點</button></div>';
  const years = Object.keys(t.by_year||{}).sort();
  if(years.length) h += '<div class="cc"><div class="ct">逐年題數</div><div class="mem-tbl-wrap"><table class="mem-tbl"><thead><tr><th></th>' +
    years.map(y => '<th>' + y + '</th>').join('') + '</tr></thead><tbody>' + keys.map(k => '<tr><th>' + esc(k) + '</th>' +
    years.map(y => '<td>' + ((t.by_year[y]||{})[k] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>';
  return h;
}

// 📌 考點（國文出處、勤務規範與學理名詞）
async function _rPoints(s, kind){
  const p = s.points[kind];
  const qmap = await _qById();
  const lv = (p.levels||[])[0];
  let h = _btCard(p.backtest, lv, '個' + kind);
  h += '<div class="card">' + (p.rows||[]).map(r => {
    const n = (r.question_ids||[]).filter(id => qmap.has(id)).length;
    return '<div class="pr-row"><div class="pr-rank' + (r.rank<=10?' top':'') + '">' + r.rank + '</div><div class="pr-main">' +
      '<div class="pr-title">' + esc(r.name) + (r.sub ? '〈' + esc(r.sub) + '〉' : '') + '</div>' +
      '<div class="pr-meta">考過 ' + r.count + ' 題・近3年 ' + (r.recent_count||0) + '・最近 ' + (r.last_year||'—') + ' 年</div>' +
      (n ? '<div class="pr-acts"><button class="go" data-qids="' + esc(r.question_ids.join(',')) + '" data-label="' + esc(r.name) + '">▶ 練習 ' + n + ' 題</button></div>' : '') +
      '</div></div>';
  }).join('') + '</div>';
  if(kind === '規範') h += '<div class="pr-note">勤務規範押前 50 名的命中率與隨機差不多，參考價值有限；學理名詞（如警勤區、見警率）的命中率明顯高於隨機。</div>';
  return h;
}

// 📈 趨勢：出題風格、最近兩年才出現的條文、警佐班考得多的條文
const _STYLE = [['multi','多選題（答案不只一個）'], ['neg','否定題（何者錯誤／不正確）'], ['num','數字題（期間、金額、人數）'], ['case','案例題（甲乙丙）']];
function _styleAdvice(r){
  const tips = [];
  if(r.multi >= 40) tips.push('一半是多選題：每個選項 1/5 分、選錯倒扣 1/5。款次要記完整，記憶庫「🔢 數字口訣」的多款口訣最有用；沒把握的選項寧可不選。');
  if(r.neg >= 20) tips.push('否定題比例偏高：讀題先圈「錯誤／不正確」，用「⚠️ 易錯爭點」練反向判斷。');
  if(r.num >= 25) tips.push('數字題多：用「🔢 數字速記」與數字抽考，把期間、金額、門檻背到秒答。');
  if(r.case >= 15) tips.push('案例題多：先判斷罪名或程序階段，再套法條要件（記憶樹的要件分支）。');
  return tips;
}
// 近三年出題理由回測＋交互驗證
const _REASONS = ['常考條文', '考過一次', '首次出題', '近3年修法', '釋憲／憲判', '實務見解', '時事議題', '無對應條文（作業規定、學理）'];
const _REASON_TIP = {
  '常考條文':'以前考過 2 次以上的條文又出現',
  '考過一次':'以前只考過 1 次的條文',
  '首次出題':'以前從沒考過的條文',
  '近3年修法':'條文近 3 年修正，或題幹寫明「修正／新制」',
  '釋憲／憲判':'題目引用大法官解釋或憲法法庭判決',
  '實務見解':'題目引用最高法院等實務見解',
  '時事議題':'詐騙、AI 深偽、跟騷、疫情、科技執法等社會議題',
  '無對應條文（作業規定、學理）':'作業程序、規定或學理（對不到法條）'};
function _rReasons(s){
  const rs = s.reasons || {};
  const ex = _isZuo() ? '警佐班' : '警大二技';
  const r = rs[ex];
  if(!r) return '';
  const ys = Object.keys(r.n).sort().reverse();   // 新的年度在左，手機窄螢幕也看得到
  const cell = (y, k) => { const v = r.rows[y + '|' + k] || 0; return v ? Math.round(100*v/r.n[y]) + '%' : ''; };
  let h = '<div class="cc"><div class="ct">🧭 回測：近三年每題「為什麼會考」（' + ex + '，一題可有多個理由）</div><div class="mem-tbl-wrap"><table class="mem-tbl"><thead><tr><th>理由</th>' +
    ys.map(y => '<th>' + y + '<br><small>' + r.n[y] + '題</small></th>').join('') + '</tr></thead><tbody>' +
    _REASONS.filter(k => ys.some(y => r.rows[y + '|' + k])).map(k => '<tr><th title="' + esc(_REASON_TIP[k]||'') + '">' + esc(k) + '</th>' + ys.map(y => '<td>' + cell(y, k) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>' +
    '<div class="pr-meta">' + Object.entries(r.ex||{}).filter(([k]) => k !== '常考條文').slice(0, 3).map(([k, list]) => esc(k) + '例：' + esc(String((list||[])[0]||'').slice(0, 34)) + '…').join('<br>') + '</div></div>';
  const x = (s.xval||{})[ex];
  if(x && Object.keys(x).length){
    const best = Object.entries(x).sort((a, b) => b[1] - a[1])[0][0];
    h += '<div class="cc"><div class="ct">🔁 交互驗證：押前 50 條，隔年能蓋到幾成（逐年回測平均）</div><div class="pr-bt">' +
      Object.entries(x).map(([k, v]) => '<div' + (k===best?' class="best"':'') + '><b>' + v + '%</b><span>' + esc(k) + '</span></div>').join('') + '</div>' +
      '<div class="pr-meta">「兩考試合併」＝警大二技＋警佐班一起算排名；「近3次加權」＝最近三次的題目加倍計算。最好的是 <b>' + esc(best) + '</b>。</div></div>';
  }
  return h;
}
async function _rTrend(s){
  if(_isZuo()) return _rReasons(s) || '<div class="mem-empty">這科沒有警佐班的回測資料</div>';
  const t = s.trend || {};
  const a = (t.style||{}).all || {}, r = (t.style||{}).recent || {};
  let h = '<div class="cc"><div class="ct">出題風格（藍＝全部年度 ' + (a.n||0) + ' 題、橘＝近3次 ' + (r.n||0) + ' 題）</div>' +
    _STYLE.map(([k, label]) => '<div class="pr-bar"><div class="pr-bar-l" style="width:150px">' + label + '</div><div class="pr-bar-t"><i style="width:' + (a[k]||0) + '%"></i><i class="r" style="width:' + (r[k]||0) + '%"></i></div>' +
      '<div class="pr-bar-n">' + (a[k]||0) + '%／' + (r[k]||0) + '%</div></div>').join('') + '</div>';
  const tips = _styleAdvice(r);
  if(tips.length) h += '<div class="pr-note">' + tips.map(x => '・' + esc(x)).join('<br>') + '</div>';
  h += _rReasons(s);
  const qmap = await _qById();
  const row = (x, meta) => {
    const key = x.law + '|' + x.article_n, ref = x.law + x.article;
    const n = (x.question_ids||[]).filter(id => qmap.has(id)).length;
    return '<div class="pr-row"><div class="pr-main"><div class="pr-title">' + esc(x.law) + ' ' + esc(x.article) + '</div><div class="pr-meta">' + meta + '</div>' +
      '<div class="pr-acts">' + (n ? '<button class="go" data-qids="' + esc(x.question_ids.join(',')) + '" data-label="' + esc(ref) + '">▶ 練習 ' + n + ' 題</button>' : '') +
      '<button data-ref="' + esc(ref) + '">📖 條文</button>' + (_keys && _keys.has(key) ? '<button data-mem="' + esc(key) + '">🌳 記憶樹</button>' : '') + '</div></div></div>';
  };
  if((t.newest||[]).length) h += '<div class="sec">最近兩年才首次出現的條文（新考點）</div>' +
    '<div class="mem-prog">⚠️ 回測顯示：只看「新考點」押題，命中率沒有比「考過題數」排名好，請當補充清單，不要取代法條排名。</div><div class="card">' +
    t.newest.map(x => row(x, x.first + ' 年首次出題・共 ' + x.count + ' 題')).join('') + '</div>';
  // v4.74：拿掉「警佐班考得最多的條文」：舊資料包的數字，和 ⚖ 法條排名（依題庫，每列都標另外兩個考試題數）重複
  return h;
}

// 每次練習題數：範圍很大時（例如警察法規 800 多題）一次只出 N 題，洗牌後取前 N 題
const _NS = [20, 50, 100, 0];
function _nChips(){
  return '<div class="mem-tools pr-k"><span class="pr-meta" style="align-self:center">每次練習</span>' + _NS.map(n =>
    '<button class="chip' + (n===_cur.n?' on':'') + '" data-n="' + n + '">' + (n ? n + ' 題' : '全部') + '</button>').join('') + '</div>';
}
function _take(pool){ return _cur.n && pool.length > _cur.n ? pool.slice(0, _cur.n) : pool; }
function _shuffle(a){ for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ════════ 練習 ════════
async function _practiceIds(ids, label){
  const [qmap, wrong] = await Promise.all([_qById(), _onlyWrongSet()]);
  const pool = [...new Set(ids)].map(id => qmap.get(id)).filter(q => q && (!wrong || wrong.has(String(q.id))));
  if(!pool.length){ toast(_cur.onlyWrong ? '這個範圍沒有答錯過的題目' : '題庫裡找不到這些題目'); return; }
  _shuffle(pool);
  startQWithPool(_take(pool), '🎯 ' + label);
}

// ════════ 事件 ════════
function _bind(page){
  if(!page || page._prBound) return;
  page._prBound = true;
  page.addEventListener('click', e => {
    if(!e.target.closest('.pr-scope')) return;
    const t = e.target.closest('[data-k],[data-sort],[data-act],[data-qids],[data-zkeys],[data-ref],[data-mem],[data-scope],[data-scopelaw],[data-scopeext],[data-n]');
    if(!t) return;
    const ds = t.dataset;
    if(ds.k != null){ _cur.k = +ds.k; _rBody(); }   // _rBody 內會存狀態
    else if(ds.sort){ _cur.sort = _cur.sort === 'recent' ? 'count' : 'recent'; _rBody(); }
    else if(ds.qids) _practiceIds(ds.qids.split(','), ds.label || '');
    else if(ds.zkeys) _practiceZuo(ds.zkeys.split(','), ds.label || '');
    else if(ds.n != null){ _cur.n = +ds.n; _rBody(); }
    else if(ds.scope){ _cur.scope = ds.scope; _rBody(); }
    else if(ds.scopelaw) _practicePool(_scopePools.laws[ds.scopelaw] || [], ds.scopelaw);
    else if(ds.ref) showLawPop(ds.ref);
    else if(ds.mem) openMemoryAt(ds.mem);
    else if(ds.act === 'clamp') t.classList.toggle('open');
    else if(ds.act === 'wrong'){ _cur.onlyWrong = !_cur.onlyWrong; _rBody(); }
    else if(ds.act === 'goeng') goPage('engexam');
    else if(ds.act === 'scopeown'){ _cur.scopeOwn = !_cur.scopeOwn; _rBody(); }
    else if(ds.act === 'scoperel'){ _cur.scopeRel = !_cur.scopeRel; _rBody(); }
    else if(ds.act === 'incold'){ kdSetIncOld(!kdIncOld()); _rBody(); }
    else if(ds.act === 'extall') _practicePool(_scopePools.extAll || [], '警察法延伸考點');
    else if(ds.scopeext) _practicePool((_scopePools.ext || {})[ds.scopeext] || [], ds.scopeext + '（延伸考點）');
    else if(ds.act === 'scopeall'){ const sc = _SCOPES.find(x => x.id === _cur.scope); _practicePool(_scopePools.all, (sc ? sc.name : '考試範圍') + ' 範圍內'); }
    else if(ds.act === 'zpractice'){
      const s = _data.subjects[_cur.si];
      _practiceZuo(_sorted(s.zuo.articles).flatMap(a => a.keys||[]), s.name + ' 前' + _cur.k + '條');
    }
    else if(ds.act === 'practice'){
      _practiceIds((_cur._rows || []).flatMap(a => a.question_ids||[]), _EXAM_LABEL[_cur.exam] + ' ' + (_host ? _host.name : '') + (_cur.k ? ' 前' + _cur.k + '條' : ' 全部法條'));
    }
  });
}

// _rZuoArticles、_zuoMap、_practiceZuo：v4.73 起法條排名改用題庫統計，保留給舊資料包格式參考（目前沒有呼叫）
void _rZuoArticles;
const Predict = { renderPredict, predictViews, predictRenderInto, _predictScope:{ SCOPES:_SCOPES, refLaw:_refLaw, family:_family, qLaws:_qLaws, qScope:_qScope } };
Object.assign(window, Predict);
})();
