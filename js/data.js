// ══════════════════════════════════════════════════════════════
// data.js — 題目管理 + 資料庫（法條）+ 大量貼題
// 依賴：db.js, utils.js
// ══════════════════════════════════════════════════════════════

// ══ questions.js — 題目管理 ════════════════════════════════
// 依賴：db.js, utils.js

let _dupResolve=null;

async function renderHome(){  try{
  const [qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  const now=Date.now();
  const todayStr=today();

  // 統計數據（合併數據橫條）
  const ws=getWrong(qs,ats);
  const totalAts_=ats.length;
  const correctAts_=ats.filter(a=>a.correct).length;
  const todayAts_=ats.filter(a=>a.date===todayStr).length;
  const _set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  _set('hdb-rate', totalAts_?Math.round(correctAts_/totalAts_*100)+'%':'—');
  _set('hdb-q',    qs.length);

  // 今日任務
  const reviewDue=qs.filter(q=>(q.nextReview||0)<=now&&q.reviewLevel!==undefined).length;
  const newQ=qs.filter(q=>q.reviewLevel===undefined||q.reviewLevel===null).length;
  const dangerQ=qs.filter(q=>getDangerLevel(q,ats)==='🔴').length;
  const avgTime=ats.length?Math.round(ats.reduce((s,a)=>s+(a.responseTime||0),0)/ats.length/1000):0;
  const estMin=Math.ceil((reviewDue*avgTime||reviewDue*45)/60);

  document.getElementById('h-date').textContent=new Date().toLocaleDateString('zh-TW',{weekday:'long',month:'long',day:'numeric'});
  // 勉勵語：從 IndexedDB 讀取
  const mottoEl=document.getElementById('h-motto');
  if(mottoEl){
    const saved=await getSetting('examMotto','');
    if(saved) mottoEl.textContent=saved;
  }
  // 今日任務 badges（精緻橫排）
  const planEl=document.getElementById('h-plan-badges');
  if(planEl){
    const badges=[];
    if(reviewDue>0) badges.push(`<span class="plan-badge review">待複習 ${reviewDue}</span>`);
    if(dangerQ>0)   badges.push(`<span class="plan-badge danger">危險 ${dangerQ}</span>`);
    const nq=Math.min(newQ,10);
    if(nq>0)        badges.push(`<span class="plan-badge newq">新題 ${nq}</span>`);
    if(estMin>0)    badges.push(`<span class="plan-badge time">約 ${estMin} 分鐘</span>`);
    if(!badges.length) badges.push(`<span class="plan-badge time">今日進度良好 ✓</span>`);
    planEl.innerHTML=badges.join('');
  }
  // 數據橫條（危險題、待複習）
  _set('hdb-danger',  dangerQ);
  _set('hdb-review',  reviewDue);

  // 考試倒數
  renderCountdown();

  // datalist 科目
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
  ['bi-subs','f-subs'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.innerHTML=subs.map(s=>`<option value="${esc(s)}">`).join('');
  });

  // 設定頁資訊
  const expEl=document.getElementById('exp-info');
  if(expEl)expEl.textContent=`題目 ${qs.length} 筆・法條 ${ls.length} 筆・作答 ${ats.length} 筆`;
  }catch(e){ logError('renderHome',e); }}

async function renderList(){  try{
  const [qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const kw=(document.getElementById('si')?.value||'').toLowerCase().trim();
  const f=S.filter||'all';
  const sf=S.subF||'all';
  const ws=getWrong(qs,ats);
  let fl=qs.filter(q=>{
    if(f==='mc'&&q.type!=='mc')return false;
    if(f==='es'&&q.type!=='es')return false;
    if(f==='wrong'&&!ws.has(q.id))return false;
    if(f==='star'&&!q.starred)return false;
    if(sf!=='all'&&q.subject!==sf)return false;
    if(kw){const h=(q.searchBlob||(q.stem||'')+(q.subject||'')+(q.keywords||[]).join(' ')).toLowerCase();if(!h.includes(kw))return false;}
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const lcEl=document.getElementById('lc');
  if(lcEl) lcEl.textContent='共 '+fl.length+' 題';
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))].sort();
  const schips=document.getElementById('schips');
  if(schips){
    schips.innerHTML='';
    ['all',...subs].forEach(s=>{
      const b=document.createElement('button');
      b.className='chip'+(((s==='all'&&sf==='all')||(s!=='all'&&sf===s))?' on':'');
      b.textContent=s==='all'?'全部科目':s;
      b.onclick=()=>{ S.subF=s; renderList(); };
      schips.appendChild(b);
    });
  }
  const PAGE=50; let page=0;
  const el=document.getElementById('qlist');
  if(!el) return;
  el.style.cssText=''; el.innerHTML='';
  if(window._vlScroll){ window.removeEventListener('scroll',window._vlScroll); window._vlScroll=null; }
  const _mkQCard=(q)=>{
    const danger=getDangerLevel(q,ats);
    const div=document.createElement('div');
    div.className='qc'+(ws.has(q.id)?' wrong':'')+(q.starred?' star':'');
    div.innerHTML=
      '<div class="qch">'+
        '<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'+
        (q.year?'<span class="tag">'+esc(q.year)+'</span>':'')+
        (q.exam?'<span class="tag">'+esc(q.exam)+'</span>':'')+
        '<span class="tag">'+esc(q.subject||'未分類')+'</span>'+
        '<span style="font-size:13px;margin-left:auto">'+danger+'</span>'+
        '<span style="font-size:15px;margin-left:4px">'+(q.starred?'★':'☆')+'</span>'+
      '</div>'+
      '<div class="qst">'+esc((q.stem||'').slice(0,100))+'</div>'+
      '<div class="qa">'+
        '<button class="qabn" onclick="editQ('+q.id+')">✏ 編輯</button>'+
        '<button class="qabn" data-qid="'+q.id+'" onclick="startSingleQ(this)">▶ 練習</button>'+
        '<button class="qabn" onclick="toggleStar('+q.id+')">'+(q.starred?'★':'☆')+'</button>'+
        '<button class="qabn" style="color:var(--red);margin-left:auto" onclick="delQ('+q.id+')">🗑</button>'+
      '</div>';
    return div;
  };
  const loadMore=()=>{
    const batch=fl.slice(page*PAGE,(page+1)*PAGE);
    if(!batch.length) return;
    batch.forEach(q=>el.appendChild(_mkQCard(q)));
    page++;
    if(lcEl){
      const shown=Math.min(page*PAGE,fl.length);
      lcEl.textContent=shown<fl.length?'共 '+fl.length+' 題（已顯示 '+shown+'，繼續滑動）':'共 '+fl.length+' 題';
    }
  };
  loadMore();
  const pgEl=document.getElementById('pg-list');
  const onScroll=()=>{ if(pgEl&&pgEl.scrollHeight-pgEl.scrollTop-pgEl.clientHeight<200) loadMore(); };
  window._vlScroll=onScroll;
  if(pgEl) pgEl.addEventListener('scroll',onScroll,{passive:true});
  }catch(e){ logError('renderList',e); }}

function setF(el,f){
  document.querySelectorAll('#fchips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');S.filter=f;renderList();
}
function setSF(el,f){
  document.querySelectorAll('#schips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');S.subF=f;renderList();
}

function showAdd(q){
  const data=q&&q.id?q:null;
  S.editId=data?.id||null;
  document.getElementById('add-title').textContent=data?'編輯題目':'新增題目';
  setQT(data?.type||'mc');
  document.getElementById('f-sub').value=data?.subject||'';
  document.getElementById('f-yr').value=data?.year||'';
  document.getElementById('f-ex').value=data?.exam||'';
  document.getElementById('f-num').value=data?.num||'';
  document.getElementById('f-stem').value=data?.stem||'';
  // 題組欄位
  const isGroupEl=document.getElementById('f-is-group');
  const groupWrap=document.getElementById('f-group-wrap');
  const hasGroup=!!(data?.groupId);
  if(isGroupEl) isGroupEl.checked=hasGroup;
  if(groupWrap) groupWrap.classList.toggle('hide',!hasGroup);
  const gsEl=document.getElementById('f-group-stem');
  if(gsEl) gsEl.value=data?.groupStem||'';
  const giEl=document.getElementById('f-group-id');
  if(giEl) giEl.value=data?.groupId||'';
  const goEl=document.getElementById('f-group-order');
  if(goEl) goEl.value=data?.groupOrder||''  ;
  document.getElementById('f-kw').value=(data?.keywords||[]).join(',');
  document.getElementById('f-note').value=data?.note||'';
  const isNumEl=document.getElementById('f-is-number');
  if(isNumEl) isNumEl.checked=data?.isNumberQ||false;
  document.getElementById('f-laws').value=(data?.relatedLaws||[]).map(l=>l.ref||l.lawName||'').filter(Boolean).join(',');
  // 申論題關鍵字
  const mustEl=document.getElementById('f-must-kw');
  if(mustEl)mustEl.value=(data?.mustKeywords||[]).join(',');
  buildOpts(data||{});
  document.getElementById('add-ov').classList.add('on');
  setTimeout(()=>document.getElementById('f-stem').focus(),300);
}
function closeAdd(){document.getElementById('add-ov').classList.remove('on');S.editId=null;}

function toggleGroupStem(){
  const cb=document.getElementById('f-is-group');
  const wrap=document.getElementById('f-group-wrap');
  if(wrap) wrap.classList.toggle('hide',!cb?.checked);
}

function setQT(t){
  S.qType=t;
  document.getElementById('tmc').className='btn '+(t==='mc'?'bp':'bg');
  document.getElementById('tes').className='btn '+(t==='es'?'bp':'bg');
  document.getElementById('mc-opts').classList.toggle('hide',t!=='mc');
  document.getElementById('es-area').classList.toggle('hide',t!=='es');
  // (10) 申論必寫關鍵字只在申論題顯示
  const mustWrap=document.getElementById('must-kw-wrap');
  if(mustWrap) mustWrap.classList.toggle('hide',t!=='es');
}

function buildOpts(q){
  const opts=q.options||{A:'',B:'',C:'',D:''};
  const ans=(q.answer||'').replace(/[, ]/g,'');
  // 初始化多選集合
  S.correctSet=new Set(ans.split('').filter(c=>/[A-E]/.test(c)));
  S.correct=ans;
  document.getElementById('opts-c').innerHTML=
    ['A','B','C','D','E'].map(k=>`
      <div class="oi">
        <button class="cb ${ans===k?'sel':''}" id="cb-${k}" onclick="setCorr('${k}')">${k}</button>
        <input id="opt-${k}" placeholder="選項 ${k}" value="${esc(opts[k]||'')}">
      </div>`).join('');
  document.getElementById('f-es').value=q.answerEs||'';
}

function setCorr(k){
  // 支援多選：再次點擊已選的取消，多個選項可同時選
  if(!S.correctSet) S.correctSet=new Set();
  if(S.correctSet.has(k)) S.correctSet.delete(k);
  else S.correctSet.add(k);
  // 排序後合併成答案字串
  S.correct=[...S.correctSet].sort().join('');
  ['A','B','C','D','E'].forEach(c=>{
    const el=document.getElementById('cb-'+c);
    if(el)el.className='cb'+(S.correctSet.has(c)?' sel':'');
  });
}

const _debouncedRenderList=debounce(renderList,200);
const _debouncedRenderDB=debounce(renderDB,220);

