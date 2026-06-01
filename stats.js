// ══ stats.js — 統計分析 + AI弱點診斷 ══════════════════════
// 依賴：db.js, utils.js

let _dchart=null;

async function renderStats(){  try{
  const [qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const total=qs.length, totalAts=ats.length;
  const correct=ats.filter(a=>a.correct).length;
  const rate=totalAts?Math.round(correct/totalAts*100):0;
  document.getElementById('st-q').textContent=total;
  document.getElementById('st-a').textContent=totalAts;
  document.getElementById('st-r').textContent=totalAts?rate+'%':'—';

  // 各科正確率 + 平均作答時間
  const subMap={};
  qs.forEach(q=>{
    const s=q.subject||'未分類';
    if(!subMap[s])subMap[s]={total:0,correct:0,time:0,timeCount:0,hesitant:0};
    subMap[s].total++;
  });
  ats.forEach(a=>{
    const q=qs.find(q=>q.id===a.qid);if(!q)return;
    const s=q.subject||'未分類';
    if(!subMap[s])return;
    if(a.correct!==null){
      if(a.correct)subMap[s].correct++;
    }
    if(a.responseTime){subMap[s].time+=a.responseTime;subMap[s].timeCount++;}
    if(a.hesitationFlag)subMap[s].hesitant++;
  });

  const bars=document.getElementById('subj-bars');
  bars.innerHTML=Object.entries(subMap).sort((a,b)=>{
    const ra=a[1].total?a[1].correct/a[1].total:1;
    const rb=b[1].total?b[1].correct/b[1].total:1;
    return ra-rb;
  }).map(([s,d])=>{
    const r=d.total?Math.round(d.correct/d.total*100):0;
    const avgT=d.timeCount?Math.round(d.time/d.timeCount/1000):0;
    const color=r>=80?'var(--grn)':r>=60?'var(--org)':'var(--red)';
    return `<div class="sr">
      <div class="sn" title="${esc(s)}">${esc(s)}</div>
      <div class="sbw"><div class="sbar" style="width:${r}%;background:${color}"></div></div>
      <div class="sp">${r}%</div>
      <div style="font-size:10px;color:var(--t2);width:40px;text-align:right">${avgT}s</div>
    </div>`;
  }).join('');

  // 近7天練習量
  const days=7;
  const labels=[],data=[];
  for(let i=days-1;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const ds=d.toISOString().slice(0,10);
    labels.push(ds.slice(5));
    data.push(ats.filter(a=>a.date===ds).length);
  }
  const ctx=document.getElementById('dchart');
  if(_dchart)_dchart.destroy();
  _dchart=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data,backgroundColor:'#58a6ff44',borderColor:'#58a6ff',borderWidth:1,borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{color:'#8b949e'},grid:{color:'#30363d'}},x:{ticks:{color:'#8b949e'},grid:{display:false}}}}});

  // 危險等級分佈
  const wrongEl=document.getElementById('wrong-subs');
  const dangerMap={'🔴':0,'🟠':0,'🟡':0,'🟢':0};
  qs.forEach(q=>{const lv=getDangerLevel(q,ats);dangerMap[lv]++;});
  wrongEl.innerHTML=Object.entries(dangerMap).map(([lv,cnt])=>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <span style="font-size:16px">${lv}</span>
      <div style="flex:1;background:var(--bg3);border-radius:3px;height:8px;overflow:hidden">
        <div style="height:8px;border-radius:3px;background:var(--acc);width:${qs.length?cnt/qs.length*100:0}%"></div>
      </div>
      <span style="font-size:12px;color:var(--t2)">${cnt} 題</span>
    </div>`
  ).join('');

  // 高頻關鍵字
  const kwMap={};
  ats.filter(a=>!a.correct).forEach(a=>{
    const q=qs.find(q=>q.id===a.qid);if(!q)return;
    (q.keywords||[]).forEach(kw=>{kwMap[kw]=(kwMap[kw]||0)+1;});
  });
  document.getElementById('kw-cloud').innerHTML=
    Object.entries(kwMap).sort((a,b)=>b[1]-a[1]).slice(0,20)
    .map(([kw,cnt])=>`<span class="tag" style="font-size:${Math.min(14,10+cnt)}px">${esc(kw)}(${cnt})</span>`).join('');
  }catch(e){ logError('renderStats',e); }}

async function clearWrongAts(){  try{
  const ats=await da('attempts');
  const wrong=ats.filter(a=>a.correct===false);
  if(!wrong.length){toast('目前無錯誤記錄');return;}
  if(!confirm('確定刪除 '+wrong.length+' 筆錯誤作答記錄？\n正確作答記錄保留，此操作無法復原。'))return;
  for(const a of wrong) await dd('attempts',a.id);
  toast('已刪除 '+wrong.length+' 筆錯誤記錄 ✓');
  }catch(e){ logError('clearWrongAts',e); }}

async function buildAI(){  try{
  const [qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const today_=today();

  // 弱點分析
  const subErr={},kwErr={},lawErr={};
  const recentAts=ats.filter(a=>a.date>=new Date(Date.now()-7*86400000).toISOString().slice(0,10));
  const hesitantQids=new Set(ats.filter(a=>a.hesitationFlag).map(a=>a.qid));
  const wrongQids=new Set(ats.filter(a=>a.correct===false).map(a=>a.qid));

  ats.filter(a=>!a.correct).forEach(a=>{
    const q=qs.find(q=>q.id===a.qid);if(!q)return;
    const s=q.subject||'未分類';
    subErr[s]=(subErr[s]||0)+1;
    (q.keywords||[]).forEach(kw=>{kwErr[kw]=(kwErr[kw]||0)+1;});
    (q.relatedLaws||[]).forEach(l=>{
      const ref=l.ref||l.lawName||'';
      if(ref)lawErr[ref]=(lawErr[ref]||0)+1;
    });
  });

  // 記憶斷層：同關鍵字3天內持續錯
  const gapKws=[];
  Object.keys(kwErr).forEach(kw=>{
    const relQ=qs.filter(q=>(q.keywords||[]).includes(kw));
    const dates=recentAts
      .filter(a=>!a.correct&&relQ.some(q=>q.id===a.qid))
      .map(a=>a.date);
    const uniqDates=new Set(dates);
    if(uniqDates.size>=2)gapKws.push({kw,days:uniqDates.size});
  });

  // 猶豫題
  const hesitantQs=qs.filter(q=>hesitantQids.has(q.id)).slice(0,10);

  // 危險題
  const dangerQs=qs.filter(q=>getDangerLevel(q,ats)==='🔴').slice(0,10);

  // Markdown
  const md=[
    '# 警察特考弱點分析報告',
    `> 產生時間：${new Date().toLocaleString('zh-TW')} | 總題數：${qs.length} | 總作答：${ats.length}`,
    '',
    '## 🔴 高危險錯題（連錯2次以上）',
    ...dangerQs.map(q=>`- Q${q.num||'?'} [${q.subject||''}] ${(q.stem||'').slice(0,40)}…`),
    '',
    '## 📊 最弱科目',
    ...Object.entries(subErr).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,n])=>`- ${s}：錯誤 ${n} 次`),
    '',
    '## ⚠ 記憶斷層（連續多天答錯的概念）',
    ...gapKws.sort((a,b)=>b.days-a.days).slice(0,8).map(g=>`- ⚠ ${g.kw}（近 ${g.days} 天持續答錯）`),
    '',
    '## 🔑 高頻錯誤關鍵概念',
    ...Object.entries(kwErr).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([kw,n])=>`- ${kw}（${n} 次）`),
    '',
    '## ⚖ 常錯法條',
    ...Object.entries(lawErr).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([l,n])=>`- ${l}（${n} 次）`),
    '',
    '## 🐢 猶豫題（作答超過40秒）',
    ...hesitantQs.map(q=>`- [${q.subject||''}] ${(q.stem||'').slice(0,40)}…`),
    '',
    '---',
    '請根據以上分析，給我針對警察特考的備考建議，重點放在：',
    '1. 記憶斷層概念的強化策略',
    '2. 高頻錯誤關鍵概念的記憶方法',
    '3. 猶豫題的速讀技巧',
  ].join('\n');

  // JSON
  const json={
    generatedAt:new Date().toISOString(),
    weakSubjects:Object.entries(subErr).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,n])=>({subject:s,errorCount:n})),
    weakKeywords:Object.entries(kwErr).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([kw,n])=>({keyword:kw,errorCount:n})),
    dangerQuestions:dangerQs.map(q=>({id:q.id,subject:q.subject,stem:(q.stem||'').slice(0,50)})),
    hesitationQuestions:hesitantQs.map(q=>({id:q.id,subject:q.subject,stem:(q.stem||'').slice(0,50)})),
    memoryGaps:gapKws.slice(0,8),
    commonMistakes:Object.entries(lawErr).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([ref,n])=>({ref,errorCount:n})),
    reviewQueue:qs.filter(q=>(q.nextReview||0)<=Date.now()).length,
    sprintRecommendations:[
      '優先複習🔴危險題',
      ...gapKws.slice(0,3).map(g=>`強化「${g.kw}」概念`),
      ...Object.entries(lawErr).slice(0,2).map(([l])=>`熟記 ${l}`)
    ]
  };

  S.aiMd=md; S.aiJson=JSON.stringify(json,null,2);
  document.getElementById('ai-md').textContent=md.slice(0,800)+'…';
  document.getElementById('ai-json').textContent=S.aiJson.slice(0,400)+'…';
  document.getElementById('ai-out').classList.remove('hide');
  toast('AI 分析完成 ✓');
  }catch(e){ logError('buildAI',e); }}

async function copyAI(type){  try{
  const text=type==='md'?S.aiMd:S.aiJson;
  await navigator.clipboard.writeText(text);
  toast('已複製到剪貼簿 ✓');
  }catch(e){ logError('copyAI',e); }}

function dlAI(type){
  const text=type==='md'?S.aiMd:S.aiJson;
  const fn=type==='md'?'弱點分析.md':'弱點分析.json';
  dl(text,fn,type==='md'?'text/markdown':'application/json');
}

