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
        <button class="fit-health-btn" onclick="openHealthApp()">開啟三星健康</button>
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
}

function _fitDateLabel(){
  const d = new Date();
  const wd = ['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getMonth()+1}月${d.getDate()}日　星期${wd}`;
}

// 儲存今日手動數據
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

// 開啟三星健康 App（Capacitor 包殼後才能用原生開啟；網頁版嘗試 deep link）
function openHealthApp(){
  // 三星健康 package: com.sec.android.app.shealth
  // Capacitor 環境：用 App 外掛或 intent 開啟；網頁版用 intent URL 嘗試
  try{
    // Android intent：嘗試開啟三星健康
    window.location.href = 'intent://#Intent;package=com.sec.android.app.shealth;end';
  }catch(e){
    toast('無法開啟健康 App（需在 App 環境中使用）');
  }
  // 提示：若沒反應，多半是在純網頁環境，需打包成 App 後才能開啟
  setTimeout(()=>{
    toast('若無反應，需以 App 形式安裝後才能開啟三星健康');
  }, 800);
}