async function saveQ(){
  try{
  const stem=cleanSpaces(document.getElementById('f-stem').value.trim());
  if(!stem){toast('請填寫題目內容');return;}
  const type=S.qType;
  const options={};
  if(type==='mc'){
    ['A','B','C','D','E'].forEach(k=>{
      const v=cleanSpaces(document.getElementById('opt-'+k)?.value.trim()||'');
      if(v)options[k]=v;
    });
    if(Object.keys(options).length<2){toast('選擇題至少需要2個選項');return;}
  }
  const relStr=document.getElementById('f-laws')?.value.trim()||'';
  const relatedLaws=relStr?relStr.split(/[,，]/).map(s=>({ref:s.trim()})).filter(r=>r.ref):[];
  const mustStr=document.getElementById('f-must-kw')?.value.trim()||'';
  const mustKeywords=mustStr?mustStr.split(/[,，]/).map(s=>s.trim()).filter(Boolean):autoKeywords(stem);

  const data={
    type,stem,options,
    answer:type==='mc'?S.correct:'',
    answerEs:document.getElementById('f-es')?.value.trim()||'',
    subject:document.getElementById('f-sub').value.trim(),
    year:document.getElementById('f-yr').value.trim(),
    exam:document.getElementById('f-ex').value,
    num:document.getElementById('f-num').value.trim(),
    keywords:kwArr(document.getElementById('f-kw').value),
    mustKeywords,
    tags:[],
    note:document.getElementById('f-note').value.trim(),
    isNumberQ:document.getElementById('f-is-number')?.checked||false,
    groupStem:(document.getElementById('f-is-group')?.checked && document.getElementById('f-group-stem')?.value.trim()) || '',
    groupId:(document.getElementById('f-is-group')?.checked && document.getElementById('f-group-id')?.value.trim()) || '',
    groupOrder:parseInt(document.getElementById('f-group-order')?.value)||0,
    relatedLaws,
    starred:false,createdAt:Date.now(),
    reviewLevel:0,nextReview:Date.now(),lastReview:null,
    wrongCount:0,correctStreak:0,difficultyScore:5
  };

  if(!S.editId){
    const dup=await checkDuplicate(data);
    if(dup){
      const action=await showDupDialog(data,dup);
      if(action==='skip'){closeAdd();return;}
      if(action==='replace'){data.id=dup.id;data.starred=dup.starred;data.createdAt=dup.createdAt;data.reviewLevel=dup.reviewLevel||0;}
    }
  } else {
    const ex=await dg('questions',S.editId);
    data.id=S.editId;
    data.starred=ex?.starred||false;
    data.createdAt=ex?.createdAt||Date.now();
    data.reviewLevel=ex?.reviewLevel||0;
    data.nextReview=ex?.nextReview||Date.now();
    data.wrongCount=ex?.wrongCount||0;
    // 編輯時若未勾選題組，保留原 groupId 讓使用者決定（不自動清空）
    data.correctStreak=ex?.correctStreak||0;
    data.difficultyScore=ex?.difficultyScore||5;
  }
  try{
    // 建立搜尋索引（加速搜尋）
    data.searchBlob=((data.stem||'')+' '+(data.groupStem||'')+' '+(data.subject||'')+' '+(data.keywords||[]).join(' ')).toLowerCase();
    await dp('questions',data);
    closeAdd();toast(S.editId?'題目已更新 ✓':'題目已儲存 ✓');
  }catch(e){
    logError('saveQ',e);
    toast('儲存失敗，請重試');
  }
  if(S.page==='list')renderList();else renderHome();
  }catch(e){logError('saveQ',e);}}

async function editQ(id){  try{const q=await dg('questions',id);if(q)showAdd(q);  }catch(e){ logError('editQ',e); }}
async function toggleStar(id){  try{
  const q=await dg('questions',id);if(!q)return;
  q.starred=!q.starred;await dp('questions',q);
  toast(q.starred?'已收藏 ⭐':'取消收藏');renderList();
  }catch(e){ logError('toggleStar',e); }}

async function openBulkDelQ(){  try{
  const qs=await da('questions');
  if(!qs.length){toast('目前無題目');return;}
  const years=[...new Set(qs.map(q=>q.year||'').filter(Boolean))].sort().reverse();
  const exams=[...new Set(qs.map(q=>q.exam||'').filter(Boolean))].sort();
  const subs=[...new Set(qs.map(q=>q.subject||'').filter(Boolean))].sort();
  const modal=document.createElement('div');
  modal.id='bulk-del-q-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end';
  modal.innerHTML=`<div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:85vh;overflow-y:auto"><div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 16px"></div><div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:14px">🗑 題目大量刪除</div><div style="font-size:12px;color:var(--t2);margin-bottom:12px">依條件篩選刪除，或指定題號。<b style="color:var(--red)">刪除後無法復原。</b></div><div style="display:flex;flex-direction:column;gap:10px"><div><label class="fl">年度</label><input id="bdq-year" list="bdq-yl" placeholder="例：113（留空不限）"><datalist id="bdq-yl">${years.map(y=>`<option value="${y}">`).join('')}</datalist></div><div><label class="fl">考試別</label><input id="bdq-exam" list="bdq-el" placeholder="例：升官等（留空不限）"><datalist id="bdq-el">${exams.map(e=>`<option value="${e}">`).join('')}</datalist></div><div><label class="fl">科目</label><input id="bdq-sub" list="bdq-sl" placeholder="例：警察法規（留空不限）"><datalist id="bdq-sl">${subs.map(s=>`<option value="${s}">`).join('')}</datalist></div><div><label class="fl">指定題號（逗號分隔，留空刪除所有符合條件）</label><input id="bdq-nums" placeholder="例：1,2,5,10"></div></div><div id="bdq-preview" style="margin-top:12px;font-size:12px;color:var(--t2)"></div><div style="display:flex;gap:8px;margin-top:16px"><button class="btn bg" style="flex:1;padding:12px" onclick="document.getElementById('bulk-del-q-modal').remove()">取消</button><button class="btn bg" style="flex:1;padding:12px;color:var(--t2)" onclick="previewBulkDelQ()">預覽</button><button class="btn" style="flex:1;padding:12px;background:var(--red);color:#fff" onclick="confirmBulkDelQ()">確認刪除</button></div></div>`;
  document.body.appendChild(modal);
  }catch(e){ logError('openBulkDelQ',e); }}

async function previewBulkDelQ(){  try{
  const targets=_filterBulkDelQ(await da('questions'));
  const el=document.getElementById('bdq-preview');
  if(el) el.innerHTML='<span style="color:var(--org)">符合條件：<b>'+targets.length+'</b> 題將被刪除</span>';
  }catch(e){ logError('previewBulkDelQ',e); }}

async function confirmBulkDelQ(){  try{
  const targets=_filterBulkDelQ(await da('questions'));
  if(!targets.length){toast('無符合條件的題目');return;}
  if(!confirm('確定刪除 '+targets.length+' 題？\n此操作無法復原！'))return;
  for(const q of targets) await dd('questions',q.id);
  const m=document.getElementById('bulk-del-q-modal');if(m)m.remove();
  toast('已刪除 '+targets.length+' 題 ✓');
  renderHome();renderList();
  }catch(e){ logError('confirmBulkDelQ',e); }}

function _filterBulkDelQ(qs){
  const yr =(document.getElementById('bdq-year')||{}).value?.trim()||'';
  const ex =(document.getElementById('bdq-exam')||{}).value?.trim()||'';
  const sub=(document.getElementById('bdq-sub') ||{}).value?.trim()||'';
  const nums=(document.getElementById('bdq-nums')||{}).value?.trim()||'';
  const numSet=nums?new Set(nums.split(/[,，、\s]+/).map(n=>n.trim()).filter(Boolean)):null;
  return qs.filter(q=>{
    if(yr  &&(q.year   ||'')!==yr ) return false;
    if(ex  &&(q.exam   ||'')!==ex ) return false;
    if(sub &&(q.subject||'')!==sub) return false;
    if(numSet&&!numSet.has(String(q.num||''))) return false;
    return true;
  });
}

async function openBulkDelLaw(){  try{
  const laws=await da('laws');
  if(!laws.length){toast('目前無法條');return;}
  const names=[...new Set(laws.map(l=>l.lawName||'').filter(Boolean))].sort();
  const modal=document.createElement('div');
  modal.id='bulk-del-law-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end';
  modal.innerHTML=`<div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:85vh;overflow-y:auto"><div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 16px"></div><div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:14px">🗑 法條大量刪除</div><div style="font-size:12px;color:var(--t2);margin-bottom:12px">依法律名稱刪除，或指定條號。<b style="color:var(--red)">刪除後無法復原。</b></div><div style="display:flex;flex-direction:column;gap:10px"><div><label class="fl">法律名稱</label><input id="bdl-name" list="bdl-nl" placeholder="例：警察職權行使法（留空不限）"><datalist id="bdl-nl">${names.map(n=>`<option value="${n}">`).join('')}</datalist></div><div><label class="fl">指定條號（逗號分隔，留空刪除該法全部條文）</label><input id="bdl-arts" placeholder="例：1,2,10"></div></div><div id="bdl-preview" style="margin-top:12px;font-size:12px;color:var(--t2)"></div><div style="display:flex;gap:8px;margin-top:16px"><button class="btn bg" style="flex:1;padding:12px" onclick="document.getElementById('bulk-del-law-modal').remove()">取消</button><button class="btn bg" style="flex:1;padding:12px;color:var(--t2)" onclick="previewBulkDelLaw()">預覽</button><button class="btn" style="flex:1;padding:12px;background:var(--red);color:#fff" onclick="confirmBulkDelLaw()">確認刪除</button></div></div>`;
  document.body.appendChild(modal);
  }catch(e){ logError('openBulkDelLaw',e); }}

async function previewBulkDelLaw(){  try{
  const targets=_filterBulkDelLaw(await da('laws'));
  const el=document.getElementById('bdl-preview');
  if(el) el.innerHTML='<span style="color:var(--org)">符合條件：<b>'+targets.length+'</b> 條將被刪除</span>';
  }catch(e){ logError('previewBulkDelLaw',e); }}

async function confirmBulkDelLaw(){  try{
  const targets=_filterBulkDelLaw(await da('laws'));
  if(!targets.length){toast('無符合條件的法條');return;}
  if(!confirm('確定刪除 '+targets.length+' 條法條？\n此操作無法復原！'))return;
  for(const l of targets) await dd('laws',l.id);
  const m=document.getElementById('bulk-del-law-modal');if(m)m.remove();
  toast('已刪除 '+targets.length+' 條 ✓');
  renderDB();
  }catch(e){ logError('confirmBulkDelLaw',e); }}

function _filterBulkDelLaw(laws){
  const name=(document.getElementById('bdl-name')||{}).value?.trim()||'';
  const arts=(document.getElementById('bdl-arts')||{}).value?.trim()||'';
  const artSet=arts?new Set(arts.split(/[,，、\s]+/).map(n=>n.trim()).filter(Boolean)):null;
  return laws.filter(l=>{
    if(name&&(l.lawName||'')!==name) return false;
    if(artSet&&!artSet.has(String(l.articleNumber||''))) return false;
    return true;
  });
}

async function delQ(id){  try{
  if(!confirm('確定刪除此題目？'))return;
  await dd('questions',id);toast('已刪除');renderList();
  }catch(e){ logError('delQ',e); }}

