# Y.C. 多功能專用平台

> 版本 1.9.6 ｜ PWA 離線應用 ｜ 部署於 GitHub Pages

---

## 功能概覽

### 📚 考試區
- 題庫匯入（TXT 貼入 / JSON 匯入）
- 單題 / 組題模式作答，即時批改
- 遺忘曲線複習排程（7 級間隔：1、3、7、14、30、60、180 天）
- 危險度分析（🔴🟠🟡🟢）
- 法條全文搜尋
- 錯題集、星號題、複習池
- 倒數計時器（多組）
- Google Apps Script 雲端備份 / 還原

### 🎬 影音庫
- 影片 / 音頻本地儲存（IndexedDB Blob，不上雲）
- 橫向捲動首頁（最近播放、收藏、影片、音頻）
- 黑膠唱片播放器（倍速、循環、隨機、定時關閉）
- 封面裁剪功能
- 收藏、批量刪除、展開模式

### 📖 書庫
- PDF / ePub / TXT 閱讀器
- 木質書架 UI（書架 / 封面 / 清單三種顯示模式）
- 最近閱讀橫向捲動、藏書 / 收藏切換
- epub.js 0.3.93 分頁閱讀，CFI 位置記憶
- 字體大小調整、深色 / 護眼 / 白色主題

### ⚙️ 設定
- 深色 / 淺色 / eink 電子紙三種主題
- eink 模式：無動畫陰影、標楷體、大字、框線（針對 BOOX 閱讀器優化）
- Google Apps Script 雲端備份設定
- 系統診斷（顯示錯誤日誌）

---

## 技術架構

| 項目 | 說明 |
|------|------|
| 儲存 | IndexedDB（Dexie.js 4.0.8） |
| 離線 | Service Worker（Cache First + skipWaiting） |
| epub | epub.js 0.3.93 + JSZip 3.10.1（本地） |
| 圖表 | Chart.js 4.4.0（CDN，快取後離線可用） |
| 部署 | GitHub Pages |

### 檔案結構
```
├── index.html              主頁面（SPA）
├── sw.js                   Service Worker
├── manifest.json           PWA 設定
├── css/
│   ├── app.css             主樣式（2900+ 行）
│   └── splash.css          啟動畫面樣式
├── js/
│   ├── app.js              主程式（導航、SW 更新、主題）
│   ├── db.js               IndexedDB 資料層（Dexie）
│   ├── data.js             內建題庫資料
│   ├── quiz.js             考試區邏輯
│   ├── books.js            書庫邏輯（含 epub 閱讀器）
│   ├── media.js            影音庫邏輯（含黑膠播放器）
│   ├── utils.js            工具函式（解析、OCR 修正）
│   ├── stats.js            統計圖表
│   ├── settings.js         設定頁（備份 / 還原）
│   ├── countdown.js        倒數計時
│   ├── epub.min.js         epub.js 0.3.93（本地，218KB）
│   └── jszip.min.js        JSZip 3.10.1（本地，95KB）
└── icons/
    ├── vinyl-record.png    黑膠唱盤
    ├── tonearm.png         唱針
    └── icon-*.png          PWA 圖示（各尺寸）
```

---

## 部署說明

1. 將所有檔案上傳至 GitHub repository
2. Settings → Pages → Deploy from branch（main / root）
3. 首次開啟會安裝 Service Worker，之後完全離線可用

### ⚠️ 首次部署必須上傳的本地函式庫
| 檔案 | 大小 | 說明 |
|------|------|------|
| `js/epub.min.js` | 218KB | epub.js（需要 JSZip） |
| `js/jszip.min.js` | 95KB | JSZip（epub.js 依賴） |

> index.html 中 `jszip.min.js` 必須在 `epub.min.js` 之前載入

---

## 資料儲存說明

**所有資料均存於裝置本機 IndexedDB，不上傳任何伺服器。**

