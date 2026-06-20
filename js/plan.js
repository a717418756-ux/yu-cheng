// ════════════════════════════════════════════════════════════
// 【計畫表（行事曆）】時間軸日檢視，左右滑動切換日
// 資料存 settings：plan_YYYY-MM-DD = JSON [{id,title,start,end,color}]
//   start/end 為當日分鐘數（如 9:30 = 570）
// 過去日期唯讀，今日與未來可編輯
// ════════════════════════════════════════════════════════════

let _planOffset = 0;          // 0=今日，-1=昨日，+1=明日
const _PLAN_START_H = 6;      // 時間軸起始（6:00）
const _PLAN_END_H   = 24;     // 時間軸結束（24:00）
const _PLAN_PXH     = 56;     // 每小時像素高度
const _PLAN_COLORS  = ['#6ea8fe','#4caf7d','#e0a020','#c87de0','#e05c8a'];

function _planDateKey(offset){
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _planLabel(offset){
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const wd = ['日','一','二','三','四','五','六'][d.getDay()];
  const rel = offset === 0 ? '今日' : offset === -1 ? '昨日' : offset === 1 ? '明日' : '';
  return { full:`${d.getMonth()+1}月${d.getDate()}日`, wd, rel, isToday: offset===0 };
}

async function _getPlanEvents(dateKey){
  try{
    const v = await getSetting('plan_' + dateKey);
    if(Array.isArray(v)) return v;
    return [];
  }catch(e){ return []; }
}

async function _savePlanEvents(dateKey, events){
  try{ await setSetting('plan_' + dateKey, events); }catch(e){ logError('savePlanEvents', e); }
}

function _planEsc(s){
  return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function _minToHHMM(m){
  const h = Math.floor(m/60), mm = m%60;
  return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

// 計算事件重疊分欄（像 Google Calendar：重疊的事件並排）
function _layoutEvents(events){
  // 依開始時間排序
  const sorted = [...events].sort((a,b)=> a.start - b.start || a.end - b.end);
  // 分群：互相重疊的歸為一群
  const columns = [];  // 每欄記錄最後結束時間
  sorted.forEach(ev => {
    let placed = false;
    for(let i=0;i<columns.length;i++){
      if(ev.start >= columns[i]){
        ev._col = i;
        columns[i] = ev.end;
        placed = true;
        break;
      }
    }
    if(!placed){
      ev._col = columns.length;
      columns.push(ev.end);
    }
  });
  const totalCols = Math.max(1, columns.length);
  sorted.forEach(ev => { ev._totalCols = totalCols; });
  return sorted;
}

async function renderPlan(){
  const body = document.getElementById('plan-body');
  if(!body) return;

  const key = _planDateKey(_planOffset);
  const lbl = _planLabel(_planOffset);
  const events = await _getPlanEvents(key);
  const editable = _planOffset >= 0;  // 今日與未來可編輯
  const laid = _layoutEvents(events);

  const totalH = (_PLAN_END_H - _PLAN_START_H) * _PLAN_PXH;

  // 時間刻度
  let hoursHtml = '';
  for(let h = _PLAN_START_H; h <= _PLAN_END_H; h++){
    const top = (h - _PLAN_START_H) * _PLAN_PXH;
    hoursHtml += `<div class="plan-hour-line" style="top:${top}px">
      <span class="plan-hour-lbl">${String(h).padStart(2,'0')}:00</span>
    </div>`;
  }

  // 事件區塊
  let eventsHtml = '';
  laid.forEach(ev => {
    const top = (ev.start/60 - _PLAN_START_H) * _PLAN_PXH;
    const height = Math.max(22, (ev.end - ev.start)/60 * _PLAN_PXH - 3);
    const colW = 100 / ev._totalCols;
    const left = ev._col * colW;
    const color = ev.color || _PLAN_COLORS[0];
    eventsHtml += `<div class="plan-event" style="
        top:${top}px; height:${height}px;
        left:calc(${left}% + 52px); width:calc(${colW}% - 56px);
        background:${color}22; border-left:3px solid ${color};"
        ${editable ? `onclick="openPlanEventEdit('${key}','${ev.id}')"` : ''}>
      <div class="plan-event-time">${_minToHHMM(ev.start)}–${_minToHHMM(ev.end)}</div>
      <div class="plan-event-title">${_planEsc(ev.title)}</div>
    </div>`;
  });

  // 今日的「現在時間」指示線
  let nowLine = '';
  if(lbl.isToday){
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    if(nowMin >= _PLAN_START_H*60 && nowMin <= _PLAN_END_H*60){
      const top = (nowMin/60 - _PLAN_START_H) * _PLAN_PXH;
      nowLine = `<div class="plan-now-line" style="top:${top}px"><span class="plan-now-dot"></span></div>`;
    }
  }

  body.innerHTML = `
    <div class="plan-nav">
      <button class="plan-nav-btn" onclick="planPrevDay()" aria-label="前一天">‹</button>
      <div class="plan-nav-center">
        <span class="plan-nav-date">${lbl.full}（${lbl.wd}）</span>
        ${lbl.rel ? `<span class="plan-nav-rel${lbl.isToday?' today':''}">${lbl.rel}</span>` : ''}
      </div>
      <button class="plan-nav-btn" onclick="planNextDay()" aria-label="後一天">›</button>
    </div>
    <div class="plan-timeline-wrap" id="plan-timeline-wrap">
      <div class="plan-timeline" style="height:${totalH}px"
        ${editable ? `onclick="planTimelineTap(event,'${key}')"` : ''}>
        ${hoursHtml}
        ${eventsHtml}
        ${nowLine}
      </div>
      ${events.length===0 ? `<div class="plan-hint">${editable?'點時間軸新增事件':'這天沒有計畫'}</div>` : ''}
    </div>`;

  _bindPlanSwipe();
}

// 左右滑動切換日
let _planTouchX = null;
function _bindPlanSwipe(){
  const wrap = document.getElementById('plan-timeline-wrap');
  if(!wrap || wrap._swipeBound) return;
  wrap._swipeBound = true;
  wrap.addEventListener('touchstart', e=>{ _planTouchX = e.touches[0].clientX; }, {passive:true});
  wrap.addEventListener('touchend', e=>{
    if(_planTouchX === null) return;
    const dx = e.changedTouches[0].clientX - _planTouchX;
    if(Math.abs(dx) > 60){
      if(dx > 0) planPrevDay(); else planNextDay();
    }
    _planTouchX = null;
  }, {passive:true});
}

function planPrevDay(){ _planOffset--; renderPlan(); }
function planNextDay(){ _planOffset++; renderPlan(); }

// 點時間軸空白處：以該位置的時間新增事件
function planTimelineTap(e, dateKey){
  if(e.target.closest('.plan-event')) return;  // 點到事件不觸發
  const timeline = e.currentTarget;
  const rect = timeline.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const minFromStart = Math.round(y / _PLAN_PXH * 60 / 15) * 15;  // 對齊 15 分鐘
  const startMin = _PLAN_START_H*60 + Math.max(0, minFromStart);
  _openPlanEditor(dateKey, null, startMin);
}

// 開啟事件編輯（新增或修改）
async function openPlanEventEdit(dateKey, eventId){
  _openPlanEditor(dateKey, eventId, null);
}

async function _openPlanEditor(dateKey, eventId, defaultStart){
  const events = await _getPlanEvents(dateKey);
  let ev = eventId ? events.find(x=>x.id===eventId) : null;
  const isNew = !ev;
  if(isNew){
    ev = { id:'e'+Date.now(), title:'', start:defaultStart||540, end:(defaultStart||540)+60, color:_PLAN_COLORS[events.length % _PLAN_COLORS.length] };
  }

  // 建立編輯彈窗
  const ov = document.createElement('div');
  ov.className = 'ov on';
  ov.id = 'plan-editor-ov';
  ov.onclick = (e)=>{ if(e.target===ov) ov.remove(); };
  ov.innerHTML = `
    <div class="sh plan-editor-sheet" onclick="event.stopPropagation()">
      <div class="shdl"></div>
      <div class="sht"><span>${isNew?'新增事件':'編輯事件'}</span>
        <button class="shx" onclick="document.getElementById('plan-editor-ov').remove()">✕</button></div>
      <div style="padding:4px 18px 20px">
        <label class="plan-ed-label">事件名稱</label>
        <input class="plan-ed-input" id="plan-ed-title" value="${_planEsc(ev.title)}" placeholder="例如：複習行政法" maxlength="40">
        <div class="plan-ed-row">
          <div style="flex:1">
            <label class="plan-ed-label">開始</label>
            <input class="plan-ed-input" id="plan-ed-start" type="time" value="${_minToHHMM(ev.start)}">
          </div>
          <div style="flex:1">
            <label class="plan-ed-label">結束</label>
            <input class="plan-ed-input" id="plan-ed-end" type="time" value="${_minToHHMM(ev.end)}">
          </div>
        </div>
        <label class="plan-ed-label">顏色</label>
        <div class="plan-ed-colors" id="plan-ed-colors">
          ${_PLAN_COLORS.map(c=>`<button class="plan-ed-color${c===ev.color?' sel':''}" style="background:${c}" data-color="${c}" onclick="_planPickColor(this)"></button>`).join('')}
        </div>
        <div class="plan-ed-actions">
          ${!isNew ? `<button class="plan-ed-del" onclick="_planDeleteEvent('${dateKey}','${ev.id}')">刪除</button>` : ''}
          <button class="plan-ed-save" onclick="_planSaveEvent('${dateKey}','${ev.id}',${isNew})">儲存</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov._editColor = ev.color;
}

function _planPickColor(btn){
  document.querySelectorAll('#plan-ed-colors .plan-ed-color').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  document.getElementById('plan-editor-ov')._editColor = btn.dataset.color;
}

function _hhmmToMin(s){
  const [h,m] = (s||'0:0').split(':').map(Number);
  return h*60 + m;
}

async function _planSaveEvent(dateKey, eventId, isNew){
  const title = document.getElementById('plan-ed-title').value.trim();
  if(!title){ toast('請輸入事件名稱'); return; }
  const start = _hhmmToMin(document.getElementById('plan-ed-start').value);
  const end   = _hhmmToMin(document.getElementById('plan-ed-end').value);
  if(end <= start){ toast('結束時間需晚於開始'); return; }
  const color = document.getElementById('plan-editor-ov')._editColor || _PLAN_COLORS[0];

  const events = await _getPlanEvents(dateKey);
  if(isNew){
    events.push({ id:eventId, title, start, end, color });
  } else {
    const ev = events.find(x=>x.id===eventId);
    if(ev){ ev.title=title; ev.start=start; ev.end=end; ev.color=color; }
  }
  await _savePlanEvents(dateKey, events);
  _cleanOldPlans();
  document.getElementById('plan-editor-ov')?.remove();
  renderPlan();
}

async function _planDeleteEvent(dateKey, eventId){
  const events = await _getPlanEvents(dateKey);
  const filtered = events.filter(x=>x.id!==eventId);
  await _savePlanEvents(dateKey, filtered);
  document.getElementById('plan-editor-ov')?.remove();
  renderPlan();
}

// 清理 8~14 天前的舊計畫
async function _cleanOldPlans(){
  try{
    for(let i = 8; i <= 14; i++){
      await dd('settings', 'plan_' + _planDateKey(-i)).catch(()=>{});
    }
  }catch(e){}
}
