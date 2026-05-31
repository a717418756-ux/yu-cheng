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