async function checkDuplicate(data){  try{
  const qs=await da('questions');
  const stem30=(data.stem||'').slice(0,30);
  return qs.find(q=>
    q.id!==data.id&&(
      (q.subject===data.subject&&q.year===data.year&&q.num&&data.num&&q.num===data.num)||
      ((q.stem||'').slice(0,30)===stem30&&stem30.length>5)
    )
  )||null;
  }catch(e){ logError('checkDuplicate',e); }}

function showDupDialog(newData,existing){
  return new Promise(res=>{
    _dupResolve=res;
    const diff='【現有題目】\n'+( existing.stem||'').slice(0,60)+'…\n\n【新題目】\n'+(newData.stem||'').slice(0,60)+'…';
    document.getElementById('dup-diff').textContent=diff;
    document.getElementById('dup-ov').style.display='flex';
  });
}
function dupAction(action){
  document.getElementById('dup-ov').style.display='none';
  if(_dupResolve){_dupResolve(action);_dupResolve=null;}
}

async function startSingleQ(el){  try{
  const qid=parseInt(el.dataset.qid);
  const q=await dg('questions',qid);
  if(!q){toast('找不到題目');return;}
  startQWithPool([q],'single');
  }catch(e){ logError('startSingleQ',e); }}


// ══ laws.js — 資料庫（法條）管理 ══════════════════════════════
// 依賴：db.js, utils.js, parser.js

// 法規排序狀態（key → 'name'|'amend'|'count'，dir → 1 升/-1 降）
const _lawSortState = { key:'name', dir:1 };

function openLawSortMenu(btn){
  const menu = document.getElementById('law-sort-menu');
  const popup = document.getElementById('law-sort-popup');
  if(!menu||!popup) return;
  // 定位在按鈕正下方
  const r = btn.getBoundingClientRect();
  popup.style.top  = (r.bottom + 6) + 'px';
  popup.style.right = (window.innerWidth - r.right) + 'px';
  popup.style.left  = 'auto';
  menu.style.display = 'block';
  popup.style.display = 'block';
}
function closeLawSortMenu(){
  document.getElementById('law-sort-menu').style.display='none';
  document.getElementById('law-sort-popup').style.display='none';
}
function pickLawSort(key){
  if(_lawSortState.key === key){
    // 同一個 → 切換方向
    _lawSortState.dir *= -1;
  } else {
    _lawSortState.key = key;
    _lawSortState.dir = 1;
  }
  // 更新選單視覺
  ['name','amend','count'].forEach(k=>{
    const el = document.getElementById('lsp-'+k);
    if(!el) return;
    const isOn = k === _lawSortState.key;
    el.classList.toggle('lsp-on', isOn);
    el.querySelector('.lsp-arrow').textContent = isOn ? '✓' : '';
  });
  // 更新排序按鈕標籤
  const label = {name:'名稱',amend:'修正日期',count:'條數'}[_lawSortState.key];
  const sortBtn = document.getElementById('law-sort-btn');
  if(sortBtn) sortBtn.textContent = label;
  closeLawSortMenu();
  // 同步舊的 S.lawSort 讓 renderDB 可用
  S.lawSort = _lawSortState.key;
  renderDB();
}
// 保留舊 toggleLawSort 防外部殘留呼叫
function toggleLawSort(){ openLawSortMenu(document.getElementById('law-sort-btn')); }
// 保留舊 setLSort 防外部殘留呼叫
function setLSort(el,sort){ pickLawSort(sort); }

async function renderDB(){  try{
  const ls=await da('laws');
  const kw=(document.getElementById('lsi')?.value||'').toLowerCase().trim();
  let kwLaw='', kwArt='', kwText=kw;
  const secM = kw.match(/^(.*)§\s*(\d+)\s*$/);
  if(secM){
    kwLaw  = secM[1].trim().toLowerCase();
    kwArt  = secM[2];
    kwText = '';
  }

  let fl=ls.filter(l=>{
    if(S.lawCat!=='all'&&l.category!==S.lawCat)return false;
    if(!kw) return true;
    if(kwArt){
      const nameMatch = !kwLaw || (l.lawName||'').toLowerCase().includes(kwLaw);
      const artMatch  = String(l.articleNumber||'') === kwArt ||
                        (l.article||'').replace(/\s/g,'').includes('第'+kwArt+'條');
      return nameMatch && artMatch;
    }
    const h = ((l.lawName||'')+(l.article||'')+(l.title||'')+(l.content||'')+(l.keywords||[]).join(' ')).toLowerCase();
    return h.includes(kwText);
  });

  const byName={};
  fl.forEach(l=>{const n=l.lawName||'未分類';if(!byName[n])byName[n]=[];byName[n].push(l);});
  const el=document.getElementById('llist');
  if(!fl.length){el.innerHTML='<div class="empty"><span class="ic">🗄</span><span>尚無資料</span></div>';return;}

  const sortedEntries=Object.entries(byName).sort((a,b)=>{
    const sortBy=S.lawSort||'name';
    const dir=_lawSortState.dir||1;
    if(sortBy==='amend'){
      const toDate=s=>{
        if(!s)return '';
        const rocM=s.match(/民國(\d+)年(\d+)月(\d+)日/);
        if(rocM)return String(parseInt(rocM[1])+1911)+'-'+rocM[2].padStart(2,'0')+'-'+rocM[3].padStart(2,'0');
        return s;
      };
      const da=toDate(a[1][0]?.amendDate)||'0000';
      const db=toDate(b[1][0]?.amendDate)||'0000';
      return dir * db.localeCompare(da);
    }
    if(sortBy==='count') return dir * (b[1].length-a[1].length);
    return dir * a[0].localeCompare(b[0],'zh-TW');
  });

  // ── Infinite Scroll 分頁（每批 50 個法律群組）──────────────
  const PAGE = 50;
  let page = 0;
  el.innerHTML = '';

  const _mkCard = ([name, laws]) => {
    const cat=laws[0].category||'statute';
    const catLabel={'statute':'法規條文','sop':'SOP','supplement':'補充資料','interpretation':'函釋'}[cat]||cat;
    const favCount=laws.filter(l=>l.favorite).length;
    const icon=cat==='sop'?'📋':cat==='supplement'?'📄':'⚖';
    const orgLine=(laws[0]?.org||laws[0]?.amendDate)
      ?('<div style="font-size:10px;color:var(--t2);margin-top:1px">'
        +(laws[0]?.org?'🏛 '+esc(laws[0].org):'')
        +(laws[0]?.org&&laws[0]?.amendDate?' · ':'')
        +(laws[0]?.amendDate?'📅 '+esc(laws[0].amendDate):'')
        +'</div>')
      :'';
    const div = document.createElement('div');
    div.className='lw-card card';
    div.dataset.lawname=name;
    div.style.marginBottom='6px';
    div.innerHTML=
      '<div style="display:flex;align-items:center;gap:8px">'
        +'<span style="font-size:20px">'+icon+'</span>'
        +'<div style="flex:1">'
          +'<div style="font-size:15px;font-weight:700;color:var(--t0)">'+esc(name)+'</div>'
          +'<div style="font-size:11px;color:var(--t2);margin-top:2px">'+catLabel+' · '+laws.length+' 條'+(favCount?' · ⭐'+favCount:'')+'</div>'
          +orgLine
        +'</div>'
        +'<span style="color:var(--t2);font-size:18px">›</span>'
        +'<button class="lw-del" data-lawname="'+esc(name)+'" style="background:var(--red2);color:var(--red);border:1px solid var(--red);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;flex-shrink:0">🗑</button>'
      +'</div>';
    div.addEventListener('click',function(e){
      if(e.target.classList.contains('lw-del'))return;
      openLawGroup(this.dataset.lawname);
    });
    div.querySelector('.lw-del').addEventListener('click',function(e){
      e.stopPropagation();
      delLawGroup(this.dataset.lawname);
    });
    return div;
  };

  const loadMore = () => {
    const batch = sortedEntries.slice(page*PAGE, (page+1)*PAGE);
    if(!batch.length) return;
    batch.forEach(entry => el.appendChild(_mkCard(entry)));
    page++;
    // 顯示計數
    const total = sortedEntries.length;
    const shown = Math.min(page*PAGE, total);
    const lc = document.getElementById('db-lc');
    if(lc) lc.textContent = shown < total ? `顯示 ${shown} / ${total} 筆，繼續滑動載入` : `共 ${total} 筆`;
  };

  loadMore();

  // 移除舊 scroll 監聽
  const pg = document.getElementById('pg-db');
  const scroller = pg?.querySelector('.page') || pg;
  if(scroller){
    const old = scroller._dbScroll;
    if(old) scroller.removeEventListener('scroll', old);
    const onScroll = () => {
      if(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 150){
        loadMore();
      }
    };
    scroller._dbScroll = onScroll;
    scroller.addEventListener('scroll', onScroll, {passive:true});
  }

  }catch(e){ logError('renderDB',e); }}
function renderLaws(){ return renderDB(); }

function setLC(el,cat){
  document.querySelectorAll('#lchips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');S.lawCat=cat;renderDB();
}
function setLSort(el,sort){
  document.querySelectorAll('#l-sort-name,#l-sort-amend,#l-sort-count').forEach(c=>c&&c.classList.remove('on'));
  el.classList.add('on');S.lawSort=sort;renderDB();
}

const LEVEL_STYLE = {
  // ── 由外而內：深藍(編) > 藍(章) > 淺藍(節) ───────────────
  part: {
    color:'#1f6feb', border:'#1f6feb', bg:'rgba(31,111,235,0.18)',
    size:'14px', fw:'800', pt:'10px', pb:'4px', mt:'16px', ml:'0',
    br:'0 8px 8px 0', bw:'4px', label:'編',
  },
  chapter: {
    color:'#58a6ff', border:'#58a6ff', bg:'rgba(88,166,255,0.13)',
    size:'13px', fw:'700', pt:'7px', pb:'3px', mt:'10px', ml:'0',
    br:'0 6px 6px 0', bw:'3px', label:'章',
  },
  section: {
    color:'#a5d6ff', border:'#a5d6ff', bg:'rgba(165,214,255,0.08)',
    size:'12px', fw:'600', pt:'4px', pb:'2px', mt:'5px', ml:'18px',
    br:'0 4px 4px 0', bw:'2px', label:'節',
  },
};

