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
  if(await _resumeIfAny(mode)) return;
  const pool = await getPriorityPool(mode);
  if(!pool.length){ toast(mode==='wrong' ? '目前沒有錯題' : '目前沒有題目'); return; }
  startQWithPool(pool, mode);
  }catch(e){ logError('startQ', e); }}

// ══ 中途離開可接續 ═══════════════════════════════════════════
//   每答完一題就記下「這一回的題目、下一題、成績」（每個入口各一份）；
//   從同一入口再進來時問要不要接續。限時模擬考不記（計時一中斷就不是模擬考）。
//   開新的一回（startQWithPool）或最後一題答完時清除。
const _resumeKey = (mode = S.quiz.mode) => 'quiz_resume_' + mode;

function _saveResume(){
  const {q, idx, res, mode} = S.quiz;
  if(mode === 'mock') return;
  if(idx + 1 < q.length) setSetting(_resumeKey(), {ids:q.map(x => x.id), idx:idx + 1, res, at:Date.now()});
  else dd('settings', _resumeKey()).catch(()=>{});   // 最後一題答完：沒有可接續的
}

// 有未完成的一回 → 詢問；選「接續」就從下一題開始並回傳 true。
//   選「重新開始」（或按返回）不在這裡刪，等真的開新的一回時才清，免得誤觸就丟進度。
async function _resumeIfAny(mode){
  const s = await getSetting(_resumeKey(mode), null);
  if(!s?.ids?.length) return false;
  if(!await askConfirm('接續上次的進度？',
      '已完成 ' + s.idx + '／' + s.ids.length + ' 題，接著從第 ' + (s.idx + 1) + ' 題開始\n（' + new Date(s.at).toLocaleDateString('zh-TW') + ' 離開）',
      '接續', '重新開始')) return false;
  // 期間刪掉的題目略過，進度跟著往前算
  const byId = new Map((await da('questions')).map(q => [q.id, q]));
  const done = s.ids.slice(0, s.idx).map(id => byId.get(id)).filter(Boolean);
  const rest = s.ids.slice(s.idx).map(id => byId.get(id)).filter(Boolean);
  if(!rest.length){ dd('settings', _resumeKey(mode)).catch(()=>{}); return false; }
  startQWithPool(done.concat(rest), mode, done.length, s.res || []);
  return true;
}

// ══ 限時模擬考 ═══════════════════════════════════════════════
//   只收選擇題（申論重點在架構不在秒數，不適合速度訓練）。
//   與一般練習的差別：作答時不顯示對錯、有倒數計時、交卷後才一次檢討。
let _mockTimer = null;      // 倒數計時器
let _mockEndAt = 0;         // 結束時間戳
let _mockExitConfirmed = false;   // 已確認放棄，避免確認框遞迴

function startMockExam(){  try{
  const ov = document.createElement('div');
  ov.className = 'ov on';
  ov.id = 'mock-ov';
  ov.innerHTML =
    '<div class="sh" onclick="event.stopPropagation()" style="max-width:420px">'
    + '<div class="shdl"></div>'
    + '<div class="sht"><span>限時模擬考</span>'
    +   '<button class="hd-btn bg" onclick="document.getElementById(\'mock-ov\').remove()">✕</button></div>'
    + '<div style="padding:4px 18px 20px">'
    +   '<div style="font-size:12px;color:var(--t2);line-height:1.7;margin-bottom:12px">'
    +     '模擬真實考試：<b>作答時不顯示對錯</b>，交卷後一次檢討。<br>只出選擇題。</div>'
    +   '<div class="fg"><label class="fl">科目</label>'
    +     '<select id="mk-sub"><option value="">全部科目</option></select></div>'
    +   '<div class="fr fg">'
    +     '<div><label class="fl">題數</label><select id="mk-n">'
    +       [25,40,50,60].map(n=>'<option'+(n===40?' selected':'')+'>'+n+'</option>').join('')
    +     '</select></div>'
    +     '<div><label class="fl">時間（分鐘）</label><select id="mk-t">'
    +       [30,45,60,90,120].map(n=>'<option'+(n===60?' selected':'')+'>'+n+'</option>').join('')
    +     '</select></div>'
    +   '</div>'
    +   '<div id="mk-hint" style="font-size:11.5px;color:var(--t2);margin:2px 0 12px"></div>'
    +   '<button class="btn bp bw" style="width:100%;padding:11px;font-size:14px;font-weight:600"'
    +     ' onclick="beginMockExam()">開始作答</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  // 帶入科目清單與可用題數
  da('questions').then(qs=>{
    const mc = qs.filter(q=>q.type==='mc' && (q.answer||'').trim());
    const subs=[...new Set(mc.map(q=>q.subject).filter(Boolean))].sort();
    const sel=document.getElementById('mk-sub');
    if(sel) sel.innerHTML='<option value="">全部科目（'+mc.length+' 題可用）</option>'
      + subs.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'（'
        + mc.filter(q=>q.subject===x).length+' 題）</option>').join('');
    const hint=document.getElementById('mk-hint');
    if(hint) hint.textContent='※ 只計入已填正確答案的選擇題';
  }).catch(()=>{});
  }catch(e){ logError('startMockExam', e); }}

async function beginMockExam(){  try{
  const sub = document.getElementById('mk-sub')?.value || '';
  const n   = parseInt(document.getElementById('mk-n')?.value) || 40;
  const min = parseInt(document.getElementById('mk-t')?.value) || 60;

  const qs = await da('questions');
  // 只收「選擇題且已填答案」——沒答案的題目無法計分
  let pool = qs.filter(q=>q.type==='mc' && (q.answer||'').trim());
  if(sub) pool = pool.filter(q=>q.subject===sub);
  if(!pool.length){ toast('這個科目沒有可用的選擇題'); return; }

  // 隨機抽題：題組整組取或不取（裝不下就跳過，換下一個單位），不會只抽到半組
  const picked = [];
  for(const u of shuffleUnits(pool)){
    if(picked.length + u.length <= n) picked.push(...u);
    if(picked.length === n) break;
  }
  if(pool.length < n) toast('可用題目僅 '+pool.length+' 題，已全數出題');
  else if(picked.length < n) toast('題組不拆開，本次共 '+picked.length+' 題');
  pool = picked;

  document.getElementById('mock-ov')?.remove();
  startQWithPool(pool, 'mock');
  _startMockTimer(min);
  }catch(e){ logError('beginMockExam', e); toast('無法開始：'+e.message); }}

function _startMockTimer(min){
  _stopMockTimer();
  _mockEndAt = Date.now() + min*60000;
  let bar = document.getElementById('mock-timer');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'mock-timer';
    bar.className = 'mock-timer';
    document.getElementById('qv')?.appendChild(bar);
  }
  const tick = ()=>{
    const left = _mockEndAt - Date.now();
    if(left <= 0){
      _stopMockTimer();
      toast('時間到，自動交卷');
      endQuizNow();
      return;
    }
    const m = Math.floor(left/60000), s = Math.floor(left%60000/1000);
    bar.textContent = '⏱ ' + m + ':' + String(s).padStart(2,'0');
    bar.classList.toggle('warn', left <= 300000);   // 剩 5 分鐘轉警示色
  };
  tick();
  _mockTimer = setInterval(tick, 1000);
}

