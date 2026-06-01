# Y.C. 多功能專用平台

PWA 離線應用，以 IndexedDB 儲存資料，支援安裝至手機主畫面。

---

## 檔案結構

```
index.html          主頁面（HTML 結構 + splash 動畫）
manifest.json       PWA 安裝設定（名稱、圖示、顯示模式）
sw.js               Service Worker（離線快取 + 自動更新）
css/
  app.css           主樣式（全部頁面的 CSS）
  splash.css        載入畫面專用樣式
js/
  db.js             資料庫核心（IndexedDB、CRUD、遺忘曲線、版本號）
  utils.js          工具函式與全域狀態（S 物件、解析器）
  quiz.js           刷題模式（選擇題、申論題、模擬考、計時）
  data.js           題目管理 + 資料庫法條 + 大量貼題
  stats.js          統計分析 + AI 弱點診斷匯出
  settings.js       設定、匯出匯入、雲端備份（Apps Script）
  countdown.js      考試倒數計時管理
  app.js            頁面導覽、FAB、SW 更新偵測、初始化
icons/
  splash-logo.png   載入畫面圖片
  icon-*.png        PWA 圖示（72/96/128/144/152/192/384/512）
```

> **JS 載入順序不可更動：**
> `db` → `utils` → `quiz` → `data` → `stats` → `settings` → `countdown` → `app`

---

## 版本管理

### 雙版本系統

系統有兩個獨立版本號，都定義在 `js/db.js` 開頭：

```js
const APP_VERSION  = '1.0.0';       // 程式版本
const DATA_VERSION = '1150531-3';   // 題庫版本
```

| 版本號 | 用途 | 何時更新 |
|--------|------|---------|
| `APP_VERSION` | HTML / CSS / JS / Service Worker | 修改程式功能、介面、修 bug |
| `DATA_VERSION` | 題庫資料、法條資料 | 新增題目或法條批次更新 |

設定頁底部會顯示：
```
程式版本：v1.0.0　題庫版本：1150531-3
最後備份：2025/05/31 23:00　最後還原：—
```

---

### 每次更新程式的操作步驟

**只需修改兩個檔案的同一個數字：**

#### 第一步：修改 `js/db.js`

打開 `js/db.js`，找到第一行：

```js
const APP_VERSION  = '1.0.0';
```

改成新版本號，例如：

```js
const APP_VERSION  = '1.0.1';
```

#### 第二步：修改 `sw.js`（必須和 db.js 一致）

打開 `sw.js`，找到第一行：

```js
const APP_VERSION = '1.0.0';
```

改成相同的版本號：

```js
const APP_VERSION = '1.0.1';
```

#### 第三步：上傳到 GitHub

把修改過的所有檔案推上去即可。

---

### 版本號命名建議

| 情境 | 範例 |
|------|------|
| 修小 bug、調整樣式 | `1.0.0` → `1.0.1` |
| 新增功能 | `1.0.1` → `1.1.0` |
| 大幅重構 | `1.1.0` → `2.0.0` |
| 只更新題庫，程式不動 | 只改 `DATA_VERSION`，`APP_VERSION` 不動 |

---

### 使用者更新流程（自動）

```
你推新版到 GitHub
       ↓
使用者開啟 PWA（或 30 分鐘後背景自動檢查）
       ↓
背景下載新 sw.js
       ↓
畫面底部出現「發現新版本」通知
       ↓
使用者按「立即更新」→ 自動重新載入，題庫資料完全保留
```

使用者**不需要**手動清快取、不需要重新安裝 PWA。

---

## 各檔案說明與修改指引

### `index.html`
HTML 骨架。包含所有頁面的 DOM 結構（`<div id="pg-*">`），以及 splash 載入動畫的行內 `<script>`。

**需要修改的情況：**
- 新增/刪除頁面 → 加 `<div id="pg-xxx" class="page hide">` 區塊，同時在 `app.js` 的 `goPage` 對應表加入
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
- 修改 splash 動畫效果、圖片位置

---

### `js/db.js`
IndexedDB 的所有底層操作，以及兩個版本號常數。

