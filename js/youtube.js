// ══ youtube.js — 影音庫的 YouTube（v4.53.0；v4.55.0 訂閱、紀錄、字幕、小視窗、自動接相關；v4.56.0 跳過業配、歌詞、系統子母畫面）═══════════════════
// App 內搜尋（YouTube Data API v3，使用者自己的金鑰）＋ App 內播放（YouTube 官方 IFrame 播放器）＋ 收進影音庫。
// ★ 只用官方提供的方式：不下載影片、不去廣告、不隱藏播放畫面；要連網才能播。
// 收進影音庫的項目存在 leisuremedia：{ ytId, ytChannel, source:'youtube', blob:null, thumbnail:縮圖網址, duration(秒), note }
// 依賴：db.js（_db, dg, dp, getSetting, setSetting）、utils.js（esc, toast, askConfirm）、media.js（_M, renderMedia, _fmtDur）
// ════════════════════════════════════════════════════════════
const YT_KEY = 'yt_api_key';
const _YT = {
  q:'', items:[], next:'', loading:false, mode:'search',   // 搜尋結果（mode：search／playlist／url）
  lib:new Map(),        // ytId → 影音庫裡那一筆（標示「已收藏」、避免重複收）
  player:null, apiP:null, timer:null,
  queue:[], qi:0, cur:null, rate:1, loop:false,
  dl:new Set(),         // 已下載到影音庫的 ytId（App 版）
  // v4.55
  tab:'search',         // 搜尋面板分頁：search／subs（訂閱動態）／hist（觀看紀錄）
  f:{ type:'videos', sort:0, date:0, len:0 },   // 搜尋篩選
  lists:{},             // 其他分頁的清單（feed／hist／channel），列表上的按鈕用「清單名＋序號」找項目
  info:new Map(),       // ytId → YtNative.info 結果（字幕清單用，免得重複查）
  float:false,          // 浮動小視窗
};
const _YS = { ENDED:0, PLAYING:1, PAUSED:2 };   // 與 YT.PlayerState 相同的數值（App 版不一定載入官方播放器）

// ── Android App 外殼（E:\YC-app，Capacitor）：有 YtNative 外掛時（NewPipeExtractor），
//   搜尋不需要金鑰、直接播影片串流（沒有廣告）、可下載到影音庫離線看。瀏覽器版照舊用官方 API 與播放器。
function _ytN(){
  const C = window.Capacitor;
  return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.YtNative) || null;
}

// ── 網址／編號解析 ───────────────────────────────────────────
// 認得：11 碼編號、youtu.be/ID、watch?v=ID、/shorts/ID、/embed/ID、/live/ID（含 m.、music. 網域）
function _ytId(s){
  s = String(s || '').trim();
  if(/^[\w-]{11}$/.test(s)) return s;
  let u; try{ u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); }catch(e){ return ''; }
  if(!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname)) return '';
  if(/youtu\.be$/i.test(u.hostname)) return (u.pathname.split('/')[1] || '').match(/^[\w-]{11}$/)?.[0] || '';
  const v = u.searchParams.get('v');
  if(v && /^[\w-]{11}$/.test(v)) return v;
  return (u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1] || '';
}
function _ytListId(s){
  try{ const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    if(!/(^|\.)youtube\.com$/i.test(u.hostname)) return '';
    return (u.searchParams.get('list') || '').match(/^[\w-]{10,}$/)?.[0] || '';
  }catch(e){ return ''; }
}
// ISO 8601 長度（PT1H2M3S）→ 秒
function _ytIsoDur(iso){
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) : 0;
}
// API 回傳的標題有 &amp; &#39; 這類字元參照，先還原成文字（顯示時再 esc）
function _ytTxt(s){ const t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; }
const _ytThumb = id => 'https://i.ytimg.com/vi/' + encodeURIComponent(id || '') + '/mqdefault.jpg';   // 編號來自匯入／還原的資料，先編碼再放進網址
const _ytWatch = id => 'https://www.youtube.com/watch?v=' + id;

// ── 額度（估算）：每天 10,000 單位；搜尋一次 100、查影片長度／播放清單一頁各 1。
//   YouTube 以美西時間午夜重置（台灣下午 3～4 點），這裡用 UTC-8 估算日期
const _ytDay = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
async function _ytQuotaAdd(n){
  const q = await getSetting('yt_quota', null).catch(()=>null);
  const d = _ytDay(), used = (q && q.day === d ? q.used : 0) + n;
  await setSetting('yt_quota', { day:d, used }).catch(()=>{});
}
async function _ytQuotaText(){
  const q = await getSetting('yt_quota', null).catch(()=>null);
  const used = q && q.day === _ytDay() ? q.used : 0;
  return '今天約用了 ' + used.toLocaleString() + '／10,000（搜尋一次 100，約可搜 ' + Math.max(0, Math.floor((10000 - used) / 100)) + ' 次；台灣下午 3～4 點重置）';
}

// ── 呼叫 YouTube Data API ───────────────────────────────────
//   ★ 金鑰只放在送給 Google 的網址裡；錯誤訊息自己組，不把金鑰寫進畫面或錯誤紀錄
async function _ytApi(path, params, units){
  const key = String(await getSetting(YT_KEY, '').catch(()=>'') || '').trim();
  if(!key) throw Object.assign(new Error('還沒設定 YouTube 金鑰'), { nokey:true });
  const u = new URL('https://www.googleapis.com/youtube/v3/' + path);
  for(const k in params) u.searchParams.set(k, params[k]);
  u.searchParams.set('key', key);
  let r;
  try{ r = await fetch(u, { cache:'no-store' }); }
  catch(e){ throw new Error('連不上 YouTube（需要網路）'); }
  const j = await r.json().catch(()=>({}));
  if(!r.ok){
    // 金鑰打錯時 reason 是 badRequest，真正原因在 details（API_KEY_INVALID）或訊息「API key not valid」
    const detail = (j?.error?.details || []).map(d => d?.reason).find(Boolean) || '';
    const reason = detail || (/API key not valid/i.test(j?.error?.message || '') ? 'keyInvalid' : '') || j?.error?.errors?.[0]?.reason || j?.error?.status || '';
    const map = {
      quotaExceeded:'今天的搜尋額度用完了，台灣下午 3～4 點重置',
      dailyLimitExceeded:'今天的搜尋額度用完了，台灣下午 3～4 點重置',
      keyInvalid:'金鑰無效，請到設定檢查', API_KEY_INVALID:'金鑰無效，請到設定檢查',
      accessNotConfigured:'這組金鑰還沒啟用 YouTube Data API v3', SERVICE_DISABLED:'這組金鑰還沒啟用 YouTube Data API v3',
      ipRefererBlocked:'金鑰的網站限制擋住了這個網址，請在 Google Cloud 加入本 App 的網址',
      API_KEY_HTTP_REFERRER_BLOCKED:'金鑰的網站限制擋住了這個網址，請在 Google Cloud 加入本 App 的網址',
      playlistNotFound:'找不到這個播放清單（可能是私人清單）',
    };
    if(/quota/i.test(reason)) await _ytQuotaAdd(10000);
    throw new Error(map[reason] || ('YouTube 回應錯誤 ' + r.status + (reason ? '（' + reason + '）' : '')));
  }
  await _ytQuotaAdd(units || 1);
  return j;
}
// 補上影片長度、確認可嵌入（videos.list 一次最多 50 部，1 單位）
async function _ytDetails(ids){
  const out = new Map();
  for(let i = 0; i < ids.length; i += 50){
    const j = await _ytApi('videos', { part:'snippet,contentDetails,status', id:ids.slice(i, i + 50).join(','), maxResults:50 }, 1);
    for(const v of j.items || []) out.set(v.id, v);
  }
  return out;
}
function _ytFromVideo(v){
  return { ytId:v.id, title:_ytTxt(v.snippet?.title) || v.id, ytChannel:_ytTxt(v.snippet?.channelTitle),
    duration:_ytIsoDur(v.contentDetails?.duration), embeddable:v.status?.embeddable !== false };
}