async function openLawGroup(lawName){  try{
  const allLaws=await da('laws');
  const _kw=(document.getElementById('lsi')?.value||'').toLowerCase().trim();
  // §N 精確搜尋
  let _kwLaw2='',_kwArt2='',_kwText2=_kw;
  const _sm=_kw.match(/^(.*)§\s*(\d+)\s*$/);
  if(_sm){_kwLaw2=_sm[1].trim().toLowerCase();_kwArt2=_sm[2];_kwText2='';}
  const laws=allLaws.filter(l=>{
    if(l.lawName!==lawName) return false;
    if(!_kw) return true;
    if(_kwArt2){
      const am=String(l.articleNumber||'')===''+_kwArt2;
      return am;
    }
    const h=((l.article||'')+(l.title||'')+(l.content||'')).toLowerCase();
    return h.includes(_kwText2);
  }).sort((a,b)=>(a.articleNumber||0)-(b.articleNumber||0));
  if(!laws.length)return;
  const others=[...new Set(allLaws.map(l=>l.lawName).filter(Boolean))].filter(n=>n!==lawName).slice(0,8);
  const cat=laws[0].category||'statute';
  const icon=cat==='sop'?'📋':cat==='supplement'?'📄':'⚖';
  document.getElementById('lv-name').textContent=icon+' '+lawName;
  // 顯示法規機關/日期資訊
  const lvInfo=document.getElementById('lv-info');
  if(lvInfo){
    const s=laws[0]||{};
    lvInfo.textContent=(s.org?'🏛 '+s.org:'')+(s.org&&s.amendDate?' · ':'')+(s.amendDate?'📅 '+s.amendDate:'');
    lvInfo.style.display=(s.org||s.amendDate)?'block':'none';
  }
  const sb=document.getElementById('lv-star');
  const favN=laws.filter(l=>l.favorite).length;
  sb.textContent=favN?'★':'☆';
  sb.style.color=favN?'var(--org)':'var(--t2)';
  sb.onclick=async()=>{
    const nf=laws.filter(l=>l.favorite).length>0;
    for(const l of laws){l.favorite=!nf;await dp('laws',l);}
    openLawGroup(lawName);
  };
  const jumpHtml=others.map(n=>'<button class="chip" style="flex-shrink:0;font-size:11px" onclick="openLawGroup(\''+esc(n)+'\')">'+esc(n)+'</button>').join('');

  // ── 三層分組（編 > 章 > 節）────────────────────────────────
  const parts    = [...new Set(laws.map(l=>l.part   ||''))];
  const chapters = [...new Set(laws.map(l=>l.chapter||''))];
  const sections = [...new Set(laws.map(l=>l.section||''))];

  const renderArtCard = (l) => {
    const isImg=l.content&&l.content.startsWith('data:image');
    // 關鍵字反白（搜尋時高亮）
    const _hlKw=(document.getElementById('lsi')?.value||'').trim();
    const _hlRe=_hlKw&&!_hlKw.includes('§')?new RegExp('('+_hlKw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'):null;
    // _hl：esc → 插 mark → 換行（三合一，避免二次轉義）
    const _hl=(text)=>{
      const escaped=esc(text||'');
      if(!_hlRe) return escaped.replace(/\n/g,'<br>');
      return escaped
        .replace(_hlRe,(m)=>'<mark style="background:#d4a438;color:#121212;border-radius:2px;padding:0 2px">'+m+'</mark>')
        .replace(/\n/g,'<br>');
    };
    const contentHtml=isImg?'<img src="'+l.content+'" style="max-width:100%;border-radius:8px;cursor:zoom-in" onclick="openImgViewer(this.src)" title="點擊放大">':_hl(l.content||'');
    const kwHtml=(l.keywords||[]).length?'<div style="margin-top:8px">'+l.keywords.map(k=>'<span class="tag">'+esc(k)+'</span>').join('')+'</div>':'';
    const relHtml=(l.relatedLaws||[]).length
      ?'<div style="margin-top:9px;font-size:11px;color:var(--t2)">🔗 關聯法條：</div>'
        +l.relatedLaws.map(r=>'<button class="chip" style="font-size:11px;margin:2px" onclick="showLawPop(\''+esc(r.ref||r.lawName||'')+'\')">⚖ '+esc(r.ref||r.lawName||'')+'</button>').join('')
      :'';
    return '<div style="margin-bottom:12px;padding:12px;background:var(--bg2);border-radius:8px;border-left:3px solid var(--pur2)">'
      +'<div style="font-size:14px;font-weight:700;color:var(--acc);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">'
        +'<span>'+_hl(l.article||'')+(l.title?' — '+_hl(l.title):'')+'</span>'
        +'<div style="display:flex;gap:6px">'
          +'<button onclick="editLawInView('+l.id+')" style="background:none;border:none;color:var(--t2);font-size:12px;cursor:pointer">✏</button>'
          +'<button onclick="delLaw('+l.id+')" style="background:none;border:none;color:var(--red);font-size:12px;cursor:pointer">🗑</button>'
        +'</div>'
      +'</div>'
      +'<div style="font-size:14px;line-height:1.85;color:var(--t1)">'+contentHtml+'</div>'
      +kwHtml+relHtml
    +'</div>';
  };

  // 編=橙(--org) 章=紫(--pur) 節=藍(--acc) 由外而內

  const renderHeading = (type, text) => {
    if(!text) return '';
    const s = LEVEL_STYLE[type]||LEVEL_STYLE.chapter;
    const id = 'ch-'+encodeURIComponent(type+'-'+text);
    return '<div id="'+id+'" style="'
      +'font-size:'+s.size+';font-weight:'+s.fw+';color:'+s.color+';'
      +'padding:'+s.pt+' 14px '+s.pb+';margin-top:'+s.mt+';'
      +'margin-left:'+s.ml+';'
      +'border-left:'+s.bw+' solid '+s.border+';'
      +'background:'+s.bg+';border-radius:'+s.br+';'
      +'display:flex;align-items:center;gap:6px;'
      +'letter-spacing:.4px;line-height:1.4'
      +'">'
      +'<span style="opacity:.7;font-size:10px;font-weight:400;'
        +'border:1px solid '+s.border+';border-radius:3px;'
        +'padding:0 4px;margin-right:2px">'+s.label+'</span>'
      +esc(text)
    +'</div>';
  };

  let arts='';
  const hasPart    = parts.some(p=>p);
  const hasChapter = chapters.some(c=>c);
  const hasSection = sections.some(s=>s);

  // 用 Map 分組，每條只遍歷一次（取代多層巢狀 filter）
  const grouped=new Map(); // key: 'part|chapter|section'
  laws.forEach(l=>{
    const key=(l.part||'')+'|'+(l.chapter||'')+'|'+(l.section||'');
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(l);
  });

  const renderGroup=(filterFn)=>{
    let lastPart='__none__', lastChapter='__none__', lastSection='__none__';
    laws.forEach(l=>{
      if(!filterFn(l)) return;
      const p=l.part||'', ch=l.chapter||'', sec=l.section||'';
      if(hasPart && p!==lastPart){
        if(p) arts+=renderHeading('part',p);
        lastPart=p; lastChapter='__none__'; lastSection='__none__';
      }
      if(hasChapter && ch!==lastChapter){
        if(ch) arts+=renderHeading('chapter',ch);
        lastChapter=ch; lastSection='__none__';
      }
      if(hasSection && sec!==lastSection){
        if(sec) arts+=renderHeading('section',sec);
        lastSection=sec;
      }
      arts+=renderArtCard(l);
    });
  };
  renderGroup(()=>true);
  // 章節列表（快速跳轉用，含編/章/節）
  const chapterList=[...new Set([
    ...parts.filter(Boolean),
    ...chapters.filter(Boolean),
    ...sections.filter(Boolean),
  ])];
    // 章節管理按鈕
  const chMgrBtn='<button onclick="openChapterMgr(window.currentLawName)" style="background:none;border:1px solid var(--bd);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--t2);margin-left:4px">⚙ 管理章節</button>';
  const chMgrBtnNew='<div style="margin-bottom:6px"><button onclick="openChapterMgr(window.currentLawName)" style="background:none;border:1px solid var(--bd);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--t2)">⚙ 新增章節分類</button></div>';
  const chTagsHtml=chapterList.map(ch=>{
    const isP=parts.filter(Boolean).includes(ch);
    const isS=sections.filter(Boolean).includes(ch);
    const type=isP?'part':isS?'section':'chapter';
    const s=LEVEL_STYLE[type];
    const typeKey=isP?'part':isS?'sec':'ch';
    return '<span class="tag" style="color:'+s.color+';background:'+s.bg+';border:1px solid '+s.border
      +';cursor:pointer;margin:2px;font-size:11px" '
      +'onclick="scrollToChapter(this,\''+encodeURIComponent(ch)+'\',\''+type+'\')" title="點擊跳轉">'
      +'<span style="opacity:.65;font-size:9px;border:1px solid '+s.border
        +';border-radius:3px;padding:0 3px;margin-right:3px">'+s.label+'</span>'
      +esc(ch)+'</span>';
  }).join('');
  const chapterMgmtHtml=chapterList.length
    ?'<div style="margin-bottom:8px"><div style="font-size:11px;color:var(--t2);margin-bottom:4px">章節：'+chTagsHtml+chMgrBtn+'</div></div>'
    :chMgrBtnNew;

  document.getElementById('lbody').innerHTML=
    '<div style="padding:4px 0 10px">'
    +(others.length?'<div class="sec" style="padding:0 0 4px;font-size:11px">快速跳轉</div><div style="overflow-x:auto;display:flex;gap:6px;padding:6px 0">'+jumpHtml+'</div>':'')
    +'<div class="sec" style="padding:8px 0 6px;font-size:11px">'+esc(lawName)+' · '+laws.length+' 條</div>'
    +chapterMgmtHtml
    +arts
    +'</div>';
  window.currentLawName=lawName;window.currentLawContent=laws.map(l=>l.article+' '+l.content).join('\n');
  S.curLawName=lawName; // 供編輯按鈕使用
  document.getElementById('lv').style.display='flex';
  }catch(e){ logError('openLawGroup',e); }}

function exitLaw(){ document.getElementById('lv').style.display='none'; }
async function addLawInGroup(){
  try{
    const lawName=S.curLawName||window.currentLawName;
    if(!lawName){toast('請先開啟一個法規');return;}
    showAddLaw({lawName, article:'', category:'statute',
      content:'', keywords:[], relatedLaws:[], title:''});
  }catch(e){logError('addLawInGroup',e);}
}

async function editLawGroupInfo(){  try{
  const lawName=(S.curLawName||window.currentLawName||'').trim();
  if(!lawName){toast('請先開啟法規');return;}
  const allLaws=await da('laws');
  const sample=allLaws.find(l=>l.lawName===lawName)||{};
  const newOrg=prompt('制定機關（如：行政院、內政部）：',sample.org||'');
  if(newOrg===null)return;
  const rawAmend=prompt('發布／修正日期（格式：YYYMMDD，如 1130509 = 民國113年05月09日）：',sample.amendDate||'');
  if(rawAmend===null)return;
  // 解析 YYYMMDD 格式
  const parsedAmend=parseMinguoDate(rawAmend.trim());
  const targets=allLaws.filter(l=>l.lawName===lawName);
  for(const l of targets){
    l.org=newOrg.trim();
    l.amendDate=parsedAmend;
    await dp('laws',l);
  }
  toast('法規資訊已更新（共'+targets.length+'條）✓');
  openLawGroup(lawName);
  }catch(e){ logError('editLawGroupInfo',e); }}

// 解析民國日期：1130509 → 民國113年05月09日
function parseMinguoDate(s){
  if(!s)return '';
  // 已是完整格式
  if(/民國\d+年/.test(s))return s;
  // YYYMMDD 格式（7位）
  const m7=s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if(m7)return '民國'+m7[1]+'年'+m7[2]+'月'+m7[3]+'日';
  // YYYYMMDD 西元（8位）
  const m8=s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if(m8)return '民國'+(parseInt(m8[1])-1911)+'年'+m8[2]+'月'+m8[3]+'日';
  // 其他格式原樣儲存
  return s;
}

async function editCurLaw(){  try{
  // 功能：快速新增條文到目前法規（預填法規名稱）
  const lawName=(S.curLawName||window.currentLawName||'').trim();
  if(!lawName){toast('請先開啟一個法規');return;}
  // 取得目前法規的類別，預填到新增 sheet
  const allLaws=await da('laws');
  const sample=allLaws.find(l=>l.lawName===lawName);
  showAddLaw({
    lawName:lawName,
    article:'',
    category:sample?.category||'statute',
    content:'',keywords:[],relatedLaws:[],
    org:sample?.org||'',
    amendDate:sample?.amendDate||''
  });
  }catch(e){ logError('editCurLaw',e); }}
async function editLawInView(id){  try{ const l=await dg('laws',id);if(l)showAddLaw(l);   }catch(e){ logError('editLawInView',e); }}
async function toggleLawFav(id){  try{ const l=await dg('laws',id);if(!l)return;l.favorite=!l.favorite;await dp('laws',l);renderDB();toast(l.favorite?'已收藏':'已取消收藏');   }catch(e){ logError('toggleLawFav',e); }}
function toggleLawStar(){}

async function startLawCloze(){
  try{
  startClozeLaw(window.currentLawContent, window.currentLawName);
  }catch(e){logError('startLawCloze',e);toast('startLawCloze 發生錯誤');}
}
async function quizFromLaw(){  try{
  const lawName=(S.curLawName||window.currentLawName||'').trim();
  if(!lawName){toast('請先開啟一個法規');return;}
  const qs=await da('questions');
  if(!qs.length){toast('題庫尚無題目');return;}

  // 精確比對：refName 必須完全等於 lawName（去掉條號後）
  const pool=qs.filter(q=>{
    const rels=q.relatedLaws||[];
    if(!rels.length) return false;
    return rels.some(r=>{
      const ref=(r.ref||r.lawName||'').trim();
      if(!ref) return false;
      // 取 ref 的法規名稱部分（去掉條號 §X 或 第X條）
      const refName=ref.replace(/§.*/,'').replace(/第?\d+條.*/,'').trim();
      // 只有完全相等才算匹配，避免「警察法」誤匹配「警察法施行細則」
      return refName===lawName;
    });
  });

  if(!pool.length){
    toast('無關聯題目。請在題目「關聯法條」欄填入「'+lawName+'」後重試');
    return;
  }
  exitLaw();
  setTimeout(()=>startQWithPool(pool,'📚 '+lawName), 50);
  }catch(e){ logError('quizFromLaw',e); }}

async function delLawGroup(lawName){  try{
  const all=await da('laws');
  const targets=all.filter(l=>l.lawName===lawName);
  if(!targets.length){toast('找不到對應法條');return;}
  if(!confirm('確定刪除「'+lawName+'」全部 '+targets.length+' 條？無法復原。'))return;
  for(const l of targets) await dd('laws',l.id);
  toast('已刪除「'+lawName+'」共 '+targets.length+' 條');
  renderDB();
  }catch(e){ logError('delLawGroup',e); }}

async function delLaw(id){  try{
  if(!confirm('確定刪除此條文？'))return;
  await dd('laws',id);
  toast('已刪除');
  renderDB();
  }catch(e){ logError('delLaw',e); }}

async function showAddLaw(l){
  try{
  S.editLawId=l?.id||null;
  document.getElementById('law-sh-t').textContent=l?'編輯資料':'新增資料';
  document.getElementById('l-name').value=l?.lawName||'';
  document.getElementById('l-art').value=l?.article||'';
  const chEl=document.getElementById('l-chapter');
  if(chEl)chEl.value=l?.chapter||'';
  if(document.getElementById('l-note'))document.getElementById('l-note').value=l?.note||'';
  const tiEl=document.getElementById('l-title');
  if(tiEl)tiEl.value=l?.title||'';
  document.getElementById('l-cat').value=l?.category||'statute';
  document.getElementById('l-content').value=(l?.content&&!l.content.startsWith('data:image'))?l.content:'';
  document.getElementById('l-kw').value=(l?.keywords||[]).join(',');
  const relEl=document.getElementById('l-related');
  if(relEl)relEl.value=(l?.relatedLaws||[]).map(r=>r.ref||'').filter(Boolean).join(',');
  const srcEl=document.getElementById('l-src');
  if(srcEl)srcEl.value=l?.source||'';
  window._sopImgData=(l?.content?.startsWith('data:image'))?l.content:null;
  const prev=document.getElementById('l-img-prev');
  if(prev)prev.innerHTML=window._sopImgData?'<img src="'+window._sopImgData+'" style="max-width:100%;border-radius:8px">':'';
  toggleSOPMode();
  // 更新制定機關 datalist
  da('laws').then(all=>{
    const orgs=[...new Set(all.map(l=>l.org).filter(Boolean))];
    const dl=document.getElementById('l-org-list');
    if(dl)dl.innerHTML=orgs.map(o=>'<option value="'+esc(o)+'">').join('');
  });
  document.getElementById('law-ov').classList.add('on');
  }catch(e){logError('showAddLaw',e);}
}

function closeLawSh(){ document.getElementById('law-ov').classList.remove('on');S.editLawId=null; }


function openImgViewer(src){
  const old=document.getElementById('img-viewer');
  if(old){old.remove();return;}

  // ── 全螢幕遮罩 ──
  const ov=document.createElement('div');
  ov.id='img-viewer';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;overflow:hidden';

  // ── 頂部工具列 ──
  const bar=document.createElement('div');
  bar.style.cssText='display:flex;align-items:center;justify-content:flex-end;padding:0 12px;height:44px;background:rgba(0,0,0,0.75);flex-shrink:0';
  const closeBtn=document.createElement('button');
  closeBtn.textContent='✕';
  closeBtn.style.cssText='background:rgba(255,255,255,0.18);color:#fff;border:none;border-radius:6px;width:40px;height:32px;font-size:18px;cursor:pointer';
  closeBtn.onclick=()=>ov.remove();
  bar.appendChild(closeBtn);

  // ── 圖片容器 ──
  const wrap=document.createElement('div');
  wrap.style.cssText='flex:1;overflow:hidden;position:relative;touch-action:none;cursor:grab';

  const img=document.createElement('img');
  img.src=src;
  img.style.cssText='position:absolute;top:0;left:0;width:100%;height:auto;transform-origin:0 0;user-select:none;-webkit-user-drag:none';
  img.draggable=false;

  // ── 狀態 ──
  let scale=1, tx=0, ty=0;
  let lastDist=0, lastMid={x:0,y:0};
  let dragging=false, lastPos={x:0,y:0};

  const applyTransform=()=>{
    img.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';
  };

  const clampTx=(s,x)=>{
    const imgW=wrap.clientWidth*s;
    const maxX=0;
    const minX=wrap.clientWidth-imgW;
    return Math.min(maxX,Math.max(minX<0?minX:0,x));
  };
  const clampTy=(s,y)=>{
    const imgH=img.naturalHeight*(wrap.clientWidth/img.naturalWidth)*s;
    const maxY=0;
    const minY=wrap.clientHeight-imgH;
    return Math.min(maxY,Math.max(minY<0?minY:0,y));
  };

  const dist=(t)=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  const mid=(t)=>({x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2});

  wrap.addEventListener('touchstart',e=>{
    e.preventDefault();
    if(e.touches.length===2){
      lastDist=dist(e.touches);
      lastMid=mid(e.touches);
      dragging=false;
    } else if(e.touches.length===1){
      dragging=true;
      lastPos={x:e.touches[0].clientX,y:e.touches[0].clientY};
    }
  },{passive:false});

  wrap.addEventListener('touchmove',e=>{
    e.preventDefault();
    if(e.touches.length===2){
      // 雙指縮放
      const d=dist(e.touches);
      const m=mid(e.touches);
      const ds=d/lastDist;
      const newScale=Math.min(Math.max(scale*ds,0.5),8);
      // 以兩指中心為基準縮放
      const rect=wrap.getBoundingClientRect();
      const cx=m.x-rect.left;
      const cy=m.y-rect.top;
      tx=cx-(cx-tx)*(newScale/scale)+(m.x-lastMid.x);
      ty=cy-(cy-ty)*(newScale/scale)+(m.y-lastMid.y);
      scale=newScale;
      tx=clampTx(scale,tx);
      ty=clampTy(scale,ty);
      lastDist=d;
      lastMid=m;
      applyTransform();
    } else if(e.touches.length===1&&dragging){
      // 單指移動（只在放大時有效）
      const dx=e.touches[0].clientX-lastPos.x;
      const dy=e.touches[0].clientY-lastPos.y;
      if(scale>1){
        tx=clampTx(scale,tx+dx);
        ty=clampTy(scale,ty+dy);
        applyTransform();
      }
      lastPos={x:e.touches[0].clientX,y:e.touches[0].clientY};
    }
  },{passive:false});

  wrap.addEventListener('touchend',e=>{
    if(e.touches.length<2) lastDist=0;
    if(e.touches.length===0) dragging=false;
  });

  // 圖片載入後置中
  img.onload=()=>{
    // 預設填滿寬度
    tx=0; ty=0; scale=1;
    applyTransform();
  };

  wrap.appendChild(img);
  ov.appendChild(bar);
  ov.appendChild(wrap);
  document.body.appendChild(ov);
}


function switchLawMode(mode){
  const cw=document.getElementById('l-content-wrap');
  const iw=document.getElementById('l-img-wrap');
  if(mode==='img'){
    if(cw)cw.classList.add('hide');
    if(iw)iw.classList.remove('hide');
  } else {
    if(cw)cw.classList.remove('hide');
    if(iw)iw.classList.add('hide');
  }
}

function toggleSOPMode(){
  const cat=document.getElementById('l-cat')?.value;
  const cw=document.getElementById('l-content-wrap');
  const iw=document.getElementById('l-img-wrap');
  const tw=document.getElementById('l-img-toggle-wrap');
  const hasImg=window._sopImgData!=null;

  if(cat==='sop'){
    // SOP：預設圖片模式
    if(cw)cw.classList.add('hide');
    if(iw)iw.classList.remove('hide');
    if(tw)tw.style.display='none';
  } else if(cat==='supplement'||cat==='interpretation'){
    // 補充資料/函釋：可選文字或圖片，預設文字（有圖片資料則預設圖片）
    if(tw)tw.style.display='block';
    if(hasImg){
      if(cw)cw.classList.add('hide');
      if(iw)iw.classList.remove('hide');
    } else {
      if(cw)cw.classList.remove('hide');
      if(iw)iw.classList.add('hide');
    }
  } else {
    // 法規條文：只有文字
    if(cw)cw.classList.remove('hide');
    if(iw)iw.classList.add('hide');
    if(tw)tw.style.display='none';
  }
}

// 切換圖片/文字模式（補充資料/函釋用）
function onLawImgSelect(e){ loadSOPImg(e); }
function loadSOPImg(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    window._sopImgData=ev.target.result;
    const prev=document.getElementById('l-img-prev');
    if(prev)prev.innerHTML='<img src="'+ev.target.result+'" style="max-width:100%;border-radius:8px;margin-top:4px">';
  };
  reader.readAsDataURL(file);
}

