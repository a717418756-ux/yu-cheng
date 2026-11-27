# js/lib 第三方函式庫授權

v4.67.0 起放在本機，從 npm 官方套件原檔複製，沒有修改內容（perfect-freehand 只外包一層把 CommonJS 匯出掛到 `window.PerfectFreehand`）。

| 檔案 | 套件與版本 | 授權 | 原始專案 |
|---|---|---|---|
| perfect-freehand.js | perfect-freehand 1.2.3 | MIT，© 2021 Stephen Ruiz Ltd | https://github.com/steveruizok/perfect-freehand |
| diff.min.js | diff（jsdiff）8.0.4 | BSD-3-Clause，© 2009-2015 Kevin Decker | https://github.com/kpdecker/jsdiff |
| d3.min.js | d3 7.9.0 | ISC，© 2010-2023 Mike Bostock | https://github.com/d3/d3 |
| markmap-view.js | markmap-view 0.18.12（browser 版） | MIT，© 2020 Gerald | https://github.com/markmap/markmap |

更新方式：`npm i 套件@版本 --ignore-scripts` 後從 `node_modules/<套件>/dist/` 複製同名檔案，改 README 與本表的版本號，並升 `sw.js` 的 APP_VERSION。