**版本號在這裡：**
```js
const APP_VERSION  = '1.0.0';
const DATA_VERSION = '1150531-3';
```

| 函式 | 說明 |
|------|------|
| `initDB()` | 開啟資料庫、建立 object store |
| `da(store)` | 讀取整個 store（有快取） |
| `dg(store, key)` | 讀取單筆 |
| `dp(store, data)` | 寫入/更新單筆 |
| `dd(store, key)` | 刪除單筆 |
| `dc(store)` | 清空整個 store |
| `bulkPut(store, items)` | 批次寫入 |
| `getSetting(key, fallback)` | 讀取設定值（IndexedDB settings store） |
| `setSetting(key, value)` | 寫入設定值 |
| `getCountdowns()` | 讀取所有倒數 |
| `saveCountdowns(list)` | 覆寫所有倒數 |
| `calcNextReview()` | 遺忘曲線下次複習時間 |
| `getDangerLevel()` | 題目危險等級（答錯率） |

**需要修改的情況：**
- 更新版本號 → `APP_VERSION` / `DATA_VERSION`
- 新增 store → `initDB()` 裡加 `createObjectStore`
- 調整遺忘曲線間隔 → `REVIEW_INTERVALS` 陣列
- 調整快取 TTL → `_CACHE_TTL`

---

### `js/utils.js`
全域狀態物件與工具函式，**幾乎所有 JS 都依賴這個檔案**。

**全域狀態 `S` 物件：**
```js
S.page        // 目前頁面
S.filter      // 題目篩選條件
S.lawCat      // 法條分類篩選
S.quiz        // 刷題狀態
S.bulkParsed  // 大量貼題暫存
```

| 函式 | 說明 |
|------|------|
| `esc(s)` | HTML 跳脫（防 XSS） |
| `toast(msg)` | 底部提示訊息 |
| `cleanSpaces(text)` | 清理 OCR 空格 |
| `parseQuestions(text)` | 貼入文字解析成題目陣列 |
| `parseBulkText(text)` | `parseQuestions` 的相容封裝 |
| `parseAnswerStr(str)` | 解析答案列 |
| `getWrong(qs, ats)` | 計算錯題清單 |
| `debounce(fn, delay)` | 防抖動 |
| `autoKeywords(text)` | 萃取法規關鍵字 |
| `cfm(title, sub, cb)` | 確認對話框 |

**需要修改的情況：**
- 調整題目解析邏輯 → `parseQuestions()`
- 新增自動關鍵字 → `KW_POOL` 陣列
- 修改全域狀態初始值 → `S` 物件

---

### `js/quiz.js`
刷題模式的所有邏輯。

| 函式 | 說明 |
|------|------|
| `startQ(mode)` | 啟動刷題（`all` / `wrong` / `star` / `review`） |
| `startQWithPool(pool, mode)` | 指定題目池啟動 |
| `startExam(totalQ, timeLimitMin)` | 模擬考（預設 50 題 50 分鐘） |
| `startQuick()` | 快速刷題（隨機 10 題） |
| `renderQCard()` | 渲染題目卡片 |
| `ansQ(sel)` | 選擇題作答 |
| `ansQMulti(selected, correct)` | 多選題作答 |
| `submitAnswer()` | 送出申論答案 |
| `nextQ()` | 下一題 |
| `exitQ()` | 離開刷題 |
| `toggleQStar()` | 收藏/取消收藏 |
| `showQDone()` | 刷題完成畫面 |
| `replayQuiz()` | 重新刷一次 |

**需要修改的情況：**
- 調整模擬考題數/時間 → `startExam()` 預設參數
- 修改題目卡片 UI → `renderQCard()`
- 修改遺忘曲線更新邏輯 → `ansQ()` 內的 `calcNextReview()` 呼叫

---

### `js/data.js`
最大的模組，包含題目管理、資料庫法條、大量貼題三個區塊。

#### 題目管理

