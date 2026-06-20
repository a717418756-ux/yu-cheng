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

  // ── 編輯模式：清單 + 新增 + 自動條件 ──
  if(_dtaskEditMode){
    let editHtml = items.map(it=>{
      const a = it.auto || {};
      const autoLabel = !it.auto ? '手動' :
        a.type==='quiz' ? `答題≥${a.target}` :
        a.type==='time' ? `${_zoneLabel(a.zone)}≥${a.target}分` :
        a.type==='fit'  ? `${_fitLabel(a.field)}≥${a.target}` :
        a.type==='plan' ? `計畫:${a.match||'任一'}` : '手動';
      return `
      <div class="dtask-item editing">
        <input class="dtask-item-input" value="${_esc(it.text)}" data-id="${it.id}"
          oninput="dtaskEditText('${it.id}', this.value)">
        <button class="dtask-auto-btn" onclick="dtaskEditAuto('${it.id}')" title="設定自動完成條件">${autoLabel}</button>
        <button class="dtask-del" onclick="dtaskDelete('${it.id}')">✕</button>
      </div>`;
    }).join('');
    editHtml += `<button class="dtask-add" onclick="dtaskAdd()">＋ 新增任務</button>`;
    editHtml += `<button class="dtask-done-edit" onclick="toggleDtaskEdit()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;vertical-align:-3px;margin-right:5px"><path d="M20 6L9 17l-5-5"/></svg>完成編輯</button>`;
    editHtml += `<div class="dtask-edit-hint">點任務後方標籤可設定「自動完成條件」，回首頁按 🔄 即比對資料自動勾選</div>`;
    list.innerHTML = editHtml;
    return;
  }

  // ── 一般模式：左任務清單 + 右圓形進度 ──
  const tasksHtml = items.map(it=>{
    const isDone = done.includes(it.id);
    const noAuto = !it.auto;
    return `<div class="dtask-item${isDone?' done':''}" onclick="dtaskToggle('${it.id}')">
      <span class="dtask-check">${isDone?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>':''}</span>
      <span class="dtask-text">${_esc(it.text)}${noAuto?'<span class="dtask-noauto">未設條件</span>':''}</span>
    </div>`;
  }).join('');

  // 圓形進度條（SVG 環形）
  const R = 30, C = 2 * Math.PI * R;
  const dash = C * (pct/100);
  const ringColor = pct>=100 ? '#e0a020' : pct>=50 ? '#4caf7d' : '#6ea8fe';
  const ringHtml = `
    <div class="dtask-ring-box" ondblclick="toggleDtaskEdit()" title="雙擊編輯任務" style="cursor:pointer">
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

function _esc(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ════════════════════════════════════════════════════════════
// 自動條件標籤輔助
function _zoneLabel(z){ return z==='exam'?'考試區':z==='leisure'?'休閒區':z==='study'?'成長區':'學習'; }
function _fitLabel(f){ return f==='activeMin'?'運動時長':f==='burned'?'消耗熱量':f==='intake'?'攝取熱量':f==='steps'?'步數':f; }

// 設定任務的自動完成條件（編輯模式點標籤）
async function dtaskEditAuto(id){
  const items = await _getDtaskItems();
  const it = items.find(x=>x.id===id);
  if(!it) return;
  const a = it.auto || {};

  const ov = document.createElement('div');
  ov.className = 'ov on';
  ov.id = 'dtask-auto-ov';
  ov.onclick = (e)=>{ if(e.target===ov) ov.remove(); };
  ov.innerHTML = `
    <div class="sh" onclick="event.stopPropagation()" style="max-width:440px">
      <div class="shdl"></div>
      <div class="sht"><span>自動完成條件</span>
        <button class="shx" onclick="document.getElementById('dtask-auto-ov').remove()">✕</button></div>
      <div style="padding:4px 18px 24px">
        <p class="dtask-auto-desc">設定後，回首頁按 🔄 比對資料，達標自動勾選「${_esc(it.text)}」</p>
        <label class="dtask-auto-label">條件類型</label>
        <select class="dtask-auto-sel" id="da-type" onchange="_daTypeChange()">
          <option value="">手動（不自動）</option>
          <option value="quiz">今日答題數達標</option>
          <option value="time">今日某區使用時間達標</option>
          <option value="fit">今日運動數據達標</option>
          <option value="plan">計畫表完成對應事件</option>
        </select>
        <div id="da-extra"></div>
        <div class="dtask-auto-actions">
          <button class="dtask-auto-save" onclick="_dtaskSaveAuto('${id}')">儲存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  document.getElementById('da-type').value = a.type || '';
  _daTypeChange();
  // 回填現有值
  if(a.type==='quiz' || a.type==='fit' || a.type==='time'){
    const t = document.getElementById('da-target'); if(t) t.value = a.target||'';
  }
  if(a.type==='time'){ const z=document.getElementById('da-zone'); if(z) z.value=a.zone||'exam'; }
  if(a.type==='fit'){ const f=document.getElementById('da-field'); if(f) f.value=a.field||'activeMin'; }
  if(a.type==='plan'){ const m=document.getElementById('da-match'); if(m) m.value=a.match||''; }
}

