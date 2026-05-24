const Toast = (() => {
  function show(msg, type='info', dur=2500) {
    const container = document.getElementById('toast-stack');
    if (!container) { setTimeout(()=>show(msg,type,dur),200); return; }
    const icons = {success:'✓',error:'✕',warn:'⚠',info:'·'};
    const el = document.createElement('div');
    el.className = 'ti ' + type;
    el.innerHTML = '<span class="ti-ico">' + (icons[type]||'·') + '</span><span>' + msg + '</span>';
    container.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => { el.classList.remove('show'); setTimeout(()=>el.remove(),300); }, dur);
  }
  return {
    show,
    success: (m,d) => show(m,'success',d),
    error:   (m,d) => show(m,'error',d),
    warn:    (m,d) => show(m,'warn',d),
    info:    (m,d) => show(m,'info',d),
  };
})();

const Modal = (() => {
  let res = null;
  function confirm(title, body, ok='確認', cancel='取消') {
    return new Promise(r => {
      res = r;
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').textContent = body;
      document.getElementById('modalConfirm').textContent = ok;
      document.getElementById('modalCancel').textContent = cancel;
      document.getElementById('modal-ov').style.display = 'flex';
    });
  }
  function init() {
    document.getElementById('modalConfirm').addEventListener('click', () => {
      document.getElementById('modal-ov').style.display = 'none';
      if (res) { res(true); res = null; }
    });
    document.getElementById('modalCancel').addEventListener('click', () => {
      document.getElementById('modal-ov').style.display = 'none';
      if (res) { res(false); res = null; }
    });
    document.getElementById('modal-ov').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('modal-ov').style.display = 'none';
        if (res) { res(false); res = null; }
      }
    });
  }
  return { confirm, init };
})();

const Router = (() => {
  let current = 'home';
  let hist = ['home'];
  const cbs = {};

  function go(page) {
    if (page === current) { FAB.close(); return; }
    const from = document.getElementById('page-' + current);
    const to   = document.getElementById('page-' + page);
    if (!to) return;
    if (from) {
      from.classList.remove('active');
      from.classList.add('out');
      setTimeout(()=>from.classList.remove('out'), 280);
    }
    to.classList.add('active');
    to.scrollTop = 0;
    hist.push(page);
    current = page;
    FAB.close();
    if (cbs[page]) cbs[page]();
  }

  function back() {
    if (hist.length > 1) {
      hist.pop();
      const prev = hist[hist.length - 1];
      go(prev);
      hist.pop(); // go() pushes again, remove duplicate
    }
  }

  function onEnter(page, fn) { cbs[page] = fn; }
  function getCurrent() { return current; }
  function initNav() {}

  return { go, back, onEnter, getCurrent, initNav };
})();

/**
 * core/db.js — IndexedDB abstraction layer
 * Single source of truth for all persistence.
 */
const DB = (() => {
  const NAME = 'KnowledgePod';
  const VERSION = 2;
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // courses
        if (!db.objectStoreNames.contains('courses')) {
          db.createObjectStore('courses', { keyPath: 'id' });
        }
        // chunks
        if (!db.objectStoreNames.contains('chunks')) {
          const cs = db.createObjectStore('chunks', { keyPath: 'id' });
          cs.createIndex('courseId',     'courseId',     { unique: false });
          cs.createIndex('nextReviewAt', 'nextReviewAt', { unique: false });
          cs.createIndex('reviewLevel',  'reviewLevel',  { unique: false });
        }
        // reviews (history)
        if (!db.objectStoreNames.contains('reviews')) {
          const rs = db.createObjectStore('reviews', { keyPath: 'id' });
          rs.createIndex('chunkId',    'chunkId',    { unique: false });
          rs.createIndex('reviewedAt', 'reviewedAt', { unique: false });
        }
        // settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        // activity log (for heatmap)
        if (!db.objectStoreNames.contains('activity')) {
          const as = db.createObjectStore('activity', { keyPath: 'id' });
          as.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess  = (e) => { _db = e.target.result; res(_db); };
      req.onerror    = (e) => rej(e.target.error);
    });
  }

  function p(req) {
    return new Promise((res, rej) => {
      req.onsuccess = (e) => res(e.target.result);
      req.onerror   = (e) => rej(e.target.error);
    });
  }

  function cursor(req) {
    return new Promise((res, rej) => {
      const items = [];
      req.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { items.push(c.value); c.continue(); }
        else res(items);
      };
      req.onerror = (e) => rej(e.target.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return _db.transaction(store, mode).objectStore(store);
  }

  // ── COURSES ──
  const Courses = {
    save:   (c)  => open().then(() => p(tx('courses','readwrite').put(c))),
    get:    (id) => open().then(() => p(tx('courses').get(id))),
    getAll: ()   => open().then(() => cursor(tx('courses').openCursor())),
    delete: async (id) => {
      await open();
      const t = _db.transaction(['courses','chunks'], 'readwrite');
      t.objectStore('courses').delete(id);
      return new Promise((res, rej) => {
        t.objectStore('chunks').index('courseId').openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
          const c = e.target.result;
          if (c) { c.delete(); c.continue(); } else res();
        };
        t.onerror = (e) => rej(e.target.error);
      });
    },
  };

  // ── CHUNKS ──
  const Chunks = {
    save:      (c)   => open().then(() => p(tx('chunks','readwrite').put(c))),
    get:       (id)  => open().then(() => p(tx('chunks').get(id))),
    getAll:    ()    => open().then(() => cursor(tx('chunks').openCursor())),
    byCourse:  (cid) => open().then(() => cursor(tx('chunks').index('courseId').openCursor(IDBKeyRange.only(cid)))),
    delete:    (id)  => open().then(() => p(tx('chunks','readwrite').delete(id))),
    getDue: async (limit = 20) => {
      await open();
      const all = await cursor(tx('chunks').openCursor());
      const now = Date.now();
      return all
        .filter(c => !c.nextReviewAt || c.nextReviewAt <= now)
        .slice(0, limit);
    },
  };

  // ── REVIEWS ──
  const Reviews = {
    save:   (r)    => open().then(() => p(tx('reviews','readwrite').put(r))),
    recent: async (days = 60) => {
      await open();
      const since = Date.now() - days * 86400000;
      return cursor(tx('reviews').index('reviewedAt').openCursor(IDBKeyRange.lowerBound(since)));
    },
  };

  // ── SETTINGS ──
  const Settings = {
    get: async (key, def = null) => {
      await open();
      const r = await p(tx('settings').get(key));
      return r ? r.value : def;
    },
    set: (key, value) => open().then(() => p(tx('settings','readwrite').put({ key, value }))),
  };

  // ── ACTIVITY ──
  const Activity = {
    log: async (count = 1) => {
      await open();
      const date = new Date().toISOString().slice(0, 10);
      const existing = await cursor(
        tx('activity').index('date').openCursor(IDBKeyRange.only(date))
      );
      if (existing.length) {
        const rec = existing[0];
        rec.count = (rec.count || 0) + count;
        await p(tx('activity','readwrite').put(rec));
      } else {
        await p(tx('activity','readwrite').put({ id: crypto.randomUUID(), date, count }));
      }
    },
    recent: (days = 52 * 7) => open().then(() => cursor(tx('activity').openCursor())),
  };

  // ── CLEAR ALL ──
  async function clearAll() {
    await open();
    const stores = ['courses','chunks','reviews','settings','activity'];
    const t = _db.transaction(stores, 'readwrite');
    stores.forEach(s => t.objectStore(s).clear());
    return new Promise(res => { t.oncomplete = res; });
  }

  // ── EXPORT ──
  async function exportJSON() {
    const [courses, chunks, reviews] = await Promise.all([
      Courses.getAll(), Chunks.getAll(), Reviews.recent(3650),
    ]);
    return JSON.stringify({ courses, chunks, reviews, exportedAt: new Date().toISOString() }, null, 2);
  }

  return { Courses, Chunks, Reviews, Settings, Activity, clearAll, exportJSON, open };
})();

/**
 * core/store.js — Reactive global state
 */
