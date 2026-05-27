/* ═══════════════════════════════════════════════════════════════
   DATABASE / LAW LIBRARY  (dblib.js)
   資料庫（法條管理）— 完全重寫，單一職責
   依賴：app.js 的 da/dg/dp/dd/dc/bulkPut/esc/Toast/S
═══════════════════════════════════════════════════════════════ */

/* ── 狀態 ──────────────────────────────────────────────────── */
const DB_STATE = {
  lawCat:   'all',
  lawSort:  'name',        // 'name' | 'amend' | 'count'
  kw:       '',
};

/* ══════════════════════════════════════════════════════════════
   資料庫清單  renderDB
══════════════════════════════════════════════════════════════ */
async function renderDB(){
  try{
    const ls = await da('laws');
    const kw = DB_STATE.kw || ($el('lsi')?.value||'').toLowerCase().trim();

    /* ── §N 精確搜尋 ── */
    let kwLaw='', kwArt='', kwText=kw;
    const secM = kw.match(/^(.*?)§\s*(\d+)\s*$/);
    if(secM){ kwLaw=secM[1].trim().toLowerCase(); kwArt=secM[2]; kwText=''; }

    /* ── 篩選 ── */
    const fl = ls.filter(l=>{
      if(DB_STATE.lawCat!=='all' && l.category!==DB_STATE.lawCat) return false;
      if(!kw) return true;
      if(kwArt){
        const nm = !kwLaw || (l.lawName||'').toLowerCase().includes(kwLaw);
        const am = String(l.articleNumber||'')===kwArt ||
                   (l.article||'').replace(/\s/g,'').includes('第'+kwArt+'條');
        return nm && am;
      }
      const h=((l.lawName||'')+(l.article||'')+(l.title||'')+(l.content||'')+(l.keywords||[]).join(' ')).toLowerCase();
      return h.includes(kwText);
    });

    const el = $el('llist');
    if(!fl.length){
      el.innerHTML='<div class="empty"><span class="ic">🗄</span><span>尚無資料</span></div>';
      return;
    }

    /* ── 依法規名稱分組 ── */
    const byName = {};
    fl.forEach(l=>{ const n=l.lawName||'未分類'; (byName[n]=byName[n]||[]).push(l); });

    /* ── 排序 ── */
    const sorted = Object.entries(byName).sort((a,b)=>{
      if(DB_STATE.lawSort==='amend'){
        const toD=s=>{if(!s)return'';const m=s.match(/民國(\d+)年(\d+)月(\d+)日/);return m?String(+m[1]+1911)+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'):s;};
        return toD(b[1][0]?.amendDate||'').localeCompare(toD(a[1][0]?.amendDate||''));
      }
      if(DB_STATE.lawSort==='count') return b[1].length-a[1].length;
      return a[0].localeCompare(b[0],'zh-TW');
    });

    /* ── 無限捲動渲染 ── */
    const PAGE=50; let page=0;
    el.innerHTML='';

    const mkCard = ([name, laws])=>{
      const cat=laws[0].category||'statute';
      const catLabel={'statute':'法規條文','sop':'SOP','supplement':'補充資料','interpretation':'函釋'}[cat]||cat;
      const icon=cat==='sop'?'📋':cat==='supplement'?'📄':'⚖';
      const favN=laws.filter(l=>l.favorite).length;
      const orgLine=(laws[0]?.org||laws[0]?.amendDate)
        ?'<div style="font-size:10px;color:var(--t2);margin-top:1px">'
          +(laws[0].org?'🏛 '+esc(laws[0].org):'')
          +(laws[0].org&&laws[0].amendDate?' · ':'')
          +(laws[0].amendDate?'📅 '+esc(laws[0].amendDate):'')
          +'</div>'
        :'';
      const div=document.createElement('div');
      div.className='lw-card card';
      div.dataset.lawname=name;
      div.style.marginBottom='6px';
      div.innerHTML=
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span style="font-size:20px">'+icon+'</span>'+
          '<div style="flex:1">'+
            '<div style="font-size:15px;font-weight:700;color:var(--t0)">'+esc(name)+'</div>'+
            '<div style="font-size:11px;color:var(--t2);margin-top:2px">'+catLabel+' · '+laws.length+' 條'+(favN?' · ⭐'+favN:'')+'</div>'+
            orgLine+
          '</div>'+
          '<span style="color:var(--t2);font-size:18px">›</span>'+
          '<button class="lw-del" data-lawname="'+esc(name)+'" style="background:var(--red2);color:var(--red);border:1px solid var(--red);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;flex-shrink:0">🗑</button>'+
        '</div>';
      div.addEventListener('click',function(e){
        if(e.target.classList.contains('lw-del')) return;
        openLawGroup(this.dataset.lawname);
      });
      div.querySelector('.lw-del').addEventListener('click',function(e){
        e.stopPropagation();
        delLawGroup(this.dataset.lawname);
      });
      return div;
    };

    const loadMore=()=>{
      const batch=sorted.slice(page*PAGE,(page+1)*PAGE);
      if(!batch.length) return;
      const frag=document.createDocumentFragment();
      batch.forEach(entry=>frag.appendChild(mkCard(entry)));
      el.appendChild(frag);
      page++;
      const lc=$el('db-lc');
      if(lc){
        const total=sorted.length, shown=Math.min(page*PAGE,total);
        lc.textContent=shown<total?`顯示 ${shown}/${total}，繼續滑動`:`共 ${total} 筆`;
      }
    };
    loadMore();

    /* ── scroll ── */
    const pg=$el('pg-db')||$el('page-pg-db');
    const scroller=pg?.querySelector('.page')||pg;
    if(scroller){
      if(scroller._dbScroll) scroller.removeEventListener('scroll',scroller._dbScroll);
      const h=()=>{ if(scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<150) loadMore(); };
      scroller._dbScroll=h;
      scroller.addEventListener('scroll',h,{passive:true});
    }
  }catch(e){ logError('renderDB',e); }
}
function renderLaws(){ return renderDB(); }
const _debouncedRenderDB = debounce(renderDB, 220);

/* ── 篩選 / 排序 ─────────────────────────────────────────────── */
function setLawCat(cat,btn){
  DB_STATE.lawCat=cat;
  document.querySelectorAll('[onclick*="setLawCat"]').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderDB();
}
// 舊版相容
function setLC(el,cat){ setLawCat(cat,el); }

function setLSort(el,sort){
  document.querySelectorAll('#l-sort-name,#l-sort-amend,#l-sort-count').forEach(c=>c&&c.classList.remove('on'));
  if(el) el.classList.add('on');
  S.lawSort=sort; DB_STATE.lawSort=sort;
  renderDB();
}

/* ── openLawGroup ────────────────────────────────────────────── */
const LEVEL_STYLE = {
  part:    { color:'#1f6feb', border:'#1f6feb', bg:'rgba(31,111,235,0.18)',  size:'14px', fw:'800', pt:'10px', pb:'4px',  mt:'16px', ml:'0',   br:'0 8px 8px 0', bw:'4px', label:'編' },
  chapter: { color:'#58a6ff', border:'#58a6ff', bg:'rgba(88,166,255,0.13)',  size:'13px', fw:'700', pt:'7px',  pb:'3px',  mt:'10px', ml:'0',   br:'0 6px 6px 0', bw:'3px', label:'章' },
  section: { color:'#a5d6ff', border:'#a5d6ff', bg:'rgba(165,214,255,0.08)', size:'12px', fw:'600', pt:'4px',  pb:'2px',  mt:'5px',  ml:'18px',br:'0 4px 4px 0', bw:'2px', label:'節' },
};

async function openLawGroup(lawName){
  try{
    const allLaws = await da('laws');
    const kw = ($el('lsi')?.value||'').toLowerCase().trim();
    let kwLaw2='', kwArt2='', kwText2=kw;
    const sm = kw.match(/^(.*?)§\s*(\d+)\s*$/);
    if(sm){ kwLaw2=sm[1].trim().toLowerCase(); kwArt2=sm[2]; kwText2=''; }

    const laws = allLaws.filter(l=>{
      if(l.lawName!==lawName) return false;
      if(!kw) return true;
      if(kwArt2) return String(l.articleNumber||'')===kwArt2;
      const h=((l.article||'')+(l.title||'')+(l.content||'')).toLowerCase();
      return h.includes(kwText2);
    }).sort((a,b)=>(a.articleNumber||0)-(b.articleNumber||0));

    if(!laws.length) return;

    /* ── header ── */
    const cat=laws[0].category||'statute';
    const icon=cat==='sop'?'📋':cat==='supplement'?'📄':'⚖';
    const lvNameEl=$el('lv-name')||$el('lv-title');
    if(lvNameEl) lvNameEl.textContent=icon+' '+lawName;
    const lvSubEl=$el('lv-sub'); if(lvSubEl) lvSubEl.textContent='共 '+laws.length+' 條';
    const lvInfo=$el('lv-info');
    if(lvInfo){
      const s=laws[0]||{};
      lvInfo.textContent=(s.org?'🏛 '+s.org:'')+(s.org&&s.amendDate?' · ':'')+( s.amendDate?'📅 '+s.amendDate:'');
      lvInfo.style.display=(s.org||s.amendDate)?'block':'none';
    }
    const sb=$el('lv-star');
    if(sb){
      const favN=laws.filter(l=>l.favorite).length;
      sb.textContent=favN?'★':'☆';
      sb.style.color=favN?'var(--org)':'var(--t2)';
      sb.onclick=async()=>{
        const nf=laws.filter(l=>l.favorite).length>0;
        for(const l of laws){l.favorite=!nf;await dp('laws',l);}
        openLawGroup(lawName);
      };
    }

    /* ── 章節分組（有序） ── */
    const _seenP=new Set(),_seenC=new Set(),_seenS=new Set();
    const parts=[],chapters=[],sections=[];
    laws.forEach(l=>{
      if(l.part    &&!_seenP.has(l.part))   {_seenP.add(l.part);    parts.push(l.part);}
      if(l.chapter &&!_seenC.has(l.chapter)){_seenC.add(l.chapter); chapters.push(l.chapter);}
      if(l.section &&!_seenS.has(l.section)){_seenS.add(l.section); sections.push(l.section);}
    });
    const hasPart=parts.length>0, hasCh=chapters.length>0, hasSec=sections.length>0;

    /* ── 搜尋關鍵字高亮 ── */
    const _hlKw=($el('lsi')?.value||'').trim();
    const _hlRe=_hlKw&&!_hlKw.includes('§')
      ?new RegExp('('+_hlKw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi')
      :null;
    const _hl=text=>{
      const escaped=esc(text||'');
      if(!_hlRe) return escaped.replace(/\n/g,'<br>');
      return escaped.replace(_hlRe,m=>'<mark style="background:#d4a438;color:#121212;border-radius:2px;padding:0 2px">'+m+'</mark>').replace(/\n/g,'<br>');
    };

    /* ── 渲染標題 ── */
    const mkHeading=(type,text)=>{
      if(!text) return '';
      const s=LEVEL_STYLE[type]||LEVEL_STYLE.chapter;
      const id='ch-'+encodeURIComponent(type+'-'+text);
      return '<div id="'+id+'" style="font-size:'+s.size+';font-weight:'+s.fw+';color:'+s.color+
        ';padding:'+s.pt+' 14px '+s.pb+';margin-top:'+s.mt+';margin-left:'+s.ml+
        ';border-left:'+s.bw+' solid '+s.border+';background:'+s.bg+
        ';border-radius:'+s.br+';display:flex;align-items:center;gap:6px;letter-spacing:.4px;line-height:1.4">'+
        '<span style="opacity:.7;font-size:10px;font-weight:400;border:1px solid '+s.border+
          ';border-radius:3px;padding:0 4px;margin-right:2px">'+s.label+'</span>'+
        esc(text)+'</div>';
    };

    /* ── 渲染條文卡片 ── */
    const mkArtCard=l=>{
      const isImg=l.content&&l.content.startsWith('data:image');
      const contentHtml=isImg
        ?'<img src="'+l.content+'" style="max-width:100%;border-radius:8px;cursor:zoom-in" onclick="openImgViewer(this.src)">'
        :_hl(l.content||'');
      const kwHtml=(l.keywords||[]).length?'<div style="margin-top:8px">'+l.keywords.map(k=>'<span class="tag">'+esc(k)+'</span>').join('')+'</div>':'';
      const relHtml=(l.relatedLaws||[]).length
        ?'<div style="margin-top:9px;font-size:11px;color:var(--t2)">🔗 關聯法條：</div>'+
          l.relatedLaws.map(r=>'<button class="chip" style="font-size:11px;margin:2px" onclick="showLawPop(\''+esc(r.ref||r.lawName||'')+'\')">⚖ '+esc(r.ref||r.lawName||'')+'</button>').join('')
        :'';
      return '<div style="margin-bottom:12px;padding:12px;background:var(--bg2);border-radius:8px;border-left:3px solid var(--pur2)">'+
        '<div style="font-size:14px;font-weight:700;color:var(--acc);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">'+
          '<span>'+_hl(l.article||'')+(l.title?' — '+_hl(l.title):'')+'</span>'+
          '<div style="display:flex;gap:6px">'+
            '<button onclick="editLawInView('+l.id+')" style="background:none;border:none;color:var(--t2);font-size:12px;cursor:pointer">✏</button>'+
            '<button onclick="delLaw('+l.id+')" style="background:none;border:none;color:var(--red);font-size:12px;cursor:pointer">🗑</button>'+
          '</div>'+
        '</div>'+
        '<div style="font-size:14px;line-height:1.85;color:var(--t1)">'+contentHtml+'</div>'+
        kwHtml+relHtml+
      '</div>';
    };

    /* ── 主要渲染（一次遍歷） ── */
    let arts='';
    let lastP='__', lastC='__', lastS='__';
    laws.forEach(l=>{
      const p=l.part||'', c=l.chapter||'', s=l.section||'';
      if(hasPart  && p!==lastP){ if(p) arts+=mkHeading('part',p);    lastP=p; lastC='__'; lastS='__'; }
      if(hasCh    && c!==lastC){ if(c) arts+=mkHeading('chapter',c); lastC=c; lastS='__'; }
      if(hasSec   && s!==lastS){ if(s) arts+=mkHeading('section',s); lastS=s; }
      arts+=mkArtCard(l);
    });

    /* ── 章節快速跳轉列 ── */
    const chapterList=[
      ...parts.map(t=>({text:t,type:'part'})),
      ...chapters.map(t=>({text:t,type:'chapter'})),
      ...sections.map(t=>({text:t,type:'section'})),
    ];
    const chTagsHtml=chapterList.map(({text,type})=>{
      const s=LEVEL_STYLE[type]||LEVEL_STYLE.chapter;
      return '<span class="tag" style="color:'+s.color+';background:'+s.bg+';border:1px solid '+s.border+
        ';cursor:pointer;margin:2px;font-size:11px" onclick="scrollToChapter(this,\''+encodeURIComponent(text)+'\',\''+type+'\')">'+
        '<span style="opacity:.65;font-size:9px;border:1px solid '+s.border+';border-radius:3px;padding:0 3px;margin-right:3px">'+s.label+'</span>'+
        esc(text)+'</span>';
    }).join('');

    const chMgrBtn='<button onclick="openChapterMgr(window.currentLawName)" style="background:none;border:1px solid var(--bd);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--t2);margin-left:4px">⚙ 管理章節</button>';
    const chMgrBtnNew='<div style="margin-bottom:6px"><button onclick="openChapterMgr(window.currentLawName)" style="background:none;border:1px solid var(--bd);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--t2)">⚙ 新增章節分類</button></div>';
    const chapterMgmtHtml=chapterList.length
      ?'<div style="margin-bottom:8px"><div style="font-size:11px;color:var(--t2);margin-bottom:4px">章節：'+chTagsHtml+chMgrBtn+'</div></div>'
      :chMgrBtnNew;

    /* ── 其他法規快速跳轉 ── */
    const others=[...new Set(allLaws.map(l=>l.lawName).filter(Boolean))].filter(n=>n!==lawName).slice(0,8);
    const jumpHtml=others.map(n=>'<button class="chip" style="flex-shrink:0;font-size:11px" onclick="openLawGroup(\''+esc(n)+'\')">'+esc(n)+'</button>').join('');

    const lbodyEl=$el('lbody')||$el('lv-body');
    if(lbodyEl) lbodyEl.innerHTML=
      '<div style="padding:4px 0 10px">'+
      (others.length?'<div class="sec" style="padding:0 0 4px;font-size:11px">快速跳轉</div><div style="overflow-x:auto;display:flex;gap:6px;padding:6px 0">'+jumpHtml+'</div>':'')+
      '<div class="sec" style="padding:8px 0 6px;font-size:11px">'+esc(lawName)+' · '+laws.length+' 條</div>'+
      chapterMgmtHtml+
      arts+
      '</div>';

    window.currentLawName=lawName;
    window.currentLawContent=laws.map(l=>l.article+' '+l.content).join('\n');
    S.curLawName=lawName;
    $el('lv').style.display='flex';

  }catch(e){ logError('openLawGroup',e); }
}

/* ── 大量刪除法條 ────────────────────────────────────────────── */
async function openBulkDelLaw(){
  try{
    const ls=await da('laws');
    if(!ls.length){ toast('目前無法條資料'); return; }
    const names=[...new Set(ls.map(l=>l.lawName).filter(Boolean))].sort();
    const old=$el('bulk-del-law-modal'); if(old) old.remove();
    const modal=document.createElement('div');
    modal.id='bulk-del-law-modal';
    modal.style.cssText='position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;backdrop-filter:blur(3px)';
    modal.innerHTML=`
      <div onclick="event.stopPropagation()" style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:85vh;overflow-y:auto;border-top:1px solid var(--bd2)">
        <div style="width:36px;height:4px;background:var(--bg4);border-radius:2px;margin:0 auto 16px"></div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px">🗑 法條大量刪除</div>
        <div style="font-size:12px;color:var(--t2);margin-bottom:12px;line-height:1.6">依法律名稱刪除。<b style="color:var(--red)">刪除後無法復原。</b></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label style="font-size:12px;font-weight:600;color:var(--t2)">法律名稱</label>
            <input id="bdl-name" list="bdl-nl" placeholder="例：警察職權行使法（留空不限）" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px;margin-top:4px">
            <datalist id="bdl-nl">${names.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:var(--t2)">指定條號（逗號分隔，留空=刪除整部法）</label>
            <input id="bdl-arts" placeholder="例：1,2,10" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px;margin-top:4px">
          </div>
        </div>
        <div id="bdl-preview" style="margin-top:12px;font-size:12px;color:var(--t2)"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t1);font-size:13px;font-weight:600;cursor:pointer" onclick="document.getElementById('bulk-del-law-modal').remove()">取消</button>
          <button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t2);font-size:13px;font-weight:600;cursor:pointer" onclick="previewBulkDelLaw()">預覽</button>
          <button style="flex:1;padding:12px;border-radius:10px;background:var(--red);color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:none" onclick="confirmBulkDelLaw()">確認刪除</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }catch(e){ logError('openBulkDelLaw',e); }
}
async function previewBulkDelLaw(){
  const targets=_filterBulkDelLaw(await da('laws'));
  const el=$el('bdl-preview');
  if(el) el.innerHTML='<span style="color:var(--org)">符合條件：<b>'+targets.length+'</b> 條將被刪除</span>';
}
async function confirmBulkDelLaw(){
  try{
    const targets=_filterBulkDelLaw(await da('laws'));
    if(!targets.length){ toast('無符合條件的法條'); return; }
    if(!confirm('確定刪除 '+targets.length+' 條？此操作無法復原！')) return;
    for(const l of targets) await dd('laws',l.id);
    const m=$el('bulk-del-law-modal'); if(m) m.remove();
    toast('已刪除 '+targets.length+' 條 ✓');
    renderDB();
  }catch(e){ logError('confirmBulkDelLaw',e); }
}
function _filterBulkDelLaw(laws){
  const name=(document.getElementById('bdl-name')||{}).value?.trim()||'';
  const arts=(document.getElementById('bdl-arts')||{}).value?.trim()||'';
  const artSet=arts?new Set(arts.split(/[,，、\s]+/).map(n=>n.trim()).filter(Boolean)):null;
  return laws.filter(l=>{
    if(name && (l.lawName||'')!==name) return false;
    if(artSet && !artSet.has(String(l.articleNumber||''))) return false;
    return true;
  });
}
