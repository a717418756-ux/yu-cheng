// ══ data.js — 題目管理 + 法條資料庫 ═══════════════════════
// 依賴：db.js, utils.js, quiz.js(startQWithPool), stats.js, countdown.js
//
// v2.8.3 重構（保守第一階段）：
// - IIFE 包裝：頂層變數不再污染全域；邏輯與 v2.8.2 逐字相同
// - 刻意「不」加 'use strict'：圖片檢視器等處有沿用既有的隱式全域
//   （dragging/scale/tx/ty…），strict 會直接拋錯，留待第二階段逐一宣告
// - 公開 API 白名單見檔尾：含其他模組/index.html 引用 +
//   本檔動態 HTML onclick 依賴 + _debouncedRenderList/_debouncedRenderDB

(function(){

let _listSelMode = false;
const _listSelected = new Set();
let _dbSelMode = false;
const _dbSelected = new Set();
let _lvReadMode = false;
const _lawSortState = { key:'name', dir:1 };
// debounced 搜尋（需在頂部，HTML oninput 直接呼叫）
const _debouncedRenderList = debounce(()=>renderList(), 220);
const _debouncedRenderDB   = debounce(()=>renderDB(),   220);

const LEVEL_STYLE = {
  part: { color:'#1f6feb', border:'#1f6feb', bg:'rgba(31,111,235,0.18)', size:'14px', fw:'800', pt:'10px', pb:'4px', mt:'16px', ml:'0', br:'0 8px 8px 0', bw:'4px', label:'編' },
  chapter: { color:'#58a6ff', border:'#58a6ff', bg:'rgba(88,166,255,0.13)', size:'13px', fw:'700', pt:'7px', pb:'3px', mt:'10px', ml:'0', br:'0 6px 6px 0', bw:'3px', label:'章' },
  section: { color:'#a5d6ff', border:'#a5d6ff', bg:'rgba(165,214,255,0.08)', size:'12px', fw:'600', pt:'4px', pb:'2px', mt:'5px', ml:'18px', br:'0 4px 4px 0', bw:'2px', label:'節' },
};

// ══ questions.js — 題目管理 ════════════════════════════════
// 依賴：db.js, utils.js

let _dupResolve=null;

// ════════════════════════════════════════════════════════════
// 【首頁渲染與分區統計】
// ════════════════════════════════════════════════════════════
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
  // 今日任務 badges（精緻橫排，可點擊直接開始對應練習）
  const planEl=document.getElementById('h-plan-badges');
  if(planEl){
    const badges=[];
    if(reviewDue>0) badges.push(`<span class="plan-badge review" role="button" tabindex="0" onclick="startQ('review')" title="開始複習">待複習 ${reviewDue}</span>`);
    if(dangerQ>0)   badges.push(`<span class="plan-badge danger" role="button" tabindex="0" onclick="startQ('all')" title="從危險題開始">危險 ${dangerQ}</span>`);
    const nq=Math.min(newQ,10);
    if(nq>0)        badges.push(`<span class="plan-badge newq" role="button" tabindex="0" onclick="startQ('new')" title="練習新題">新題 ${nq}</span>`);
    if(estMin>0)    badges.push(`<span class="plan-badge time">約 ${estMin} 分鐘</span>`);
    if(!badges.length) badges.push(`<span class="plan-badge time">今日進度良好 ✓</span>`);
    planEl.innerHTML=badges.join('');
  }
  // 數據橫條（危險題、待複習）
  _set('hdb-danger',  dangerQ);
  _set('hdb-review',  reviewDue);

  // 熱力圖
  renderHeatmap();
  renderDtask().catch(()=>{});
  if(typeof renderPlan==='function') renderPlan().catch(()=>{});

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

  // ── 三大區即時資料（儀表板化）─────────────────────────────
  // 混合風格：考試看進度、休閒看最近閱讀、學習看今日時間
  renderZoneStats(qs, ats, reviewDue, todayAts_, todayStr).catch(()=>{});
  }catch(e){ logError('renderHome',e); }}

// ── 三大區 zone-desc 即時資料 ──────────────────────────────
async function renderZoneStats(qs, ats, reviewDue, todayAts, todayStr){
  const setDesc=(zoneId, text)=>{
    const el=document.querySelector(`#${zoneId} .zone-desc`);
    if(el) el.textContent=text;
  };
  try{
    // 考試區：看進度（待複習優先，否則今日答題，再否則題庫量）
    if(reviewDue>0)      setDesc('zone-exam', `待複習 ${reviewDue}・今日 ${todayAts} 題`);
    else if(todayAts>0)  setDesc('zone-exam', `今日已答 ${todayAts} 題 ✓`);
    else                 setDesc('zone-exam', `題庫 ${qs.length} 題待挑戰`);

    // 休閒區：看最近閱讀（取 ebooks 中 lastRead 最新者）
    const ebooks=await da('ebooks').catch(()=>[]);
    if(ebooks.length){
      const recent=ebooks
        .filter(b=>b.lastRead)
        .sort((a,b)=>(b.lastRead||0)-(a.lastRead||0))[0];
      if(recent){
        const title=recent.title||'未命名';
        setDesc('zone-leisure', `最近讀・${title.length>10?title.slice(0,10)+'…':title}`);
      } else {
        setDesc('zone-leisure', `藏書 ${ebooks.length} 本`);
      }
    } else {
      setDesc('zone-leisure', '放鬆・閱讀・電子書');
    }

    // 學習區：看今日時間（usageLogs 今日 study 秒數）
    const dayLogs=await getDayUsage(todayStr).catch(()=>[]);
    const studySec=dayLogs.filter(l=>l.zone==='study').reduce((s,l)=>s+(l.seconds||0),0);
    if(studySec>=60){
      setDesc('zone-study', `今日學習 ${Math.round(studySec/60)} 分鐘`);
    } else {
      const [rb,lm,em]=await Promise.all([
        da('refbooks').catch(()=>[]),
        da('learnmedia').catch(()=>[]),
        da('englishMaterials').catch(()=>[]),
      ]);
      const total=rb.length+lm.length+em.length;
      setDesc('zone-study', total>0?`教材 ${total} 份待學習`:'課程・音訊・碎片・複習');
    }
  }catch(e){ logError('renderZoneStats',e); }
}

// ── 熱力圖渲染 ───────────────────────────────────────────────
const _HM_COLS = 35;  // 顯示35天

// ════════════════════════════════════════════════════════════
// 【成長軌跡熱力圖】
// ════════════════════════════════════════════════════════════
async function renderHeatmap(){
  const grid = document.getElementById('heatmap-grid');
  if(!grid) return;

  const logs = await getUsageLogs(_HM_COLS);

  // 建立日期→秒數 map
  const dayMap = {};
  logs.forEach(l => {
    dayMap[l.date] = (dayMap[l.date] || 0) + (l.seconds || 0);
  });

  // 每日任務完成度（供綜合評分）
  let taskHist = {};
  try{
    if(typeof _getDtaskHistory === 'function') taskHist = await _getDtaskHistory();
  }catch(e){}

  // 絕對門檻：學習時間以 60 分鐘為達標基準（差→優反映實際努力，非相對比較）
  const TARGET_SEC = 60 * 60;

  const today_ = today();
  const cells = [];
  for(let i = _HM_COLS - 1; i >= 0; i--){
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const sec = dayMap[dateStr] || 0;
    // 時間分（0~1，60分鐘封頂）+ 任務分（0~1，當日完成比例）
    const timeScore = Math.min(1, sec / TARGET_SEC);
    const taskRec = taskHist[dateStr];
    const taskScore = taskRec ? (taskRec.r || 0) : 0;
    // 綜合：時間佔 6 成、任務佔 4 成
    const combined = timeScore * 0.6 + taskScore * 0.4;
    // 0 分=level0；其餘依綜合分映射 1~4 級
    const level = combined <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(combined * 4)));
    const isToday = dateStr === today_;
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd_ = String(d.getDate()).padStart(2,'0');
    cells.push({ dateStr, sec, level, isToday, label: `${mm}/${dd_}` });
  }

  grid.innerHTML = cells.map(c =>
    `<div class="hm-cell${c.isToday?' hm-today':''}"
      style="background:var(--hm${c.level})"
      title="${c.label}"
      onclick="openHeatmapOv('${c.dateStr}','${escJs(c.label)}')"></div>`
  ).join('');
}