const Store = (() => {
  const state = {
    currentCourse: null,
    apiKey: null,
    settings: {
      speed: 1,
      skipSec: 15,
      reviewLimit: 20,
    },
  };
  const listeners = {};

  function get(key) { return state[key]; }

  function set(key, value) {
    state[key] = value;
    (listeners[key] || []).forEach(fn => fn(value));
  }

  function on(key, fn) {
    if (!listeners[key]) listeners[key] = [];
    listeners[key].push(fn);
    return () => { listeners[key] = listeners[key].filter(f => f !== fn); };
  }

  async function loadSettings() {
    const [speed, skipSec, reviewLimit, apiKey] = await Promise.all([
      DB.Settings.get('speed', 1),
      DB.Settings.get('skipSec', 15),
      DB.Settings.get('reviewLimit', 20),
      DB.Settings.get('apiKey', null),
    ]);
    set('settings', { speed: parseFloat(speed), skipSec: parseInt(skipSec), reviewLimit: parseInt(reviewLimit) });
    set('apiKey', apiKey);
  }

  return { get, set, on, loadSettings };
})();

/**
 * parsers/srt.js — SRT / VTT / plain text parser
 */
const SRTParser = (() => {
  function ts2s(t) {
    const s = t.replace(',', '.').split(':');
    if (s.length === 3) return +s[0] * 3600 + +s[1] * 60 + parseFloat(s[2]);
    if (s.length === 2) return +s[0] * 60 + parseFloat(s[1]);
    return parseFloat(s[0]);
  }

  function parseSRT(text) {
    const lines = [];
    const blocks = text.trim().split(/\n\s*\n/);
    blocks.forEach((block, idx) => {
      const rows = block.trim().split('\n');
      let i = /^\d+$/.test(rows[0]?.trim()) ? 1 : 0;
      const m = rows[i]?.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/);
      if (!m) return;
      const text = rows.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (text) lines.push({ id: idx, start: ts2s(m[1]), end: ts2s(m[2]), text });
    });
    return lines;
  }

  function parseVTT(text) {
    return parseSRT(text.replace(/^WEBVTT[^\n]*\n/, ''));
  }

  function parsePlain(text) {
    return text.trim().split('\n')
      .filter(l => l.trim())
      .map((line, i) => ({ id: i, start: i * 6, end: (i + 1) * 6, text: line.trim() }));
  }

  async function parseFile(file) {
    const text = await file.text();
    const name = file.name.toLowerCase();
    if (name.endsWith('.vtt')) return parseVTT(text);
    if (name.endsWith('.srt')) return parseSRT(text);
    return parsePlain(text);
  }

  function findActive(lines, time) {
    if (!lines?.length) return -1;
    for (let i = 0; i < lines.length; i++) {
      if (time >= lines[i].start && time <= lines[i].end) return i;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].start <= time) return i;
    }
    return 0;
  }

  function fmt(s) {
    const sec = Math.floor(s);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const ss = String(sec % 60).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  return { parseSRT, parseVTT, parsePlain, parseFile, findActive, fmt };
})();

/**
 * parsers/audio-utils.js — Audio file utilities
 */
const AudioUtils = (() => {
  function getDuration(blob) {
    return new Promise((res) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      a.src = url;
      a.addEventListener('loadedmetadata', () => {
        res(a.duration);
        URL.revokeObjectURL(url);
      });
      a.addEventListener('error', () => { res(0); URL.revokeObjectURL(url); });
    });
  }

  function fmtSize(bytes) {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // Generate fake-ish waveform bars for display (no Web Audio needed for import)
  function mockWaveform(canvas, color = '#e8c96b') {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const bars = Math.floor(w / 3);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < bars; i++) {
      const barH = (Math.random() * 0.7 + 0.1) * h;
      const x = i * 3;
      const y = (h - barH) / 2;
      ctx.fillRect(x, y, 2, barH);
    }
  }

  // Draw waveform from audio blob using Web Audio API
  async function drawWaveform(canvas, blob, color = '#e8c96b', bgColor = 'transparent') {
    try {
      const ac = new AudioContext();
      const buf = await blob.arrayBuffer();
      const decoded = await ac.decodeAudioData(buf);
      const data = decoded.getChannelData(0);
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const step = Math.ceil(data.length / W);
      ctx.fillStyle = color;
      for (let i = 0; i < W; i++) {
        let min = 1, max = -1;
        for (let j = 0; j < step; j++) {
          const v = data[i * step + j] || 0;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const top    = ((1 - max) / 2) * H;
        const bottom = ((1 - min) / 2) * H;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(i, top, 1, Math.max(1, bottom - top));
      }
      ac.close();
    } catch {
      mockWaveform(canvas, color);
    }
  }

  return { getDuration, fmtSize, mockWaveform, drawWaveform };
})();

/**
 * features/spaced.js — SM-2 spaced repetition algorithm
 * Quality: 0=fail, 1=hard(partial), 2=pass
 */
const Spaced = (() => {
  // Intervals in milliseconds for each level 0-5
  const INTERVALS = [
    0,             // 0: unreviewed
    86400000,      // 1: 1 day
    259200000,     // 2: 3 days
    604800000,     // 3: 7 days
    1209600000,    // 4: 14 days
    2592000000,    // 5: 30 days
  ];

  const MAX_LEVEL = 5;

  /**
   * Update chunk based on review result
   * @param {object} chunk
   * @param {number} quality — 0 (fail), 1 (hard), 2 (pass)
   * @returns {object} updated chunk
   */
  function update(chunk, quality) {
    let level = chunk.reviewLevel ?? 0;

    if (quality === 0) {
      // Failed: drop to max(0, level-1) but at least reset interval
      level = Math.max(0, level - 1);
    } else if (quality === 1) {
      // Hard: stay at same level
    } else {
      // Pass: advance
      level = Math.min(MAX_LEVEL, level + 1);
    }

    const interval = INTERVALS[level];
    return {
      ...chunk,
      reviewLevel: level,
      nextReviewAt: interval === 0 ? null : Date.now() + interval,
      lastReviewedAt: Date.now(),
    };
  }

  function isDue(chunk) {
    if (!chunk.nextReviewAt) return true;
    return chunk.nextReviewAt <= Date.now();
  }

  function nextReviewLabel(chunk) {
    if (!chunk.nextReviewAt) return '未複習';
    const diff = chunk.nextReviewAt - Date.now();
    if (diff <= 0) return '待回顧';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor(diff / 3600000);
    if (d >= 1) return `${d} 天後`;
    if (h >= 1) return `${h} 小時後`;
    return '即將到期';
  }

  const LEVEL_COLORS = ['#4a5a8c', '#f07070', '#f0a060', '#f0c060', '#4cc9b0', '#4ec994'];
  const LEVEL_LABELS = ['未學', '困難', '熟悉中', '普通', '良好', '精通'];

  function levelColor(level) { return LEVEL_COLORS[level ?? 0]; }
  function levelLabel(level) { return LEVEL_LABELS[level ?? 0]; }

  return { update, isDue, nextReviewLabel, levelColor, levelLabel, INTERVALS };
})();

/**
 * features/chunk.js — Knowledge chunk capture logic
 * Handles the "clip + annotate" workflow during playback.
 */