function _stopMockTimer(){
  if(_mockTimer){ clearInterval(_mockTimer); _mockTimer = null; }
  document.getElementById('mock-timer')?.remove();
}

function startQWithPool(pool, mode, idx = 0, res = []){
  S.quiz = { q:pool, idx, ans:false, res, mode:mode||'all', _selected:new Set() };
  if(!idx) dd('settings', _resumeKey()).catch(()=>{});   // 開新的一回：舊進度作廢
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

  // 題型 badge；出處（年度、考試別、題號）作答後才由 _afterAnswer 顯示——年度本身就是答題線索
  document.getElementById('qbadge').className = 'badge '+(qu.type==='mc' ? 'bmc' : 'bes');
  document.getElementById('qbadge').textContent = (qu.type==='mc' ? '選擇' : '申論');
  document.getElementById('qmeta').textContent = '';

  // 題組共同題幹（有 groupStem 才顯示）
  const qGroupEl = document.getElementById('q-group-stem');
  if(qGroupEl){
    if(qu.groupStem){
      const orderLabel = qu.groupOrder ? `（第 ${qu.groupOrder} 題）` : '';
      qGroupEl.innerHTML = '<span class="q-group-label">【題組共同題幹】'+esc(orderLabel)+'</span><br>'+renderStemMarkup(qu.groupStem);
      qGroupEl.style.display = '';
    } else {
      qGroupEl.style.display = 'none';
      qGroupEl.textContent = '';
    }
  }

  // 題幹
  document.getElementById('qstem').innerHTML = renderStemMarkup(qu.stem || '');
  document.getElementById('qres').className = 'qres';
  document.getElementById('qres').textContent = '';
  const noteEl = document.getElementById('qnote');
  noteEl.style.display = 'none'; noteEl.textContent = ''; noteEl.style.borderLeft = '';

  // 收藏
  const star = document.getElementById('qstar');
  star.className = 'qfb qstar'+(qu.starred ? ' on' : '');
  // 狀態由 CSS .qstar.on 呈現，不動內容以保留 SVG 圖示

  // 下一題按鈕
  document.getElementById('qnxt').classList.add('hide');
  // 新題目未作答 → 收起筆記與標註入口，並確保退出標註模式
  document.getElementById('qink-btn')?.classList.add('hide');
  document.getElementById('qnote-btn')?.classList.add('hide');
  document.getElementById('qedit-btn')?.classList.add('hide');
  document.getElementById('qtts-btn')?.classList.add('hide');
  if(_inkOn){
    _inkOn = false;
    document.getElementById('qink')?.classList.remove('on');
    document.getElementById('qink-btn')?.classList.remove('on');
  }

  if(qu.type === 'mc'){
    document.getElementById('qes').style.display = 'none';
    const optsEl = document.getElementById('qopts');
    const ansStr = (qu.answer||'').replace(/[, ]/g,'');
    const isMulti = ansStr.length > 1;
    S.quiz._selected = new Set();
    // 題型提示
    const hintEl = document.getElementById('q-type-hint');
    if(hintEl) hintEl.textContent = isMulti ? '🔢 複選題（可選多個）' : '☑ 單選題';
    // 選項隨機排列：只在新題目（尚未作答）時決定順序，作答後重畫沿用同一組
    if(!S.quiz.ans && !_ordOf(qu) && _shufOk(qu)){
      const k = Object.keys(qu.options||{});
      for(let i = k.length - 1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [k[i], k[j]] = [k[j], k[i]]; }
      (S.quiz.ord ||= {})[qu.id] = k;
    }
    _drawOpts(qu);
    // 多選才顯示確認按鈕，單選自動提交不需要
    const cfmBtn = document.getElementById('qmulti-confirm');
    if(cfmBtn){ if(isMulti) cfmBtn.classList.remove('hide'); else cfmBtn.classList.add('hide'); }
    // 相關法條先隱藏，確認後顯示
    const lawEl = document.getElementById('qlaw');
    if(lawEl) lawEl.style.display = 'none';
    // 速讀：不作答，題目一出來就公布答案與解析（不寫作答紀錄）
    if(S.quiz.mode === 'speed'){
      if(hintEl) hintEl.textContent = '⚡ 速讀・' + (isMulti ? '複選題' : '單選題');
      _showMcKey(qu, '');
      S.quiz.ans = true;
      _afterAnswer(qu);
    }
  } else {
    document.getElementById('qopts').innerHTML = '';
    document.getElementById('qes').style.display = 'block';
    document.getElementById('qrevbtn').textContent = '顯示參考答案 / 解析';
    document.getElementById('qrevbtn').disabled = false;
    // 申論題：隱藏「確認答案」，等 revealES 後才顯示「下一題」
    const cfmBtnEs = document.getElementById('qmulti-confirm');
    if(cfmBtnEs) cfmBtnEs.classList.add('hide');
    // ★ 不在此處呼叫 showQLawLinks：這裡是「渲染新題目」時機，
    //   尚未作答就顯示關聯法條等於提前曝光解題線索。
    //   法條改由 revealES() 在公布解答時才顯示（與 mc 題一致）。
    const lawElEs = document.getElementById('qlaw');
    if(lawElEs) lawElEs.style.display = 'none';
    // 申論瀏覽：不作答，題目與參考答案卷直接一起顯示（不寫作答紀錄）
    if(S.quiz.mode === 'esview'){
      document.getElementById('q-type-hint').textContent = '📖 申論瀏覽';
      document.getElementById('qes').style.display = 'none';
      const resEl = document.getElementById('qres');
      resEl.className = 'qres on r';
      resEl.innerHTML = _esPaperHtml(qu);
      S.quiz.ans = true;
      _afterAnswer(qu);
    }
  }
  // 換題：先存起上一題未存的標註，再載入本題的標註
  _inkFlushAndSync();
  _updateNoteBtn();
}

