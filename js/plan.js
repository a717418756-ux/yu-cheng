// ════════════════════════════════════════════════════════════
// 【三日計畫表】昨日/今日唯讀，明日可編輯
// 資料存 settings：plan_YYYY-MM-DD（純文字，多行）
// ════════════════════════════════════════════════════════════

function _planDateKey(offset){
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _planLabel(offset){
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const wd = ['日','一','二','三','四','五','六'][d.getDay()];
  const md = `${d.getMonth()+1}/${d.getDate()}`;
  const name = offset === -1 ? '昨日' : offset === 0 ? '今日' : '明日';
  return { name, md, wd };
}

async function _getPlan(dateKey){
  try{
    const v = await getSetting('plan_' + dateKey);
    return typeof v === 'string' ? v : '';
  }catch(e){ return ''; }
}

async function renderPlan(){
  const body = document.getElementById('plan-body');
  if(!body) return;

  const days = [
    { offset:-1, editable:false },
    { offset: 0, editable:false },
    { offset: 1, editable:true  },
  ];

  let html = '';
  for(const day of days){
    const key = _planDateKey(day.offset);
    const lbl = _planLabel(day.offset);
    const content = await _getPlan(key);
    const isToday = day.offset === 0;

    if(day.editable){
      // 明日：可編輯
      html += `
        <div class="plan-day plan-day-edit">
          <div class="plan-day-head">
            <span class="plan-day-name">${lbl.name}</span>
            <span class="plan-day-date">${lbl.md}（${lbl.wd}）</span>
            <svg class="plan-edit-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </div>
          <textarea class="plan-textarea" id="plan-input-${key}"
            placeholder="規劃明日的學習計畫…&#10;每行一項"
            oninput="savePlanDebounced('${key}', this.value)">${_planEsc(content)}</textarea>
        </div>`;
    } else {
      // 昨/今：唯讀
      const lines = content.trim()
        ? content.trim().split('\n').filter(l=>l.trim()).map(l=>
            `<div class="plan-line">${_planEsc(l.trim())}</div>`).join('')
        : `<div class="plan-empty-line">— 無計畫 —</div>`;
      html += `
        <div class="plan-day${isToday?' plan-day-today':''}">
          <div class="plan-day-head">
            <span class="plan-day-name">${lbl.name}</span>
            <span class="plan-day-date">${lbl.md}（${lbl.wd}）</span>
          </div>
          <div class="plan-day-content">${lines}</div>
        </div>`;
    }
  }
  body.innerHTML = html;
}

function _planEsc(s){
  return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// 防抖儲存（編輯明日計畫）
let _planSaveTimer = null;
function savePlanDebounced(dateKey, text){
  clearTimeout(_planSaveTimer);
  _planSaveTimer = setTimeout(async()=>{
    try{ await setSetting('plan_' + dateKey, text); }catch(e){ logError('savePlan', e); }
    _cleanOldPlans();
  }, 500);
}

// 清理超過 7 天的舊計畫（只保留近期）
async function _cleanOldPlans(){
  try{
    const cutoff = _planDateKey(-7);
    // settings 無法列舉，改為清理已知範圍（昨日之前的逐日檢查 8~14 天前）
    for(let i = 8; i <= 14; i++){
      const oldKey = _planDateKey(-i);
      await dd('settings', 'plan_' + oldKey).catch(()=>{});
    }
  }catch(e){}
}