async function saveLaw(){
  try{
  const cat_=document.getElementById('l-cat').value;
  let content='';
  // sop / supplement / interpretation 都可選擇圖片或文字
  const canUseImg=(cat_==='sop'||cat_==='supplement'||cat_==='interpretation');
  if(canUseImg && window._sopImgData){
    // 有上傳圖片，直接用圖片
    content=window._sopImgData;
  } else {
    content=document.getElementById('l-content').value.trim();
    if(!content){toast('請填寫內容，或上傳圖片');return;}
  }
  const article=document.getElementById('l-art').value.trim();
  const chapter=document.getElementById('l-chapter')?.value.trim()||'';
  const relStr=(document.getElementById('l-related')?.value||'').trim();
  const relatedLaws=relStr?relStr.split(/[,，]/).map(s=>({ref:s.trim()})).filter(r=>r.ref):[];
  const articleNumber=art2n(article)||0;
  const data={
    lawName:document.getElementById('l-name').value.trim(),
    article,chapter,articleNumber,
    category:cat_,
    title:document.getElementById('l-title')?.value.trim()||'',
    content,
    keywords:kwArr(document.getElementById('l-kw').value),
    relatedLaws,
    source:document.getElementById('l-src')?.value.trim()||'',
    org:document.getElementById('l-org')?.value?.trim()||'',
    amendDate:document.getElementById('l-amend')?.value?.trim()||'',
    note:document.getElementById('l-note')?.value.trim()||'',
    favorite:false,createdAt:Date.now()
  };
  if(!data.lawName){toast('請填寫法律名稱');return;}
  if(S.editLawId){
    const ex=await dg('laws',S.editLawId);
    data.id=S.editLawId;
    data.favorite=ex?.favorite||false;
    data.createdAt=ex?.createdAt||Date.now();
  }
  try{
    await dp('laws',data);
    // 更新制定機關 datalist
    if(data.org){
      const dl=document.getElementById('l-org-list');
      if(dl){
        const existing=[...dl.querySelectorAll('option')].map(o=>o.value);
        if(!existing.includes(data.org)){
          const opt=document.createElement('option');
          opt.value=data.org; dl.appendChild(opt);
        }
      }
    }
    closeLawSh();
    toast(S.editLawId?'法條已更新 ✓':'法條已儲存 ✓');
  }catch(e){
    logError('saveLaw',e);
    toast('儲存失敗，請重試');
  }
  renderDB();
  }catch(e){logError('saveLaw',e);toast('saveLaw 發生錯誤');}
}

