// ════════════════════════════════════════════════════════════
// 【運動健康庫】成長區 - 健康數據儀表板
// 資料來源：瀏覽器版手動輸入（存 IndexedDB）；
//          Android App 版（v4.57）連接 Health Connect，和三星健康雙向同步（見下方 Health Connect 區）。
// ════════════════════════════════════════════════════════════

// 取得今日日期 key（YYYY-MM-DD）
function _fitTodayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 讀取某日健康數據（store: healthLogs，以日期為 key）
async function _getFitData(dateKey){
  try{
    const row = await dg('healthLogs', dateKey);
    return row || { id:dateKey, activeMin:0, burned:0, intake:0, steps:0, note:'' };
  }catch(e){
    return { id:dateKey, activeMin:0, burned:0, intake:0, steps:0, note:'' };
  }
}


// ════════════════════════════════════════════════════════════
// 【運動健康庫：渲染完整儀表板】
// ════════════════════════════════════════════════════════════
async function renderFitness(){
  const el = document.getElementById('fitness-body');
  if(!el) return;
  const key = _fitTodayKey();
  let d = await _getFitData(key);
  // App 版：連接 Health Connect 後，卡片顯示三星健康的數字（一分鐘內不重複同步）
  const H = _fitHC();
  let hcOn = false;
  if(H){
    if(_fitHcState.status == null) await _fitHcStatus();
    hcOn = _fitHcState.status === 'available' && _fitHcState.read;
    if(hcOn && !_fitHcState.syncing && Date.now() - (_fitHcState.at || +(localStorage.getItem('fit_hc_at') || 0)) > 60000){
      fitHcSync(true).then(ok => { if(ok && document.getElementById('fitness-body')) renderFitness(); });
    }
    if(hcOn && d.hc) d = { ...d, ...d.hc };
  }
  // App 版連三星健康：和三星健康同樣的分法——總燃燒＝基礎代謝＋活動＋健身（健身＝今天各筆運動的熱量）
  const K = hcOn && d.total ? _fitKcal(d) : null;
  // 熱量結餘（攝取 - 消耗；連三星健康時用總燃燒，才是真正的收支）
  const balance = (d.intake||0) - (K ? K.total : (d.burned||0));
  const balColor = balance > 0 ? '#e0a020' : '#4caf7d';
  const balSign  = balance > 0 ? '+' : '';

  el.innerHTML = `
    <!-- 日期 -->
    <div class="fit-date">${_fitDateLabel()}</div>

    <!-- 主數據卡（雙擊卡片可編輯數值）-->
    <div class="fit-grid">
      <div class="fit-card fit-card-move" ondblclick="editFitField('activeMin','運動時長','分')">
        <div class="fit-card-ico">🏃</div>
        <div class="fit-card-val" id="fit-active">${d.activeMin||0}<span class="fit-card-unit">分</span></div>
        <div class="fit-card-lab">運動時長</div>
      </div>
      <div class="fit-card fit-card-burn" ondblclick="editFitField('burned','消耗熱量','kcal')">
        <div class="fit-card-ico">🔥</div>
        <div class="fit-card-val" id="fit-burned">${K ? K.total : (d.burned||0)}<span class="fit-card-unit">kcal</span></div>
        <div class="fit-card-lab">${K ? '總燃燒熱量' : '消耗熱量'}</div>
      </div>
      <div class="fit-card fit-card-intake" ondblclick="editFitField('intake','攝取熱量','kcal')">
        <div class="fit-card-ico">🍽️</div>
        <div class="fit-card-val" id="fit-intake">${d.intake||0}<span class="fit-card-unit">kcal</span></div>
        <div class="fit-card-lab">攝取熱量</div>
      </div>
      <div class="fit-card fit-card-steps" ondblclick="editFitField('steps','步數','步')">
        <div class="fit-card-ico">👟</div>
        <div class="fit-card-val" id="fit-steps">${d.steps||0}<span class="fit-card-unit">步</span></div>
        <div class="fit-card-lab">步數</div>
      </div>
    </div>
    ${K ? _fitKcalHtml(K) : ''}
    <div class="fit-edit-hint">${hcOn ? '💡 數字來自三星健康；點「記一筆運動／飲食」新增，步數由手機或手錶自動記錄' : '💡 雙擊上方卡片即可編輯數值'}</div>

    <!-- 熱量結餘 -->
    <div class="fit-balance">
      <span class="fit-balance-lab">今日熱量結餘${K ? '<small>攝取－總燃燒</small>' : ''}</span>
      <span class="fit-balance-val" style="color:${balColor}">${balSign}${balance} kcal</span>
    </div>
    <div class="fit-balance-hint">
      ${balance > 0 ? '攝取大於消耗，呈熱量盈餘' : balance < 0 ? '消耗大於攝取，呈熱量赤字' : '收支平衡'}
    </div>

    ${H ? await _fitHcHtml() : `<!-- 資料來源提示（開啟健康 App 功能已移至頂部按鈕）-->
    <div class="fit-source">
      <div class="fit-source-row">
        <span>📲 資料來源</span>
      </div>
      <div class="fit-source-note">
        網頁版為手動記錄。Android App 版可連接三星健康（Health Connect），步數、運動、熱量自動帶入，在 App 記的運動和飲食也會寫回三星健康。
      </div>
    </div>`}

    <!-- 手動記錄改為雙擊卡片編輯，已移除底部輸入區 -->
  `;
}