const ChunkFeature = (() => {
  let startTime = null;
  let courseRef = null;
  let onSaveCallback = null;

  // DOM refs (resolved lazily)
  const el = () => ({
    bar:         document.getElementById('chunkBar'),
    startTs:     document.getElementById('chunkStartTs'),
    endTs:       document.getElementById('chunkEndTs'),
    rangeFill:   document.getElementById('chunkRangeFill'),
    confirmBtn:  document.getElementById('chunkConfirmBtn'),
    noteField:   document.getElementById('chunkNoteField'),
    tagField:    document.getElementById('chunkTagField'),
    saveBtn:     document.getElementById('chunkSaveBtn'),
    cancelBtn:   document.getElementById('chunkCancelBtn'),
    captureBtn:  document.getElementById('captureBtn'),
  });

  let endTime = null;
  let confirmed = false;
  let chunkTags = [];
  let audioDuration = 0;

  function init(course, onSave) {
    courseRef = course;
    onSaveCallback = onSave;
    startTime = null;
    endTime = null;
    confirmed = false;
    chunkTags = [];

    const e = el();
    e.bar.style.display = 'none';
    e.captureBtn.classList.remove('active');

    e.captureBtn.onclick = () => toggle();
    e.confirmBtn.onclick = () => setEnd();
    e.saveBtn.onclick    = () => save();
    e.cancelBtn.onclick  = () => cancel();

    // Tag input
    e.tagField.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && e.tagField.value.trim()) {
        addTag(e.tagField.value.trim());
        e.tagField.value = '';
      }
    });
  }

  function setDuration(dur) { audioDuration = dur; }

  function toggle() {
    if (startTime === null) {
      begin();
    } else if (!confirmed) {
      setEnd();
    }
  }

  function begin() {
    // Get current time from player audio
    const audio = document.getElementById('playerAudio');
    startTime = audio.currentTime;
    endTime = null;
    confirmed = false;
    chunkTags = courseRef?.tags ? [...courseRef.tags] : [];

    const e = el();
    e.bar.style.display = 'block';
    e.captureBtn.classList.add('active');
    e.startTs.textContent = SRTParser.fmt(startTime);
    e.endTs.textContent   = SRTParser.fmt(startTime);
    e.confirmBtn.textContent = '設定終點';
    e.confirmBtn.style.display = '';
    e.noteField.value = '';
    updateFill(startTime, startTime);

    Toast.info('📍 起始點已設定，繼續播放後按「設定終點」');
  }

  function setEnd() {
    const audio = document.getElementById('playerAudio');
    const cur = audio.currentTime;
    if (cur <= startTime) { Toast.warn('終點必須晚於起始點'); return; }
    endTime = cur;
    confirmed = true;
    const e = el();
    e.endTs.textContent = SRTParser.fmt(endTime);
    e.confirmBtn.style.display = 'none';
    updateFill(startTime, endTime);
  }

  // Live update while not confirmed
  function tick(currentTime) {
    if (startTime === null || confirmed) return;
    const e = el();
    e.endTs.textContent = SRTParser.fmt(currentTime);
    updateFill(startTime, currentTime);
  }

  function updateFill(start, end) {
    if (!audioDuration) return;
    const pct = Math.min(100, ((end - start) / audioDuration) * 100);
    el().rangeFill.style.width = pct + '%';
  }

  function addTag(tag) {
    if (chunkTags.includes(tag)) return;
    chunkTags.push(tag);
  }

  async function save() {
    if (!confirmed || endTime === null || !courseRef) {
      Toast.warn('請先設定截取區間');
      return;
    }

    // Extract transcript text from the time range
    const transcript = courseRef.transcript || [];
    const chunkText = transcript
      .filter(l => l.start >= startTime - 0.5 && l.end <= endTime + 0.5)
      .map(l => l.text)
      .join(' ')
      .trim() || '（無字幕文字）';

    const chunk = {
      id:            crypto.randomUUID(),
      courseId:      courseRef.id,
      courseTitle:   courseRef.title,
      startTime,
      endTime,
      transcript:    chunkText,
      note:          el().noteField.value.trim(),
      tags:          [...chunkTags, ...(el().tagField.value.trim() ? [el().tagField.value.trim()] : [])],
      reviewLevel:   0,
      nextReviewAt:  null,
      lastReviewedAt: null,
      createdAt:     Date.now(),
    };

    await DB.Chunks.save(chunk);
    cancel();
    Toast.success('✓ 碎片已儲存到知識庫');
    if (onSaveCallback) onSaveCallback(chunk);
  }

  function cancel() {
    startTime = null;
    endTime = null;
    confirmed = false;
    chunkTags = [];
    const e = el();
    e.bar.style.display = 'none';
    e.captureBtn.classList.remove('active');
    e.noteField.value = '';
    e.tagField.value  = '';
  }

  function isCapturing() { return startTime !== null; }

  return { init, tick, setDuration, isCapturing, cancel };
})();

/**
 * features/ai.js — Claude API integration for course analysis
 */