| 函式 | 說明 |
|------|------|
| `renderHome()` | 首頁統計數據 |
| `renderList()` | 題目管理列表 |
| `showAdd(q)` | 新增/編輯題目表單 |
| `saveQ()` | 儲存題目 |
| `editQ(id)` | 載入題目編輯 |
| `delQ(id)` | 刪除題目 |
| `openBulkDelQ()` | 大量刪除題目 |
| `toggleStar(id)` | 收藏題目 |
| `startSingleQ(el)` | 單題刷題 |
| `checkDuplicate(data)` | 儲存前查重 |

#### 資料庫法條

| 函式 | 說明 |
|------|------|
| `renderDB()` | 法條列表 |
| `showAddLaw(l)` | 新增/編輯法條 |
| `saveLaw()` | 儲存法條 |
| `delLawGroup(lawName)` | 刪除法規群組 |
| `openLawGroup(lawName)` | 展開法規群組 |
| `openChapterMgr(lawName)` | 章節順序管理 |
| `importBulkLaw()` | 大量匯入法條 |
| `openBulkDelLaw()` | 大量刪除法條 |
| `startClozeLaw(content)` | 法條挖空練習 |

#### 大量貼題

| 函式 | 說明 |
|------|------|
| `parseBulk()` | 解析貼入考題，產生預覽 |
| `importBulk()` | 批次匯入解析結果 |
| `clearBulk()` | 清空輸入框 |
| `startNumberMode()` | 數字魔鬼刷題模式 |

**需要修改的情況：**
- 題目新增欄位 → `showAdd()` 表單 + `saveQ()` 邏輯 + `index.html` 的表單 HTML
- 法條新增欄位 → `showAddLaw()` + `saveLaw()`
- 調整大量貼題解析 → `utils.js` 的 `parseQuestions()`

---

### `js/stats.js`

| 函式 | 說明 |
|------|------|
| `renderStats()` | 統計圖表（Chart.js）與各科正確率 |
| `clearWrongAts()` | 清除錯題記錄 |
| `buildAI()` | 產生 AI 弱點診斷 |
| `copyAI(type)` | 複製診斷內容 |
| `dlAI(type)` | 下載診斷檔案 |

---

### `js/settings.js`
設定頁，包含雲端備份（Apps Script 架構）。

| 函式 | 說明 |
|------|------|
| `renderSet()` | 渲染設定頁（含版本號、備份時間） |
| `expJSON()` | 匯出所有資料為 JSON |
| `impJSON(e)` | 匯入 JSON 還原 |
| `expWrong()` | 匯出錯題 HTML |
| `expAll()` | 匯出所有題目 HTML |
| `clearAts()` | 清除作答記錄 |
| `delAll()` | 清空所有資料 |
| `gdriveBackup()` | 備份到 Google Drive（Apps Script） |
| `gdriveRestore()` | 從 Google Drive 還原 |
| `saveGasConfig()` | 儲存 Apps Script 網址與密碼 |
| `buildHTML(qs, title)` | 產生題目 HTML 匯出內容 |

**備份時間記錄（IndexedDB settings store）：**
- `lastBackupTime`：最後備份時間
- `lastRestoreTime`：最後還原時間

**需要修改的情況：**
- 修改備份檔名 → `GAS_BACKUP_FILE` 常數
- 修改匯出 HTML 樣式 → `buildHTML()`

---

### `js/countdown.js`

| 函式 | 說明 |
|------|------|
| `renderCountdown()` | 首頁倒數卡片 |
| `renderSetCountdown()` | 設定頁倒數列表 |
| `openCountdownMgr()` | 倒數管理 overlay |
| `delCountdown(id)` | 刪除單筆倒數 |
| `delCountdownSet(id)` | 刪除整組倒數 |
| `editMotto()` | 編輯首頁勉勵語 |

> 倒數資料存在 IndexedDB `countdowns` store，勉勵語存在 `settings` store（key：`examMotto`）。

---

### `js/app.js`
頁面切換、FAB 導覽、SW 更新偵測、初始化。

