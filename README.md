# Y.C. 多功能專用平台

> 版本 1.9.3 ｜ PWA 離線應用 ｜ 部署於 GitHub Pages

---

## 功能概覽

### 📚 考試區
- 題庫匯入（TXT/PDF OCR 後貼入）
- 單題 / 組題模式作答
- 即時批改、錯題統計
- 法條查詢（全文搜尋）
- 倒數計時器
- Google Apps Script 雲端備份

### 🎬 影音庫
- 影片 / 音頻本地儲存（IndexedDB Blob）
- 橫向捲動首頁（最近播放、收藏、影片、音頻）
- 黑膠唱片播放器（倍速、循環、隨機、定時）
- 收藏、批量刪除、展開模式

### 📖 書庫
- PDF / ePub / TXT 閱讀器
- 木質書架 UI（書架 / 封面 / 清單三種顯示模式）
- 最近閱讀、藏書 / 收藏切換
- epub.js 分頁閱讀，閱讀位置 CFI 記憶
- 字體大小調整、深色 / 護眼 / 白色主題

### ⚙️ 設定
- 深色 / 淺色 / eink 電子紙主題
- eink 模式：無動畫、標楷體、大字、加框線（對應 BOOX 閱讀器）
- Google Apps Script 備份設定

---

## 技術架構

| 項目 | 說明 |
|------|------|
| 儲存 | IndexedDB（Dexie.js 4.0.8） |
| 離線 | Service Worker（Cache First） |
| epub | epub.js 0.3.93 + JSZip 3.10.1（本地） |
| 圖表 | Chart.js 4.4.0（CDN） |
| 部署 | GitHub Pages |

### 檔案結構
```
├── index.html          主頁面
├── sw.js               Service Worker
├── manifest.json       PWA 設定
├── css/
│   ├── app.css         主樣式（2900+ 行）
│   └── splash.css      啟動畫面樣式
├── js/
│   ├── app.js          主程式（導航、SW 更新）
│   ├── db.js           IndexedDB 操作（Dexie）
│   ├── data.js         題庫資料
│   ├── quiz.js         考試區邏輯
│   ├── books.js        書庫邏輯（含 epub 閱讀器）
│   ├── media.js        影音庫邏輯（含黑膠播放器）
│   ├── utils.js        工具函式
│   ├── stats.js        統計
│   ├── settings.js     設定
│   ├── countdown.js    倒數計時
│   ├── epub.min.js     epub.js 0.3.93（本地，218KB）
│   └── jszip.min.js    JSZip 3.10.1（本地，95KB）
└── icons/
    ├── vinyl-record.png 黑膠唱盤圖示
    ├── tonearm.png      唱針圖示
    └── icon-*.png       PWA 圖示（各尺寸）
```

---

## 部署說明

1. 將所有檔案上傳至 GitHub repository
2. Settings → Pages → Deploy from branch（main）
3. 首次開啟會安裝 Service Worker，之後離線可用

### ⚠️ 首次部署需上傳的新增檔案
- `js/epub.min.js`（epub.js 本地版，218KB）
- `js/jszip.min.js`（JSZip 本地版，95KB）

---

## 資料儲存說明

所有資料均儲存於**瀏覽器本機 IndexedDB**，不上傳至任何伺服器。

| Store | 內容 |
|-------|------|
| `questions` | 題庫題目 |
| `attempts` | 作答記錄 |
| `laws` | 法條資料 |
| `countdowns` | 倒數計時設定 |
| `ebooks` | 書籍 metadata + Blob 檔案 |
| `leisuremedia` | 影音 metadata + Blob 檔案 |
| `usageLogs` | 使用時間記錄 |

---

## 更新紀錄

### v1.9.3（當前）
- CSS 死碼清理（`.ov`、`.sh`、`.shdl` 重複定義移除）
- `media-audio-list`、`media-hcard-thumb` 片段合併
- books.js 死碼注釋行移除
- 影音庫標題右側裝飾線 + 卡片底部分隔線最終版

### v1.9.x
- 影音庫標題行 `order` 控制（標題→裝飾線→更多按鈕）
- eink 主題完整覆蓋（書庫、閱讀器、影音庫、黑膠播放器）
- epub.js + JSZip 改為本地引入，解決 JSZip 依賴問題
- Service Worker 改為 install 後立即 skipWaiting，自動更新

### v1.8.x
- 書庫藏書/收藏切換（同頁書架篩選）
- 收藏操作移至書籍資訊視窗
- 黑膠播放器播放清單標題重構（移除叉叉）
- CSS 大規模死碼清理（重複 class 整合）

### v1.7.x
- epub.js 閱讀器（分頁模式、CFI 位置記憶）
- SW 核心/可選資源分離（解決安裝失敗問題）
- 影音庫首頁結構重構（media-sec-wrap）