// ════════════════════════════════════════════════════════════
// 【搜尋面板】
// ════════════════════════════════════════════════════════════
async function openYtSearch(kw){
  try{
    document.getElementById('yt-search-ov')?.remove();
    const native = !!_ytN();
    const hasKey = native || !!String(await getSetting(YT_KEY, '').catch(()=>'') || '').trim();
    await _ytRefreshLib();
    const ov = document.createElement('div');
    ov.id = 'yt-search-ov';
    ov.className = 'media-ov-sheet z500';
    ov.innerHTML = `
      <div class="yt-sheet">
        <div class="yt-sheet-hd">
          <div class="yt-sheet-title"><span class="yt-logo">▶</span> YouTube</div>
          <button class="yt-x" onclick="document.getElementById('yt-search-ov').remove()" aria-label="關閉">✕</button>
        </div>
        <div class="yt-tabs">
          <button data-t="search" onclick="ytTab('search')">🔍 搜尋</button>
          <button data-t="subs" onclick="ytTab('subs')">📺 訂閱</button>
          <button data-t="hist" onclick="ytTab('hist')">🕘 紀錄</button>
        </div>
        <div id="yt-pane-search">
          <form class="yt-sbar" onsubmit="event.preventDefault();ytDoSearch()">
            <input id="yt-q" type="search" enterkeyhint="search" autocomplete="off"
              placeholder="${hasKey ? '搜尋影片，或貼上影片／播放清單網址' : '貼上影片或播放清單網址'}" value="${esc(kw || _YT.q || '')}"
              oninput="_ytSuggest()" onfocus="_ytSuggest()" onblur="setTimeout(_ytSuggHide,200)">
            <button type="submit" class="yt-go">搜尋</button>
          </form>
          <div id="yt-sugg" class="yt-sugg" hidden></div>
          ${hasKey ? `<div class="yt-filt">
            ${native ? `<select id="ytf-type" onchange="_ytFilt()"><option value="videos">影片</option><option value="channels">頻道</option></select>` : ''}
            <select id="ytf-sort" onchange="_ytFilt()"><option value="0">排序：關聯性</option><option value="2">上傳日期</option><option value="3">觀看次數</option><option value="1">評分</option></select>
            <select id="ytf-date" onchange="_ytFilt()"><option value="0">時間：不限</option><option value="1">一小時內</option><option value="2">今天</option><option value="3">本週</option><option value="4">本月</option><option value="5">今年</option></select>
            <select id="ytf-len" onchange="_ytFilt()"><option value="0">長度：不限</option><option value="1">4 分鐘內</option><option value="3">4～20 分鐘</option><option value="2">20 分鐘以上</option></select>
          </div>` : ''}
          <div id="yt-hint" class="yt-hint">${native ? 'App 版：搜尋不需要金鑰，播放沒有廣告；按 ⬇ 可下載到影音庫離線看。' : hasKey ? '' : `沒有金鑰也能貼網址播放；要在 App 內搜尋，請到設定填「YouTube 搜尋金鑰」。
            <button class="yt-link" onclick="ytGoKey()">前往設定 ›</button>`}</div>
        </div>
        <div id="yt-pane-top" class="yt-panetop" hidden></div>
        <div id="yt-results" class="yt-results"></div>
      </div>`;
    ov.onclick = e => { if(e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
    for(const [k, id] of [['type', 'ytf-type'], ['sort', 'ytf-sort'], ['date', 'ytf-date'], ['len', 'ytf-len']]){
      const el = document.getElementById(id); if(el) el.value = String(_YT.f[k]);
    }
    _ytFiltLock();
    if(hasKey && !native) _ytQuotaText().then(t => { const h = document.getElementById('yt-hint'); if(h && !h.textContent.trim()) h.textContent = t; });
    if(kw){ _YT.tab = 'search'; ytTab('search', true); ytDoSearch(); }
    else if(_YT.tab !== 'search') ytTab(_YT.tab);
    else { ytTab('search', true); if(_YT.items.length) _ytRenderResults(); else setTimeout(()=>document.getElementById('yt-q')?.focus(), 200); }
  }catch(e){ logError('openYtSearch', e); toast('開啟失敗：' + e.message); }
}
async function _ytRefreshLib(){
  const all = await _getMediaMetaList().catch(()=>[]);
  _YT.lib = new Map(all.filter(m => m.ytId).map(m => [m.ytId, m]));
  _YT.dl = new Set(all.filter(m => m.ytSrc).map(m => m.ytSrc));
}

async function ytDoSearch(more){
  const q = (document.getElementById('yt-q')?.value || '').trim();
  if(!q || _YT.loading) return;
  _ytSuggHide();
  document.getElementById('yt-q')?.blur();
  if(!more) _ytQHistAdd(q);
  const box = document.getElementById('yt-results');
  _YT.loading = true;
  if(!more && box) box.innerHTML = '<div class="yt-empty">搜尋中…</div>';
  try{
    const vid = _ytId(q), list = _ytListId(q);
    if(list && !more){                       // 播放清單網址：列出整份清單（每頁 50 部，1 單位）
      await _ytLoadPlaylist(list);
    } else if(vid && !more){                 // 單一影片網址
      _YT.mode = 'url'; _YT.next = ''; _YT.q = q;
      let it = { ytId:vid, title:'YouTube 影片', ytChannel:'', duration:0, embeddable:true };
      if(_ytN()){
        const r = await _ytN().info({ url:_ytWatch(vid) });
        it = { ytId:vid, title:r.title || it.title, ytChannel:r.channel || '', duration:r.duration > 0 ? r.duration : 0, embeddable:true };
      } else try{ const d = await _ytDetails([vid]); if(d.get(vid)) it = _ytFromVideo(d.get(vid)); else throw new Error('找不到這部影片'); }
      catch(e){
        if(!e.nokey) throw e;
        // 沒有金鑰：用 YouTube 公開的 oEmbed 取標題（拿不到就用預設標題，照樣能播）
        try{ const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(_ytWatch(vid)), { cache:'no-store' });
          if(r.ok){ const j = await r.json(); it.title = j.title || it.title; it.ytChannel = j.author_name || ''; } }catch(_){}
      }
      _YT.items = [it];
    } else if(_ytN()){
      const F = _YT.f;
      if(!more){ _YT.items = []; _YT.next = ''; _YT.q = q; _YT.mode = F.type === 'channels' ? 'channels' : 'search'; }
      const r = more ? await _ytN().more()
        : await _ytN().search({ query:_YT.q, type:F.type, ...(F.type === 'videos' ? { sort:F.sort, date:F.date, length:F.len } : {}) });
      _YT.next = r.hasMore ? 'native' : '';
      if(_YT.mode === 'channels'){
        const have = new Set(_YT.items.map(x => x.chUrl));
        for(const c of r.items || []) if(c.url && !have.has(c.url)){ have.add(c.url);
          _YT.items.push({ ch:true, chUrl:c.url, title:c.name || '', thumb:c.thumb || '', subs:c.subs, videos:c.videos }); }
      } else {
        const have = new Set(_YT.items.map(x => x.ytId));
        for(const x of r.items || []){
          const id = _ytId(x.url);
          if(!id || have.has(id) || x.live) continue;   // 直播不列（不能下載，也沒有固定長度）
          have.add(id);
          _YT.items.push(_ytFromNative(x, id));
        }
      }
    } else {
      if(!more){ _YT.items = []; _YT.next = ''; _YT.q = q; _YT.mode = 'search'; }
      // 篩選（瀏覽器版用官方 API 的參數）：排序、上傳時間、長度
      const F = _YT.f, fp = {};
      if(F.sort) fp.order = { 1:'rating', 2:'date', 3:'viewCount' }[F.sort];
      if(F.date) fp.publishedAfter = new Date(Date.now() - { 1:3600e3, 2:86400e3, 3:7 * 86400e3, 4:31 * 86400e3, 5:366 * 86400e3 }[F.date]).toISOString();
      if(F.len) fp.videoDuration = { 1:'short', 2:'long', 3:'medium' }[F.len];
      const j = await _ytApi('search', { part:'snippet', type:'video', videoEmbeddable:'true', maxResults:20,
        q:_YT.q, regionCode:'TW', relevanceLanguage:'zh-Hant', ...fp, ...(more && _YT.next ? { pageToken:_YT.next } : {}) }, 100);
      _YT.next = j.nextPageToken || '';
      const ids = (j.items || []).map(x => x.id?.videoId).filter(Boolean);
      const det = ids.length ? await _ytDetails(ids) : new Map();
      const add = ids.map(id => det.get(id) ? _ytFromVideo(det.get(id)) : null).filter(x => x && x.embeddable);
      const have = new Set(_YT.items.map(x => x.ytId));
      _YT.items.push(...add.filter(x => !have.has(x.ytId)));
    }
    _ytRenderResults();
    const h = document.getElementById('yt-hint');
    if(h && !_ytN() && String(await getSetting(YT_KEY, '').catch(()=>'') || '').trim()) h.textContent = await _ytQuotaText();
  }catch(e){
    if(box) box.innerHTML = '<div class="yt-empty">' + esc(e.message) + (e.nokey ? '<br>（貼影片網址不需要金鑰）' : '') + '</div>';
  }finally{ _YT.loading = false; }
}
async function _ytLoadPlaylist(list){
  _YT.mode = 'playlist'; _YT.next = ''; _YT.q = list;
  const ids = []; let token = '', title = '';
  for(let page = 0; page < 10; page++){       // 最多 500 部
    const j = await _ytApi('playlistItems', { part:'contentDetails', playlistId:list, maxResults:50, ...(token ? { pageToken:token } : {}) }, 1);
    ids.push(...(j.items || []).map(x => x.contentDetails?.videoId).filter(Boolean));
    token = j.nextPageToken || ''; if(!token) break;
  }
  try{ const p = await _ytApi('playlists', { part:'snippet', id:list }, 1); title = _ytTxt(p.items?.[0]?.snippet?.title || ''); }catch(_){}
  const det = await _ytDetails(ids);
  _YT.items = ids.map(id => det.get(id) ? _ytFromVideo(det.get(id)) : null).filter(Boolean);   // 已刪除、私人的影片 videos.list 查不到，略過
  _YT.plTitle = title;
}

// 原生搜尋／頻道／相關影片的一筆 → 列表項目
function _ytFromNative(x, id){
  return { ytId:id || _ytId(x.url), title:x.title || id, ytChannel:x.channel || '', chUrl:x.uploaderUrl || x.channelUrl || '',
    duration:x.duration > 0 ? x.duration : 0, embeddable:true, when:_ytWhen(x.uploaded), views:x.views > 0 ? x.views : 0 };
}
// YouTube 回傳的上傳時間有時是英文（2 days ago）→ 中文
function _ytWhen(s){
  s = String(s || '').replace(/^(Streamed|Premiered)\s+/i, '');
  const u = { second:'秒', minute:'分鐘', hour:'小時', day:'天', week:'週', month:'個月', year:'年' };
  return s.replace(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i, (m, n, k) => n + ' ' + u[k.toLowerCase()] + '前');
}
function _ytNum(n){
  n = +n || 0;
  if(n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '') + ' 億';
  if(n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + ' 萬';
  return n.toLocaleString();
}
function _ytAgo(t){
  const d = (Date.now() - t) / 1000;
  if(!(d >= 0)) return '';
  if(d < 60) return '剛剛';
  if(d < 3600) return Math.floor(d / 60) + ' 分鐘前';
  if(d < 86400) return Math.floor(d / 3600) + ' 小時前';
  if(d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
  if(d < 86400 * 365) return Math.floor(d / 86400 / 30) + ' 個月前';
  return Math.floor(d / 86400 / 365) + ' 年前';
}

// ── 列表（搜尋結果、訂閱動態、觀看紀錄、頻道頁共用）────────────
function _ytL(ctx){ return ctx === 'search' ? _YT.items : (_YT.lists[ctx] || []); }
function _ytRowsHtml(ctx){
  const L = _ytL(ctx), N = !!_ytN();
  return L.map((it, i) => {
    if(it.ch){   // 頻道（搜尋「頻道」時）
      const on = _ytSubHas(it.chUrl);
      return `<div class="yt-row yt-chrow">
        <div class="yt-av" onclick="ytOpenChannel('${ctx}',${i})">${it.thumb ? `<img loading="lazy" src="${esc(it.thumb)}" alt="" onerror="this.remove()">` : ''}</div>
        <div class="yt-info" onclick="ytOpenChannel('${ctx}',${i})"><div class="yt-t">${esc(it.title)}</div>
          <div class="yt-ch">${it.subs > 0 ? _ytNum(it.subs) + ' 位訂閱者' : ''}${it.videos > 0 ? '・' + _ytNum(it.videos) + ' 部影片' : ''}</div></div>
        <button class="yt-subbtn${on ? ' on' : ''}" onclick="ytSubToggleAt('${ctx}',${i})">${on ? '已訂閱' : '訂閱'}</button>
      </div>`;
    }
    const saved = _YT.lib.has(it.ytId);
    const meta = [it.ytChannel, it.views ? _ytNum(it.views) + ' 次觀看' : '', it.when].filter(Boolean).map(esc).join('・');
    const prog = it.histPos > 5 && it.duration ? Math.min(100, Math.round(it.histPos / it.duration * 100)) : 0;
    return `<div class="yt-row${it.embeddable === false ? ' off' : ''}">
      <div class="yt-thumb" onclick="ytPlayFrom('${ctx}',${i})">
        <img loading="lazy" src="${_ytThumb(it.ytId)}" alt="" onerror="this.remove()">
        ${it.duration ? `<span class="yt-dur">${_fmtDur(it.duration)}</span>` : ''}
        ${prog ? `<i class="yt-prog" style="width:${prog}%"></i>` : ''}
        ${it.isNew ? '<b class="yt-new">新</b>' : ''}
      </div>
      <div class="yt-info" onclick="ytPlayFrom('${ctx}',${i})">
        <div class="yt-t">${esc(it.title)}</div>
        <div class="yt-ch">${meta}${it.embeddable === false ? '・不能在 App 內播放' : ''}${_YT.dl.has(it.ytId) ? '・<b class="yt-dl-ok">已下載</b>' : ''}${it.histAt ? '・' + _ytAgo(it.histAt) + '看' + (it.histPos > 5 ? '到 ' + _fmtDur(it.histPos) : '過') : ''}</div>
      </div>
      ${ctx === 'hist' ? `<button class="yt-add" onclick="ytHistDel(${i})" title="從紀錄刪除" aria-label="從紀錄刪除">✕</button>` : ''}
      ${N ? `<button class="yt-add" onclick="ytDlFrom('${ctx}',${i})" title="下載到影音庫" aria-label="下載到影音庫">⬇</button>` : ''}
      <button class="yt-add${saved ? ' on' : ''}" onclick="ytSaveFrom('${ctx}',${i})" title="${saved ? '已在影音庫（點一下編輯）' : '收進影音庫'}" aria-label="${saved ? '編輯' : '收進影音庫'}">${saved ? '✓' : '＋'}</button>
    </div>`;
  }).join('');
}

function _ytRenderResults(){
  if(_YT.tab !== 'search'){ _ytRenderTab(); return; }
  const box = document.getElementById('yt-results');
  if(!box) return;
  if(!_YT.items.length){ box.innerHTML = '<div class="yt-empty">' + (_YT.mode === 'channels' ? '沒有找到頻道' : '沒有找到可以在 App 內播放的影片') + '</div>'; return; }
  const head = _YT.mode === 'playlist'
    ? `<div class="yt-plhead"><div>播放清單${_YT.plTitle ? '「' + esc(_YT.plTitle) + '」' : ''}・${_YT.items.length} 部${_YT.items.some(x => !x.embeddable) ? '（有些上傳者不允許嵌入，只能到 YouTube 看）' : ''}</div>
        <button class="yt-btn" onclick="ytSaveAll()">全部收進影音庫</button></div>` : '';
  box.innerHTML = head + _ytRowsHtml('search')
    + ((_YT.mode === 'search' || _YT.mode === 'channels') && _YT.next ? '<button class="yt-more" onclick="ytDoSearch(true)">' + (_ytN() ? '載入更多' : '載入更多（再用 100 額度）') + '</button>' : '');
}

// 舊的呼叫方式（搜尋結果的第 i 筆）
function ytPlayResults(i){ ytPlayFrom('search', i); }
function ytDownload(i){ ytDlFrom('search', i); }
function ytSaveResult(i){ ytSaveFrom('search', i); }

async function ytPlayFrom(ctx, i){
  const L = _ytL(ctx), it = L[i];
  if(!it || it.ch) return;
  if(it.embeddable === false){ window.open(_ytWatch(it.ytId), '_blank', 'noopener'); return; }
  // 已收進影音庫的用影音庫那一筆（記得看到哪裡）；沒收的用觀看紀錄的位置接著看
  const hist = await _ytHistMap();
  const src = ctx === 'hist' ? [it] : L.filter(x => !x.ch && x.embeddable !== false);
  const q = src.map(x => _YT.lib.get(x.ytId) || { ...x, lastPos:hist.get(x.ytId)?.pos || 0 });
  _ytOpenPlayer(q, q.findIndex(x => x.ytId === it.ytId));
}
async function ytSaveFrom(ctx, i){
  const it = _ytL(ctx)[i]; if(!it || it.ch) return;
  const ex = _YT.lib.get(it.ytId);
  _ytEditSheet(ex ? await dg('leisuremedia', ex.id) : { ...it, type:'video', category:'', note:'' });
}
function ytDlFrom(ctx, i){ const it = _ytL(ctx)[i]; if(it && !it.ch) _ytDlSheet(it); }

// ── 分頁：搜尋／訂閱／紀錄 ─────────────────────────────────
function ytTab(t, quiet){
  _YT.tab = t;
  document.querySelectorAll('#yt-search-ov .yt-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  const ps = document.getElementById('yt-pane-search'), pt = document.getElementById('yt-pane-top');
  if(ps) ps.hidden = t !== 'search';
  if(pt) pt.hidden = t === 'search';
  if(t === 'search'){ if(!quiet) _ytRenderResults(); return; }
  if(t === 'subs') _ytFeedShow();
  else if(t === 'hist') _ytHistShow();
}
function _ytRenderTab(){
  const box = document.getElementById('yt-results'); if(!box) return;
  if(_YT.tab === 'subs') _ytFeedRender();
  else if(_YT.tab === 'hist') _ytHistRender();
}

// ── 搜尋篩選 ─────────────────────────────────────────────
function _ytFilt(){
  const g = id => +(document.getElementById(id)?.value || 0);
  _YT.f = { type:document.getElementById('ytf-type')?.value === 'channels' ? 'channels' : 'videos', sort:g('ytf-sort'), date:g('ytf-date'), len:g('ytf-len') };
  _ytFiltLock();
  if((document.getElementById('yt-q')?.value || '').trim() && !_ytId(document.getElementById('yt-q').value)) ytDoSearch();
}
// 搜頻道時，排序／時間／長度不適用
function _ytFiltLock(){
  for(const id of ['ytf-sort', 'ytf-date', 'ytf-len']){ const el = document.getElementById(id); if(el) el.disabled = _YT.f.type === 'channels'; }
}

// ── 搜尋建議（打字時）與最近搜尋 ────────────────────────────
function _ytQHist(){ try{ return JSON.parse(localStorage.getItem('yt_qhist') || '[]'); }catch(_){ return []; } }
function _ytQHistAdd(q){
  if(_ytId(q) || _ytListId(q)) return;   // 網址不記
  const a = [q, ..._ytQHist().filter(x => x !== q)].slice(0, 12);
  try{ localStorage.setItem('yt_qhist', JSON.stringify(a)); }catch(_){}
}
function ytQHistDel(q){
  try{ localStorage.setItem('yt_qhist', JSON.stringify(_ytQHist().filter(x => x !== q))); }catch(_){}
  _ytSuggest();
}
let _ytSuggT = 0, _ytSuggSeq = 0;
function _ytSuggest(){
  clearTimeout(_ytSuggT);
  const q = (document.getElementById('yt-q')?.value || '').trim();
  if(!q){ _ytSuggShow(_ytQHist().slice(0, 8), true); return; }
  if(_ytId(q) || _ytListId(q) || !_ytN()){ _ytSuggShow(_ytQHist().filter(x => x.includes(q)).slice(0, 5), true); return; }
  const seq = ++_ytSuggSeq;
  _ytSuggT = setTimeout(async () => {
    let a = [];
    try{ a = (await _ytN().suggest({ query:q })).items || []; }catch(_){}
    if(seq !== _ytSuggSeq || document.activeElement?.id !== 'yt-q') return;
    const h = _ytQHist().filter(x => x !== q && x.includes(q)).slice(0, 3);
    _ytSuggShow([...h.map(x => ({ t:x, h:true })), ...a.filter(x => !h.includes(x)).slice(0, 8).map(x => ({ t:x }))]);
  }, 220);
}
function _ytSuggShow(list, allHist){
  const box = document.getElementById('yt-sugg'); if(!box) return;
  list = list.map(x => typeof x === 'string' ? { t:x, h:!!allHist } : x);
  if(!list.length || document.activeElement?.id !== 'yt-q'){ box.hidden = true; return; }
  box.innerHTML = list.map(x => `<div class="yt-sg">
      <button class="yt-sg-t" onmousedown="event.preventDefault()" onclick="_ytSuggPick(this.dataset.q)" data-q="${esc(x.t)}">${x.h ? '🕘' : '🔍'}　${esc(x.t)}</button>
      ${x.h ? `<button class="yt-sg-x" onmousedown="event.preventDefault()" onclick="ytQHistDel(this.dataset.q)" data-q="${esc(x.t)}" aria-label="刪除">✕</button>` : ''}
    </div>`).join('');
  box.hidden = false;
}
function _ytSuggPick(q){ const el = document.getElementById('yt-q'); if(el){ el.value = q; } ytDoSearch(); }
function _ytSuggHide(){ const b = document.getElementById('yt-sugg'); if(b) b.hidden = true; }

// ════════════════════════════════════════════════════════════
// 【頻道訂閱】存在設定 yt_subs：[{url, name, thumb, at}]（隨備份走）
//   動態：App 版讀各頻道最新影片（快取在這台的 localStorage）
// ════════════════════════════════════════════════════════════
let _ytSubsCache = null;
async function _ytSubs(){
  if(!_ytSubsCache){ const v = await getSetting('yt_subs', []).catch(()=>[]); _ytSubsCache = Array.isArray(v) ? v : []; }
  return _ytSubsCache;
}
async function _ytSubsSave(a){ _ytSubsCache = a; await setSetting('yt_subs', a); }
const _ytChKey = u => (String(u || '').match(/UC[\w-]{22}/) || [String(u || '').replace(/\/+$/, '').toLowerCase()])[0];
function _ytSubHas(u){ const k = _ytChKey(u); return !!(_ytSubsCache || []).find(s => _ytChKey(s.url) === k); }
async function ytSubToggle(url, name, thumb){
  if(!url){ toast('找不到這個頻道'); return false; }
  const a = await _ytSubs(), k = _ytChKey(url), i = a.findIndex(s => _ytChKey(s.url) === k);
  if(i >= 0){
    if(!await askConfirm('取消訂閱', '取消訂閱「' + (a[i].name || name || '這個頻道') + '」？', '取消訂閱')) return true;
    a.splice(i, 1); await _ytSubsSave(a); toast('已取消訂閱'); _ytFeedDrop(k); return false;
  }
  a.push({ url, name:name || '', thumb:thumb || '', at:Date.now() });
  await _ytSubsSave(a);
  toast('已訂閱「' + (name || '頻道') + '」');
  return true;
}
async function ytSubToggleAt(ctx, i){
  const it = _ytL(ctx)[i]; if(!it) return;
  await _ytSubs();
  await ytSubToggle(it.chUrl, it.title, it.thumb);
  _ytRenderResults();
}
function _ytFeedDrop(k){
  const f = _ytFeedCache(); if(!f) return;
  f.items = f.items.filter(x => _ytChKey(x.chUrl) !== k);
  try{ localStorage.setItem('yt_feed', JSON.stringify(f)); }catch(_){}
}

// 頻道頁（點搜尋結果的頻道、播放畫面的頻道名稱）
async function ytOpenChannel(ctx, i){ const it = _ytL(ctx)[i]; if(it) _ytChannelPage(it.chUrl, it.title); }
async function ytOpenChannelUrl(url, name){
  if(!url){ toast('找不到這個頻道'); return; }
  if(document.getElementById('yt-player-ov')) await closeYtPlayer(_YT.npPlaying ? true : undefined);
  if(!document.getElementById('yt-search-ov')) await openYtSearch();
  _ytChannelPage(url, name);
}
async function _ytChannelPage(url, name){
  if(!_ytN()){ window.open(url, '_blank', 'noopener'); return; }
  await _ytSubs();
  _YT.chBack = _YT.tab;
  _YT.tab = 'channel';
  document.querySelectorAll('#yt-search-ov .yt-tabs button').forEach(b => b.classList.remove('on'));
  const ps = document.getElementById('yt-pane-search'), pt = document.getElementById('yt-pane-top'), box = document.getElementById('yt-results');
  if(ps) ps.hidden = true;
  if(pt){ pt.hidden = false; pt.innerHTML = `<div class="yt-chhead"><button class="yt-link" onclick="ytTab(_YT.chBack||'search')">‹ 返回</button><b>${esc(name || '頻道')}</b></div>`; }
  if(box) box.innerHTML = '<div class="yt-empty">讀取頻道…</div>';
  try{
    const c = await _ytN().channel({ url });
    if(_YT.tab !== 'channel') return;
    _YT.lists.channel = (c.items || []).map(x => _ytFromNative(x)).filter(x => x.ytId);
    _YT.chCur = { url:c.url || url, name:c.name || name || '', thumb:c.avatar || '' };
    _ytChannelRender(c);
  }catch(e){ if(box) box.innerHTML = '<div class="yt-empty">✗ ' + esc(e.message || e) + '</div>'; }
}
function _ytChannelRender(c){
  const pt = document.getElementById('yt-pane-top'), box = document.getElementById('yt-results'), ch = _YT.chCur;
  if(!pt || !box || !ch) return;
  const on = _ytSubHas(ch.url);
  pt.innerHTML = `<div class="yt-chhead"><button class="yt-link" onclick="ytTab(_YT.chBack||'search')">‹ 返回</button></div>
    <div class="yt-chcard">${ch.thumb ? `<img src="${esc(ch.thumb)}" alt="" onerror="this.remove()">` : ''}
      <div class="yt-info"><div class="yt-t">${esc(ch.name)}</div><div class="yt-ch">${c && c.subs > 0 ? _ytNum(c.subs) + ' 位訂閱者' : ''}</div></div>
      <button class="yt-subbtn${on ? ' on' : ''}" onclick="_ytChSub()">${on ? '已訂閱' : '訂閱'}</button></div>`;
  pt._c = c || pt._c;
  box.innerHTML = _YT.lists.channel.length ? _ytRowsHtml('channel') : '<div class="yt-empty">這個頻道沒有影片</div>';
}
async function _ytChSub(){
  const ch = _YT.chCur; if(!ch) return;
  await ytSubToggle(ch.url, ch.name, ch.thumb);
  _ytChannelRender(document.getElementById('yt-pane-top')?._c);
}

// ── 訂閱動態 ─────────────────────────────────────────────
function _ytFeedCache(){ try{ return JSON.parse(localStorage.getItem('yt_feed') || 'null'); }catch(_){ return null; } }
async function _ytFeedShow(){
  await _ytSubs();
  _ytFeedRender();
  const f = _ytFeedCache();
  if(_ytN() && _ytSubsCache.length && (!f || Date.now() - f.at > 30 * 60e3)) ytFeedRefresh();
}
function _ytFeedRender(){
  const pt = document.getElementById('yt-pane-top'), box = document.getElementById('yt-results');
  if(!pt || !box || _YT.tab !== 'subs') return;
  const subs = _ytSubsCache || [], f = _ytFeedCache();
  pt.innerHTML = `<div class="yt-subbar">
      <span>訂閱 ${subs.length} 個頻道${f ? '・' + _ytAgo(f.at) + '更新' : ''}</span>
      ${_ytN() ? `<button class="yt-btn" id="yt-feed-rf" onclick="ytFeedRefresh()"${_YT.feedBusy ? ' disabled' : ''}>${_YT.feedBusy ? '更新中…' : '↻ 更新'}</button>` : ''}
      <button class="yt-btn" onclick="ytSubManage()">管理／匯入</button>
    </div>`;
  if(!subs.length){
    box.innerHTML = `<div class="yt-empty">還沒有訂閱頻道。<br>${_ytN() ? '在搜尋把類型切到「頻道」，或在播放畫面點頻道名稱來訂閱；<br>也可以' : '可以'}從 NewPipe 或 Google Takeout 匯入訂閱清單。<br><br><button class="yt-btn pri" onclick="ytSubImport()">匯入訂閱清單</button></div>`;
    return;
  }
  if(!_ytN()){ box.innerHTML = '<div class="yt-empty">訂閱的新影片動態要在 Android App 版看（瀏覽器版沒有額度讀這麼多頻道）。</div>'; return; }
  const seen = +(localStorage.getItem('yt_feed_seen') || 0);
  _YT.lists.subs = (f?.items || []).map(x => ({ ...x, isNew:seen && x.pub > seen, when:x.pub ? _ytAgo(x.pub) : x.when }));
  box.innerHTML = _YT.lists.subs.length ? _ytRowsHtml('subs') : '<div class="yt-empty">' + (_YT.feedBusy ? '讀取各頻道的新影片…' : '按「↻ 更新」讀取各頻道的新影片') + '</div>';
}
async function ytFeedRefresh(){
  if(_YT.feedBusy || !_ytN()) return;
  const subs = await _ytSubs(); if(!subs.length) return;
  _YT.feedBusy = true; _ytFeedRender();
  try{
    const old = _ytFeedCache();
    if(old) try{ localStorage.setItem('yt_feed_seen', String(old.at)); }catch(_){}   // 上次更新之後才出現的標「新」
    const r = await _ytN().feed({ channels:subs.map(s => s.url) });
    const have = new Set(), items = [];
    for(const x of r.items || []){
      const id = _ytId(x.url); if(!id || have.has(id)) continue;
      have.add(id);
      const it = _ytFromNative(x, id);
      it.pub = x.published ? Date.parse(x.published) || 0 : 0;
      if(!it.ytChannel) it.ytChannel = subs.find(s => _ytChKey(s.url) === _ytChKey(x.channelUrl))?.name || '';
      items.push(it);
    }
    items.sort((a, b) => (b.pub || 0) - (a.pub || 0));
    try{ localStorage.setItem('yt_feed', JSON.stringify({ at:Date.now(), items:items.slice(0, 300) })); }catch(_){}
    if(r.failed?.length) toast(r.failed.length + ' 個頻道讀取失敗（可能已刪除或網路不穩）');
  }catch(e){ toast('更新失敗：' + (e.message || e)); }
  finally{ _YT.feedBusy = false; _ytFeedRender(); }
}

// 管理訂閱：列出頻道（取消訂閱）、匯入、匯出
async function ytSubManage(){
  const subs = await _ytSubs();
  document.getElementById('yt-subm-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'yt-subm-ov';
  ov.className = 'media-ov-sheet z700-d';
  ov.innerHTML = `<div class="yt-sheet yt-edit">
      <div class="yt-sheet-hd"><div class="yt-sheet-title">訂閱的頻道（${subs.length}）</div>
        <button class="yt-x" onclick="document.getElementById('yt-subm-ov').remove()" aria-label="關閉">✕</button></div>
      <div class="yt-edit-btns" style="justify-content:flex-start">
        <button class="yt-btn" onclick="ytSubImport()">匯入（NewPipe／Takeout）</button>
        ${subs.length ? '<button class="yt-btn" onclick="ytSubExport()">匯出（NewPipe 格式）</button>' : ''}
      </div>
      <div class="yt-subl">${subs.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant')).map(s => `
        <div class="yt-row yt-chrow">
          <div class="yt-av" onclick="document.getElementById('yt-subm-ov').remove();_ytChannelPage(this.dataset.u,this.dataset.n)" data-u="${esc(s.url)}" data-n="${esc(s.name || '')}">${s.thumb ? `<img loading="lazy" src="${esc(s.thumb)}" alt="" onerror="this.remove()">` : ''}</div>
          <div class="yt-info" onclick="this.previousElementSibling.click()"><div class="yt-t">${esc(s.name || s.url)}</div></div>
          <button class="yt-subbtn on" onclick="_ytSubDel(this.dataset.u)" data-u="${esc(s.url)}">取消</button>
        </div>`).join('') || '<div class="yt-empty">還沒有訂閱</div>'}</div>
    </div>`;
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
}
async function _ytSubDel(url){
  const a = await _ytSubs(), k = _ytChKey(url), s = a.find(x => _ytChKey(x.url) === k);
  if(s) await ytSubToggle(s.url, s.name, s.thumb);
  if(document.getElementById('yt-subm-ov')) ytSubManage();
  _ytRenderResults();
}
// 匯入：NewPipe「訂閱 → ⋮ → 匯出至 → 檔案」的 JSON；Google Takeout 的 subscriptions.csv
function ytSubImport(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,.csv,application/json,text/csv,text/plain';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if(!file) return;
    try{
      if(/\.zip$/i.test(file.name)) throw new Error('這是 NewPipe 的完整備份（.zip）。請改用 NewPipe「訂閱」頁右上 ⋮ →「匯出至」→「檔案」，匯出 .json 再匯入');
      const text = await file.text();
      const found = [];
      let j = null; try{ j = JSON.parse(text); }catch(_){}
      if(j){
        const arr = Array.isArray(j) ? j : (j.subscriptions || []);
        for(const s of arr){
          if(s && (s.service_id == null || +s.service_id === 0) && /youtube\.com/i.test(s.url || '')) found.push({ url:s.url, name:s.name || '' });
        }
      } else {
        for(const line of text.split(/\r?\n/)){
          const m = line.match(/(UC[\w-]{22})/); if(!m) continue;
          const cols = line.split(',');
          found.push({ url:'https://www.youtube.com/channel/' + m[1], name:(cols.slice(2).join(',') || '').replace(/^"|"$/g, '').trim() });
        }
      }
      if(!found.length) throw new Error('檔案裡沒有找到 YouTube 頻道');
      const a = await _ytSubs(), have = new Set(a.map(s => _ytChKey(s.url)));
      let n = 0;
      for(const s of found){ const k = _ytChKey(s.url); if(have.has(k)) continue; have.add(k); a.push({ ...s, thumb:'', at:Date.now() }); n++; }
      await _ytSubsSave(a);
      toast('匯入 ' + n + ' 個頻道' + (found.length - n ? '（' + (found.length - n) + ' 個已訂閱過）' : ''));
      if(document.getElementById('yt-subm-ov')) ytSubManage();
      if(_YT.tab === 'subs'){ _ytFeedRender(); if(n) ytFeedRefresh(); }
    }catch(e){ toast('匯入失敗：' + (e.message || e)); }
  };
  inp.click();
}
async function ytSubExport(){
  const subs = await _ytSubs();
  const text = JSON.stringify({ app_version:'0.27.0', app_version_int:1000, subscriptions:subs.map(s => ({ service_id:0, url:s.url, name:s.name || '' })) }, null, 2);
  const name = 'newpipe_subscriptions_' + new Date().toISOString().slice(0, 10) + '.json';
  if(_ytN()?.saveText){
    try{ await _ytN().saveText({ name, text, mime:'application/json' }); toast('已存到手機「下載／Y.C.」：' + name); }
    catch(e){ toast('匯出失敗：' + e.message); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type:'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ════════════════════════════════════════════════════════════
// 【觀看紀錄】設定 yt_hist：[{ytId, title, ch, chUrl, dur, pos, at, type}]，最新在前、最多 300 筆（隨備份走）
//   搜尋結果、訂閱動態裡沒收進影音庫的影片，也能從紀錄的位置接著看
// ════════════════════════════════════════════════════════════
let _ytHistCache = null, _ytHistT = 0;
async function _ytHist(){
  if(!_ytHistCache){ const v = await getSetting('yt_hist', []).catch(()=>[]); _ytHistCache = Array.isArray(v) ? v : []; }
  return _ytHistCache;
}
async function _ytHistMap(){ return new Map((await _ytHist()).map(h => [h.ytId, h])); }
function _ytHistSave(now){
  clearTimeout(_ytHistT);
  const go = () => setSetting('yt_hist', _ytHistCache || []).catch(e => logError('ytHist', e));
  if(now) return go();
  _ytHistT = setTimeout(go, 1500);
}
function _ytHistPaused(){ try{ return localStorage.getItem('yt_hist_off') === '1'; }catch(_){ return false; } }
async function _ytHistAdd(it){
  if(!it || !it.ytId || _ytHistPaused()) return;
  const a = await _ytHist();
  const old = a.find(h => h.ytId === it.ytId);
  const h = { ytId:it.ytId, title:it.title || old?.title || '', ch:it.ytChannel || old?.ch || '', chUrl:it.chUrl || old?.chUrl || '',
    dur:it.duration || old?.dur || 0, pos:old?.pos || 0, at:Date.now(), type:it.type || old?.type || 'video' };
  _ytHistCache = [h, ...a.filter(x => x.ytId !== it.ytId)].slice(0, 300);
  _ytHistSave();
}
async function _ytHistPos(it, pos, dur, ended){
  if(!it || !it.ytId || _ytHistPaused()) return;
  const h = (await _ytHist()).find(x => x.ytId === it.ytId); if(!h) return;
  h.pos = ended || (dur && pos > dur - 10) ? 0 : Math.floor(pos || 0);
  if(dur && !h.dur) h.dur = Math.floor(dur);
  if(ended) h.done = true;
  _ytHistSave();
}
async function _ytHistShow(){ await _ytHist(); _ytHistRender(); }
function _ytHistRender(){
  const pt = document.getElementById('yt-pane-top'), box = document.getElementById('yt-results');
  if(!pt || !box || _YT.tab !== 'hist') return;
  const a = _ytHistCache || [], off = _ytHistPaused();
  pt.innerHTML = `<div class="yt-subbar"><span>看過 ${a.length} 部${off ? '・<b>已暫停記錄</b>' : ''}</span>
    <button class="yt-btn" onclick="ytHistPause()">${off ? '恢復記錄' : '暫停記錄'}</button>
    ${a.length ? '<button class="yt-btn" onclick="ytHistClear()">全部清除</button>' : ''}</div>`;
  _YT.lists.hist = a.map(h => ({ ytId:h.ytId, title:h.title, ytChannel:h.ch, chUrl:h.chUrl, duration:h.dur, type:h.type, histAt:h.at, histPos:h.pos, embeddable:true }));
  box.innerHTML = a.length ? _ytRowsHtml('hist') : '<div class="yt-empty">還沒有觀看紀錄</div>';
}
async function ytHistDel(i){
  const it = _YT.lists.hist?.[i]; if(!it) return;
  _ytHistCache = (await _ytHist()).filter(h => h.ytId !== it.ytId);
  await _ytHistSave(true);
  _ytHistRender();
}
async function ytHistClear(){
  if(!await askConfirm('清除觀看紀錄', '清除全部 ' + (_ytHistCache || []).length + ' 筆觀看紀錄？（影音庫裡的項目不受影響）', '清除')) return;
  _ytHistCache = []; await _ytHistSave(true); _ytHistRender(); toast('已清除');
}
function ytHistPause(){
  try{ localStorage.setItem('yt_hist_off', _ytHistPaused() ? '0' : '1'); }catch(_){}
  toast(_ytHistPaused() ? '已暫停記錄（之後看的不會記）' : '已恢復記錄');
  _ytHistRender();
}

// ════════════════════════════════════════════════════════════
// 【收進影音庫／編輯】
// ════════════════════════════════════════════════════════════
function _ytCats(){ return [...new Set((_M.allMedia || []).map(m => m.category || '').filter(Boolean))]; }
async function ytEditItem(id){ const m = await dg('leisuremedia', id); if(m) _ytEditSheet(m); }
async function _ytEditSheet(m){
  if(!_M.allMedia?.length) _M.allMedia = await _getMediaMetaList().catch(()=>[]);
  document.getElementById('yt-edit-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'yt-edit-ov';
  ov.className = 'media-ov-sheet z700-d';
  ov.innerHTML = `
    <div class="yt-sheet yt-edit">
      <div class="yt-sheet-hd"><div class="yt-sheet-title">${m.id ? '編輯' : '收進影音庫'}</div>
        <button class="yt-x" onclick="document.getElementById('yt-edit-ov').remove()" aria-label="關閉">✕</button></div>
      <div class="yt-edit-top"><img src="${_ytThumb(m.ytId)}" alt="" onerror="this.remove()">
        <div class="yt-ch">${esc(m.ytChannel || '')}${m.duration ? '・' + _fmtDur(m.duration) : ''}</div></div>
      <label class="yt-lb">標題</label>
      <input id="yte-title" class="finput" value="${esc(m.title || '')}">
      <label class="yt-lb">分類（同分類會依序連續播放，可當播放清單）</label>
      <input id="yte-cat" class="finput" list="yte-cats" value="${esc(m.category || '')}" placeholder="例：英文聽力、讀書音樂">
      <datalist id="yte-cats">${_ytCats().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label class="yt-lb">放在</label>
      <div class="yt-seg">
        <button id="yte-t-video" class="${m.type !== 'audio' ? 'on' : ''}" onclick="_ytSeg('video')">🎬 影片</button>
        <button id="yte-t-audio" class="${m.type === 'audio' ? 'on' : ''}" onclick="_ytSeg('audio')">🎵 音樂（仍會顯示畫面）</button>
      </div>
      <label class="yt-lb">筆記</label>
      <textarea id="yte-note" class="finput" rows="3" placeholder="重點、時間點…">${esc(m.note || '')}</textarea>
      <div class="yt-edit-btns">
        ${m.id ? `<button class="yt-btn red" onclick="_ytDelete(${m.id})">刪除</button>` : ''}
        <button class="yt-btn pri" onclick="_ytSaveEdit()">儲存</button>
      </div>
    </div>`;
  ov._m = m;
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
}
function _ytSeg(t){
  for(const k of ['video', 'audio']) document.getElementById('yte-t-' + k)?.classList.toggle('on', k === t);
}
async function _ytSaveEdit(){
  const ov = document.getElementById('yt-edit-ov'); if(!ov) return;
  const m = ov._m, title = document.getElementById('yte-title').value.trim();
  if(!title){ toast('請填寫標題'); return; }
  const row = m.id ? await dg('leisuremedia', m.id) : {
    ytId:m.ytId, ytChannel:m.ytChannel || '', source:'youtube', fileType:'', fileSize:0, blob:null,
    thumbnail:_ytThumb(m.ytId), duration:m.duration || null, tags:[], favorite:false,
    lastPlay:null, lastPos:0, playCount:0, createdAt:Date.now(),
  };
  if(!row){ toast('找不到這一筆'); return; }
  Object.assign(row, { title, category:document.getElementById('yte-cat').value.trim(),
    type:document.getElementById('yte-t-audio').classList.contains('on') ? 'audio' : 'video',
    note:document.getElementById('yte-note').value.trim() });
  try{
    const id = await dp('leisuremedia', row);
    if(!row.id) row.id = id;
    ov.remove();
    toast(m.id ? '已更新' : '已收進影音庫：' + title);
    await _ytAfterChange(row);
  }catch(e){ logError('_ytSaveEdit', e); toast('儲存失敗：' + e.message); }
}
async function ytSaveAll(){
  const add = _YT.items.filter(x => x.embeddable && !_YT.lib.has(x.ytId));
  if(!add.length){ toast('這份清單都已在影音庫'); return; }
  const cat = await askInput?.('全部收進影音庫', '分類名稱（同分類會依序連續播放）', _YT.plTitle || '');
  if(cat == null) return;
  const t0 = Date.now();
  const rows = add.map((x, i) => ({ ytId:x.ytId, ytChannel:x.ytChannel || '', source:'youtube', title:x.title, type:'video',
    category:String(cat).trim(), fileType:'', fileSize:0, blob:null, thumbnail:_ytThumb(x.ytId), duration:x.duration || null,
    tags:[], note:'', favorite:false, lastPlay:null, lastPos:0, playCount:0, createdAt:t0 + i }));   // 建立時間遞增＝清單順序
  try{
    await bulkPut('leisuremedia', rows);
    toast('已收進 ' + rows.length + ' 部');
    await _ytAfterChange();
  }catch(e){ logError('ytSaveAll', e); toast('儲存失敗：' + e.message); }
}
async function _ytDelete(id){
  if(!await askConfirm('從影音庫移除', '只移除影音庫裡的這一筆（YouTube 上的影片不受影響）。', '移除')) return;
  await dd('leisuremedia', id);
  document.getElementById('yt-edit-ov')?.remove();
  toast('已移除');
  await _ytAfterChange();
}
// 影音庫、搜尋結果、播放器裡的同一筆一起更新
async function _ytAfterChange(row){
  await _ytRefreshLib();
  _M.allMedia = await _getMediaMetaList().catch(()=>_M.allMedia);
  if(document.getElementById('yt-results')) _ytRenderResults();
  if(row && _YT.cur && _YT.cur.ytId === row.ytId){
    const isNew = !_YT.cur.id;
    _YT.queue[_YT.qi] = _YT.cur = { ..._YT.cur, ...row, blob:undefined };
    _ytRenderPlayerInfo();
    if(isNew) _ytMarkPlayed(_YT.cur);   // 邊看邊收進來：算進「最近播放」
  }
  if(S.page === 'media') _renderMediaPage();
}

// ════════════════════════════════════════════════════════════
// 【播放器】YouTube 官方 IFrame 播放器，全螢幕蓋在 App 上
// ════════════════════════════════════════════════════════════
function _ytLoadApi(){
  if(window.YT && window.YT.Player) return Promise.resolve();
  if(_YT.apiP) return _YT.apiP;
  _YT.apiP = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try{ prev && prev(); }catch(_){} res(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { _YT.apiP = null; s.remove(); rej(new Error('連不上 YouTube（需要網路）')); };
    document.head.appendChild(s);
    setTimeout(() => { if(!(window.YT && window.YT.Player)){ _YT.apiP = null; rej(new Error('YouTube 播放器載入逾時，請檢查網路')); } }, 15000);
  });
  return _YT.apiP;
}

// 從影音庫播放（media.js 的 playVideo／playAudio 遇到 ytId 會轉過來）
//   清單＝同分類的 YouTube 項目（依收進的順序）；沒有分類就是同類型（影片／音樂）的
async function ytPlayItem(m){
  if(!_M.allMedia?.length) _M.allMedia = await _getMediaMetaList().catch(()=>[]);
  const same = _M.allMedia.filter(x => x.ytId && (m.category ? x.category === m.category : (!x.category && x.type === m.type)))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const q = same.length ? same : [m];
  _ytOpenPlayer(q, Math.max(0, q.findIndex(x => x.id === m.id)));
}

async function _ytOpenPlayer(queue, idx){
  if(!navigator.onLine){ toast('YouTube 需要網路才能播放'); return; }
  try{ if(typeof closeVinylPlayer === 'function') closeVinylPlayer(); }catch(_){}   // 同時只播一個
  _YT.queue = queue; _YT.qi = idx < 0 ? 0 : idx;
  _YT.bg = false; _ytMiniRemove(); _ytFloatRemove(); _ytNPLast = '';
  _ytEnsureOverlay();
  _ytRenderPlayerInfo();
  if(!_ytN()){
    try{ await _ytLoadApi(); }
    catch(e){ toast(e.message); closeYtPlayer(); return; }
  }
  _ytStart();
}
function _ytEnsureOverlay(){
  let ov = document.getElementById('yt-player-ov');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'yt-player-ov';
    ov.className = 'media-ov-fullplayer video yt-pl';
    ov.innerHTML = `
      <div class="vvp-topbar">
        <button class="vvp-back" onclick="closeYtPlayer()" aria-label="返回"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
        <div class="vvp-title" id="ytp-top">YouTube</div>
        <button class="vvp-more" onclick="_ytMenu()" aria-label="更多">⋮</button>
      </div>
      <div class="ytp-frame-wrap"><div id="ytp-frame"></div></div>
      <div class="ytp-body" id="ytp-body"></div>`;
    document.body.appendChild(ov);
  }
  return ov;
}

function _ytStart(){
  const it = _YT.cur = _YT.queue[_YT.qi];
  if(!it) return;
  _ytRenderPlayerInfo();
  // 看到一半的從上次位置接著看（最後 10 秒內就從頭）
  const start = it.lastPos > 5 && !(it.duration && it.lastPos > it.duration - 10) ? Math.floor(it.lastPos) : 0;
  if(_ytNP() && !it._iframe){ _ytNPStart(it, start); return; }
  if(_ytN() && !it._iframe){
    if(_YT.player && !_YT.player.native){   // 上一部用官方播放器：先拆掉
      try{ _YT.player.destroy(); }catch(_){}
      _YT.player = null;
      const w = document.querySelector('#yt-player-ov .ytp-frame-wrap'); if(w) w.innerHTML = '<div id="ytp-frame"></div>';
    }
    _ytStartNative(it, start); return;
  }
  _ytStartIframe(it, start);
}
// 官方 IFrame 播放器（瀏覽器版；App 版直接播放失敗時的備用）
async function _ytStartIframe(it, start){
  if(_YT.player && _YT.player.native){   // 從直接播放切回官方播放器
    try{ _YT.player.destroy(); }catch(_){}
    _YT.player = null;
    const w = document.querySelector('#yt-player-ov .ytp-frame-wrap'); if(w) w.innerHTML = '<div id="ytp-frame"></div>';
  }
  try{ await _ytLoadApi(); }catch(e){ toast(e.message); return; }
  if(_YT.cur !== it || !document.getElementById('yt-player-ov')) return;
  if(_YT.player && _YT.player.loadVideoById){
    _YT.player.loadVideoById({ videoId:it.ytId, startSeconds:start });
  } else {
    _YT.player = new YT.Player('ytp-frame', {
      width:'100%', height:'100%', videoId:it.ytId,
      playerVars:{ autoplay:1, playsinline:1, rel:0, start, origin:location.origin },
      events:{
        onReady:e => { try{ e.target.setPlaybackRate(_YT.rate); e.target.playVideo(); }catch(_){} },
        onStateChange:_ytState,
        onError:_ytErr,
      },
    });
  }
  _ytMarkPlayed(it);
  _ytSbIframe(it);
  _ytSubAuto(it);
  clearInterval(_YT.ifT);
  _YT.ifT = setInterval(() => {
    if(!_YT.player || _YT.player.np || !document.getElementById('yt-player-ov')){ clearInterval(_YT.ifT); return; }
    try{ _YT.npPos = _YT.player.getCurrentTime() || 0; _ytTrTick(); }catch(_){}
  }, 500);
}

// App 版：用 NewPipeExtractor 取得影片串流網址，用 <video> 直接播（沒有廣告）；失敗就改用官方播放器
function _ytVideoPlayer(){
  const wrap = document.querySelector('#yt-player-ov .ytp-frame-wrap');
  let v = document.getElementById('ytp-video');
  if(!v){
    wrap.innerHTML = '<video id="ytp-video" controls playsinline autoplay preload="auto"></video>';
    v = document.getElementById('ytp-video');
    v.addEventListener('playing', () => _ytState({ data:_YS.PLAYING }));
    v.addEventListener('pause', () => { if(!v.ended) _ytState({ data:_YS.PAUSED }); });
    v.addEventListener('ended', () => _ytState({ data:_YS.ENDED }));
    v.addEventListener('error', () => { if(v.getAttribute('src')) _ytNativeFail(); });
  }
  return { native:true, el:v,
    getCurrentTime:() => v.currentTime || 0, getDuration:() => isFinite(v.duration) ? v.duration : 0,
    seekTo:s => { v.currentTime = s; }, playVideo:() => v.play().catch(()=>{}), pauseVideo:() => v.pause(),
    setPlaybackRate:r => { v.playbackRate = r; },
    destroy:() => { v.pause(); v.removeAttribute('src'); try{ v.load(); }catch(_){} } };
}
async function _ytStartNative(it, start){
  // YouTube 現在只有「畫面」「聲音」分開的串流（少數舊影片才有合在一起的）：
  //   音樂（type=audio）直接播聲音串流（沒有廣告）；影片若沒有合在一起的串流，就用官方播放器
  let info;
  try{ info = await _ytN().info({ url:_ytWatch(it.ytId) }); }
  catch(e){ if(_YT.cur !== it) return; toast('取得影片失敗（' + e.message + '），改用 YouTube 播放器'); it._iframe = true; _ytStartIframe(it, start); return; }
  if(_YT.cur !== it) return;   // 等待中已切到別部
  if(!it.duration && info.duration > 0) it.duration = info.duration;
  const muxed = (info.video || []).slice().sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  const audio = (info.audio || []).slice().sort((a, b) => ((b.mime === 'audio/mp4') - (a.mime === 'audio/mp4')) || ((b.kbps || 0) - (a.kbps || 0)))[0];
  const src = muxed ? muxed.url : (it.type === 'audio' && audio ? audio.url : '');
  if(!src){ it._iframe = true; _ytStartIframe(it, start); return; }
  const p = _YT.player = (_YT.player && _YT.player.native) ? _YT.player : _ytVideoPlayer();
  try{
    p.el.poster = muxed ? '' : _ytThumb(it.ytId).replace('mqdefault', 'hqdefault');
    p.el.src = src;
    p.el.playbackRate = _YT.rate;
    if(start) p.el.addEventListener('loadedmetadata', () => { p.el.currentTime = start; }, { once:true });
    p.el.play().catch(()=>{});
    _ytMarkPlayed(it);
  }catch(e){
    if(_YT.cur !== it) return;
    toast('直接播放失敗（' + e.message + '），改用 YouTube 播放器');
    it._iframe = true;
    _ytStartIframe(it, start);
  }
}
function _ytNativeFail(){
  const it = _YT.cur; if(!it || it._iframe) return;
  toast('這部影片無法直接播放，改用 YouTube 播放器');
  it._iframe = true;
  _ytStartIframe(it, Math.floor(_YT.player?.getCurrentTime?.() || 0));
}

// ════════════════════════════════════════════════════════════
// 【下載到影音庫（App 版）】NewPipe 取得串流 → 原生分段下載 → 存進影音庫（離線可看、隨資料夾備份）
// ════════════════════════════════════════════════════════════
function _ytDlSheet(it){
  if(!_ytN()){ toast('下載只在 Android App 版可用'); return; }
  document.getElementById('yt-dl-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'yt-dl-ov';
  ov.className = 'media-ov-sheet z700-d';
  ov.innerHTML = `
    <div class="yt-sheet yt-edit">
      <div class="yt-sheet-hd"><div class="yt-sheet-title">下載到影音庫</div>
        <button class="yt-x" onclick="_ytDlClose()" aria-label="關閉">✕</button></div>
      <div class="yt-edit-top"><img src="${_ytThumb(it.ytId)}" alt="" onerror="this.remove()">
        <div class="yt-ch">${esc(it.ytChannel || '')}${it.duration ? '・' + _fmtDur(it.duration) : ''}${_YT.dl.has(it.ytId) ? '・已下載過' : ''}</div></div>
      <label class="yt-lb">標題</label>
      <input id="ytd-title" class="finput" value="${esc(it.title || '')}">
      <label class="yt-lb">分類</label>
      <input id="ytd-cat" class="finput" list="ytd-cats" value="${esc(it.category || '')}" placeholder="例：英文聽力、讀書音樂">
      <datalist id="ytd-cats">${_ytCats().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label class="yt-lb">格式與畫質</label>
      <div id="ytd-opts" class="ytd-opts"><div class="yt-ch">讀取可下載的格式…</div></div>
      <label class="ytd-chk"><input type="checkbox" id="ytd-export"> 另存一份到手機的「下載／Y.C.」資料夾（其他 App 也能開）</label>
      <label class="ytd-chk"><input type="checkbox" id="ytd-subs"${_ytSubPref().on ? ' checked' : ''}> 一併存字幕（依字幕設定；離線看影片時可顯示）</label>
      <div id="ytd-prog" class="ytd-prog" hidden><div class="ytd-bar"><i id="ytd-bar"></i></div><div id="ytd-txt" class="yt-ch"></div></div>
      <div class="yt-edit-btns">
        <button class="yt-btn" id="ytd-cancel" onclick="_ytDlClose()">取消</button>
        <button class="yt-btn pri" id="ytd-go" onclick="_ytDlGo()">開始下載</button>
      </div>
    </div>`;
  ov._it = it; ov._opt = null;
  ov.onclick = e => { if(e.target === ov && !ov._busy) ov.remove(); };
  document.body.appendChild(ov);
  _ytDlLoadOpts(ov);
}
// 依影片實際有的串流列出選項：聲音（M4A 相容最好、Opus 音質好檔案小）、影片 MP4（H.264）、WebM（VP9，可到 4K）
async function _ytDlLoadOpts(ov){
  const box = document.getElementById('ytd-opts');
  try{
    const info = ov._info = await _ytN().info({ url:_ytWatch(ov._it.ytId) });
    const sz = x => (x && x.size > 0) ? x.size : 0;
    const orig = (info.audio || []).filter(a => a.original !== false);
    const best = fmt => orig.filter(a => a.fmt === fmt).sort((a, b) => (b.kbps || 0) - (a.kbps || 0))[0];
    const m4a = best('M4A'), opus = best('WEBMA_OPUS');
    const opts = [];
    if(m4a) opts.push({ kind:'audio', a:m4a, label:'🎵 聲音 M4A ' + (m4a.kbps > 0 ? m4a.kbps + 'kbps' : ''), sub:'各裝置都能播', size:sz(m4a) });
    if(opus) opts.push({ kind:'audio', a:opus, label:'🎵 聲音 Opus ' + (opus.kbps > 0 ? opus.kbps + 'kbps' : ''), sub:'音質較好、檔案較小', size:sz(opus) });
    const byH = {};
    for(const v of info.videoOnly || []){
      const k = (v.ext === 'webm' ? 'webm' : 'mp4') + v.height;
      if(!byH[k] || (v.fps || 0) < (byH[k].fps || 0)) byH[k] = v;   // 同畫質選幀率低的（檔案小）
    }
    const vids = Object.values(byH).sort((a, b) => (b.height || 0) - (a.height || 0) || (a.ext === 'mp4' ? -1 : 1));
    for(const v of vids){
      const a = v.ext === 'webm' ? opus : m4a;
      if(!a) continue;
      opts.push({ kind:'video', v, a, fmt:v.ext, label:'🎬 影片 ' + (v.ext === 'webm' ? 'WebM ' : 'MP4 ') + v.res,
        sub:v.ext === 'webm' ? 'VP9，檔案較小' : 'H.264，各裝置都能播', size:sz(v) && sz(a) ? sz(v) + sz(a) : 0 });
    }
    for(const v of info.video || []) opts.push({ kind:'muxed', v, label:'🎬 影片 ' + (v.ext || '').toUpperCase() + ' ' + (v.res || ''), sub:'含聲音（舊格式）', size:sz(v) });
    if(!opts.length) throw new Error('這部影片沒有可下載的格式');
    ov._opts = opts;
    // 預設：音樂選 M4A；影片選 MP4 720p 以下最高的
    let def = ov._it.type === 'audio' ? 0 : opts.findIndex(o => o.kind === 'video' && o.fmt === 'mp4' && o.v.height <= 720);
    if(def < 0) def = 0;
    box.innerHTML = opts.map((o, i) => `<button class="ytd-opt" data-i="${i}" onclick="_ytDlPick(${i})">
      <span class="ytd-opt-l">${esc(o.label)}<small>${esc(o.sub)}</small></span><span class="ytd-opt-s">${o.size ? _fmtSize(o.size) : ''}</span></button>`).join('');
    _ytDlPick(def);
  }catch(e){
    box.innerHTML = '<div class="yt-ch">✗ ' + esc(e.message || e) + '</div>';
  }
}
function _ytDlPick(i){
  const ov = document.getElementById('yt-dl-ov'); if(!ov || ov._busy || !ov._opts) return;
  ov._opt = ov._opts[i];
  document.querySelectorAll('#ytd-opts .ytd-opt').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
}
function _ytDlClose(){
  const ov = document.getElementById('yt-dl-ov'); if(!ov) return;
  if(ov._busy){ for(const x of ['', '_v', '_a']) _ytN()?.cancel({ id:ov._busy + x }); return; }   // 下載中：取消（完成取消後視窗會自己關）
  ov.remove();
}
async function _ytDlGo(){
  const ov = document.getElementById('yt-dl-ov'); if(!ov || ov._busy) return;
  if(!ov._opt){ toast('請先選格式'); return; }
  const N = _ytN(), it = ov._it, opt = ov._opt, kind = opt.kind === 'audio' ? 'audio' : 'video';
  const exportCopy = !!document.getElementById('ytd-export')?.checked;
  const withSubs = kind === 'video' && !!document.getElementById('ytd-subs')?.checked;
  const title = document.getElementById('ytd-title').value.trim() || it.title || it.ytId;
  const category = document.getElementById('ytd-cat').value.trim();
  const txt = document.getElementById('ytd-txt'), bar = document.getElementById('ytd-bar');
  document.getElementById('ytd-prog').hidden = false;
  document.getElementById('ytd-go').disabled = true;
  document.getElementById('ytd-cancel').textContent = '取消下載';
  const id = 'yt_' + it.ytId + '_' + kind + '_' + Date.now().toString(36);
  ov._busy = id;
  let lis = null; const tmp = [];
  try{
    const info = ov._info;
    let label = '', phase = '';
    lis = await N.addListener('dlProgress', e => {
      if(!e.id.startsWith(id) || e.id.endsWith('_t')) return;   // 封面不算進度
      const pct = e.total ? Math.floor(e.done / e.total * 100) : 0;
      bar.style.width = pct + '%';
      txt.textContent = phase + '下載中 ' + pct + '%（' + _fmtSize(e.done) + '／' + _fmtSize(e.total) + '）' + label;
    });
    let r, pick;
    if(opt.kind === 'audio'){
      pick = { mime:opt.a.mime, ext:opt.a.ext };
      r = await N.download({ url:opt.a.url, id, ext:opt.a.ext });
      tmp.push(r.path);
    } else if(opt.kind === 'muxed'){
      pick = { mime:opt.v.mime, ext:opt.v.ext }; label = '（' + (opt.v.res || '') + '）';
      r = await N.download({ url:opt.v.url, id, ext:opt.v.ext });
      tmp.push(r.path);
    } else {
      // 畫面、聲音分開下載，再在手機上合成一個檔（不重新編碼）
      label = '（' + opt.v.res + '）';
      phase = '① 畫面 ';
      const rv = await N.download({ url:opt.v.url, id:id + '_v', ext:opt.v.ext });
      tmp.push(rv.path);
      phase = '② 聲音 ';
      const ra = await N.download({ url:opt.a.url, id:id + '_a', ext:opt.a.ext });
      tmp.push(ra.path);
      phase = '';
      txt.textContent = '③ 合併畫面和聲音…';
      r = await N.mux({ video:rv.path, audio:ra.path, id, format:opt.fmt });
      tmp.push(r.path);
      pick = { mime:opt.fmt === 'webm' ? 'video/webm' : 'video/mp4', ext:opt.fmt };
    }
    if(exportCopy){
      txt.textContent = '另存到手機的「下載」資料夾…';
      try{ await N.exportFile({ path:r.path, name:title + '.' + pick.ext, mime:pick.mime }); }
      catch(e){ toast('另存到「下載」資料夾失敗：' + e.message); }
    }
    txt.textContent = '存進影音庫…';
    const raw = await (await fetch(window.Capacitor.convertFileSrc(r.path))).blob();
    const blob = new Blob([raw], { type:pick.mime });
    // 封面也下載下來（離線也看得到）
    let thumbnail = null;
    try{
      const t = await N.download({ url:info.thumb || _ytThumb(it.ytId), id:id + '_t', ext:'jpg' });
      tmp.push(t.path);
      const tb = await (await fetch(window.Capacitor.convertFileSrc(t.path))).blob();
      thumbnail = await _compressMediaThumb(new File([tb], 'thumb.jpg', { type:'image/jpeg' }));
    }catch(_){}
    let subs;
    if(withSubs){
      txt.textContent = '下載字幕…';
      try{ subs = await _ytSubForSave(it.ytId); if(!subs.length) toast('這部影片沒有字幕'); }catch(e){ toast('字幕下載失敗（影片照樣存）：' + (e.message || e)); }
    }
    await dp('leisuremedia', {
      title, type:kind === 'audio' ? 'audio' : 'video', category,
      fileType:pick.ext, mimeType:pick.mime, fileSize:blob.size, blob, thumbnail,
      duration:info.duration > 0 ? info.duration : (it.duration || null),
      tags:[], favorite:false, lastPlay:null, lastPos:0, playCount:0, createdAt:Date.now(),
      ytSrc:it.ytId, ytChannel:info.channel || it.ytChannel || '', source:'youtube-download',
      ...(subs && subs.length ? { subs } : {}),
    });
    ov._busy = null;
    ov.remove();
    toast('已下載到影音庫：' + title + '（' + _fmtSize(blob.size) + '）' + (exportCopy ? '，也存到手機「下載／Y.C.」' : ''));
    await _ytAfterChange();
  }catch(e){
    ov._busy = null;
    if(/已取消/.test(e.message || '')){ ov.remove(); toast('已取消下載'); }
    else {
      txt.textContent = '✗ ' + (e.message || e);
      document.getElementById('ytd-go').disabled = false;
      document.getElementById('ytd-cancel').textContent = '關閉';
    }
  }finally{
    try{ lis && lis.remove(); }catch(_){}
    for(const pth of tmp) N.remove({ path:pth }).catch(()=>{});
  }
}
async function _ytMarkPlayed(it){
  _ytHistAdd(it);      // 觀看紀錄（收不收進影音庫都記）
  if(!it.id) return;   // 搜尋結果還沒收進影音庫：影音庫不記錄
  try{
    const m = await dg('leisuremedia', it.id); if(!m) return;
    m.lastPlay = Date.now(); m.playCount = (m.playCount || 0) + 1;
    await dp('leisuremedia', m);
    const x = (_M.allMedia || []).find(y => y.id === it.id); if(x){ x.lastPlay = m.lastPlay; x.playCount = m.playCount; }
  }catch(e){ logError('_ytMarkPlayed', e); }
}
function _ytState(e){
  const S_ = _YS;
  clearInterval(_YT.timer); _YT.timer = null;
  if(e.data === S_.PLAYING){
    try{ _YT.player.setPlaybackRate(_YT.rate); }catch(_){}
    _YT.timer = setInterval(_ytSavePos, 10000);
  } else if(e.data === S_.PAUSED){ _ytSavePos(); }
  else if(e.data === S_.ENDED){
    _ytSavePos(true);
    if(_YT.loop){ try{ _YT.player.seekTo(0, true); _YT.player.playVideo(); }catch(_){} }
    else if(_YT.qi < _YT.queue.length - 1) ytNext();
  }
}
function _ytErr(e){
  // 2 參數錯、5 HTML5 播放錯、100 找不到／私人、101／150 上傳者不允許嵌入
  const msg = { 100:'這部影片已刪除或設為私人', 101:'上傳者不允許在其他 App 內播放', 150:'上傳者不允許在其他 App 內播放' }[e.data] || ('播放錯誤（代碼 ' + e.data + '）');
  toast(msg + (_YT.qi < _YT.queue.length - 1 ? '，3 秒後播下一部' : ''));
  const b = document.getElementById('ytp-body');
  if(b && !b.querySelector('.ytp-errbox')) b.insertAdjacentHTML('afterbegin',
    `<div class="ytp-errbox">${esc(msg)}　<a href="${_ytWatch(_YT.cur?.ytId || '')}" target="_blank" rel="noopener">到 YouTube 看 ›</a></div>`);
  if(_YT.qi < _YT.queue.length - 1) setTimeout(() => { if(document.getElementById('yt-player-ov')) ytNext(); }, 3000);
}
// 記住看到哪裡（影音庫那一筆＋觀看紀錄）；看完就歸零，下次從頭
async function _ytSavePos(ended){
  const it = _YT.cur, p = _YT.player;
  if(!it || !p || !p.getCurrentTime) return;
  let pos = 0, dur = 0;
  try{ pos = Math.floor(p.getCurrentTime() || 0); dur = Math.floor(p.getDuration() || 0); }catch(_){ return; }
  return _ytSavePosOf(it, pos, dur, ended);
}
async function _ytSavePosOf(it, pos, dur, ended){
  _ytHistPos(it, pos, dur, ended);
  if(!it || !it.id) return;
  pos = Math.floor(pos || 0); dur = Math.floor(dur || 0);
  if(ended || (dur && pos > dur - 10)) pos = 0;
  it.lastPos = pos;
  try{
    const m = await dg('leisuremedia', it.id); if(!m) return;
    m.lastPos = pos; if(dur && !m.duration) m.duration = dur;
    await dp('leisuremedia', m);
    const x = (_M.allMedia || []).find(y => y.id === it.id); if(x){ x.lastPos = pos; if(dur && !x.duration) x.duration = dur; }
  }catch(e){ logError('_ytSavePos', e); }
}
function ytNext(){ if(_YT.qi < _YT.queue.length - 1){ _ytSavePos(); _YT.qi++; _ytStart(); } }
function ytPrev(){
  const p = _YT.player;
  try{ if(p && p.getCurrentTime && p.getCurrentTime() > 5){ p.seekTo(0, true); return; } }catch(_){}
  if(_YT.qi > 0){ _ytSavePos(); _YT.qi--; _ytStart(); }
}
function ytJump(i){ if(i !== _YT.qi && _YT.queue[i]){ _ytSavePos(); _YT.qi = i; _ytStart(); } }
function ytRate(){
  const rs = [0.75, 1, 1.25, 1.5, 1.75, 2];
  _YT.rate = rs[(rs.indexOf(_YT.rate) + 1) % rs.length];
  try{ _YT.player.setPlaybackRate(_YT.rate); }catch(_){}
  _ytRenderPlayerInfo();
}
function ytLoop(){
  _YT.loop = !_YT.loop;
  if(_YT.player && _YT.player.np) _ytNP().control({ cmd:'loop', loop:_YT.loop });
  _ytRenderPlayerInfo(); toast(_YT.loop ? '單部重複播放' : '播完接下一部');
}
async function ytFav(){
  const it = _YT.cur; if(!it) return;
  if(!it.id){ _ytEditSheet({ ...it, type:'video', category:'', note:'' }); return; }   // 還沒收進：先收
  const m = await dg('leisuremedia', it.id); if(!m) return;
  m.favorite = !m.favorite; await dp('leisuremedia', m);
  it.favorite = m.favorite;
  const x = (_M.allMedia || []).find(y => y.id === it.id); if(x) x.favorite = m.favorite;
  toast(m.favorite ? '已加入收藏' : '已取消收藏');
  _ytRenderPlayerInfo();
}
// 跳到筆記裡的時間點（筆記寫「12:30」「1:02:03」點了就跳過去）
function ytSeek(sec){ try{ _YT.player.seekTo(sec, true); _YT.player.playVideo(); }catch(_){} }
function _ytNoteHtml(s){
  return esc(s).replace(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g, (m, h, mi, se) =>
    `<button class="ytp-ts" onclick="ytSeek(${(+h || 0) * 3600 + (+mi) * 60 + (+se)})">${m}</button>`).replace(/\n/g, '<br>');
}

function _ytRenderPlayerInfo(){
  const it = _YT.cur || _YT.queue[_YT.qi];
  const top = document.getElementById('ytp-top'), body = document.getElementById('ytp-body');
  if(!it || !body) return;
  if(top) top.textContent = it.title || 'YouTube';
  const saved = !!it.id;
  const q = _YT.queue;
  body.innerHTML = `
    <div class="ytp-title">${esc(it.title || '')}</div>
    <div class="ytp-ch">${_ytN() && it.ytChannel ? `<button class="ytp-chlink" onclick="ytCurChannel()">${esc(it.ytChannel)} ›</button>` : esc(it.ytChannel || '')}${it.category ? '・' + esc(it.category) : ''}${saved ? '' : '・還沒收進影音庫'}${it.related ? '・自動接的相關影片' : ''}</div>
    <div class="ytp-ctrls">
      <button onclick="ytPrev()" aria-label="上一部">⏮</button>
      <button onclick="ytRate()" class="${_YT.rate !== 1 ? 'on' : ''}" aria-label="播放速度">${_YT.rate}×</button>
      <button onclick="ytLoop()" class="${_YT.loop ? 'on' : ''}" aria-label="單部重複">↻</button>
      <button onclick="ytFav()" class="${it.favorite ? 'on' : ''}" aria-label="${saved ? '收藏' : '收進影音庫'}">${saved ? (it.favorite ? '♥' : '♡') : '＋'}</button>
      <button onclick="${saved ? 'ytEditItem(' + it.id + ')' : '_ytEditSheet(_YT.cur)'}" aria-label="分類與筆記">✎</button>
      <button onclick="ytNext()" aria-label="下一部"${_YT.qi >= q.length - 1 ? ' disabled' : ''}>⏭</button>
    </div>
    ${_YT.player && _YT.player.np ? `<div class="ytp-ctrls ytp-ctrls2">
      <button onclick="closeYtPlayer(true)" aria-label="背景播放">🎧 背景</button>
      <button onclick="ytFloat()" aria-label="浮動小視窗">▣ 小視窗</button>
      ${it.type === 'audio' ? '' : `<button onclick="ytFull()" aria-label="全螢幕">⛶ 全螢幕</button>
      <button onclick="ytQuality()" aria-label="畫質">${_ytMaxH()}p</button>`}
      <button onclick="ytSubSheet()" class="${_ytSubPref().on ? 'on' : ''}" aria-label="字幕">CC 字幕</button>
      <button onclick="ytAutoToggle()" class="${_ytAuto() ? 'on' : ''}" aria-label="播完自動接相關影片">∞ 自動接</button>
      ${it.type === 'audio' ? `<button onclick="ytLyrics()" class="${_YT.subs && _YT.subs.lyrics && _YT.subs.ytId === it.ytId ? 'on' : ''}" aria-label="歌詞">♪ 歌詞</button>` : ''}
    </div>` : ''}
    ${it.note ? `<div class="ytp-note">${_ytNoteHtml(it.note)}</div>` : ''}
    <div id="ytp-sb" class="ytp-sb" hidden></div>
    <div id="ytp-tr" class="ytp-tr" hidden></div>
    ${q.length > 1 ? `<div class="ytp-qhd">播放清單・${_YT.qi + 1}／${q.length}${_YT.loop ? '（單部重複中）' : '（播完自動接下一部）'}</div>
      <div class="ytp-q">${q.map((x, i) => `
        <div class="ytp-qi${i === _YT.qi ? ' on' : ''}" onclick="ytJump(${i})">
          <img loading="lazy" src="${_ytThumb(x.ytId)}" alt="" onerror="this.remove()">
          <div><div class="yt-t">${esc(x.title || '')}</div>
            <div class="yt-ch">${x.duration ? _fmtDur(x.duration) : ''}${x.lastPos > 5 ? '・看到 ' + _fmtDur(x.lastPos) : ''}</div></div>
        </div>`).join('')}</div>` : ''}`;
  body.querySelector('.ytp-qi.on')?.scrollIntoView({ block:'nearest' });
  _ytTrRender();
  _ytRenderSbLine();
}

function _ytMenu(){
  const it = _YT.cur; if(!it) return;
  document.getElementById('yt-menu-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'yt-menu-ov';
  ov.className = 'media-ov-sheet z700';
  ov.innerHTML = `<div class="yt-sheet yt-menu">
    <button onclick="document.getElementById('yt-menu-ov').remove();${it.id ? 'ytEditItem(' + it.id + ')' : '_ytEditSheet(_YT.cur)'}">✎　${it.id ? '編輯標題、分類、筆記' : '收進影音庫'}</button>
    ${_ytN() ? `<button onclick="document.getElementById('yt-menu-ov').remove();_ytDlSheet(_YT.cur)">⬇　下載到影音庫（離線看）</button>` : ''}
    <button onclick="document.getElementById('yt-menu-ov').remove();ytLyrics()">♪　找歌詞（LRCLIB）</button>
    <button onclick="document.getElementById('yt-menu-ov').remove();ytLyrToggle()">♪　音樂自動顯示歌詞：${_ytLyrOn() ? '開' : '關'}</button>
    <button onclick="document.getElementById('yt-menu-ov').remove();ytSbSheet()">⏭　自動跳過業配等片段（SponsorBlock）</button>
    <button onclick="document.getElementById('yt-menu-ov').remove();window.open('${_ytWatch(it.ytId)}','_blank','noopener')">↗　在 YouTube 開啟</button>
    <button onclick="document.getElementById('yt-menu-ov').remove()">取消</button></div>`;
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
}

async function closeYtPlayer(bg){
  const ovEl = document.getElementById('yt-player-ov');
  if(ovEl && ovEl.classList.contains('yt-fs') && bg === undefined){ ytFull(); return; }   // 返回鍵：先退出全螢幕
  const np = _YT.player && _YT.player.np;
  if(np && bg === undefined) bg = !!(_YT.npPlaying && _YT.cur && _YT.cur.type === 'audio');   // 音樂：關掉畫面、繼續在背景播
  if(np && bg === true){
    await _ytSavePos();
    _ytNP().setView({ visible:false });
    _ytNPObs(false);
    document.getElementById('yt-menu-ov')?.remove();
    ovEl?.remove();
    _ytFloatRemove();
    _YT.bg = true;
    _ytNPLast = '';
    _ytMiniRender();
    if(S.page === 'media' && !document.getElementById('yt-search-ov')) _renderMediaPage();
    return;
  }
  _YT.bg = false; _ytMiniRemove(); _ytFloatRemove(); _YT.subs = null; _ytNPLast = ''; clearInterval(_YT.sbT); clearInterval(_YT.ifT); _YT.sbSegs = null;
  clearInterval(_YT.timer); _YT.timer = null;
  await _ytSavePos();
  try{ _YT.player && _YT.player.destroy && _YT.player.destroy(); }catch(_){}
  _YT.player = null; _YT.cur = null;
  document.getElementById('yt-menu-ov')?.remove();
  document.getElementById('yt-player-ov')?.remove();
  if(S.page === 'media' && !document.getElementById('yt-search-ov')) _renderMediaPage();   // 「最近播放」、看到哪裡
  else if(document.getElementById('yt-results')) _ytRenderResults();
}

// ════════════════════════════════════════════════════════════
// 【App 版原生播放器】YcPlayer（Media3）：影片沒有廣告、關螢幕／切 App 繼續播、通知列控制、全螢幕
//   畫面是原生元件，疊在 .ytp-frame-wrap 的位置；有彈窗蓋上來時先藏起來
// ════════════════════════════════════════════════════════════
function _ytNP(){
  const C = window.Capacitor;
  return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.YcPlayer) || null;
}
function _ytMaxH(){ try{ return +(localStorage.getItem('yt_maxh') || 720) || 720; }catch(_){ return 720; } }
function _ytNPAdapter(){
  const P = _ytNP();
  return { native:true, np:true,
    getCurrentTime:() => _YT.npPos || 0, getDuration:() => _YT.npDur || 0,
    seekTo:s => { P.control({ cmd:'seek', pos:s }); }, playVideo:() => P.control({ cmd:'play' }), pauseVideo:() => P.control({ cmd:'pause' }),
    setPlaybackRate:r => P.control({ cmd:'rate', rate:r }),
    destroy:() => { P.stop(); _YT.npOpen = false; _ytNPObs(false); } };
}
function _ytNPItems(){
  return _YT.queue.map(x => ({ ytId:x.ytId, title:x.title || '', artist:x.ytChannel || '', audioOnly:x.type === 'audio' }));
}
async function _ytNPStart(it, start){
  const P = _ytNP();
  _ytNPInit();
  if(_YT.player && !_YT.player.np){   // 上一部用官方播放器：先拆掉
    try{ _YT.player.destroy(); }catch(_){}
    _YT.player = null;
  }
  _ytNPPoster(it);
  try{
    if(_YT.player && _YT.player.np && _YT.npOpen){
      await P.jump({ index:_YT.qi, start });
    } else {
      _YT.player = _ytNPAdapter();
      const ex = (await _ytHist()).slice(0, 200).map(h => h.ytId);
      await P.open({ items:_ytNPItems(), index:_YT.qi, start, maxHeight:_ytMaxH(), rate:_YT.rate, loop:_YT.loop, rect:_ytNPRect(),
        autoplay:_ytAuto(), exclude:ex, ..._ytSbNative() });
      _YT.npOpen = true;
    }
  }catch(e){ toast('播放器開啟失敗：' + e.message); return; }
  _ytNPObs(true);
  _ytRenderPlayerInfo();
  _ytNPSync();
  _ytMarkPlayed(it);
  _ytSubAuto(it);
}
// 音樂：原生畫面藏起來，改顯示封面
function _ytNPPoster(it){
  const w = document.querySelector('#yt-player-ov .ytp-frame-wrap');
  if(!w) return;
  w.innerHTML = it && it.type === 'audio' ? `<img class="ytp-poster" src="${_ytThumb(it.ytId).replace('mqdefault', 'hqdefault')}" alt="">` : '';
}
const _YT_COVER = '#yt-edit-ov, #yt-menu-ov, #yt-dl-ov, #yt-sub-ov, #yt-subm-ov, #yt-sbs-ov, #ask-in-ov, #cfm-ov.on, .cov.on, #img-viewer';
function _ytNPCovered(){
  if(_YT.float) return !document.getElementById('yt-float') || !!document.querySelector(_YT_COVER);
  return !document.getElementById('yt-player-ov') || _YT.bg || !!document.querySelector(_YT_COVER);
}
function _ytNPRect(){
  const it = _YT.cur || _YT.queue[_YT.qi];
  const w = document.querySelector(_YT.float ? '#yt-float .ytf-v' : '#yt-player-ov .ytp-frame-wrap');
  if(!w || !it || it.type === 'audio' || _ytNPCovered()) return { visible:false };
  const r = w.getBoundingClientRect();
  return { x:r.left, y:r.top, w:r.width, h:r.height, visible:r.width > 0 && r.height > 0, controls:!_YT.float };
}
let _ytNPSyncT = 0, _ytNPLast = '';
function _ytNPSync(){
  if(!_ytNP() || !_YT.npOpen) return;
  cancelAnimationFrame(_ytNPSyncT);
  _ytNPSyncT = requestAnimationFrame(() => {
    const r = _ytNPRect(), k = JSON.stringify(r);
    if(k === _ytNPLast) return;   // 位置沒變就不用再告訴原生端（做題時畫面一直變動）
    _ytNPLast = k;
    _ytNP().setView(r);
  });
}
let _ytNPMo = null;
function _ytNPObs(on){
  if(on && !_ytNPMo){
    _ytNPMo = new MutationObserver(_ytNPSync);
    _ytNPMo.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
    window.addEventListener('resize', _ytNPSync);
  } else if(!on && _ytNPMo){
    _ytNPMo.disconnect(); _ytNPMo = null;
    window.removeEventListener('resize', _ytNPSync);
  }
}
let _ytNPInited = false;
function _ytNPInit(){
  if(_ytNPInited) return;
  _ytNPInited = true;
  const P = _ytNP();
  P.addListener('state', s => {
    if(!_YT.npOpen) return;
    // 原生端自己換到下一部（播完、通知列按下一首）：先存上一部看到哪裡，再換畫面上的資訊
    if(s.index !== _YT.qi && _YT.queue[s.index]){
      const prev = _YT.cur;
      if(prev) _ytSavePosOf(prev, _YT.npPos, _YT.npDur, true);
      _YT.qi = s.index; _YT.cur = _YT.queue[s.index];
      _YT.npPos = 0; _YT.npDur = 0;
      _ytNPPoster(_YT.cur);
      _ytRenderPlayerInfo();
      _ytNPSync();
      _ytMarkPlayed(_YT.cur);
      _ytSubAuto(_YT.cur);
    }
    _YT.npPos = s.pos; _YT.npDur = s.dur; _YT.npPlaying = s.playing;
    if(s.playing && Date.now() - (_YT.npSaved || 0) > 10000){ _YT.npSaved = Date.now(); _ytSavePos(); }
    if(s.ended) _ytSavePos(true);
    _ytMiniUpdate();
    _ytFloatUpdate();
    _ytTrTick();
  });
  // 清單播完、原生端自動接了一部相關影片：加進畫面上的清單
  P.addListener('added', a => {
    if(!_YT.npOpen || !a || !a.ytId) return;
    _YT.queue.push({ ytId:a.ytId, title:a.title || '', ytChannel:a.artist || '', duration:a.duration || 0,
      type:a.audioOnly ? 'audio' : 'video', related:true, embeddable:true });
  });
  P.addListener('error', e => {
    const it = _YT.queue[e.index];
    if(!it || e.index !== _YT.qi) return;
    if(_YT.bg || _YT.float){ toast(e.message + '，跳到下一部'); _ytNP().control({ cmd:'next' }); return; }
    toast(e.message + '，改用 YouTube 播放器');
    it._iframe = true;
    const start = Math.floor(_YT.npPos || it.lastPos || 0);
    try{ _YT.player && _YT.player.destroy(); }catch(_){}
    _YT.player = null;
    _ytStartIframe(it, start);
  });
  P.addListener('fullscreen', () => ytFull());
  P.addListener('segments', e => { _YT.sbSegs = { ytId:e.ytId, segs:e.segments || [] }; _ytRenderSbLine(); });
  P.addListener('skipped', e => _ytSbToast(e));
  P.addListener('pip', e => { if(!e.in){ _ytNPLast = ''; _ytNPSync(); } });
}
// 全螢幕：畫面放滿、轉橫向；再按一次（或返回鍵）還原
function ytFull(){
  const ov = document.getElementById('yt-player-ov'); if(!ov) return;
  const on = !ov.classList.contains('yt-fs');
  ov.classList.toggle('yt-fs', on);
  _ytNP()?.setOrientation({ mode:on ? 'landscape' : 'auto' });
  setTimeout(_ytNPSync, 50); setTimeout(_ytNPSync, 600);
}
// 畫質：360／480／720／1080 輪流（之後每部都用這個上限；目前這部從現在的位置重新載入）
function ytQuality(){
  const hs = [360, 480, 720, 1080];
  const h = hs[(hs.indexOf(_ytMaxH()) + 1) % hs.length];
  try{ localStorage.setItem('yt_maxh', String(h)); }catch(_){}
  toast('畫質上限 ' + h + 'p');
  if(_YT.player && _YT.player.np){
    _ytNP().open({ items:_ytNPItems(), index:_YT.qi, start:_YT.npPos || 0, maxHeight:h, rate:_YT.rate, loop:_YT.loop, rect:_ytNPRect(), autoplay:_ytAuto(), ..._ytSbNative() });
  }
  _ytRenderPlayerInfo();
}
// 背景播放時的迷你播放列（任何頁面都看得到；點一下回到播放畫面）
function _ytMiniRender(){
  let bar = document.getElementById('yt-mini');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'yt-mini';
    bar.className = 'yt-mini';
    document.body.appendChild(bar);
  }
  const it = _YT.cur || {};
  bar.innerHTML = `
    <img src="${_ytThumb(it.ytId || '')}" alt="" onclick="ytReopen()" onerror="this.style.visibility='hidden'">
    <div class="yt-mini-t" onclick="ytReopen()"><div class="yt-t">${esc(it.title || '')}</div><div class="yt-ch" id="yt-mini-s">背景播放中</div></div>
    <button onclick="_ytNP().control({cmd:'toggle'})" id="yt-mini-pp" aria-label="播放／暫停">⏸</button>
    <button onclick="_ytNP().control({cmd:'next'})" aria-label="下一部">⏭</button>
    <button onclick="ytStopBg()" aria-label="停止">✕</button>`;
}
function _ytMiniUpdate(){
  const bar = document.getElementById('yt-mini'); if(!bar) return;
  const it = _YT.cur || {};
  const t = bar.querySelector('.yt-mini-t .yt-t'); if(t && t.textContent !== (it.title || '')) _ytMiniRender();
  const pp = document.getElementById('yt-mini-pp'); if(pp) pp.textContent = _YT.npPlaying ? '⏸' : '▶';
  const st = document.getElementById('yt-mini-s');
  const L = _YT.subs && _YT.subs.lyrics && _YT.subs.ytId === it.ytId ? _YT.subs.ca : null;
  const line = L ? (L.filter(c => c.s <= (_YT.npPos || 0)).pop() || {}).t : '';
  if(st) st.textContent = line ? '♪ ' + line : (_YT.npPlaying ? '背景播放中' : '已暫停') + (_YT.npDur ? '・' + _fmtDur(Math.floor(_YT.npPos)) + '／' + _fmtDur(Math.floor(_YT.npDur)) : '');
}
function _ytMiniRemove(){ document.getElementById('yt-mini')?.remove(); }
function ytReopen(){
  if(!_YT.npOpen) { _ytMiniRemove(); _ytFloatRemove(); return; }
  _YT.bg = false; _ytMiniRemove(); _ytFloatRemove(); _ytNPLast = '';
  _ytEnsureOverlay();
  _ytNPPoster(_YT.cur);
  _ytRenderPlayerInfo();
  _ytNPObs(true);
  _ytNPSync();
}
async function ytStopBg(){
  await _ytSavePos();
  try{ _ytNP().stop(); }catch(_){}
  _YT.player = null; _YT.npOpen = false; _YT.bg = false; _YT.cur = null; _YT.subs = null;
  _ytNPObs(false);
  _ytMiniRemove();
  _ytFloatRemove();
  _ytNPLast = '';
}
// 系統列（狀態列、手勢列）底色跟著主題
function _ytBars(){
  const N = _ytN(); if(!N || !N.setBars) return;
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg0').trim() || '#0a0a0a';
  const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v; const hex = c.fillStyle;   // 轉成 #rrggbb
  const n = parseInt(String(hex).slice(1), 16);
  const lum = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  N.setBars({ color:/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#0a0a0a', dark:lum < 140 }).catch(()=>{});
}
if(_ytN()){
  setTimeout(_ytBars, 300);
  new MutationObserver(() => setTimeout(_ytBars, 50)).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme', 'class', 'style'] });
}

// ════════════════════════════════════════════════════════════
// 【播完自動接相關影片】（App 版）清單最後一部播完，原生端從「相關影片」挑一部沒看過的接著播
// ════════════════════════════════════════════════════════════
function _ytAuto(){ try{ return localStorage.getItem('yt_auto') !== '0'; }catch(_){ return true; } }
function ytAutoToggle(){
  const on = !_ytAuto();
  try{ localStorage.setItem('yt_auto', on ? '1' : '0'); }catch(_){}
  _ytNP()?.control({ cmd:'autoplay', autoplay:on });
  toast(on ? '清單播完會自動接相關影片' : '清單播完就停止');
  _ytRenderPlayerInfo();
}
// 播放畫面點頻道名稱：影片播放中就縮成小視窗，再開頻道頁
async function ytCurChannel(){
  const it = _YT.cur; if(!it) return;
  let u = it.chUrl;
  if(!u){ try{ u = it.chUrl = (await _ytInfo(it.ytId)).uploaderUrl; }catch(e){ toast(e.message || '找不到頻道'); return; } }
  if(!u){ toast('找不到這部影片的頻道'); return; }
  if(_YT.npOpen && _YT.npPlaying && it.type !== 'audio') ytFloat();
  else await closeYtPlayer(_YT.npPlaying ? true : undefined);
  if(!document.getElementById('yt-search-ov')) await openYtSearch();
  _ytChannelPage(u, it.ytChannel);
}
// 影片資訊（字幕清單、頻道網址）：同一部只查一次
function _ytInfo(ytId){
  if(_YT.info.has(ytId)) return _YT.info.get(ytId);
  const p = _ytN().info({ url:_ytWatch(ytId) });
  _YT.info.set(ytId, p);
  p.catch(() => _YT.info.delete(ytId));
  if(_YT.info.size > 40) _YT.info.delete(_YT.info.keys().next().value);
  return p;
}

// ════════════════════════════════════════════════════════════
// 【浮動小視窗】（App 版）影片縮成可拖曳的小視窗，邊看邊用平台其他功能（做題、看書）
//   原生畫面跟著 #yt-float .ytf-v 的位置；點畫面＝播放／暫停，⤢ 回到完整播放畫面
// ════════════════════════════════════════════════════════════
const _YTF_W = [0.46, 0.62, 0.86];   // 寬度（佔螢幕寬）：小、中、大
function _ytFPos(){ try{ return { x:null, y:null, s:1, ...JSON.parse(localStorage.getItem('yt_fpos') || '{}') }; }catch(_){ return { x:null, y:null, s:1 }; } }
function ytFloat(){
  if(!_YT.npOpen){ toast('小視窗只在 App 版可用'); return; }
  const ov = document.getElementById('yt-player-ov');
  if(ov && ov.classList.contains('yt-fs')){ ov.classList.remove('yt-fs'); _ytNP()?.setOrientation({ mode:'auto' }); }
  document.getElementById('yt-menu-ov')?.remove();
  ov?.remove();
  _YT.float = true; _YT.bg = false; _ytMiniRemove();
  _ytFloatRender();
  _ytNPObs(true);
  _ytNPSync();
  if(S.page === 'media' && !document.getElementById('yt-search-ov')) _renderMediaPage();
}
function _ytFloatPlace(f){
  const p = _ytFPos(), vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.round(Math.min(vw - 16, Math.max(180, vw * _YTF_W[p.s % _YTF_W.length])));
  f.style.width = w + 'px';
  const h = f.offsetHeight || Math.round(w * 9 / 16) + 36;
  const x = p.x == null ? vw - w - 8 : Math.min(Math.max(4, p.x), vw - w - 4);
  const y = p.y == null ? vh - h - 72 : Math.min(Math.max(4, p.y), vh - h - 4);
  f.style.left = x + 'px'; f.style.top = y + 'px';
}
function _ytFloatRender(){
  let f = document.getElementById('yt-float');
  if(!f){
    f = document.createElement('div');
    f.id = 'yt-float';
    f.className = 'yt-float';
    document.body.appendChild(f);
    _ytFloatDrag(f);
    window.addEventListener('resize', _ytFloatResize);
  }
  const it = _YT.cur || {};
  f.innerHTML = `
    <div class="ytf-v" onclick="_ytFloatTap()">${it.type === 'audio' ? `<img src="${_ytThumb(it.ytId || '').replace('mqdefault', 'hqdefault')}" alt="">` : ''}</div>
    <div class="ytf-bar">
      <span class="ytf-grip" aria-hidden="true">⠿</span>
      <span class="ytf-t">${esc(it.title || '')}</span>
      <button onclick="_ytNP().control({cmd:'toggle'})" id="ytf-pp" aria-label="播放／暫停">${_YT.npPlaying ? '⏸' : '▶'}</button>
      <button onclick="_ytNP().control({cmd:'next'})" aria-label="下一部">⏭</button>
      <button onclick="ytFloatSize()" aria-label="調整大小">⇲</button>
      <button onclick="ytReopen()" aria-label="回到播放畫面">⤢</button>
      <button onclick="ytStopBg()" aria-label="關閉">✕</button>
    </div>`;
  _ytFloatPlace(f);
}
function _ytFloatResize(){ const f = document.getElementById('yt-float'); if(f){ _ytFloatPlace(f); _ytNPSync(); } }
function _ytFloatUpdate(){
  const f = document.getElementById('yt-float'); if(!f) return;
  const t = f.querySelector('.ytf-t'); if(t && t.textContent !== (_YT.cur?.title || '')) { _ytFloatRender(); _ytNPSync(); return; }
  const pp = document.getElementById('ytf-pp'); if(pp) pp.textContent = _YT.npPlaying ? '⏸' : '▶';
}
function _ytFloatTap(){ if(Date.now() - (_YT.fDragEnd || 0) > 300) _ytNP()?.control({ cmd:'toggle' }); }
function ytFloatSize(){
  const p = _ytFPos(); p.s = ((p.s || 0) + 1) % _YTF_W.length;
  try{ localStorage.setItem('yt_fpos', JSON.stringify(p)); }catch(_){}
  const f = document.getElementById('yt-float'); if(f){ _ytFloatPlace(f); _ytNPSync(); }
}
// 拖曳（整個小視窗都能拖；按鈕照常點）
function _ytFloatDrag(f){
  let st = null;
  f.addEventListener('pointerdown', e => {
    if(e.target.closest('button')) return;
    const r = f.getBoundingClientRect();
    st = { id:e.pointerId, dx:e.clientX - r.left, dy:e.clientY - r.top, x0:e.clientX, y0:e.clientY, moved:false };
  });
  f.addEventListener('pointermove', e => {
    if(!st || e.pointerId !== st.id) return;
    if(!st.moved && Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < 6) return;
    if(!st.moved){ st.moved = true; try{ f.setPointerCapture(e.pointerId); }catch(_){} }
    e.preventDefault();
    const w = f.offsetWidth, h = f.offsetHeight;
    f.style.left = Math.min(Math.max(4, e.clientX - st.dx), window.innerWidth - w - 4) + 'px';
    f.style.top = Math.min(Math.max(4, e.clientY - st.dy), window.innerHeight - h - 4) + 'px';
    _ytNPSync();
  });
  const end = e => {
    if(!st || e.pointerId !== st.id) return;
    if(st.moved){
      _YT.fDragEnd = Date.now();
      const p = _ytFPos(); p.x = parseFloat(f.style.left); p.y = parseFloat(f.style.top);
      try{ localStorage.setItem('yt_fpos', JSON.stringify(p)); }catch(_){}
    }
    st = null;
  };
  f.addEventListener('pointerup', end);
  f.addEventListener('pointercancel', end);
}
function _ytFloatRemove(){
  _YT.float = false;
  document.getElementById('yt-float')?.remove();
  window.removeEventListener('resize', _ytFloatResize);
}

// ════════════════════════════════════════════════════════════
// 【字幕】（App 版）原文＋第二語言（沒有就用 YouTube 自動翻譯）同時顯示在畫面上；下方逐字稿點一句跳過去；可下載 .srt
//   設定存在這台的 localStorage yt_subp：{on, a:主要, b:第二, xl:自動翻譯, list:逐字稿}
// ════════════════════════════════════════════════════════════
const _YT_SUBL = { orig:'原文（影片的語言）', en:'英文', 'zh-Hant':'中文（繁體）', ja:'日文', ko:'韓文' };
function _ytSubPref(){
  const d = { on:false, a:'orig', b:'zh-Hant', xl:false, list:true };
  try{ return { ...d, ...JSON.parse(localStorage.getItem('yt_subp') || '{}') }; }catch(_){ return d; }
}
function _ytSubPick(list, want){
  if(!want) return null;
  const base = l => String(l || '').split('-')[0].toLowerCase();
  const man = list.filter(t => !t.auto), auto = list.filter(t => t.auto);
  if(want === 'orig'){
    // 影片說的語言：同時有人工字幕和自動字幕的那種（YouTube 也把機器翻譯的字幕標成自動，不能只看第一個自動字幕）
    const autoL = new Set(auto.map(t => base(t.lang)));
    const both = man.find(t => autoL.has(base(t.lang)));
    if(both) return both;
    if(auto.length === 1 && !man.length) return auto[0];
    const pref = L => L.find(t => base(t.lang) === 'en') || L.find(t => base(t.lang) === 'zh');
    return pref(man) || man[0] || pref(auto) || auto[0] || null;
  }
  const m = want === 'zh-Hant' ? (t => /^zh[-_](TW|Hant|HK|MO)/i.test(t.lang)) : (t => base(t.lang) === base(want));
  const r = man.find(m) || auto.find(m);
  if(r || want !== 'zh-Hant') return r || null;
  return man.find(t => base(t.lang) === 'zh') || auto.find(t => base(t.lang) === 'zh') || null;   // 沒有繁體就用簡體
}
function _ytSubParse(text, fmt){
  let out = [];
  if(/<transcript[\s>]/.test(text) || fmt === 'srv1'){
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    for(const n of doc.getElementsByTagName('text')){
      const s = +n.getAttribute('start') || 0, d = +n.getAttribute('dur') || 2;
      const t = _ytTxt(n.textContent || '').replace(/\s+/g, ' ').trim();
      if(t) out.push({ s, e:s + d, t });
    }
  } else {   // WebVTT
    const tm = x => { const p = x.trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
    for(const blk of text.replace(/\r/g, '').split(/\n\n+/)){
      const lines = blk.split('\n'), k = lines.findIndex(l => l.includes('-->'));
      if(k < 0) continue;
      const [a, b] = lines[k].split('-->');
      const t = lines.slice(k + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if(t) out.push({ s:tm(a), e:tm(b.trim().split(/\s/)[0]), t:_ytTxt(t) });
    }
    out = out.filter((c, i) => !(i && out[i - 1].t === c.t));   // 自動字幕的重複行
  }
  out.sort((a, b) => a.s - b.s);
  for(let i = 0; i < out.length - 1; i++) if(out[i].e > out[i + 1].s) out[i].e = Math.max(out[i].s + 0.3, out[i + 1].s);
  return out;
}
async function _ytSubFetch(t){ const r = await _ytN().fetchText({ url:t.url }); return _ytSubParse(r.text || '', t.fmt); }
// 依設定挑主要、第二字幕並下載：回傳 {a, b, ca, cb, list}
async function _ytSubGet(ytId, p){
  const info = await _ytInfo(ytId);
  const list = info.subs || [];
  const a = _ytSubPick(list, p.a);
  let b = p.b ? _ytSubPick(list, p.b) : null;
  if(b && a && b.url === a.url) b = null;
  if(p.b && !b && a && p.xl && String(a.lang).split('-')[0] !== String(p.b).split('-')[0])
    b = { ...a, url:a.url + '&tlang=' + encodeURIComponent(p.b), name:(_YT_SUBL[p.b] || p.b) + '（自動翻譯）', lang:p.b, tl:true };
  const [ca, cb] = await Promise.all([a ? _ytSubFetch(a) : [], b ? _ytSubFetch(b).catch(() => []) : []]);
  return { a, b:cb.length ? b : null, ca, cb, list, tlFail:!!(b && b.tl && !cb.length) };
}
async function _ytSubAuto(it){
  if(it && it.type === 'audio' && _ytLyrOn()){
    if(_YT.subs && _YT.subs.ytId === it.ytId && _YT.subs.lyrics) return;
    if(await _ytLyrLoad(it, null, true)) return;
  }
  if(!_ytNP() || !it) return;
  const p = _ytSubPref();
  if(_YT.subs && _YT.subs.ytId !== it.ytId) _YT.subs = null;
  if(!p.on || it._iframe){ _YT.subs = null; _ytNP().setCues({ ytId:'', cues:[] }).catch(()=>{}); _ytTrRender(); return; }
  if(_YT.subs && _YT.subs.ytId === it.ytId && !_YT.subs.lyrics) return;
  try{
    const r = await _ytSubGet(it.ytId, p);
    if(_YT.cur !== it) return;
    _YT.subs = { ytId:it.ytId, ...r };
    await _ytNP().setCues({ ytId:it.ytId, cues:[...r.ca.map(c => [c.s, c.e, 0, c.t]), ...r.cb.map(c => [c.s, c.e, 1, c.t])] });
    _ytTrRender();
    if(!r.a) toast('這部影片沒有字幕');
    else if(r.tlFail) toast('YouTube 這次沒有提供自動翻譯，只顯示' + (r.a.name || '原文'));
  }catch(e){ if(_YT.cur === it) toast('字幕讀取失敗：' + (e.message || e)); }
}
// 逐字稿：主要字幕一句一行，第二字幕放在下面；點一句跳到那裡
function _ytTrRender(){
  const el = document.getElementById('ytp-tr'); if(!el) return;
  const S2 = _YT.subs, p = _ytSubPref();
  const show = S2 && _YT.cur && S2.ytId === _YT.cur.ytId && (S2.lyrics ? (S2.ca.length || S2.plain) : (p.list && S2.ca.length));
  if(!show){ el.hidden = true; el.innerHTML = ''; _YT.trOn = -1; return; }
  if(S2.lyrics && !S2.ca.length){   // 只有不同步的歌詞：整段顯示
    el.innerHTML = `<div class="ytp-trh"><b>歌詞</b><span>${esc(S2.a?.name || '')}（沒有時間軸）</span><button class="yt-link" onclick="ytLyrics()">改找</button></div>
      <div class="ytp-trb ytp-plain">${esc(S2.plain).replace(/\n/g, '<br>')}</div>`;
    el.hidden = false; _YT.trOn = -1; return;
  }
  const lines = S2.ca.map(c => {
    const sub = S2.cb.filter(x => x.s >= c.s - 0.4 && x.s < c.e).map(x => x.t).join(' ');
    return `<div class="ytp-trl" data-s="${c.s}" onclick="ytSeek(${Math.floor(c.s)})"><span>${_ytTs(c.s)}</span><div>${esc(c.t)}${sub ? '<small>' + esc(sub) + '</small>' : ''}</div></div>`;
  });
  el.innerHTML = S2.lyrics
    ? `<div class="ytp-trh"><b>歌詞</b><span>${esc(S2.a?.name || '')}・LRCLIB</span><button class="yt-link" onclick="ytLyrics()">改找</button></div><div class="ytp-trb">${lines.join('')}</div>`
    : `<div class="ytp-trh"><b>逐字稿</b><span>${esc(S2.a?.name || '')}${S2.b ? '＋' + esc(S2.b.name || '') : ''}</span>
      <button class="yt-link" onclick="ytSubDownload()">⬇ 字幕</button></div><div class="ytp-trb">${lines.join('')}</div>`;
  el.hidden = false;
  _YT.trOn = -1;
  const b = el.querySelector('.ytp-trb');
  b.addEventListener('touchstart', () => { _YT.trTouch = Date.now(); }, { passive:true });
  b.addEventListener('wheel', () => { _YT.trTouch = Date.now(); }, { passive:true });
  _ytTrTick();
}
function _ytTrTick(){
  const S2 = _YT.subs; if(!S2 || !S2.ca.length) return;
  const box = document.querySelector('#ytp-tr .ytp-trb'); if(!box) return;
  const t = _YT.npPos || 0;
  let k = -1;
  for(let i = 0; i < S2.ca.length; i++){ if(S2.ca[i].s <= t) k = i; else break; }
  if(k === _YT.trOn) return;
  box.children[_YT.trOn]?.classList.remove('on');
  _YT.trOn = k;
  const ln = box.children[k]; if(!ln) return;
  ln.classList.add('on');
  if(Date.now() - (_YT.trTouch || 0) > 4000) box.scrollTop = ln.offsetTop - box.offsetTop - box.clientHeight / 3;
}
function _ytSrt(cues){
  const f = t => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms % 1000).padStart(3, '0'); };
  return cues.map((c, i) => (i + 1) + '\n' + f(c.s) + ' --> ' + f(c.e) + '\n' + c.t).join('\n\n') + '\n';
}
function _ytVtt(cues){ return 'WEBVTT\n\n' + _ytSrt(cues).replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2').replace(/^\d+\n(?=\d\d:)/gm, ''); }
const _ytFname = s => String(s || 'youtube').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
async function ytSubDownload(){
  const it = _YT.cur; if(!it || !_ytN()) return;
  try{
    let S2 = _YT.subs && _YT.subs.ytId === it.ytId ? _YT.subs : null;
    if(!S2){ toast('讀取字幕…'); S2 = await _ytSubGet(it.ytId, { ..._ytSubPref(), on:true }); }
    if(!S2.ca.length){ toast('這部影片沒有字幕'); return; }
    const files = [[S2.a, S2.ca], [S2.b, S2.cb]].filter(([t, c]) => t && c.length);
    for(const [t, c] of files) await _ytN().saveText({ name:_ytFname(it.title) + '.' + (t.tl ? t.lang : t.lang) + '.srt', text:_ytSrt(c), mime:'application/x-subrip' });
    toast('已存 ' + files.length + ' 個字幕檔到手機「下載／Y.C.」');
  }catch(e){ toast('下載字幕失敗：' + (e.message || e)); }
}
// 字幕設定
async function ytSubSheet(){
  const it = _YT.cur; if(!it) return;
  const p = _ytSubPref();
  document.getElementById('yt-sub-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'yt-sub-ov';
  ov.className = 'media-ov-sheet z700-d';
  const opt = (sel, none) => (none ? `<option value="">${none}</option>` : '') + Object.entries(_YT_SUBL).filter(([k]) => none ? k !== 'orig' : true)
    .map(([k, v]) => `<option value="${k}"${sel === k ? ' selected' : ''}>${v}</option>`).join('');
  ov.innerHTML = `<div class="yt-sheet yt-edit">
      <div class="yt-sheet-hd"><div class="yt-sheet-title">字幕</div>
        <button class="yt-x" onclick="document.getElementById('yt-sub-ov').remove()" aria-label="關閉">✕</button></div>
      <label class="ytd-chk"><input type="checkbox" id="yts-on"${p.on ? ' checked' : ''}> 顯示字幕（之後每部影片都會自動開）</label>
      <label class="yt-lb">主要字幕</label>
      <select id="yts-a" class="finput">${opt(p.a)}</select>
      <label class="yt-lb">第二字幕（顯示在主要字幕下面）</label>
      <select id="yts-b" class="finput">${opt(p.b, '不要')}</select>
      <label class="ytd-chk"><input type="checkbox" id="yts-xl"${p.xl ? ' checked' : ''}> 影片沒有第二字幕時，試著用 YouTube 自動翻譯（YouTube 常拒絕，不一定有）</label>
      <label class="ytd-chk"><input type="checkbox" id="yts-list"${p.list ? ' checked' : ''}> 播放畫面下方顯示逐字稿（點一句跳過去）</label>
      <div class="yt-lb">這部影片有的字幕</div>
      <div id="yts-have" class="yt-ch">讀取中…</div>
      <div class="yt-edit-btns">
        <button class="yt-btn" onclick="ytSubDownload()">⬇ 下載字幕（.srt）</button>
        <button class="yt-btn pri" onclick="_ytSubApply()">套用</button>
      </div>
    </div>`;
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
  try{
    const info = await _ytInfo(it.ytId);
    const el = document.getElementById('yts-have');
    if(el) el.textContent = (info.subs || []).map(t => t.name + (t.auto ? '（自動產生）' : '')).join('、') || '沒有字幕';
  }catch(e){ const el = document.getElementById('yts-have'); if(el) el.textContent = '✗ ' + (e.message || e); }
}
function _ytSubApply(){
  const p = { on:document.getElementById('yts-on').checked, a:document.getElementById('yts-a').value, b:document.getElementById('yts-b').value,
    xl:document.getElementById('yts-xl').checked, list:document.getElementById('yts-list').checked };
  try{ localStorage.setItem('yt_subp', JSON.stringify(p)); }catch(_){}
  document.getElementById('yt-sub-ov')?.remove();
  _YT.subs = null;
  _ytSubAuto(_YT.cur);
  _ytRenderPlayerInfo();
}
// 下載到影音庫時一併存字幕（離線播放可顯示）：回傳 [{lang, label, vtt}]
async function _ytSubForSave(ytId){
  const r = await _ytSubGet(ytId, { ..._ytSubPref(), on:true });
  return [[r.a, r.ca], [r.b, r.cb]].filter(([t, c]) => t && c.length).map(([t, c]) => ({ lang:t.lang, label:t.name || t.lang, vtt:_ytVtt(c) }));
}

// ════════════════════════════════════════════════════════════
// 【SponsorBlock 跳過片段】（v4.56）社群標記的業配、自我宣傳、訂閱提醒、開場、片尾等，播到就自動跳過
//   App 版在原生播放器裡跳（關螢幕也會跳）；瀏覽器版官方播放器、下載到影音庫的檔案在網頁裡跳
//   只送影片編號雜湊的前 4 碼給 sponsor.ajay.app（不會知道你在看哪一部）
//   設定存在這台的 localStorage yt_sb：{on, cats:[...]}
// ════════════════════════════════════════════════════════════
const _YT_SBC = [
  ['sponsor', '業配（付費宣傳）', true], ['selfpromo', '自我宣傳（自家商品、贊助會員）', true],
  ['interaction', '要你訂閱、按讚的提醒', true], ['music_offtopic', '音樂影片裡的非音樂片段', true],
  ['intro', '開場動畫', false], ['outro', '片尾、結尾畫面', false], ['preview', '預告、回顧', false], ['filler', '離題閒聊', false],
];
// 時間點（0 秒也顯示 0:00）
const _ytTs = t => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = String(t % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; };
const _ytSbName = c => (_YT_SBC.find(x => x[0] === c) || [c, c])[1].replace(/（.*$/, '');
function _ytSbPref(){
  const d = { on:true, cats:_YT_SBC.filter(x => x[2]).map(x => x[0]) };
  try{ const v = JSON.parse(localStorage.getItem('yt_sb') || 'null'); return v && Array.isArray(v.cats) ? { ...d, ...v } : d; }catch(_){ return d; }
}
function _ytSbNative(){ const p = _ytSbPref(); return { sb:!!(p.on && p.cats.length), sbCats:JSON.stringify(p.cats) }; }
async function _ytSbFetch(ytId){
  const p = _ytSbPref();
  if(!p.on || !p.cats.length || !ytId) return [];
  try{
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ytId));
    const pre = [...new Uint8Array(buf).slice(0, 2)].map(b => b.toString(16).padStart(2, '0')).join('');
    const u = 'https://sponsor.ajay.app/api/skipSegments/' + pre + '?categories=' + encodeURIComponent(JSON.stringify(p.cats)) + '&actionTypes=' + encodeURIComponent('["skip"]');
    let txt;
    if(_ytN()){ try{ txt = (await _ytN().fetchText({ url:u })).text; }catch(e){ return []; } }
    else { const r = await fetch(u, { cache:'no-store' }); if(!r.ok) return []; txt = await r.text(); }
    const v = (JSON.parse(txt) || []).find(x => x.videoID === ytId);
    return (v?.segments || []).filter(s => Array.isArray(s.segment) && s.segment[1] - s.segment[0] >= 1)
      .map(s => ({ start:s.segment[0], end:s.segment[1], cat:s.category }));
  }catch(e){ return []; }
}
function _ytSbToast(s){ toast('已跳過' + _ytSbName(s.cat) + '（' + _ytTs(s.start) + '～' + _ytTs(s.end) + '）'); }
// 網頁裡的播放器（官方 IFrame、影音庫的 <video>／<audio>）：每半秒看一次位置
function _ytSbWatch(getT, seek, segs, isLive){
  const done = new Set();
  const t = setInterval(() => {
    if(!isLive()){ clearInterval(t); return; }
    let now; try{ now = getT(); }catch(_){ return; }
    segs.forEach((s, i) => {
      if(now >= s.start && now < s.end - 0.5 && !done.has(i)){ done.add(i); seek(s.end); _ytSbToast(s); }
      else if(now < s.start - 2) done.delete(i);
    });
  }, 500);
  return t;
}
// 影音庫裡從 YouTube 下載的檔案（media.js 播放時呼叫）
async function ytSbAttach(el, ytId){
  if(!el || !ytId) return;
  const segs = await _ytSbFetch(ytId);
  if(!segs.length) return;
  const src0 = el.getAttribute('src') || '';   // 同一個播放器換下一首時停止（不拿上一首的片段跳）
  _ytSbWatch(() => el.currentTime, s => { el.currentTime = s; }, segs, () => el.isConnected && (el.getAttribute('src') || '') === src0 && !!src0);
}
// 官方 IFrame 播放器（瀏覽器版）
async function _ytSbIframe(it){
  clearInterval(_YT.sbT);
  const segs = await _ytSbFetch(it.ytId);
  _YT.sbSegs = { ytId:it.ytId, segs };
  _ytRenderSbLine();
  if(!segs.length || _YT.cur !== it) return;
  _YT.sbT = _ytSbWatch(() => _YT.player.getCurrentTime(), s => _YT.player.seekTo(s, true), segs,
    () => _YT.cur === it && !!_YT.player && !_YT.player.np);
}
function _ytRenderSbLine(){
  const el = document.getElementById('ytp-sb'); if(!el) return;
  const S2 = _YT.sbSegs, it = _YT.cur;
  if(!S2 || !it || S2.ytId !== it.ytId || !S2.segs.length){ el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '⏭ 會自動跳過：' + S2.segs.map(s => esc(_ytSbName(s.cat)) + ' ' + _ytTs(s.start) + '～' + _ytTs(s.end)).join('、');
}
function ytSbSheet(){
  const p = _ytSbPref();
  document.getElementById('yt-sbs-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'yt-sbs-ov';
  ov.className = 'media-ov-sheet z700-d';
  ov.innerHTML = `<div class="yt-sheet yt-edit">
      <div class="yt-sheet-hd"><div class="yt-sheet-title">自動跳過片段（SponsorBlock）</div>
        <button class="yt-x" onclick="document.getElementById('yt-sbs-ov').remove()" aria-label="關閉">✕</button></div>
      <div class="yt-ch" style="line-height:1.7">由觀眾社群標記片段，播到就自動跳過。只送出影片編號雜湊的前 4 碼，SponsorBlock 不會知道你在看哪一部。</div>
      <label class="ytd-chk"><input type="checkbox" id="ytsb-on"${p.on ? ' checked' : ''}> 開啟自動跳過</label>
      <div class="yt-lb">要跳過的片段</div>
      ${_YT_SBC.map(([k, n]) => `<label class="ytd-chk" style="margin-top:6px"><input type="checkbox" data-sb="${k}"${p.cats.includes(k) ? ' checked' : ''}> ${esc(n)}</label>`).join('')}
      <div class="yt-edit-btns"><button class="yt-btn pri" onclick="_ytSbApply()">儲存</button></div>
    </div>`;
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
}
function _ytSbApply(){
  const p = { on:document.getElementById('ytsb-on').checked, cats:[...document.querySelectorAll('#yt-sbs-ov [data-sb]')].filter(x => x.checked).map(x => x.dataset.sb) };
  try{ localStorage.setItem('yt_sb', JSON.stringify(p)); }catch(_){}
  document.getElementById('yt-sbs-ov')?.remove();
  if(_ytNP() && _YT.npOpen) _ytNP().control({ cmd:'sb', ..._ytSbNative() });
  toast(p.on && p.cats.length ? '已開啟自動跳過（下一部開始套用）' : '已關閉自動跳過');
}

// ════════════════════════════════════════════════════════════
// 【同步歌詞】（v4.56）LRCLIB 免費歌詞庫：音樂播放時一句一句跟著亮，影片上也顯示；點一句跳過去
//   用標題、頻道猜歌名和歌手，挑長度最接近的；找不到可以自己改關鍵字再找
// ════════════════════════════════════════════════════════════
function _ytLyrOn(){ try{ return localStorage.getItem('yt_lyr') !== '0'; }catch(_){ return true; } }
// 從 YouTube 標題整理出歌名、歌手
//   「周杰倫 Jay Chou【晴天 Sunny Day】Official MV」：括號（【】《》「」『』）裡是歌名、前面是歌手
//   「Queen – Bohemian Rhapsody (Official Video)」：破折號前歌手、後歌名
const _ytLyrJunk = /\b(official\s+(music\s+)?video|official\s+audio|official|lyric\s+video|lyrics?|music\s+video|mv|m\/v|4k|hd|hq|remastered|visualizer|audio|video)\b/ig;
function _ytSongGuess(it){
  const raw = String(it.title || '');
  const ch = String(it.ytChannel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*(官方頻道|Official)$/i, '').trim();
  const clean = x => String(x || '').replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ' ').replace(_ytLyrJunk, ' ')
    .replace(/(官方|完整版|高音質|動態歌詞|歌詞版|字幕版)\S*/g, ' ').replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim();
  const br = raw.match(/[【《「『]([^】》」』]+)[】》」』]/);
  if(br && !/^(mv|official|官方|歌詞|動態歌詞|lyrics?)/i.test(br[1].trim())){
    const track = clean(br[1]);
    const artist = clean(raw.slice(0, br.index)) || ch;
    return { artist, track, q:(track + ' ' + artist).trim() };
  }
  const t = clean(raw.replace(/【[^】]*】/g, ' '));
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if(m) return { artist:m[1].trim(), track:m[2].replace(/\s+[-–—].*$/, '').trim(), q:t };
  return { artist:ch, track:t, q:(t + ' ' + ch).trim() };
}
// 歌名的幾種寫法：整個、中文部分、英文部分（「晴天 Sunny Day」→ 晴天、Sunny Day）
function _ytTrackKeys(track){
  const n = x => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const cjk = (track.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || []).join('');
  const lat = track.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu, ' ').trim();
  return [...new Set([n(cjk), n(lat), n(track)].filter(x => x.length >= 2))];
}
function _ytTrackMatch(name, keys){
  const v = String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return keys.some(k => v.includes(k) || (v.length >= 2 && k.includes(v)));
}
async function _ytLrcGet(url){
  if(_ytN()) return JSON.parse((await _ytN().fetchText({ url })).text || '[]');
  const r = await fetch(url, { cache:'no-store' });
  if(!r.ok) throw new Error('歌詞庫回應 ' + r.status);
  return r.json();
}
async function _ytLyrFind(it, q){
  const g = _ytSongGuess(it), dur = it.duration || _YT.npDur || 0, keys = _ytTrackKeys(g.track);
  const cjk = (g.track.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s]*/gu) || [''])[0].trim();
  const S = 'https://lrclib.net/api/search?';
  const tries = q ? [S + 'q=' + encodeURIComponent(q)] : [
    ...(g.artist && g.track ? [S + 'track_name=' + encodeURIComponent(g.track) + '&artist_name=' + encodeURIComponent(g.artist)] : []),
    ...(cjk && cjk !== g.track ? [S + 'q=' + encodeURIComponent(cjk + ' ' + g.artist)] : []),
    S + 'q=' + encodeURIComponent(g.q),
    ...(cjk ? [S + 'track_name=' + encodeURIComponent(cjk)] : []),
  ];
  for(const u of tries){
    let list = [];
    try{ list = await _ytLrcGet(u); }catch(e){ continue; }
    list = (list || []).filter(x => !x.instrumental && (x.syncedLyrics || x.plainLyrics));
    if(!q && keys.length) list = list.filter(x => _ytTrackMatch(x.trackName, keys));   // 歌名要對得上，不然可能是同歌手別首
    if(!list.length) continue;
    const score = x => (x.syncedLyrics ? 0 : 1000) + (dur && x.duration ? Math.abs(x.duration - dur) : 30);
    list.sort((a, b) => score(a) - score(b));
    const best = list[0];
    if(!q && dur && best.duration && Math.abs(best.duration - dur) > 25) continue;   // 長度差太多：大概不是這個版本
    return best;
  }
  return null;
}
function _ytLrcParse(lrc){
  const out = [];
  for(const line of String(lrc || '').split(/\r?\n/)){
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if(!tags.length) continue;
    const t = line.replace(/\[[^\]]*\]/g, '').trim();
    for(const m of tags) out.push({ s:+m[1] * 60 + +m[2], t });
  }
  out.sort((a, b) => a.s - b.s);
  const cues = [];
  out.forEach((c, i) => { if(c.t) cues.push({ s:c.s, e:out[i + 1] ? out[i + 1].s : c.s + 6, t:c.t }); });
  return cues;
}
// 載入歌詞（取代這部的字幕顯示）
async function _ytLyrLoad(it, q, quiet){
  try{
    const r = await _ytLyrFind(it, q);
    if(_YT.cur !== it) return false;
    if(!r){ if(!quiet) toast('歌詞庫找不到這首，可以按「♪ 歌詞」改關鍵字再找'); return false; }
    const ca = r.syncedLyrics ? _ytLrcParse(r.syncedLyrics) : [];
    _YT.subs = { ytId:it.ytId, lyrics:true, a:{ name:(r.artistName ? r.artistName + '－' : '') + (r.trackName || '') }, b:null,
      ca, cb:[], plain:ca.length ? '' : (r.plainLyrics || '') };
    if(_ytNP()) await _ytNP().setCues({ ytId:it.ytId, cues:ca.map(c => [c.s, c.e, 0, c.t]) });
    _ytRenderPlayerInfo();   // 「♪ 歌詞」按鈕亮起、面板換成歌詞
    return true;
  }catch(e){ if(!quiet) toast('歌詞讀取失敗：' + (e.message || e)); return false; }
}
async function ytLyrics(){
  const it = _YT.cur; if(!it) return;
  const g = _ytSongGuess(it);
  const q = await askInput?.('找歌詞（LRCLIB）', '歌名、歌手（可自己修改）', (g.artist && g.track ? g.track + ' ' + g.artist : g.q));
  if(q == null) return;
  toast('找歌詞中…');
  if(await _ytLyrLoad(it, String(q).trim())) toast('已載入歌詞');
}
function ytLyrToggle(){
  const on = !_ytLyrOn();
  try{ localStorage.setItem('yt_lyr', on ? '1' : '0'); }catch(_){}
  toast(on ? '音樂會自動找歌詞' : '音樂不自動找歌詞');
  _ytRenderPlayerInfo();
}

// ════════════════════════════════════════════════════════════
// 【設定：金鑰】
// ════════════════════════════════════════════════════════════
async function saveYtKey(value){
  const v = String(value || '').trim();
  await setSetting(YT_KEY, v);
  if(v.length > 20) toast('YouTube 金鑰已儲存');
}
async function _renderYtKey(){
  const el = document.getElementById('yt-key');
  if(!el) return;
  // App 版搜尋不需要金鑰：這張設定卡藏起來
  if(_ytN()){ for(const id of ['yt-key-sec', 'yt-key-card']){ const x = document.getElementById(id); if(x) x.style.display = 'none'; } return; }
  const key = await getSetting(YT_KEY, '').catch(()=>'');
  if(key) el.value = key;
  const u = document.getElementById('yt-usage');
  if(u) u.textContent = key ? await _ytQuotaText() : '';
}
function ytGoKey(){
  document.getElementById('yt-search-ov')?.remove();
  goPage('set', null);
  setTimeout(() => document.getElementById('yt-key')?.scrollIntoView({ block:'center' }), 300);
}
async function ytTestKey(){
  const u = document.getElementById('yt-usage');
  if(u) u.textContent = '測試中…';
  try{
    await _ytApi('videos', { part:'id', id:'jNQXAC9IVRw' }, 1);   // YouTube 第一部影片，查一次 1 單位
    if(u) u.textContent = '✓ 金鑰可以用。' + await _ytQuotaText();
  }catch(e){ if(u) u.textContent = '✗ ' + e.message; }
}
