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


