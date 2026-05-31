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
  // 勉勵語：從 localStorage 讀取
  const mottoEl=document.getElementById('h-motto');
  if(mottoEl){
    const saved=localStorage.getItem('examMotto');
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
    data.correctStreak=ex?.correctStreak||0;
    data.difficultyScore=ex?.difficultyScore||5;
  }
  try{
    // 建立搜尋索引（加速搜尋）
    data.searchBlob=((data.stem||'')+' '+(data.subject||'')+' '+(data.keywords||[]).join(' ')).toLowerCase();
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


