// ════════════════════════════════════════════════════════════
// 【每日任務】首頁 - 可編輯的每日待辦，每日自動重置完成狀態
// 資料存 settings store：dtask_items（任務清單）+ dtask_done_DATE（當日完成）
// ════════════════════════════════════════════════════════════

let _dtaskEditMode = false;

// 預設任務（首次使用）
const _DTASK_DEFAULT = [
  { id:'t1', text:'複習考古題 20 題' },
  { id:'t2', text:'閱讀 30 分鐘' },
  { id:'t3', text:'英語跟讀練習' },
];

function _dtaskTodayKey(){
  const d = new Date();
  return `dtask_done_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function _getDtaskItems(){
  try{
    const v = await getSetting('dtask_items');
    if(Array.isArray(v) && v.length) return v;
  }catch(e){}
  return [..._DTASK_DEFAULT];
}

async function _getDtaskDone(){
  try{
    const v = await getSetting(_dtaskTodayKey());
    return Array.isArray(v) ? v : [];
  }catch(e){ return []; }
}

// ════════════════════════════════════════════════════════════
// 【每日任務：渲染（含達成歷史圖示）】
// ════════════════════════════════════════════════════════════
async function renderDtask(){
  const list = document.getElementById('dtask-list');
  if(!list) return;
  const items = await _getDtaskItems();
  const done  = await _getDtaskDone();

  if(!items.length){
    list.innerHTML = `<div class="dtask-empty">尚無任務，點「編輯」新增</div>`;
    return;
  }

  // 完成進度
  const doneCount = items.filter(it=>done.includes(it.id)).length;
  const pct = Math.round(doneCount / items.length * 100);

  // 達成歷史（最近 7 天圖示 + 統計）
  const hist = await _getDtaskHistory();
  const histKeys = Object.keys(hist).sort();  // 日期升序
  const recent = histKeys.slice(-7);
  let fullCnt=0, halfCnt=0, lowCnt=0;
  for(const k of histKeys){
    const r = hist[k];
    if(r>=1) fullCnt++; else if(r>=0.5) halfCnt++; else lowCnt++;
  }
  let histHtml = '';
  if(recent.length && !_dtaskEditMode){
    const icons = recent.map(k=>{
      const d = new Date(k);
      const dd = `${d.getMonth()+1}/${d.getDate()}`;
      return `<div class="dtask-hist-cell">
        ${_dtaskAchieveIcon(hist[k])}
        <span class="dtask-hist-date">${dd}</span>
      </div>`;
    }).join('');
    histHtml = `
      <div class="dtask-hist">
        <div class="dtask-hist-row">${icons}</div>
        <div class="dtask-hist-stat">
          <span class="dtask-stat-item"><span class="dtask-stat-ico full">★</span>全達成 ${fullCnt}</span>
          <span class="dtask-stat-item"><span class="dtask-stat-ico half">◑</span>過半 ${halfCnt}</span>
          <span class="dtask-stat-item"><span class="dtask-stat-ico low">○</span>未過半 ${lowCnt}</span>
        </div>
      </div>`;
  }

  let html = histHtml + `
    <div class="dtask-progress">
      <div class="dtask-progress-bar"><div class="dtask-progress-fill" style="width:${pct}%"></div></div>
      <span class="dtask-progress-txt">${doneCount}/${items.length}</span>
    </div>`;

  html += items.map(it=>{
    const isDone = done.includes(it.id);
    if(_dtaskEditMode){
      return `<div class="dtask-item editing">
        <input class="dtask-item-input" value="${_esc(it.text)}" data-id="${it.id}"
          oninput="dtaskEditText('${it.id}', this.value)">
        <button class="dtask-del" onclick="dtaskDelete('${it.id}')">✕</button>
      </div>`;
    }
    return `<div class="dtask-item${isDone?' done':''}" onclick="dtaskToggle('${it.id}')">
      <span class="dtask-check">${isDone?'✓':''}</span>
      <span class="dtask-text">${_esc(it.text)}</span>
    </div>`;
  }).join('');

  if(_dtaskEditMode){
    html += `<button class="dtask-add" onclick="dtaskAdd()">＋ 新增任務</button>`;
  }

  list.innerHTML = html;
}

function _esc(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// 勾選完成（非編輯模式）
// ════════════════════════════════════════════════════════════
// 【每日任務：勾選完成與歷史記錄】
// ════════════════════════════════════════════════════════════
async function dtaskToggle(id){
  if(_dtaskEditMode) return;
  const done = await _getDtaskDone();
  const idx = done.indexOf(id);
  if(idx>=0) done.splice(idx,1); else done.push(id);
  try{ await setSetting(_dtaskTodayKey(), done); }catch(e){ logError('dtaskToggle',e); }
  await _recordDtaskHistory();  // 更新當日達成歷史
  if(typeof haptic==='function') haptic('light');
  renderDtask();
}

// 記錄當日達成比例到歷史（只保留最近 35 天）
async function _recordDtaskHistory(){
  try{
    const items = await _getDtaskItems();
    const done  = await _getDtaskDone();
    if(!items.length) return;
    const ratio = done.filter(id=>items.some(it=>it.id===id)).length / items.length;
    const dateStr = _dtaskTodayKey().replace('dtask_done_','');
    let hist = {};
    try{ const v = await getSetting('dtask_history'); if(v && typeof v==='object') hist = v; }catch(e){}
    hist[dateStr] = ratio;  // 0~1
    // 只保留最近 35 天：刪掉超過 35 天的 key
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-35);
    for(const k in hist){
      if(new Date(k) < cutoff) delete hist[k];
    }
    await setSetting('dtask_history', hist);
  }catch(e){ logError('_recordDtaskHistory', e); }
}

// 達成等級圖示（三種質感 SVG）：全達成/過半/未過半
function _dtaskAchieveIcon(ratio){
  if(ratio >= 1){
    // 全達成：獎章星形（金）
    return `<svg class="dtask-ach dtask-ach-full" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.3L12 14.8 7.2 17.6l.9-5.3L4.2 8.5l5.4-.8z"/></svg>`;
  } else if(ratio >= 0.5){
    // 過半：半滿圓環（綠）
    return `<svg class="dtask-ach dtask-ach-half" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>`;
  } else {
    // 未過半：空圓環（灰）
    return `<svg class="dtask-ach dtask-ach-low" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>`;
  }
}