function _daTypeChange(){
  const type = document.getElementById('da-type').value;
  const extra = document.getElementById('da-extra');
  if(!extra) return;
  if(type==='quiz'){
    extra.innerHTML = `<label class="dtask-auto-label">目標題數</label>
      <input class="dtask-auto-input" id="da-target" type="number" inputmode="numeric" placeholder="例：20" value="20">`;
  } else if(type==='time'){
    extra.innerHTML = `<label class="dtask-auto-label">區域</label>
      <select class="dtask-auto-sel" id="da-zone">
        <option value="exam">考試區</option><option value="leisure">休閒區</option><option value="study">成長區</option>
      </select>
      <label class="dtask-auto-label">目標分鐘</label>
      <input class="dtask-auto-input" id="da-target" type="number" inputmode="numeric" placeholder="例：30" value="30">`;
  } else if(type==='fit'){
    extra.innerHTML = `<label class="dtask-auto-label">項目</label>
      <select class="dtask-auto-sel" id="da-field">
        <option value="activeMin">運動時長（分）</option><option value="burned">消耗熱量</option>
        <option value="intake">攝取熱量</option><option value="steps">步數</option>
      </select>
      <label class="dtask-auto-label">目標值</label>
      <input class="dtask-auto-input" id="da-target" type="number" inputmode="numeric" placeholder="例：30" value="30">`;
  } else if(type==='plan'){
    extra.innerHTML = `<label class="dtask-auto-label">計畫事件含關鍵字（留空=任一已完成事件）</label>
      <input class="dtask-auto-input" id="da-match" type="text" placeholder="例：複習">`;
  } else {
    extra.innerHTML = '';
  }
}

async function _dtaskSaveAuto(id){
  const type = document.getElementById('da-type').value;
  let auto = null;
  if(type==='quiz'){
    auto = { type:'quiz', target:parseInt(document.getElementById('da-target').value)||1 };
  } else if(type==='time'){
    auto = { type:'time', zone:document.getElementById('da-zone').value, target:parseInt(document.getElementById('da-target').value)||1 };
  } else if(type==='fit'){
    auto = { type:'fit', field:document.getElementById('da-field').value, target:parseInt(document.getElementById('da-target').value)||1 };
  } else if(type==='plan'){
    auto = { type:'plan', match:document.getElementById('da-match').value.trim() };
  }
  const items = await _getDtaskItems();
  const it = items.find(x=>x.id===id);
  if(it){ if(auto) it.auto = auto; else delete it.auto; }
  await setSetting('dtask_items', items);
  document.getElementById('dtask-auto-ov')?.remove();
  renderDtask();
}

