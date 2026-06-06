# Y.C. 多功能專用平台

> 版本 2.1.5 ｜ PWA 離線應用 ｜ 部署於 GitHub Pages

---

## 功能概覽

### 📚 考試區
- 題庫匯入（大量貼上 / 逐一新增）
- 單題 / 組題模式作答，即時批改
- 遺忘曲線複習排程（7 級間隔）
- 危險度分析（🔴🟠🟡🟢）
- 法條全文搜尋
- 倒數計時器（多組）
- AI 弱點診斷報告（Markdown / JSON 匯出）
- Google Apps Script 雲端備份 / 還原

### 🎬 影音庫
- 影片 / 音頻本地儲存（IndexedDB Blob）
- 橫向捲動首頁（最近播放、收藏、影片、音頻）
- 黑膠唱片播放器（倍速、循環、隨機、定時關閉）
- 封面裁剪功能
- 收藏、批量刪除、展開模式（返回 ｜ 標題 ｜ 批量刪除 ｜ 新增）

### 📖 書庫
- PDF / ePub / TXT 閱讀器
- 木質書架 UI（書架 / 封面 / 清單三種顯示模式）
- 書背顯示邏輯：
  - 有上傳書背圖 → 拉伸填滿書背，不顯示書名
  - 無書背圖 → 封面模糊背景 + 書名置中
- 最近閱讀橫向捲動、藏書 / 收藏切換
- 書架排序（觸摸拖拉，支援手機）
- epub.js 分頁閱讀，CFI 位置記憶
- 字體大小調整、深色 / 護眼 / 白色主題

### ⚙️ 設定
- 深色 / 淺色 / eink 電子紙三種主題
- eink 模式：無動畫、標楷體、大字（針對 BOOX 閱讀器優化）
- Google Apps Script 雲端備份設定
- 系統診斷（顯示錯誤日誌）

---

## 技術架構

| 項目 | 說明 |
|------|------|
| 儲存 | IndexedDB（Dexie.js 4.0.8） |
| 離線 | Service Worker（Cache First + skipWaiting） |
| epub | epub.js 0.3.93 + JSZip 3.10.1（本地） |
| 圖表 | Chart.js 4.4.0（CDN） |
| 部署 | GitHub Pages |

### 檔案結構
```
├── index.html              主頁面（SPA）
├── sw.js                   Service Worker
├── manifest.json           PWA 設定
├── css/
│   ├── base.css            CSS 變數、reset、共用元件、首頁（627行）
│   ├── books.css           書庫、書架、閱讀器（412行）
│   ├── media.css           影音庫、黑膠播放器（1244行）
│   ├── quiz.css            考試區、統計、設定（333行）
│   └── eink.css            eink 電子紙主題（260行）
├── js/
│   ├── app.js              主程式（導航、SW 更新、主題）
│   ├── db.js               IndexedDB 資料層（Dexie）
│   ├── data.js             題庫管理、大量貼題、首頁渲染
│   ├── quiz.js             考試區邏輯
│   ├── books.js            書庫邏輯（含 epub 閱讀器）
│   ├── media.js            影音庫邏輯（含黑膠播放器）
│   ├── utils.js            工具函式（解析、OCR 修正）
│   ├── stats.js            統計、學習軌跡、AI 分析
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

### ⚠️ 必須上傳的本地函式庫
| 檔案 | 大小 | 說明 |
|------|------|------|
| `js/epub.min.js` | 218KB | epub.js（需要 JSZip） |
| `js/jszip.min.js` | 95KB | JSZip（epub.js 依賴） |

> `jszip.min.js` 必須在 `epub.min.js` 之前載入（index.html 已設定正確順序）

### ⚠️ CSS 分割版本注意
v2.1.0 起 `css/app.css` 已拆分為 5 個檔案。**請刪除 GitHub 上的 `css/app.css`**，改上傳：
`base.css`、`books.css`、`media.css`、`quiz.css`、`eink.css`

---

## Google Apps Script 備份設定

1. 建立新的 Google Apps Script 專案
2. 貼入以下代碼，部署為 Web App（執行身分：我、存取：任何人）

```javascript
const PASSWORD = '你的密碼';
const FOLDER_NAME = 'YC_Platform_Backup';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.password !== PASSWORD)
      return json({ ok: false, error: '密碼錯誤' });
    const folder = getOrCreateFolder(FOLDER_NAME);
    if (body.action === 'backup') {
      const file = getOrCreateFile(folder, body.filename);
      file.setContent(body.data);
      return json({ ok: true });
    }
    if (body.action === 'restore') {
      const files = folder.getFilesByName(body.filename);
      if (!files.hasNext()) return json({ ok: false, error: '找不到備份檔' });
      return json({ ok: true, data: files.next().getBlob().getDataAsString() });
    }
    return json({ ok: false, error: '未知 action' });
  } catch(err) { return json({ ok: false, error: err.message }); }
}