// 開啟熱力圖日期視窗
// ════════════════════════════════════════════════════════════
// 【成長詳情彈窗（含運動數據）】
// ════════════════════════════════════════════════════════════
async function openHeatmapOv(dateStr, label){
  const ov  = document.getElementById('heatmap-ov');
  const ttl = document.getElementById('heatmap-ov-date');
  const body= document.getElementById('heatmap-ov-body');
  if(!ov||!ttl||!body) return;

  ttl.textContent = label + ' 成長詳情';
  body.innerHTML = '<div style="text-align:center;padding:16px;color:var(--t2);font-size:12px">載入中…</div>';
  ov.classList.add('on');

  const logs = await getDayUsage(dateStr);
  const ZONE_CFG = {
    exam:    { label:'考試區', color:'#6ea8fe' },
    leisure: { label:'休閒區', color:'#ffb340' },
    study:   { label:'成長區', color:'#4caf7d' },
  };

  if(!logs.length){
    body.innerHTML = '<div class="hm-ov-empty">📭 這天沒有記錄</div>';
    return;
  }

  const total = logs.reduce((s,l) => s + (l.seconds||0), 0);
  const fmt = s => s >= 3600
    ? `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`
    : `${Math.floor(s/60)}m ${s%60}s`;

  // 計算圓餅（SVG）
  const R = 52, CX = 64, CY = 64;
  let startAngle = -Math.PI / 2;
  const slices = logs.map(l => ({
    ...l, ...ZONE_CFG[l.zone],
    pct: (l.seconds||0) / total
  }));

  function polarToXY(angle){
    return [CX + R * Math.cos(angle), CY + R * Math.sin(angle)];
  }

  let svgPaths = '';
  slices.forEach(s => {
    const angle = s.pct * Math.PI * 2;
    const [x1,y1] = polarToXY(startAngle);
    const [x2,y2] = polarToXY(startAngle + angle);
    const large = angle > Math.PI ? 1 : 0;
    svgPaths += `<path d="M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z"
      fill="${s.color}" opacity="0.9"/>`;
    startAngle += angle;
  });

  const legendHTML = slices.map(s =>
    `<div class="hm-pie-item">
      <div class="hm-pie-dot" style="background:${s.color}"></div>
      <div class="hm-pie-label">${s.label}</div>
      <div class="hm-pie-val">${fmt(s.seconds||0)} (${Math.round(s.pct*100)}%)</div>
    </div>`
  ).join('');

  body.innerHTML = `
    <div class="hm-ov-total">總計 ${fmt(total)}</div>
    <div class="hm-pie-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128">
        ${svgPaths}
        <circle cx="${CX}" cy="${CY}" r="28" fill="var(--bg0)"/>
        <text x="${CX}" y="${CY}" text-anchor="middle" dominant-baseline="central"
          style="font-size:11px;fill:var(--t1);font-weight:700">${fmt(total)}</text>
      </svg>
      <div class="hm-pie-legend">${legendHTML}</div>
    </div>`;

  // 整合運動數據（當天運動時長 + 熱量結餘）
  try{
    if(typeof _getFitData === 'function'){
      const fit = await _getFitData(dateStr);
      const bal = (fit.intake||0) - (fit.burned||0);
      const balColor = bal > 0 ? '#e0a020' : '#4caf7d';
      const balSign = bal > 0 ? '+' : '';
      body.innerHTML += `
        <div class="hm-fit-section">
          <div class="hm-fit-title">運動健康</div>
          <div class="hm-fit-grid">
            <div class="hm-fit-item">
              <span class="hm-fit-val">${fit.activeMin||0}<small>分</small></span>
              <span class="hm-fit-lab">🏃 運動時長</span>
            </div>
            <div class="hm-fit-item">
              <span class="hm-fit-val" style="color:${balColor}">${balSign}${bal}<small>kcal</small></span>
              <span class="hm-fit-lab">⚖️ 熱量結餘</span>
            </div>
          </div>
        </div>`;
    }
  }catch(e){ /* 無運動數據不影響主視窗 */ }

  // 整合每日任務達成狀況（當天）
  try{
    if(typeof _getDtaskHistory === 'function' && typeof _dtaskAchieveIcon === 'function'){
      const hist = await _getDtaskHistory();
      const rec = hist[dateStr];
      if(rec && rec.tasks && rec.tasks.length){
        const doneN = rec.tasks.filter(t=>t.done).length;
        const tasksHtml = rec.tasks.map(t=>`
          <div class="hm-dt-task ${t.done?'done':'undone'}">
            <span class="hm-dt-tick">${t.done
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'}</span>
            <span class="hm-dt-text">${esc(t.text)}</span>
          </div>`).join('');
        body.innerHTML += `
          <div class="hm-dt-section">
            <div class="hm-dt-title">
              <span class="hm-dt-ic">${_dtaskAchieveIcon(rec.r)}</span>
              每日任務
              <span class="hm-dt-cnt">${doneN}/${rec.tasks.length}</span>
            </div>
            <div class="hm-dt-list">${tasksHtml}</div>
          </div>`;
      }
    }
  }catch(e){ /* 無任務資料不影響主視窗 */ }
}

function closeHeatmapOv(){
  const ov = document.getElementById('heatmap-ov');
  if(ov) ov.classList.remove('on');
}

function setF(el, f){
  document.querySelectorAll('#fchips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  S.filter = f;
  S.subF = 'all';  // 切換類型篩選時重置科目篩選
  renderList();
}


// ════════════════════════════════════════════════════════════
// 【題庫列表】
// ════════════════════════════════════════════════════════════
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
    if(kw){
      const h=(q.searchBlob||(q.stem||'')+(q.subject||'')+(q.keywords||[]).join(' ')).toLowerCase();
      // 多關鍵字 AND：空格分隔的每個詞都要出現（可跨欄位，順序不限）
      const terms=kw.split(/\s+/).filter(Boolean);
      if(!terms.every(t=>h.includes(t))) return false;
    }
    return true;
  }).sort((a,b)=>(b.year||'').localeCompare(a.year||'') || (a.subject||'').localeCompare(b.subject||''));

  const lcEl=document.getElementById('lc');
  if(lcEl) lcEl.textContent='共 '+fl.length+' 題';

  // 更新科目 chip
  // 科目 chip 只顯示目前篩選結果內的科目（不含關鍵字搜尋，以保留切換科目的意義）
  const subsBase=f==='all'&&!kw ? qs : fl;
  const subs=[...new Set(subsBase.map(q=>q.subject).filter(Boolean))].sort();
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

  const el=document.getElementById('qlist');
  if(!el) return;
  if(window._vlScroll){ window.removeEventListener('scroll',window._vlScroll); window._vlScroll=null; }
  el.innerHTML='';

  if(!fl.length){
    el.innerHTML='<div class="empty"><span class="ic">📭</span><span>尚無題目</span></div>';
    return;
  }

  // 有搜尋關鍵字時：直接顯示題目列表（不分組）
  if(kw){
    const PAGE=50; let page=0;
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
          +
        '</div>';
      div.dataset.qid = q.id;
      div.dataset.selkey = 'qid:'+q.id;
      return div;
    };
    const loadMore=()=>{
      const batch=fl.slice(page*PAGE,(page+1)*PAGE);
      if(!batch.length) return;
      batch.forEach(q=>el.appendChild(_mkQCard(q)));
      page++;
    };
    loadMore();
    if(fl.length>PAGE){
      window._vlScroll=()=>{ if(window.scrollY+window.innerHeight>=document.body.offsetHeight-200) loadMore(); };
      window.addEventListener('scroll',window._vlScroll);
    }
    return;
  }

  // 無搜尋：依年度分組（第一層），點進去才顯示科目
  const byYear={};
  fl.forEach(q=>{
    const yr = q.year||'未知年度';
    if(!byYear[yr]) byYear[yr]=[];
    byYear[yr].push(q);
  });

  Object.entries(byYear).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([yr, qs])=>{
    const wrong = qs.filter(q=>ws.has(q.id)).length;
    // 計算科目數
    const subjects = [...new Set(qs.map(q=>q.subject||'未分類'))];
    const div=document.createElement('div');
    div.className='qc';
    div.style.cursor='pointer';
    div.innerHTML=
      '<div class="qch">'+
        '<span class="tag" style="font-size:13px;font-weight:700">'+esc(yr)+'</span>'+
        '<span style="font-size:11px;color:var(--t2);margin-left:6px">'+subjects.length+' 科</span>'+
        '<span style="margin-left:auto;font-size:12px;color:var(--t2)">'+qs.length+' 題'+(wrong?' · <span style="color:var(--red)">'+wrong+' 錯</span>':'')+'</span>'+
        '<span style="color:var(--t2);margin-left:6px">›</span>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--t2);margin-top:4px">'+subjects.slice(0,4).map(s=>esc(s)).join('・')+(subjects.length>4?'…':'')+'</div>';
    div.dataset.selkey = 'yr:'+yr;
    div.onclick=()=>{ if(_listSelMode) return; openYearGroup(yr); };
    el.appendChild(div);
  });
}catch(e){ logError('renderList',e); }}

