/* ═══════════════════════════════════════════════════════════════
   QUESTION LIBRARY  (qlib.js)
   題目庫 — 完全重寫，單一職責，無 ID 衝突
   依賴：app.js 的 da/dg/dp/dd/bulkPut/esc/Toast/S/Router
═══════════════════════════════════════════════════════════════ */

/* ── 狀態（全部集中在此模組） ─────────────────────────────────── */
const QL = {
  all:        [],   // 全部題目快取
  attempts:   [],   // 作答記錄快取
  filter:     'all',
  subFilter:  'all',
  kw:         '',
  parsed:     [],   // 大量解析暫存
  rawText:    '',   // textarea 原始文字快取（防 Android 讀不到）
  page:       0,
  PAGE_SIZE:  50,
};

/* ── 公用：讀取並快取 ──────────────────────────────────────────── */
async function qlLoad(){
  [QL.all, QL.attempts] = await Promise.all([da('questions'), da('attempts')]);
}

/* ══════════════════════════════════════════════════════════════
   題目庫清單  renderQLib
══════════════════════════════════════════════════════════════ */
async function renderQLib(){
  try{
    await qlLoad();
    _qlRenderSubChips();
    _qlRenderList(true);
  }catch(e){ logError('renderQLib',e); }
}
// 別名，保持舊呼叫相容
function renderList(){ return renderQLib(); }

