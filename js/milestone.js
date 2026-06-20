// ════════════════════════════════════════════════════════════
// 【複習里程碑】分階段複習計畫（第一/二/三階段、總複習…）
// 資料存 settings：milestones = [{id,name,start,end}]（start/end=YYYY-MM-DD）
// 顯示各階段起訖、目前所在階段、該階段剩餘天數與進度
// ════════════════════════════════════════════════════════════

const _MS_DEFAULT = [];

async function _getMilestones(){
  try{
    const v = await getSetting('milestones');
    if(Array.isArray(v)) return v;
  }catch(e){}
  return [..._MS_DEFAULT];
}

function _msToday(){
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _msParse(s){
  if(!s) return null;
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function _msDaysBetween(a, b){
  return Math.round((b - a) / 86400000);
}

async function renderMilestones(){
  const body = document.getElementById('ms-body');
  if(!body) return;
  const list = await _getMilestones();

  if(!list.length){
    body.innerHTML = `<div class="ms-empty">尚未設定複習階段，點右上角設定<br><span class="ms-empty-eg">例如：第一階段複習、第二階段、總複習</span></div>`;
    return;
  }

  // 依開始日排序
  const sorted = [...list].filter(m=>m.start && m.end).sort((a,b)=> _msParse(a.start) - _msParse(b.start));
  const today = _msToday();

  body.innerHTML = sorted.map(m=>{
    const s = _msParse(m.start), e = _msParse(m.end);
    const total = Math.max(1, _msDaysBetween(s, e));
    const elapsed = _msDaysBetween(s, today);
    const remain = _msDaysBetween(today, e);

    let status, pct, statusClass;
    if(today < s){
      // 未開始
      status = `${_msDaysBetween(today, s)} 天後開始`;
      pct = 0; statusClass = 'upcoming';
    } else if(today > e){
      // 已結束
      status = '已完成';
      pct = 100; statusClass = 'done';
    } else {
      // 進行中
      status = `剩 ${remain} 天`;
      pct = Math.min(100, Math.round(elapsed / total * 100));
      statusClass = 'active';
    }

    const sLabel = `${s.getMonth()+1}/${s.getDate()}`;
    const eLabel = `${e.getMonth()+1}/${e.getDate()}`;

    return `
      <div class="ms-item ms-${statusClass}">
        <div class="ms-item-top">
          <span class="ms-name">${_msEsc(m.name)}</span>
          <span class="ms-status ms-status-${statusClass}">${status}</span>
        </div>
        <div class="ms-bar"><div class="ms-bar-fill" style="width:${pct}%"></div></div>
        <div class="ms-dates">${sLabel} – ${eLabel}　·　共 ${total} 天</div>
      </div>`;
  }).join('');
}

function _msEsc(s){
  return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// ── 設定彈窗 ──────────────────────────────────────────────
async function openMilestoneEdit(){
  const list = await _getMilestones();
  const ov = document.createElement('div');
  ov.className = 'ov on';
  ov.id = 'ms-edit-ov';
  ov.onclick = (e)=>{ if(e.target===ov) ov.remove(); };
  ov.innerHTML = `
    <div class="sh" onclick="event.stopPropagation()" style="max-width:480px">
      <div class="shdl"></div>
      <div class="sht"><span>複習階段設定</span>
        <button class="shx" onclick="document.getElementById('ms-edit-ov').remove()">\u2715</button></div>
      <div style="padding:4px 18px 24px" id="ms-edit-list"></div>
    </div>`;
  document.body.appendChild(ov);
  _renderMsEditList(list);
}

function _renderMsEditList(list){
  const box = document.getElementById('ms-edit-list');
  if(!box) return;
  let html = list.map((m,i)=>`
    <div class="ms-ed-item">
      <input class="ms-ed-name" placeholder="階段名稱（如：第一階段複習）" value="${_msEsc(m.name)}" data-i="${i}" oninput="_msEditField(${i},'name',this.value)">
      <div class="ms-ed-dates">
        <input class="ms-ed-date" type="date" value="${m.start||''}" oninput="_msEditField(${i},'start',this.value)">
        <span class="ms-ed-sep">至</span>
        <input class="ms-ed-date" type="date" value="${m.end||''}" oninput="_msEditField(${i},'end',this.value)">
      </div>
      <button class="ms-ed-del" onclick="_msDeleteStage(${i})">刪除此階段</button>
    </div>`).join('');
  html += `<button class="ms-ed-add" onclick="_msAddStage()">＋ 新增階段</button>`;
  html += `<button class="ms-ed-save" onclick="_msSaveStages()">儲存</button>`;
  box.innerHTML = html;
  box._list = list;
}

function _msEditField(i, field, val){
  const box = document.getElementById('ms-edit-list');
  if(box && box._list && box._list[i]){ box._list[i][field] = val; }
}

function _msAddStage(){
  const box = document.getElementById('ms-edit-list');
  const list = box._list || [];
  list.push({ id:'m'+Date.now(), name:'', start:'', end:'' });
  _renderMsEditList(list);
}

function _msDeleteStage(i){
  const box = document.getElementById('ms-edit-list');
  const list = box._list || [];
  list.splice(i,1);
  _renderMsEditList(list);
}

async function _msSaveStages(){
  const box = document.getElementById('ms-edit-list');
  const list = (box._list || []).filter(m=> m.name.trim() && m.start && m.end);
  // 驗證起訖
  for(const m of list){
    if(_msParse(m.end) < _msParse(m.start)){
      toast(`「${m.name}」的結束日早於開始日`); return;
    }
  }
  try{
    await setSetting('milestones', list);
    toast('已儲存複習階段');
    document.getElementById('ms-edit-ov')?.remove();
    renderMilestones();
  }catch(e){ logError('msSave', e); toast('儲存失敗'); }
}