// ── 年度選擇頁（第二層）─────────────────────────────────────────
// ════════════════════════════════════════════════════════════
// 【題庫三層導覽（年度/科目）】
// ════════════════════════════════════════════════════════════
async function openYearGroup(year){  try{
  const [qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const ws=getWrong(qs,ats);
  const f=S.filter||'all';
  const sf=S.subF||'all';
  const fl=qs.filter(q=>{
    if((q.year||'未知年度')!==year) return false;
    if(f==='mc'&&q.type!=='mc') return false;
    if(f==='es'&&q.type!=='es') return false;
    if(f==='wrong'&&!ws.has(q.id)) return false;
    if(f==='star'&&!q.starred) return false;
    if(sf!=='all'&&q.subject!==sf) return false;
    return true;
  });
  const el=document.getElementById('qlist');
  if(!el) return;
  if(window._vlScroll){ window.removeEventListener('scroll',window._vlScroll); window._vlScroll=null; }
  el.innerHTML='';

  // 返回按鈕
  const backDiv=document.createElement('div');
  backDiv.className='list-back-row';
  const backBtn=document.createElement('button');
  backBtn.className='btn bg list-back-btn';
  backBtn.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg> 返回列表';
  backBtn.onclick=()=>{ _qGroupYear=''; _qGroupSubject=''; renderList(); };
  backDiv.appendChild(backBtn);
  el.appendChild(backDiv);

  // 科目分組
  const bySubject={};
  fl.forEach(q=>{
    const sub=q.subject||'未分類';
    if(!bySubject[sub]) bySubject[sub]=[];
    bySubject[sub].push(q);
  });
  const lcEl=document.getElementById('lc');
  if(lcEl) lcEl.textContent=year+' · '+Object.keys(bySubject).length+' 科 · '+fl.length+' 題';

  Object.entries(bySubject).sort((a,b)=>a[0].localeCompare(b[0],'zh-TW')).forEach(([sub,sqs])=>{
    const wrong=sqs.filter(q=>ws.has(q.id)).length;
    const div=document.createElement('div');
    div.className='qc';
    div.style.cursor='pointer';
    div.innerHTML=
      '<div class="qch">'+
        '<span class="tag">'+esc(sub)+'</span>'+
        '<span style="margin-left:auto;font-size:12px;color:var(--t2)">'+sqs.length+' 題'+(wrong?' · <span style="color:var(--red)">'+wrong+' 錯</span>':'')+'</span>'+
        '<span style="color:var(--t2);margin-left:6px">›</span>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--t2);margin-top:4px">'+
        esc((sqs[0]?.stem||'').slice(0,50))+(sqs.length>1?'…':'')+'</div>';
    div.dataset.selkey = 'sub:'+year+':'+sub;
    div.onclick=()=>{
      if(_listSelMode){ return; }
      openQGroup(year, sub);
    };
    el.appendChild(div);
  });
  if(_listSelMode) _applyListSelUI();
}catch(e){ logError('openYearGroup',e); }}

// ── 題目群組詳細頁 ────────────────────────────────────────────
let _qGroupYear='', _qGroupSubject='';
async function openQGroup(year, subject){  try{
  _qGroupYear=year; _qGroupSubject=subject;
  const [qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const ws=getWrong(qs,ats);
  const f=S.filter||'all';
  const fl=qs.filter(q=>{
    if((q.year||'未知年度')!==year) return false;
    if((q.subject||'未分類')!==subject) return false;
    if(f==='mc'&&q.type!=='mc') return false;
    if(f==='es'&&q.type!=='es') return false;
    if(f==='wrong'&&!ws.has(q.id)) return false;
    if(f==='star'&&!q.starred) return false;
    return true;
  }).sort((a,b)=>(a.id||0)-(b.id||0));

  const el=document.getElementById('qlist');
  if(!el) return;
  if(window._vlScroll){ window.removeEventListener('scroll',window._vlScroll); window._vlScroll=null; }

  // header：返回按鈕
  const lcEl=document.getElementById('lc');
  if(lcEl) lcEl.textContent=year+' · '+subject+' · '+fl.length+' 題';

  el.innerHTML='';
  // 返回按鈕區
  const backDiv=document.createElement('div');
  backDiv.className='list-back-row';
  const backBtn=document.createElement('button');
  backBtn.className='btn bg list-back-btn';
  backBtn.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg> 返回年度';
  backBtn.onclick=()=>openYearGroup(year);
  backDiv.appendChild(backBtn);
  el.appendChild(backDiv);

  const _mkQCard=(q)=>{
    const danger=getDangerLevel(q,ats);
    const div=document.createElement('div');
    div.className='qc'+(ws.has(q.id)?' wrong':'')+(q.starred?' star':'');
    div.dataset.selkey='qid:'+q.id;  // 勾選模式可選取（修正最底層無法勾選刪除）
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
      '</div>';
    return div;
  };

  fl.forEach(q=>el.appendChild(_mkQCard(q)));
  if(_listSelMode) _applyListSelUI();
}catch(e){ logError('openQGroup',e); }}



// ── 題目新增/編輯表單控制 ───────────────────────────────────
function closeAdd(){
  document.getElementById('add-ov').classList.remove('on');
  S.editId = null;
  S.qType = 'mc';
}

// ════════════════════════════════════════════════════════════
// 【新增/編輯題目表單】
// ════════════════════════════════════════════════════════════
function showAdd(q){
  S.editId = q?.id || null;
  S.qType = q?.type || 'mc';
  // 初始化答案為 Set（支援多選）
  S.correct = q?.answer ? new Set([...q.answer]) : new Set(['A']);
  const title = document.getElementById('add-title');
  if(title) title.textContent = q?.id ? '編輯題目' : '新增題目';
  // 編輯模式隱藏「連續新增」按鈕
  const contBtn = document.getElementById('btn-save-cont');
  if(contBtn) contBtn.style.display = q?.id ? 'none' : '';
  // 填入欄位
  const set = (id, v) => { const el=document.getElementById(id); if(el) el.value = v||''; };
  set('f-sub',  q?.subject||'');
  set('f-yr',   q?.year||'');
  set('f-num',  q?.num||'');
  set('f-stem', q?.stem||'');
  set('f-es',   q?.answerEs||'');
  set('f-kw',   (q?.keywords||[]).join('，'));
  set('f-must-kw', (q?.mustKeywords||[]).join('，'));
  set('f-note', q?.note||'');
  _setMarkRow('f-mark-row', q?.hlColor||'');
  set('f-laws', (q?.relatedLaws||[]).map(l=>l.ref).join('，'));
  const exEl = document.getElementById('f-ex');
  if(exEl) exEl.value = q?.exam||'';
  const isNum = document.getElementById('f-is-number');
  if(isNum) isNum.checked = q?.isNumberQ||false;
  // 題組
  const isGroup = document.getElementById('f-is-group');
  const groupWrap = document.getElementById('f-group-wrap');
  if(isGroup) isGroup.checked = !!(q?.groupStem);
  if(groupWrap) groupWrap.classList.toggle('hide', !q?.groupStem);
  set('f-group-stem', q?.groupStem||'');
  set('f-group-id',   q?.groupId||'');
  set('f-group-order', q?.groupOrder||'');
  setQT(S.qType, q?.options);
  // 更新科目 datalist
  da('questions').then(qs=>{
    const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
    const dl=document.getElementById('f-subs');
    if(dl){ dl.innerHTML=subs.map(s=>`<option value="${esc(s)}">`).join(''); }
  }).catch(()=>{});
  document.getElementById('add-ov').classList.add('on');
}

function setQT(type, opts){
  S.qType = type;
  if(!(S.correct instanceof Set) || S.correct.size===0) S.correct = new Set(['A']);
  const mc = document.getElementById('tmc');
  const es = document.getElementById('tes');
  const mcArea = document.getElementById('mc-opts');
  const esArea = document.getElementById('es-area');
  if(mc) mc.className = type==='mc' ? 'btn bp' : 'btn bg';
  if(es) es.className = type==='es' ? 'btn bp' : 'btn bg';
  if(mcArea) mcArea.style.display = type==='mc' ? '' : 'none';
  if(esArea) esArea.className = type==='es' ? 'fg' : 'fg hide';
  // 建立選項輸入框
  if(type==='mc'){
    const c = document.getElementById('opts-c');
    if(c){
      c.innerHTML = ['A','B','C','D','E'].map(k=>`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <button class="btn ${(S.correct instanceof Set?S.correct.has(k):S.correct===k)?'bp':'bg'}" style="width:32px;flex-shrink:0;padding:6px"
            onclick="setAns('${k}')">${k}</button>
          <input id="opt-${k}" class="inp" style="flex:1" placeholder="選項 ${k}"
            value="${esc(opts?.[k]||'')}">
        </div>`).join('');
    }
  }
}

function setAns(k){
  // 多選 toggle：S.correct 改為 Set
  if(!(S.correct instanceof Set)) S.correct = new Set(S.correct ? [...S.correct] : []);
  if(S.correct.has(k)) S.correct.delete(k); else S.correct.add(k);
  if(S.correct.size===0) S.correct.add('A'); // 至少要有一個答案
  ['A','B','C','D','E'].forEach(l=>{
    const btn = document.getElementById('opt-'+l)?.previousElementSibling;
    if(btn) btn.className = 'btn '+(S.correct.has(l)?'bp':'bg');
  });
}
function _getAnswerStr(){
  if(S.correct instanceof Set) return [...S.correct].sort().join('');
  return S.correct||'A';
}

function toggleGroupStem(){
  const checked = document.getElementById('f-is-group')?.checked;
  const wrap = document.getElementById('f-group-wrap');
  if(wrap) wrap.classList.toggle('hide', !checked);
}

// 年度輸入正規化（onblur）：全形數字→半形、移除「年/民國」字樣與空白
// 例：「１１３年」→「113」、「民國113」→「113」
function formatYearInput(el){
  if(!el) return;
  let v=(el.value||'').trim();
  if(!v) return;
  // 全形數字轉半形
  v=v.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  // 移除「民國」「年」與所有空白
  v=v.replace(/民國|年/g,'').replace(/\s+/g,'');
  el.value=v;
}

// ════════════════════════════════════════════════════════════
// 【題目儲存】
// ════════════════════════════════════════════════════════════
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
    answer:type==='mc'?_getAnswerStr():'',
    answerEs:document.getElementById('f-es')?.value.trim()||'',
    subject:document.getElementById('f-sub').value.trim(),
    year:document.getElementById('f-yr').value.trim(),
    exam:document.getElementById('f-ex').value,
    num:document.getElementById('f-num').value.trim(),
    keywords:kwArr(document.getElementById('f-kw').value),
    mustKeywords,
    tags:[],
    note:document.getElementById('f-note').value.trim(),
    hlColor:document.querySelector('#f-mark-row .note-mark-dot.sel')?.dataset.color||'',
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
    data.searchBlob=((data.stem||'')+' '+(data.groupStem||'')+' '+(data.subject||'')+' '+(data.year||'')+' '+(data.exam||'')+' '+(data.num||'')+' '+(data.keywords||[]).join(' ')).toLowerCase();
    await dp('questions',data);
    closeAdd();toast(S.editId?'題目已更新 ✓':'題目已儲存 ✓');
  }catch(e){
    logError('saveQ',e);
    toast('儲存失敗，請重試');
  }
  if(S.page==='list'){
    // 編輯後回到編輯前所在的層（第三層 → 回科目群組；否則回第一層）
    if(_qGroupYear && _qGroupSubject) openQGroup(_qGroupYear, _qGroupSubject);
    else renderList();
  } else renderHome();
  }catch(e){logError('saveQ',e);}}