// 熱量拆解（和三星健康的「總計燃燒／活動消耗／健身」對得起來）
function _fitKcal(d){
  const total = d.total || 0, basal = d.basal || 0, move = d.burned || 0;   // move＝總燃燒－基礎代謝（活動＋健身）
  const ex = d.id === _fitTodayKey() ? Math.min(move, (_fitHcState.sessions || []).reduce((n, m) => n + (m.kcal || 0), 0)) : 0;
  return { total, basal, move, ex, act:Math.max(0, move - ex), noBmr:!basal };
}
function _fitKcalHtml(K){
  const pct = v => K.total ? Math.max(0, Math.min(100, v / K.total * 100)).toFixed(1) + '%' : '0';
  if(K.noBmr) return `<div class="fit-kcal"><div class="fit-kcal-row"><span>總燃燒熱量</span><b>${K.total} kcal</b></div>
    <div class="fit-kcal-note">還沒有基礎代謝資料，分不出活動消耗；請在下方按「重新授權」。</div></div>`;
  return `<div class="fit-kcal">
    <div class="fit-kcal-bar"><i class="b" style="width:${pct(K.basal)}"></i><i class="a" style="width:${pct(K.act)}"></i><i class="e" style="width:${pct(K.ex)}"></i></div>
    <div class="fit-kcal-leg">
      <div><span class="dot b"></span>基礎代謝<b>${K.basal}</b></div>
      <div><span class="dot a"></span>活動消耗<b>${K.act}</b></div>
      <div><span class="dot e"></span>健身<b>${K.ex}</b></div>
    </div>
    <div class="fit-kcal-note">總燃燒 ${K.total}＝基礎代謝＋活動消耗＋健身（和三星健康同樣的分法，今天只算到現在）</div>
  </div>`;
}