const AIFeature = (() => {
  const PANEL_BODY = () => document.getElementById('aiPanelBody');

  function showLoading() {
    PANEL_BODY().innerHTML = `
      <div class="ai-loading-state">
        <div class="ai-spinner"></div>
        <p class="ai-loading-label">AI 正在深度分析中…</p>
      </div>`;
  }

  function showSetup(msg = '') {
    PANEL_BODY().innerHTML = `
      <div class="ai-setup-state">
        <p class="ai-setup-title">啟用 AI 分析</p>
        <p class="ai-setup-sub">
          輸入 Claude API Key 以自動生成：重點整理、名詞解釋、問答題、重點句子。<br>
          ${msg ? `<span style="color:var(--rose)">${msg}</span>` : ''}
        </p>
        <input type="password" class="ai-key-input" id="aiKeyInput" placeholder="sk-ant-api03-…" autocomplete="off">
        <button class="primary-cta" id="aiKeySubmit">儲存並分析</button>
      </div>`;

    document.getElementById('aiKeySubmit').addEventListener('click', async () => {
      const key = document.getElementById('aiKeyInput').value.trim();
      if (!key.startsWith('sk-ant-')) { Toast.warn('API Key 格式不正確'); return; }
      await DB.Settings.set('apiKey', key);
      Store.set('apiKey', key);
      Toast.success('API Key 已儲存');
      const course = Store.get('currentCourse');
      if (course) await loadForCourse(course);
    });

    // Pre-fill if exists
    const existing = Store.get('apiKey');
    if (existing) document.getElementById('aiKeyInput').value = existing;
  }

  async function loadForCourse(course) {
    if (!course) return;

    // Already have summary
    if (course.aiSummary) {
      renderSummary(course.aiSummary);
      return;
    }

    const apiKey = Store.get('apiKey') || await DB.Settings.get('apiKey');
    if (!apiKey) { showSetup(); return; }

    showLoading();

    try {
      const summary = await callClaude(course, apiKey);
      course.aiSummary = summary;
      await DB.Courses.save(course);
      Store.set('currentCourse', course);
      renderSummary(summary);
    } catch (err) {
      showSetup('分析失敗：' + (err.message || '請檢查 API Key'));
    }
  }

  async function callClaude(course, apiKey) {
    const text = (course.transcript || []).map(l => l.text).join('\n').slice(0, 7000);
    if (!text.trim()) {
      return { keyPoints: ['（無字幕，無法分析）'], glossary: [], qa: [], highlights: [] };
    }

    const prompt = `請針對以下課程內容進行深度分析整理。課程：${course.title}

逐字稿：
${text}

請以 JSON 格式回覆，格式如下，只回覆 JSON 不含其他文字：
{
  "keyPoints": ["重點1（完整一句話）", ...至少5項],
  "glossary": [{"term":"名詞","def":"簡明定義"},...至少3項],
  "qa": [{"q":"問題？","a":"完整答案"},...至少3項],
  "highlights": ["值得反覆閱讀的句子",...至少3項]
}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const raw = data.content?.[0]?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  }

  function renderSummary(s) {
    const body = PANEL_BODY();
    body.innerHTML = '';

    // Key points
    body.appendChild(section('📌 重點整理', s.keyPoints?.length || 0, `
      ${(s.keyPoints || []).map((p, i) => `
        <div class="ai-key-point">
          <span class="ai-kp-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="ai-kp-text">${p}</span>
        </div>
      `).join('')}
    `));

    // Glossary
    body.appendChild(section('📖 名詞解釋', s.glossary?.length || 0, `
      ${(s.glossary || []).map(g => `
        <div class="ai-glossary-item">
          <p class="ai-gl-term">${g.term}</p>
          <p class="ai-gl-def">${g.def}</p>
        </div>
      `).join('')}
    `));

    // Q&A
    const qaHtml = (s.qa || []).map((item, i) => `
      <div class="ai-qa-item" data-i="${i}">
        <p class="ai-qa-q">${item.q}</p>
        <div class="ai-qa-a">${item.a}</div>
        <p class="ai-qa-toggle">▾ 查看答案</p>
      </div>
    `).join('');
    const qaSection = section('❓ 問答', s.qa?.length || 0, qaHtml);
    body.appendChild(qaSection);

    // Q&A toggle
    qaSection.querySelectorAll('.ai-qa-item').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('open');
        el.querySelector('.ai-qa-toggle').textContent = el.classList.contains('open') ? '▴ 收起' : '▾ 查看答案';
      });
    });

    // Highlights
    body.appendChild(section('💡 重點句', s.highlights?.length || 0, `
      ${(s.highlights || []).map(h => `<div class="ai-highlight">${h}</div>`).join('')}
    `));
  }

  function section(title, count, inner) {
    const div = document.createElement('div');
    div.className = 'ai-section';
    div.innerHTML = `
      <div class="ai-section-head">
        <span class="ai-section-title">${title}</span>
        <span class="ai-section-count">${count}</span>
      </div>
      ${inner}
    `;
    return div;
  }

  return { loadForCourse, showSetup };
})();

/**
 * ui/waveform.js — Playback waveform + progress UI
 * Handles canvas drawing, seek interaction, live progress.
 */
const WaveformUI = (() => {
  let peaks = [];       // normalized [-1, 1] array
  let progress = 0;     // 0-1
  let duration = 0;
  let dragging = false;
  let seekCallback = null;
  let canvas, ctx, overlay;

  const PLAYED_COLOR  = '#e8c96b';
  const UNPLAYED_COLOR = '#263054';
  const BAR_WIDTH = 2;
  const BAR_GAP   = 1;

  function init(audio) {
    canvas  = document.getElementById('waveformCanvas');
    overlay = document.getElementById('progressOverlay');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    _initEvents(audio);
  }

  function _initEvents(audio) {
    canvas.addEventListener('click',     (e) => _seek(e, audio));
    canvas.addEventListener('mousedown', (e) => { dragging = true; _seek(e, audio); });
    canvas.addEventListener('touchstart', (e) => { dragging = true; _seek(e, audio); }, { passive: true });
    document.addEventListener('mousemove', (e) => { if (dragging) _seek(e, audio); });
    document.addEventListener('touchmove', (e) => { if (dragging) _seek(e, audio); }, { passive: true });
    document.addEventListener('mouseup',  () => { dragging = false; });
    document.addEventListener('touchend', () => { dragging = false; });
  }

  function _seek(e, audio) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    if (audio.duration) {
      audio.currentTime = pct * audio.duration;
    }
    setProgress(pct);
  }

  async function loadAudio(blob) {
    peaks = [];
    duration = 0;
    try {
      const ac = new AudioContext();
      const buf = await blob.arrayBuffer();
      const decoded = await ac.decodeAudioData(buf);
      duration = decoded.duration;
      const data = decoded.getChannelData(0);
      const w = canvas?.width || 300;
      const numBars = Math.floor(w / (BAR_WIDTH + BAR_GAP));
      const step = Math.ceil(data.length / numBars);
      peaks = [];
      for (let i = 0; i < numBars; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) {
          const v = Math.abs(data[i * step + j] || 0);
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      // normalize
      const mx = Math.max(...peaks, 0.01);
      peaks = peaks.map(p => p / mx);
      ac.close();
    } catch {
      // Generate visual fallback
      const numBars = 120;
      peaks = Array.from({ length: numBars }, () => Math.random() * 0.8 + 0.1);
    }
    draw();
  }

  function setProgress(pct) {
    progress = Math.max(0, Math.min(1, pct));
    draw();
    if (overlay) overlay.style.width = (progress * 100) + '%';
  }

  function draw() {
    if (!canvas || !ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!peaks.length) {
      // Empty state bar
      ctx.fillStyle = UNPLAYED_COLOR;
      ctx.fillRect(0, H / 2 - 1, W, 2);
      return;
    }

    const playedX = progress * W;
    const barCount = peaks.length;

    for (let i = 0; i < barCount; i++) {
      const x = (i / barCount) * W;
      const barH = Math.max(2, peaks[i] * H * 0.85);
      const y = (H - barH) / 2;
      ctx.fillStyle = x <= playedX ? PLAYED_COLOR : UNPLAYED_COLOR;
      ctx.globalAlpha = x <= playedX ? 0.9 : 0.5;
      ctx.fillRect(x, y, BAR_WIDTH, barH);
    }
    ctx.globalAlpha = 1;
  }

  function resize() {
    if (!canvas) return;
    canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    canvas.height = 40 * (window.devicePixelRatio || 1);
    canvas.style.width  = canvas.offsetWidth + 'px';
    canvas.style.height = '40px';
    draw();
  }

  return { init, loadAudio, setProgress, draw, resize };
})();

/**
 * pages/home.js — Home page controller
 */
const HomePage = (() => {
  const EMOJIS = ['🎧','📘','⚖️','🔬','🌏','🎓','💡','📐','🏛','🗂','🎵','🧬','🔭','⚙️','🧠'];

  async function render() {
    _setGreeting();
    _setDate();
    await Promise.all([_renderStats(), _renderCourses()]);
  }

  function _setGreeting() {
    const h = new Date().getHours();
    const label = h < 6 ? '深夜' : h < 12 ? '早安' : h < 18 ? '午安' : '晚安';
    const el = document.getElementById('greetingLabel');
    if (el) el.textContent = label;
  }

  function _setDate() {}

  async function _renderStats() {
    const [chunks, dueChunks, reviewLimit] = await Promise.all([
      DB.Chunks.getAll(),
      DB.Chunks.getDue(999),
      DB.Settings.get('reviewLimit', 20),
    ]);

    const due = dueChunks.length;
    const streak = await DB.Settings.get('streak', 0);
    const todayDone = await DB.Settings.get('todayDone_' + _today(), 0);

    _setNum('statToday',  todayDone);
    _setNum('statStreak', streak);
    _setNum('statDue',    due);

    // Progress fill
    const done = parseInt(todayDone);
    const total = Math.max(done, Math.min(due + done, parseInt(reviewLimit)));
    const pct = total ? Math.round((done / total) * 100) : 0;
    const fill = document.getElementById('todayProgressFill');
    const label = document.getElementById('todayProgressLabel');
    if (fill)  setTimeout(() => { fill.style.width = pct + '%'; }, 100);
    if (label) label.textContent = pct + '%';

    // CTA
    const cta = document.getElementById('todayReviewCta');
    const ctaCount = document.getElementById('ctaDueCount');
    if (cta) {
      cta.style.display = due > 0 ? '' : 'none';
      if (ctaCount) ctaCount.textContent = due;
    }
  }

  function _setNum(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = parseInt(el.textContent) || 0;
    const next = parseInt(val) || 0;
    if (prev !== next) {
      el.textContent = next;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 350);
    }
  }

  async function _renderCourses() {
    const courses = await DB.Courses.getAll();
    const list = document.getElementById('courseList');
    const empty = document.getElementById('emptyHome');
    if (!list) return;

    list.querySelectorAll('.course-card').forEach(c => c.remove());

    if (!courses.length) {
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    const chunks = await DB.Chunks.getAll();

    courses.slice().reverse().forEach((c, i) => {
      const card = _makeCourseCard(c, chunks, i);
      list.appendChild(card);
    });
  }

  function _makeCourseCard(course, allChunks, idx) {
    const card = document.createElement('div');
    card.className = 'course-card';

    const courseChunks = allChunks.filter(ch => ch.courseId === course.id);
    const masteredCount = courseChunks.filter(ch => ch.reviewLevel >= 4).length;
    const progressPct = courseChunks.length
      ? Math.round((masteredCount / courseChunks.length) * 100)
      : 0;

    const durText = course.audioDuration
      ? SRTParser.fmt(course.audioDuration)
      : '—';

    const lineCount = course.transcript?.length || 0;
    const emoji = EMOJIS[idx % EMOJIS.length];

    card.innerHTML = `
      <div class="cc-thumb">${emoji}</div>
      <div class="cc-body">
        <p class="cc-title">${course.title}</p>
        <div class="cc-meta">
          <span>${durText}</span>
          ${lineCount ? `<span class="cc-meta-sep">·</span><span>${lineCount} 句</span>` : ''}
          ${courseChunks.length ? `<span class="cc-meta-sep">·</span><span>${courseChunks.length} 碎片</span>` : ''}
        </div>
        ${course.tags?.length ? `
          <div class="cc-tags">
            ${course.tags.map(t => `<span class="tag-pill">${t}</span>`).join('')}
          </div>` : ''}
      </div>
      <div class="cc-progress">
        <div class="cc-progress-ring">
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="11" fill="none" stroke="var(--ink-700)" stroke-width="3"/>
            <circle cx="14" cy="14" r="11" fill="none" stroke="var(--amber)" stroke-width="3"
              stroke-dasharray="${Math.PI * 22}"
              stroke-dashoffset="${Math.PI * 22 * (1 - progressPct / 100)}"
              transform="rotate(-90 14 14)"
              stroke-linecap="round"/>
          </svg>
          <div class="cc-progress-pct">${progressPct}%</div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openCourse(course.id));

    // Long press → delete
    let pressTimer;
    card.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => _deleteCourse(course.id, course.title), 700);
    }, { passive: true });
    card.addEventListener('touchend',   () => clearTimeout(pressTimer));
    card.addEventListener('touchmove',  () => clearTimeout(pressTimer));

    return card;
  }

  async function openCourse(id) {
    const course = await DB.Courses.get(id);
    if (!course) { Toast.error('課程不存在'); return; }
    Store.set('currentCourse', course);
    PlayerPage.load(course);
    Router.go('player');
  }

  async function _deleteCourse(id, title) {
    const ok = await Modal.confirm('刪除課程', `確定要刪除「${title}」？相關碎片也會一併刪除，無法復原。`, '刪除');
    if (!ok) return;
    await DB.Courses.delete(id);
    Toast.success('課程已刪除');
    render();
  }

  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  return { render, openCourse };
})();

