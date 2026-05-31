# 警察考題庫 Pro

警察特考・升官等考試（警佐二類）題庫管理 PWA。支援離線使用、IndexedDB 本機儲存、Google Drive 雲端備份。

---

## 功能總覽

| 功能 | 說明 |
|------|------|
| 📥 大量貼題 | 貼入考古題文字，自動解析成結構化題目 |
| 🏆 測驗模式 | 今日複習・隨機刷題・危險題・模擬考・快刷5題 |
| 📊 分析匯出 | 弱點分析、AI 備考建議（Markdown/JSON 匯出） |
| ⚖ 法條資料庫 | 批次匯入法條、挖空練習、關聯法條查詢 |
| ☁ GDrive 備份 | OAuth2 登入 Google，一鍵備份/還原 |
| 📅 考試倒數 | 設定考試日期，首頁即時顯示倒數 |

---

## 專案結構

```
police-exam-pwa/
│
├── index.html          # 主頁（HTML 結構 + 載入順序）
├── manifest.json       # PWA Manifest
├── sw.js               # Service Worker（離線快取）
├── .gitignore
│
├── css/
│   └── app.css         # 全部樣式（CSS 變數、dark theme、元件）
│
├── js/                 # ── 載入順序（有依賴順序）──
│   ├── db.js           # [1] IndexedDB CRUD、快取層、遺忘曲線算法
│   ├── app.js          # [2] 全域狀態(S)、工具函式、關鍵字/錯題算法
│   ├── parser.js       # [3] OCR 前處理、題目解析、法條文字解析
│   ├── quiz.js         # [4] 測驗模式、模擬考、數字魔鬼、挖空練習
│   ├── law.js          # [5] 法條資料庫渲染、法規閱讀器、題目閱覽
│   ├── ui.js           # [6] 題目管理（新增/編輯/刪除/搜尋/列表）
│   ├── bulk.js         # [7] 大量貼題匯入
│   ├── stats.js        # [8] 統計分析、AI 弱點報告產生
│   ├── backup.js       # [9] 設定頁、備份/還原、Google Drive 同步、倒數計時
│   └── home.js         # [10] 首頁渲染、FAB 導覽、Zone 展開收合、初始化
│
└── icons/
    ├── icon-192.png    # PWA 圖示（需自行準備）
    └── icon-512.png    # PWA 圖示（需自行準備）
```

---

## 快速部署到 GitHub Pages

```bash
# 1. 建立 GitHub repo（建議 private）
git init
git add .
git commit -m "init: 警察考題庫 Pro PWA"

# 2. 推送到 GitHub
git remote add origin https://github.com/<你的帳號>/police-exam-pwa.git
git push -u origin main

# 3. 開啟 GitHub Pages
# Settings → Pages → Source: main branch / root
# 網址：https://<你的帳號>.github.io/police-exam-pwa/
```

> ⚠ 資料全部存在裝置本機（IndexedDB），GitHub Pages 只提供靜態檔案服務，不儲存任何資料。

---

## PWA 安裝方式

### iOS（Safari）
1. 用 Safari 開啟網址
2. 點下方分享按鈕 → **加入主畫面**
3. 即可像 App 一樣使用，支援離線

### Android（Chrome）
1. 用 Chrome 開啟網址
2. 瀏覽器會自動提示「新增到主畫面」
3. 或點右上角選單 → **安裝應用程式**

---

## Google Drive 備份設定

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立專案 → 啟用 **Google Drive API**
3. 建立 OAuth 2.0 用戶端 ID（類型：網頁應用程式）
4. 授權的 JavaScript 來源填入你的 GitHub Pages 網址
5. 複製 Client ID，貼入 App 設定頁的「Google Client ID」欄位

---

## 法條匯入格式

支援全國法規資料庫的標準格式，直接貼上即可：

```
第 1 條
本法以維持公共秩序，保護社會安全…

第 2 條
本法所稱主管機關…
```

也支援含編/章/節的完整結構（三層）。

---

## 版本

`v114053101`（民國114年5月31日 第1版）

---

## 授權

僅供個人學習使用。考題內容來源為考選部公開考古題，依政府資訊公開原則使用。