function _fitDateLabel(){
  const d = new Date();
  const wd = ['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getMonth()+1}月${d.getDate()}日　星期${wd}`;
}

// 儲存今日手動數據
// ════════════════════════════════════════════════════════════
// 【運動健康庫：儲存今日數據】
// ════════════════════════════════════════════════════════════
// 雙擊卡片：彈出輸入框編輯單一欄位
async function editFitField(field, label, unit){
  // App 版已連接 Health Connect：改成記一筆（寫進三星健康），步數不手動改
  if(_fitHC() && _fitHcState.read){
    if(field === 'steps'){ toast('步數由手機或手錶自動記錄，要修改請到三星健康'); return; }
    if(field === 'intake') return fitAddFood();
    return fitAddExercise();
  }
  const key = _fitTodayKey();
  const cur = await _getFitData(key);
  const input = await askInput(`今日${label}`, `單位：${unit}`, cur[field] || '', {type:'number', placeholder:'0', okText:'儲存'});
  if(input === null) return;  // 取消
  const v = parseInt(input);
  const val = isNaN(v) ? 0 : Math.max(0, v);
  const data = {
    id:        key,
    activeMin: cur.activeMin || 0,
    burned:    cur.burned || 0,
    intake:    cur.intake || 0,
    steps:     cur.steps || 0,
    updatedAt: Date.now(),
  };
  data[field] = val;
  try{
    await dp('healthLogs', data);
    _cleanOldHealthLogs();
    toast(`已更新${label}`);
    renderFitness();
  }catch(e){
    logError('editFitField', e);
    toast('儲存失敗：'+e.message);
  }
}

// 清理超過 30 天的健康資料（與其他歷史一致，只留 30 天）
async function _cleanOldHealthLogs(){
  try{
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30);
    const all = await da('healthLogs');
    for(const row of all){
      if(row.id && new Date(row.id) < cutoff){
        await dd('healthLogs', row.id);
      }
    }
  }catch(e){ /* 清理失敗不影響主流程 */ }
}

// 開啟三星健康 App
// Capacitor 包殼後：用原生 AppLauncher 外掛直接開啟（最佳）
// 純網頁環境：嘗試 deep link，但不導向商店（避免跑到 Play 商店）
// ════════════════════════════════════════════════════════════
// 【運動健康庫：開啟三星健康 App】
// ════════════════════════════════════════════════════════════
async function openHealthApp(){
  const pkg = 'com.sec.android.app.shealth';
  // 1) App 版：原生外掛直接開啟三星健康
  if(_fitHC()){
    try{ await _fitHC().openSamsungHealth(); }catch(e){ toast(e.message || '找不到三星健康，請確認已安裝'); }
    return;
  }
  // 2) 純網頁環境：用 intent 但不帶 Play 商店 fallback
  // （S Browser/Chrome 上若已裝 app 會直接開，未裝則無動作，不會跳商店）
  try{
    const intent = `intent://com.sec.android.app.shealth/#Intent;scheme=samsunghealth;package=${pkg};end`;
    const a = document.createElement('a');
    a.href = intent;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>a.remove(), 100);
  }catch(e){}
  // 提示（網頁環境本就難直接開啟其他 app）
  setTimeout(()=>{
    toast('網頁版較難直接開啟；打包成 App 後可一鍵開啟三星健康');
  }, 600);
}

// ════════════════════════════════════════════════════════════
// 【運動健康庫 × Health Connect（三星健康）】v4.57.0，只在 Android App 版
//   Health Connect 是 Android 的健康資料中心：三星健康會把步數、運動、消耗熱量、飲食同步進去，也會讀其他 App 寫的。
//   ・讀：今天和最近 7 天的步數、運動時間、消耗熱量、攝取熱量（存進 healthLogs 的 hc 欄位，離線也看得到）
//   ・寫：在這裡「記一筆運動」「記一筆飲食」→ 寫進 Health Connect（三星健康有開啟讀取就會看到）
//   ・步數由手機／手錶自動量，這裡不改；只能刪除本 App 寫的紀錄
// ════════════════════════════════════════════════════════════
function _fitHC(){
  const C = window.Capacitor;
  return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.YcHealth) || null;
}
const _FIT_TYPES = [['walk', '🚶 走路'], ['run', '🏃 跑步'], ['bike', '🚴 騎車'], ['swim', '🏊 游泳'], ['strength', '🏋️ 重量訓練'], ['yoga', '🧘 瑜伽'], ['hike', '🥾 健行'], ['other', '💪 其他運動']];
const _FIT_MEALS = [[1, '早餐'], [2, '午餐'], [3, '晚餐'], [4, '點心']];
const _fitHcState = { status:null, read:false, write:false, bmr:false, syncing:false, at:0, err:'', sessions:null };