/**
 * pages/import.js — Course import page
 */
const ImportPage = (() => {
  let data = {
    audioBlob:    null,
    audioDuration: 0,
    transcript:   [],
    pages:        [],
    tags:         [],
  };

  let transcriptMode = 'upload';

  function init() {
    _initAudioZone();
    _initSrtZone();
    _initPagesZone();
    _initTranscriptMode();
    _initTagInput();
    _initImportBtn();
    Router.onEnter('import', reset);
  }

  function reset() {
    data = { audioBlob: null, audioDuration: 0, transcript: [], pages: [], tags: [] };
    transcriptMode = 'upload';

    // Reset UI
    document.getElementById('audioZone').style.display = '';
    document.getElementById('audioPicked').style.display = 'none';
    document.getElementById('srtLoaded').style.display = 'none';
    document.getElementById('transcriptUploadArea').style.display = '';
    document.getElementById('transcriptManualArea').style.display = 'none';
    document.getElementById('pagesThumbs').innerHTML = '';
    document.getElementById('iTitle').value = '';
    document.getElementById('iDesc').value = '';
    document.getElementById('iTagsRow').innerHTML = '';
    document.getElementById('iTagInput').value = '';
    document.getElementById('manualTA').value = '';
    document.getElementById('audioInput').value = '';
    document.getElementById('srtInput').value = '';
    document.getElementById('pagesInput').value = '';
    document.querySelectorAll('.mode-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    _checkReady();
  }

  function _initAudioZone() {
    const zone  = document.getElementById('audioZone');
    const input = document.getElementById('audioInput');
    const rem   = document.getElementById('apRemove');

    zone.addEventListener('click', () => input.click());
    _dropZone(zone, input, _handleAudio);
    rem.addEventListener('click', () => {
      data.audioBlob = null;
      zone.style.display = '';
      document.getElementById('audioPicked').style.display = 'none';
      _checkReady();
    });
  }

  async function _handleAudio(file) {
    data.audioBlob = file;
    data.audioDuration = await AudioUtils.getDuration(file);

    document.getElementById('audioZone').style.display = 'none';
    const picked = document.getElementById('audioPicked');
    picked.style.display = 'flex';
    document.getElementById('apName').textContent = file.name;
    document.getElementById('apMeta').textContent =
      `${SRTParser.fmt(data.audioDuration)} · ${AudioUtils.fmtSize(file.size)}`;

    // Auto-fill title
    const titleEl = document.getElementById('iTitle');
    if (!titleEl.value) {
      titleEl.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    }

    // Draw mini waveform
    AudioUtils.mockWaveform(document.getElementById('apWaveCanvas'), '#e8c96b');

    _checkReady();
  }

  function _initSrtZone() {
    const zone  = document.getElementById('srtZone');
    const input = document.getElementById('srtInput');
    zone.addEventListener('click', () => input.click());
    _dropZone(zone, input, _handleSrt);
  }

  async function _handleSrt(file) {
    try {
      data.transcript = await SRTParser.parseFile(file);
      document.getElementById('srtLoaded').style.display = 'flex';
      document.getElementById('srtInfo').textContent = `已載入 ${data.transcript.length} 行字幕`;
      Toast.success(`✓ 字幕載入成功（${data.transcript.length} 行）`);
    } catch (e) {
      Toast.error('字幕解析失敗：' + e.message);
    }
  }

  function _initPagesZone() {
    const zone  = document.getElementById('pagesZone');
    const input = document.getElementById('pagesInput');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      _handlePages(e.dataTransfer.files);
    });
    input.addEventListener('change', () => _handlePages(input.files));
  }

  function _handlePages(files) {
    const sorted = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));
    data.pages = sorted.map((f, i) => ({
      id: i, time: 0,
      imageBlob: f,
      imageUrl: URL.createObjectURL(f),
    }));
    _renderPageThumbs();
    Toast.info(`已載入 ${sorted.length} 張投影片`);
  }

  function _renderPageThumbs() {
    const container = document.getElementById('pagesThumbs');
    container.innerHTML = data.pages.map((p, i) => `
      <div class="page-thumb-wrap" data-idx="${i}">
        <img class="page-thumb-img" src="${p.imageUrl}" alt="頁 ${i+1}">
        <button class="page-thumb-del" data-idx="${i}">✕</button>
      </div>
    `).join('');
    container.querySelectorAll('.page-thumb-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        data.pages.splice(idx, 1);
        _renderPageThumbs();
      });
    });
  }

  function _initTranscriptMode() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        transcriptMode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('transcriptUploadArea').style.display =
          transcriptMode === 'upload' ? '' : 'none';
        document.getElementById('transcriptManualArea').style.display =
          transcriptMode === 'manual' ? '' : 'none';
      });
    });
  }

  function _initTagInput() {
    const input = document.getElementById('iTagInput');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v && !data.tags.includes(v)) {
          data.tags.push(v);
          _renderTags();
        }
        input.value = '';
      }
    });
  }

  function _renderTags() {
    const row = document.getElementById('iTagsRow');
    row.innerHTML = data.tags.map((t, i) => `
      <span class="tag-pill amber">
        ${t}
        <span class="tag-pill-remove" data-idx="${i}">✕</span>
      </span>
    `).join('');
    row.querySelectorAll('.tag-pill-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        data.tags.splice(parseInt(btn.dataset.idx), 1);
        _renderTags();
      });
    });
  }

  function _checkReady() {
    document.getElementById('importBtn').disabled = !data.audioBlob;
  }

  function _initImportBtn() {
    document.getElementById('importBtn').addEventListener('click', _doImport);
  }

  async function _doImport() {
    if (!data.audioBlob) return;

    const title = document.getElementById('iTitle').value.trim() || '未命名課程';
    const desc  = document.getElementById('iDesc').value.trim();

    // Manual transcript
    if (transcriptMode === 'manual') {
      const txt = document.getElementById('manualTA').value.trim();
      if (txt) data.transcript = SRTParser.parsePlain(txt);
    }

    const btn = document.getElementById('importBtn');
    btn.disabled = true;
    btn.textContent = '儲存中…';

    try {
      const course = {
        id:            crypto.randomUUID(),
        title,
        description:   desc,
        audioBlob:     data.audioBlob,
        audioDuration: data.audioDuration,
        transcript:    data.transcript,
        pages:         data.pages,
        tags:          [...data.tags],
        aiSummary:     null,
        createdAt:     Date.now(),
        updatedAt:     Date.now(),
      };

      await DB.Courses.save(course);
      Toast.success('✓ 課程建立成功！');
      reset();
      Router.go('home');
      HomePage.render();
    } catch (e) {
      Toast.error('儲存失敗：' + e.message);
      btn.disabled = false;
      btn.textContent = '建立課程';
    }
  }

  function _dropZone(zone, input, handler) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) handler(input.files[0]); });
  }

  return { init, reset };
})();

/**
 * pages/player.js — Audio player page controller
 */
