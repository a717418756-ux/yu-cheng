// ══ predict.js — 猜題庫（考試區）═════════════════════════════════
// 依賴：db.js(da/bulkPut/getSetting), utils.js(esc/toast), data.js(showLawPop), quiz.js(startQWithPool),
//       memory.js(openMemoryAt/memoryKeys)
// 資料：data/predict.json（警大二技預測資料包的排名與回測，題目只留 ID）
//       data/variants.json（升官等記憶樹的猜題原題＋變化題，可一鍵匯入題庫）
// 功能：
//   ①各科押題清單：法條（或題型、出處、規範、學理名詞）依考過題數排名，附近3年題數與年度分布
//   ②一鍵押題練習：前 K 名相關的歷屆考題（從平台題庫取），可只出答錯過的
//   ③回測命中率：誠實標示「押前 K 名」過去能蓋到幾成題目
//   ④匯入猜題變化題到題庫（依題幹去重）
//
// 公開 API 見檔尾 window.Predict

(function(){
'use strict';

let _data = null;
let _keys = null;                         // 記憶樹引用到的法條（顯示 🌳 用）
let _cur = { si:0, k:20, sort:'count', onlyWrong:false, view:'articles' };

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
  document.getElementById('pr-subj').innerHTML = _data.subjects.map((s, i) =>
    '<button class="chip' + (i===_cur.si?' on':'') + '" data-si="' + i + '">' + esc(s.name) + '</button>').join('');
}
function _views(s){
  const v = [];
  if(s.articles) v.push(['articles','⚖ 法條'], ['laws','📚 法規']);
  if(s.topics) v.push(['topics','🧩 題型']);
  Object.keys(s.points||{}).forEach(k => v.push(['pt:' + k, '📌 ' + k]));
  v.push(['variants','🎲 猜題變化題']);
  return v;
}
async function _rBody(){
  const s = _data.subjects[_cur.si];
  const views = _views(s);
  if(!views.some(v => v[0] === _cur.view)) _cur.view = views[0][0];
  const m = _data.meta;
  let h = '<div class="pr-note">📈 ' + esc(m.exam) + ' ' + m.year_range[0] + '–' + m.year_range[1] + ' 年，' +
    esc(s.name) + ' ' + s.question_count + ' 題；最近 3 次：' + (s.recent_years||[]).join('、') + ' 年。' +
    '排名只代表「優先順序」，不是必考清單。<br><small>資料包產生於 ' + esc(m.generated_at || '') + '</small></div>' +
    '<div class="mem-tabs">' + views.map(([k, t]) => '<button class="mem-tab' + (k===_cur.view?' on':'') + '" data-view="' + esc(k) + '">' + t + '</button>').join('') + '</div>';
  const el = document.getElementById('pr-body');
  if(_cur.view === 'articles') h += await _rArticles(s);
  else if(_cur.view === 'laws') h += _rLaws(s);
  else if(_cur.view === 'topics') h += _rTopics(s);
  else if(_cur.view.startsWith('pt:')) h += await _rPoints(s, _cur.view.slice(3));
  else if(_cur.view === 'variants') h += await _rVariants(s);
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

// 🎲 猜題變化題（升官等記憶樹）
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
async function _rVariants(){
  const v = await _loadVariants();
  const qs = await da('questions');
  const stems = new Set(qs.map(q => _norm(q.stem)));
  const bySub = {};
  v.items.forEach(it => {
    const o = bySub[it.subject] || (bySub[it.subject] = { orig:0, vari:0, have:0 });
    it.variant ? o.vari++ : o.orig++;
    if(stems.has(_norm(it.stem))) o.have++;
  });
  return '<div class="pr-note">來源：' + esc(v.title || '升官等記憶樹選擇題猜題') + '。依升官等歷屆題回測挑出的高機率原題，與改寫成否定題、數字互換、對象互換的變化題；每題附詳解與猜題理由。警察法規、憲法與警大二技範圍重疊度高。</div>' +
    '<div class="card">' + Object.entries(bySub).map(([k, o]) =>
      '<div class="pr-row"><div class="pr-main"><div class="pr-title">' + esc(k) + '</div><div class="pr-meta">原題 ' + o.orig + '・變化題 ' + o.vari + '・題庫已有 ' + o.have + '</div>' +
      '<div class="pr-acts"><button class="go" data-vprev="' + esc(k) + '">▶ 直接練習（不存題庫）</button><button data-vimp="' + esc(k) + '">⬇ 匯入題庫</button></div></div></div>').join('') + '</div>' +
    '<div style="padding:0 12px 12px"><button class="btn bg" style="width:100%" data-vimp="*">⬇ 全部匯入題庫（' + v.items.length + ' 題，已有的會略過）</button></div>' +
    '<div class="mem-prog">匯入後考試別為「猜題（原題）」或「猜題（變化題）」，會進入今日複習、加強複習與統計；不想混在一起就用「直接練習」。</div>';
}
function _variantToQ(it){
  const q = {
    type:'mc', stem:it.stem, options:it.options, answer:it.answer, answerEs:'',
    subject:it.subject, year:'116', exam: it.variant ? '猜題（變化題）' : '猜題（原題）', num:'',
    keywords: it.topic ? [it.topic.replace(/（變化）$/, '')] : [], mustKeywords:[], tags:['猜題'],
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
  const items = v.items.filter(it => sub === '*' || it.subject === sub);
  const qs = await da('questions');
  const stems = new Set(qs.map(q => _norm(q.stem)));
  const add = items.filter(it => !stems.has(_norm(it.stem))).map(_variantToQ);
  if(!add.length){ toast('這些題目題庫裡都有了'); return; }
  if(!await askConfirm('匯入猜題到題庫', '新增 ' + add.length + ' 題（略過題庫已有的 ' + (items.length - add.length) + ' 題）', '匯入')) return;
  await bulkPut('questions', add);
  toast('已匯入 ' + add.length + ' 題');
  _rBody();
}
async function _previewVariants(sub){
  const v = await _loadVariants();
  const pool = v.items.filter(it => it.subject === sub).map((it, i) => Object.assign(_variantToQ(it), { id:'virt:var-' + i, num:String(i+1) }));
  pool.sort(() => Math.random() - .5);
  startQWithPool(pool, '🎲 ' + sub + '猜題');
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
    const t = e.target.closest('[data-si],[data-view],[data-k],[data-sort],[data-act],[data-qids],[data-ref],[data-mem],[data-vimp],[data-vprev]');
    if(!t) return;
    const ds = t.dataset;
    if(ds.si != null){ _cur.si = +ds.si; _rSubj(); _rBody(); }
    else if(ds.view){ _cur.view = ds.view; _rBody(); }
    else if(ds.k){ _cur.k = +ds.k; _rBody(); }
    else if(ds.sort){ _cur.sort = _cur.sort === 'recent' ? 'count' : 'recent'; _rBody(); }
    else if(ds.qids) _practiceIds(ds.qids.split(','), ds.label || '');
    else if(ds.ref) showLawPop(ds.ref);
    else if(ds.mem) openMemoryAt(ds.mem);
    else if(ds.vimp) _importVariants(ds.vimp).catch(err => { logError('importVariants', err); toast('匯入失敗'); });
    else if(ds.vprev) _previewVariants(ds.vprev);
    else if(ds.act === 'clamp') t.classList.toggle('open');
    else if(ds.act === 'wrong'){ _cur.onlyWrong = !_cur.onlyWrong; _rBody(); }
    else if(ds.act === 'goeng') goPage('engexam');
    else if(ds.act === 'practice'){
      const s = _data.subjects[_cur.si];
      _practiceIds(_sorted(s.articles).flatMap(a => a.question_ids||[]), s.name + ' 前' + _cur.k + '條');
    }
  });
}

const Predict = { renderPredict };
Object.assign(window, Predict);
})();
