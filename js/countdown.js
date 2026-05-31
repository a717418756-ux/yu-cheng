// ── countdown.js：考試倒數功能 ──────────────────────────────────────
// 依賴：utils.js（esc, today）
// 儲存：localStorage 'examCountdowns' = [{id, name, date}]

const COUNTDOWN_KEY = 'examCountdowns';

function _loadCountdowns(){
  try{ return JSON.parse(localStorage.getItem(COUNTDOWN_KEY)||'[]'); }
  catch(e){ return []; }
}
function _saveCountdowns(list){
  try{ localStorage.setItem(COUNTDOWN_KEY, JSON.stringify(list)); }
  catch(e){}
}

// 計算距離考試的天數
function _daysUntil(dateStr){
  const now  = new Date(); now.setHours(0,0,0,0);
  const exam = new Date(dateStr); exam.setHours(0,0,0,0);
  return Math.round((exam - now) / 86400000);
}

// 渲染倒數區塊（首頁：無框純文字樣式）
function renderCountdown(){
  const el = document.getElementById('h-countdown');
  if(!el) return;
  const list = _loadCountdowns().sort((a,b)=>new Date(a.date)-new Date(b.date));

  if(!list.length){
    el.innerHTML = '<div class="hcd-hint">尚未新增考試，可至設定頁新增 →</div>';
    return;
  }

  el.innerHTML = list.map(item=>{
    const days = _daysUntil(item.date);
    const isPast = days < 0;
    const isToday = days === 0;
    const col  = isPast ? 'var(--t2)' : isToday ? 'var(--red)' : days<=7 ? 'var(--org)' : 'var(--acc)';
    const icon = isPast ? '📋' : isToday ? '🎯' : days<=7 ? '🔥' : '📅';
    const dayNum = isPast ? `−${Math.abs(days)}` : isToday ? '0' : String(days);
    const unit = isPast ? '天前' : isToday ? '今天' : '天';

    return `<div class="hcd-row">
      <span class="hcd-icon">${icon}</span>
      <span class="hcd-name">${esc(item.name)}</span>
      <span class="hcd-days" style="color:${col}">${dayNum}</span>
      <span class="hcd-unit">${unit}</span>
    </div>`;
  }).join('');
}

// 渲染設定頁的考試倒數區塊
function renderSetCountdown(){
  const el=document.getElementById('set-countdown');
  if(!el)return;
  const list=_loadCountdowns().sort((a,b)=>new Date(a.date)-new Date(b.date));
  if(!list.length){
    el.innerHTML='<div style="color:var(--t2);font-size:13px;padding:4px 0 2px">尚未新增考試</div>';
    return;
  }
  el.innerHTML=list.map(item=>{
    const days=_daysUntil(item.date);
    const isPast=days<0;
    const isToday=days===0;
    const col=isPast?'var(--t2)':isToday?'var(--red)':days<=7?'var(--org)':'var(--acc)';
    const bg=isPast?'var(--bg2)':isToday?'rgba(248,81,73,0.10)':days<=7?'rgba(227,179,65,0.10)':'rgba(88,166,255,0.08)';
    const label=isPast?`已過 ${Math.abs(days)} 天`:isToday?'就是今天！':`還有 ${days} 天`;
    const icon=isPast?'📋':isToday?'🎯':days<=7?'🔥':'📅';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="width:34px;height:34px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--t0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:2px">${item.date} · <span style="color:${col};font-weight:600">${label}</span></div>
      </div>
      <button onclick="delCountdownSet('${item.id}')" style="background:none;border:none;color:var(--t2);font-size:18px;cursor:pointer;padding:4px 2px;flex-shrink:0;opacity:.7" title="刪除">×</button>
    </div>`;
  }).join('');
}

function delCountdownSet(id){
  const list=_loadCountdowns().filter(i=>i.id!==id);
  _saveCountdowns(list);
  renderCountdown();      // 更新首頁
  renderSetCountdown();   // 更新設定頁
  toast('已刪除');
}

// 新增考試 bottom sheet
function openCountdownMgr(){
  const existing=document.getElementById('countdown-add-modal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='countdown-add-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML=`
    <div onclick="event.stopPropagation()" style="width:100%;max-width:520px;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 18px 36px;animation:sup .23s cubic-bezier(.4,0,.2,1)">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 18px"></div>
      <div style="font-size:16px;font-weight:700;color:var(--t0);margin-bottom:18px">📅 新增考試倒數</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label class="fl">考試名稱</label>
          <input id="cd-name" placeholder="例：警佐二類升官等考試" autofocus>
        </div>
        <div>
          <label class="fl">考試日期</label>
          <input id="cd-date" type="date" style="color-scheme:dark">
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn bg" style="flex:1;padding:13px" onclick="document.getElementById('countdown-add-modal').remove()">取消</button>
        <button class="btn bp" style="flex:2;padding:13px;font-size:14px" onclick="_saveCountdownFromModal()">＋ 新增</button>
      </div>
    </div>`;
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(()=>document.getElementById('cd-name')?.focus(),300);
}

function _saveCountdownFromModal(){
  const name=(document.getElementById('cd-name')?.value||'').trim();
  const dateStr=(document.getElementById('cd-date')?.value||'').trim();
  if(!name){toast('請填寫考試名稱');return;}
  if(!dateStr){toast('請選擇考試日期');return;}
  const list=_loadCountdowns();
  list.push({id:Date.now().toString(),name,date:dateStr});
  _saveCountdowns(list);
  document.getElementById('countdown-add-modal')?.remove();
  renderCountdown();
  renderSetCountdown();
  toast('已新增「'+name+'」');
}

// 刪除考試
function delCountdown(id){
  const list = _loadCountdowns().filter(i=>i.id!==id);
  _saveCountdowns(list);
  renderCountdown();
}

// ── 勉勵語編輯 ──────────────────────────────────────────────
function editMotto(){
  const el=document.getElementById('h-motto');
  if(!el)return;
  const cur=el.textContent.trim();
  const nv=prompt('輸入你的備考勉勵語：',cur);
  if(nv===null)return;
  const val=nv.trim()||'備考如磨刃，臨陣方知銳';
  el.textContent=val;
  try{ localStorage.setItem('examMotto',val); }catch(e){}
  toast('勉勵語已更新 ✓');
}


