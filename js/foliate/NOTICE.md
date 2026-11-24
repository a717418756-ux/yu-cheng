# foliate-js（vendored）

- 來源：https://github.com/johnfactotum/foliate-js ，commit 78914aef4466eb960965702401634c2cb348e9b1（2026-05-01），MIT（見 LICENSE）
- Readest（https://github.com/readest/readest，AGPL-3.0）用的就是這個引擎；Y.C. 只用 MIT 授權的 foliate-js，沒有複製 Readest 的程式碼
- vendor/：zip.js（BSD-3-Clause）、fflate（MIT）、PDF.js 5.5.207（Apache-2.0，含 cmaps 中文字型對照、standard_fonts；不含 .map）
- Y.C. 改動：paginator.js、fixed-layout.js 的 iframe sandbox 拿掉 `allow-scripts`（電子書裡的 script 不執行，避免讀到 App 的資料）；PDF 例外（pdf.js 在 book 物件標 `ycTrusted`，頁面只有 pdf.js 畫的 canvas，canvas 在不能執行程式的頁面不顯示）；pdf.js 另外在 book 物件掛 `ycPdf`（PDF.js 文件），給 reader.js 做 PDF 全文搜尋
- paginator.js setStyles 的 requestAnimationFrame 加 null 檢查（關書後才執行時不報錯）
- 更新時：整個資料夾換新版，再套一次上面的改動
