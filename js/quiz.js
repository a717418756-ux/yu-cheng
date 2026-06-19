// ══ quiz.js — 刷題模式（含遺忘曲線、計時、危險等級）══════
// 依賴：db.js, utils.js, data.js(getPriorityPool/showLawPop), app.js(renderHome)
//
// v2.8.1 重構：
// - IIFE 模組化，僅輸出公開 API（見檔尾 window.Quiz 與相容別名）
// - 動態元素改用事件委派（#qopts / #qlaw-list / #qdone-area），
//   不再把資料拼進 onclick 字串
// - 功能與 v2.8.0 完全相同

(function(){
'use strict';

let _qStart = 0;            // 題目開始時間
let _lastPool = [];         // 完成後供「再練習一次」用
let _lastMode = 'all';

// ════════ 啟動入口 ════════
// ════════════════════════════════════════════════════════════
// 【答題：啟動與題目池】
// ════════════════════════════════════════════════════════════
async function startQ(mode){  try{
  const pool = await getPriorityPool(mode);
  if(!pool.length){ toast(mode==='wrong' ? '目前沒有錯題' : '目前沒有題目'); return; }
  startQWithPool(pool, mode);
  }catch(e){ logError('startQ', e); }}

function startQWithPool(pool, mode){
  S.quiz = { q:pool, idx:0, ans:false, res:[], mode:mode||'all', _selected:new Set() };
  // 確保 qfoot 可見（showQDone 會隱藏）
  const qfoot = document.getElementById('qfoot');
  if(qfoot) qfoot.style.display = '';
  renderQCard();
  document.getElementById('qv').style.display = 'flex';
}

// ════════ 題卡渲染 ════════
// ════════════════════════════════════════════════════════════
// 【答題：題目卡渲染】
// ════════════════════════════════════════════════════════════
function renderQCard(){
  const {q, idx} = S.quiz;
  if(idx >= q.length){ showQDone(); return; }
  const qu = q[idx];
  _qStart = Date.now();
  S.quiz._selected = new Set();

  // 恢復被 showQDone 隱藏的元素
  ['qbadge','qmeta','q-type-hint','qstem','qopts','qres'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.style.display = '';
  });
  const doneArea = document.getElementById('qdone-area');
  if(doneArea){ doneArea.style.display = 'none'; doneArea.innerHTML = ''; }
  const qfoot = document.getElementById('qfoot');
  if(qfoot) qfoot.style.display = '';

  // 進度
  document.getElementById('qpb').style.setProperty('--qpb-w', ((idx/q.length)*100)+'%');
  document.getElementById('qct').textContent = (idx+1)+'/'+q.length;

  // 題型 badge + 危險等級
  const danger = qu._danger || '';
  document.getElementById('qbadge').className = 'badge '+(qu.type==='mc' ? 'bmc' : 'bes');
  document.getElementById('qbadge').textContent = (qu.type==='mc' ? '選擇' : '申論');
  document.getElementById('qmeta').textContent =
    [qu.subject, qu.year, qu.num ? '第'+qu.num+'題' : '', danger].filter(Boolean).join(' · ');

  // 題組共同題幹（有 groupStem 才顯示）
  const qGroupEl = document.getElementById('q-group-stem');
  if(qGroupEl){
    if(qu.groupStem){
      const orderLabel = qu.groupOrder ? `（第 ${qu.groupOrder} 題）` : '';
      qGroupEl.textContent = '【題組共同題幹】'+orderLabel+'\n'+qu.groupStem;
      qGroupEl.style.display = '';
    } else {
      qGroupEl.style.display = 'none';
      qGroupEl.textContent = '';
    }
  }

  // 題幹
  document.getElementById('qstem').textContent = qu.stem || '';
  document.getElementById('qres').className = 'qres';
  document.getElementById('qres').textContent = '';
  const noteEl = document.getElementById('qnote');
  noteEl.style.display = 'none'; noteEl.textContent = ''; noteEl.style.borderLeft = '';

  // 收藏
  const star = document.getElementById('qstar');
  star.className = 'qfb qstar'+(qu.starred ? ' on' : '');
  star.textContent = qu.starred ? '★' : '☆';

  // 下一題按鈕
  document.getElementById('qnxt').classList.add('hide');

  if(qu.type === 'mc'){
    document.getElementById('qes').style.display = 'none';
    const optsEl = document.getElementById('qopts');
    const ansStr = (qu.answer||'').replace(/[, ]/g,'');
    const isMulti = ansStr.length > 1;
    S.quiz._selected = new Set();
    // 題型提示
    const hintEl = document.getElementById('q-type-hint');
    if(hintEl) hintEl.textContent = isMulti ? '🔢 複選題（可選多個）' : '☑ 單選題';
    // 更新 meta
    const meta = document.getElementById('qmeta');
    if(meta) meta.textContent = [qu.subject, qu.year, qu.num ? '第'+qu.num+'題' : ''].filter(Boolean).join(' · ');
    // 選項（事件委派處理點擊，不用 inline onclick）
    optsEl.innerHTML = Object.entries(qu.options||{}).map(([k,v])=>
      '<div class="qopt" data-key="'+esc(k)+'"><div class="qok">'+esc(k)+'</div><div class="qov">'+esc(v)+'</div></div>'
    ).join('');
    // 多選才顯示確認按鈕，單選自動提交不需要
    const cfmBtn = document.getElementById('qmulti-confirm');
    if(cfmBtn){ if(isMulti) cfmBtn.classList.remove('hide'); else cfmBtn.classList.add('hide'); }
    // 相關法條先隱藏，確認後顯示
    const lawEl = document.getElementById('qlaw');
    if(lawEl) lawEl.style.display = 'none';
  } else {
    document.getElementById('qopts').innerHTML = '';
    document.getElementById('qes').style.display = 'block';
    document.getElementById('qrevbtn').textContent = '顯示參考答案 / 解析';
    document.getElementById('qrevbtn').disabled = false;
    // 申論題：隱藏「確認答案」，等 revealES 後才顯示「下一題」
    const cfmBtnEs = document.getElementById('qmulti-confirm');
    if(cfmBtnEs) cfmBtnEs.classList.add('hide');
    showQLawLinks(qu);
  }
}

function showQLawLinks(qu){
  const lawEl  = document.getElementById('qlaw');
  const listEl = document.getElementById('qlaw-list');
  const laws = qu.relatedLaws || [];
  if(!laws.length){ lawEl.style.display = 'none'; return; }
  // 法條參照放在 data-ref 屬性，由事件委派讀取（不經過 JS 字串層，無跳脫問題）
  listEl.innerHTML = laws.map(l=>{
    const ref = l.ref || l.lawName || '';
    return `<span class="tag qlaw-tag" style="color:var(--pur);cursor:pointer" data-ref="${esc(ref)}">⚖ ${esc(ref)}</span>`;
  }).join('');
  lawEl.style.display = 'block';
}

// ════════ 作答（單選）════════
// ════════════════════════════════════════════════════════════
// 【答題：單選作答與批改】
// ════════════════════════════════════════════════════════════
async function ansQ(sel){  try{
  const qu = S.quiz.q[S.quiz.idx];
  if(S.quiz.ans) return;
  S.quiz.ans = true;
  const responseTime = Date.now() - _qStart;

  const normSel = (sel||'').toUpperCase().split('').sort().join('');
  const normAns = (qu.answer||'').toUpperCase().split('').sort().join('');
  const correct  = normSel === normAns;
  const hesitant = responseTime > 40000;

  // 更新遺忘曲線
  const curLevel = qu.reviewLevel || 0;
  const {level:newLevel, next:nextReview} = calcNextReview(curLevel, correct);
  qu.reviewLevel = newLevel;
  qu.nextReview  = nextReview;
  qu.lastReview  = Date.now();
  qu.wrongCount    = (qu.wrongCount||0) + (correct ? 0 : 1);
  qu.correctStreak = correct ? (qu.correctStreak||0)+1 : 0;
  // 難度分數（答錯或猶豫提高）
  qu.difficultyScore = Math.min(10,
    (qu.difficultyScore||5) + (correct ? (hesitant ? 0 : -0.5) : 1.5)
  );
  await dp('questions', qu);

  // 記錄 attempt（含時間）
  await dp('attempts', {
    qid:qu.id, correct,
    date: today(),
    responseTime,
    hesitationFlag: hesitant,
    confidence: hesitant ? 'low' : 'normal',
    wrongReason: correct ? '' : '未知'
  });

  // 顯示結果
  const opts = document.querySelectorAll('.qopt');
  const correctKeys = (qu.answer||'').toUpperCase().split('');
  const selKeys = [(sel||'').toUpperCase()];
  opts.forEach(o=>{
    const k = o.querySelector('.qok')?.textContent;
    if(!k) return;
    const isCorrectKey = correctKeys.includes(k);
    const isSelected   = selKeys.includes(k);
    o.classList.remove('selected-opt');
    if(isCorrectKey)      o.classList.add('correct');
    else if(isSelected)   o.classList.add('wrong');
    else                  o.classList.add('dim');
  });
  // 隱藏確認按鈕（不能 remove，下一題還要用）
  const cfmBtn = document.getElementById('qmulti-confirm');
  if(cfmBtn) cfmBtn.classList.add('hide');

  const resEl = document.getElementById('qres');
  resEl.className = 'qres on '+(correct ? 'c' : 'w');
  haptic(correct ? 'success' : 'error');
  resEl.classList.add(correct ? 'qres-pop' : 'qres-shake');
  const isMultiQ = qu.multiAnswer || (qu.answer && qu.answer.length>1 && /^[A-E]{2,}$/.test(qu.answer));
  let msg = correct ? '✓ 正確！' : '✗ 正確答案：'+(qu.answer||'')+(isMultiQ ? ' (多選)' : '');
  if(hesitant) msg += ' ⚠ 作答超過40秒，列入猶豫題';
  resEl.textContent = msg;

  if(qu.note || qu.hlColor){
    const noteEl = document.getElementById('qnote');
    const hlMap={yellow:'#d4a438',green:'#4caf7d',red:'#e05c57'};
    const hlC=qu.hlColor&&hlMap[qu.hlColor]?hlMap[qu.hlColor]:'';
    noteEl.style.display = 'block';
    noteEl.style.borderLeft = hlC ? ('3px solid '+hlC) : '';
    noteEl.textContent = qu.note ? ('📝 '+qu.note) : '🖍 已標記';
  }
  document.getElementById('qnxt').classList.remove('hide');

  S.quiz.res.push({qid:qu.id, correct, responseTime, hesitant});
  }catch(e){ logError('ansQ', e); }}

// ════════ 申論題解析 ════════
function revealES(){
  const qu = S.quiz.q[S.quiz.idx];
  const ans = qu.answerEs || qu.answer || '';
  const resEl = document.getElementById('qres');
  resEl.className = 'qres on r';
  resEl.innerHTML = '<b>參考解析：</b><br>'+esc(ans);

  // 申論題關鍵字檢測
  const must = qu.mustKeywords || [];
  if(must.length){
    resEl.innerHTML += '<br><br><b>關鍵概念檢測：</b><br>';
    const userAns = (document.getElementById('qes-input')?.value || '');
    must.forEach(kw=>{
      const hit = userAns.includes(kw);
      resEl.innerHTML += `<span style="color:${hit?'var(--grn)':'var(--red)'}">${hit?'✓':'✗'} ${esc(kw)}</span>  `;
    });
  }

  document.getElementById('qrevbtn').disabled = true;
  document.getElementById('qnxt').classList.remove('hide');

  const responseTime = Date.now() - _qStart;
  dp('attempts', {qid:qu.id, correct:null, date:today(), responseTime, hesitationFlag:responseTime>40000});
}

// ════════ 流程控制 ════════
// ════════════════════════════════════════════════════════════
// 【答題：導覽與收藏】
// ════════════════════════════════════════════════════════════
function nextQ(){
  S.quiz.idx++;
  S.quiz.ans = false;
  renderQCard();
}

function exitQ(){
  document.getElementById('qv').style.display = 'none';
  S.quiz = {q:[], idx:0, ans:false, res:[], mode:''};
  if(S.page === 'home') renderHome();
}

async function toggleQStar(){  try{
  const qu = S.quiz.q[S.quiz.idx];
  if(!qu) return;
  qu.starred = !qu.starred;
  await dp('questions', qu);
  const star = document.getElementById('qstar');
  star.className = 'qfb qstar'+(qu.starred ? ' on' : '');
  star.textContent = qu.starred ? '★' : '☆';
  toast(qu.starred ? '已收藏 ⭐' : '已取消收藏');
  }catch(e){ logError('toggleQStar', e); }}

// ════════ 完成畫面 ════════
// ════════════════════════════════════════════════════════════
// 【答題：完成結算】
// ════════════════════════════════════════════════════════════
function showQDone(){
  const res = S.quiz.res;
  const total    = res.length;
  const correct  = res.filter(r=>r.correct).length;
  const hesitant = res.filter(r=>r.hesitant).length;
  const avgTime  = total ? Math.round(res.reduce((s,r)=>s+(r.responseTime||0),0)/total/1000) : 0;
  const pct   = total ? Math.round(correct/total*100) : 0;
  const emoji = pct>=90 ? '🏆' : pct>=70 ? '🎉' : pct>=50 ? '💪' : '📚';
  // 保存 pool 供重播用（模組內部變數）
  _lastPool = [...S.quiz.q];
  _lastMode = S.quiz.mode;

  // 隱藏題目相關元素，顯示完成區塊（不覆蓋 qbody，保留所有子元素）
  ['qbadge','qmeta','q-type-hint','qstem','qopts','qres','qnote','qes','qlaw']
    .forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });

  const doneArea = document.getElementById('qdone-area');
  if(doneArea){
    doneArea.style.display = 'flex';
    doneArea.innerHTML =
      '<div style="font-size:48px">'+emoji+'</div>'+
      '<div style="font-size:22px;font-weight:700">'+correct+'/'+total+' 正確</div>'+
      '<div style="font-size:14px;color:var(--t2)">正確率 '+pct+'%</div>'+
      (hesitant ? '<div style="font-size:13px;color:var(--org)">⚠ '+hesitant+' 題猶豫超過40秒</div>' : '')+
      '<div style="font-size:13px;color:var(--t2)">平均作答 '+avgTime+' 秒</div>'+
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">'+
      '<button class="btn bp bw" style="padding:14px;font-size:15px" data-action="replay">🔄 再練習一次</button>'+
      '<button class="btn bg bw" style="padding:12px;font-size:14px" data-action="exit">← 返回首頁</button>'+
      '</div>';
  }
  document.getElementById('qfoot').style.display = 'none';
}