// 取得達成歷史（日期→比例）
async function _getDtaskHistory(){
  try{ const v = await getSetting('dtask_history'); if(v && typeof v==='object') return v; }catch(e){}
  return {};
}

// 切換編輯模式
// ════════════════════════════════════════════════════════════
// 【每日任務：編輯模式（增刪改）】
// ════════════════════════════════════════════════════════════
function toggleDtaskEdit(){
  _dtaskEditMode = !_dtaskEditMode;
  const btn = document.getElementById('dtask-edit-btn');
  if(btn) btn.textContent = _dtaskEditMode ? '完成' : '編輯';
  renderDtask();
}

// 編輯任務文字
let _dtaskSaveTimer = null;
async function dtaskEditText(id, text){
  const items = await _getDtaskItems();
  const it = items.find(x=>x.id===id);
  if(it){ it.text = text; }
  clearTimeout(_dtaskSaveTimer);
  _dtaskSaveTimer = setTimeout(async()=>{
    try{ await setSetting('dtask_items', items); }catch(e){ logError('dtaskEditText',e); }
  }, 400);
}

// 新增任務
async function dtaskAdd(){
  const items = await _getDtaskItems();
  items.push({ id:'t'+Date.now(), text:'' });
  try{ await setSetting('dtask_items', items); }catch(e){ logError('dtaskAdd',e); }
  renderDtask();
}

// 刪除任務
async function dtaskDelete(id){
  const items = await _getDtaskItems();
  const filtered = items.filter(x=>x.id!==id);
  try{ await setSetting('dtask_items', filtered); }catch(e){ logError('dtaskDelete',e); }
  renderDtask();
}
