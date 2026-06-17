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

  let html = `
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
async function dtaskToggle(id){
  if(_dtaskEditMode) return;
  const done = await _getDtaskDone();
  const idx = done.indexOf(id);
  if(idx>=0) done.splice(idx,1); else done.push(id);
  try{ await setSetting(_dtaskTodayKey(), done); }catch(e){ logError('dtaskToggle',e); }
  if(typeof haptic==='function') haptic('light');
  renderDtask();
}

// 切換編輯模式
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
