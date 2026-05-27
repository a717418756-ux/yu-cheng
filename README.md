# KnowledgeForce 📚⚖️

> 智慧學習作戰平台｜警佐升等考試備考工具

## 檔案結構

```
knowledgeforce/
├── index.html      # 主頁面（HTML 骨架）
├── app.css         # 主應用樣式
├── loading.css     # 載入畫面樣式（玻璃擬態動畫）
├── app.js          # 主應用邏輯（模組化）
├── loading.js      # 載入畫面邏輯
├── manifest.json   # PWA Manifest
├── sw.js           # Service Worker（離線快取）
├── icons/          # PWA 圖示（需自行放入）
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

## 部署方式（GitHub Pages）

1. 上傳此資料夾至 GitHub repo
2. Settings → Pages → Branch: `main` / `master`，資料夾選 `/ (root)`
3. 約 1 分鐘後即可透過 `https://<username>.github.io/<repo>/` 存取
4. 在手機瀏覽器開啟後，選「加入主畫面」即可安裝為 PWA

## 圖示製作

需自行準備兩張 PNG 圖示放入 `icons/` 資料夾：
- `icon-192.png`（192×192 px）
- `icon-512.png`（512×512 px）

可用 [PWA Builder Image Generator](https://www.pwabuilder.com/imageGenerator) 一鍵產生。