function replayQuiz(){
  // 重新打亂順序再練一次
  const pool = _lastPool || [];
  const mode = _lastMode || 'all';
  if(!pool.length){ exitQ(); return; }
  // Fisher-Yates 洗牌
  const shuffled = [...pool];
  for(let i=shuffled.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  startQWithPool(shuffled, mode);
}

// ════════ 模擬考模式 ════════
// ════════════════════════════════════════════════════════════
// 【答題：模擬考/快刷】
// ════════════════════════════════════════════════════════════
async function startExam(totalQ=50, timeLimitMin=50){  try{
  const pool = await getPriorityPool('all');
  if(pool.length < 5){ toast('題目不足，請先匯入題目'); return; }
  const selected = pool.slice(0, Math.min(totalQ, pool.length));
  S.examTimeLimit = timeLimitMin*60*1000;
  S.examStart = Date.now();
  startQWithPool(selected, 'exam');
  // 計時器
  if(S._examTimer) clearInterval(S._examTimer);
  S._examTimer = setInterval(()=>{
    const left = S.examTimeLimit - (Date.now()-S.examStart);
    if(left <= 0){ clearInterval(S._examTimer); toast('時間到！'); showQDone(); return; }
    const m = Math.floor(left/60000), s = Math.floor((left%60000)/1000);
    const el = document.getElementById('qct');
    if(el) el.textContent = `⏱${m}:${s.toString().padStart(2,'0')} · ${S.quiz.idx+1}/${selected.length}`;
  }, 1000);
  }catch(e){ logError('startExam', e); }}

// ════════ 快刷模式（5題/3分鐘）════════
async function startQuick(){  try{
  const pool = await getPriorityPool('all');
  if(!pool.length){ toast('沒有題目'); return; }
  // 優先危險題，取5題
  const selected = pool.filter(q=>q._danger==='🔴'||q._danger==='🟠').slice(0,3)
    .concat(pool.slice(0,5)).slice(0,5);
  startQWithPool([...new Set(selected)], 'quick');
  }catch(e){ logError('startQuick', e); }}

// ════════ 選項選取 ════════
// ════════════════════════════════════════════════════════════
// 【答題：複選作答】
// ════════════════════════════════════════════════════════════
function selectOpt(el, key){
  if(S.quiz.ans) return;
  if(!S.quiz._selected) S.quiz._selected = new Set();
  const qu = S.quiz.q[S.quiz.idx];
  if(!qu) return; // 防呆：quiz 尚未開始
  const ansStr = (qu.answer||'').replace(/[, ]/g,'');
  const isMulti = ansStr.length > 1;
  if(isMulti){
    // 複選：切換
    if(S.quiz._selected.has(key)){
      S.quiz._selected.delete(key);
      el.classList.remove('selected');
    } else {
      S.quiz._selected.add(key);
      el.classList.add('selected');
    }
  } else {
    // 單選：只能選一個，選後立即自動提交
    document.querySelectorAll('.qopt').forEach(o=>o.classList.remove('selected'));
    S.quiz._selected.clear();
    S.quiz._selected.add(key);
    el.classList.add('selected');
    ansQ(key);
  }
}

function submitMulti(){
  if(S.quiz.ans) return;
  const qu = S.quiz.q[S.quiz.idx];
  const selected = [...(S.quiz._selected||new Set())].sort().join('');
  const ansStr = (qu.answer||'').replace(/[, ]/g,'').split('').sort().join('');
  ansQMulti(selected, ansStr, qu);
}

async function ansQMulti(selected, correctStr, qu){  try{
  S.quiz.ans = true;
  const responseTime = Date.now() - _qStart;
  const correct  = selected === correctStr;
  const hesitant = responseTime > 40000;
  const curLevel = qu.reviewLevel || 0;
  const {level:newLevel, next:nextReview} = calcNextReview(curLevel, correct);
  qu.reviewLevel = newLevel; qu.nextReview = nextReview; qu.lastReview = Date.now();
  qu.wrongCount    = (qu.wrongCount||0) + (correct ? 0 : 1);
  qu.correctStreak = correct ? (qu.correctStreak||0)+1 : 0;
  qu.difficultyScore = Math.min(10, (qu.difficultyScore||5) + (correct ? (hesitant?0:-0.5) : 1.5));
  await dp('questions', qu);
  await dp('attempts', {qid:qu.id, correct, date:today(), responseTime, hesitationFlag:hesitant, confidence:hesitant?'low':'normal', wrongReason:correct?'':''});
  const opts = document.querySelectorAll('.qopt');
  opts.forEach(o=>{
    const k = o.querySelector('.qok')?.textContent || '';
    const inCorrect  = correctStr.includes(k);
    const inSelected = (S.quiz._selected||new Set()).has(k);
    if(inCorrect && inSelected)        o.classList.add('correct');
    else if(inCorrect && !inSelected)  o.classList.add('missed');
    else if(!inCorrect && inSelected)  o.classList.add('wrong');
    else                               o.classList.add('dim');
  });
  const resEl = document.getElementById('qres');
  resEl.className = 'qres on '+(correct ? 'c' : 'w');
  haptic(correct ? 'success' : 'error');
  resEl.classList.add(correct ? 'qres-pop' : 'qres-shake');
  let msg = correct ? '✓ 完全正確！' : '✗ 正確答案：'+correctStr.split('').join('、');
  if(!correct && selected) msg += '（你選：'+selected.split('').join('、')+'）';
  if(hesitant) msg += ' ⚠ 超過40秒';
  resEl.textContent = msg;
  if(qu.note || qu.hlColor){ const noteEl=document.getElementById('qnote'); const hlMap={yellow:'#d4a438',green:'#4caf7d',red:'#e05c57'}; const hlC=qu.hlColor&&hlMap[qu.hlColor]?hlMap[qu.hlColor]:''; noteEl.style.display='block'; noteEl.style.borderLeft=hlC?('3px solid '+hlC):''; noteEl.textContent=qu.note?('📝 '+qu.note):'🖍 已標記'; }
  document.getElementById('qnxt').classList.remove('hide');

  // 隱藏確認按鈕
  const cfmBtn = document.getElementById('qmulti-confirm');
  if(cfmBtn) cfmBtn.classList.add('hide');
  S.quiz.res.push({qid:qu.id, correct, responseTime, hesitant});
  showQLawLinks(qu);
  }catch(e){ logError('ansQMulti', e); }}

function submitAnswer(){
  const qu = S.quiz.q[S.quiz.idx];
  if(!qu || S.quiz.ans) return; // 防呆：qu 未定義或已作答
  // 申論題直接顯示解析，不卡「請先選擇答案」
  if(qu.type === 'es'){ revealES(); return; }
  const ansStr = (qu.answer||'').replace(/[, ]/g,'');
  const isMulti = ansStr.length > 1;
  if(isMulti){
    submitMulti();
  } else {
    const sel = [...(S.quiz._selected||new Set())][0];
    if(!sel){ toast('請先選擇答案'); return; }
    ansQ(sel);
  }
}

// ════════ 事件委派（取代動態 inline onclick）════════
function _initDelegation(){
  // 選項點擊
  const optsEl = document.getElementById('qopts');
  if(optsEl && !optsEl._qBound){
    optsEl._qBound = true;
    optsEl.addEventListener('click', e=>{
      const opt = e.target.closest('.qopt');
      if(opt && opt.dataset.key) selectOpt(opt, opt.dataset.key);
    });
  }
  // 相關法條標籤
  const lawList = document.getElementById('qlaw-list');
  if(lawList && !lawList._qBound){
    lawList._qBound = true;
    lawList.addEventListener('click', e=>{
      const tag = e.target.closest('.qlaw-tag');
      if(tag && tag.dataset.ref) showLawPop(tag.dataset.ref);
    });
  }
  // 完成畫面按鈕
  const doneArea = document.getElementById('qdone-area');
  if(doneArea && !doneArea._qBound){
    doneArea._qBound = true;
    doneArea.addEventListener('click', e=>{
      const btn = e.target.closest('[data-action]');
      if(!btn) return;
      if(btn.dataset.action === 'replay') replayQuiz();
      else if(btn.dataset.action === 'exit') exitQ();
    });
  }
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _initDelegation);
} else {
  _initDelegation();
}

// ════════ 公開 API ════════
// 新程式碼請使用 Quiz.xxx；window 別名僅供 index.html 既有 onclick 相容
const Quiz = { startQ, startQWithPool, startExam, startQuick,
               submitAnswer, nextQ, exitQ, revealES, toggleQStar };
window.Quiz = Quiz;
Object.assign(window, Quiz);

})();