async function editQ(id){  try{const q=await dg('questions',id);if(q)showAdd(q);  }catch(e){ logError('editQ',e); }}

// 儲存並連續新增：保留共用欄位，只清空題目內容與選項
async function saveQAndContinue(){  try{
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
  const isGroupChecked=document.getElementById('f-is-group')?.checked;
  const data={
    type,stem,options,
    answer:type==='mc'?_getAnswerStr():'',
    answerEs:document.getElementById('f-es')?.value.trim()||'',
    subject:document.getElementById('f-sub').value.trim(),
    year:document.getElementById('f-yr').value.trim(),
    exam:document.getElementById('f-ex').value,
    num:document.getElementById('f-num').value.trim(),
    note:document.getElementById('f-note').value.trim(),
    hlColor:document.querySelector('#f-mark-row .note-mark-dot.sel')?.dataset.color||'',
    isNumberQ:document.getElementById('f-is-number')?.checked||false,
    groupStem:(isGroupChecked&&document.getElementById('f-group-stem')?.value.trim())||'',
    groupId:(isGroupChecked&&document.getElementById('f-group-id')?.value.trim())||'',
    groupOrder:parseInt(document.getElementById('f-group-order')?.value)||0,
    relatedLaws,starred:false,createdAt:Date.now(),
    reviewLevel:0,nextReview:Date.now(),lastReview:null,
    wrongCount:0,correctStreak:0,difficultyScore:5
  };
  data.searchBlob=((data.stem||'')+' '+(data.groupStem||'')+' '+(data.subject||'')+' '+(data.year||'')+' '+(data.exam||'')+' '+(data.num||'')+' '+(data.keywords||[]).join(' ')).toLowerCase();
  await dp('questions',data);
  toast('已儲存 ✓ 繼續新增下一題');

  // 清空：題目內容、選項、正確答案、題號（題幹/題組/科目/年度等保留）
  const clr=(id)=>{ const el=document.getElementById(id); if(el) el.value=''; };
  clr('f-stem'); clr('f-es'); clr('f-num'); clr('f-note');
  ['A','B','C','D','E'].forEach(k=>clr('opt-'+k));
  S.correct=new Set(['A']); S.editId=null;
  // 更新選項 UI 選中狀態（重置為只選A）
  ['A','B','C','D','E'].forEach(l=>{
    const btn=document.getElementById('opt-'+l)?.previousElementSibling;
    if(btn) btn.className='btn '+(l==='A'?'bp':'bg');
  });
  // 題組序號自動遞增
  const orderEl=document.getElementById('f-group-order');
  if(orderEl && orderEl.value) orderEl.value=String((parseInt(orderEl.value)||0)+1);
  // 捲回頂部方便看到題幹
  document.getElementById('add-ov')?.querySelector('.sht')?.scrollIntoView({behavior:'smooth'});
}catch(e){logError('saveQAndContinue',e);toast('儲存失敗，請重試');}}
async function toggleStar(id){  try{
  const q=await dg('questions',id);if(!q)return;
  q.starred=!q.starred;await dp('questions',q);
  toast(q.starred?'已收藏 ⭐':'取消收藏');renderList();
  }catch(e){ logError('toggleStar',e); }}

// ── 題目選擇刪除模式 ──────────────────────────────────────────

// ════════════════════════════════════════════════════════════
// 【題庫批量勾選刪除】
// ════════════════════════════════════════════════════════════
function toggleListSelectMode(){
  _listSelMode = !_listSelMode;
  _listSelected.clear();
  const btn = document.getElementById('list-sel-btn');
  const bar = document.getElementById('list-sel-bar');
  if(btn){
    btn.style.background  = _listSelMode ? 'rgba(207,71,71,0.18)' : '';
    btn.style.borderColor = _listSelMode ? 'rgba(207,71,71,0.3)'  : '';
    btn.style.color       = _listSelMode ? '#e05c5c' : '';
  }
  if(bar) bar.style.display = _listSelMode ? 'flex' : 'none';
  _updateListSelCount();
  // 對當前畫面所有可勾選卡片套用/移除選擇模式 UI
  _applyListSelUI();
}

// 對畫面上所有 .qc[data-selkey] 卡片套用勾選 UI
function _applyListSelUI(){
  document.querySelectorAll('.qc[data-selkey]').forEach(card=>{
    const key = card.dataset.selkey; // 格式："yr:2024" 或 "sub:2024:刑法" 或 "qid:123"
    if(_listSelMode){
      if(!card.querySelector('.list-sel-chk')){
        const chk = document.createElement('span');
        chk.className='list-sel-chk';
        chk.textContent='☐';
        card.querySelector('.qch')?.prepend(chk);
      }
      card.style.cursor='pointer';
      card._origOnclick = card.onclick;
      card.onclick = e=>{
        if(e.target.closest('.qabn')) return;
        _toggleSelCard(key, card);
      };
    } else {
      card.querySelector('.list-sel-chk')?.remove();
      card.style.outline=''; card.style.background=''; card.style.cursor='';
      card.onclick = card._origOnclick||null;
      delete card._origOnclick;
    }
  });
}

// 切換一張卡片的勾選狀態（支援年度/科目/題目三種 key）
async function _toggleSelCard(key, card){
  // 解析 key 取得對應的題目 id 集合
  const getIds = async ()=>{
    const qs = await da('questions');
    if(key.startsWith('yr:')){
      const yr = key.slice(3);
      return qs.filter(q=>(q.year||'未知年度')===yr).map(q=>q.id);
    } else if(key.startsWith('sub:')){
      const [,yr,sub] = key.split(':');
      return qs.filter(q=>(q.year||'未知年度')===yr&&(q.subject||'未分類')===sub).map(q=>q.id);
    } else {
      return [+key.slice(4)]; // qid:123
    }
  };
  const ids = await getIds();
  const allSel = ids.every(id=>_listSelected.has(id));
  if(allSel){ ids.forEach(id=>_listSelected.delete(id)); }
  else       { ids.forEach(id=>_listSelected.add(id)); }
  // 更新這張卡片的外觀
  const nowSel = ids.every(id=>_listSelected.has(id));
  card.style.outline    = nowSel ? '2px solid var(--acc)' : '';
  card.style.background = nowSel ? 'rgba(88,166,255,0.08)' : '';
  const chk = card.querySelector('.list-sel-chk');
  if(chk) chk.textContent = nowSel ? '\u2611' : '\u2610';
  _updateListSelCount();
}

function _updateListSelCount(){
  const el = document.getElementById('list-sel-count');
  if(el) el.textContent = `已選 ${_listSelected.size} 題`;
}

async function confirmListSelDel(){
  if(!_listSelected.size){ toast('請先選取題目'); return; }
  if(!confirm(`確定刪除選取的 ${_listSelected.size} 題？`)) return;
  const ids=[..._listSelected];
  for(const id of ids) await dd('questions',id);
  toast(`已刪除 ${ids.length} 題`);
  _listSelMode=false; _listSelected.clear();
  const btn=document.getElementById('list-sel-btn');
  const bar=document.getElementById('list-sel-bar');
  if(btn){btn.style.background='';btn.style.borderColor='';btn.style.color='';}
  if(bar) bar.style.display='none';
  renderList();
}