async function _fitHcStatus(){
  const H = _fitHC(); if(!H) return null;
  try{ Object.assign(_fitHcState, await H.status(), { err:'' }); }
  catch(e){ _fitHcState.err = e.message || String(e); }
  return _fitHcState;
}
// 從 Health Connect 讀最近 7 天，存進 healthLogs（每天一筆的 hc 欄位）
async function fitHcSync(quiet){
  const H = _fitHC(); if(!H || _fitHcState.syncing) return false;
  _fitHcState.syncing = true;
  try{
    const r = await H.days({ days:7 });
    for(const d of r.days || []){
      const cur = await _getFitData(d.date);
      // 消耗＝活動消耗（三星健康沒寫活動消耗時＝總消耗－基礎代謝）；total／basal 另存，卡片下方顯示
      cur.hc = { steps:d.steps || 0, activeMin:d.activeMin || 0, burned:d.active || 0, src:d.activeSrc || '', total:d.total || 0, basal:d.basal || 0, intake:d.intake || 0 };
      cur.hcAt = Date.now(); cur.updatedAt = Date.now();
      await dp('healthLogs', cur);
    }
    _fitHcState.sessions = r.sessions || []; _fitHcState.bmr = !!r.bmr;
    _fitHcState.at = Date.now(); _fitHcState.err = '';
    try{ localStorage.setItem('fit_hc_at', String(_fitHcState.at)); }catch(_){}
    if(!quiet) toast('已從 Health Connect 同步');
    return true;
  }catch(e){
    _fitHcState.err = e.message || String(e);
    if(!quiet) toast('同步失敗：' + _fitHcState.err);
    return false;
  }finally{ _fitHcState.syncing = false; }
}
async function fitHcConnect(){
  const H = _fitHC(); if(!H) return;
  try{
    const r = await H.connect();
    Object.assign(_fitHcState, r);
    if(r.read){ toast('已連接 Health Connect'); await fitHcSync(true); }
    else toast('沒有取得讀取權限，可到「權限設定」開啟');
  }catch(e){ toast(e.message || String(e)); }
  renderFitness();
}
function fitHcSettings(){ _fitHC()?.openSettings().catch(e => toast(e.message)); }