| 函式 | 說明 |
|------|------|
| `init()` | 應用入口，呼叫 `initDB()` 後跳至首頁 |
| `goPage(pg, btn)` | 切換頁面並觸發對應 render |
| `toggleFab()` | 展開/收合 FAB 選單 |
| `fabGo(pg)` | FAB 跳頁 |
| `toggleZone(zone)` | 首頁區塊展開收合 |
| `toggleBrowseSub()` | 閱覽頁子選單切換 |
| `openLawBrowse()` | 法條閱覽 overlay |
| `renderLawBrowse()` | 渲染法條閱覽 |
| `_showUpdateBanner(reg)` | 顯示新版本通知列 |

**goPage 頁面對應表：**

| `pg` 值 | 對應頁面 | 觸發的 render |
|---------|---------|--------------|
| `home` | 首頁 | `renderHome()` |
| `list` | 題目管理 | `renderList()` |
| `db` / `laws` | 資料庫 | `renderDB()` |
| `stats` | 統計分析 | `renderStats()` |
| `set` | 設定 | `renderSet()` |
| `bulk` | 大量貼題 | （靜態頁面） |

---

### `sw.js`
Service Worker。**版本號必須與 `db.js` 保持一致。**

```js
const APP_VERSION = '1.0.0';        // ← 改這裡（同 db.js）
const CACHE_NAME  = `yc-cache-${APP_VERSION}`;
```

- `index.html` 不進快取，永遠從網路取得
- JS / CSS / 圖片才進快取
- 新版偵測到後彈出通知，使用者確認才更新

---

### `manifest.json`

**需要修改的情況：**
- 更換 App 名稱 → `name` / `short_name`
- 更換主題色 → `theme_color` / `background_color`
- 更換圖示 → `icons` 陣列

---

## 雲端備份設定（只做一次）

### Apps Script 建立步驟

1. 前往 [script.google.com](https://script.google.com) → 新增專案
2. 貼上 `gas_backup.gs` 的完整程式碼
3. 把 `const PASSWORD = '請改成你的密碼'` 改成自訂密碼
4. 部署 → 新增部署作業 → 類型：**網路應用程式**
5. 執行身分：**我**　存取權：**所有人** → 部署
6. 複製網址（`https://script.google.com/macros/s/.../exec`）

### PWA 設定

進設定頁 → 雲端同步 → 填入網址和密碼 → 儲存

### 更新 Apps Script 後重新部署

每次修改 `.gs` 程式碼後，**必須重新部署新版本**：
- 部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選「建立新版本」→ 部署
- 網址不變，不需重新填入 PWA

---

## 常見修改情境速查

| 想修改的功能 | 需要動的檔案 |
|------------|------------|
| **更新程式版本** | `db.js`（`APP_VERSION`）+ `sw.js`（`APP_VERSION`） |
| **更新題庫版本** | `db.js`（`DATA_VERSION`） |
| 題目欄位（新增/刪除） | `data.js` + `index.html` |
| 法條欄位 | `data.js` + `index.html` |
| 題目解析規則 | `utils.js`（`parseQuestions`） |
| 刷題邏輯、計分 | `quiz.js` |
| 遺忘曲線間隔 | `db.js`（`REVIEW_INTERVALS`） |
| 統計圖表 | `stats.js` |
| 匯出格式 | `settings.js`（`buildHTML`） |
| 備份檔名 | `settings.js`（`GAS_BACKUP_FILE`）+ `gas_backup.gs`（`FILENAME`） |
| 考試倒數 | `countdown.js` |
| 頁面切換邏輯 | `app.js` |
| 新增頁面 | `index.html` + `app.js` |
| 配色、字型、間距 | `css/app.css` |
| 載入動畫 | `css/splash.css` + `index.html` |
| PWA 名稱/圖示 | `manifest.json` |
| 離線快取資源 | `sw.js`（`ASSETS`） |
| 全域狀態初始值 | `utils.js`（`S` 物件） |

---

## 部署注意事項

1. `index.html`、`sw.js`、`manifest.json` 放在 repo **根目錄**
2. `js/`、`css/`、`icons/` 資料夾路徑需完全對應
3. **每次更新程式後**，`db.js` 和 `sw.js` 的 `APP_VERSION` 必須同步修改
4. Service Worker 僅在 `https://` 或 `localhost` 下生效（GitHub Pages 符合條件）
5. 修改 Apps Script 後記得重新部署新版本
