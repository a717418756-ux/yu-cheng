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

    <!-- 主數據卡（雙擊卡片可編輯數值）-->
    <div class="fit-grid">
      <div class="fit-card fit-card-move" ondblclick="editFitField('activeMin','運動時長','分')">
        <div class="fit-card-ico">🏃</div>
        <div class="fit-card-val" id="fit-active">${d.activeMin||0}<span class="fit-card-unit">分</span></div>
        <div class="fit-card-lab">運動時長</div>
      </div>
      <div class="fit-card fit-card-burn" ondblclick="editFitField('burned','消耗熱量','kcal')">
        <div class="fit-card-ico">🔥</div>
        <div class="fit-card-val" id="fit-burned">${d.burned||0}<span class="fit-card-unit">kcal</span></div>
        <div class="fit-card-lab">消耗熱量</div>
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
    <div class="fit-edit-hint">💡 雙擊上方卡片即可編輯數值</div>

    <!-- 熱量結餘 -->
    <div class="fit-balance">
      <span class="fit-balance-lab">今日熱量結餘</span>
      <span class="fit-balance-val" style="color:${balColor}">${balSign}${balance} kcal</span>
    </div>
    <div class="fit-balance-hint">
      ${balance > 0 ? '攝取大於消耗，呈熱量盈餘' : balance < 0 ? '消耗大於攝取，呈熱量赤字' : '收支平衡'}
    </div>

    <!-- 資料來源提示（開啟健康 App 功能已移至頂部按鈕）-->
    <div class="fit-source">
      <div class="fit-source-row">
        <span>📲 資料來源</span>
      </div>
      <div class="fit-source-note">
        目前數據為手動記錄。以 Capacitor 打包為 App 後，可自動同步三星健康（Health Connect）的運動與熱量資料。可點右上角按鈕開啟三星健康。
      </div>
    </div>

    <!-- 手動記錄改為雙擊卡片編輯，已移除底部輸入區 -->
  `;
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
  const key = _fitTodayKey();
  const cur = await _getFitData(key);
  const input = prompt(`輸入${label}（${unit}）：`, cur[field] || '');
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
  // 1) Capacitor 環境：用原生外掛開啟（打包後可用）
  if(window.Capacitor?.isNativePlatform?.()){
    try{
      // 需安裝 @capacitor/app-launcher 外掛
      const launcher = window.Capacitor.Plugins?.AppLauncher;
      if(launcher){
        const { value } = await launcher.canOpenUrl({ url: pkg });
        if(value){
          await launcher.openUrl({ url: pkg });
          return;
        }
      }
    }catch(e){ /* 落到下方提示 */ }
    toast('找不到三星健康，請確認已安裝');
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