// 今天本 App 寫進 Health Connect 的紀錄
async function _fitHcMine(){
  const H = _fitHC(); if(!H || !_fitHcState.read) return [];
  try{ return (await H.mine({ date:_fitTodayKey() })).items || []; }catch(e){ return []; }
}
const _fitHm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// App 版的健康區塊（連接狀態、記一筆、今天記的、最近 7 天）
async function _fitHcHtml(){
  const st = _fitHcState;
  if(st.status === 'unavailable') return `<div class="fit-hc"><div class="fit-hc-t">Health Connect</div>
    <div class="fit-source-note">這台手機沒有 Health Connect（Android 14 以上內建；Android 13 以下要從 Play 商店安裝「Health Connect」）。目前維持手動記錄。</div></div>`;
  if(st.status === 'update') return `<div class="fit-hc"><div class="fit-hc-t">Health Connect</div>
    <div class="fit-source-note">Health Connect 需要更新，請到 Play 商店更新後再回來連接。</div></div>`;
  if(!st.read) return `<div class="fit-hc"><div class="fit-hc-t">連接三星健康（Health Connect）</div>
    <div class="fit-source-note">連接後，步數、運動、消耗熱量、飲食會從三星健康自動帶進來；在這裡記的運動和飲食也會寫回去。<br>
    三星健康要先開同步：三星健康 → 設定 → Health Connect → 允許三星健康讀取和寫入。</div>
    <div class="fit-hc-btns"><button class="fit-hc-btn pri" onclick="fitHcConnect()">連接</button><button class="fit-hc-btn" onclick="fitHcSettings()">權限設定</button></div></div>`;
  const mine = (await _fitHcMine()).filter(m => m.kind === 'food');
  const ses = st.sessions || [];
  const days = (await da('healthLogs').catch(()=>[])).filter(r => r.hc).sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 7);
  const at = st.at || +(localStorage.getItem('fit_hc_at') || 0);
  return `<div class="fit-hc">
    <div class="fit-hc-t">三星健康（Health Connect）<span class="fit-hc-s">${st.syncing ? '同步中…' : at ? _fitAgo(at) + '同步' : ''}${st.write ? '' : '・沒有寫入權限'}</span></div>
    <div class="fit-hc-btns">
      <button class="fit-hc-btn pri" onclick="fitAddExercise()"${st.write ? '' : ' disabled'}>＋ 記一筆運動</button>
      <button class="fit-hc-btn pri" onclick="fitAddFood()"${st.write ? '' : ' disabled'}>＋ 記一筆飲食</button>
      <button class="fit-hc-btn" onclick="fitHcSync().then(renderFitness)">↻ 同步</button>
      <button class="fit-hc-btn" onclick="fitHcSettings()">權限設定</button>
    </div>
    ${st.bmr ? '' : `<div class="fit-hc-warn">三星健康只提供「總消耗」，要算出活動消耗還需要讀取「基礎代謝率」的權限。<button class="fit-hc-btn pri" onclick="fitHcConnect()">重新授權</button></div>`}
    ${ses.length ? `<div class="fit-hc-sub">今天的運動</div>` + ses.map(m => `<div class="fit-hc-row">
        <span>${(_FIT_TYPES.find(t => t[0] === m.type) || ['', '💪 運動'])[1]} ${m.minutes} 分${m.kcal ? '・' + m.kcal + ' kcal' : ''}<small>${_fitHm(m.start)}～${_fitHm(m.end)}・${m.mine ? '本 App 記的' : esc(m.app)}${m.title ? '・' + esc(m.title) : ''}</small></span>
        ${m.mine ? `<button onclick="fitHcRemove('exercise','${escJs(m.id)}','${escJs(m.cid || '')}')" aria-label="刪除">✕</button>` : ''}</div>`).join('') : ''}
    ${mine.length ? `<div class="fit-hc-sub">今天在這裡記的飲食</div>` + mine.sort((a, b) => a.start - b.start).map(m => `<div class="fit-hc-row">
        <span>🍽️ ${((_FIT_MEALS.find(x => x[0] === m.meal) || [0, ''])[1] || '飲食') + (m.title ? '・' + esc(m.title) : '')}・${m.kcal} kcal<small>${_fitHm(m.start)}</small></span>
        <button onclick="fitHcRemove('food','${escJs(m.id)}','')" aria-label="刪除">✕</button></div>`).join('') : ''}
    ${days.length > 1 ? `<div class="fit-hc-sub">最近 ${days.length} 天</div><table class="fit-hc-tb"><tr><th>日期</th><th>步數</th><th>運動</th><th>總燃燒</th><th>活動＋健身</th><th>攝取</th></tr>
      ${days.map(r => `<tr><td>${r.id.slice(5).replace('-', '/')}</td><td>${(r.hc.steps || 0).toLocaleString()}</td><td>${r.hc.activeMin || 0} 分</td><td>${r.hc.total || 0}</td><td>${r.hc.burned || 0}</td><td>${r.hc.intake || 0}</td></tr>`).join('')}</table>` : ''}
    ${st.err ? `<div class="fit-source-note" style="color:var(--red)">${esc(st.err)}</div>` : ''}
  </div>`;
}
function _fitAgo(t){ const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? '剛剛' : m < 60 ? m + ' 分鐘前' : Math.floor(m / 60) + ' 小時前'; }