function _qlFilter(){
  const ws = getWrong(QL.all, QL.attempts);
  return QL.all.filter(q=>{
    if(QL.filter==='mc'    && q.type!=='mc')       return false;
    if(QL.filter==='es'    && q.type!=='es')        return false;
    if(QL.filter==='wrong' && !ws.has(q.id))        return false;
    if(QL.filter==='star'  && !q.starred)           return false;
    if(QL.subFilter!=='all' && q.subject!==QL.subFilter) return false;
    if(QL.kw){
      const h=((q.searchBlob)||((q.stem||'')+(q.subject||'')+(q.keywords||[]).join(' '))).toLowerCase();
      if(!h.includes(QL.kw)) return false;
    }
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}

function _qlRenderSubChips(){
  const subs=[...new Set(QL.all.map(q=>q.subject).filter(Boolean))].sort();
  const el=$el('schips'); if(!el) return;
  el.innerHTML='';
  ['all',...subs].forEach(s=>{
    const b=document.createElement('button');
    b.className='chip'+((s==='all'&&QL.subFilter==='all')||(s===QL.subFilter)?' on':'');
    b.textContent = s==='all'?'全部科目':s;
    b.onclick = ()=>{ QL.subFilter=s; _qlRenderList(true); };
    el.appendChild(b);
  });
}

function _qlMkCard(q){
  const danger = getDangerLevel(q, QL.attempts);
  const div = document.createElement('div');
  div.className='card fu';
  div.style.cssText='margin:5px 16px;cursor:pointer';
  div.innerHTML=
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">'+
      '<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'+
      (q.year?'<span class="tag">'+esc(q.year)+'</span>':'')+
      (q.exam?'<span class="tag">'+esc(q.exam)+'</span>':'')+
      '<span class="tag">'+esc(q.subject||'未分類')+'</span>'+
      '<span style="font-size:12px;margin-left:auto">'+danger+'</span>'+
      '<span style="font-size:14px;margin-left:4px;color:var(--org)">'+(q.starred?'★':'')+'</span>'+
    '</div>'+
    '<div style="font-size:13px;color:var(--t1);line-height:1.6;margin-bottom:8px;word-break:break-word">'+
      esc((q.stem||'').slice(0,120))+(q.stem&&q.stem.length>120?'…':'')+
    '</div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
      '<button class="chip" style="font-size:11px" onclick="event.stopPropagation();editQ('+q.id+')">✏ 編輯</button>'+
      '<button class="chip" style="font-size:11px" onclick="event.stopPropagation();startSingleQ('+q.id+')">▶ 練習</button>'+
      '<button class="chip" style="font-size:11px;'+(q.starred?'color:var(--org)':'')+'" onclick="event.stopPropagation();qlToggleStar('+q.id+')">'+
        (q.starred?'★ 取消':'☆ 收藏')+
      '</button>'+
      '<button class="chip" style="font-size:11px;color:var(--red);margin-left:auto" onclick="event.stopPropagation();qlDelQ('+q.id+')">🗑</button>'+
    '</div>';
  return div;
}

function _qlRenderList(reset){
  const fl = _qlFilter();
  const lcEl = $el('lc');
  if(lcEl) lcEl.textContent = '共 '+fl.length+' 題';

  const el = $el('qlist'); if(!el) return;
  if(reset){ el.innerHTML=''; QL.page=0; }

  // 移除舊 scroll listener
  const pgEl = $el('page-q-library');
  if(window._qlScrollH && pgEl) pgEl.removeEventListener('scroll', window._qlScrollH);

  const loadMore = ()=>{
    const batch = fl.slice(QL.page*QL.PAGE_SIZE, (QL.page+1)*QL.PAGE_SIZE);
    if(!batch.length) return;
    const frag = document.createDocumentFragment();
    batch.forEach(q=> frag.appendChild(_qlMkCard(q)));
    el.appendChild(frag);
    QL.page++;
    if(lcEl){
      const shown = Math.min(QL.page*QL.PAGE_SIZE, fl.length);
      lcEl.textContent = shown<fl.length
        ? '共 '+fl.length+' 題（已顯示 '+shown+'，繼續滑動）'
        : '共 '+fl.length+' 題';
    }
  };
  loadMore();

  if(pgEl){
    const h = ()=>{ if(pgEl.scrollHeight-pgEl.scrollTop-pgEl.clientHeight<200) loadMore(); };
    window._qlScrollH = h;
    pgEl.addEventListener('scroll', h, {passive:true});
  }
}

/* ── 搜尋 ──────────────────────────────────────────────────── */
function qlSearch(val){
  QL.kw = (val||'').toLowerCase().trim();
  _qlRenderList(true);
}
const _debouncedRenderList = debounce(()=>qlSearch($el('si')?.value||''), 200);

/* ── 篩選 chip ──────────────────────────────────────────────── */
function setF(f, btn){
  QL.filter=f;
  document.querySelectorAll('[onclick*="setF"]').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  _qlRenderList(true);
}

/* ── 收藏 / 刪除 ────────────────────────────────────────────── */
async function qlToggleStar(id){
  try{
    const q = await dg('questions',id); if(!q) return;
    q.starred=!q.starred;
    await dp('questions',q);
    // 更新快取避免重新全量讀
    const idx = QL.all.findIndex(x=>x.id===id);
    if(idx>=0) QL.all[idx].starred=q.starred;
    toast(q.starred?'已收藏 ⭐':'取消收藏');
    _qlRenderList(true);
  }catch(e){ logError('qlToggleStar',e); }
}
// 保持舊別名
function toggleStar(id){ return qlToggleStar(id); }

async function qlDelQ(id){
  try{
    if(!confirm('確定刪除此題目？')) return;
    await dd('questions',id);
    QL.all = QL.all.filter(q=>q.id!==id);
    toast('已刪除');
    _qlRenderList(true);
    renderHome();
  }catch(e){ logError('qlDelQ',e); }
}
function delQ(id){ return qlDelQ(id); }

/* ══════════════════════════════════════════════════════════════
   大量匯入 Overlay  (bulk-q-ov)
   HTML IDs 只在此模組使用：bi-text bi-ans bi-sub bi-yr bi-ex
   bulk-q-result  bulk-q-stats  bulk-q-prev-list  bq-char-count
══════════════════════════════════════════════════════════════ */

/* 讀取 textarea 值（三重保險，防 Android 讀不到） */
function _bqGetText(){
  // 1. 快取（由 oninput/onpaste 即時更新）
  if(QL.rawText && QL.rawText.trim()) return QL.rawText;
  // 2. DOM value
  const el=$el('bi-text');
  if(el && el.value && el.value.trim()){ QL.rawText=el.value; return QL.rawText; }
  // 3. innerText fallback（contenteditable 情境）
  if(el && el.innerText && el.innerText.trim()){ QL.rawText=el.innerText; return QL.rawText; }
  return '';
}

/* oninput / onchange / onpaste 統一回呼 */
function bqTextSync(val){
  QL.rawText = val||'';
  const cc=$el('bq-char-count');
  if(cc) cc.textContent = QL.rawText.trim() ? ('✓ 已讀取 '+QL.rawText.length+' 字') : '';
}

/* 開啟 overlay */
function openBulkImportQ(){
  // 不清空 textarea，保留上次內容
  QL.parsed=[];
  const r=$el('bulk-q-result'); if(r) r.classList.add('hide');
  // 重新同步快取
  const t=$el('bi-text');
  if(t){ QL.rawText=t.value; bqTextSync(t.value); }
  $el('bulk-q-ov').style.display='flex';
  // Android focus
  if(t) setTimeout(()=>t.focus(),150);
}
function closeBulkImportQ(){ $el('bulk-q-ov').style.display='none'; }

/* 解析 */
function parseBulkQ(){
  try{
    const text = _bqGetText();
    if(!text){ Toast.warn('請先貼入題目文字'); return; }

    const parsed = parseBulkText(text);
    QL.parsed = parsed;

    // 套答案串
    const ansStr = ($el('bi-ans')||{}).value||'';
    const ansMap = parseAnswerStr(ansStr);
    parsed.forEach((q,i)=>{
      const n=parseInt(q.num)||i+1;
      if(ansMap[n]) q.answer=ansMap[n];
    });

    // 套科目/年度/考試
    const sub=($el('bi-sub')||{}).value||'';
    const yr =($el('bi-yr') ||{}).value||'';
    const ex =($el('bi-ex') ||{}).value||'';
    parsed.forEach(q=>{
      if(sub) q.subject=sub;
      if(yr)  q.year=yr;
      if(ex)  q.exam=ex;
    });

    // 顯示統計
    const mc=parsed.filter(q=>q.type==='mc').length;
    const es=parsed.filter(q=>q.type==='es').length;
    const statsEl=$el('bulk-q-stats');
    if(statsEl) statsEl.innerHTML=
      '<span class="tag">共 '+parsed.length+' 題</span>'+
      '<span class="tag" style="color:var(--sky)">選擇 '+mc+'</span>'+
      '<span class="tag" style="color:var(--grn)">申論 '+es+'</span>';

    // 顯示預覽
    const prevEl=$el('bulk-q-prev-list');
    if(prevEl) prevEl.innerHTML = parsed.map(q=>
      '<div class="pi '+(q.answer||q.type==='es'?'ok':'warn')+'">'+
        '<div class="pi-n">第'+q.num+'題 · '+(q.type==='mc'?'選擇題':'申論題')+
          (q.answer?' · <b style="color:var(--grn)">'+esc(q.answer)+'</b>':
           q.type==='mc'?'<span style="color:var(--red)"> ⚠ 無答案</span>':'')+
        '</div>'+
        '<div class="pi-s">'+esc((q.stem||'').slice(0,80))+'</div>'+
      '</div>'
    ).join('');

    const resEl=$el('bulk-q-result'); if(resEl) resEl.classList.remove('hide');

    if(!parsed.length)
      Toast.warn('解析 0 題 — 請確認格式（題號格式：1. 或 1、或（1））');
    else
      Toast.success('解析完成：'+parsed.length+' 題 ✓');

  }catch(err){ Toast.error('解析錯誤：'+err.message); console.error('[parseBulkQ]',err); }
}

/* 匯入 */
async function importBulkQ(){
  if(!QL.parsed.length){ Toast.warn('請先解析題目'); return; }
  try{
    await bulkPut('questions', QL.parsed);
    Toast.success('已匯入 '+QL.parsed.length+' 題 ✓');
    // 清理
    QL.parsed=[]; QL.rawText='';
    const t=$el('bi-text'); if(t) t.value='';
    const a=$el('bi-ans');  if(a) a.value='';
    const cc=$el('bq-char-count'); if(cc) cc.textContent='';
    const r=$el('bulk-q-result'); if(r) r.classList.add('hide');
    closeBulkImportQ();
    await renderQLib();
    renderHome();
  }catch(err){ Toast.error('匯入失敗：'+err.message); }
}

/* 清除 */
function clearBulkQ(){
  const t=$el('bi-text'); if(t) t.value='';
  const a=$el('bi-ans');  if(a) a.value='';
  QL.rawText=''; QL.parsed=[];
  const r=$el('bulk-q-result'); if(r) r.classList.add('hide');
  const cc=$el('bq-char-count'); if(cc) cc.textContent='';
}

/* ══════════════════════════════════════════════════════════════
   ei-bulk tab（舊式大量匯入 tab，ID 前綴 eb-）
══════════════════════════════════════════════════════════════ */
function parseBulk(){
  try{
    const t=$el('eb-text'); if(!t){ Toast.warn('找不到輸入框'); return; }
    const text=t.value||''; if(!text.trim()){ Toast.warn('請先貼入題目文字'); return; }
    const parsed=parseBulkText(text); S.bulkParsed=parsed;
    const ansMap=parseAnswerStr(($el('eb-ans')||{}).value||'');
    const part=($el('bi-part')||{}).value||'';
    const chapter=($el('bi-chapter')||{}).value||'';
    const section=($el('bi-section')||{}).value||'';
    parsed.forEach((q,i)=>{
      const n=parseInt(q.num)||i+1;
      if(ansMap[n]) q.answer=ansMap[n];
      if(part)    q.part=part.trim();
      if(chapter) q.chapter=chapter.trim();
      if(section) q.section=section.trim();
    });
    const mc=parsed.filter(q=>q.type==='mc').length;
    const es=parsed.filter(q=>q.type==='es').length;
    const st=$el('bulk-stats'); if(st) st.innerHTML='<span class="tag">'+parsed.length+' 題</span><span class="tag">選擇 '+mc+'</span><span class="tag">申論 '+es+'</span>';
    const pv=$el('prev-list');  if(pv) pv.innerHTML=parsed.map(q=>'<div class="pi '+(q.answer||q.type==='es'?'ok':'warn')+'"><div class="pi-n">第'+q.num+'題 · '+(q.type==='mc'?'選擇':'申論')+(q.answer?' · '+esc(q.answer):'')+'</div><div class="pi-s">'+esc((q.stem||'').slice(0,60))+'</div></div>').join('');
    const r=$el('bulk-result'); if(r) r.classList.remove('hide');
    if(!parsed.length) Toast.warn('解析0題，確認格式'); else Toast.success('解析完成：'+parsed.length+' 題 ✓');
  }catch(err){ Toast.error('解析錯誤：'+err.message); }
}
async function importBulk(){
  if(!S.bulkParsed.length){ Toast.warn('請先解析'); return; }
  const sub=($el('eb-sub')||{}).value||'';
  const yr =($el('eb-yr') ||{}).value||'';
  const ex =($el('eb-ex') ||{}).value||'';
  const items=S.bulkParsed.map(q=>({...q,subject:sub||q.subject||'',year:yr||q.year||'',exam:ex||q.exam||''}));
  try{
    await bulkPut('questions',items);
    Toast.success('已匯入 '+items.length+' 題 ✓');
    S.bulkParsed=[];
    const r=$el('bulk-result'); if(r) r.classList.add('hide');
    renderHome();
  }catch(err){ Toast.error('匯入失敗：'+err.message); }
}
function clearBulk(){
  ['eb-text','eb-ans'].forEach(id=>{const el=$el(id);if(el)el.value='';});
  ['bi-part','bi-chapter','bi-section'].forEach(id=>{const el=$el(id);if(el)el.value='';});
  S.bulkParsed=[];
  const r=$el('bulk-result'); if(r) r.classList.add('hide');
}

/* ══════════════════════════════════════════════════════════════
   大量刪除 openBulkDelQ
══════════════════════════════════════════════════════════════ */
async function openBulkDelQ(){
  try{
    const qs=await da('questions');
    if(!qs.length){ toast('目前無題目'); return; }
    const years=[...new Set(qs.map(q=>q.year||'').filter(Boolean))].sort().reverse();
    const exams=[...new Set(qs.map(q=>q.exam||'').filter(Boolean))].sort();
    const subs =[...new Set(qs.map(q=>q.subject||'').filter(Boolean))].sort();
    const old=$el('bulk-del-q-modal'); if(old) old.remove();
    const modal=document.createElement('div');
    modal.id='bulk-del-q-modal';
    modal.style.cssText='position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;backdrop-filter:blur(3px)';
    const fi=(id,ph,list)=>`<input id="${id}" ${list?`list="${list}"`:''}  placeholder="${ph}" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px;margin-top:4px">`;
    const lbl=t=>`<label style="font-size:12px;font-weight:600;color:var(--t2)">${t}</label>`;
    modal.innerHTML=`
      <div onclick="event.stopPropagation()" style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:85vh;overflow-y:auto;border-top:1px solid var(--bd2)">
        <div style="width:36px;height:4px;background:var(--bg4);border-radius:2px;margin:0 auto 16px"></div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px">🗑 題目大量刪除</div>
        <div style="font-size:12px;color:var(--t2);margin-bottom:12px;line-height:1.6">依條件篩選刪除。<b style="color:var(--red)">刪除後無法復原。</b></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>${lbl('年度')}${fi('bdq-year','例：113（留空不限）','bdq-yl')}<datalist id="bdq-yl">${years.map(y=>`<option value="${y}">`).join('')}</datalist></div>
          <div>${lbl('考試別')}${fi('bdq-exam','例：升官等（留空不限）','bdq-el')}<datalist id="bdq-el">${exams.map(e=>`<option value="${e}">`).join('')}</datalist></div>
          <div>${lbl('科目')}${fi('bdq-sub','例：警察法規（留空不限）','bdq-sl')}<datalist id="bdq-sl">${subs.map(s=>`<option value="${s}">`).join('')}</datalist></div>
          <div>${lbl('指定題號（逗號分隔，留空=全部符合）')}${fi('bdq-nums','例：1,2,5,10')}</div>
        </div>
        <div id="bdq-preview" style="margin-top:12px;font-size:12px;color:var(--t2)"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t1);font-size:13px;font-weight:600;cursor:pointer" onclick="document.getElementById('bulk-del-q-modal').remove()">取消</button>
          <button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t2);font-size:13px;font-weight:600;cursor:pointer" onclick="previewBulkDelQ()">預覽</button>
          <button style="flex:1;padding:12px;border-radius:10px;background:var(--red);color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:none" onclick="confirmBulkDelQ()">確認刪除</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }catch(e){ logError('openBulkDelQ',e); }
}
async function previewBulkDelQ(){
  const targets=_filterBulkDelQ(await da('questions'));
  const el=$el('bdq-preview');
  if(el) el.innerHTML='<span style="color:var(--org)">符合條件：<b>'+targets.length+'</b> 題將被刪除</span>';
}
async function confirmBulkDelQ(){
  try{
    const targets=_filterBulkDelQ(await da('questions'));
    if(!targets.length){ toast('無符合條件的題目'); return; }
    if(!confirm('確定刪除 '+targets.length+' 題？此操作無法復原！')) return;
    for(const q of targets) await dd('questions',q.id);
    const m=$el('bulk-del-q-modal'); if(m) m.remove();
    toast('已刪除 '+targets.length+' 題 ✓');
    await renderQLib(); renderHome();
  }catch(e){ logError('confirmBulkDelQ',e); }
}
function _filterBulkDelQ(qs){
  const yr =(document.getElementById('bdq-year')||{}).value?.trim()||'';
  const ex =(document.getElementById('bdq-exam')||{}).value?.trim()||'';
  const sub=(document.getElementById('bdq-sub') ||{}).value?.trim()||'';
  const nums=(document.getElementById('bdq-nums')||{}).value?.trim()||'';
  const numSet=nums?new Set(nums.split(/[,，、\s]+/).map(n=>n.trim()).filter(Boolean)):null;
  return qs.filter(q=>{
    if(yr  && (q.year||'')!==yr)    return false;
    if(ex  && (q.exam||'')!==ex)    return false;
    if(sub && (q.subject||'')!==sub) return false;
    if(numSet && !numSet.has(String(q.num||''))) return false;
    return true;
  });
}

/* ══════════════════════════════════════════════════════════════
   Inline Browse（page-pg-list）— 題目 + 資料 雙 tab
══════════════════════════════════════════════════════════════ */
let _inlineQs=[], _inlineLaws=[];
let _ibQType='all', _ibQSub='all', _ibQYear='';
let _ibLawCat='all', _ibLawName='all';

async function openInlineBrowse(){
  try{
    [_inlineQs, _inlineLaws] = await Promise.all([da('questions'), da('laws')]);
    _buildInlineQChips();
    renderInlineList();
  }catch(e){ logError('openInlineBrowse',e); }
}

function switchBrowseTab(tab,btn){
  document.querySelectorAll('#page-pg-list .chip-row .chip[id^="tab-"]').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const qP=$el('browse-q-panel'), dP=$el('browse-d-panel');
  if(tab==='q'){
    if(qP) qP.style.display=''; if(dP) dP.style.display='none';
    _buildInlineQChips(); renderInlineList();
  }else{
    if(qP) qP.style.display='none'; if(dP) dP.style.display='';
    _buildInlineLawChips(); renderInlineLawList();
  }
}

function _buildInlineQChips(){
  const subs=[...new Set(_inlineQs.map(q=>q.subject).filter(Boolean))].sort();
  const subEl=$el('bq-sub-chips');
  if(subEl) subEl.innerHTML=
    '<button class="chip'+(_ibQSub==='all'?' on':'')+'" onclick="setInlineQSub(\'all\',this)">全部科目</button>'+
    subs.map(s=>'<button class="chip'+(_ibQSub===s?' on':'')+'" onclick="setInlineQSub(\''+esc(s)+'\',this)">'+esc(s)+'</button>').join('');
  const years=[...new Set(_inlineQs.map(q=>q.year).filter(Boolean))].sort().reverse();
  const yrEl=$el('bq-year-chips');
  if(yrEl){
    yrEl.innerHTML='<button class="chip'+(!_ibQYear?' on':'')+'" onclick="setInlineQYear(\'\',this)">全部年度</button>'+
      years.map(y=>'<button class="chip'+(_ibQYear===y?' on':'')+'" onclick="setInlineQYear(\''+esc(y)+'\',this)">'+esc(y)+'</button>').join('');
  }
}
function setInlineQSub(v,btn){
  _ibQSub=v;
  document.querySelectorAll('#bq-sub-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderInlineList();
}
function setInlineQYear(v,btn){
  _ibQYear=v;
  document.querySelectorAll('#bq-year-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderInlineList();
}
function setBrowseQType(v,btn){
  _ibQType=v;
  document.querySelectorAll('#bq-type-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderInlineList();
}
function renderInlineList(){
  const kw=($el('bq-search')?.value||'').toLowerCase().trim();
  const fl=_inlineQs.filter(q=>{
    if(_ibQType!=='all'&&q.type!==_ibQType) return false;
    if(_ibQSub!=='all'&&q.subject!==_ibQSub) return false;
    if(_ibQYear&&q.year!==_ibQYear) return false;
    if(kw){ const h=((q.stem||'')+(q.subject||'')+(q.year||'')).toLowerCase(); if(!h.includes(kw)) return false; }
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const cntEl=$el('bq-count'); if(cntEl) cntEl.textContent=fl.length;
  const el=$el('bq-list'); if(!el) return;
  if(!fl.length){ el.innerHTML='<div class="empty"><div class="ic">🔍</div><div class="empty-desc">沒有符合的題目</div></div>'; return; }
  el.innerHTML=fl.slice(0,80).map(q=>{
    const opts=q.type==='mc'?Object.entries(q.options||{}).map(([k,v])=>'<div style="font-size:12px;color:var(--t2);padding:1px 0">('+k+') '+esc(v)+'</div>').join(''):'';
    return '<div class="card fu" style="margin:5px 16px">'+
      '<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;flex-wrap:wrap">'+
        '<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'+
        (q.subject?'<span class="tag">'+esc(q.subject)+'</span>':'')+
        (q.year?'<span class="tag">'+esc(q.year)+'</span>':'')+
        (q.num?'<span class="tag">第'+esc(String(q.num))+'題</span>':'')+
        (q.starred?'<span style="margin-left:auto;font-size:13px;color:var(--org)">★</span>':'')+
      '</div>'+
      '<div style="font-size:14px;line-height:1.65;color:var(--t1);margin-bottom:6px">'+esc(q.stem||'')+'</div>'+
      opts+
      (q.answer?'<div style="font-size:12px;color:var(--grn);margin-top:4px;font-weight:600">答案：'+esc(q.answer)+'</div>':'')+
    '</div>';
  }).join('');
}

function _buildInlineLawChips(){
  const names=[...new Set(_inlineLaws.map(l=>l.lawName).filter(Boolean))].sort();
  const nameEl=$el('bd-law-chips');
  if(nameEl) nameEl.innerHTML=
    '<button class="chip'+(_ibLawName==='all'?' on':'')+'" onclick="setInlineLawName(\'all\',this)">全部法律</button>'+
    names.map(n=>'<button class="chip'+(_ibLawName===n?' on':'')+'" onclick="setInlineLawName(\''+esc(n)+'\',this)">'+esc(n)+'</button>').join('');
}
function setBrowseLawCat(v,btn){
  _ibLawCat=v;
  document.querySelectorAll('#bd-cat-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  _ibLawName='all'; _buildInlineLawChips(); renderInlineLawList();
}
function setInlineLawName(v,btn){
  _ibLawName=v;
  document.querySelectorAll('#bd-law-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderInlineLawList();
}
function renderInlineLawList(){
  const kw=($el('bd-search')?.value||'').toLowerCase().trim();
  const fl=_inlineLaws.filter(l=>{
    if(_ibLawCat!=='all'&&l.category!==_ibLawCat) return false;
    if(_ibLawName!=='all'&&l.lawName!==_ibLawName) return false;
    if(kw){ const h=((l.lawName||'')+(l.article||'')+(l.content||'')).toLowerCase(); if(!h.includes(kw)) return false; }
    return true;
  }).sort((a,b)=>(a.articleNumber||0)-(b.articleNumber||0));
  const cntEl=$el('bd-count'); if(cntEl) cntEl.textContent=fl.length;
  const el=$el('bd-list'); if(!el) return;
  if(!fl.length){ el.innerHTML='<div class="empty"><div class="ic">📜</div><div class="empty-desc">沒有符合的資料</div></div>'; return; }
  el.innerHTML=fl.slice(0,100).map(l=>
    '<div class="card fu" style="margin:5px 16px">'+
      '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:4px">'+esc(l.lawName||'')+(l.article?' · '+esc(l.article):'')+'</div>'+
      (l.articleTitle?'<div style="font-size:12px;color:var(--t2);margin-bottom:4px">'+esc(l.articleTitle)+'</div>':'')+
      '<div style="font-size:13px;color:var(--t1);line-height:1.7;white-space:pre-wrap;word-break:break-all">'+esc(l.content||'')+'</div>'+
      (l.note?'<div style="font-size:11px;color:var(--pur);margin-top:6px;padding:5px 8px;border-radius:6px;background:var(--pur2)">📝 '+esc(l.note)+'</div>':'')+
    '</div>'
  ).join('');
}

/* ── Browse Overlay (browse-ov) ─────────────────────────────── */
let _browseQs=[];
async function openBrowse(){
  try{
    window._brType=window._brType||'all';
    _browseQs=await da('questions');
    const subs=[...new Set(_browseQs.map(q=>q.subject).filter(Boolean))].sort();
    const chEl=$el('br-chips');
    if(chEl) chEl.innerHTML='<button class="chip on" onclick="setBrFilter(this,\'all\')">全部科目</button>'+subs.map(s=>'<button class="chip" onclick="setBrFilter(this,\''+esc(s)+'\')">'+esc(s)+'</button>').join('');
    const years=[...new Set(_browseQs.map(q=>q.year).filter(Boolean))].sort().reverse();
    const yrEl=$el('br-year-chips2');
    if(yrEl) yrEl.innerHTML='<button class="chip on" onclick="setBrYear(this,\'\')">全部年度</button>'+years.map(y=>'<button class="chip" onclick="setBrYear(this,\''+esc(y)+'\')">'+esc(y)+'</button>').join('');
    window._brFilter='all'; window._brYear='';
    const kwEl=$el('br-search'); if(kwEl) kwEl.value='';
    browseSearch();
    $el('browse-ov').style.display='flex';
  }catch(e){ logError('openBrowse',e); }
}
function closeBrowse(){ $el('browse-ov').style.display='none'; }
function setBrFilter(el,v){ document.querySelectorAll('#br-chips .chip').forEach(c=>c.classList.remove('on')); el.classList.add('on'); window._brFilter=v; browseSearch(); }
function setBrYear(el,v){ document.querySelectorAll('#br-year-chips2 .chip').forEach(c=>c.classList.remove('on')); el.classList.add('on'); window._brYear=v; browseSearch(); }
function setBrType(el,typeFilter){ document.querySelectorAll('#br-type-all,#br-type-mc,#br-type-es').forEach(b=>{if(b)b.classList.remove('on');}); el.classList.add('on'); window._brType=typeFilter; renderBrowseList(); }
function setBrTab(tab,btn){ document.querySelectorAll('[id^="brtab-"]').forEach(b=>b.classList.remove('on')); if(btn) btn.classList.add('on'); }
function browseSearch(){ renderBrowseList(); }
const _debouncedBrowseSearch=debounce(browseSearch,200);
function renderBrowseList(){
  const kw=($el('br-search')?.value||'').toLowerCase().trim();
  const f=window._brFilter||'all', yr=window._brYear||'', typeF=window._brType||'all';
  const fl=_browseQs.filter(q=>{
    if(typeF!=='all'&&q.type!==typeF) return false;
    if(f!=='all'&&q.subject!==f) return false;
    if(yr&&q.year!==yr) return false;
    if(kw){ const h=((q.searchBlob)||(q.stem||'')+(q.subject||'')+(q.year||'')).toLowerCase(); if(!h.includes(kw)) return false; }
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const el=$el('br-list'); if(!el) return;
  if(!fl.length){ el.innerHTML='<div class="empty"><div class="ic">🔍</div><div style="color:var(--t2)">沒有符合的題目</div></div>'; return; }
  el.innerHTML=fl.map(q=>{
    const opts=q.type==='mc'?Object.entries(q.options||{}).map(([k,v])=>'<div style="font-size:12px;color:var(--t2);padding:1px 0">('+k+') '+esc(v)+'</div>').join(''):'';
    return '<div class="card" style="margin:5px 12px">'+
      '<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;flex-wrap:wrap">'+
        '<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'+
        '<span class="tag">'+esc(q.subject||'未分類')+'</span>'+
        (q.year?'<span class="tag">'+esc(q.year)+'</span>':'')+
        (q.starred?'<span style="color:var(--org)">⭐</span>':'')+
      '</div>'+
      '<div style="font-size:14px;line-height:1.65;color:var(--t1);margin-bottom:6px;word-break:break-all">'+esc(q.stem||'')+'</div>'+
      opts+
      (q.answer?'<div style="font-size:12px;color:var(--grn);margin-top:4px;font-weight:600">答案：'+esc(q.answer)+'</div>':'')+
    '</div>';
  }).join('');
}

/* debounced 別名（供 HTML oninput 使用） */
const _debouncedRenderDB    = debounce(renderDB, 220);
