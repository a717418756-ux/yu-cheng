// ══ engexam.js — 考試英文重點（成長區・英語學習庫）════════════════
// 依賴：db.js(da/dp), utils.js(esc/toast), quiz.js(startQWithPool), english.js(splitEngSentences)
// 資料：data/english_exam.json（警大二技 105–115 年英文 460 題：題型、題幹、選項、答案）
//       data/english_police.json（警察專業英文，依 115 年新題型主題分組）
// 四個分頁：
//   📊 題型｜📗 高頻字彙（歷屆正確答案＋原句）｜👮 警察專業英文｜📖 閱讀・克漏字（一鍵轉成英語教材，用逐句朗讀跟讀）
// 字彙可「＋單字本」（englishVocab，隨備份）、🔊 朗讀（瀏覽器內建英文語音）。
//
// 公開 API 見檔尾 window.EngExam

(function(){
'use strict';

let _exam = null, _police = null;
let _cur = { tab:'topic', vq:'', vyear:'', pg:'' };
try{ const t = localStorage.getItem('eeTab'); if(['topic','vocab','police','read'].includes(t)) _cur.tab = t; }catch(e){}
let _vocabSet = null;       // 單字本已有的字（小寫）

async function _load(){
  if(!_exam){
    const [a, b] = await Promise.all([fetch('data/english_exam.json'), fetch('data/english_police.json')]);
    if(!a.ok || !b.ok) throw new Error('english data ' + a.status + '/' + b.status);
    _exam = await a.json(); _police = await b.json();
  }
  if(!_vocabSet){
    try{ _vocabSet = new Set((await da('englishVocab')).map(v => String(v.word||'').toLowerCase())); }
    catch(e){ _vocabSet = new Set(); }
  }
}

// 題幹清理：§OPT§（擷取工具的選項標記）去掉、[[11]] 克漏字空格換成 ___
const _clean = s => String(s||'').replace(/§OPT§/g, '').replace(/\[\[\d+\]\]/g, '___').replace(/\s+/g, ' ').trim();

// ════════ 頁面 ════════
async function renderEngExam(){
  const el = document.getElementById('ee-body');
  if(!el) return;
  try{
    await _load();
    _bind();
    _rTabs();
    _rBody();
  }catch(e){
    logError('renderEngExam', e);
    el.innerHTML = '<div class="mem-empty">英文考點資料載入失敗，請確認網路後重新整理。</div>';
  }
}
const TABS = [['topic','📊 題型'], ['vocab','📗 高頻字彙'], ['police','👮 警察專業英文'], ['read','📖 閱讀・克漏字']];
function _rTabs(){
  document.getElementById('ee-tabs').innerHTML = TABS.map(([k, t]) =>
    '<button class="mem-tab' + (k===_cur.tab?' on':'') + '" data-tab="' + k + '">' + t + '</button>').join('');
}
function _rBody(){
  const el = document.getElementById('ee-body');
  el.innerHTML = ({ topic:_rTopic, vocab:_rVocab, police:_rPolice, read:_rRead })[_cur.tab]();
}

// 📊 題型
function _rTopic(){
  const t = _exam.topics || {};
  const all = t.overall || {}, rec = t.recent || {};
  const tot = Object.values(all).reduce((a, b) => a + b, 0) || 1;
  const rtot = Object.values(rec).reduce((a, b) => a + b, 0) || 1;
  const keys = Object.keys(all).sort((a, b) => all[b] - all[a]);
  const cnt = {};
  _exam.questions.forEach(q => cnt[q.t] = (cnt[q.t]||0) + 1);
  return '<div class="pr-note">警大二技英文 105–115 年共 ' + _exam.questions.length + ' 題。<b>115 年題型大改</b>：第 21–40 題幾乎都是警察專業概念的複選題（往年每年 0–2 題）→ 看「👮 警察專業英文」。</div>' +
    '<div class="cc"><div class="ct">題型比重（藍＝全部年度、橘＝近3次）</div>' + keys.map(k =>
      '<div class="pr-bar"><div class="pr-bar-l">' + esc(k) + '</div><div class="pr-bar-t"><i style="width:' + (100*all[k]/tot) + '%"></i><i class="r" style="width:' + (100*(rec[k]||0)/rtot) + '%"></i></div>' +
      '<div class="pr-bar-n">' + Math.round(100*all[k]/tot) + '%／' + Math.round(100*(rec[k]||0)/rtot) + '%</div></div>').join('') + '</div>' +
    '<div class="cc"><div class="ct">依題型練習歷屆題（從題庫取題）</div><div class="pr-acts">' +
      Object.keys(cnt).filter(k => k && k !== '未分類').map(k => '<button class="go" data-ptype="' + esc(k) + '">▶ ' + esc(k) + ' ' + cnt[k] + ' 題</button>').join('') + '</div></div>' +
    '<div class="cc"><div class="ct">讀法建議</div>' + (_police.tips||[]).map(x => '<div class="ee-tip" style="margin-bottom:8px"><b>' + esc(x.t) + '</b>：' + esc(x.d) + '</div>').join('') + '</div>';
}

// 📗 高頻字彙：字彙題的正確答案（複選＝同義字一組），原句當例句
function _vocabList(){
  const out = [];
  _exam.questions.filter(q => q.t === '字彙').forEach(q => {
    const ans = String(q.a||'').replace(/[^A-E]/g, '').split('');
    const words = ans.map(k => (q.o||{})[k]).filter(Boolean);
    if(!words.length) return;
    const wrong = Object.entries(q.o||{}).filter(([k]) => !ans.includes(k)).map(([, v]) => v);
    out.push({ id:q.id, y:q.y, n:q.n, words, wrong, stem:_clean(q.s) });
  });
  return out.sort((a, b) => b.y - a.y || (+a.n) - (+b.n));
}
function _rVocab(){
  const all = _vocabList();
  const years = [...new Set(all.map(v => v.y))].sort((a, b) => b - a);
  const kw = _cur.vq.toLowerCase();
  const list = all.filter(v => (!_cur.vyear || String(v.y) === _cur.vyear) &&
    (!kw || v.words.join(' ').toLowerCase().includes(kw) || v.stem.toLowerCase().includes(kw)));
  return '<div class="mem-tools"><input class="mem-search" id="ee-vq" placeholder="搜尋單字或句子" value="' + esc(_cur.vq) + '">' +
    '<select class="mem-sel" id="ee-vyear"><option value="">全部年度</option>' + years.map(y => '<option' + (String(y)===_cur.vyear?' selected':'') + '>' + y + '</option>').join('') + '</select></div>' +
    '<div class="mem-tools"><button class="btn bp" data-act="vquiz" style="flex:1">▶ 字彙抽考（從歷屆字彙題出 20 題）</button></div>' +
    '<div class="mem-prog">' + list.length + ' 題的正確答案；複選題的答案是一組同義字。灰字是當年的錯誤選項（干擾字）。</div>' +
    '<div class="card">' + list.slice(0, 300).map(v => {
      const w = v.words.join(' / ');
      const ex = esc(v.stem).replace('___', '<mark>' + esc(v.words[0]) + '</mark>');
      return '<div class="ee-word"><button class="ee-say" data-say="' + esc(v.stem.replace('___', v.words[0])) + '" title="朗讀">🔊</button>' +
        '<div style="flex:1;min-width:0"><div class="ee-w">' + esc(w) + '</div>' +
        '<div class="ee-ex">' + ex + '</div>' +
        '<div class="pr-meta">' + v.y + ' 年第 ' + esc(String(v.n)) + ' 題・干擾字：' + esc(v.wrong.join('、')) + '</div></div>' +
        _addBtn(v.words[0], '', v.stem.replace('___', v.words[0])) + '</div>';
    }).join('') + '</div>';
}

// 👮 警察專業英文
function _rPolice(){
  const groups = _police.groups || [];
  const chips = '<div class="chips">' + '<button class="chip' + (!_cur.pg?' on':'') + '" data-pg="">全部</button>' +
    groups.map(g => '<button class="chip' + (g.id===_cur.pg?' on':'') + '" data-pg="' + g.id + '">' + esc(g.title.split(' ')[0]) + '</button>').join('') + '</div>';
  const n = groups.reduce((s, g) => s + g.terms.length, 0);
  return '<div class="pr-note">' + esc(_police.note) + '</div>' + chips +
    '<div class="mem-tools"><button class="btn bp" data-act="pquiz" style="flex:1">▶ 英→中抽考（' + n + ' 個詞）</button><button class="btn bg" data-act="padd">全部加入單字本</button></div>' +
    groups.filter(g => !_cur.pg || g.id === _cur.pg).map(g =>
      '<div class="cc"><div class="ct">' + esc(g.title) + '</div>' +
      '<div class="pr-meta" style="margin-bottom:6px">題型範例：' + esc(g.q) + '</div>' +
      g.terms.map(t => '<div class="ee-word"><button class="ee-say" data-say="' + esc(t.en + '. ' + (t.ex||'')) + '" title="朗讀">🔊</button>' +
        '<div style="flex:1;min-width:0"><div class="ee-w">' + esc(t.en) + '</div><div class="ee-zh">' + esc(t.zh) + '</div>' +
        (t.ex ? '<div class="ee-ex">' + esc(t.ex) + '</div>' : '') + '</div>' + _addBtn(t.en, t.zh, t.ex) + '</div>').join('') +
      '</div>').join('');
}

// 📖 閱讀・克漏字：題組 → 英語教材
function _groups(){
  const m = new Map();
  _exam.questions.filter(q => q.g).forEach(q => {
    const k = q.gid || (q.y + ':' + q.g.slice(0, 30));
    if(!m.has(k)) m.set(k, { key:k, y:q.y, t:q.t, text:_clean(q.g), qs:[] });
    m.get(k).qs.push(q);
  });
  m.forEach(g => g.qs.sort((a, b) => (a.go||0) - (b.go||0)));
  return [...m.values()].sort((a, b) => b.y - a.y);
}
function _rRead(){
  const gs = _groups();
  return '<div class="pr-note">歷屆閱讀測驗與克漏字題組共 ' + gs.length + ' 篇。按「轉成教材」會存進英語學習庫，就能用逐句朗讀、跟讀練習；題目本身可按「▶ 練習」作答。</div>' +
    gs.map(g => {
      return '<div class="card"><div class="pr-title">' + g.y + ' 年・' + esc(g.t) + '（第 ' + esc(String(g.qs[0].n)) + ' 題）</div>' +
        '<div class="pr-text" data-act="clamp">' + esc(g.text) + '</div>' +
        '<div class="pr-acts"><button class="go" data-mat="' + esc(g.key) + '">⬇ 轉成教材</button>' +
        '<button data-qids="' + esc(g.qs.map(q => q.id).join(',')) + '" data-label="' + g.y + '年' + esc(g.t) + '">▶ 練習 ' + g.qs.length + ' 題</button>' +
        '<button data-say="' + esc(g.text.replace(/___/g, 'blank')) + '">🔊 朗讀</button></div></div>';
    }).join('');
}
async function _toMaterial(key){
  const g = _groups().find(x => x.key === key);
  if(!g) return;
  const title = '【警大' + g.y + '】' + g.t + ' 第' + g.qs[0].n + '題';
  const mats = await da('englishMaterials');
  if(mats.some(m => m.title === title)){ toast('英語學習庫已有這篇'); return; }
  const split = typeof splitEngSentences === 'function' ? splitEngSentences : (t => t.split(/(?<=[.!?])\s+/));
  const qtext = g.qs.map((q, i) => (i + 1) + '. ' + _clean(q.s) + ' ' +
    Object.entries(q.o||{}).map(([k, v]) => '(' + k + ') ' + v).join(' ')).join('\n\n');
  await dp('englishMaterials', { title, sourceType:'text', sentences: split(g.text + '\n\n' + qtext), createdAt:Date.now() });
  toast('已存入英語學習庫：' + title);
}

// ════════ 單字本 ════════
function _addBtn(word, zh, ex){
  const on = _vocabSet && _vocabSet.has(String(word).toLowerCase());
  return '<button class="ee-add' + (on?' on':'') + '" data-add="' + esc(word) + '" data-zh="' + esc(zh||'') + '" data-ex="' + esc(ex||'') + '">' + (on ? '✓ 已加' : '＋單字本') + '</button>';
}
async function _addVocab(word, zh, ex){
  const k = String(word).toLowerCase();
  if(_vocabSet.has(k)) return false;
  await dp('englishVocab', { word, meaning:zh||'', example:ex||'', materialId:0, source:'考試英文重點',
    reviewLevel:0, nextReview:Date.now(), createdAt:Date.now() });
  _vocabSet.add(k);
  return true;
}

// ════════ 練習（臨時題，不存題庫）════════
function _shuffle(a){ for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function _mcq(id, stem, right, wrongs, subject, note){
  const opts = _shuffle([right, ..._shuffle(wrongs.slice()).slice(0, 3)]);
  const L = ['A','B','C','D'];
  const options = {}; opts.forEach((o, i) => options[L[i]] = o);
  return { id:'virt:' + id, type:'mc', subject, exam:'英文考點', year:'', num:'', stem, options,
    answer:L[opts.indexOf(right)], note:note||'', keywords:[], relatedLaws:[] };
}
function _vocabQuiz(){
  const pool = _shuffle(_exam.questions.filter(q => q.t === '字彙' && /^[A-E]$/.test(q.a||''))).slice(0, 20)
    .map((q, i) => ({ id:'virt:eev-' + i, type:'mc', subject:'英文', exam:'英文考點', year:q.y, num:String(q.n),
      stem:_clean(q.s), options:q.o, answer:q.a, note:'警大二技 ' + q.y + ' 年第 ' + q.n + ' 題', keywords:[], relatedLaws:[] }));
  startQWithPool(pool, '📗 字彙抽考');
}
function _policeQuiz(){
  const terms = (_police.groups||[]).filter(g => !_cur.pg || g.id === _cur.pg).flatMap(g => g.terms);
  const allZh = (_police.groups||[]).flatMap(g => g.terms.map(t => t.zh));
  const pool = _shuffle(terms.slice()).slice(0, 25).map((t, i) =>
    _mcq('eep-' + i, t.en + ' 的意思是？', t.zh, allZh.filter(z => z !== t.zh), '英文', t.ex));
  startQWithPool(pool, '👮 警察英文');
}
async function _practiceIds(ids, label){
  const qs = await da('questions');
  const m = new Map(qs.map(q => [String(q.id), q]));
  const pool = ids.map(id => m.get(String(id))).filter(Boolean);
  if(!pool.length){ toast('題庫裡找不到這些題目'); return; }
  startQWithPool(pool, '🗣️ ' + label);
}

// ════════ 朗讀 ════════
function _say(text){
  try{
    const ss = window.speechSynthesis;
    if(!ss){ toast('這台裝置不支援語音朗讀'); return; }
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.9;
    const v = ss.getVoices().find(x => /^en(-|_)US/i.test(x.lang)) || ss.getVoices().find(x => /^en/i.test(x.lang));
    if(v) u.voice = v;
    ss.speak(u);
  }catch(e){ logError('engexam.say', e); }
}

// ════════ 事件 ════════
function _bind(){
  const page = document.getElementById('pg-engexam');
  if(!page || page._eeBound) return;
  page._eeBound = true;
  page.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab],[data-say],[data-add],[data-pg],[data-act],[data-mat],[data-qids],[data-ptype]');
    if(!t) return;
    const d = t.dataset;
    try{
      if(d.tab){ _cur.tab = d.tab; try{ localStorage.setItem('eeTab', d.tab); }catch(err){} _rTabs(); _rBody(); }
      else if(d.say != null) _say(d.say);
      else if(d.add != null){
        if(await _addVocab(d.add, d.zh, d.ex)){ t.classList.add('on'); t.textContent = '✓ 已加'; toast('已加入單字本'); }
      }
      else if(d.pg != null){ _cur.pg = d.pg; _rBody(); }
      else if(d.mat) await _toMaterial(d.mat);
      else if(d.qids) await _practiceIds(d.qids.split(','), d.label || '');
      else if(d.ptype) await _practiceIds(_exam.questions.filter(q => q.t === d.ptype).map(q => q.id), d.ptype);
      else if(d.act === 'clamp') t.classList.toggle('open');
      else if(d.act === 'vquiz') _vocabQuiz();
      else if(d.act === 'pquiz') _policeQuiz();
      else if(d.act === 'padd'){
        let n = 0;
        for(const g of (_police.groups||[]).filter(g => !_cur.pg || g.id === _cur.pg))
          for(const x of g.terms) if(await _addVocab(x.en, x.zh, x.ex)) n++;
        toast(n ? '已加入 ' + n + ' 個詞到單字本' : '都已在單字本裡');
        _rBody();
      }
    }catch(err){ logError('engexam.click', err); toast('操作失敗，請重試'); }
  });
  page.addEventListener('input', e => {
    if(e.target.id === 'ee-vq'){
      clearTimeout(page._vqT);
      page._vqT = setTimeout(() => {
        _cur.vq = e.target.value;
        const pos = e.target.selectionStart;
        _rBody();
        const inp = document.getElementById('ee-vq');
        if(inp){ inp.focus(); try{ inp.setSelectionRange(pos, pos); }catch(_){} }
      }, 300);
    }
  });
  page.addEventListener('change', e => {
    if(e.target.id === 'ee-vyear'){ _cur.vyear = e.target.value; _rBody(); }
  });
}

const EngExam = { renderEngExam };
Object.assign(window, EngExam);
})();