async function fitHcRemove(kind, id, cid){
  if(!await askConfirm('刪除這筆紀錄', '從 Health Connect 刪除（三星健康裡同步過去的也會一起不見）。', '刪除')) return;
  try{ await _fitHC().remove({ kind, id, cid }); toast('已刪除'); await fitHcSync(true); }
  catch(e){ toast('刪除失敗：' + (e.message || e)); }
  renderFitness();
}
// 記一筆運動：種類、時間（分）、消耗熱量（選填）、結束時間（預設現在）
function fitAddExercise(){
  const ov = _fitSheet('記一筆運動', `
    <label class="yt-lb">種類</label>
    <div class="fit-types">${_FIT_TYPES.map(([k, n], i) => `<button data-t="${k}" class="${i === 0 ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===this))">${n}</button>`).join('')}</div>
    <label class="yt-lb">運動時間（分鐘）</label><input id="fx-min" class="finput" type="number" inputmode="numeric" min="1" placeholder="例如 30">
    <label class="yt-lb">消耗熱量（kcal，選填）</label><input id="fx-kcal" class="finput" type="number" inputmode="numeric" min="0" placeholder="不知道可以不填">
    <label class="yt-lb">什麼時候結束</label><input id="fx-end" class="finput" type="time" value="${_fitHm(Date.now())}">
    <label class="yt-lb">備註（選填）</label><input id="fx-title" class="finput" placeholder="例如：體能訓練、晨跑">`, async () => {
    const minutes = parseInt(document.getElementById('fx-min').value), kcal = parseFloat(document.getElementById('fx-kcal').value) || 0;
    if(!(minutes > 0)){ toast('請填運動時間'); return false; }
    const [h, m] = (document.getElementById('fx-end').value || _fitHm(Date.now())).split(':').map(Number);
    const end = new Date(); end.setHours(h || 0, m || 0, 0, 0);
    if(end.getTime() > Date.now() + 60000){ toast('結束時間不能晚於現在'); return false; }
    await _fitHC().addExercise({ type:ov.querySelector('.fit-types .on')?.dataset.t || 'other', minutes, kcal, endMs:end.getTime(),
      title:document.getElementById('fx-title').value.trim() });
    toast('已記錄，並寫入 Health Connect');
  });
}
function fitAddFood(){
  const h = new Date().getHours(), def = h < 10 ? 1 : h < 15 ? 2 : h < 21 ? 3 : 4;
  const ov = _fitSheet('記一筆飲食', `
    <label class="yt-lb">哪一餐</label>
    <div class="fit-types">${_FIT_MEALS.map(([k, n]) => `<button data-m="${k}" class="${k === def ? 'on' : ''}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===this))">${n}</button>`).join('')}</div>
    <label class="yt-lb">熱量（kcal）</label><input id="ff-kcal" class="finput" type="number" inputmode="numeric" min="1" placeholder="例如 650">
    <label class="yt-lb">吃了什麼（選填）</label><input id="ff-name" class="finput" placeholder="例如：雞腿便當">`, async () => {
    const kcal = parseFloat(document.getElementById('ff-kcal').value);
    if(!(kcal > 0)){ toast('請填熱量'); return false; }
    await _fitHC().addFood({ kcal, name:document.getElementById('ff-name').value.trim(), meal:+(ov.querySelector('.fit-types .on')?.dataset.m || 0) });
    toast('已記錄，並寫入 Health Connect');
  });
}
function _fitSheet(title, body, onSave){
  document.getElementById('fit-sheet-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'fit-sheet-ov';
  ov.className = 'media-ov-sheet z700-d';
  ov.innerHTML = `<div class="yt-sheet yt-edit"><div class="yt-sheet-hd"><div class="yt-sheet-title">${title}</div>
      <button class="yt-x" aria-label="關閉">✕</button></div>${body}
      <div class="yt-edit-btns"><button class="yt-btn" data-x>取消</button><button class="yt-btn pri" data-ok>儲存</button></div></div>`;
  ov.querySelector('.yt-x').onclick = ov.querySelector('[data-x]').onclick = () => ov.remove();
  ov.querySelector('[data-ok]').onclick = async e => {
    const b = e.currentTarget; if(b.disabled) return; b.disabled = true;
    try{ if(await onSave() === false){ b.disabled = false; return; } ov.remove(); await fitHcSync(true); renderFitness(); }
    catch(err){ b.disabled = false; toast('寫入失敗：' + (err.message || err)); }
  };
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
  return ov;
}
