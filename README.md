# Y.C. 多功能專用平台 README

---

## 檔案結構

```
根目錄/
  index.html              主頁面
  sw.js                   Service Worker（離線快取 + 自動更新）
  manifest.json           PWA 安裝設定
  splash-logo-icon.png    載入畫面 LOGO（人形圓圈）
css/
  app.css                 主樣式
  splash.css              載入畫面樣式
js/
  db.js          ← 版本號在這裡，IndexedDB 核心
  utils.js       工具函式、全域狀態 S 物件
  quiz.js        刷題邏輯
  data.js        題目管理、法條、大量貼題
  stats.js       統計分析
  settings.js    設定、雲端備份
  countdown.js   考試倒數
  app.js         頁面導覽、FAB、SW 更新偵測、初始化
icons/
  splash-logo.png         載入畫面門框水墨圖
  icon-72~512.png         PWA 各尺寸圖示
```

> JS 載入順序不可更動：db → utils → quiz → data → stats → settings → countdown → app

---

## 版本管理（每次更新必做）

版本號定義在 `js/db.js` 開頭：

```js
const APP_VERSION  = '1.1.7';   // 程式版本：改 HTML/CSS/JS/SW 時遞增
const DATA_VERSION = '1150531-3'; // 題庫版本：大批更新題庫時才改
```

**每次更新程式只需改兩個地方：**

| 檔案 | 位置 | 說明 |
|------|------|------|
| `js/db.js` | 第一行 `APP_VERSION` | 改版本號 |
| `sw.js` | 第一行 `APP_VERSION` | 改成一樣的版本號 |

改完推 GitHub，等 Actions 綠勾後使用者開啟 PWA 會自動收到「發現新版本」通知，按「立即更新」即可。**不需要手動清快取。**

---

## 顯示模式

設定頁可切換兩種模式：

| 模式 | 適用 | 說明 |
|------|------|------|
| 🌙 標準 | 手機 | 深色主題，完整動畫效果 |
| 📖 電子紙 | Boox 電子書 | 米白底、標楷體、關閉動畫，適合 E-ink 螢幕 |

切換後自動儲存，重開 APP 自動套用。

---

## 雲端備份（Apps Script）

架構：PWA → POST → Google Apps Script → Google Drive

**設定只需做一次：**
1. 前往 [script.google.com](https://script.google.com)，新增專案，貼上 `gas_backup.gs`
2. 修改 `const PASSWORD = '你的密碼'`
3. 部署 → 網路應用程式 → 執行身分：我 → 存取權：所有人
4. 複製網址，填入 PWA 設定頁的「Apps Script 網址」和密碼

備份檔名：`YC_Platform_backup.json`，存於 Google Drive 根目錄。

**更新 Apps Script 後必須重新部署新版本**（部署 → 管理部署作業 → 建立新版本）。

---

## 題組題功能

新增題目時勾選「📋 題組題（共同題幹）」：

| 欄位 | 說明 |
|------|------|
| 共同題幹 | 所有子題共用的情境描述，貼一次 |
| 題組 ID | 同組子題填相同 ID，例如 `113_警佐_g1` |
| 第幾題 | 這是第幾個子題（1、2、3...） |

刷題時有共同題幹的題目，會在題幹上方顯示藍色左邊框的區塊。現有題目完全相容不影響。

---

## 常見修改速查

| 想改的功能 | 動哪個檔案 |
|-----------|-----------|
| 程式版本號 | `db.js` + `sw.js`（同步） |
| 題庫版本號 | `db.js` |
| 配色、字型、間距 | `css/app.css` |
| 載入畫面樣式 | `css/splash.css` |
| 刷題邏輯、計分 | `js/quiz.js` |
| 題目欄位 | `js/data.js` + `index.html` |
| 遺忘曲線間隔 | `js/db.js`（`REVIEW_INTERVALS`） |
| 統計圖表 | `js/stats.js` |
| 備份檔名 | `js/settings.js`（`GAS_BACKUP_FILE`） |
| PWA 名稱/圖示 | `manifest.json` |
| 離線快取清單 | `sw.js`（`ASSETS` 陣列） |

---

## 部署注意事項

1. 上傳後等 GitHub Actions **綠勾** 才算完成，不要急著測試
2. 手機 PWA 更新：等通知 → 按「立即更新」
3. 手動強制更新：Chrome 開發者工具 → Application → Service Workers → Unregister → 重新整理
4. PWA 圖示更新：需解除安裝後重新從瀏覽器安裝

---

## 注意事項

- `sw.js` 的 `APP_VERSION` 必須與 `db.js` **完全一致**，否則更新通知不會觸發
- 題庫資料存在 IndexedDB，不會因為更新版本號而清空
- 電子紙模式使用標楷體，Windows/macOS/iOS 有內建，Android 無則 fallback 到 Noto Serif TC
- Apps Script 使用 `text/plain` Content-Type 傳送，避免 CORS preflight 問題