// 換題時：把上一題的筆跡存好，再同步成本題的
function _inkFlushAndSync(){
  const cv = document.getElementById('qink');
  if(!cv) return;
  const pending = _inkDirty ? _inkPrevQ : null;
  if(pending){
    try{
      if(_inkIsBlank(cv)) delete pending.inkImg;
      else pending.inkImg = cv.toDataURL('image/png');
      dp('questions', pending).catch(()=>{});
    }catch(e){}
    _inkDirty = false;
  }
  _inkPrevQ = S.quiz.q[S.quiz.idx] || null;
  // 版面可能尚未完成排版，延後一拍再量測尺寸
  setTimeout(_inkSync, 60);
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

  const selO    = _toOrig((sel||'').toUpperCase(), qu);   // 畫面字母 → 原題字母（未打亂時不變）
  const normSel = selO.split('').sort().join('');
  const normAns = (qu.answer||'').toUpperCase().split('').sort().join('');
  // ★ 題目未填正確答案時（normAns 為空），不可用相等判斷：
  //   若使用者也沒選任何選項，'' === '' 會被判定「答對」，
  //   導致 reviewLevel 升級、nextReview 延後，污染複習排程與統計。
  //   這種題目一律不計分、不影響遺忘曲線，並提示補答案。
  const noAnswerKey = !normAns;
  const correct  = !noAnswerKey && normSel === normAns;
  const hesitant = responseTime > 40000;
  if(noAnswerKey) toast('本題尚未設定正確答案，不計入複習進度');

  // 更新遺忘曲線
  //   缺正確答案的題目完全跳過：不動 reviewLevel/nextReview、不累計錯誤數、
  //   也不寫入 attempts，避免污染複習排程、危險題判定與正確率統計。
  if(!noAnswerKey){
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
  }

  // ★ 先記成績再分流：原本記在最後，模擬考提前 return → 交卷顯示 0/0、中途離開也不會確認
  S.quiz.res.push({qid:qu.id, correct, responseTime, hesitant});

  // ── 模擬考：作答時不揭曉，只標記已選，直接進入下一題 ──
  //   這是模擬考與一般練習的核心差異：真實考試不會告訴你對錯。
  if(S.quiz.mode === 'mock'){
    document.querySelectorAll('.qopt').forEach(o=>{
      const k = o.querySelector('.qok')?.textContent;
      o.classList.toggle('selected-opt', k === (sel||'').toUpperCase());
    });
    document.getElementById('qmulti-confirm')?.classList.add('hide');
    document.getElementById('qnxt')?.classList.remove('hide');
    // 筆記／標註在考試中不開放（考場也不會有）
    return;
  }

  _inkRestoreOrder(qu);   // 有手寫標註：公布前回到原順序，標註才對得上
  // 顯示結果
  const opts = document.querySelectorAll('.qopt');
  const correctKeys = _toDisp((qu.answer||'').toUpperCase(), qu).split('');
  const selKeys = [_toDisp(selO, qu)];
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
  const resEl = document.getElementById('qres');
  resEl.className = 'qres on '+(correct ? 'c' : 'w');
  haptic(correct ? 'success' : 'error');
  resEl.classList.add(correct ? 'qres-pop' : 'qres-shake');
  const isMultiQ = qu.multiAnswer || (qu.answer && qu.answer.length>1 && /^[A-E]{2,}$/.test(qu.answer));
  let msg = correct ? '✓ 正確！' : '✗ 正確答案：'+_ansText(qu, '')+(isMultiQ ? ' (多選)' : '');
  if(hesitant) msg += ' ⚠ 作答超過40秒，列入猶豫題';
  resEl.textContent = msg;

  _showQNote(qu);
  _afterAnswer(qu);
  }catch(e){ logError('ansQ', e); }}

// 直接標出選擇題正確答案（速讀、答題中編輯後重畫共用）
function _showMcKey(qu, prefix){
  const keys = _toDisp((qu.answer||'').toUpperCase(), qu);
  document.querySelectorAll('.qopt').forEach(o => o.classList.add(keys.includes(o.dataset.key) ? 'correct' : 'dim'));
  const resEl = document.getElementById('qres');
  resEl.className = 'qres on r';
  resEl.textContent = prefix + '正確答案：' + (_ansText(qu, '、') || '（未設定）');
  _showQNote(qu);
}

// ══ 選項隨機排列（設定開關，預設關閉）════════════════════════
//   只換畫面上的順序，題目資料不動：S.quiz.ord[題目id] = 畫面上第 1、2…個位置放的「原題字母」。
//   判分一律換回原題字母；答案列、解析裡的 (A)(B) 換成本次順序。作答紀錄只存對錯，不受影響。
let _optShuffle = false;
getSetting('quiz_shuffle_opts', false).then(v => {
  _optShuffle = !!v;
  const c = document.getElementById('set-shuffle'); if(c) c.checked = _optShuffle;
}).catch(()=>{});
function setOptShuffle(on){ _optShuffle = !!on; setSetting('quiz_shuffle_opts', _optShuffle); }
// 不打亂：速讀／申論瀏覽、英文與國文、題幹或選項引用其他選項（以上皆是、(A)選項之但書…）
const _NO_SHUF = /以上(皆|均|都|全)|(其餘|其他)選項|[(（][A-E][)）]/;
function _shufOk(qu){
  if(!_optShuffle || S.quiz.mode === 'speed' || S.quiz.mode === 'esview' || ['英文','國文'].includes(qu.subject)) return false;
  return ![qu.stem, qu.groupStem, ...Object.values(qu.options||{})].some(t => _NO_SHUF.test(String(t||'')));
}
const _ordOf  = qu => S.quiz.ord?.[qu.id];
const _toOrig = (s, qu) => { const o = _ordOf(qu); return o ? [...s].map(c => o['ABCDE'.indexOf(c)] || c).join('') : s; };
const _toDisp = (s, qu) => { const o = _ordOf(qu); return o ? [...s].map(c => o.includes(c) ? 'ABCDE'[o.indexOf(c)] : c).join('') : s; };
// 答案文字：打亂時附上原題字母，方便對照紙本
function _ansText(qu, sep){
  const a = (qu.answer||'').toUpperCase().replace(/[^A-E]/g, '');
  const d = _toDisp(a, qu).split('').sort().join(sep);
  return _ordOf(qu) ? d + '（原題 ' + a.split('').join(sep) + '）' : d;
}
function _drawOpts(qu){
  const o = _ordOf(qu);
  document.getElementById('qopts').innerHTML = (o || Object.keys(qu.options||{})).map((k, i) => {
    const d = o ? 'ABCDE'[i] : k;   // 畫面字母
    return '<div class="qopt" data-key="'+esc(d)+'"><div class="qok">'+esc(d)+'</div><div class="qov">'+renderStemMarkup(qu.options[k])+'</div></div>';
  }).join('');
}
// 手寫標註是照原題順序畫的：本題有標註時，公布答案前回到原順序（模擬考不公布，不必換）
function _inkRestoreOrder(qu){
  if(!_ordOf(qu) || !qu.inkImg || S.quiz.mode === 'mock') return;
  delete S.quiz.ord[qu.id];
  _drawOpts(qu);
}