function openBulkQ(){
  // 填入科目 datalist（與逐一新增共用來源）
  da('questions').then(qs=>{
    const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
    const dl=document.getElementById('bi-subs');
    if(dl) dl.innerHTML=subs.map(s=>`<option value="${s}">`).join('');
  }).catch(()=>{});
  document.getElementById('bulk-ov').classList.add('on');
}
function closeBulkQ(){ document.getElementById('bulk-ov').classList.remove('on'); }

function showBulkLaw(){ document.getElementById('blaw-ov').classList.add('on'); }
function closeBulkLaw(){ document.getElementById('blaw-ov').classList.remove('on'); }

function parseLawText(rawText, lawName, category, source){
  if(!rawText||!rawText.trim()) return [];

  const lines = rawText.split('\n').map(l=>l.trim()).filter(Boolean);
  const items = [];

  // ── 三層結構狀態 ──────────────────────────────────────────
  let curPart    = '';  // 編（最上層）：第一編 總則
  let curChapter = '';  // 章（中層）：第一章 總則
  let curSection = '';  // 節（最下層）：第一節 一般規定
  let curArtNum  = null;
  let curTitle   = '';
  let contentLines = [];

  // 正規表達式：只認「章節編節」行，條號只認阿拉伯數字
  // 數字部分：支援阿拉伯數字、中文數字、及中文數字間有空格（如「十 三」）
  // 支援「編」（最上層結構）
  const _numPart = '((?:[一二三四五六七八九十百千\\d]+\\s*)+?)';
  const partRe    = new RegExp('^第\\s*'+_numPart+'\\s*[篇編]\\s*(.+)?');
  const chapterRe = new RegExp('^第\\s*'+_numPart+'\\s*章\\s*(.+)?');
  const sectionRe = new RegExp('^第\\s*'+_numPart+'\\s*節\\s*(.+)?');
  const articleRe = /^第\s*(\d+)\s*條\s*(?:[（(]([^）)]+)[）)])?(.*)$/;

  // 中文數字→阿拉伯數字
  const zh2num = (s) => {
    const map={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
               '十':10,'百':100,'千':1000};
    if(/^\d+$/.test(s)) return parseInt(s);
    let result=0, temp=0;
    for(const ch of s){
      const v=map[ch]; if(!v) continue;
      if(v>=10){result+=(temp||1)*v;temp=0;}else temp=v;
    }
    return result+temp;
  };

  // 格式化層級名稱（「第N編/章/節 名稱」→ 標準格式）
  const fmtLevel = (type, num, name) => {
    // 去除中文數字間的空格再轉換（如「十 三」→「十三」→13）
    const cleanNum = typeof num==='string' ? num.replace(/\s+/g,'') : num;
    const n = zh2num(cleanNum);
    const s = name ? name.trim() : '';
    return '第'+n+type+(s?' '+s:'');
  };

  // 儲存目前條文
  const saveArticle = () => {
    if(curArtNum===null) return;
    const content = contentLines.join('\n').trim();
    if(!content && !curTitle) return;
    const artNum = parseInt(curArtNum, 10);
    items.push({
      lawName:       lawName||'',
      article:       '第 '+artNum+' 條',  // 顯示用
      articleNumber: artNum,               // 數字排序用
      title:         curTitle||'',
      content:       content||curTitle||'',
      category:      category||'statute',
      part:          curPart||'',          // 編
      chapter:       curChapter||'',       // 章
      section:       curSection||'',       // 節
      source:        source||'',
      keywords:      [],
      relatedLaws:   [],
      favorite:      false,
      createdAt:     Date.now(),
    });
    curArtNum=null; curTitle=''; contentLines=[];
  };

  for(const line of lines){
    // ── 編（最優先）──────────────────────────────────────
    const pM = line.match(partRe);
    if(pM){ saveArticle(); curPart=fmtLevel('編',pM[1],pM[2]); curChapter=''; curSection=''; continue; }

    // ── 章 ───────────────────────────────────────────────
    const chM = line.match(chapterRe);
    if(chM){ saveArticle(); curChapter=fmtLevel('章',chM[1],chM[2]); curSection=''; continue; }

    // ── 節 ───────────────────────────────────────────────
    const secM = line.match(sectionRe);
    if(secM){ saveArticle(); curSection=fmtLevel('節',secM[1],secM[2]); continue; }

    // ── 條號（只認阿拉伯數字）────────────────────────────
    const artM = line.match(articleRe);
    if(artM){
      saveArticle();
      curArtNum = artM[1];
      curTitle  = (artM[2]||'').trim();
      const tail = (artM[3]||'').trim();
      if(tail) contentLines.push(tail);
      continue;
    }

    // ── 條文內容（追加）──────────────────────────────────
    if(curArtNum!==null) contentLines.push(line);
  }
  saveArticle();
  return items;
}

function prevBulkLaw(){
  try{
  const text=document.getElementById('bl-text').value;
  const name=document.getElementById('bl-name').value.trim()||'未命名';
  const cat=document.getElementById('bl-cat').value;
  const src=document.getElementById('bl-src').value.trim();
  const items=parseLawText(text,name,cat,src);
  const prevEl=document.getElementById('bl-prev');
  if(!items.length){prevEl.innerHTML='<span style="color:var(--red)">無法解析，請確認格式（需有「第X條」）</span>';return;}

  // 三層結構統計
  const parts   =[...new Set(items.map(i=>i.part   ||'').filter(Boolean))];
  const chapters=[...new Set(items.map(i=>i.chapter||'').filter(Boolean))];
  const sections=[...new Set(items.map(i=>i.section||'').filter(Boolean))];

  // 顏色標籤
  const mkTag=(text,col,bg)=>'<span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600;color:'+col+';background:'+bg+';margin:2px 3px">'+esc(text)+'</span>';
  let html='<div style="font-size:12px;color:var(--t2);padding:6px 0">';
  html+='<span style="color:var(--t1);font-weight:600">共 '+items.length+' 條</span>　';

  if(parts.length){
    html+='<br><span style="color:var(--org);font-size:11px">📙 編：</span>';
    parts.forEach(p=>{ html+=mkTag(p,'var(--org)','var(--org2)'); });
  }
  if(chapters.length){
    html+='<br><span style="color:var(--pur);font-size:11px">📗 章：</span>';
    chapters.forEach(c=>{ html+=mkTag(c,'var(--pur)','var(--pur2)'); });
  }
  if(sections.length){
    html+='<br><span style="color:var(--acc);font-size:11px">📘 節：</span>';
    sections.forEach(s=>{ html+=mkTag(s,'var(--acc)','rgba(31,111,235,0.15)'); });
  }

  // 前5條預覽
  html+='<br style="margin:3px 0"><span style="font-size:11px">前5條：</span>';
  items.slice(0,5).forEach(i=>{
    const hier=[i.part,i.chapter,i.section].filter(Boolean).pop()||'';
    html+='<span style="color:var(--t1);font-size:11px;margin-right:8px">'+esc(i.article)+(i.title?'（'+esc(i.title)+'）':'')+'</span>';
  });
  if(items.length>5) html+='<span style="color:var(--t2);font-size:11px">…</span>';
  html+='</div>';
  prevEl.innerHTML=html;
  }catch(e){logError('prevBulkLaw',e);}
}

async function importBulkLaw(){  try{
  const text=document.getElementById('bl-text').value;
  if(!text.trim()){toast('請貼入法條文字');return;}
  const name=document.getElementById('bl-name').value.trim()||'未命名';
  const cat=document.getElementById('bl-cat').value;
  const src=document.getElementById('bl-src').value.trim();
  const items=parseLawText(text,name,cat,src);
  if(!items.length){toast('解析結果為0條，請確認格式（需有「第X條」）');return;}
  // ── 防重複：以法律名稱+類別 判斷是否已存在 ──────────────────
  const existing=await da('laws');
  const sameGroup=existing.filter(l=>l.lawName===name&&l.category===cat);
  if(sameGroup.length>0){
    const go=confirm('「'+name+'」（'+cat+'）已有 '+sameGroup.length+' 條資料。\n\n確定 → 覆蓋（刪除舊資料再匯入）\n取消 → 取消匯入');
    if(!go) return;
    // 刪除舊資料
    for(const l of sameGroup) await dd('laws',l.id);
  }
  await bulkPut('laws',items);
  toast('已匯入 '+items.length+' 條法條 ✓');
  closeBulkLaw();
  renderDB();
  }catch(e){ logError('importBulkLaw',e); }}

