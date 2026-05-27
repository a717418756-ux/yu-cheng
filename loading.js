/* ═══════════════════════════════════════════════════════
   LOADING SCREEN LOGIC — KnowledgeForce
   Controls: progress bar, percentage counter, dismissal
   No external deps · Vanilla JS
═══════════════════════════════════════════════════════ */

(function LoadingScreen() {
  'use strict';

  var _bar  = document.getElementById('splashProg');
  var _pct  = document.getElementById('splashPct');
  var _splash = document.getElementById('splash');
  var _app    = document.getElementById('app');

  if (!_splash) return;

  /* ── Progress ticker ─────────────────────────────── */
  var _val = 0;
  var _timer = setInterval(function () {
    /* Decelerate as it approaches 95 — feels organic */
    var step = _val < 40  ? Math.random() * 16 + 6  :
               _val < 70  ? Math.random() * 10 + 3  :
               _val < 88  ? Math.random() * 5  + 1  : 0;
    _val = Math.min(_val + step, 95);

    if (_bar) _bar.style.width = _val + '%';
    if (_pct) _pct.textContent  = Math.floor(_val) + '%';
  }, 90);

  /* ── Dismiss splash ──────────────────────────────── */
  function dismiss() {
    clearInterval(_timer);

    /* Snap bar to 100 */
    if (_bar) _bar.style.width = '100%';
    if (_pct) _pct.textContent  = '100%';

    /* Brief pause so 100% is visible, then fade out */
    setTimeout(function () {
      if (_splash) _splash.classList.add('gone');
    }, 200);
  }

  /* ── Reveal app ──────────────────────────────────── */
  function revealApp() {
    if (_app) _app.classList.add('ready');
  }

  /* Mirror original boot timing exactly */
  setTimeout(revealApp, 400);
  setTimeout(dismiss,   1400);

})();