// 題目筆記／標記顏色（公布答案時顯示）
function _showQNote(qu){
  if(!qu.note && !qu.hlColor) return;
  const noteEl = document.getElementById('qnote');
  const hlMap={yellow:'#d4a438',green:'#4caf7d',red:'#e05c57'};
  const hlC=qu.hlColor&&hlMap[qu.hlColor]?hlMap[qu.hlColor]:'';
  noteEl.style.display = 'block';
  noteEl.style.borderLeft = hlC ? ('3px solid '+hlC) : '';
  const o = _ordOf(qu);
  // 「(A)至(E)」先展開成 (A)(B)(C)(D)(E)（只換兩端會變成看不懂的範圍）；
  // 連續的 (A)(B)(E) 換算後重新排序，讀起來仍是 (A)(B)(C) 的習慣順序
  const note = o && qu.note ? qu.note
    .replace(/[(（]([A-E])[)）]\s*[~～至到－—-]\s*[(（]([A-E])[)）]/g,
      (m, x, y) => 'ABCDE'.slice('ABCDE'.indexOf(x), 'ABCDE'.indexOf(y) + 1).replace(/./g, '($&)') || m)
    .replace(/(?:[(（][A-E][)）])+/g,
    m => _toDisp(m.replace(/[^A-E]/g, ''), qu).split('').sort().map(c => '(' + c + ')').join('')) : qu.note;
  noteEl.textContent = (o && qu.note ? '🔀 選項已重新排列，解析字母已換成本次順序（原題→本次：'
      + o.map((k, i) => k + '→' + 'ABCDE'[i]).sort().join('、') + '）\n' : '')
    + (note ? ('📝 '+note) : '🖍 已標記');
}

// 公布答案後（單選、複選、申論共用）：開放下一題、筆記、標註、編輯題目，並列出關聯法條
function _afterAnswer(qu){
  // 出處：例「113 升官等｜警察法規 第47題」
  document.getElementById('qmeta').textContent = [
    [qu.year, qu.exam].filter(Boolean).join(' '),
    (qu.subject||'') + (qu.num ? ' 第'+qu.num+'題' : '')
  ].map(s => s.trim()).filter(Boolean).join('｜');
  _saveResume();
  document.getElementById('qmulti-confirm')?.classList.add('hide');
  document.getElementById('qnxt').classList.remove('hide');
  // 作答後才開放（作答前不干擾判斷）
  ['qink-btn','qnote-btn','qedit-btn'].forEach(id => document.getElementById(id)?.classList.remove('hide'));
  document.getElementById('qtts-btn')?.classList.toggle('hide', qu.type !== 'es');   // 申論才有朗讀
  // 版面此時會多出解析區，稍候再同步筆跡（此刻才允許顯示）
  setTimeout(_inkSync, 60);
  _updateNoteBtn();
  showQLawLinks(qu);
}

// ── 作答後編輯題目：題目已不符現行規定時，當場修正 ─────────────
//   編輯視窗疊在答題畫面上；存檔後就地更新本題，不重新計分（對錯已在作答時記錄）
async function editQInQuiz(){  try{
  const qu = S.quiz?.q?.[S.quiz.idx];
  const fresh = qu?.id && await dg('questions', qu.id);
  if(!fresh){ toast('找不到這一題'); return; }
  showAdd(fresh);
  document.getElementById('add-ov').classList.add('over-quiz');
  }catch(e){ logError('editQInQuiz', e); }}

// saveQ 存檔後呼叫：正在作答的就是這一題 → 用新內容重畫，並維持「已公布答案」的狀態
function _quizRefreshQ(data){
  const qu = S.quiz?.q?.[S.quiz.idx];
  if(!qu || qu.id !== data.id || document.getElementById('qv')?.style.display !== 'flex') return;
  Object.assign(qu, data);
  _redrawAnswered(qu, '✎ 題目已更新　');
}

// 已作答的題目重畫（編輯存檔後、開始手寫標註時）：選項回到原題順序，標出正解
function _redrawAnswered(qu, prefix){
  if(S.quiz.ord) delete S.quiz.ord[qu.id];
  renderQCard();                       // 題幹、選項用新內容重畫（S.quiz.ans 仍為已作答，選項點了不會再計分）
  if(qu.type === 'mc'){
    _showMcKey(qu, prefix);
  } else if(S.quiz.mode !== 'esview'){   // 申論瀏覽由 renderQCard 直接顯示答案卷
    const resEl = document.getElementById('qres');
    resEl.className = 'qres on r';
    resEl.innerHTML = _esSheetHtml(qu);
    document.getElementById('qrevbtn').disabled = true;
  }
  _afterAnswer(qu);
}

// ════════ 申論題解析 ════════
function revealES(){
  const qu = S.quiz.q[S.quiz.idx];
  const resEl = document.getElementById('qres');
  resEl.className = 'qres on r';
  resEl.innerHTML = _esSheetHtml(qu);
  document.getElementById('qrevbtn').disabled = true;
  _afterAnswer(qu);

  const responseTime = Date.now() - _qStart;
  dp('attempts', {qid:qu.id, correct:null, date:today(), responseTime, hesitationFlag:responseTime>40000});
}

// 申論參考答案卷＋關鍵概念檢測的 HTML
function _esSheetHtml(qu){
  let html = _esPaperHtml(qu);
  // 申論題關鍵字檢測
  const must = qu.mustKeywords || [];
  if(must.length){
    const userAns = (document.getElementById('qes-input')?.value || '');
    const hits = must.filter(kw => userAns.includes(kw));
    html += '<div class="es-kw">'
         +  '<div class="es-kw-hd">關鍵概念檢測　<b>' + hits.length + ' / ' + must.length + '</b></div>'
         +  '<div class="es-kw-list">'
         +  must.map(kw=>{
              const hit = userAns.includes(kw);
              return '<span class="es-kw-tag' + (hit ? ' hit' : '') + '">'
                   + (hit ? '✓' : '✗') + ' ' + esc(kw) + '</span>';
            }).join('')
         +  '</div></div>';
  }
  return html;
}