async function showLawPop(ref){  try{
  if(!ref)return;
  const laws=await da('laws');
  const artM=ref.match(/第?(\d+)條?/);
  const artNum=artM?parseInt(artM[1]):null;
  const namePart=ref.replace(/第?\d+條?/,'').replace(/§\d+/,'').trim();

  // 只有法規名稱、沒有條號 → 直接跳到法規頁面
  if(artNum===null&&namePart){
    // 找資料庫裡最接近的法規名稱
    const allNames=[...new Set(laws.map(l=>l.lawName).filter(Boolean))];
    const exact=allNames.find(n=>n===namePart||namePart===n);
    const partial=allNames.find(n=>n.includes(namePart)||namePart.includes(n));
    const fuzzy=allNames.find(n=>{
      const cs=namePart.replace(/[法條例規則]/g,'').split('');
      return cs.length>=2&&cs.every(c=>n.includes(c));
    });
    const target=exact||partial||fuzzy;
    if(target){ openLawGroup(target); return; }
    // 找不到也跳頁面（讓 openLawGroup 顯示空狀態）
    openLawGroup(namePart); return;
  }
  let matched=laws.filter(l=>{
    const ln=l.lawName||'';
    let nm=!namePart||ln.includes(namePart)||namePart.includes(ln);
    if(!nm){
      const cs=namePart.replace(/[法條例規則]/g,'').split('');
      if(cs.length>=2)nm=cs.every(c=>ln.includes(c));
    }
    if(!nm)return false;
    return artNum===null||l.articleNumber===artNum;
  });
  if(matched.length>1){const ex=matched.filter(l=>(l.lawName||'').includes(namePart));if(ex.length)matched=ex;}
  const el=document.getElementById('lawpop-ov');if(!el)return;
  if(!matched.length){
    document.getElementById('lawpop-title').textContent=ref;
    document.getElementById('lawpop-body').innerHTML='<span style="color:var(--t2)">查無「'+esc(ref)+'」，請先在資料庫新增。</span>';
    document.getElementById('lawpop-related').innerHTML='';
    el.style.display='flex';return;
  }
  const l=matched[0];
  const isImg=l.content&&l.content.startsWith('data:image');
  document.getElementById('lawpop-title').textContent=(l.lawName||'')+' '+(l.article||'');
  document.getElementById('lawpop-body').innerHTML=isImg?'<img src="'+l.content+'" style="max-width:100%;border-radius:8px">':br(l.content||'');
  const rl=(l.relatedLaws||[]).map(r=>'<button class="chip" style="font-size:11px" onclick="showLawPop(\''+esc(r.ref||r.lawName||'')+'\')" >⚖ '+esc(r.ref||r.lawName||'')+'</button>').join('');
  document.getElementById('lawpop-related').innerHTML=rl?'<div style="margin-top:8px;font-size:12px;color:var(--t2)">關聯法條：</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">'+rl+'</div>':'';
  el.style.display='flex';
  }catch(e){ logError('showLawPop',e); }}
function closeLawPop(){ document.getElementById('lawpop-ov').style.display='none'; }
function autoDetectLawLinks(){}

// ── Shims ──
function openLawPopupByRef(ref){ showLawPop(ref); }
function showQLaws(){ toast('請在編輯題目中查看關聯法條'); }


function scrollToChapter(tagEl, encodedCh, typeHint){
  // 先用 typeHint 找，再依序嘗試，最後用舊格式
  const order = typeHint ? [typeHint,'part','chapter','section'] : ['part','chapter','section'];
  let el = null;
  for(const t of [...new Set(order)]){
    el = document.getElementById('ch-'+t+'-'+encodedCh);
    if(el) break;
  }
  if(!el) el = document.getElementById('ch-'+encodedCh);
  if(el){
    el.scrollIntoView({behavior:'smooth',block:'start'});
    const orig=el.style.background;
    el.style.transition='background .2s';
    el.style.background='var(--bg3)';
    setTimeout(()=>{ el.style.background=orig||''; },900);
  }
}

async function openChapterMgr(lawName){  try{
  const allLaws=await da('laws');
  const targets=allLaws.filter(l=>l.lawName===lawName)
    .sort((a,b)=>(a.articleNumber||0)-(b.articleNumber||0));
  if(!targets.length){toast('找不到法規');return;}

  // 現有結構
  const curParts    =[...new Set(targets.map(l=>l.part   ||'').filter(Boolean))];
  const curChapters =[...new Set(targets.map(l=>l.chapter||'').filter(Boolean))];
  const curSections =[...new Set(targets.map(l=>l.section||'').filter(Boolean))];
  const structInfo  =
    (curParts.length   ?'📙 編：'+curParts.join('、')+'\n':'')+
    (curChapters.length?'📗 章：'+curChapters.join('、')+'\n':'')+
    (curSections.length?'📘 節：'+curSections.join('、'):'');

  // 步驟1：選擇層級
  const levelInput=prompt(
    '【分層管理】目前結構：\n'+(structInfo||'（尚無分類）')+'\n\n'+
    '請選擇要設定的層級：\n'+
    '1 = 📙 編（最上層）→ 選哪些章屬於此編\n'+
    '2 = 📗 章（中層）→ 選哪些節屬於此章\n'+
    '3 = 📘 節（最下層）→ 設定條號範圍\n'+
    '輸入 1、2 或 3：'
  );
  if(!levelInput||!['1','2','3'].includes(levelInput.trim()))return;
  const lvIdx=parseInt(levelInput.trim())-1;
  const level    =['part','chapter','section'][lvIdx];
  const levelName=['編','章','節'][lvIdx];
  const childLevel    =['chapter','section',null][lvIdx];   // 編的子級=章，章的子級=節
  const childLevelName=['章','節',null][lvIdx];

  // 步驟2：輸入名稱
  const nameInput=prompt('請輸入'+levelName+'別名稱（如「第一'+levelName+' 總則」），留空取消：');
  if(!nameInput||!nameInput.trim())return;
  const newVal=nameInput.trim();

  let count=0;

  if(lvIdx===2||!childLevel){
    // 節：直接設定條號範圍
    const rangeInput=prompt(
      '套用範圍（格式：1-5 代表第1到5條）\n'+
      '留空則套用到所有未設節別的條文：'
    );
    let startArt=0,endArt=99999;
    if(rangeInput&&rangeInput.trim()){
      const rm=rangeInput.match(/(\d+)\s*[-~]\s*(\d+)/);
      if(rm){startArt=parseInt(rm[1]);endArt=parseInt(rm[2]);}
      else{const n=parseInt(rangeInput);if(!isNaN(n)){startArt=n;endArt=n;}}
    }
    for(const l of targets){
      const artN=l.articleNumber||0;
      const apply=rangeInput&&rangeInput.trim()?(artN>=startArt&&artN<=endArt):(!l[level]);
      if(apply){l[level]=newVal;await dp('laws',l);count++;}
    }
  } else {
    // 編/章：顯示現有子層級清單，讓使用者選哪些歸入
    const childList=lvIdx===0?curChapters:curSections; // 編選章，章選節
    if(!childList.length){
      // 子層級不存在，改用條號範圍
      const rangeInput=prompt(
        '目前尚無'+childLevelName+'別。\n'+
        '改用條號範圍（格式：1-5 代表第1到5條）\n'+
        '留空套用到所有未設'+levelName+'別的條文：'
      );
      let startArt=0,endArt=99999;
      if(rangeInput&&rangeInput.trim()){
        const rm=rangeInput.match(/(\d+)\s*[-~]\s*(\d+)/);
        if(rm){startArt=parseInt(rm[1]);endArt=parseInt(rm[2]);}
        else{const n=parseInt(rangeInput);if(!isNaN(n)){startArt=n;endArt=n;}}
      }
      for(const l of targets){
        const artN=l.articleNumber||0;
        const apply=rangeInput&&rangeInput.trim()?(artN>=startArt&&artN<=endArt):(!l[level]);
        if(apply){l[level]=newVal;await dp('laws',l);count++;}
      }
    } else {
      // 顯示子層級讓使用者選
      const listStr=childList.map((c,i)=>(i+1)+'. '+c).join('\n');
      const selInput=prompt(
        '請選擇要歸入「'+newVal+'」的'+childLevelName+'別：\n'+listStr+'\n\n'+
        '輸入序號（可多選，用逗號分隔，如「1,3」）\n'+
        '或直接輸入條號範圍（如「1-20」）：'
      );
      if(!selInput||!selInput.trim())return;
      const sel=selInput.trim();
      if(/^\d+[-~]\d+$/.test(sel)){
        // 條號範圍
        const rm=sel.match(/(\d+)\s*[-~]\s*(\d+)/);
        const startArt=parseInt(rm[1]),endArt=parseInt(rm[2]);
        for(const l of targets){
          const artN=l.articleNumber||0;
          if(artN>=startArt&&artN<=endArt){l[level]=newVal;await dp('laws',l);count++;}
        }
      } else {
        // 序號選擇
        const idxList=sel.split(/[,，]/).map(s=>parseInt(s.trim())-1).filter(i=>!isNaN(i)&&i>=0&&i<childList.length);
        const selected=idxList.map(i=>childList[i]);
        if(!selected.length){toast('未選擇任何項目');return;}
        for(const l of targets){
          if(selected.includes(l[childLevel]||'')){l[level]=newVal;await dp('laws',l);count++;}
        }
      }
    }
  }

  toast('已套用「'+newVal+'」('+levelName+'）到 '+count+' 條');
  openLawGroup(lawName);
  }catch(e){ logError('openChapterMgr',e); }}

// ══ browse.js — 題目閱覽 + 主題群組 ═══════════════════════
// 依賴：db.js, utils.js

let _browseQs=[];

async function openBrowse(){  try{
  window._brType=window._brType||'all';
  _browseQs=await da('questions');
  const subs=[...new Set(_browseQs.map(q=>q.subject).filter(Boolean))].sort();
  const chEl=document.getElementById('br-chips');
  if(chEl) chEl.innerHTML=
    '<button class="chip on" onclick="setBrFilter(this,\'all\')">全部科目</button>'+
    subs.map(s=>'<button class="chip" onclick="setBrFilter(this,\''+esc(s)+'\')">'+esc(s)+'</button>').join('');
  const years=[...new Set(_browseQs.map(q=>q.year).filter(Boolean))].sort().reverse();
  const yrEl=document.getElementById('br-year-chips');
  if(yrEl) yrEl.innerHTML=
    '<button class="chip on" onclick="setBrYear(this,\'\')">全部年度</button>'+
    years.map(y=>'<button class="chip" onclick="setBrYear(this,\''+esc(y)+'\')">'+esc(y)+'</button>').join('');
  window._brFilter='all'; window._brYear='';
  const kwEl=document.getElementById('br-search');
  if(kwEl) kwEl.value='';
  browseSearch();
  document.getElementById('browse-ov').style.display='flex';
  }catch(e){ logError('openBrowse',e); }}

function closeBrowse(){ document.getElementById('browse-ov').style.display='none'; }

function setBrFilter(el,v){
  document.querySelectorAll('#br-chips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on'); window._brFilter=v; browseSearch();
}
function setBrYear(el,v){
  document.querySelectorAll('#br-year-chips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on'); window._brYear=v; browseSearch();
}
function setBrType(el, typeFilter){
  document.querySelectorAll('#br-type-all,#br-type-mc,#br-type-es').forEach(b=>{if(b)b.classList.remove('on');});
  el.classList.add('on');
  window._brType=typeFilter;
  renderBrowseList();
}

function browseSearch(){ renderBrowseList(); }
const _debouncedBrowseSearch=debounce(browseSearch,200);


// ── 搜尋關鍵概念反白輔助 ────────────────────────────────────
function _hl(text, kw){
  if(!kw||!text) return esc(text||'');
  const escaped_kw = kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re = new RegExp('('+escaped_kw+')','gi');
  return esc(text).replace(re,'<mark style="background:rgba(212,164,56,0.35);color:var(--org);border-radius:2px;padding:0 1px">$1</mark>');
}

