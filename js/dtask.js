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

  const doneCount = items.filter(it=>done.includes(it.id)).length;
  const pct = Math.round(doneCount / items.length * 100);

  // ── 編輯模式：清單 + 新增 ──
  if(_dtaskEditMode){
    let editHtml = items.map(it=>`
      <div class="dtask-item editing">
        <input class="dtask-item-input" value="${_esc(it.text)}" data-id="${it.id}"
          oninput="dtaskEditText('${it.id}', this.value)">
        <button class="dtask-del" onclick="dtaskDelete('${it.id}')">✕</button>
      </div>`).join('');
    editHtml += `<button class="dtask-add" onclick="dtaskAdd()">＋ 新增任務</button>`;
    list.innerHTML = editHtml;
    return;
  }

  // ── 一般模式：左任務清單 + 右圓形進度 ──
  const tasksHtml = items.map(it=>{
    const isDone = done.includes(it.id);
    return `<div class="dtask-item${isDone?' done':''}" onclick="dtaskToggle('${it.id}')">
      <span class="dtask-check">${isDone?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>':''}</span>
      <span class="dtask-text">${_esc(it.text)}</span>
    </div>`;
  }).join('');

  // 圓形進度條（SVG 環形）
  const R = 30, C = 2 * Math.PI * R;
  const dash = C * (pct/100);
  const ringColor = pct>=100 ? '#e0a020' : pct>=50 ? '#4caf7d' : '#6ea8fe';
  const ringHtml = `
    <div class="dtask-ring-box">
      <svg class="dtask-ring" viewBox="0 0 72 72">
        <circle class="dtask-ring-bg" cx="36" cy="36" r="${R}"></circle>
        <circle class="dtask-ring-fg" cx="36" cy="36" r="${R}"
          stroke="${ringColor}"
          stroke-dasharray="${dash} ${C}"
          stroke-dashoffset="0"
          transform="rotate(-90 36 36)"></circle>
      </svg>
      <div class="dtask-ring-txt">
        <span class="dtask-ring-pct">${pct}<small>%</small></span>
        <span class="dtask-ring-sub">${doneCount}/${items.length}</span>
      </div>
    </div>`;

  list.innerHTML = `
    <div class="dtask-flexrow">
      <div class="dtask-ring-col">${ringHtml}</div>
      <div class="dtask-tasks">${tasksHtml}</div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 【每日任務：歷史查閱】30 天達成圖示 + 點某日看完成/未完成清單
// ════════════════════════════════════════════════════════════
async function openDtaskHistory(){
  document.getElementById('dtask-hist-ov')?.remove();
  const hist = await _getDtaskHistory();
  const keys = Object.keys(hist).sort().reverse();  // 新到舊

  let rowsHtml;
  if(!keys.length){
    rowsHtml = `<div class="dtask-empty">尚無歷史紀錄</div>`;
  } else {
    rowsHtml = keys.map(k=>{
      const rec = hist[k];
      const ratio = (typeof rec==='object') ? rec.r : rec;  // 相容舊格式
      const tasks = (typeof rec==='object' && rec.tasks) ? rec.tasks : [];
      const d = new Date(k);
      const wd = ['日','一','二','三','四','五','六'][d.getDay()];
      const dateLab = `${d.getMonth()+1}/${d.getDate()} 週${wd}`;
      const doneN = tasks.filter(t=>t.done).length;
      const taskList = tasks.length
        ? tasks.map(t=>`<div class="dthist-task ${t.done?'done':'undone'}">
            <span class="dthist-task-ic">${t.done?'✓':'✕'}</span>${_esc(t.text)}
          </div>`).join('')
        : '<div class="dthist-task undone">（無明細）</div>';
      return `<div class="dthist-day">
        <div class="dthist-day-head">
          <span class="dthist-day-ic">${_dtaskAchieveIcon(ratio)}</span>
          <span class="dthist-day-date">${dateLab}</span>
          <span class="dthist-day-cnt">${doneN}/${tasks.length||'-'}</span>
        </div>
        <div class="dthist-day-tasks">${taskList}</div>
      </div>`;
    }).join('');
  }

  const ov = document.createElement('div');
  ov.id = 'dtask-hist-ov';
  ov.className = 'ov-sheet-c z420';
  ov.innerHTML = `
    <div class="dthist-panel">
      <div class="dthist-handle"></div>
      <div class="dthist-title">每日任務歷史　<small>近 30 天</small></div>
      <div class="dthist-list">${rowsHtml}</div>
      <button class="dthist-close" onclick="document.getElementById('dtask-hist-ov').remove()">關閉</button>
    </div>`;
  ov.onclick = e=>{ if(e.target===ov) ov.remove(); };
  document.body.appendChild(ov);
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

// 記錄當日達成到歷史（保留 30 天，含完成明細供歷史查閱）
async function _recordDtaskHistory(){
  try{
    const items = await _getDtaskItems();
    const done  = await _getDtaskDone();
    if(!items.length) return;
    const doneIds = done.filter(id=>items.some(it=>it.id===id));
    const ratio = doneIds.length / items.length;
    const dateStr = _dtaskTodayKey().replace('dtask_done_','');
    let hist = {};
    try{ const v = await getSetting('dtask_history'); if(v && typeof v==='object') hist = v; }catch(e){}
    // 存：比例 + 當日任務快照（文字 + 是否完成），供歷史查閱顯示清單
    hist[dateStr] = {
      r: ratio,
      tasks: items.map(it=>({ text: it.text, done: doneIds.includes(it.id) })),
    };
    // 只保留最近 30 天
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30);
    for(const k in hist){
      if(new Date(k) < cutoff) delete hist[k];
    }
    await setSetting('dtask_history', hist);
  }catch(e){ logError('_recordDtaskHistory', e); }
}

// 達成等級圖示（四種質感 SVG）
// 全達成→獎盃　過半→星星　未過半(>0)→三角驚嘆　都沒有→叉叉
function _dtaskAchieveIcon(ratio){
  if(ratio >= 1){
    // 獎盃（金）
    return `<svg class="dtask-ach dtask-ach-full" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h12v2h2.5a1.5 1.5 0 0 1 1.5 1.5c0 2.5-1.8 4.6-4.2 5.2A6 6 0 0 1 13 16.9V19h3v2H8v-2h3v-2.1a6 6 0 0 1-4.8-4.2C3.8 12.1 2 10 2 7.5A1.5 1.5 0 0 1 3.5 6H6V4zm0 4H4c0 1.5 1 2.8 2.4 3.3A6 6 0 0 1 6 9.5V8zm12 0v1.5c0 .6-.1 1.2-.4 1.8C19 10.8 20 9.5 20 8h-2z"/></svg>`;
  } else if(ratio >= 0.5){
    // 星星（銀亮）
    return `<svg class="dtask-ach dtask-ach-half" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.8.7-5.1 4.6 1.4 6.7L12 17.8 6 20.3l1.4-6.7L2.3 9l6.8-.7z"/></svg>`;
  } else if(ratio > 0){
    // 三角驚嘆號（橘）
    return `<svg class="dtask-ach dtask-ach-low" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17.5" r="0.6" fill="currentColor"/></svg>`;
  } else {
    // 叉叉（灰）
    return `<svg class="dtask-ach dtask-ach-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-width="2"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/><line x1="15.5" y1="8.5" x2="8.5" y2="15.5"/></svg>`;
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