const PlayerPage = (() => {
  const audio = () => document.getElementById('playerAudio');

  let course = null;
  let transcript = [];
  let pages = [];
  let slideIdx = 0;
  let activeLine = -1;
  let speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  let speedIdx = 2;
  let audioUrl = null;

  // ── LOAD ──
  async function load(c) {
    course     = c;
    transcript = c.transcript || [];
    pages      = c.pages      || [];
    slideIdx   = 0;
    activeLine = -1;

    const settings = Store.get('settings') || {};
    speedIdx = speeds.indexOf(parseFloat(settings.speed || 1));
    if (speedIdx < 0) speedIdx = 2;

    // Set audio source
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (c.audioBlob) {
      audioUrl = URL.createObjectURL(c.audioBlob);
      audio().src = audioUrl;
      audio().load();
      audio().playbackRate = speeds[speedIdx];
    }

    // UI
    document.getElementById('playerCourseName').textContent = c.title;
    document.getElementById('playerPosition').textContent = '—';
    document.getElementById('speedBtn').textContent = speeds[speedIdx] + '×';

    _renderTranscript();
    _renderSlides();
    _updateSpeedBtn();

    // Waveform
    if (c.audioBlob) WaveformUI.loadAudio(c.audioBlob);

    // Chunk feature
    const skipSec = parseInt(settings.skipSec || 15);
    document.getElementById('skipBackBtn').querySelector('.skip-label').textContent = skipSec;
    document.getElementById('skipFwdBtn').querySelector('.skip-label').textContent  = skipSec;
    ChunkFeature.init(course, () => {});
    ChunkFeature.setDuration(c.audioDuration || 0);
  }

  // ── TRANSCRIPT ──
  function _renderTranscript() {
    const container = document.getElementById('transcriptLines');
    if (!transcript.length) {
      container.innerHTML = `
        <div class="transcript-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="15" y2="18"/>
          </svg>
          <p>尚無字幕</p>
          <p class="ph-sub">匯入時可上傳 SRT / VTT 字幕檔</p>
        </div>`;
      return;
    }

    container.innerHTML = transcript.map((line, i) => `
      <div class="t-line" data-idx="${i}" data-start="${line.start}">
        <div class="t-time">${SRTParser.fmt(line.start)}</div>
        <div class="t-text">${line.text}</div>
      </div>
    `).join('');

    container.querySelectorAll('.t-line').forEach(el => {
      el.addEventListener('click', () => {
        const t = parseFloat(el.dataset.start);
        audio().currentTime = t;
        if (audio().paused) audio().play();
      });
    });
  }

  function _highlightLine(time) {
    const idx = SRTParser.findActive(transcript, time);
    if (idx === activeLine) return;
    activeLine = idx;

    const lines = document.querySelectorAll('.t-line');
    lines.forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('past',   i < idx);
    });

    // Auto-scroll active line into center view
    if (idx >= 0 && lines[idx]) {
      const scroller = document.getElementById('transcriptScroller');
      const el = lines[idx];
      const target = el.offsetTop - scroller.clientHeight / 2 + el.clientHeight / 2;
      scroller.scrollTo({ top: target, behavior: 'smooth' });
    }
  }

  // ── SLIDES ──
  function _renderSlides() {
    const img         = document.getElementById('slideImg');
    const placeholder = document.getElementById('slidePlaceholder');
    const indicator   = document.getElementById('slideIndicator');

    if (!pages.length) {
      img.style.display         = 'none';
      placeholder.style.display = '';
      indicator.textContent     = '— / —';
      return;
    }

    placeholder.style.display = 'none';
    img.style.display         = '';
    _showSlide(0);

    document.getElementById('prevSlide').addEventListener('click', () => {
      if (slideIdx > 0) _showSlide(slideIdx - 1);
    });
    document.getElementById('nextSlide').addEventListener('click', () => {
      if (slideIdx < pages.length - 1) _showSlide(slideIdx + 1);
    });
  }

  function _showSlide(idx) {
    slideIdx = idx;
    const p = pages[idx];
    document.getElementById('slideImg').src        = p.imageUrl || URL.createObjectURL(p.imageBlob);
    document.getElementById('slideIndicator').textContent = `${idx + 1} / ${pages.length}`;
  }

  function _syncSlideToTime(t) {
    if (!pages.length) return;
    let best = 0;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].time <= t) best = i;
    }
    if (best !== slideIdx) _showSlide(best);
  }

  // ── AUDIO EVENTS ──
  function _initAudioEvents() {
    const a = audio();

    a.addEventListener('timeupdate', () => {
      const t = a.currentTime;
      const d = a.duration || 0;
      _highlightLine(t);
      _syncSlideToTime(t);
      ChunkFeature.tick(t);

      const pct = d ? t / d : 0;
      WaveformUI.setProgress(pct);

      document.getElementById('timeNow').textContent   = SRTParser.fmt(t);
      document.getElementById('timeTotal').textContent  = SRTParser.fmt(d);
      document.getElementById('playerPosition').textContent =
        `${SRTParser.fmt(t)} / ${SRTParser.fmt(d)}`;
    });

    a.addEventListener('play', () => {
      document.querySelector('.icon-play').style.display  = 'none';
      document.querySelector('.icon-pause').style.display = '';
    });
    a.addEventListener('pause', () => {
      document.querySelector('.icon-play').style.display  = '';
      document.querySelector('.icon-pause').style.display = 'none';
    });
    a.addEventListener('loadedmetadata', () => {
      document.getElementById('timeTotal').textContent = SRTParser.fmt(a.duration);
      WaveformUI.resize();
    });
  }

  // ── CONTROLS ──
  function _initControls() {
    // Play/pause
    document.getElementById('playBtn').addEventListener('click', () => {
      const a = audio();
      if (a.paused) a.play(); else a.pause();
    });

    // Speed cycle
    document.getElementById('speedBtn').addEventListener('click', () => {
      speedIdx = (speedIdx + 1) % speeds.length;
      audio().playbackRate = speeds[speedIdx];
      _updateSpeedBtn();
      Toast.info(`播放速度：${speeds[speedIdx]}×`);
    });

    // Skip
    document.getElementById('skipBackBtn').addEventListener('click', () => {
      const sec = Store.get('settings')?.skipSec || 15;
      audio().currentTime = Math.max(0, audio().currentTime - sec);
    });
    document.getElementById('skipFwdBtn').addEventListener('click', () => {
      const sec = Store.get('settings')?.skipSec || 15;
      audio().currentTime = Math.min(audio().duration || 0, audio().currentTime + sec);
    });

    // View tabs
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const view = tab.dataset.view;
        document.getElementById('paneTranscript').classList.toggle('active', view === 'transcript');
        document.getElementById('panePages').classList.toggle('active',      view === 'pages');
      });
    });
  }

  // ── AI PANEL ──
  function _initAiPanel() {
    const panel  = document.getElementById('aiPanel');
    const scrim  = document.getElementById('aiScrim');
    const toggle = document.getElementById('aiToggleBtn');
    const close  = document.getElementById('aiCloseBtn');

    toggle.addEventListener('click', () => {
      panel.classList.add('open');
      scrim.classList.add('active');
      toggle.classList.add('active');
      AIFeature.loadForCourse(course);
    });

    const closePanel = () => {
      panel.classList.remove('open');
      scrim.classList.remove('active');
      toggle.classList.remove('active');
    };
    close.addEventListener('click', closePanel);
    scrim.addEventListener('click', closePanel);
  }

  function _updateSpeedBtn() {
    const btn = document.getElementById('speedBtn');
    btn.textContent = speeds[speedIdx] + '×';
    btn.classList.toggle('changed', speeds[speedIdx] !== 1);
  }

  function pause() {
    audio().pause();
  }

  function init() {
    WaveformUI.init(audio());
    _initAudioEvents();
    _initControls();
    _initAiPanel();

    Router.onEnter('player', () => {
      WaveformUI.resize();
    });

    window.addEventListener('resize', () => {
      if (Router.getCurrent() === 'player') WaveformUI.resize();
    });
  }

  return { init, load, pause };
})();

/**
 * pages/library.js — Knowledge chunk library
 */
