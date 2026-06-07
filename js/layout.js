// ══ layout.js — 裝置偵測與版型切換 ══════════════════════════
// 功能：根據 window.innerWidth 設定 html[data-layout]
//       透過 CSS Variables 控制書架、影音卡片、閱讀器寬度
//       epub 閱讀模式：html[data-reading] 控制閱讀器專屬樣式
//
// 原則：
//   - 不修改任何現有 JS 邏輯
//   - 不修改 IndexedDB / Dexie / Service Worker
//   - 新增功能僅透過 data-layout / data-reading + CSS Variables 控制
//   - 不直接操作 style，僅設定 CSS Variables 和 data 屬性
// ════════════════════════════════════════════════════════════

(function(){
  'use strict';

  // ── 版型斷點 ────────────────────────────────────────────────
  const BREAKPOINTS = {
    mobile:  0,
    tablet:  600,
    desktop: 900,
  };

  // ── 各版型的 CSS Variables ───────────────────────────────────
  const LAYOUT_VARS = {
    mobile: {
      '--layout-card-w':      '130px',
      '--layout-card-audio-w':'96px',
      '--layout-card-audio-h':'96px',
      '--layout-card-video-w':'140px',
      '--layout-card-video-h':'90px',
      '--layout-shelf-h':     '160px',
      '--layout-shelf-min-w': '18px',
      '--layout-reader-max-w':'100%',
      '--layout-page-max-w':  '540px',
      '--layout-font-scale':  '1',
    },
    tablet: {
      '--layout-card-w':      '150px',
      '--layout-card-audio-w':'110px',
      '--layout-card-audio-h':'110px',
      '--layout-card-video-w':'180px',
      '--layout-card-video-h':'110px',
      '--layout-shelf-h':     '180px',
      '--layout-shelf-min-w': '20px',
      '--layout-reader-max-w':'680px',
      '--layout-page-max-w':  '680px',
      '--layout-font-scale':  '1.05',
    },
    desktop: {
      '--layout-card-w':      '170px',
      '--layout-card-audio-w':'120px',
      '--layout-card-audio-h':'120px',
      '--layout-card-video-w':'220px',
      '--layout-card-video-h':'130px',
      '--layout-shelf-h':     '200px',
      '--layout-shelf-min-w': '22px',
      '--layout-reader-max-w':'780px',
      '--layout-page-max-w':  '780px',
      '--layout-font-scale':  '1.1',
    },
  };

  // ── 目前版型 ─────────────────────────────────────────────────
  let _currentLayout = '';

  function _getLayout(w){
    if(w >= BREAKPOINTS.desktop) return 'desktop';
    if(w >= BREAKPOINTS.tablet)  return 'tablet';
    return 'mobile';
  }

  function _applyLayout(layout){
    if(layout === _currentLayout) return;
    _currentLayout = layout;

    const html = document.documentElement;
    html.setAttribute('data-layout', layout);

    const vars = LAYOUT_VARS[layout];
    for(const [k, v] of Object.entries(vars)){
      html.style.setProperty(k, v);
    }
  }

  // ── ResizeObserver（優先）或 resize 事件 ────────────────────
  function _update(){
    _applyLayout(_getLayout(window.innerWidth));
  }

  let _ro = null;
  function _init(){
    _update();

    if(window.ResizeObserver){
      _ro = new ResizeObserver(_update);
      _ro.observe(document.documentElement);
    } else {
      // fallback：throttle resize 事件
      let _timer = null;
      window.addEventListener('resize', ()=>{
        if(_timer) return;
        _timer = setTimeout(()=>{ _timer=null; _update(); }, 150);
      });
    }
  }

  // ── epub 閱讀模式 ────────────────────────────────────────────
  // books.js 直接操作 html.classList（reader-active/reader-ui-visible）
  // setReadingMode 保留為輔助 API，可由外部呼叫同步狀態

  const READING_VARS = {
    '--reading-line-height': '2.1',
    '--reading-max-w':       'var(--layout-reader-max-w)',
    '--reading-padding':     '24px',
    '--tr':                  'none',       // 關閉全域動畫
  };

  const NORMAL_VARS = {
    '--reading-line-height': '1.85',
    '--reading-max-w':       '100%',
    '--reading-padding':     '0px',
    '--tr':                  '.2s cubic-bezier(.4,0,.2,1)',
  };

  function setReadingMode(on){
    const html = document.documentElement;
    // books.css 使用 .reader-active class 控制閱讀器樣式
    html.classList.toggle('reader-active', on);
    // CSS Variables 仍透過 data 屬性更新（供 layout-aware 元件使用）
    const vars = on ? READING_VARS : NORMAL_VARS;
    for(const [k, v] of Object.entries(vars)){
      html.style.setProperty(k, v);
    }
  }

  // ── 公開 API ─────────────────────────────────────────────────
  window.setReadingMode = setReadingMode;
  window._layoutInit    = _init;

  // DOM 就緒後初始化
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _init, { once:true });
  } else {
    _init();
  }

})();