async function openBulkDelQ(){  try{
  const qs=await da('questions');
  if(!qs.length){toast('目前無題目');return;}
  const years=[...new Set(qs.map(q=>q.year||'').filter(Boolean))].sort().reverse();
  const exams=[...new Set(qs.map(q=>q.exam||'').filter(Boolean))].sort();
  const subs=[...new Set(qs.map(q=>q.subject||'').filter(Boolean))].sort();
  const modal=document.createElement('div');
  modal.id='bulk-del-q-modal';
  modal.className='bulk-sel-ov';
  modal.innerHTML=`<div class="bulk-sel-panel"><div class="bulk-sel-handle"></div><div class="bulk-sel-title">☑ 依條件選取題目</div><div class="bulk-sel-desc">依條件自動勾選，套用後可在列表再調整，最後按「刪除選取」。</div><div class="bulk-sel-fields"><div><label class="fl">年度</label><input id="bdq-year" list="bdq-yl" placeholder="例：113（留空不限）"><datalist id="bdq-yl">${years.map(y=>`<option value="${y}">`).join('')}</datalist></div><div><label class="fl">考試別</label><input id="bdq-exam" list="bdq-el" placeholder="例：升官等（留空不限）"><datalist id="bdq-el">${exams.map(e=>`<option value="${e}">`).join('')}</datalist></div><div><label class="fl">科目</label><input id="bdq-sub" list="bdq-sl" placeholder="例：警察法規（留空不限）"><datalist id="bdq-sl">${subs.map(s=>`<option value="${s}">`).join('')}</datalist></div><div><label class="fl">指定題號（逗號分隔，留空選取所有符合條件）</label><input id="bdq-nums" placeholder="例：1,2,5,10"></div></div><div id="bdq-preview" class="bulk-sel-preview"></div><div class="bulk-sel-acts"><button class="btn bg" onclick="document.getElementById('bulk-del-q-modal').remove()">取消</button><button class="btn bg dim" onclick="previewBulkDelQ()">預覽</button><button class="btn bp" onclick="applyBulkSelectQ()">套用選取</button></div></div>`;
  document.body.appendChild(modal);
  }catch(e){ logError('openBulkDelQ',e); }}

async function previewBulkDelQ(){  try{
  const targets=_filterBulkDelQ(await da('questions'));
  const el=document.getElementById('bdq-preview');
  if(el) el.innerHTML='<span style="color:var(--acc)">符合條件：<b>'+targets.length+'</b> 題將被勾選</span>';
  }catch(e){ logError('previewBulkDelQ',e); }}

// 依條件自動勾選：把符合的題目加入選取集合，進入勾選模式供檢視後刪除
async function applyBulkSelectQ(){  try{
  const targets=_filterBulkDelQ(await da('questions'));
  if(!targets.length){toast('無符合條件的題目');return;}
  // 確保處於勾選模式
  if(!_listSelMode) toggleListSelectMode();
  targets.forEach(q=>_listSelected.add(q.id));
  const m=document.getElementById('bulk-del-q-modal');if(m)m.remove();
  _updateListSelCount();
  _applyListSelUI();
  toast('已勾選 '+targets.length+' 題，確認後按「刪除選取」');
  }catch(e){ logError('applyBulkSelectQ',e); }}

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
  modal.className='bulk-sel-ov';
  modal.innerHTML=`<div class="bulk-sel-panel"><div class="bulk-sel-handle"></div><div class="bulk-sel-title">☑ 依條件選取法規</div><div class="bulk-sel-desc">選擇法律名稱自動勾選整部法規，套用後可再調整，最後按「刪除選取」。</div><div class="bulk-sel-fields"><div><label class="fl">法律名稱</label><input id="bdl-name" list="bdl-nl" placeholder="例：警察職權行使法"><datalist id="bdl-nl">${names.map(n=>`<option value="${n}">`).join('')}</datalist></div></div><div id="bdl-preview" class="bulk-sel-preview"></div><div class="bulk-sel-acts"><button class="btn bg" onclick="document.getElementById('bulk-del-law-modal').remove()">取消</button><button class="btn bg dim" onclick="previewBulkDelLaw()">預覽</button><button class="btn bp" onclick="applyBulkSelectLaw()">套用選取</button></div></div>`;
  document.body.appendChild(modal);
  }catch(e){ logError('openBulkDelLaw',e); }}

async function previewBulkDelLaw(){  try{
  const name=(document.getElementById('bdl-name')||{}).value?.trim()||'';
  const laws=await da('laws');
  const matched=name?laws.filter(l=>(l.lawName||'')===name):laws;
  const lawNames=[...new Set(matched.map(l=>l.lawName||'').filter(Boolean))];
  const el=document.getElementById('bdl-preview');
  if(el) el.innerHTML='<span style="color:var(--acc)">符合：<b>'+lawNames.length+'</b> 部法規（共 '+matched.length+' 條）將被勾選</span>';
  }catch(e){ logError('previewBulkDelLaw',e); }}

// 依法律名稱自動勾選整部法規，進入勾選模式供檢視後刪除
async function applyBulkSelectLaw(){  try{
  const name=(document.getElementById('bdl-name')||{}).value?.trim()||'';
  const laws=await da('laws');
  const lawNames=name
    ? [...new Set(laws.filter(l=>(l.lawName||'')===name).map(l=>l.lawName))]
    : [...new Set(laws.map(l=>l.lawName||'').filter(Boolean))];
  if(!lawNames.length){toast('無符合條件的法規');return;}
  // 確保處於勾選模式
  if(!_dbSelMode) toggleDbSelectMode();
  lawNames.forEach(n=>_dbSelected.add(n));
  const m=document.getElementById('bulk-del-law-modal');if(m)m.remove();
  _updateDbSelCount();
  renderDB();  // 重繪卡片以顯示勾選狀態
  toast('已勾選 '+lawNames.length+' 部法規，確認後按「刪除選取」');
  }catch(e){ logError('applyBulkSelectLaw',e); }}

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

// ── 資料庫選擇刪除模式 ──────────────────────────────────────

function toggleDbSelectMode(){
  _dbSelMode = !_dbSelMode;
  _dbSelected.clear();
  const btn    = document.getElementById('db-sel-btn');
  const bar    = document.getElementById('db-sel-bar');
  const addBtn = document.getElementById('add-law-btn');
  const sortBtn= document.getElementById('law-sort-btn');
  if(btn){
    btn.style.background = _dbSelMode ? 'var(--red2)' : '';
    btn.style.borderColor= _dbSelMode ? 'var(--red)' : '';
  }
  if(bar)  bar.style.display = _dbSelMode ? 'flex' : 'none';
  const addWrap = document.getElementById('add-law-wrap');
  if(addWrap) addWrap.style.display = _dbSelMode ? 'none' : '';
  if(sortBtn) sortBtn.style.display = _dbSelMode ? 'none' : '';
  _updateDbSelCount();
  renderDB();
}

function _updateDbSelCount(){
  const el = document.getElementById('db-sel-count');
  if(el) el.textContent = `已選 ${_dbSelected.size} 筆法規`;
}

function _toggleDbCard(lawName){
  if(_dbSelected.has(lawName)) _dbSelected.delete(lawName);
  else _dbSelected.add(lawName);
  _updateDbSelCount();
  // 更新卡片的選取外觀
  document.querySelectorAll('.lw-card[data-lawname]').forEach(c=>{
    if(c.dataset.lawname === lawName){
      c.style.outline = _dbSelected.has(lawName) ? '2px solid var(--acc)' : '';
      c.style.background = _dbSelected.has(lawName) ? 'rgba(88,166,255,0.08)' : '';
      const chk = c.querySelector('.db-sel-chk');
      if(chk) chk.textContent = _dbSelected.has(lawName) ? '☑' : '☐';
    }
  });
}

async function confirmDbSelDel(){
  if(!_dbSelected.size){ toast('請先選取法規'); return; }
  if(!confirm(`確定刪除選取的 ${_dbSelected.size} 筆法規（含所有條文）？`)) return;
  const all = await da('laws');
  const toDelete = all.filter(l => _dbSelected.has(l.lawName));
  for(const l of toDelete){ await dd('laws', l.id); }
  toast(`已刪除 ${_dbSelected.size} 筆法規`);
  toggleDbSelectMode();
  renderDB();
}

function setLC(el, cat){
  document.querySelectorAll('#lchips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  S.lawCat = cat;
  renderDB();
}


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
    // searchBlob 優先（純文字），沒有才 fallback 到欄位拼接（排除 content 避免 base64 拖慢）
    const _c = (l.content||'').startsWith('data:') ? '' : (l.content||'');
    const h = (l.searchBlob || ((l.lawName||'')+(l.article||'')+(l.title||'')+(l.keywords||[]).join(' ')+_c)).toLowerCase();
    return h.includes(kwText);
  });

  const el=document.getElementById('llist');
  if(!fl.length){el.innerHTML='<div class="empty"><span class="ic">🗄</span><span>尚無資料</span></div>';return;}

  // 有關鍵字：直接顯示匹配的條文（不分組）
  if(kw){
    el.innerHTML='';
    fl.forEach(l=>{
      const isImg = (l.content||'').startsWith('data:');
      const preview = isImg ? '🖼 圖片內容' : esc((l.content||'').slice(0,80));
      const div=document.createElement('div');
      div.className='card law-search-card';
      div.innerHTML=
        '<div class="law-search-lawname">'+esc(l.lawName||'')+'</div>'+
        '<div class="law-search-article">'+esc(l.article||'')+(l.title?' <span class="law-search-title">'+esc(l.title)+'</span>':'')+' </div>'+
        '<div class="law-search-preview">'+preview+'</div>';
      div.onclick=()=>openLawGroup(l.lawName);
      el.appendChild(div);
    });
    return;
  }

  // 無關鍵字：依法規名稱分組顯示
  const byName={};
  fl.forEach(l=>{const n=l.lawName||'未分類';if(!byName[n])byName[n]=[];byName[n].push(l);});

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
      const _da=toDate(a[1][0]?.amendDate)||'0000';
      const _db=toDate(b[1][0]?.amendDate)||'0000';
      return dir * _db.localeCompare(_da);
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
        +(_dbSelMode?'<span class="db-sel-chk" style="font-size:18px;color:var(--acc)">'+(_dbSelected.has(name)?'\u2611':'\u2610')+'</span>':'')
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
      if(_dbSelMode){ e.stopPropagation(); _toggleDbCard(this.dataset.lawname); return; }
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