const LibraryPage = (() => {
  let allChunks = [];
  let activeFilter = 'all';
  let sortMode = 'newest';
  let searchQuery = '';

  async function render() {
    allChunks = await DB.Chunks.getAll();
    _renderFilters();
    _renderChunks();
  }

  function _renderFilters() {
    const container = document.getElementById('libFilters');
    // keep "全部" btn, rebuild rest
    container.innerHTML = '<button class="lib-filter active" data-filter="all">全部</button>';

    const allTags = [...new Set(allChunks.flatMap(c => c.tags || []))];
    allTags.forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'lib-filter';
      btn.dataset.filter = tag;
      btn.textContent = tag;
      container.appendChild(btn);
    });

    container.querySelectorAll('.lib-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        container.querySelectorAll('.lib-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _renderChunks();
      });
    });
  }

  function _filtered() {
    let list = allChunks.slice();

    // Tag filter
    if (activeFilter !== 'all') {
      list = list.filter(c => c.tags?.includes(activeFilter));
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        c.transcript?.toLowerCase().includes(q) ||
        c.note?.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q)) ||
        c.courseTitle?.toLowerCase().includes(q)
      );
    }

    // Sort
    switch (sortMode) {
      case 'newest':  list.sort((a, b) => b.createdAt - a.createdAt);  break;
      case 'oldest':  list.sort((a, b) => a.createdAt - b.createdAt);  break;
      case 'level':   list.sort((a, b) => b.reviewLevel - a.reviewLevel); break;
      case 'due':     list.sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0)); break;
    }

    return list;
  }

  function _renderChunks() {
    const list = _filtered();
    const grid = document.getElementById('libGrid');
    const countEl = document.getElementById('libCount');
    if (countEl) countEl.textContent = `${list.length} 個碎片`;

    if (!list.length) {
      grid.innerHTML = `
        <div class="empty-well">
          <div class="empty-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <p class="empty-title">${searchQuery ? '找不到符合的碎片' : '碎片庫是空的'}</p>
          <p class="empty-sub">${searchQuery ? '嘗試其他關鍵字' : '在播放時按 ★ 截取知識片段'}</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.map(c => _chunkCardHTML(c)).join('');

    grid.querySelectorAll('.chunk-card').forEach(card => {
      const id = card.dataset.id;

      // Long press to delete
      let pressTimer;
      card.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => _deleteChunk(id), 700);
      }, { passive: true });
      card.addEventListener('touchend',  () => clearTimeout(pressTimer));
      card.addEventListener('touchmove', () => clearTimeout(pressTimer));

      // Click to play from course
      card.addEventListener('click', () => _playChunk(id));
    });
  }

  function _chunkCardHTML(c) {
    const level = c.reviewLevel ?? 0;
    const pipClass = `pip-${level}`;
    const nextLabel = Spaced.nextReviewLabel(c);
    const isDue = Spaced.isDue(c) && c.lastReviewedAt;

    return `
      <div class="chunk-card" data-id="${c.id}">
        <div class="ck-header">
          <span class="ck-source">${c.courseTitle || '未知課程'} · ${SRTParser.fmt(c.startTime)}–${SRTParser.fmt(c.endTime)}</span>
          <div class="ck-level-badge">
            <div class="level-pip ${pipClass}"></div>
            <span class="level-label">${Spaced.levelLabel(level)}</span>
          </div>
        </div>
        <p class="ck-text">${c.transcript}</p>
        ${c.note ? `<p class="ck-note">📝 ${c.note}</p>` : ''}
        <div class="ck-footer">
          <div class="ck-tags">
            ${(c.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('')}
          </div>
          <span class="ck-next-review ${isDue ? 'due' : ''}">${nextLabel}</span>
        </div>
      </div>
    `;
  }

  async function _playChunk(id) {
    const chunk = allChunks.find(c => c.id === id);
    if (!chunk) return;
    const course = await DB.Courses.get(chunk.courseId);
    if (!course) { Toast.error('找不到原始課程'); return; }
    Store.set('currentCourse', course);
    PlayerPage.load(course);
    Router.go('player');
    // Seek after a tick
    setTimeout(() => {
      const a = document.getElementById('playerAudio');
      a.currentTime = chunk.startTime;
    }, 400);
  }

  async function _deleteChunk(id) {
    const ok = await Modal.confirm('刪除碎片', '確定要刪除此知識碎片？', '刪除');
    if (!ok) return;
    await DB.Chunks.delete(id);
    allChunks = allChunks.filter(c => c.id !== id);
    _renderChunks();
    _renderFilters();
    Toast.success('碎片已刪除');
  }

  function init() {
    // Search toggle
    document.getElementById('libSearchToggle').addEventListener('click', () => {
      const bar = document.getElementById('libSearchBar');
      const visible = bar.style.display !== 'none';
      bar.style.display = visible ? 'none' : 'flex';
      if (!visible) document.getElementById('libSearchInput').focus();
    });

    // Search input
    document.getElementById('libSearchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      const clear = document.getElementById('libSearchClear');
      if (clear) clear.style.display = searchQuery ? '' : 'none';
      _renderChunks();
    });

    document.getElementById('libSearchClear')?.addEventListener('click', () => {
      document.getElementById('libSearchInput').value = '';
      searchQuery = '';
      document.getElementById('libSearchClear').style.display = 'none';
      _renderChunks();
    });

    // Sort
    document.getElementById('libSortSelect').addEventListener('change', (e) => {
      sortMode = e.target.value;
      _renderChunks();
    });

    Router.onEnter('library', render);
  }

  return { init, render };
})();

/**
 * pages/review.js — Spaced repetition review session
 */
const ReviewPage = (() => {
  let dueChunks = [];
  let current = 0;
  let sessionPass = 0;
  let sessionHard = 0;
  let sessionFail = 0;
  let todayDoneBase = 0;

  async function render() {
    const limit = Store.get('settings')?.reviewLimit || 20;
    dueChunks = await DB.Chunks.getDue(limit);
    await _renderDashboard();
  }

  async function _renderDashboard() {
    const all      = await DB.Chunks.getAll();
    const due      = dueChunks.length;
    const mastered = all.filter(c => (c.reviewLevel || 0) >= 4).length;
    const today    = new Date().toISOString().slice(0, 10);
    const todayDone = parseInt(await DB.Settings.get('todayDone_' + today, 0));
    const reviews  = await DB.Reviews.recent(30);

    // accuracy (last 30 days)
    const passCount = reviews.filter(r => r.result === 'pass').length;
    const acc = reviews.length ? Math.round((passCount / reviews.length) * 100) + '%' : '—';

    document.getElementById('rvDue').textContent      = due;
    document.getElementById('rvTotal').textContent    = all.length;
    document.getElementById('rvMastered').textContent = mastered;
    document.getElementById('rvTodayDone').textContent = todayDone;
    document.getElementById('rvAccuracy').textContent  = acc;

    // Ring: show % of today's quota done
    const limit = Store.get('settings')?.reviewLimit || 20;
    const pct   = limit ? Math.min(1, todayDone / limit) : 0;
    const circumference = 251.2;
    const offset = circumference - pct * circumference;
    document.getElementById('rvRingFg').style.strokeDashoffset = offset;

    // Heatmap (last 12 weeks × 7 = 84 days)
    _renderHeatmap(reviews);

    // Visibility
    document.getElementById('reviewDashboard').style.display = '';
    document.getElementById('quizShell').style.display = 'none';
    document.getElementById('reviewDone').style.display = 'none';
  }

  function _renderHeatmap(reviews) {
    const hm = document.getElementById('rvHeatmap');
    if (!hm) return;

    // Build a map date→count
    const map = {};
    reviews.forEach(r => {
      const d = new Date(r.reviewedAt).toISOString().slice(0, 10);
      map[d] = (map[d] || 0) + 1;
    });

    const days = 84;
    const today = new Date();
    hm.innerHTML = '';
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const cnt = map[key] || 0;
      const level = cnt === 0 ? 0 : cnt < 5 ? 1 : cnt < 10 ? 2 : cnt < 20 ? 3 : 4;
      const cell = document.createElement('div');
      cell.className = `hm-cell hm-${level}`;
      cell.title = `${key}: ${cnt} 個`;
      hm.appendChild(cell);
    }
  }

  function startSession() {
    if (!dueChunks.length) { Toast.info('目前沒有待回顧的碎片 🎉'); return; }
    current      = 0;
    sessionPass  = 0;
    sessionHard  = 0;
    sessionFail  = 0;
    const today  = new Date().toISOString().slice(0, 10);
    DB.Settings.get('todayDone_' + today, 0).then(v => { todayDoneBase = parseInt(v); });

    document.getElementById('reviewDashboard').style.display = 'none';
    document.getElementById('quizShell').style.display = '';
    document.getElementById('reviewDone').style.display = 'none';
    _showCard();
  }

  function _showCard() {
    if (current >= dueChunks.length) { _showDone(); return; }
    const chunk = dueChunks[current];

    // Progress
    const pct = (current / dueChunks.length) * 100;
    document.getElementById('quizProgFill').style.width = pct + '%';
    document.getElementById('quizCountLabel').textContent = `${current + 1} / ${dueChunks.length}`;

    // Content
    document.getElementById('quizSource').textContent =
      `${chunk.courseTitle || '課程'} · ${SRTParser.fmt(chunk.startTime)} – ${SRTParser.fmt(chunk.endTime)}`;
    document.getElementById('quizText').textContent  = chunk.transcript;
    document.getElementById('quizNote').textContent  = chunk.note || '';

    const tagsRow = document.getElementById('quizTagsRow');
    tagsRow.innerHTML = (chunk.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('');

    // Card flip animation
    const card = document.getElementById('quizCard');
    card.style.animation = 'none';
    card.offsetHeight; // reflow
    card.style.animation = '';
  }

  async function _handleResult(quality) {
    const chunk = dueChunks[current];
    if (!chunk) return;

    const updated = Spaced.update(chunk, quality);
    await DB.Chunks.save(updated);
    await DB.Reviews.save({
      id: crypto.randomUUID(),
      chunkId:    chunk.id,
      result:     quality === 2 ? 'pass' : quality === 1 ? 'hard' : 'fail',
      reviewedAt: Date.now(),
    });
    await DB.Activity.log(1);

    if (quality === 2) sessionPass++;
    else if (quality === 1) sessionHard++;
    else sessionFail++;

    // Update today's done count
    const today = new Date().toISOString().slice(0, 10);
    const prev  = parseInt(await DB.Settings.get('todayDone_' + today, 0));
    await DB.Settings.set('todayDone_' + today, prev + 1);

    current++;
    _showCard();
  }

  async function _showDone() {
    document.getElementById('quizShell').style.display = 'none';
    document.getElementById('reviewDone').style.display = '';

    const total = sessionPass + sessionHard + sessionFail;
    document.getElementById('doneSub').textContent =
      `完成 ${total} 個 · 記得 ${sessionPass} · 模糊 ${sessionHard} · 忘了 ${sessionFail}`;

    // Update streak
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = await DB.Settings.get('lastReviewDate', '');
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let streak = parseInt(await DB.Settings.get('streak', 0));
    if (lastDate === yesterday) streak++;
    else if (lastDate !== today) streak = 1;
    await DB.Settings.set('streak', streak);
    await DB.Settings.set('lastReviewDate', today);
  }

  function backToDashboard() {
    dueChunks = [];
    render();
  }

  async function _playChunkAudio() {
    const chunk = dueChunks[current];
    if (!chunk) return;
    const course = await DB.Courses.get(chunk.courseId);
    if (!course?.audioBlob) { Toast.warn('找不到音訊'); return; }
    const url = URL.createObjectURL(course.audioBlob);
    const tmp = new Audio(url);
    tmp.currentTime = chunk.startTime;
    tmp.play();
    const dur = (chunk.endTime - chunk.startTime) * 1000 + 200;
    setTimeout(() => { tmp.pause(); URL.revokeObjectURL(url); }, dur);
  }

  function init() {
    document.getElementById('startReviewBtn').addEventListener('click', startSession);
    document.getElementById('quizPass').addEventListener('click', () => _handleResult(2));
    document.getElementById('quizHard').addEventListener('click', () => _handleResult(1));
    document.getElementById('quizFail').addEventListener('click', () => _handleResult(0));
    document.getElementById('quizSkipBtn').addEventListener('click', () => {
      current++;
      _showCard();
    });
    document.getElementById('quizAudioBtn').addEventListener('click', _playChunkAudio);

    Router.onEnter('review', render);
  }

  return { init, render, backToDashboard };
})();

/**
 * pages/settings.js — Settings page
 */
const SettingsPage = (() => {
  let deferredInstall = null;

  async function init() {
    await _loadValues();
    _bindEvents();
    _initPWA();
    Router.onEnter('settings', _loadValues);
  }

  async function _loadValues() {
    const s = Store.get('settings') || {};
    const key = Store.get('apiKey') || '';

    _val('sgSpeed',       s.speed       || 1);
    _val('sgSkip',        s.skipSec     || 15);
    _val('sgReviewLimit', s.reviewLimit || 20);
    if (key) document.getElementById('sgApiKey').value = key;
  }

  function _val(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v;
  }

  function _bindEvents() {
    // API Key
    document.getElementById('sgApiKeySave').addEventListener('click', async () => {
      const key = document.getElementById('sgApiKey').value.trim();
      if (key && !key.startsWith('sk-ant-')) { Toast.warn('API Key 格式不正確'); return; }
      await DB.Settings.set('apiKey', key);
      Store.set('apiKey', key);
      Toast.success('✓ API Key 已儲存');
    });

    // Speed
    document.getElementById('sgSpeed').addEventListener('change', async (e) => {
      const s = Store.get('settings') || {};
      s.speed = parseFloat(e.target.value);
      Store.set('settings', s);
      await DB.Settings.set('speed', s.speed);
    });

    // Skip
    document.getElementById('sgSkip').addEventListener('change', async (e) => {
      const s = Store.get('settings') || {};
      s.skipSec = parseInt(e.target.value);
      Store.set('settings', s);
      await DB.Settings.set('skipSec', s.skipSec);
    });

    // Review limit
    document.getElementById('sgReviewLimit').addEventListener('change', async (e) => {
      const s = Store.get('settings') || {};
      s.reviewLimit = parseInt(e.target.value);
      Store.set('settings', s);
      await DB.Settings.set('reviewLimit', s.reviewLimit);
    });

    // Export
    document.getElementById('sgExportBtn').addEventListener('click', async () => {
      try {
        const json = await DB.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `knowledge-pod-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        Toast.success('資料匯出成功');
      } catch (e) {
        Toast.error('匯出失敗：' + e.message);
      }
    });

    // Clear
    document.getElementById('sgClearBtn').addEventListener('click', async () => {
      const ok = await Modal.confirm(
        '清除所有資料',
        '此操作將刪除所有課程、碎片、回顧記錄，無法復原。確定繼續嗎？',
        '清除', '取消'
      );
      if (!ok) return;
      await DB.clearAll();
      Store.set('currentCourse', null);
      Store.set('apiKey', null);
      Store.set('settings', { speed: 1, skipSec: 15, reviewLimit: 20 });
      Toast.success('所有資料已清除');
      HomePage.render();
    });
  }

  function _initPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      const btn = document.getElementById('sgInstallBtn');
      const badge = document.getElementById('sgInstallBadge');
      if (btn) btn.style.display = '';
      if (badge) badge.style.display = 'none';
    });

    document.getElementById('sgInstallBtn')?.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      if (outcome === 'accepted') Toast.success('✓ App 安裝成功！');
      deferredInstall = null;
    });

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      const badge = document.getElementById('sgInstallBadge');
      if (badge) badge.textContent = '已安裝';
    }
  }

  return { init };
})();

