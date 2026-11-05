// ══ predict.js — 猜題庫（考試區）═════════════════════════════════
// 依賴：db.js(da/dd/bulkPut), utils.js(esc/toast), data.js(showLawPop), quiz.js(startQWithPool),
//       memory.js(openMemoryAt/memoryKeys)
// 資料：data/predict.json（警大二技預測資料包的排名與回測，題目只留 ID）
//       data/variants.json（116 年二技＋警佐班猜題庫：四科各猜題 100、變化題 100，可練習或匯入題庫）
//       predict.json 各科 zuo（警佐班條文排名，題目以「年-題號」對應平台題庫）、reasons（近三年出題理由回測）、xval（交互驗證）
// 功能：
//   ①各科押題清單：法條（或題型、出處、規範、學理名詞）依考過題數排名，附近3年題數與年度分布
//   ②一鍵押題練習：前 K 名相關的歷屆考題（從平台題庫取），可只出答錯過的
//   ③回測命中率：誠實標示「押前 K 名」過去能蓋到幾成題目
//   ④二技／警佐班切換（警佐班只列佐二類的四科）
//   ⑤猜題庫：直接練習或匯入題庫（依題幹去重），可刪除舊的升官等猜題
//
// 公開 API 見檔尾 window.Predict

(function(){
'use strict';

let _data = null;
let _keys = null;                         // 記憶樹引用到的法條（顯示 🌳 用）
let _cur = { si:0, k:20, sort:'count', onlyWrong:false, view:'articles', exam:'二技' };
try{ if(localStorage.getItem('prExam') === '警佐') _cur.exam = '警佐'; }catch(e){}
const _ZUO_SUBJ = ['憲法、法學緒論', '警察法規', '警察勤務', '刑法與刑事訴訟法'];
const _isZuo = () => _cur.exam === '警佐';
// 目前考試別下可選的科目（回傳 _data.subjects 的索引）
function _subjIdx(){
  return _data.subjects.map((s, i) => i).filter(i => !_isZuo() || (_data.subjects[i].zuo && _ZUO_SUBJ.includes(_data.subjects[i].name)));
}

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

// ════════ 頁面 ════════
async function renderPredict(){
  const el = document.getElementById('pr-body');
  if(!el) return;
  try{
    await _load();
    _bind();
    _rSubj();
    await _rBody();
  }catch(e){
    logError('renderPredict', e);
    el.innerHTML = '<div class="mem-empty">猜題資料載入失敗，請確認網路後重新整理。<br><small>' + esc(e.message) + '</small></div>';
  }
}
function _rSubj(){
  const idx = _subjIdx();
  if(!idx.includes(_cur.si)) _cur.si = idx[0];
  document.getElementById('pr-subj').innerHTML =
    [['二技','警大二技'], ['警佐','警佐班（佐二類）']].map(([k, t]) => '<button class="chip pr-ex' + (k===_cur.exam?' on':'') + '" data-exam="' + k + '">' + t + '</button>').join('') +
    '<span class="pr-sep"></span>' +
    idx.map(i => '<button class="chip' + (i===_cur.si?' on':'') + '" data-si="' + i + '">' + esc(_data.subjects[i].name) + '</button>').join('');
}
function _views(s){
  const v = [];
  if(_isZuo()){
    v.push(['articles','⚖ 法條']);
    if(s.reasons || s.trend) v.push(['trend','📈 趨勢']);
    if(_ZUO_SUBJ.includes(s.name)) v.push(['variants','🎲 猜題庫']);
    return v;
  }
  if(s.articles) v.push(['articles','⚖ 法條'], ['laws','📚 法規']);
  if(s.topics) v.push(['topics','🧩 題型']);
  Object.keys(s.points||{}).forEach(k => v.push(['pt:' + k, '📌 ' + k]));
  if(s.trend) v.push(['trend','📈 趨勢']);
  if(_ZUO_SUBJ.includes(s.name)) v.push(['variants','🎲 猜題庫']);
  return v;
}
async function _rBody(){
  const s = _data.subjects[_cur.si];
  const views = _views(s);
  if(!views.some(v => v[0] === _cur.view)) _cur.view = views[0][0];
  const m = _data.meta, z = _isZuo() ? s.zuo : null;
  let h = '<div class="pr-note">📈 ' + (z ? '警佐班 ' + z.years[0] + '–' + z.years[z.years.length-1] : esc(m.exam) + ' ' + m.year_range[0] + '–' + m.year_range[1]) + ' 年，' +
    esc(s.name) + ' ' + (z ? z.question_count : s.question_count) + ' 題；最近 3 次：' + ((z ? z.recent_years : s.recent_years)||[]).join('、') + ' 年。' +
    '排名只代表「優先順序」，不是必考清單。<br><small>資料包產生於 ' + esc(m.generated_at || '') + '</small></div>' +
    '<div class="mem-tabs">' + views.map(([k, t]) => '<button class="mem-tab' + (k===_cur.view?' on':'') + '" data-view="' + esc(k) + '">' + t + '</button>').join('') + '</div>';
  const el = document.getElementById('pr-body');
  if(_cur.view === 'articles') h += await _rArticles(s);
  else if(_cur.view === 'laws') h += _rLaws(s);
  else if(_cur.view === 'topics') h += _rTopics(s);
  else if(_cur.view.startsWith('pt:')) h += await _rPoints(s, _cur.view.slice(3));
  else if(_cur.view === 'variants') h += await _rVariants(s);
  else if(_cur.view === 'trend') h += await _rTrend(s);
  el.innerHTML = h;
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
  return '<div class="mem-tools pr-k">' + [10,20,50,120].map(k => '<button class="chip' + (k===_cur.k?' on':'') + '" data-k="' + k + '">' + (k===120?'全部':'前 ' + k) + '</button>').join('') +
    '<button class="chip' + (_cur.sort==='recent'?' on':'') + '" data-sort="1">' + (_cur.sort==='recent'?'依近3年':'依總題數') + ' ⇅</button></div>';
}
function _sorted(rows){
  const r = rows.slice();
  if(_cur.sort === 'recent') r.sort((a, b) => (b.recent_count||0) - (a.recent_count||0) || b.count - a.count || (a.rank - b.rank));
  return r.slice(0, _cur.k);
}

// ⚖ 法條
async function _rArticles(s){
  if(_isZuo()) return _rZuoArticles(s);
  const rows = _sorted(s.articles);
  const [qmap, wrong] = await Promise.all([_qById(), _onlyWrongSet()]);
  const ids = [...new Set(rows.flatMap(a => a.question_ids||[]))];
  const have = ids.filter(id => qmap.has(id) && (!wrong || wrong.has(id)));
  let h = _btCard(s.backtest, '法條', '條') + _kChips() +
    '<div class="mem-tools"><button class="btn bp" data-act="practice" style="flex:1">▶ 押題練習：這 ' + rows.length + ' 條的歷屆題（' + have.length + ' 題）</button>' +
    '<button class="btn ' + (_cur.onlyWrong?'bp':'bg') + '" data-act="wrong">只出答錯過的</button></div>';
  if(ids.length && have.length < ids.length && !_cur.onlyWrong)
    h += '<div class="mem-prog">題庫裡找到 ' + have.length + ' ／ ' + ids.length + ' 題（其餘可能已刪除或尚未匯入）</div>';
  const years = _yearsOf(s);
  h += '<div class="card">' + rows.map(a => {
    const key = a.law + '|' + a.article_n;
    const ref = a.law + a.article;
    const n = (a.question_ids||[]).filter(id => qmap.has(id)).length;
    return '<div class="pr-row"><div class="pr-rank' + (a.rank<=10?' top':'') + '">' + a.rank + '</div><div class="pr-main">' +
      '<div class="pr-title">' + esc(a.law) + ' ' + esc(a.article) + '</div>' +
      '<div class="pr-meta">考過 ' + a.count + ' 題・近3年 ' + (a.recent_count||0) + ' 題・最近 ' + (a.last_year||'—') + ' 年' +
        (a.other ? '・其他考試 ' + Object.entries(a.other).map(([k,v]) => esc(k) + v).join('、') : '') + '</div>' +
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
    '<button class="btn ' + (_cur.onlyWrong?'bp':'bg') + '" data-act="wrong">只出答錯過的</button></div>';
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
  pool.sort(() => Math.random() - .5);
  startQWithPool(pool, '🎯 警佐班 ' + label);
}

function _yearsOf(s){
  const [a, b] = _data.meta.year_range;
  const ys = [];
  for(let y = a; y <= b; y++) if(!s.years || s.years.includes(y)) ys.push(String(y));
  return ys;
}
async function _onlyWrongSet(){ return _cur.onlyWrong ? _wrongSet() : null; }

// 📚 法規
function _rLaws(s){
  const rows = s.laws || [];
  const max = Math.max(1, ...rows.map(r => r.count));
  return _btCard(s.backtest, '法規', '部法規') + '<div class="cc"><div class="ct">各法規考過題數（藍＝全部、橘＝近3年）</div>' + rows.map(r =>
    '<div class="pr-bar"><div class="pr-bar-l">' + esc(r.law) + '</div><div class="pr-bar-t"><i style="width:' + (100*r.count/max) + '%"></i><i class="r" style="width:' + (100*(r.recent_count||0)/max) + '%"></i></div>' +
    '<div class="pr-bar-n">' + r.count + '／近' + (r.recent_count||0) + '</div></div>').join('') + '</div>';
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
  if(x){
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
  if((t.zuo||[]).length) h += '<div class="sec">警佐班考得最多的條文（同科）</div><div class="card">' +
    t.zuo.map(x => row(x, '警佐班 ' + x.zuo + ' 題・警大二技 ' + x.count + ' 題')).join('') + '</div>' +
    '<div class="mem-prog">警佐班題數只計入警大二技也考過的條文，是參考值。</div>';
  return h;
}

// 🎲 猜題庫（116 年二技＋警佐班：四科各猜題 100、變化題 100）
let _variants = null;
async function _loadVariants(){
  if(!_variants){
    const r = await fetch('data/variants.json');
    if(!r.ok) throw new Error('variants.json ' + r.status);
    _variants = await r.json();
  }
  return _variants;
}
const _norm = t => String(t||'').replace(/[\s，,。．.、：:？?「」『』（）()]/g, '').slice(0, 60);
const _EX_NEW = { guess:'116猜題', vari:'116變化題' };
const _EX_OLD = ['猜題（原題）', '猜題（變化題）'];          // 舊版升官等記憶樹匯入的考試別
async function _rVariants(s){
  const v = await _loadVariants();
  const qs = await da('questions');
  const stems = new Set(qs.map(q => _norm(q.stem)));
  const items = v.items.filter(it => it.subject === s.name);
  const g = items.filter(it => !it.variant), va = items.filter(it => it.variant);
  const have = items.filter(it => stems.has(_norm(it.stem))).length;
  const rc = {};
  items.forEach(it => { rc[it.reason] = (rc[it.reason]||0) + 1; });
  const old = qs.filter(q => _EX_OLD.includes(q.exam) && (q.tags||[]).includes('猜題')).length;
  let h = '<div class="pr-note">' + esc(v.title) + '：依二技與警佐班近三年回測的出題理由配比命題。<b>猜題</b>＝沒考過原題、但考點樣式類似的新題；<b>變化題</b>＝把近三年考古題換角度、換數字、換對象改寫，不與原題重複。每題附詳解、出題理由與法條。</div>' +
    '<div class="cc"><div class="ct">' + esc(s.name) + '：猜題 ' + g.length + '・變化題 ' + va.length + '・題庫已有 ' + have + '</div>' +
    '<div class="pr-meta">出題理由：' + Object.entries(rc).sort((x, y) => y[1] - x[1]).map(([k, n]) => esc(k) + ' ' + n).join('、') + '</div>' +
    '<div class="pr-acts"><button class="go" data-vprev="guess">▶ 練習猜題 ' + g.length + '</button><button class="go" data-vprev="vari">▶ 練習變化題 ' + va.length + '</button>' +
    '<button data-vprev="all">▶ 全部混合</button></div>' +
    '<div class="pr-acts"><button data-vimp="sub">⬇ 匯入本科 ' + items.length + ' 題</button><button data-vimp="*">⬇ 匯入四科全部 ' + v.items.length + ' 題</button></div></div>' +
    '<div class="mem-prog">「練習」不存題庫、不留紀錄；匯入後考試別為「116猜題」「116變化題」，會進入複習排程與統計。題目更新後再按一次匯入，會同步修正已匯入的題目。單選答錯倒扣 1/3 題分、多選每個選項 1/5 分，練習時照考試規則作答。</div>';
  if(old) h += '<div style="padding:0 12px 12px"><button class="btn bg" style="width:100%" data-act="delold">🗑 刪除舊的升官等猜題（' + old + ' 題）</button></div>';
  return h;
}
function _variantToQ(it){
  const q = {
    type:'mc', stem:it.stem, options:it.options, answer:it.answer, answerEs:'',
    subject:it.subject, year:'116', exam: it.variant ? _EX_NEW.vari : _EX_NEW.guess, num:'',
    keywords: it.reason ? [it.reason] : [], mustKeywords:[], tags:['猜題'],
    note:it.note, hlColor:'', isNumberQ:false, groupStem:'', groupId:'', groupOrder:0,
    relatedLaws:(it.laws||[]).map(ref => ({ ref })),
    starred:false, createdAt:Date.now(), reviewLevel:0, nextReview:Date.now(), lastReview:null,
    wrongCount:0, correctStreak:0, difficultyScore:5,
  };
  q.searchBlob = ((q.stem||'')+' '+(q.groupStem||'')+' '+(q.subject||'')+' '+(q.year||'')+' '+(q.exam||'')+' '+(q.num||'')+' '+(q.keywords||[]).join(' ')).toLowerCase();
  return q;
}
async function _importVariants(sub){
  const v = await _loadVariants();
  const name = _data.subjects[_cur.si].name;
  const items = v.items.filter(it => sub === '*' || it.subject === name);
  const qs = await da('questions');
  const stems = new Set(qs.map(q => _norm(q.stem)));
  const add = items.filter(it => !stems.has(_norm(it.stem))).map(_variantToQ);
  // 已匯入的 116 猜題：題目修正後同步更新（選項、答案、詳解、法條）；題幹已改寫而不在新版的舊題刪除
  const newExams = Object.values(_EX_NEW);
  const subs = new Set(items.map(it => it.subject));
  const byStem = new Map(v.items.map(it => [_norm(it.stem), it]));
  const mine = qs.filter(q => newExams.includes(q.exam) && (q.tags||[]).includes('猜題') && subs.has(q.subject));
  const upd = [], gone = [];
  mine.forEach(q => {
    const it = byStem.get(_norm(q.stem));
    if(!it){ gone.push(q); return; }
    const n = _variantToQ(it);
    if(JSON.stringify([q.options, q.answer, q.note, q.relatedLaws]) !== JSON.stringify([n.options, n.answer, n.note, n.relatedLaws]))
      upd.push(Object.assign({}, q, { options:n.options, answer:n.answer, note:n.note, relatedLaws:n.relatedLaws, stem:n.stem, searchBlob:n.searchBlob }));
  });
  if(!add.length && !upd.length && !gone.length){ toast('這些題目題庫裡都有了，且已是最新版'); return; }
  const msg = (add.length ? '新增 ' + add.length + ' 題' : '') +
    (upd.length ? (add.length ? '；' : '') + '更新已匯入題目 ' + upd.length + ' 題（依複核修正答案或詳解，作答紀錄保留）' : '') +
    (gone.length ? '；移除已改寫的舊版題目 ' + gone.length + ' 題' : '');
  if(!await askConfirm('匯入猜題到題庫', msg, '確定')) return;
  if(add.length) await bulkPut('questions', add);
  if(upd.length) await bulkPut('questions', upd);
  for(const q of gone) await dd('questions', q.id);
  toast('完成：' + msg);
  _rBody();
}
async function _deleteOld(){
  const qs = await da('questions');
  const old = qs.filter(q => _EX_OLD.includes(q.exam) && (q.tags||[]).includes('猜題'));
  if(!old.length){ toast('沒有舊的升官等猜題'); return; }
  if(!await askConfirm('刪除舊猜題', '刪除舊版升官等記憶樹匯入的 ' + old.length + ' 題（考試別「猜題（原題）」「猜題（變化題）」），無法復原。', '刪除')) return;
  for(const q of old) await dd('questions', q.id);
  toast('已刪除 ' + old.length + ' 題');
  _rBody();
}
async function _previewVariants(kind){
  const v = await _loadVariants();
  const name = _data.subjects[_cur.si].name;
  const pool = v.items.filter(it => it.subject === name && (kind === 'all' || (kind === 'vari') === !!it.variant))
    .map((it, i) => Object.assign(_variantToQ(it), { id:'virt:var-' + kind + '-' + i, num:String(i+1) }));
  if(!pool.length){ toast('這科沒有猜題'); return; }
  pool.sort(() => Math.random() - .5);
  startQWithPool(pool, '🎲 ' + name + ({ guess:'猜題', vari:'變化題', all:'猜題＋變化題' }[kind]));
}

// ════════ 練習 ════════
async function _practiceIds(ids, label){
  const [qmap, wrong] = await Promise.all([_qById(), _onlyWrongSet()]);
  const pool = [...new Set(ids)].map(id => qmap.get(id)).filter(q => q && (!wrong || wrong.has(String(q.id))));
  if(!pool.length){ toast(_cur.onlyWrong ? '這個範圍沒有答錯過的題目' : '題庫裡找不到這些題目'); return; }
  pool.sort(() => Math.random() - .5);
  startQWithPool(pool, '🎯 ' + label);
}

// ════════ 事件 ════════
function _bind(){
  const page = document.getElementById('pg-predict');
  if(!page || page._prBound) return;
  page._prBound = true;
  page.addEventListener('click', e => {
    const t = e.target.closest('[data-exam],[data-si],[data-view],[data-k],[data-sort],[data-act],[data-qids],[data-zkeys],[data-ref],[data-mem],[data-vimp],[data-vprev]');
    if(!t) return;
    const ds = t.dataset;
    if(ds.exam){ _cur.exam = ds.exam; try{ localStorage.setItem('prExam', ds.exam); }catch(err){} _rSubj(); _rBody(); }
    else if(ds.si != null){ _cur.si = +ds.si; _rSubj(); _rBody(); }
    else if(ds.view){ _cur.view = ds.view; _rBody(); }
    else if(ds.k){ _cur.k = +ds.k; _rBody(); }
    else if(ds.sort){ _cur.sort = _cur.sort === 'recent' ? 'count' : 'recent'; _rBody(); }
    else if(ds.qids) _practiceIds(ds.qids.split(','), ds.label || '');
    else if(ds.zkeys) _practiceZuo(ds.zkeys.split(','), ds.label || '');
    else if(ds.ref) showLawPop(ds.ref);
    else if(ds.mem) openMemoryAt(ds.mem);
    else if(ds.vimp) _importVariants(ds.vimp).catch(err => { logError('importVariants', err); toast('匯入失敗'); });
    else if(ds.vprev) _previewVariants(ds.vprev);
    else if(ds.act === 'clamp') t.classList.toggle('open');
    else if(ds.act === 'wrong'){ _cur.onlyWrong = !_cur.onlyWrong; _rBody(); }
    else if(ds.act === 'goeng') goPage('engexam');
    else if(ds.act === 'delold') _deleteOld().catch(err => { logError('deleteOldVariants', err); toast('刪除失敗'); });
    else if(ds.act === 'zpractice'){
      const s = _data.subjects[_cur.si];
      _practiceZuo(_sorted(s.zuo.articles).flatMap(a => a.keys||[]), s.name + ' 前' + _cur.k + '條');
    }
    else if(ds.act === 'practice'){
      const s = _data.subjects[_cur.si];
      _practiceIds(_sorted(s.articles).flatMap(a => a.question_ids||[]), s.name + ' 前' + _cur.k + '條');
    }
  });
}

const Predict = { renderPredict };
Object.assign(window, Predict);
})();
