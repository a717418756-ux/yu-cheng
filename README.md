# Y.C. 多功能專用平台

PWA 離線應用，以 IndexedDB 儲存資料，支援安裝至手機主畫面。

---

## 檔案結構

```
index.html          主頁面（HTML 結構 + splash 動畫）
manifest.json       PWA 安裝設定（名稱、圖示、顯示模式）
sw.js               Service Worker（離線快取）
css/
  app.css           主樣式（全部頁面的 CSS）
  splash.css        載入畫面專用樣式
js/
  db.js             資料庫核心（IndexedDB、CRUD、遺忘曲線）
  utils.js          工具函式與全域狀態（S 物件、解析器）
  quiz.js           刷題模式（選擇題、申論題、模擬考、計時）
  data.js           題目管理 + 資料庫法條 + 大量貼題
  stats.js          統計分析 + AI 弱點診斷匯出
  settings.js       設定、匯出匯入、Google Drive 同步
  countdown.js      考試倒數計時管理
  app.js            頁面導覽、FAB、首頁區塊、初始化
icons/
  icon-*.png        PWA 圖示（72/96/128/144/152/192/384/512）
```

> **JS 載入順序不可更動：**
> `db` → `utils` → `quiz` → `data` → `stats` → `settings` → `countdown` → `app`

---

## 各檔案說明與修改指引

### `index.html`
HTML 骨架。包含所有頁面的 DOM 結構（`<div id="pg-*">`），以及 splash 載入動畫的 JS（行內 `<script>`）。

**需要修改的情況：**
- 新增/刪除頁面 → 在此加 `<div id="pg-xxx" class="page hide">` 區塊，同時在 `app.js` 的 `goPage` 對應表加入
- 修改按鈕文字、輸入欄位標籤
- 修改 splash 動畫

---

### `css/app.css`
全部頁面的樣式，包含 CSS 變數（深色主題色系）、卡片、按鈕、overlay、chip 等。

**需要修改的情況：**
- 調整配色、字型、間距
- 新增 UI 元件樣式

### `css/splash.css`
僅控制載入畫面的動畫與佈局，與主樣式完全隔離。

**需要修改的情況：**
- 修改 splash 動畫效果、logo 位置

---

### `js/db.js`
IndexedDB 的所有底層操作。其他 JS 透過以下函式存取資料：

| 函式 | 說明 |
|------|------|
| `initDB()` | 開啟資料庫、建立 object store（僅在 `init()` 呼叫一次） |
| `da(store)` | 讀取整個 store 的所有記錄（有 30 秒快取） |
| `dg(store, key)` | 讀取單筆記錄 |
| `dp(store, data)` | 寫入/更新單筆記錄 |
| `dd(store, key)` | 刪除單筆記錄 |
| `dc(store)` | 清空整個 store |
| `bulkPut(store, items)` | 批次寫入多筆記錄 |
| `calcNextReview()` | 計算遺忘曲線下次複習時間 |
| `getDangerLevel()` | 計算題目危險等級（答錯率） |

**需要修改的情況：**
- 新增 store（需同步更新 `initDB()` 裡的 `createObjectStore`）
- 調整遺忘曲線間隔（`REVIEW_INTERVALS` 陣列）
- 調整快取 TTL（`_CACHE_TTL`）

---

### `js/utils.js`
全域狀態物件與各種工具函式。**幾乎所有 JS 都依賴這個檔案。**

**全域狀態 `S` 物件：**
```js
S.page        // 目前頁面
S.filter      // 題目篩選條件
S.lawCat      // 法條分類篩選
S.quiz        // 刷題狀態（題目池、當前索引、答題記錄）
S.bulkParsed  // 大量貼題解析結果暫存
```

**主要函式：**

| 函式 | 說明 |
|------|------|
| `esc(s)` | HTML 跳脫（防 XSS） |
| `toast(msg)` | 顯示底部提示訊息 |
| `cleanSpaces(text)` | 清理 PDF/OCR 常見空格問題 |
| `parseQuestions(text)` | 將貼入的考題文字解析成題目物件陣列 |
| `parseBulkText(text)` | `parseQuestions` 的相容封裝 |
| `parseAnswerStr(str)` | 解析答案列（如 `DACB` 或 `1.D 2.A`） |
| `getWrong(qs, ats)` | 從答題記錄計算錯題清單 |
| `debounce(fn, delay)` | 防抖動（搜尋框輸入用） |
| `autoKeywords(text)` | 自動從文字萃取警察法規關鍵字 |
| `cfm(title, subtitle, cb)` | 顯示確認對話框 |

**需要修改的情況：**
- 調整題目解析邏輯（選項符號、題號格式）→ `parseQuestions()`
- 新增自動關鍵字 → `KW_POOL` 陣列
- 修改全域狀態初始值 → `S` 物件

---

### `js/quiz.js`
刷題模式的所有邏輯，依賴 `db.js` 和 `utils.js`。