// 參考答案卷本體（答題、申論瀏覽、匯出 HTML 共用）
function _esPaperHtml(qu){
  const ans = qu.answerEs || qu.answer || '';

  // 以「國考手寫答案卷」樣式呈現參考答案：米白紙張、格線、手寫體，
  // 並依申論標號自動分出層次，貼近考場上真正會寫出來的版面。
  //   一、→（一）→ 1、→（1）（最深到這層）
  // ★ 縮排與考卷相同：大標「一、」寫在格線左邊的題號欄；（一）頂著格線起寫；
  //   下一層的標號對齊上一層標號的「最後一個字」——
  //   1、 對齊（一）的「）」，（1）對齊 1、的「、」。
  //   作法是先墊一段「上層標號去掉最後一字」的隱形字元，字寬由瀏覽器算，
  //   不必寫死 em，換字體或全形半形混用都不會跑掉。
  const MK = [
    /^[一二三四五六七八九十百]+[、．.]\s*/,
    /^[（(][一二三四五六七八九十百]+[)）]\s*/,
    /^\d+[、．.](?!\d)\s*/,          // (?!\d)：避免把「2.5 公尺」的 2. 當成標號
    /^[（(]\d+[)）]\s*/,
  ];
  // 結語不是前一層的內文：該行開頭打兩個以上空白（半形或全形），
  // 就回到與「（一）」同一欄從頭寫起，其後各行也跟著回到這一欄。
  // ★ 不靠認字（綜上、結論…）：用空白鍵自己決定，不會誤判也不漏判。
  const TOP = /^[ \u3000\t]{2,}/;
  const stubs = [];   // 各層標號去掉最後一字，用來墊出下一層的縮排
  let txPad = '';     // 無標號的內文：對齊上一個標號的內文起點
  const esPad = p => p ? '<span class="es-pad">' + esc(p) + '</span>' : '';
  const esLine = (raw)=>{
    const t = raw.trim();
    for(let i = 0; i < MK.length; i++){
      const m = t.match(MK[i]);
      if(!m) continue;
      const mk = m[0].trim();
      stubs[i] = mk.slice(0, -1);
      stubs.length = i + 1;                                  // 回到本層，清掉更深層
      const pad = stubs.slice(1, i).map(x => x || '').join('');  // 第一層標號在題號欄，不佔縮排
      txPad = pad + mk;
      return '<div class="es-ln' + (i ? '' : ' l1') + '">' + esPad(pad)
           + '<span class="es-mk">' + esc(mk) + '</span>'
           + esc(t.slice(m[0].length)) + '</div>';
    }
    // 行首打兩個以上空白 → 結語，回到（一）那一欄從頭寫起
    if(TOP.test(raw)){ stubs.length = 1; txPad = ''; return '<div class="es-ln">' + esc(t) + '</div>'; }
    // 內文：墊到「上一個標號＋其後的字距」，起點與該層內文完全對齊
    return '<div class="es-ln">'
         + (txPad ? '<span class="es-pad es-mk">' + esc(txPad) + '</span>' : '')
         + esc(t) + '</div>';
  };
  const paras = String(ans).split(/\n+/).filter(t => t.trim());   // 保留行首空白（結語用）
  const sheet = paras.length
    ? paras.map(esLine).join('')
    : '<div class="es-ln" style="opacity:.55">（本題尚未填寫參考答案）</div>';
  return '<div class="es-paper">'
    + '<div class="es-paper-hd"><span>參 考 答 案</span><span class="es-paper-no">'
    +   esc((qu.subject||'') + (qu.num ? '　第' + qu.num + '題' : '')) + '</span></div>'
    + '<div class="es-paper-body">' + sheet + '</div>'
    + '</div>';
}

// 申論朗讀：先唸題目，再逐行唸參考答案；反白跟著答案卷每一行走
//   答案卷每一行對應參考答案的一行（_esPaperHtml 用同一套切行）
function ttsEssay(){
  const qu = S.quiz.q[S.quiz.idx];
  if(!qu) return;
  const lines = String(qu.answerEs || qu.answer || '').split(/\n+/).map(t => t.trim()).filter(Boolean);
  const lnEls = [...document.querySelectorAll('#qres .es-ln')];
  const stemEl = document.getElementById('qstem');
  ttsReadSegs(['題目。' + stemEl.innerText.trim(), '參考答案。', ...lines],
              '✍ ' + (qu.subject || '申論') + (qu.num ? ' 第' + qu.num + '題' : ''),
              [stemEl, lnEls[0] || null, ...lines.map((_, i) => lnEls[i] || null)]);
}

// ════════ 流程控制 ════════
// ════════════════════════════════════════════════════════════
// 【答題：導覽與收藏】
// ════════════════════════════════════════════════════════════
function nextQ(){
  _ttsStop();   // 換題：上一題的朗讀不再接著唸
  S.quiz.idx++;
  S.quiz.ans = false;
  renderQCard();
}

function exitQ(){
  // 模擬考中途離開 = 整場作廢，誤觸代價太大，先確認。
  // （一般練習隨時可離開、進度都已存檔，不需要攔）
  if(S.quiz.mode === 'mock' && S.quiz.res?.length && !_mockExitConfirmed){
    cfm('放棄模擬考',
        '已作答 ' + S.quiz.res.length + ' 題，離開後本場成績不會保留。確定放棄？',
        ()=>{ _mockExitConfirmed = true; exitQ(); _mockExitConfirmed = false; });
    return;
  }
  _stopMockTimer();   // 中途離開也要停止倒數
  _ttsStop();
  _inkTeardown();
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
  // 不可用 textContent：會清掉按鈕內的 SVG 圖示。
  // 收藏狀態改由 CSS 的 .qstar.on（填色 + 強調色）表示。
  toast(qu.starred ? '已收藏' : '已取消收藏');
  }catch(e){ logError('toggleQStar', e); }}

