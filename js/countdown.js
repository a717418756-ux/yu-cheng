// ── countdown.js：考試倒數功能 ──────────────────────────────────────
// 依賴：db.js（getCountdowns, saveCountdowns, setSetting）, utils.js（esc, toast）
// 儲存：IndexedDB 'countdowns' store / 'settings' store
//
// v2.8.1 重構：IIFE 模組化 + 事件委派（設定頁刪除鈕、彈窗按鈕）
// 公開 API：Countdown.* 與相容別名 renderCountdown / renderSetCountdown /
//           openCountdownMgr / editMotto

(function(){
'use strict';

// 計算距離考試的天數
function _daysUntil(dateStr){
  const now  = new Date(); now.setHours(0,0,0,0);
  const exam = new Date(dateStr); exam.setHours(0,0,0,0);
  return Math.round((exam - now) / 86400000);
}

// 渲染倒數區塊（首頁）
async function renderCountdown(){
  const el = document.getElementById('h-countdown');
  if(!el) return;
  const list = (await getCountdowns()).sort((a,b)=>new Date(a.date)-new Date(b.date));

  if(!list.length){
    el.innerHTML = '<div class="hcd-hint">尚未新增考試，可至設定頁新增 →</div>';
    return;
  }

  el.innerHTML = list.map(item=>{
    const days = _daysUntil(item.date);
    const isPast  = days < 0;
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
async function renderSetCountdown(){
  const el = document.getElementById('set-countdown');
  if(!el) return;
  _bindSetDelegation(el);
  const list = (await getCountdowns()).sort((a,b)=>new Date(a.date)-new Date(b.date));
  if(!list.length){
    el.innerHTML = '<div style="color:var(--t2);font-size:13px;padding:4px 0 2px">尚未新增考試</div>';
    return;
  }
  el.innerHTML = list.map(item=>{
    const days = _daysUntil(item.date);
    const isPast  = days < 0;
    const isToday = days === 0;
    const col = isPast ? 'var(--t2)' : isToday ? 'var(--red)' : days<=7 ? 'var(--org)' : 'var(--acc)';
    const bg  = isPast ? 'var(--bg2)' : isToday ? 'rgba(248,81,73,0.10)' : days<=7 ? 'rgba(227,179,65,0.10)' : 'rgba(88,166,255,0.08)';
    const label = isPast ? `已過 ${Math.abs(days)} 天` : isToday ? '就是今天！' : `還有 ${days} 天`;
    const icon  = isPast ? '📋' : isToday ? '🎯' : days<=7 ? '🔥' : '📅';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)">
      <div style="width:34px;height:34px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--t0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:2px">${esc(item.date)} · <span style="color:${col};font-weight:600">${label}</span></div>
      </div>
      <button class="cd-del" data-id="${esc(String(item.id))}" style="background:none;border:none;color:var(--t2);font-size:18px;cursor:pointer;padding:4px 2px;flex-shrink:0;opacity:.7" title="刪除">×</button>
    </div>`;
  }).join('');
}

// 設定頁刪除鈕：事件委派（容器只綁一次）
function _bindSetDelegation(el){
  if(el._cdBound) return;
  el._cdBound = true;
  el.addEventListener('click', e=>{
    const btn = e.target.closest('.cd-del');
    if(btn && btn.dataset.id !== undefined) delCountdownSet(btn.dataset.id);
  });
}

async function delCountdownSet(id){
  const list = (await getCountdowns()).filter(i=>String(i.id)!==String(id));
  await saveCountdowns(list);
  renderCountdown();
  renderSetCountdown();
  toast('已刪除');
}

// 新增考試 bottom sheet
function openCountdownMgr(){
  const existing = document.getElementById('countdown-add-modal');
  if(existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'countdown-add-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML = `
    <div class="cd-sheet" style="width:100%;max-width:520px;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 18px 36px;animation:sup .23s cubic-bezier(.4,0,.2,1)">
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
        <button class="btn bg" data-cd="cancel" style="flex:1;padding:13px">取消</button>
        <button class="btn bp" data-cd="save" style="flex:2;padding:13px;font-size:14px">＋ 新增</button>
      </div>
    </div>`;
  // 事件委派：點背景關閉、取消、儲存（sheet 內點擊不冒泡到背景關閉邏輯）
  modal.addEventListener('click', e=>{
    if(e.target === modal){ modal.remove(); return; }
    const btn = e.target.closest('[data-cd]');
    if(!btn) return;
    if(btn.dataset.cd === 'cancel') modal.remove();
    else if(btn.dataset.cd === 'save') _saveCountdownFromModal();
  });
  document.body.appendChild(modal);
  setTimeout(()=>document.getElementById('cd-name')?.focus(), 300);
}

async function _saveCountdownFromModal(){
  const name    = (document.getElementById('cd-name')?.value||'').trim();
  const dateStr = (document.getElementById('cd-date')?.value||'').trim();
  if(!name){ toast('請填寫考試名稱'); return; }
  if(!dateStr){ toast('請選擇考試日期'); return; }
  const list = await getCountdowns();
  list.push({name, date:dateStr});
  await saveCountdowns(list);
  document.getElementById('countdown-add-modal')?.remove();
  renderCountdown();
  renderSetCountdown();
  toast('已新增「'+name+'」');
}

// ── 勉勵語編輯 ──────────────────────────────────────────────
async function editMotto(){
  const el = document.getElementById('h-motto');
  if(!el) return;
  const cur = el.textContent.trim();
  const nv = prompt('輸入你的備考勉勵語：', cur);
  if(nv === null) return;
  const val = nv.trim() || '備考如磨刃，臨陣方知銳';
  el.textContent = val;
  await setSetting('examMotto', val);
  toast('勉勵語已更新 ✓');
}

// ════════ 公開 API ════════
const Countdown = { renderCountdown, renderSetCountdown, openCountdownMgr, editMotto };
window.Countdown = Countdown;
Object.assign(window, Countdown);

})();