function getOrCreateFolder(name) {
  const f = DriveApp.getFoldersByName(name);
  return f.hasNext() ? f.next() : DriveApp.createFolder(name);
}
function getOrCreateFile(folder, name) {
  const f = folder.getFilesByName(name);
  if (f.hasNext()) { const x = f.next(); x.setContent(''); return x; }
  return folder.createFile(name, '');
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. 複製 Web App URL，貼入設定頁的「Apps Script 網址」欄位

---

## 備份範圍說明

| 資料 | 備份 | 說明 |
|------|------|------|
| 題庫（questions） | ✅ | 完整備份 |
| 法條（laws） | ✅ | 完整備份 |
| 作答記錄（attempts） | ✅ | 完整備份 |
| 倒數計時（countdowns） | ✅ | 完整備份 |
| 座右銘（motto） | ✅ | 完整備份 |
| 書庫 metadata | ✅ | 書名、作者、分類等資料 |
| 影音庫 metadata | ✅ | 標題、分類等資料 |
| 書庫 / 影音庫實際檔案 | ❌ | Blob 太大，不上傳 GAS |

---

## 版本紀錄

### v2.1.5（當前）
- 書庫排序模式加入手機觸摸拖拉（touchstart/touchend）
- 首頁學習軌跡格子大小修正（overflow-x:hidden 問題）
- 大量新增題目時 textarea 中文輸入 bug 修正

### v2.1.4
- 書背模糊效果加強（canvas 多次縮放 + CSS blur 雙重疊加）
- epub 閱讀器主題切換修正（iframe 背景強制覆蓋）

### v2.1.3
- 書背圖：有上傳書背圖時強制拉伸填滿（不維持比例）
- 無書背圖時：模糊背景書名置中，不顯示作者

### v2.1.2
- 書背圖壓縮改為 contain 模式（完整顯示不裁切）
- 無書背圖時移除暗色遮罩，保持原始亮度

### v2.1.1
- 有上傳書背圖：cover 填滿書背，不留空白
- 無書背圖：封面模糊背景 + 書名置中

### v2.1.0
- CSS 分割：app.css → base / books / media / quiz / eink 五個檔案
- 書背顯示邏輯完整實作（hasSpineImg 欄位）
- 新增書本表單加入書背圖上傳欄位

### v2.0.x
- 影音庫展開模式 hd 重構（三欄：返回 ｜ 標題 ｜ 批量+新增）
- 書架比例換算修正（固定書架高度，按真實比例）
- 音頻縮圖改 Spotify 正方形（96×96px）
- 影片大卡首張（220×124px），其餘正常尺寸
- epub「載入中」隱藏，進度百分比正確計算
- 書籍資訊編輯（書名、作者、分類、標籤、尺寸）

### v1.9.x
- 縮圖儲存改 Blob（比 base64 少 33%）+ Lazy 讀取
- 雲端還原 bug 修正（callback async 錯誤攔截）
- eink 主題完整覆蓋

---

## 已知限制

- epub 需要標準格式，格式不規範的書可能無法顯示
- GAS 備份不含書庫和影音庫的實際檔案（只備份 metadata）
- 書背圖為新增時生成，舊書需重新新增才套用新邏輯