// ════════ 完成畫面 ════════
// ════════════════════════════════════════════════════════════
// 【答題：完成結算】
// ════════════════════════════════════════════════════════════
function showQDone(){
  _stopMockTimer();   // 交卷後停止倒數，避免計時器殘留繼續跑
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
  _inkTeardown();   // 結束畫面不該殘留上一題的手寫筆跡

  const doneArea = document.getElementById('qdone-area');
  if(doneArea){
    doneArea.style.display = 'flex';
    const browse = _lastMode === 'esview' || _lastMode === 'speed';   // 瀏覽類：沒有作答成績
    doneArea.innerHTML = (browse
      ? '<div style="font-size:48px">'+(_lastMode === 'speed' ? '⚡' : '📖')+'</div>'+
        '<div style="font-size:22px;font-weight:700">瀏覽完畢</div>'+
        '<div style="font-size:14px;color:var(--t2)">共 '+S.quiz.q.length+' 題'+(_lastMode === 'speed' ? '選擇' : '申論')+'</div>'
      : '<div style="font-size:48px">'+emoji+'</div>'+
      '<div style="font-size:22px;font-weight:700">'+correct+'/'+total+' 正確</div>'+
      '<div style="font-size:14px;color:var(--t2)">正確率 '+pct+'%</div>'+
      (hesitant ? '<div style="font-size:13px;color:var(--org)">⚠ '+hesitant+' 題猶豫超過40秒</div>' : '')+
      '<div style="font-size:13px;color:var(--t2)">平均作答 '+avgTime+' 秒</div>')+
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;width:100%">'+
      '<button class="btn bp bw" style="padding:14px;font-size:15px" data-action="replay">🔄 '+(browse ? '再看一次' : '再練習一次')+'</button>'+
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
  startQWithPool(shuffleUnits(pool).flat(), mode);   // 題組不拆開
}

// ════════ 模擬考模式 ════════

// ════════════════════════════════════════════════════════════
// 【速讀】選擇題直接看答案與解析，不作答、不寫作答紀錄
//   依科目、考試別、年度組合篩選（每組可複選，不選＝全部），上次的條件會記住。
//   選項旁的數字＝套用另外兩組條件後的題數；組合後沒有題目的反灰（已選的仍可取消）。
// ════════════════════════════════════════════════════════════
const _SPD_KEYS = { subject:'科目', exam:'考試別', year:'年度' };
let _spdQs = [], _spdSel = {};
const _spdVal = (q, k) => String(q[k] || '').trim() || '未分類';
const _spdHit = (q, skip) => Object.keys(_SPD_KEYS).every(k => k === skip || !_spdSel[k].size || _spdSel[k].has(_spdVal(q, k)));

async function openSpeed(){  try{
  if(await _resumeIfAny('speed')) return;
  _spdQs = (await da('questions')).filter(q => q.type === 'mc');
  if(!_spdQs.length){ toast('目前沒有選擇題'); return; }
  const saved = await getSetting('speed_filter', {});
  for(const k in _SPD_KEYS){
    const have = new Set(_spdQs.map(q => _spdVal(q, k)));
    _spdSel[k] = new Set((saved?.[k] || []).filter(v => have.has(v)));   // 已不存在的條件略過
  }
  _spdRender();
  document.getElementById('spd-ov').classList.add('on');
  }catch(e){ logError('openSpeed', e); }}

function _spdRender(){
  const yr = v => parseInt(v) || 0;
  document.getElementById('spd-groups').innerHTML = Object.entries(_SPD_KEYS).map(([k, label]) => {
    const vals = [...new Set(_spdQs.map(q => _spdVal(q, k)))]
      .sort(k === 'year' ? (a, b) => yr(b) - yr(a) : (a, b) => a.localeCompare(b, 'zh-Hant'));
    const pool = _spdQs.filter(q => _spdHit(q, k));
    return '<div class="spd-lbl">' + label + '</div><div class="spd-chips">' + vals.map(v => {
      const n = pool.filter(q => _spdVal(q, k) === v).length, on = _spdSel[k].has(v);
      return '<button class="chip' + (on ? ' on' : n ? '' : ' chip-off') + '" data-k="' + k + '" data-v="' + esc(v)
           + '" onclick="spdToggle(this)">' + esc(v) + ' <span class="subj-cnt">' + n + '</span></button>';
    }).join('') + '</div>';
  }).join('');
  document.getElementById('spd-n').textContent = '符合 ' + _spdQs.filter(q => _spdHit(q)).length + ' 題';
}

function spdToggle(btn){
  const s = _spdSel[btn.dataset.k], v = btn.dataset.v;
  s.has(v) ? s.delete(v) : s.add(v);
  _spdRender();
}
function spdClear(){ for(const k in _SPD_KEYS) _spdSel[k].clear(); _spdRender(); }
function closeSpeed(){ document.getElementById('spd-ov')?.classList.remove('on'); }

function startSpeed(){
  const pool = _spdQs.filter(q => _spdHit(q));
  if(!pool.length){ toast('沒有符合的題目'); return; }
  setSetting('speed_filter', Object.fromEntries(Object.keys(_SPD_KEYS).map(k => [k, [..._spdSel[k]]])));
  closeSpeed();
  // 新年度在前；同一份考卷依題號（題組自然連在一起）
  const yn = q => parseInt(q.year) || 0, nn = q => parseInt(q.num) || 0;
  pool.sort((a, b) => yn(b) - yn(a) || _spdVal(a, 'exam').localeCompare(_spdVal(b, 'exam'))
    || _spdVal(a, 'subject').localeCompare(_spdVal(b, 'subject')) || nn(a) - nn(b) || (a.groupOrder || 0) - (b.groupOrder || 0));
  startQWithPool(pool, 'speed');
}

// ════════════════════════════════════════════════════════════
// 【科目多選 → 開始測驗】
//   startQPick(mode)：先讓使用者挑科目（記住上次選擇），再開始
// ════════════════════════════════════════════════════════════
let _pickMode = 'review';
let _pickSel  = new Set();

async function startQPick(mode){  try{
  _pickMode = mode || 'review';
  if(await _resumeIfAny(_pickMode)) return;
  const isEssay = _pickMode === 'essay' || _pickMode === 'esview';
  const list = await getSubjectList(isEssay ? 'es' : 'mc');
  if(!list.length){
    toast(isEssay ? '目前沒有申論題' : '目前沒有選擇題');
    return;
  }
  // 沿用上次選擇（僅保留仍存在的科目）
  const saved = await getSetting('quiz_subjects_' + _pickMode, []);
  const names = new Set(list.map(x => x.name));
  _pickSel = new Set((Array.isArray(saved) ? saved : []).filter(n => names.has(n)));

  const sub = document.getElementById('subj-sub');
  if(sub) sub.textContent = _pickMode === 'esview' ? '申論瀏覽・可複選，不選則看全部'
                          : isEssay ? '申論練習・可複選，不選則測全部'
                                    : '選擇題・可複選，不選則測全部';
  const box = document.getElementById('subj-list');
  if(box){
    box.innerHTML = list.map(x => {
      const on = _pickSel.has(x.name) ? ' on' : '';
      return `<button class="subj-item${on}" data-n="${esc(x.name)}" onclick="toggleSubj(this)">
                <span class="subj-name">${esc(x.name)}</span>
                <span class="subj-cnt">${x.n}</span>
              </button>`;
    }).join('');
  }
  document.getElementById('subj-ov')?.classList.add('on');
  }catch(e){ logError('startQPick', e); }}

function toggleSubj(btn){
  const n = btn.dataset.n;
  if(_pickSel.has(n)){ _pickSel.delete(n); btn.classList.remove('on'); }
  else { _pickSel.add(n); btn.classList.add('on'); }
}

function subjSelAll(on){
  document.querySelectorAll('#subj-list .subj-item').forEach(btn=>{
    const n = btn.dataset.n;
    if(on){ _pickSel.add(n); btn.classList.add('on'); }
    else  { _pickSel.delete(n); btn.classList.remove('on'); }
  });
}

function closeSubjPick(){ document.getElementById('subj-ov')?.classList.remove('on'); }

async function confirmSubjPick(){  try{
  const subjects = [...(_pickSel || [])];
  setSetting('quiz_subjects_' + _pickMode, subjects).catch(()=>{});
  closeSubjPick();
  const pool = await getPriorityPool(_pickMode === 'esview' ? 'essay' : _pickMode, subjects);
  if(!pool.length){
    toast(_pickMode === 'review' ? '今日沒有到期的題目'
        : _pickMode === 'focus'  ? '沒有危險題或收藏題'
        : _pickMode.startsWith('es') ? '沒有符合的申論題' : '沒有題目');
    return;
  }
  startQWithPool(pool, _pickMode);
  }catch(e){ logError('confirmSubjPick', e); }}

// ════════════════════════════════════════════════════════════
// 【題目標註】直接畫在題目上（如紙本圈畫），存入 inkImg
// 【文字備註】與題庫「備註／詳解」共用同一個 note 欄位，雙向同步
// ════════════════════════════════════════════════════════════
let _inkOn      = false;   // 標註模式開關
let _inkStrokes = [];      // 復原快照
let _inkBound   = false;   // 事件是否已綁定
let _inkDirty   = false;   // 有未儲存的筆跡
let _inkPrevQ   = null;    // 上一題（換題時要把筆跡存回它）
// 畫筆設定（顏色／粗細／筆型），在同一次作答期間沿用
let _inkColor   = '#ff5a5a';
let _inkWidth   = 2.6;
let _inkMode    = 'pen';   // pen=手繪 / line=直線 / marker=螢光筆

// 依題目容器大小設定畫布，並載入該題既有標註
// 畫布使用固定內部解析度，與版面高度脫鉤。
// 若跟著 scrollHeight 走，公布解答後版面變高會使畫布重設尺寸，
// 舊筆跡被拉伸重繪 → 位移。固定解析度 + CSS 等比對應即可完全避免。
const INK_W = 800, INK_H = 1200;

function _inkSync(){
  const cv = document.getElementById('qink');
  if(!cv) return;
  cv.style.display = '';   // 由結束畫面返回題目時要恢復顯示
  if(cv.width !== INK_W || cv.height !== INK_H){ cv.width = INK_W; cv.height = INK_H; }
  const c = cv.getContext('2d');
  c.clearRect(0, 0, INK_W, INK_H);                 // 透明底：看得到底下題目
  const qu = S.quiz.q[S.quiz.idx];
  // ★ 只在「已作答（已公布解答）」時才顯示筆跡：
  //   否則重測時上次圈的答案會先曝光，等於直接看到提示。
  if(qu?.inkImg && S.quiz.ans){
    const img = new Image();
    img.onload = ()=> c.drawImage(img, 0, 0, INK_W, INK_H);
    img.src = qu.inkImg;
  }
  _inkStrokes = [];
  _inkDirty = false;
}

function _inkBind(){
  if(_inkBound) return;
  const cv = document.getElementById('qink');
  if(!cv) return;
  _inkBound = true;
  const ctx = cv.getContext('2d');
  let drawing = false;
  let startPt = null;      // 直線模式的起點
  let baseSnap = null;     // 直線模式：拖曳過程中反覆還原用的底圖
  const pos = e => {
    const r = cv.getBoundingClientRect();
    return { x:(e.clientX - r.left) * (cv.width / r.width),
             y:(e.clientY - r.top)  * (cv.height / r.height) };
  };
  // 依目前筆型套用畫筆樣式
  const applyStyle = ()=>{
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = _inkColor;
    if(_inkMode === 'marker'){
      // 螢光筆：半透明、加粗、方頭，疊在文字上仍看得見字
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = _inkWidth * 4;
      ctx.lineCap = 'butt';
    }else{
      ctx.globalAlpha = 1;
      ctx.lineWidth = _inkWidth;
    }
  };

  cv.addEventListener('pointerdown', e => {
    if(!_inkOn) return;
    // 標註模式下一律直接繪製（手指／筆／滑鼠皆同）。
    //   曾經為了「標註時仍能捲動」改成手指需長按才畫，但手指按在螢幕上必然
    //   有微小抖動，pointermove 一觸發就取消長按，結果永遠畫不出來。
    //   捲動改由「關閉標註模式」達成。
    e.preventDefault(); drawing = true;
    try{ cv.setPointerCapture(e.pointerId); }catch(err){}
    // 下筆前先存快照供復原（ImageData 免 PNG 編碼，不會頓）
    try{ _inkStrokes.push(ctx.getImageData(0, 0, cv.width, cv.height)); }catch(err){}
    if(_inkStrokes.length > 8) _inkStrokes.shift();
    applyStyle();
    const p = pos(e);
    startPt = p;
    if(_inkMode === 'line'){
      // 直線：記住拖曳前的畫面，之後每次移動都還原再重畫，才會是「一條線跟著手指」
      try{ baseSnap = ctx.getImageData(0, 0, cv.width, cv.height); }catch(err){ baseSnap = null; }
    }else{
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
    }
  });

  cv.addEventListener('pointermove', e => {
    if(!_inkOn || !drawing) return;
    e.preventDefault();
    const p = pos(e);
    if(_inkMode === 'line'){
      if(baseSnap){ try{ ctx.putImageData(baseSnap, 0, 0); }catch(err){} }
      applyStyle();
      ctx.beginPath(); ctx.moveTo(startPt.x, startPt.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }else{
      ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    _inkDirty = true;
  });

  const end = ()=>{
    if(drawing && _inkMode === 'line') _inkDirty = true;  // 只點一下沒移動也算有畫
    drawing = false; startPt = null; baseSnap = null;
    ctx.globalAlpha = 1;   // 還原，避免影響後續繪製與存檔
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointerleave', end);
}

// ── 畫筆設定（顏色／粗細／筆型）────────────────────────────
function inkColor(btn){
  _inkColor = btn.dataset.c || '#ff5a5a';
  document.querySelectorAll('#qink-colors .qink-c').forEach(b=>b.classList.toggle('on', b===btn));
  document.getElementById('qink-c-custom')?.classList.remove('on');
}
// 自訂顏色（原生色票，可挑任意色）
function inkCustomColor(inp){
  _inkColor = inp.value || '#ff5a5a';
  document.querySelectorAll('#qink-colors .qink-c').forEach(b=>b.classList.remove('on'));
  inp.classList.add('on');
}
function inkSize(btn){
  _inkWidth = parseFloat(btn.dataset.w) || 2.6;
  document.querySelectorAll('#qink-sizes .qink-s').forEach(b=>b.classList.toggle('on', b===btn));
}
function inkMode(m){
  _inkMode = m;
  ['pen','line','marker'].forEach(k=>{
    document.getElementById('qink-m-'+k)?.classList.toggle('on', k===m);
  });
}

// 切換標註模式：開啟時畫布接收觸控，關閉時自動存檔
async function toggleInk(){  try{
  const cv = document.getElementById('qink');
  if(!cv) return;
  // 選項打亂中：先回到原題順序再開始標註（標註一律以原題版面為準，下次顯示才對得上）
  const qu = S.quiz.q[S.quiz.idx], back = !_inkOn && qu && _ordOf(qu);
  if(back) _redrawAnswered(qu, '');
  _inkOn = !_inkOn;
  if(_inkOn){
    _inkSync(); _inkBind();
    cv.classList.add('on');
    document.getElementById('qink-btn')?.classList.add('on');
    toast(back ? '選項已回到原題順序，可直接圈畫' : '標註模式：直接在題目上圈畫');
  }else{
    cv.classList.remove('on');
    document.getElementById('qink-btn')?.classList.remove('on');
    await _inkSave();
  }
  }catch(e){ logError('toggleInk', e); }}

// 判斷畫布是否全透明（沒有任何筆跡）
function _inkIsBlank(cv){
  try{
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for(let i = 3; i < d.length; i += 4) if(d[i] !== 0) return false;
    return true;
  }catch(e){ return false; }
}

async function _inkSave(){  try{
  if(!_inkDirty) return;
  const cv = document.getElementById('qink');
  const qu = S.quiz.q[S.quiz.idx];
  if(!cv || !qu) return;
  if(_inkIsBlank(cv)) delete qu.inkImg;              // 擦掉全部就移除，不留空圖
  else qu.inkImg = cv.toDataURL('image/png');        // 透明背景需用 PNG
  await dp('questions', qu);
  _inkDirty = false;
  _updateNoteBtn();
  }catch(e){ logError('_inkSave', e); }}

// 收起標註：清空畫布、退出標註模式、隱藏畫布
// （結束測驗與離開測驗都要呼叫，否則筆跡會殘留在統計畫面上）
function _inkTeardown(){
  const cv = document.getElementById('qink');
  if(cv){
    // ★ 先存再清：使用者可能畫完沒按「完成」就直接按結束／離開，
    //   若不先存，這些筆跡會永遠遺失。
    if(_inkDirty){
      const qu = S.quiz.q[S.quiz.idx] || _inkPrevQ;
      if(qu){
        try{
          if(_inkIsBlank(cv)) delete qu.inkImg;
          else qu.inkImg = cv.toDataURL('image/png');
          dp('questions', qu).catch(()=>{});
        }catch(e){}
      }
    }
    try{ cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); }catch(e){}
    cv.classList.remove('on');
    cv.style.display = 'none';
  }
  _inkOn = false;
  _inkStrokes = [];
  _inkDirty = false;
  document.getElementById('qink-btn')?.classList.remove('on');
}

function inkUndo(){
  const cv = document.getElementById('qink');
  if(!cv || !_inkStrokes.length){ toast('沒有可復原的筆畫'); return; }
  try{ cv.getContext('2d').putImageData(_inkStrokes.pop(), 0, 0); _inkDirty = true; }catch(e){}
}

function inkClear(){
  const cv = document.getElementById('qink');
  if(!cv) return;
  const c = cv.getContext('2d');
  try{ _inkStrokes.push(c.getImageData(0, 0, cv.width, cv.height)); }catch(e){}
  c.clearRect(0, 0, cv.width, cv.height);
  _inkDirty = true;
}

// ── 文字備註：與題庫的 note 欄位共用 ──────────────────────────
let _noteQ = null;

async function openQNote(){  try{
  const qu = S.quiz.q[S.quiz.idx];
  if(!qu) return;
  _noteQ = qu;
  // 從資料庫取最新值，確保與題庫編輯的內容同步
  let latest = qu;
  try{ latest = (await dg('questions', qu.id)) || qu; }catch(e){}
  const ta = document.getElementById('qnote-text');
  if(ta) ta.value = latest.note || '';
  document.getElementById('qnote-ov')?.classList.add('on');
  }catch(e){ logError('openQNote', e); }}

function closeQNote(){ document.getElementById('qnote-ov')?.classList.remove('on'); }

async function saveQNote(){  try{
  if(!_noteQ){ closeQNote(); return; }
  const ta = document.getElementById('qnote-text');
  // 取資料庫最新版再寫回，避免覆蓋題庫端剛改過的其他欄位
  let target = _noteQ;
  try{ target = (await dg('questions', _noteQ.id)) || _noteQ; }catch(e){}
  target.note = (ta?.value || '').trim();
  // searchBlob 公式與 data.js 的 saveQ 完全一致（不含 note）
  target.searchBlob = [
    target.stem || '', target.groupStem || '', target.subject || '',
    target.year || '', target.exam || '', String(target.num || ''),
    (target.keywords || []).join(' ')
  ].join(' ').toLowerCase();
  await dp('questions', target);
  // 同步回目前這份，畫面才會即時反映
  _noteQ.note = target.note;
  closeQNote();
  toast('備註已儲存');
  _updateNoteBtn();
  }catch(e){ logError('saveQNote', e); toast('儲存失敗'); }}

// 更新按鈕標示（有備註或標註時highlight）
function _updateNoteBtn(){
  const qu = S.quiz.q[S.quiz.idx];
  const nb = document.getElementById('qnote-btn');
  const ib = document.getElementById('qink-btn');
  if(nb) nb.classList.toggle('has-note', !!(qu && qu.note && qu.note.trim()));
  if(ib) ib.classList.toggle('has-note', !!(qu && qu.inkImg));
}

// 隨時結束測驗（不需答完整份）→ 直接看統計
function endQuizNow(){  try{
  if(!S.quiz || !S.quiz.q?.length) { exitQ(); return; }
  // 統計以 S.quiz.res（實際作答紀錄）為準，不需截斷題目陣列；
  // 保持 S.quiz.q 完整，結束畫面的「再測一次」才能沿用同一份題目。
  if(!S.quiz.res.length){ exitQ(); return; }   // 一題都沒作答 → 直接離開，不顯示空統計
  showQDone();
  }catch(e){ logError('endQuizNow', e); exitQ(); }}

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
  // 有手寫標註要回到原順序：選取的字母先換回原題字母再重畫
  if(_ordOf(qu) && qu.inkImg && S.quiz.mode !== 'mock'){
    S.quiz._selected = new Set(_toOrig([...(S.quiz._selected||[])].join(''), qu));
    _inkRestoreOrder(qu);
  }
  const selected = [...(S.quiz._selected||new Set())].sort().join('');
  const ansStr = _toDisp((qu.answer||'').replace(/[, ]/g,''), qu).split('').sort().join('');
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
  S.quiz.res.push({qid:qu.id, correct, responseTime, hesitant});
  // 模擬考：與單選相同，不揭曉對錯（原本複選題會直接公布答案）
  if(S.quiz.mode === 'mock'){
    document.getElementById('qmulti-confirm')?.classList.add('hide');
    document.getElementById('qnxt')?.classList.remove('hide');
    return;
  }
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
  let msg = correct ? '✓ 完全正確！' : '✗ 正確答案：'+_ansText(qu, '、');
  if(!correct && selected) msg += '（你選：'+selected.split('').join('、')+'）';
  if(hesitant) msg += ' ⚠ 超過40秒';
  resEl.textContent = msg;
  _showQNote(qu);
  _afterAnswer(qu);
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
// ════════ 公開 API ════════
// 新程式碼請使用 Quiz.xxx；window 別名僅供 index.html 既有 onclick 相容
// ★ 必須排在任何「立即執行」的初始化之前：
//   原順序是先跑 _initDelegation() 再匯出，只要初始化在某環境拋出例外，
//   IIFE 就中斷，整個模組的函式全掛不上 window，畫面上所有 onclick 都會變成
//   "xxx is not defined"（例如 inkMode is not defined）。
const Quiz = { startQ, startQWithPool, startQPick,
               toggleSubj, subjSelAll, closeSubjPick, confirmSubjPick,
               toggleInk, inkUndo, inkClear, inkColor, inkCustomColor, inkSize, inkMode,
               startMockExam, beginMockExam,
               openQNote, closeQNote, saveQNote, endQuizNow,
               submitAnswer, nextQ, exitQ, revealES, toggleQStar, editQInQuiz, _quizRefreshQ, _esPaperHtml, ttsEssay,
               openSpeed, spdToggle, spdClear, closeSpeed, startSpeed, setOptShuffle };
window.Quiz = Quiz;
Object.assign(window, Quiz);

// 事件委派初始化（包 try/catch：失敗也不影響上面已匯出的 API）
const _safeInitDelegation = ()=>{ try{ _initDelegation(); }catch(e){ logError('_initDelegation', e); } };
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _safeInitDelegation);
} else {
  _safeInitDelegation();
}

})();