**主要函式：**

| 函式 | 說明 |
|------|------|
| `startQ(mode)` | 啟動刷題（模式：`all` / `wrong` / `star` / `review`） |
| `startQWithPool(pool, mode)` | 用指定題目池啟動刷題 |
| `startExam(totalQ, timeLimitMin)` | 啟動模擬考（預設 50 題 50 分鐘） |
| `startQuick()` | 快速刷題（隨機 10 題） |
| `renderQCard()` | 渲染當前題目卡片 |
| `ansQ(sel)` | 選擇題作答 |
| `ansQMulti(selected, correct)` | 多選題作答 |
| `submitAnswer()` | 送出申論題答案 |
| `nextQ()` | 下一題 |
| `exitQ()` | 離開刷題模式 |
| `toggleQStar()` | 收藏/取消收藏當前題目 |
| `showQDone()` | 顯示刷題完成畫面 |
| `replayQuiz()` | 重新刷一次同一組題目 |

**需要修改的情況：**
- 調整模擬考題數/時間 → `startExam()` 的預設參數
- 修改答題卡片 UI → `renderQCard()`
- 修改遺忘曲線更新邏輯 → `ansQ()` 內的 `calcNextReview()` 呼叫

---

### `js/data.js`
最大的模組，包含三個區塊，共用相同的 `db.js` 函式。

#### 題目管理（questions）

| 函式 | 說明 |
|------|------|
| `renderHome()` | 渲染首頁統計數據 |
| `renderList()` | 渲染題目管理列表 |
| `showAdd(q)` | 打開新增/編輯題目表單 |
| `saveQ()` | 儲存題目（新增或更新） |
| `editQ(id)` | 載入題目進行編輯 |
| `delQ(id)` | 刪除單筆題目 |
| `openBulkDelQ()` | 開啟大量刪除題目面板 |
| `toggleStar(id)` | 收藏/取消收藏題目 |
| `startSingleQ(el)` | 對單一題目啟動刷題 |
| `checkDuplicate(data)` | 儲存前檢查是否重複題目 |

#### 資料庫法條（laws）

| 函式 | 說明 |
|------|------|
| `renderDB()` | 渲染法條列表 |
| `showAddLaw(l)` | 打開新增/編輯法條表單 |
| `saveLaw()` | 儲存法條 |
| `delLawGroup(lawName)` | 刪除整個法規群組 |
| `openLawGroup(lawName)` | 展開法規群組（顯示所有條文） |
| `openChapterMgr(lawName)` | 管理章節順序 |
| `importBulkLaw()` | 大量匯入法條 |
| `openBulkDelLaw()` | 大量刪除法條 |
| `startClozeLaw(content)` | 對法條啟動挖空練習 |

#### 大量貼題（bulk）

| 函式 | 說明 |
|------|------|
| `parseBulk()` | 解析貼入的考題文字，產生預覽 |
| `importBulk()` | 確認後批次匯入解析結果 |
| `clearBulk()` | 清空貼題輸入框 |
| `startNumberMode()` | 啟動「數字魔鬼」刷題模式 |

**需要修改的情況：**
- 修改題目欄位（新增欄位）→ `showAdd()` 的表單 + `saveQ()` 的儲存邏輯，同時更新 `index.html` 的表單 HTML
- 修改法條欄位 → `showAddLaw()` + `saveLaw()`
- 調整大量貼題解析規則 → 去 `utils.js` 的 `parseQuestions()`

---

### `js/stats.js`
統計分析頁面與 AI 匯出功能。

| 函式 | 說明 |
|------|------|
| `renderStats()` | 渲染統計圖表（Chart.js）與各科正確率 |
| `clearWrongAts()` | 清除錯題答題記錄 |
| `buildAI()` | 產生 AI 弱點診斷 Markdown/JSON |
| `copyAI(type)` | 複製 AI 診斷內容 |
| `dlAI(type)` | 下載 AI 診斷檔案 |

**需要修改的情況：**
- 調整圖表樣式 → `renderStats()` 裡的 Chart.js 設定
- 修改 AI 診斷輸出格式 → `buildAI()`

---

### `js/settings.js`
設定頁面，包含 Google Drive 同步功能。

| 函式 | 說明 |
|------|------|
| `renderSet()` | 渲染設定頁（資料統計、操作按鈕） |
| `expJSON()` | 匯出所有資料為 JSON 備份檔 |
| `impJSON(e)` | 匯入 JSON 備份還原資料 |
| `expWrong()` | 匯出錯題為 HTML |
| `expAll()` | 匯出所有題目為 HTML |
| `clearAts()` | 清除所有答題記錄 |
| `delAll()` | 清空所有資料 |
| `gdriveLogin()` | 登入 Google Drive |
| `gdriveBackup()` | 備份至 Google Drive |
| `gdriveRestore()` | 從 Google Drive 還原 |
| `buildHTML(qs, title)` | 產生題目 HTML 匯出內容 |