function renderBrowseList(){
  const kw=(document.getElementById('br-search')?.value||'').toLowerCase().trim();
  const f=window._brFilter||'all';
  const yr=window._brYear||'';
  const typeF=window._brType||'all';
  let fl=_browseQs.filter(q=>{
    if(typeF!=='all'&&q.type!==typeF) return false;
    if(f!=='all'&&q.subject!==f) return false;
    if(yr&&q.year!==yr) return false;
    if(kw){
      const h=((q.stem||'')+(q.subject||'')+(q.year||'')+(q.keywords||[]).join(' ')+(q.tags||[]).join(' ')).toLowerCase();
      if(!h.includes(kw)) return false;
    }
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  const el=document.getElementById('br-list');
  if(!el) return;
  if(!fl.length){
    el.innerHTML='<div class="empty"><span class="ic">🔍</span><span>沒有符合的題目</span></div>';
    return;
  }
  el.innerHTML=fl.map(q=>{
    const rl=(q.relatedLaws||[]).map(l=>
      '<span class="tag" style="color:var(--pur);cursor:pointer" onclick="showLawPop(\''+esc(l.ref||l.lawName||'')+'\')" >⚖ '+esc(l.ref||l.lawName||'')+'</span>'
    ).join('');
    const opts=q.type==='mc'?Object.entries(q.options||{}).map(([k,v])=>
      '<div style="font-size:12px;color:var(--t2);padding:1px 0">('+k+') '+_hl(v,kw)+'</div>'
    ).join(''):'';
    const kwTags=(q.keywords||[]).length
      ?'<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px">'
        +(q.keywords||[]).map(k=>'<span class="tag" style="color:var(--pur);font-size:10px">'+_hl(k,kw)+'</span>').join('')
        +'</div>':'';
    return '<div class="card" style="margin:5px 12px">'
      +'<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;flex-wrap:wrap">'
        +'<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'
        +'<span class="tag">'+_hl(q.subject||'未分類',kw)+'</span>'
        +(q.year?'<span class="tag">'+esc(q.year)+'</span>':'')
        +(q.exam?'<span class="tag">'+esc(q.exam)+'</span>':'')
        +(q.num?'<span class="tag">第'+esc(q.num)+'題</span>':'')
        +(q.starred?'<span style="color:var(--org)">⭐</span>':'')
        +(q.reviewLevel!==undefined?'<span class="tag" style="color:var(--acc)">Lv'+q.reviewLevel+'</span>':'')
      +'</div>'
      +'<div style="font-size:14px;line-height:1.65;color:var(--t1);margin-bottom:6px;word-break:break-all">'+_hl(q.stem||'',kw)+'</div>'
      +opts
      +kwTags
      +(q.answer?'<div style="font-size:12px;color:var(--grn);margin-top:4px;font-weight:600">答案：'+esc(q.answer)+'</div>':'')
      +(q.answerEs?'<div style="font-size:12px;color:var(--t2);margin-top:3px">解析：'+_hl((q.answerEs||'').slice(0,80),kw)+((q.answerEs||'').length>80?'…':'')+'</div>':'')
      +(rl?'<div style="margin-top:6px">'+rl+'</div>':'')
    +'</div>';
  }).join('');
}

// ══ bulk.js — 大量貼題 ════════════════════════════════
async function startNumberMode(){  try{
  const qs=await da('questions');
  const pool=(qs||[]).filter(q=>q.type==='mc'&&q.isNumberQ);
  if(!pool.length){toast('請先在題目編輯中勾選「數字魔鬼」題目');return;}
  toast('數字魔鬼：共 '+pool.length+' 題');
  startQWithPool(pool,'number');
  }catch(e){ logError('startNumberMode',e); }}

// ── Cloze 挖空模式 ─────────────────────────────────────────
function startClozeLaw(content, lawName){
  var cloze=generateCloze(content||'', 0.35);
  var el=document.getElementById('lbody');
  if(!el) return;
  var parts=cloze.split('【　　　】');
  var html='<div style="padding:12px">'
    +'<div style="font-size:12px;color:var(--org);margin-bottom:8px">📝 挖空練習 — 試著填入空白</div>'
    +'<div style="font-size:15px;line-height:2.2;color:var(--t1)">';
  for(var i=0;i<parts.length;i++){
    html+=esc(parts[i]);
    if(i<parts.length-1)
      html+='<span style="display:inline-block;min-width:60px;border-bottom:2px solid var(--pur);margin:0 4px">&nbsp;</span>';
  }
  html+='</div>';
  el.innerHTML=html;
  var btn=document.createElement('button');
  btn.className='btn bg bw';
  btn.style.cssText='margin-top:12px;padding:12px';
  btn.textContent='📖 顯示原文';
  btn.onclick=function(){ openLawGroup(lawName||''); };
  el.appendChild(btn);
}


// ══ bulk.js — 大量貼題 ════════════════════════════════
// 依賴：db.js, utils.js, parser.js

function parseBulk(){
  try{
    const biEl=document.getElementById('bi-text');
    if(!biEl){toast('找不到輸入框');return;}
    const text=biEl.value||'';
    if(!text.trim()){toast('請先在下方文字框貼入題目文字');return;}
    const parsed=parseBulkText(text);
    S.bulkParsed=parsed;
    // 套用答案列
    const ansStr=(document.getElementById('bi-ans')||{}).value||'';
    const ansMap=parseAnswerStr(ansStr);
    // 讀取編/章/節（批次套用到所有題目）
    const biPart   =(document.getElementById('bi-part'   )||{}).value||'';
    const biChapter=(document.getElementById('bi-chapter')||{}).value||'';
    const biSection=(document.getElementById('bi-section')||{}).value||'';
    parsed.forEach((q,i)=>{
      const n=parseInt(q.num)||i+1;
      if(ansMap[n]) q.answer=ansMap[n];
      if(biPart)    q.part   =biPart.trim();
      if(biChapter) q.chapter=biChapter.trim();
      if(biSection) q.section=biSection.trim();
    });
    const mc=parsed.filter(q=>q.type==='mc').length;
    const es=parsed.filter(q=>q.type==='es').length;
    const noAns=parsed.filter(q=>q.type==='mc'&&!q.answer).length;
    // 編/章/節標籤
    const hierTags=
      (biPart   ?'<span class="tag" style="background:var(--org2);color:var(--org);font-weight:700">📙'+biPart   +'</span>':'')+
      (biChapter?'<span class="tag" style="background:var(--pur2);color:var(--pur);font-weight:700">📗'+biChapter+'</span>':'')+
      (biSection?'<span class="tag" style="background:rgba(31,111,235,0.15);color:var(--acc);font-weight:700">📘'+biSection+'</span>':'');
    // 顯示統計
    const statsEl=document.getElementById('bulk-stats');
    if(statsEl) statsEl.innerHTML=
      '<span class="tag" style="background:var(--acc2);color:#fff">'+parsed.length+' 題</span>'+
      '<span class="tag" style="background:#1f3a5f;color:var(--acc)">選擇 '+mc+'</span>'+
      '<span class="tag" style="background:var(--red2);color:var(--red)">申論 '+es+'</span>'+
      (noAns?'<span class="tag" style="background:var(--org2);color:var(--org)">⚠ '+noAns+' 題未填答案</span>':'')+
      (hierTags?'<div style="margin-top:4px">'+hierTags+'</div>':'');
    // 顯示預覽（含編/章/節標籤）
    const prevEl=document.getElementById('prev-list');
    if(prevEl) prevEl.innerHTML=parsed.map(function(q){
      const typeLabel=q.type==='mc'?'選擇題':'申論題';
      const ansLabel=q.answer?' · 答案:'+q.answer:'';
      const optLabel=q.type==='mc'?'<div class="pi-o">選項：'+Object.keys(q.options).join(' ')+'</div>':'';
      const cls=q.answer||q.type==='es'?'ok':'warn';
      const hierLabel=
        (q.part   ?'<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:var(--org2);color:var(--org)">📙'+esc(q.part)+'</span> ':'')+
        (q.chapter?'<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:var(--pur2);color:var(--pur)">📗'+esc(q.chapter)+'</span> ':'')+
        (q.section?'<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:rgba(31,111,235,0.15);color:var(--acc)">📘'+esc(q.section)+'</span> ':'');
      return '<div class="pi '+cls+'">'+
        '<div class="pi-n">第'+q.num+'題 · '+typeLabel+ansLabel+'</div>'+
        (hierLabel?'<div style="margin-top:2px">'+hierLabel+'</div>':'')+
        '<div class="pi-s">'+esc(q.stem||'')+'</div>'+
        optLabel+'</div>';
    }).join('');
    // 顯示結果區
    const resEl=document.getElementById('bulk-result');
    if(resEl) resEl.classList.remove('hide');
    if(!parsed.length) toast('解析結果為0題，請確認格式');
    else toast('解析完成：'+parsed.length+' 題 ✓');
  }catch(err){
    toast('解析錯誤：'+err.message);
    console.error('parseBulk error:',err);
  }
}

async function importBulk(){
  if(!S.bulkParsed.length){toast('請先解析題目');return;}
  const sub=(document.getElementById('bi-sub')||{}).value||'';
  const yr=(document.getElementById('bi-yr')||{}).value||'';
  const ex=(document.getElementById('bi-ex')||{}).value||'';
  const items=S.bulkParsed.map(q=>({
    ...q,
    subject: sub||q.subject||'',
    year:    yr||q.year||'',
    exam:    ex||q.exam||'',
    searchBlob: ((q.stem||'')+' '+(sub||q.subject||'')+' '+(q.keywords||[]).join(' ')).toLowerCase(),
  }));
  try{
    // ── 防重複：以年度+考試別+科目+題號 判斷 ──────────────────
    const existing=await da('questions');
    const dupKey=q=>(q.year||'')+'|'+(q.exam||'')+'|'+(q.subject||'')+'|'+(q.num||'');
    const existSet=new Set(existing.map(dupKey));
    const dupItems=items.filter(q=>existSet.has(dupKey(q)));
    if(dupItems.length>0){
      const go=confirm('發現 '+dupItems.length+' 題已存在（相同年度+考試別+科目+題號）。\n\n確定 → 全部匯入（保留原有）\n取消 → 略過重複，只匯入 '+(items.length-dupItems.length)+' 題');
      if(!go){
        const newItems=items.filter(q=>!existSet.has(dupKey(q)));
        if(!newItems.length){toast('無新題目可匯入');return;}
        await bulkPut('questions',newItems);
        toast('已匯入 '+newItems.length+' 題（略過 '+dupItems.length+' 筆重複）✓');
        S.bulkParsed=[];
        document.getElementById('bulk-result').classList.add('hide');
        renderHome(); return;
      }
    }
    await bulkPut('questions',items);
    toast('已匯入 '+items.length+' 題 ✓');
    S.bulkParsed=[];
    document.getElementById('bulk-result').classList.add('hide');
    renderHome();
  }catch(err){ toast('匯入失敗：'+err.message); }
}

function clearBulk(){
  document.getElementById('bi-text').value='';
  document.getElementById('bi-ans').value='';
  const biPart=document.getElementById('bi-part'); if(biPart) biPart.value='';
  const biCh=document.getElementById('bi-chapter'); if(biCh) biCh.value='';
  const biSec=document.getElementById('bi-section'); if(biSec) biSec.value='';
  document.getElementById('bulk-result').classList.add('hide');
  S.bulkParsed=[];
}


