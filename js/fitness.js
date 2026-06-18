// ════════════════════════════════════════════════════════════
// 【運動健康庫】成長區 - 健康數據儀表板
// 資料來源：目前手動輸入（存 IndexedDB）；未來以 Capacitor 包殼後，
//          可接 Health Connect / 三星健康原生外掛灌入真實數據。
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
// 【運動健康庫：首頁摘要卡】顯示今日數據 + 最近7天趨勢，點擊進完整頁
// ════════════════════════════════════════════════════════════
async function renderFitSummary(){
  const el = document.getElementById('fit-summary');
  if(!el) return;
  const key = _fitTodayKey();
  const d = await _getFitData(key);
  // 最近 7 天運動時長（小長條）
  const bars = [];
  for(let i=6;i>=0;i--){
    const dt = new Date(); dt.setDate(dt.getDate()-i);
    const k = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const row = await _getFitData(k);
    bars.push({ d:`${dt.getMonth()+1}/${dt.getDate()}`, v:row.activeMin||0 });
  }
  const maxV = Math.max(30, ...bars.map(b=>b.v));
  const barsHtml = bars.map(b=>{
    const h = Math.round(b.v/maxV*100);
    return `<div class="fitsum-bar-cell">
      <div class="fitsum-bar-track"><div class="fitsum-bar-fill" style="height:${h}%"></div></div>
      <span class="fitsum-bar-date">${b.d}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="fitsum-header" onclick="goPage('fitness')">
      <span class="fitsum-title">運動健康</span>
      <span class="fitsum-more">詳情 ›</span>
    </div>
    <div class="fitsum-stats">
      <div class="fitsum-stat">
        <span class="fitsum-stat-val">${d.activeMin||0}<small>分</small></span>
        <span class="fitsum-stat-lab">🏃 運動</span>
      </div>
      <div class="fitsum-stat">
        <span class="fitsum-stat-val">${d.burned||0}<small>kcal</small></span>
        <span class="fitsum-stat-lab">🔥 消耗</span>
      </div>
      <div class="fitsum-stat">
        <span class="fitsum-stat-val">${d.intake||0}<small>kcal</small></span>
        <span class="fitsum-stat-lab">🍽️ 攝取</span>
      </div>
    </div>
    <div class="fitsum-trend">
      <div class="fitsum-trend-row">${barsHtml}</div>
      <div class="fitsum-trend-lab">近 7 日運動時長</div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 【運動健康庫：渲染完整儀表板】
// ════════════════════════════════════════════════════════════
async function renderFitness(){
  const el = document.getElementById('fitness-body');
  if(!el) return;
  const key = _fitTodayKey();
  const d = await _getFitData(key);
  // 熱量結餘（攝取 - 消耗）
  const balance = (d.intake||0) - (d.burned||0);
  const balColor = balance > 0 ? '#e0a020' : '#4caf7d';
  const balSign  = balance > 0 ? '+' : '';

  el.innerHTML = `
    <!-- 日期 -->
    <div class="fit-date">${_fitDateLabel()}</div>

    <!-- 主數據卡 -->
    <div class="fit-grid">
      <div class="fit-card fit-card-move">
        <div class="fit-card-ico">🏃</div>
        <div class="fit-card-val" id="fit-active">${d.activeMin||0}<span class="fit-card-unit">分</span></div>
        <div class="fit-card-lab">運動時長</div>
      </div>
      <div class="fit-card fit-card-burn">
        <div class="fit-card-ico">🔥</div>
        <div class="fit-card-val" id="fit-burned">${d.burned||0}<span class="fit-card-unit">kcal</span></div>
        <div class="fit-card-lab">消耗熱量</div>
      </div>
      <div class="fit-card fit-card-intake">
        <div class="fit-card-ico">🍽️</div>
        <div class="fit-card-val" id="fit-intake">${d.intake||0}<span class="fit-card-unit">kcal</span></div>
        <div class="fit-card-lab">攝取熱量</div>
      </div>
      <div class="fit-card fit-card-steps">
        <div class="fit-card-ico">👟</div>
        <div class="fit-card-val" id="fit-steps">${d.steps||0}<span class="fit-card-unit">步</span></div>
        <div class="fit-card-lab">步數</div>
      </div>
    </div>

    <!-- 熱量結餘 -->
    <div class="fit-balance">
      <span class="fit-balance-lab">今日熱量結餘</span>
      <span class="fit-balance-val" style="color:${balColor}">${balSign}${balance} kcal</span>
    </div>
    <div class="fit-balance-hint">
      ${balance > 0 ? '攝取大於消耗，呈熱量盈餘' : balance < 0 ? '消耗大於攝取，呈熱量赤字' : '收支平衡'}
    </div>

    <!-- 資料來源提示 + 開啟健康 App -->
    <div class="fit-source">
      <div class="fit-source-row">
        <span>📲 資料來源</span>
        <button class="fit-health-btn" onclick="openHealthApp()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>開啟三星健康
        </button>
      </div>
      <div class="fit-source-note">
        目前數據為手動記錄。以 Capacitor 打包為 App 後，可自動同步三星健康（Health Connect）的運動與熱量資料。
      </div>
    </div>

    <!-- 手動記錄 -->
    <div class="fit-edit-title">手動記錄今日數據</div>
    <div class="fit-edit-grid">
      <label class="fit-edit-item">
        <span>運動時長（分）</span>
        <input type="number" id="fit-in-active" value="${d.activeMin||''}" placeholder="0" inputmode="numeric">
      </label>
      <label class="fit-edit-item">
        <span>消耗熱量（kcal）</span>
        <input type="number" id="fit-in-burned" value="${d.burned||''}" placeholder="0" inputmode="numeric">
      </label>
      <label class="fit-edit-item">
        <span>攝取熱量（kcal）</span>
        <input type="number" id="fit-in-intake" value="${d.intake||''}" placeholder="0" inputmode="numeric">
      </label>
      <label class="fit-edit-item">
        <span>步數</span>
        <input type="number" id="fit-in-steps" value="${d.steps||''}" placeholder="0" inputmode="numeric">
      </label>
    </div>
    <button class="fit-save-btn" onclick="saveFitData()">儲存今日數據</button>
  `;
  _applyHealthData(); // 頁面渲染完後，補上 Health Connect 資料
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
async function saveFitData(){
  const key = _fitTodayKey();
  const num = id => {
    const v = parseInt(document.getElementById(id)?.value);
    return isNaN(v) ? 0 : Math.max(0, v);
  };
  const data = {
    id:        key,
    activeMin: num('fit-in-active'),
    burned:    num('fit-in-burned'),
    intake:    num('fit-in-intake'),
    steps:     num('fit-in-steps'),
    updatedAt: Date.now(),
  };
  try{
    await dp('healthLogs', data);
    toast('已儲存今日數據');
    renderFitness();
  }catch(e){
    logError('saveFitData', e);
    toast('儲存失敗：'+e.message);
  }
}

// 開啟三星健康 App
// Capacitor 包殼後：用原生 AppLauncher 外掛直接開啟（最佳）
// 純網頁環境：嘗試 deep link，但不導向商店（避免跑到 Play 商店）
// ════════════════════════════════════════════════════════════
// 【運動健康庫：開啟三星健康 App】
// ════════════════════════════════════════════════════════════
async function openHealthApp() {
  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      const url = 'intent://com.sec.android.app.shealth/#Intent;scheme=samsunghealth;package=com.sec.android.app.shealth;launchFlags=0x10000000;end';
      window.open(url, '_system');
    } catch(e) {
      toast('找不到三星健康，請確認已安裝');
    }
    return;
  }
  toast('網頁版無法直接開啟 App');
}

// 【Health Connect 自動同步】
let _pendingHealthData = null;

window.addEventListener('healthData', function(e) {
  _pendingHealthData = e.detail;
  _applyHealthData();
});

function _applyHealthData() {
  const d = _pendingHealthData;
  if (!d) return;
  const inActive = document.getElementById('fit-in-active');
  const inBurned = document.getElementById('fit-in-burned');
  const inIntake = document.getElementById('fit-in-intake');
  if (!inActive) return;
  if (d.exerciseMinutes) inActive.value = d.exerciseMinutes;
  if (d.caloriesBurned) inBurned.value = d.caloriesBurned;
  if (d.caloriesIntake) inIntake.value = d.caloriesIntake;
  const saveBtn = document.querySelector('#fitness-body button[onclick*="saveFit"]');
  if (saveBtn) saveBtn.click();
  _pendingHealthData = null;
}

function _applyHealthData() {
  const d = _pendingHealthData;
  if (!d) return;

  const inActive = document.getElementById('fit-in-active');
  const inBurned = document.getElementById('fit-in-burned');
  const inIntake = document.getElementById('fit-in-intake');

  if (!inActive) return; // 頁面還沒渲染，等之後再試

  if (d.exerciseMinutes) inActive.value = d.exerciseMinutes;
  if (d.caloriesBurned) inBurned.value = d.caloriesBurned;
  if (d.caloriesIntake) inIntake.value = d.caloriesIntake;

  const saveBtn = document.querySelector('#fitness-body button[onclick*="saveFit"]');
  if (saveBtn) saveBtn.click();

  _pendingHealthData = null;
}