// LEVEL_STYLE 移至頂部宣告

async function openLawGroup(lawName){  try{
  if(!document.getElementById('lv')){ return; }  // 防衛：lv 元素不存在時不執行
  const allLaws=await da('laws');
  const _kw=(document.getElementById('lsi')?.value||'').toLowerCase().trim();
  // §N 精確搜尋
  let _kwLaw2='',_kwArt2='',_kwText2=_kw;
  const _sm=_kw.match(/^(.*)§\s*(\d+)\s*$/);
  if(_sm){_kwLaw2=_sm[1].trim().toLowerCase();_kwArt2=_sm[2];_kwText2='';}
  // ── 排序：純依條號遞增（法律的本質順序）──
  // 法律條文本就是第1條、第2條…依序排列，編章節只是標記，不影響條文順序。
  // 章節標題的「不重複」由渲染層的已渲染集合(_shownC 等)保證，
  // 因此這裡只需單純依條號排序，即免疫於 part/章標記不一致的舊資料。
  // 無條號者（SOP）以 id 維持輸入順序。
  const laws=allLaws.filter(l=>{
    if(l.lawName!==lawName) return false;
    if(!_kw) return true;
    if(_kwArt2){
      const am=String(l.articleNumber||'')===''+_kwArt2;
      return am;
    }
    const h=((l.article||'')+(l.title||'')+(l.content||'')).toLowerCase();
    return h.includes(_kwText2);
  }).sort((a,b)=>{
    const na=(a.articleNumber||art2n(a.article||''))||0;
    const nb=(b.articleNumber||art2n(b.article||''))||0;
    if(na!==nb) return na-nb;
    return (a.id||0)-(b.id||0); // 同條號(或都無條號)：依輸入順序
  });
  if(!laws.length)return;
  const others=[...new Set(allLaws.map(l=>l.lawName).filter(Boolean))].filter(n=>n!==lawName).slice(0,8);
  const cat=laws[0].category||'statute';
  const icon=cat==='sop'?'📋':cat==='supplement'?'📄':'⚖';
  const lvName=document.getElementById('lv-name'); if(lvName) lvName.textContent=icon+' '+lawName;
  // 顯示法規機關/日期資訊
  const lvInfo=document.getElementById('lv-info');
  if(lvInfo){
    const s=laws[0]||{};
    lvInfo.textContent=(s.org?'🏛 '+s.org:'')+(s.org&&s.amendDate?' · ':'')+(s.amendDate?'📅 '+s.amendDate:'');
    lvInfo.style.display=(s.org||s.amendDate)?'block':'none';
  }
  // 收藏狀態同步到 ⋮ 選單的收藏按鈕
  const favN=laws.filter(l=>l.favorite).length;
  const starItem=document.getElementById('lv-star-item');
  if(starItem) starItem.textContent=favN?'★ 已收藏':'☆ 收藏';
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
      ?'<div class="law-art-rel-title">🔗 關聯法條：</div>'
        +l.relatedLaws.map(r=>'<button class="chip law-rel-chip" onclick="showLawPop(\''+esc(r.ref||r.lawName||'')+'\')">⚖ '+esc(r.ref||r.lawName||'')+'</button>').join('')
      :'';
    // 劃線/筆記顯示（顏色標記 hlColor + 備註 note，整合進編輯表單）
    const hlColors={yellow:'#d4a438',green:'#4caf7d',red:'#e05c57'};
    const hlC=l.hlColor&&hlColors[l.hlColor]?hlColors[l.hlColor]:'';
    // 動態顏色（隨資料變）只能 inline；固定樣式已抽到 .law-art-card class
    const dynStyle=hlC?` style="background:linear-gradient(to right, ${hlC}14, var(--bg2) 60%);border-left-color:${hlC}"`:'';
    const noteHtml=l.note?'<div class="law-note-box">📝 '+esc(l.note)+'</div>':'';
    return '<div data-law-id="'+l.id+'" class="law-art-card"'+dynStyle+'>'
      +'<div class="law-art-head">'
        +'<span>'+_hl(l.article||'')+(l.title?' — '+_hl(l.title):'')+'</span>'
        +'<div class="law-art-acts">'
          +'<button onclick="editLawInView('+l.id+')" class="law-edit-btn">✏</button>'
          +'<button onclick="delLaw('+l.id+')" class="law-del-btn">🗑</button>'
        +'</div>'
      +'</div>'
      +'<div class="law-art-body">'+contentHtml+'</div>'
      +noteHtml+kwHtml+relHtml
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

  // ── 完整三層樹狀分組渲染：編 → 章 → 節 → 條文 ──
  // 以「編」為最外層分組（同名編的所有章聚在一起），「章」為中層，
  // 「節」為內層。每層標題只渲染一次，且同層級依各自最小條號排序。
  // 徹底免疫於 part/章標記不一致：不論條文順序如何，同名編/章絕不分裂。
  const _artNum=l=>(l.articleNumber||art2n(l.article||''))||0;
  const _minOf=arr=>arr.reduce((m,l)=>Math.min(m,_artNum(l)),Infinity);

  // 第一層：以編(part)分組
  const partMap=new Map(); // part -> items[]
  laws.forEach(l=>{
    const p=l.part||'';
    if(!partMap.has(p)) partMap.set(p,[]);
    partMap.get(p).push(l);
  });
  const partEntries=[...partMap.entries()].sort((a,b)=>_minOf(a[1])-_minOf(b[1]));

  const renderGroup=()=>{
    partEntries.forEach(([part, partItems])=>{
      if(hasPart && part) arts+=renderHeading('part', part);
      // 第二層：該編內以章分組
      const chapMap=new Map();
      partItems.forEach(l=>{
        const ch=l.chapter||'';
        if(!chapMap.has(ch)) chapMap.set(ch,[]);
        chapMap.get(ch).push(l);
      });
      const chapEntries=[...chapMap.entries()].sort((a,b)=>_minOf(a[1])-_minOf(b[1]));
      chapEntries.forEach(([ch, chapItems])=>{
        if(hasChapter && ch) arts+=renderHeading('chapter', ch);
        // 第三層：該章內以節分組
        if(hasSection){
          const sectMap=new Map();
          chapItems.forEach(l=>{
            const sec=l.section||'';
            if(!sectMap.has(sec)) sectMap.set(sec,[]);
            sectMap.get(sec).push(l);
          });
          const sectEntries=[...sectMap.entries()].sort((a,b)=>_minOf(a[1])-_minOf(b[1]));
          sectEntries.forEach(([sec,items])=>{
            if(sec) arts+=renderHeading('section', sec);
            items.sort((a,b)=>_artNum(a)-_artNum(b)||((a.id||0)-(b.id||0)));
            items.forEach(l=>{ arts+=renderArtCard(l); });
          });
        } else {
          chapItems.sort((a,b)=>_artNum(a)-_artNum(b)||((a.id||0)-(b.id||0)));
          chapItems.forEach(l=>{ arts+=renderArtCard(l); });
        }
      });
    });
  };
  renderGroup();
  // 章節列表（快速跳轉用，含編/章/節）
  const chapterList=[...new Set([
    ...parts.filter(Boolean),
    ...chapters.filter(Boolean),
    ...sections.filter(Boolean),
  ])];
    // 章節管理按鈕
  const chMgrBtn='<button onclick="openChapterMgr(window.currentLawName)" style="background:none;border:1px solid var(--bd);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--t2);margin-left:4px">⚙ 管理章節</button>';
  const chMgrBtnNew='<div style="margin-bottom:6px"><button onclick="openChapterMgr(window.currentLawName)" style="background:none;border:1px solid var(--bd);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--t2)">⚙ 新增章節分類</button></div>';
    // ── 章節導覽：依層級縱向列出，點擊跳轉（對齊法律人網站風格）──
  const _buildChNav = () => {
    if(!chapterList.length) return '';
    const seen = new Set();
    const items = [];
    laws.forEach(l=>{
      ['part','chapter','section'].forEach(type=>{
        const val = l[type];
        if(val && !seen.has(type+':'+val)){
          seen.add(type+':'+val);
          items.push({ type, val });
        }
      });
    });
    return items.map(({type,val})=>{
      const s = LEVEL_STYLE[type];
      const label = s.label||type;
      const btnStyle = 'flex-shrink:0;background:'+s.bg+';border:1px solid '+s.border
        +';color:'+s.color+';border-radius:20px;padding:3px 10px;font-size:11px;'
        +'cursor:pointer;white-space:nowrap;font-weight:600';
      const tagStyle = 'opacity:.65;margin-right:4px;font-size:9px;background:'+s.border
        +';border-radius:3px;padding:0 3px;color:#0d1117';
      return '<button onclick="scrollToChapter(this,\''+encodeURIComponent(val)+'\',\''+type+'\')"'
        +' style="'+btnStyle+'">'
        +'<span style="'+tagStyle+'">'+esc(label)+'</span>'
        +esc(val)+'</button>';
    }).join('');
  };
  const chNavHtml = _buildChNav();
  const chapterMgmtHtml = chNavHtml
    ? '<div style="overflow-x:auto;display:flex;align-items:center;gap:6px;'
      +'padding:6px 12px 8px;border-bottom:1px solid var(--bd);scrollbar-width:none">'
      +chNavHtml
      +(chMgrBtn ? '<span style="flex-shrink:0;margin-left:6px">'+chMgrBtn+'</span>' : '')
      +'</div>'
    : chMgrBtnNew

  // 法條數量寫入 header
  const countEl = document.getElementById('lv-count');
  if(countEl) countEl.textContent = laws.length + ' 條';
  // 章節 chip 寫入 sticky 列
  const chBarEl = document.getElementById('lv-chapter-bar');
  if(chBarEl){
    const chHtml = _buildChNav();
    chBarEl.innerHTML = chHtml;
    chBarEl.style.display = chHtml ? 'flex' : 'none';
  }
  // lbody：只有法條卡片（章節標題已由 renderHeading 內嵌在 arts 裡）
  document.getElementById('lbody').innerHTML=
    '<div style="padding:4px 0 10px">'
    +(others.length?'<div class="sec" style="padding:0 0 4px;font-size:11px">快速跳轉</div><div style="overflow-x:auto;display:flex;gap:6px;padding:6px 0">'+jumpHtml+'</div>':'')
    +arts
    +'</div>';
  window.currentLawName=lawName;window.currentLawContent=laws.map(l=>(l.article+(l.title?' '+l.title:'')+(l.content?' '+l.content:'')).trim()).filter(Boolean).join('\n');
  S.curLawName=lawName; // 供編輯按鈕使用
  document.getElementById('lv').style.display='flex';
  }catch(e){ logError('openLawGroup',e); }}