**需要修改的情況：**
- 調整 Google Drive 備份檔名 → `GDRIVE_BACKUP_FILE` 常數
- 修改匯出 HTML 樣式 → `buildHTML()`

---

### `js/countdown.js`
考試倒數計時器管理。

| 函式 | 說明 |
|------|------|
| `renderCountdown()` | 渲染首頁的倒數卡片 |
| `renderSetCountdown()` | 渲染設定頁的倒數列表 |
| `openCountdownMgr()` | 打開倒數管理 overlay |
| `delCountdown(id)` | 刪除單筆倒數 |
| `delCountdownSet(id)` | 刪除整組倒數 |
| `editMotto()` | 編輯首頁勉勵語 |

**需要修改的情況：**
- 修改倒數顯示格式 → `renderCountdown()`
- 倒數資料存在 `localStorage`（key：`examCountdowns`）

---

### `js/app.js`
頁面切換、FAB 導覽、首頁區塊展開，以及整個應用的初始化進入點。

| 函式 | 說明 |
|------|------|
| `init()` | 應用入口，呼叫 `initDB()` 後跳至首頁 |
| `goPage(pg, btn)` | 切換頁面並觸發對應的 render 函式 |
| `toggleFab()` | 展開/收合 FAB 導覽選單 |
| `fabGo(pg)` | 從 FAB 跳頁 |
| `toggleZone(zone)` | 首頁「考試」/「學習」區塊展開收合 |
| `toggleBrowseSub()` | 閱覽頁子選單（題目閱覽/資料閱覽）切換 |
| `openLawBrowse()` | 打開法條閱覽 overlay |
| `renderLawBrowse()` | 渲染法條閱覽內容 |
| `toggleAddQMenu()` | 題目管理頁的新增選單 |
| `toggleAddLawMenu()` | 資料庫頁的新增選單 |

**goPage 頁面對應表：**

| `pg` 值 | 對應頁面 | 觸發的 render |
|---------|---------|--------------|
| `home` | 首頁 | `renderHome()` |
| `list` | 題目管理 | `renderList()` |
| `db` / `laws` | 資料庫 | `renderDB()` |
| `stats` | 統計分析 | `renderStats()` |
| `set` | 設定 | `renderSet()` |
| `bulk` | 大量貼題 | （無，靜態頁面） |

**需要修改的情況：**
- 新增頁面 → 在 `goPage` 的對應表加入新 `pg` 鍵值，同時在 `index.html` 新增 `<div id="pg-xxx">`
- 修改 FAB 選單項目 → `toggleFab()` 內的 `_FAB_*` 常數

---

### `manifest.json`
PWA 安裝設定。

**需要修改的情況：**
- 更換 App 名稱 → `name` / `short_name`
- 更換主題色 → `theme_color` / `background_color`
- 更換圖示路徑 → `icons` 陣列

---

### `sw.js`
Service Worker，控制離線快取。

**需要修改的情況：**
- 新增需要離線快取的資源 → `ASSETS` 陣列
- **更新版本時必須修改 `CACHE_NAME`**（如 `yc-platform-v1` → `yc-platform-v2`），否則使用者拿不到新版

---

## 常見修改情境速查

| 想修改的功能 | 需要動的檔案 |
|------------|------------|
| 題目欄位（新增/刪除） | `data.js` + `index.html` |
| 法條欄位 | `data.js` + `index.html` |
| 題目解析規則（大量貼題） | `utils.js`（`parseQuestions`） |
| 刷題邏輯、計分 | `quiz.js` |
| 遺忘曲線間隔 | `db.js`（`REVIEW_INTERVALS`） |
| 統計圖表 | `stats.js` |
| 匯出格式 | `settings.js`（`buildHTML`） |
| Google Drive 設定 | `settings.js` |
| 考試倒數 | `countdown.js` |
| 頁面切換邏輯 | `app.js` |
| 新增頁面 | `index.html` + `app.js` |
| 配色、字型、間距 | `css/app.css` |
| 載入動畫 | `css/splash.css` + `index.html` |
| PWA 名稱/圖示 | `manifest.json` |
| 離線快取資源 | `sw.js`（`ASSETS` + `CACHE_NAME`） |
| 全域狀態初始值 | `utils.js`（`S` 物件） |

---

## 部署注意事項

1. 所有檔案需上傳至 GitHub repo **根目錄**（`index.html` 和 `sw.js`、`manifest.json` 同層）
2. `js/`、`css/`、`icons/` 資料夾路徑需完全對應
3. **更新程式後**，必須修改 `sw.js` 的 `CACHE_NAME` 版本號，使用者才會拿到新版（或請使用者手動清除快取）
4. Service Worker 僅在 `https://` 或 `localhost` 環境下生效（GitHub Pages 符合條件）