const FAB = (() => {
  let open = false;

  function init() {
    document.getElementById('fab-main').addEventListener('click', toggle);
    document.getElementById('fab-scrim').addEventListener('click', close);
    document.querySelectorAll('[data-fab-page]').forEach(btn => {
      btn.addEventListener('click', () => Router.go(btn.dataset.fabPage));
    });
    _updateBadge();
  }

  async function _updateBadge() {
    try {
      const due = await DB.Chunks.getDue(999);
      const btn = document.getElementById('fabReviewBtn');
      if (!btn) return;
      let badge = btn.querySelector('.due-badge');
      if (due.length > 0) {
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'due-badge';
          btn.style.position = 'relative';
          btn.appendChild(badge);
        }
        badge.textContent = due.length > 99 ? '99+' : due.length;
      } else if (badge) {
        badge.remove();
      }
    } catch(e) {}
  }

  function toggle() { open ? close() : openMenu(); }

  function openMenu() {
    open = true;
    document.getElementById('fab-wrap').classList.add('open');
    document.getElementById('fab-scrim').classList.add('show');
    _updateBadge();
  }

  function close() {
    if (!open) return;
    open = false;
    document.getElementById('fab-wrap').classList.remove('open');
    document.getElementById('fab-scrim').classList.remove('show');
  }

  return { init, close, updateBadge: _updateBadge };
})();

(async () => {
  await DB.open();
  await Store.loadSettings();
  Modal.init();
  Router.initNav();
  FAB.init();

  ImportPage.init();
  PlayerPage.init();
  LibraryPage.init();
  ReviewPage.init();
  await SettingsPage.init();
  await HomePage.render();

  const now = new Date();
  const dateEl = document.getElementById('homeDate');
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('zh-TW', {month:'long',day:'numeric',weekday:'short'});
  }

  setTimeout(() => {
    const app = document.getElementById('app');
    app.classList.add('ready');
    app.removeAttribute('aria-hidden');
  }, 2100);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  const goto = new URLSearchParams(location.search).get('goto');
  if (goto && ['review','import','library','settings'].includes(goto)) {
    setTimeout(() => Router.go(goto), 2400);
  }

  Router.onEnter('home',    () => { HomePage.render(); FAB._updateBadge && FAB._updateBadge(); });
  Router.onEnter('library', () => LibraryPage.render());
  Router.onEnter('review',  () => ReviewPage.render());
  Router.onEnter('import',  () => ImportPage.reset());
})();