// ════════════════════════════════════════════════════════════
// 【每日任務：比對資料自動完成】
// 按重新整理鈕，依各任務綁定的自動條件比對資料，達標者自動勾選
//   auto 條件格式：
//     {type:'quiz', target:20}              今日答題數 ≥ target
//     {type:'time', zone:'exam', target:30} 今日某區使用 ≥ target 分鐘
//     {type:'fit',  field:'activeMin', target:30} 今日運動數據 ≥ target
//     {type:'plan', match:'關鍵字'}          計畫表今日有完成含關鍵字的事件
//     null / 無                              純手動
// ════════════════════════════════════════════════════════════
async function dtaskSyncAuto(){
  if(_dtaskEditMode) return;
  const items = await _getDtaskItems();
  const hasAuto = items.some(it=>it.auto);
  if(!hasAuto){
    toast('尚未設定自動條件，可在編輯中設定');
    return;
  }

  const done = await _getDtaskDone();
  let changed = 0;

  // 預先抓取比對所需資料
  const todayStr = new Date().toISOString().slice(0,10);
  let qs=[], ats=[], usage=[], fit=null, planEvents=[];
  try{ [qs, ats] = await Promise.all([da('questions'), da('attempts')]); }catch(e){}
  try{ usage = await da('usageLogs'); }catch(e){}
  try{ if(typeof _getFitData==='function') fit = await _getFitData(todayStr); }catch(e){}
  try{
    const pv = await getSetting('plan_' + todayStr);
    if(Array.isArray(pv)) planEvents = pv;
  }catch(e){}

  for(const it of items){
    if(!it.auto || done.includes(it.id)) continue;
    let reached = false;
    const a = it.auto;

    if(a.type==='quiz'){
      const todayAns = ats.filter(t=> t.date===todayStr).length;
      reached = todayAns >= (a.target||1);

    } else if(a.type==='time'){
      const sec = usage.filter(l=>l.date===todayStr && (!a.zone || l.zone===a.zone))
        .reduce((s,l)=>s+(l.seconds||0),0);
      reached = (sec/60) >= (a.target||1);

    } else if(a.type==='fit'){
      const val = fit ? (fit[a.field]||0) : 0;
      reached = val >= (a.target||1);

    } else if(a.type==='plan'){
      reached = planEvents.some(ev=> ev.done && (!a.match || (ev.title||'').includes(a.match)));
    }

    if(reached){ done.push(it.id); changed++; }
  }

  if(changed>0){
    await setSetting(_dtaskTodayKey(), done);
    await _recordDtaskHistory();
    toast(`已自動完成 ${changed} 項任務`);
    renderDtask();
  } else {
    toast('目前沒有達標的任務');
  }
}

// 勾選完成（非編輯模式）
// ════════════════════════════════════════════════════════════
// 【每日任務：勾選完成與歷史記錄】
// ════════════════════════════════════════════════════════════
async function dtaskToggle(id){
  if(_dtaskEditMode) return;
  const done = await _getDtaskDone();
  const idx = done.indexOf(id);
  if(idx>=0){
    // 已完成 → 允許取消（誤判時可手動取消）
    done.splice(idx,1);
  } else {
    // 未完成 → 不允許手動勾，改用重新整理鈕比對資料（防偷懶）
    toast('請按右上角 🔄 由系統比對資料完成');
    return;
  }
  try{ await setSetting(_dtaskTodayKey(), done); }catch(e){ logError('dtaskToggle',e); }
  await _recordDtaskHistory();
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
    // 獎盃（金，含底座與光澤細節）
    return `<svg class="dtask-ach dtask-ach-full" viewBox="0 0 24 24" fill="none">
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" fill="currentColor"/>
      <path d="M7 5H4.5A1.5 1.5 0 0 0 3 6.5C3 9 5 11 7.5 11" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M17 5h2.5A1.5 1.5 0 0 1 21 6.5C21 9 19 11 16.5 11" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M12 14v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M8.5 20.5h7l-.8-2.5a1 1 0 0 0-1-.7h-3.4a1 1 0 0 0-1 .7z" fill="currentColor"/>
      <path d="M10 6.5l1.2 1.2L14 5" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
    </svg>`;
  } else if(ratio >= 0.5){
    // 星星（雙層，內層留白增添層次）
    return `<svg class="dtask-ach dtask-ach-half" viewBox="0 0 24 24" fill="none">
      <path d="M12 2.5l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.6 6.1 19.5l1.3-6.2L2.7 9l6.3-.7z" fill="currentColor"/>
      <path d="M12 6.5l1.5 3.2 3.4.4-2.5 2.3.7 3.4L12 14.1l-3.1 1.7.7-3.4L7.1 10l3.4-.4z" fill="#fff" opacity="0.32"/>
    </svg>`;
  } else if(ratio > 0){
    // 三角驚嘆（橘，圓角飽滿質感）
    return `<svg class="dtask-ach dtask-ach-low" viewBox="0 0 24 24" fill="none">
      <path d="M10.3 3.6a2 2 0 0 1 3.4 0l8 13.9a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z" fill="currentColor"/>
      <line x1="12" y1="9" x2="12" y2="14" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
      <circle cx="12" cy="17" r="1.1" fill="#fff" opacity="0.9"/>
    </svg>`;
  } else {
    // 叉叉（灰，圓底填色更精緻）
    return `<svg class="dtask-ach dtask-ach-none" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity="0.18"/>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.6"/>
      <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
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
