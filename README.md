# Y.C. 多功能專用平台

> 版本 2.10.1 ｜ PWA 離線應用 ｜ 部署於 GitHub Pages

警察升官考備考與學習的整合平台，純前端、離線優先、無外部框架。

---

## 功能概覽

### 📝 考試區（題目管理）
- 題庫匯入（大量貼上 / 逐一新增），智慧解析選項符號（含 PDF 亂碼、孤立括號、bullet、同列多選項）
- 三層導覽：年度 → 科目 → 題目
- 單選 / 複選 / 申論 / 題組作答，即時批改
- 遺忘曲線複習排程（7 級間隔）、危險度分析（🔴🟠🟡🟢）
- 模擬考、快刷模式
- 勾選刪除（含「依條件選取」：依年度/科目/題號自動勾選後刪除）

### ⚖️ 資料庫（法條）
- 法規條文 / SOP / 補充資料 / 函釋分類
- 編 → 章 → 節 三層階層分組顯示（同名章節不重複、條號穩定排序）
- 編/章/節下拉式編輯（同法規既有值可選）
- 全文搜尋、相關法條互連、條號自動排序（支援「第N條之M」）
- 重建條號索引（一次校正舊資料排序與編章節標記）
- 勾選刪除（含「依條件選取」：依法律名稱自動勾選整部法規後刪除）

### 🇬🇧 英語學習庫（學習區）
- 三種上傳：貼上文字 / PDF 抽取 / 拍照圖片 OCR
- 自動切分句子（學習最小單位）
- TTS 逐句高亮朗讀（瀏覽器內建語音，離線免費），可調語速 0.5–1.5×
- 點句從該句朗讀
- （規劃中）點詞查詢、單字本、間隔複習、跟讀比對、自動挖空測驗

### 📚 電子書庫（學習區）
- EPUB / PDF / TXT 上傳閱讀
- epub.js 分頁閱讀，字級 / 主題切換（深色 / 護眼 / 白色 / 電子紙）
- 電子紙專屬閱讀主題（純黑粗體大字，Boox 最佳化）

### 🎬 影音庫（休閒區）
- 影片 / 音頻本地儲存（IndexedDB Blob）
- 黑膠唱片播放器介面
- 收藏與分類

### 🛠 共用
- 倒數計時器（多組考試）
- AI 弱點診斷報告（Markdown / JSON 匯出）
- Google Apps Script 雲端備份 / 還原
- 本地完整備份 / 還原（含 Blob 檔案）
- 偵錯面板（攔截 console 錯誤）

---

## 技術架構

- 純 vanilla JavaScript，無框架，IIFE 模組化
- IndexedDB（Dexie）儲存，schema version 4
- Service Worker 離線快取，更新橫幅機制（不需手動清快取）
- 雙版本系統：APP_VERSION（程式）+ DATA_VERSION（題庫）
- TTS：瀏覽器內建 speechSynthesis（離線）+ Azure TTS（選用）
- PDF：PDF.js　OCR：Tesseract.js（動態載入）
- 雙主題：深色（預設）/ 電子紙（eink，Boox 最佳化，自動停用動畫）

### 檔案結構
```
index.html              主頁面（所有頁面 DOM）
sw.js                   Service Worker（快取 + 更新）
manifest.json           PWA manifest
css/
  base.css              基礎樣式 + 視覺美化層
  quiz.css books.css media.css english.css splash.css
  eink.css              電子紙主題覆蓋
js/
  db.js                 IndexedDB + Dexie schema + 快取
  utils.js              共用工具（解析、esc、遺忘曲線、TTS 基礎）
  app.js                導覽、區域系統、主題、SW 更新
  data.js               題目管理 + 法條資料庫
  english.js            英語學習庫
  quiz.js               刷題模式
  stats.js              統計 + AI 弱點診斷
  settings.js           設定 + 備份還原
  books.js media.js     電子書庫 / 影音庫
  countdown.js          考試倒數
  layout.js tts.js      版面 / 語音朗讀
```

---

## 開發慣例

- 每次更新版本須同步修改 sw.js 與 js/db.js 的 APP_VERSION
- 模組化：IIFE 包裝，公開 API 白名單寫在檔尾（window.XxxMod）
- 無死碼、無誤傷：刪除函式前查證所有引用點
- 完整檔案替換，不用部分補丁
- 驗證：node 語法檢查 + 執行期載入測試 + HTML 事件函式交叉比對

---

## 部署

GitHub Pages：https://a717418756-ux.github.io

更新部署後，App 會偵測新版並顯示「發現新版本」橫幅，點擊即更新（題庫資料保留）。