| Store | 內容 |
|-------|------|
| `questions` | 題庫題目（含遺忘曲線欄位） |
| `attempts` | 作答記錄 |
| `laws` | 法條資料 |
| `countdowns` | 倒數計時設定 |
| `ebooks` | 書籍 metadata + Blob 檔案 |
| `leisuremedia` | 影音 metadata + Blob 檔案 |
| `usageLogs` | 各區使用時間記錄 |
| `settings` | 設定鍵值對 |

### 縮圖儲存格式
v1.9.6 起縮圖改為 **Blob 格式**儲存（比舊版 base64 少 33% 空間）：
- 新增的封面 / 縮圖自動使用 Blob
- 舊版 base64 縮圖仍可正常顯示（自動相容，不需遷移）

---

## Google Apps Script 備份設定

1. 建立新的 Google Apps Script 專案
2. 貼入以下代碼並部署為 Web App（執行身分：我、存取：任何人）

```javascript
const PASSWORD = '你的密碼';  // 自訂密碼
const FOLDER_NAME = 'YC_Platform_Backup';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.password !== PASSWORD) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: '密碼錯誤' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const folder = getOrCreateFolder(FOLDER_NAME);

    if (body.action === 'backup') {
      const file = getOrCreateFile(folder, body.filename);
      file.setContent(body.data);
      return json({ ok: true });
    }

    if (body.action === 'restore') {
      const files = folder.getFilesByName(body.filename);
      if (!files.hasNext()) return json({ ok: false, error: '找不到備份檔' });
      const data = files.next().getBlob().getDataAsString();
      return json({ ok: true, data: data });
    }

    return json({ ok: false, error: '未知 action' });
  } catch(err) {
    return json({ ok: false, error: err.message });
  }
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function getOrCreateFile(folder, name) {
  const files = folder.getFilesByName(name);
  if (files.hasNext()) { const f = files.next(); f.setContent(''); return f; }
  return folder.createFile(name, '');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. 複製 Web App URL，貼入設定頁的「Apps Script 網址」欄位

---

## 版本紀錄

### v1.9.6（當前）
- 縮圖儲存格式改為 **Blob**（比 base64 少 33%，舊資料自動相容）
- `URL.createObjectURL` 完整 revoke 機制（避免記憶體洩漏）
- 雲端還原 bug 修正：callback async 錯誤攔截、json.data 型別判斷、清除前先驗證資料有效性

### v1.9.5
- 縮圖 **lazy 讀取**：清單載入時不含縮圖，渲染後非同步填充
- 新增 `_getBookThumb(id)`、`_getMediaThumb(id)` 按需讀取
- 設定頁加入系統診斷區（錯誤日誌 + 清除按鈕）

### v1.9.3
- CSS 大規模死碼清理（`.ov`、`.sh`、`.shdl` 重複定義）
- `media-audio-list`、`media-hcard-thumb` 片段合併
- 影音庫標題右側裝飾線 + 卡片底部分隔線最終版

### v1.9.x
- eink 主題完整覆蓋（書庫、閱讀器、影音庫、黑膠播放器）
- epub.js + JSZip 改為本地引入，解決 JSZip 依賴問題
- Service Worker 改為 install 後立即 skipWaiting 自動更新
- 書庫藏書 / 收藏切換（同頁書架篩選）

### v1.8.x
- 影音庫分隔線重構（標題右側裝飾線 + 卡片底長線）
- 黑膠播放器播放清單重構
- CSS 重複定義整合（括號配對驗證）

### v1.7.x
- epub.js 閱讀器（分頁模式、CFI 位置記憶、主題切換）
- Service Worker 核心 / 可選資源分離

---

## 已知限制

- epub 需要標準格式，極少數格式不規範的書可能無法顯示
- 縮圖超過約 500 張時建議定期清理不用的書籍 / 影音
- GAS 備份僅含考試區資料（題庫、法條、作答記錄），不含書庫和影音庫的實際檔案

