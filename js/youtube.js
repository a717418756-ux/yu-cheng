// ══ youtube.js — 影音庫的 YouTube（v4.53.0）═══════════════════
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
const _ytThumb = id => 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
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
        <form class="yt-sbar" onsubmit="event.preventDefault();ytDoSearch()">
          <input id="yt-q" type="search" enterkeyhint="search" autocomplete="off"
            placeholder="${hasKey ? '搜尋影片，或貼上影片／播放清單網址' : '貼上影片或播放清單網址'}" value="${esc(kw || _YT.q || '')}">
          <button type="submit" class="yt-go">搜尋</button>
        </form>
        <div id="yt-hint" class="yt-hint">${native ? 'App 版：搜尋不需要金鑰，播放沒有廣告；按 ⬇ 可下載到影音庫離線看。' : hasKey ? '' : `沒有金鑰也能貼網址播放；要在 App 內搜尋，請到設定填「YouTube 搜尋金鑰」。
          <button class="yt-link" onclick="ytGoKey()">前往設定 ›</button>`}</div>
        <div id="yt-results" class="yt-results"></div>
      </div>`;
    ov.onclick = e => { if(e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
    if(hasKey && !native) _ytQuotaText().then(t => { const h = document.getElementById('yt-hint'); if(h && !h.textContent.trim()) h.textContent = t; });
    if(kw) ytDoSearch();
    else if(_YT.items.length) _ytRenderResults();
    else setTimeout(()=>document.getElementById('yt-q')?.focus(), 200);
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
      if(!more){ _YT.items = []; _YT.next = ''; _YT.q = q; _YT.mode = 'search'; }
      const r = more ? await _ytN().more() : await _ytN().search({ query:_YT.q });
      _YT.next = r.hasMore ? 'native' : '';
      const have = new Set(_YT.items.map(x => x.ytId));
      for(const x of r.items || []){
        const id = _ytId(x.url);
        if(!id || have.has(id) || x.live) continue;   // 直播不列（不能下載，也沒有固定長度）
        have.add(id);
        _YT.items.push({ ytId:id, title:x.title || id, ytChannel:x.channel || '', duration:x.duration > 0 ? x.duration : 0, embeddable:true });
      }
    } else {
      if(!more){ _YT.items = []; _YT.next = ''; _YT.q = q; _YT.mode = 'search'; }
      const j = await _ytApi('search', { part:'snippet', type:'video', videoEmbeddable:'true', maxResults:20,
        q:_YT.q, regionCode:'TW', relevanceLanguage:'zh-Hant', ...(more && _YT.next ? { pageToken:_YT.next } : {}) }, 100);
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

function _ytRenderResults(){
  const box = document.getElementById('yt-results');
  if(!box) return;
  if(!_YT.items.length){ box.innerHTML = '<div class="yt-empty">沒有找到可以在 App 內播放的影片</div>'; return; }
  const head = _YT.mode === 'playlist'
    ? `<div class="yt-plhead"><div>播放清單${_YT.plTitle ? '「' + esc(_YT.plTitle) + '」' : ''}・${_YT.items.length} 部${_YT.items.some(x => !x.embeddable) ? '（有些上傳者不允許嵌入，只能到 YouTube 看）' : ''}</div>
        <button class="yt-btn" onclick="ytSaveAll()">全部收進影音庫</button></div>` : '';
  box.innerHTML = head + _YT.items.map((it, i) => {
    const saved = _YT.lib.has(it.ytId);
    return `<div class="yt-row${it.embeddable ? '' : ' off'}">
      <div class="yt-thumb" onclick="ytPlayResults(${i})">
        <img loading="lazy" src="${_ytThumb(it.ytId)}" alt="" onerror="this.remove()">
        ${it.duration ? `<span class="yt-dur">${_fmtDur(it.duration)}</span>` : ''}
      </div>
      <div class="yt-info" onclick="ytPlayResults(${i})">
        <div class="yt-t">${esc(it.title)}</div>
        <div class="yt-ch">${esc(it.ytChannel || '')}${it.embeddable ? '' : '・不能在 App 內播放'}${_YT.dl.has(it.ytId) ? '・<b class="yt-dl-ok">已下載</b>' : ''}</div>
      </div>
      ${_ytN() ? `<button class="yt-add" onclick="ytDownload(${i})" title="下載到影音庫" aria-label="下載到影音庫">⬇</button>` : ''}
      <button class="yt-add${saved ? ' on' : ''}" onclick="ytSaveResult(${i})" title="${saved ? '已在影音庫（點一下編輯）' : '收進影音庫'}" aria-label="${saved ? '編輯' : '收進影音庫'}">${saved ? '✓' : '＋'}</button>
    </div>`;
  }).join('') + (_YT.mode === 'search' && _YT.next ? '<button class="yt-more" onclick="ytDoSearch(true)">' + (_ytN() ? '載入更多' : '載入更多（再用 100 額度）') + '</button>' : '');
}

function ytPlayResults(i){
  const it = _YT.items[i];
  if(!it) return;
  if(!it.embeddable){ window.open(_ytWatch(it.ytId), '_blank', 'noopener'); return; }
  // 已收進影音庫的用影音庫那一筆（記得看到哪裡）
  const q = _YT.items.filter(x => x.embeddable).map(x => _YT.lib.get(x.ytId) || { ...x });
  _ytOpenPlayer(q, q.findIndex(x => x.ytId === it.ytId));
}

// ════════════════════════════════════════════════════════════
// 【收進影音庫／編輯】
// ════════════════════════════════════════════════════════════
function _ytCats(){ return [...new Set((_M.allMedia || []).map(m => m.category || '').filter(Boolean))]; }
async function ytSaveResult(i){
  const it = _YT.items[i]; if(!it) return;
  const ex = _YT.lib.get(it.ytId);
  _ytEditSheet(ex ? await dg('leisuremedia', ex.id) : { ...it, type:'video', category:'', note:'' });
}
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
  _YT.bg = false; _ytMiniRemove();
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
function ytDownload(i){ const it = _YT.items[i]; if(it) _ytDlSheet(it); }
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
    await dp('leisuremedia', {
      title, type:kind === 'audio' ? 'audio' : 'video', category,
      fileType:pick.ext, mimeType:pick.mime, fileSize:blob.size, blob, thumbnail,
      duration:info.duration > 0 ? info.duration : (it.duration || null),
      tags:[], favorite:false, lastPlay:null, lastPos:0, playCount:0, createdAt:Date.now(),
      ytSrc:it.ytId, ytChannel:info.channel || it.ytChannel || '', source:'youtube-download',
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
  if(!it.id) return;   // 搜尋結果還沒收進影音庫：不記錄
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
// 記住看到哪裡（只記已收進影音庫的）；看完就歸零，下次從頭
async function _ytSavePos(ended){
  const it = _YT.cur, p = _YT.player;
  if(!it || !it.id || !p || !p.getCurrentTime) return;
  let pos = 0, dur = 0;
  try{ pos = Math.floor(p.getCurrentTime() || 0); dur = Math.floor(p.getDuration() || 0); }catch(_){ return; }
  return _ytSavePosOf(it, pos, dur, ended);
}
async function _ytSavePosOf(it, pos, dur, ended){
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
    <div class="ytp-ch">${esc(it.ytChannel || '')}${it.category ? '・' + esc(it.category) : ''}${saved ? '' : '・還沒收進影音庫'}</div>
    <div class="ytp-ctrls">
      <button onclick="ytPrev()" aria-label="上一部">⏮</button>
      <button onclick="ytRate()" class="${_YT.rate !== 1 ? 'on' : ''}" aria-label="播放速度">${_YT.rate}×</button>
      <button onclick="ytLoop()" class="${_YT.loop ? 'on' : ''}" aria-label="單部重複">↻</button>
      <button onclick="ytFav()" class="${it.favorite ? 'on' : ''}" aria-label="${saved ? '收藏' : '收進影音庫'}">${saved ? (it.favorite ? '♥' : '♡') : '＋'}</button>
      <button onclick="${saved ? 'ytEditItem(' + it.id + ')' : '_ytEditSheet(_YT.cur)'}" aria-label="分類與筆記">✎</button>
      <button onclick="ytNext()" aria-label="下一部"${_YT.qi >= q.length - 1 ? ' disabled' : ''}>⏭</button>
    </div>
    ${_YT.player && _YT.player.np ? `<div class="ytp-ctrls ytp-ctrls2">
      <button onclick="closeYtPlayer(true)" aria-label="背景播放">🎧 背景播放</button>
      ${it.type === 'audio' ? '' : `<button onclick="ytFull()" aria-label="全螢幕">⛶ 全螢幕</button>
      <button onclick="ytQuality()" aria-label="畫質">${_ytMaxH()}p</button>`}
    </div>` : ''}
    ${it.note ? `<div class="ytp-note">${_ytNoteHtml(it.note)}</div>` : ''}
    ${q.length > 1 ? `<div class="ytp-qhd">播放清單・${_YT.qi + 1}／${q.length}${_YT.loop ? '（單部重複中）' : '（播完自動接下一部）'}</div>
      <div class="ytp-q">${q.map((x, i) => `
        <div class="ytp-qi${i === _YT.qi ? ' on' : ''}" onclick="ytJump(${i})">
          <img loading="lazy" src="${_ytThumb(x.ytId)}" alt="" onerror="this.remove()">
          <div><div class="yt-t">${esc(x.title || '')}</div>
            <div class="yt-ch">${x.duration ? _fmtDur(x.duration) : ''}${x.lastPos > 5 ? '・看到 ' + _fmtDur(x.lastPos) : ''}</div></div>
        </div>`).join('')}</div>` : ''}`;
  body.querySelector('.ytp-qi.on')?.scrollIntoView({ block:'nearest' });
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
    _YT.bg = true;
    _ytMiniRender();
    if(S.page === 'media' && !document.getElementById('yt-search-ov')) _renderMediaPage();
    return;
  }
  _YT.bg = false; _ytMiniRemove();
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
      await P.open({ items:_ytNPItems(), index:_YT.qi, start, maxHeight:_ytMaxH(), rate:_YT.rate, loop:_YT.loop, rect:_ytNPRect() });
      _YT.npOpen = true;
    }
  }catch(e){ toast('播放器開啟失敗：' + e.message); return; }
  _ytNPObs(true);
  _ytRenderPlayerInfo();
  _ytNPSync();
  _ytMarkPlayed(it);
}
// 音樂：原生畫面藏起來，改顯示封面
function _ytNPPoster(it){
  const w = document.querySelector('#yt-player-ov .ytp-frame-wrap');
  if(!w) return;
  w.innerHTML = it && it.type === 'audio' ? `<img class="ytp-poster" src="${_ytThumb(it.ytId).replace('mqdefault', 'hqdefault')}" alt="">` : '';
}
function _ytNPCovered(){
  return !document.getElementById('yt-player-ov') || _YT.bg ||
    !!document.querySelector('#yt-edit-ov, #yt-menu-ov, #yt-dl-ov, #ask-in-ov, #cfm-ov.on, .cov.on, #img-viewer');
}
function _ytNPRect(){
  const it = _YT.cur || _YT.queue[_YT.qi];
  const w = document.querySelector('#yt-player-ov .ytp-frame-wrap');
  if(!w || !it || it.type === 'audio' || _ytNPCovered()) return { visible:false };
  const r = w.getBoundingClientRect();
  return { x:r.left, y:r.top, w:r.width, h:r.height, visible:r.width > 0 && r.height > 0 };
}
let _ytNPSyncT = 0;
function _ytNPSync(){
  if(!_ytNP() || !_YT.npOpen) return;
  cancelAnimationFrame(_ytNPSyncT);
  _ytNPSyncT = requestAnimationFrame(() => _ytNP().setView(_ytNPRect()));
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
    }
    _YT.npPos = s.pos; _YT.npDur = s.dur; _YT.npPlaying = s.playing;
    if(s.playing && Date.now() - (_YT.npSaved || 0) > 10000){ _YT.npSaved = Date.now(); _ytSavePos(); }
    if(s.ended) _ytSavePos(true);
    _ytMiniUpdate();
  });
  P.addListener('error', e => {
    const it = _YT.queue[e.index];
    if(!it || e.index !== _YT.qi) return;
    if(_YT.bg){ toast(e.message + '，跳到下一部'); _ytNP().control({ cmd:'next' }); return; }
    toast(e.message + '，改用 YouTube 播放器');
    it._iframe = true;
    const start = Math.floor(_YT.npPos || it.lastPos || 0);
    try{ _YT.player && _YT.player.destroy(); }catch(_){}
    _YT.player = null;
    _ytStartIframe(it, start);
  });
  P.addListener('fullscreen', () => ytFull());
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
    _ytNP().open({ items:_ytNPItems(), index:_YT.qi, start:_YT.npPos || 0, maxHeight:h, rate:_YT.rate, loop:_YT.loop, rect:_ytNPRect() });
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
  if(st) st.textContent = (_YT.npPlaying ? '背景播放中' : '已暫停') + (_YT.npDur ? '・' + _fmtDur(Math.floor(_YT.npPos)) + '／' + _fmtDur(Math.floor(_YT.npDur)) : '');
}
function _ytMiniRemove(){ document.getElementById('yt-mini')?.remove(); }
function ytReopen(){
  if(!_YT.npOpen) { _ytMiniRemove(); return; }
  _YT.bg = false; _ytMiniRemove();
  _ytEnsureOverlay();
  _ytNPPoster(_YT.cur);
  _ytRenderPlayerInfo();
  _ytNPObs(true);
  _ytNPSync();
}
async function ytStopBg(){
  await _ytSavePos();
  try{ _ytNP().stop(); }catch(_){}
  _YT.player = null; _YT.npOpen = false; _YT.bg = false; _YT.cur = null;
  _ytNPObs(false);
  _ytMiniRemove();
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