function exitLaw(){
  document.getElementById('lv').style.display='none';
  const cb = document.getElementById('lv-chapter-bar');
  if(cb){ cb.innerHTML=''; cb.style.display='none'; }
  const ct = document.getElementById('lv-count');
  if(ct) ct.textContent='';
  // 重置為編輯模式
  _lvReadMode = false;
  _applyLvMode();
}

// ── lv 更多選單 ────────────────────────────────────────────
async function toggleLvFav(){
  const name = S.curLawName || window.currentLawName;
  if(!name) return;
  const all = await da('laws');
  const laws = all.filter(l => l.lawName === name);
  if(!laws.length) return;
  const nf = laws.some(l => l.favorite);
  for(const l of laws){ l.favorite = !nf; await dp('laws', l); }
  toast(nf ? '已取消收藏' : '已收藏');
  // 更新收藏按鈕文字
  const btn = document.getElementById('lv-star-item');
  if(btn) btn.textContent = nf ? '☆ 收藏' : '★ 已收藏';
}
function toggleLvMenu(btn){
  const menu = document.getElementById('lv-menu');
  if(!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if(!isOpen){
    // 點外部關閉
    setTimeout(()=> document.addEventListener('click', closeLvMenu, { once:true }), 0);
  }
}
function closeLvMenu(){
  const menu = document.getElementById('lv-menu');
  if(menu) menu.style.display = 'none';
}

// ── lv 閱讀/編輯模式切換 ────────────────────────────────────
function toggleLvMode(){
  _lvReadMode = !_lvReadMode;
  _applyLvMode();
}
function _applyLvMode(){
  const addBtn = document.getElementById('lv-add-btn');
  const lbody  = document.getElementById('lbody');

  // Toggle switch 外觀
  const track   = document.getElementById('lv-mode-track');
  const thumb   = document.getElementById('lv-mode-thumb');
  const iconL   = document.getElementById('lv-mode-icon-l');  // 筆（編輯）
  const iconR   = document.getElementById('lv-mode-icon-r');  // 眼（閱讀）
  if(track) track.style.background = _lvReadMode ? 'rgba(88,166,255,0.3)' : 'var(--bg3)';
  if(thumb) thumb.style.left = _lvReadMode ? '21px' : '3px';
  if(iconL) iconL.style.opacity = _lvReadMode ? '0.35' : '1';
  if(iconR) iconR.style.opacity = _lvReadMode ? '1' : '0.35';

  // 閱讀模式：隱藏新增條文按鈕、隱藏每條的編輯/刪除按鈕
  if(addBtn) addBtn.style.display = _lvReadMode ? 'none' : '';
  if(lbody){
    lbody.querySelectorAll('.law-edit-btn,.law-del-btn').forEach(el=>{
      el.style.display = _lvReadMode ? 'none' : '';
    });
  }
}

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

// ── 備註顏色標記列共用 helper（法條/題目編輯表單共用）──────
// 設定某個 mark-row 的選中顏色，並（首次）綁定點擊切換
function _setMarkRow(rowId, color){
  const row=document.getElementById(rowId);
  if(!row) return;
  row.querySelectorAll('.note-mark-dot').forEach(dot=>{
    dot.classList.toggle('sel', (dot.dataset.color||'')===(color||''));
    // 綁定一次點擊（用 dataset 旗標避免重複綁定）
    if(!row.dataset.bound){
      dot.onclick=()=>{
        row.querySelectorAll('.note-mark-dot').forEach(d=>d.classList.remove('sel'));
        dot.classList.add('sel');
      };
    }
  });
  row.dataset.bound='1';
}

async function editLawInView(id){  try{ const l=await dg('laws',id);if(l)showAddLaw(l);   }catch(e){ logError('editLawInView',e); }}


// ── 重建條號索引：用最新 art2n 重算所有法條 articleNumber ──────
// 修正：①舊資料 articleNumber 缺值/存錯 ②「第N條之M」子條號排序
//      ③編章節標記不一致（多數決統一，清除孤立錯標）
async function rebuildLawIndex(){  try{
  const laws=await da('laws');
  if(!laws.length){ toast('沒有法條資料'); return; }
  let changed=0, fixed=0;

  // 步驟1：重算條號
  for(const l of laws){
    const newNum=art2n(l.article||'')||0;
    if(l.articleNumber!==newNum){ l.articleNumber=newNum; changed++; }
  }

  // 步驟2：編章節一致性修復（多數決）
  // 同一法規同一「章」的所有條文，其 part(編) 應該一致。
  // 統計每章各 part 的出現次數，取最多者統一；清除孤立錯標。
  // 同理，同一「節」應隸屬同一章。
  const byLawChap=new Map(); // 'lawName|chapter' -> [items]
  laws.forEach(l=>{
    const k=(l.lawName||'')+'|'+(l.chapter||'');
    if(!byLawChap.has(k)) byLawChap.set(k,[]);
    byLawChap.get(k).push(l);
  });
  byLawChap.forEach((items, k)=>{
    if(!k.split('|')[1]) return; // 無章者跳過
    // 統計此章各 part 的票數
    const votes=new Map();
    items.forEach(l=>{ const p=l.part||''; votes.set(p,(votes.get(p)||0)+1); });
    // 取票數最高的 part（平手時取非空者優先）
    let bestPart='', bestN=-1;
    votes.forEach((n,p)=>{
      if(n>bestN || (n===bestN && p && !bestPart)){ bestPart=p; bestN=n; }
    });
    // 統一：與多數不同者修正
    items.forEach(l=>{
      if((l.part||'')!==bestPart){ l.part=bestPart; fixed++; }
    });
  });

  // 步驟3：重建搜尋索引並寫回
  for(const l of laws){
    const _cnt=(l.content||'').startsWith('data:')?'':(l.content||'');
    l.searchBlob=[l.lawName,l.article,String(l.articleNumber||''),l.title,(l.keywords||[]).join(' '),_cnt]
      .filter(Boolean).join(' ').toLowerCase();
  }
  await bulkPut('laws', laws);

  // ── 同步重建題目搜尋索引（補入 year/exam/num）──
  const allQs = await da('questions');
  let qFixed = 0;
  for(const q of allQs){
    const newBlob=((q.stem||'')+' '+(q.groupStem||'')+' '+(q.subject||'')+' '+
      (q.year||'')+' '+(q.exam||'')+' '+(q.num||'')+' '+
      (q.keywords||[]).join(' ')).toLowerCase();
    if(q.searchBlob!==newBlob){ q.searchBlob=newBlob; qFixed++; }
  }
  if(qFixed>0) await bulkPut('questions', allQs);

  toast(`重建完成：法條 ${laws.length} 條（排序 ${changed}、章節 ${fixed}）· 題目索引 ${qFixed} 筆更新 ✓`);
  // 若正在檢視某法規，刷新；否則刷新清單
  if(document.getElementById('lv')?.style.display==='flex' && S.curLawName){
    openLawGroup(S.curLawName);
  } else {
    renderDB();
  }
  }catch(e){ logError('rebuildLawIndex',e); toast('重建失敗：'+e.message); }}

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
  lawName = lawName || S.curLawName || window.currentLawName || '';
  if(!lawName){toast('請先開啟一個法規');return;}
  const all=await da('laws');
  const targets=all.filter(l=>l.lawName===lawName);
  if(!targets.length){toast('找不到對應法條');return;}
  if(!confirm('確定刪除「'+lawName+'」全部 '+targets.length+' 條？無法復原。'))return;
  for(const l of targets) await dd('laws',l.id);
  toast('已刪除「'+lawName+'」共 '+targets.length+' 條');
  // 若正在檢視這部法規，關閉檢視
  if((S.curLawName||window.currentLawName)===lawName){ exitLaw&&exitLaw(); }
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
  const partEl=document.getElementById('l-part');
  if(partEl)partEl.value=l?.part||'';
  const chEl=document.getElementById('l-chapter');
  if(chEl)chEl.value=l?.chapter||'';
  const secEl=document.getElementById('l-section');
  if(secEl)secEl.value=l?.section||'';
  if(document.getElementById('l-note'))document.getElementById('l-note').value=l?.note||'';
  _setMarkRow('l-mark-row', l?.hlColor||'');
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
  // 載入制定機關 + 同法規既有的編/章/節（下拉選擇用）
  da('laws').then(all=>{
    const orgs=[...new Set(all.map(x=>x.org).filter(Boolean))];
    const dl=document.getElementById('l-org-list');
    if(dl)dl.innerHTML=orgs.map(o=>'<option value="'+esc(o)+'">').join('');
    // 同法規範圍內的編/章/節選項
    const curName=l?.lawName||document.getElementById('l-name').value.trim();
    const sameLaw=curName?all.filter(x=>x.lawName===curName):all;
    const fillDL=(id,vals)=>{
      const el=document.getElementById(id);
      if(el)el.innerHTML=[...new Set(vals.filter(Boolean))].map(v=>'<option value="'+esc(v)+'">').join('');
    };
    fillDL('l-part-list',    sameLaw.map(x=>x.part));
    fillDL('l-chapter-list', sameLaw.map(x=>x.chapter));
    fillDL('l-section-list', sameLaw.map(x=>x.section));
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
  ov.className='img-viewer-ov';

  // ── 頂部工具列 ──
  const bar=document.createElement('div');
  bar.className='img-viewer-bar';
  const closeBtn=document.createElement('button');
  closeBtn.textContent='✕';
  closeBtn.className='img-viewer-close';
  closeBtn.onclick=()=>ov.remove();
  bar.appendChild(closeBtn);

  // ── 圖片容器 ──
  const wrap=document.createElement('div');
  wrap.className='img-viewer-wrap';

  const img=document.createElement('img');
  img.src=src;
  img.className='img-viewer-img';
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

async function saveLaw(){  try{
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
  const part=document.getElementById('l-part')?.value.trim()||'';
  const chapter=document.getElementById('l-chapter')?.value.trim()||'';
  const section=document.getElementById('l-section')?.value.trim()||'';
  const relStr=(document.getElementById('l-related')?.value||'').trim();
  const relatedLaws=relStr?relStr.split(/[,，]/).map(s=>({ref:s.trim()})).filter(r=>r.ref):[];
  const articleNumber=art2n(article)||0;
  const data={
    lawName:document.getElementById('l-name').value.trim(),
    article,part,chapter,section,articleNumber,
    category:cat_,
    title:document.getElementById('l-title')?.value.trim()||'',
    content,
    keywords:kwArr(document.getElementById('l-kw').value),
    relatedLaws,
    source:document.getElementById('l-src')?.value.trim()||'',
    org:document.getElementById('l-org')?.value?.trim()||'',
    amendDate:document.getElementById('l-amend')?.value?.trim()||'',
    note:document.getElementById('l-note')?.value.trim()||'',
    hlColor:document.querySelector('#l-mark-row .note-mark-dot.sel')?.dataset.color||'',
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
    // 建立純文字搜尋索引（排除 base64 圖片 content，加速搜尋）
    const _cnt = (data.content||'').startsWith('data:') ? '' : (data.content||'');
    data.searchBlob = [
      data.lawName, data.article, String(data.articleNumber||''),
      data.title, (data.keywords||[]).join(' '), _cnt
    ].filter(Boolean).join(' ').toLowerCase();
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
    // 儲存後刷新畫面
    if(document.getElementById('lv')?.style.display==='flex' && S.curLawName){
      openLawGroup(S.curLawName);
    } else {
      renderDB();
    }
  }catch(e){
    logError('saveLaw',e);
    toast('儲存失敗，請重試');
  }
}catch(e){ logError('saveLaw',e); }
}

function openBulkQ(){
  // 填入科目 datalist（與逐一新增共用來源）
  da('questions').then(qs=>{
    const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
    const dl=document.getElementById('bi-subs');
    if(dl) dl.innerHTML=subs.map(s=>`<option value="${s}">`).join('');
  }).catch(()=>{});
  document.getElementById('bulk-ov').classList.add('on');
  // overlay 動畫完成後 focus textarea（延遲確保 IME 正確初始化）
  setTimeout(()=>{
    const ta = document.getElementById('bi-text');
    if(!ta) return;
    ta.focus();
    // 手動觸發 input 事件，讓 Android WebView 正確初始化中文 IME
    ta.dispatchEvent(new Event('input', {bubbles:true}));
  }, 400);
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
  // 條號：支援阿拉伯數字（第1條、第 1 條）和中文數字（第一條）
  const _artNumPart = '(?:([一二三四五六七八九十百千\\d]+)|([\\d]+))';
  const articleRe = /^第\s*((?:[一二三四五六七八九十百千]+|\d+))\s*條(?:之(\d+))?\s*(?:[（(]([^）)]+)[）)])?(.*)$/;

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
    // 支援中文數字條號
    const _zh2n = (s)=>{
      if(/^\d+$/.test(String(s))) return parseInt(s,10);
      const map={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'百':100,'千':1000};
      let r=0,t=0; for(const c of String(s)){const v=map[c];if(!v)continue;if(v>=10){r+=(t||1)*v;t=0;}else t=v;} return r+t||parseInt(s,10)||0;
    };
    const artNum = _zh2n(curArtNum);
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
      curArtNum = artM[1];    // 條號（中文或阿拉伯）
      // artM[2] = 之X，artM[3] = 標題，artM[4] = 條文尾
      curTitle  = (artM[3]||'').trim();
      const tail = (artM[4]||'').trim();
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
  // 批量匯入同步建立 searchBlob
  items.forEach(l => {
    l.searchBlob = [
      l.lawName, l.article, String(l.articleNumber||''),
      l.title, (l.keywords||[]).join(' ')
    , (l.content||'').startsWith('data:') ? '' : (l.content||'')].filter(Boolean).join(' ').toLowerCase();
  });
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

// ── Shims ──


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
  // 無參數呼叫（選單按鈕）時回退用目前開啟的法規
  lawName = lawName || S.curLawName || window.currentLawName || '';
  if(!lawName){ toast('請先開啟一個法規'); return; }
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


// ══ bulk.js — 大量貼題 ════════════════════════════════
async function startNumberMode(){  try{
  const qs=await da('questions');
  const pool=(qs||[]).filter(q=>q.type==='mc'&&q.isNumberQ);
  if(!pool.length){toast('請先在題目編輯中勾選「數字魔鬼」題目');return;}
  toast('數字魔鬼：共 '+pool.length+' 題');
  startQWithPool(pool,'number');
  }catch(e){ logError('startNumberMode',e); }}

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
    searchBlob: ((q.stem||'')+' '+(q.groupStem||'')+' '+(sub||q.subject||'')+' '+
      (yr||q.year||'')+' '+(ex||q.exam||'')+' '+(q.num||'')+' '+
      (q.keywords||[]).join(' ')).toLowerCase(),
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

// ════════ 公開 API ════════
// 新程式碼請使用 DataMod.xxx；window 別名供 index.html 與動態 onclick 相容
const DataMod = {
  renderHome,
  closeHeatmapOv,
  setF,
  renderList,
  closeAdd,
  showAdd,
  setQT,
  toggleGroupStem,
  saveQ,
  saveQAndContinue,
  toggleListSelectMode,
  confirmListSelDel,
  dupAction,
  openLawSortMenu,
  closeLawSortMenu,
  pickLawSort,
  toggleDbSelectMode,
  confirmDbSelDel,
  setLC,
  renderDB,
  openLawGroup,
  exitLaw,
  toggleLvFav,
  toggleLvMenu,
  closeLvMenu,
  toggleLvMode,
  addLawInGroup,
  editLawGroupInfo,
  quizFromLaw,
  showAddLaw,
  closeLawSh,
  switchLawMode,
  toggleSOPMode,
  onLawImgSelect,
  saveLaw,
  openBulkQ,
  closeBulkQ,
  showBulkLaw,
  closeBulkLaw,
  prevBulkLaw,
  importBulkLaw,
  showLawPop,
  closeLawPop,
  openChapterMgr,
  startNumberMode,
  parseBulk,
  importBulk,
  clearBulk,
  applyBulkSelectLaw,
  openBulkDelLaw,
  applyBulkSelectQ,
  delLawGroup,
  delLaw,
  editLawInView,
  openHeatmapOv,
  openImgViewer,
  previewBulkDelLaw,
  previewBulkDelQ,
  openBulkDelQ,
  scrollToChapter,
  setAns,
  startSingleQ,
  toggleStar,
  toggleLawSort,
  rebuildLawIndex,
  formatYearInput,
  editQ
};
window.DataMod = DataMod;
Object.assign(window, DataMod);
// index.html 的搜尋框 oninput 直接引用：
window._debouncedRenderList = _debouncedRenderList;
window._debouncedRenderDB   = _debouncedRenderDB;

})();
