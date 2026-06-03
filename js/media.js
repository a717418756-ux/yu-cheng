// ══ media.js — 影音庫模組 ════════════════════════════════════
// 依賴：db.js（_db, dp, dd, dg, logError）
// 頁面：pg-media
// ════════════════════════════════════════════════════════════

// ── 狀態 ────────────────────────────────────────────────────
const _M = {
  filter: 'all',    // all | recent | fav | video | audio
  kw:     '',
  page:   0,
  PAGE:   20,
  allMedia: [],     // 含 metadata，不含 blob
};

// ── 影音庫列表渲染入口 ───────────────────────────────────────
async function renderMedia(){
  try{
    _M.page    = 0;
    _M.allMedia = await _getMediaMetaList();
    _renderMediaList();
  }catch(e){ logError('renderMedia',e); }
}

// 取得不含 blob 的影音 metadata 列表
async function _getMediaMetaList(){
  const all = await _db.leisuremedia.toArray();
  return all.map(({blob:_b, ...meta}) => meta);
}

// ── 篩選 + 搜尋 ─────────────────────────────────────────────
function _filteredMedia(){
  const kw = _M.kw.toLowerCase();
  let list  = _M.allMedia;

  if(_M.filter === 'recent'){
    list = list.filter(m => m.lastPlay).sort((a,b) => (b.lastPlay||0)-(a.lastPlay||0));
  } else if(_M.filter === 'fav'){
    list = list.filter(m => m.favorite);
  } else if(_M.filter === 'video'){
    list = list.filter(m => m.type === 'video');
  } else if(_M.filter === 'audio'){
    list = list.filter(m => m.type === 'audio');
  }

  if(kw){
    list = list.filter(m =>
      (m.title||'').toLowerCase().includes(kw) ||
      (m.category||'').toLowerCase().includes(kw) ||
      (m.tags||[]).join(' ').toLowerCase().includes(kw)
    );
  }
  return list;
}

// ── DOM 渲染 ─────────────────────────────────────────────────
function _renderMediaList(){
  const el  = document.getElementById('media-list');
  const cnt = document.getElementById('media-count');
  if(!el) return;

  const list  = _filteredMedia();
  const total = list.length;
  if(cnt) cnt.textContent = total ? `共 ${total} 筆` : '';

  if(!total){
    el.innerHTML = `<div class="empty"><span class="ic">🎬</span><span>尚無影音</span></div>`;
    return;
  }

  const batch = list.slice(0, (_M.page+1) * _M.PAGE);
  el.innerHTML = '';

  // 影片和音頻分開區塊顯示
  const videos = batch.filter(m => m.type === 'video');
  const audios = batch.filter(m => m.type === 'audio');

  if(_M.filter === 'all' || _M.filter === 'recent' || _M.filter === 'fav'){
    if(videos.length){
      el.appendChild(_mkMediaSection('🎬 影片', videos, 'media-grid-video'));
    }
    if(audios.length){
      el.appendChild(_mkMediaSection('🎵 音頻', audios, 'media-list-audio'));
    }
  } else if(_M.filter === 'video'){
    el.appendChild(_mkMediaSection('🎬 影片', videos, 'media-grid-video'));
  } else {
    el.appendChild(_mkMediaSection('🎵 音頻', audios, 'media-list-audio'));
  }

  // 無限捲動
  if(batch.length < total){
    const trigger = document.createElement('div');
    trigger.style.height = '20px';
    el.appendChild(trigger);
    const obs = new IntersectionObserver(entries => {
      if(entries[0].isIntersecting){
        obs.disconnect();
        _M.page++;
        _renderMediaList();
      }
    }, {rootMargin:'80px'});
    obs.observe(trigger);
  }
}

function _mkMediaSection(title, items, gridClass){
  const sec = document.createElement('div');
  sec.innerHTML = `<div class="media-sec-title">${title}</div>`;
  const grid = document.createElement('div');
  grid.className = gridClass;
  items.forEach(m => grid.appendChild(_mkMediaCard(m)));
  sec.appendChild(grid);
  return sec;
}

function _mkMediaCard(m){
  const div = document.createElement('div');
  const isVideo = m.type === 'video';
  div.className = isVideo ? 'media-card-video' : 'media-card-audio';

  const dur  = m.duration ? _fmtDur(m.duration) : '';
  const last = m.lastPlay ? new Date(m.lastPlay).toLocaleDateString('zh-TW') : '未播放';
  const favIcon = m.favorite ? '⭐' : '☆';

  if(isVideo){
    div.innerHTML = `
      <div class="mvc-thumb" onclick="openMediaDetail(${m.id})">
        ${m.thumbnail
          ? `<img src="${m.thumbnail}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
          : `<div class="mvc-no-thumb">🎬</div>`}
        ${dur ? `<div class="mvc-dur">${dur}</div>` : ''}
      </div>
      <div class="mvc-info">
        <div class="mvc-title" onclick="openMediaDetail(${m.id})">${esc(m.title||'未命名')}</div>
        <div class="mvc-meta">${m.category||''} · ${last}</div>
        <div class="mvc-actions">
          <button class="book-act-btn" onclick="openMediaDetail(${m.id})">▶ 播放</button>
          <button class="book-fav${m.favorite?' on':''}" onclick="toggleMediaFav(${m.id},this)">${favIcon}</button>
          <button class="book-act-btn del" onclick="confirmDeleteMedia(${m.id})">🗑</button>
        </div>
      </div>`;
  } else {
    // 音頻：橫列卡片
    div.innerHTML = `
      <div class="mac-icon">🎵</div>
      <div class="mac-info" onclick="openMediaDetail(${m.id})">
        <div class="mac-title">${esc(m.title||'未命名')}</div>
        <div class="mac-meta">${m.category||''}${dur ? ' · '+dur : ''} · ${last}</div>
      </div>
      <div class="mac-actions">
        <button class="book-act-btn" onclick="openMediaDetail(${m.id})">▶</button>
        <button class="book-fav${m.favorite?' on':''}" onclick="toggleMediaFav(${m.id},this)">${favIcon}</button>
        <button class="book-act-btn del" onclick="confirmDeleteMedia(${m.id})">🗑</button>
      </div>`;
  }
  return div;
}

// ── 外部觸發函式 ─────────────────────────────────────────────
function setMediaFilter(btn, filter){
  document.querySelectorAll('#media-chips .chip').forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
  _M.filter = filter;
  _M.page   = 0;
  _renderMediaList();
}

function searchMedia(){
  _M.kw   = (document.getElementById('media-si')?.value || '').trim();
  _M.page = 0;
  _renderMediaList();
}

// ── 新增影音（上傳檔案）─────────────────────────────────────
function openAddMedia(){
  const inp = document.createElement('input');
  inp.type  = 'file';
  inp.accept = 'video/*,audio/*';
  inp.multiple = true;
  inp.onchange = async e => {
    const files = [...e.target.files];
    if(!files.length) return;
    let added = 0;
    for(const file of files){
      await _saveMediaFile(file);
      added++;
    }
    toast(`已新增 ${added} 筆影音`);
    renderMedia();
  };
  inp.click();
}

async function _saveMediaFile(file){
  try{
    const isVideo = file.type.startsWith('video/');
    const media = {
      title:     file.name.replace(/\.[^.]+$/, ''),
      type:      isVideo ? 'video' : 'audio',
      category:  '',
      fileType:  file.name.split('.').pop().toLowerCase(),
      fileSize:  file.size,
      blob:      file,
      thumbnail: null,
      duration:  null,
      tags:      [],
      favorite:  false,
      lastPlay:  null,
      lastPos:   0,       // 上次播放秒數
      playCount: 0,
      createdAt: Date.now(),
    };
    await dp('leisuremedia', media);
  }catch(e){ logError('_saveMediaFile',e); toast('新增失敗：'+e.message); }
}

// ── 影音詳情 + 播放器 ────────────────────────────────────────
async function openMediaDetail(id){
  const media = await dg('leisuremedia', id);
  if(!media){ toast('找不到影音'); return; }
  if(!media.blob){ toast('檔案不存在'); return; }

  const url = URL.createObjectURL(media.blob);
  const modal = document.createElement('div');
  modal.id = 'media-player-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:#000;display:flex;flex-direction:column';

  const isVideo = media.type === 'video';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.8)">
      <button onclick="closeMediaPlayer('${id}',${media.lastPos||0})"
        style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:4px 8px">✕</button>
      <div style="flex:1;font-size:14px;font-weight:600;color:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">
        ${esc(media.title||'未命名')}</div>
    </div>
    ${isVideo
      ? `<video id="media-player-el" controls playsinline
           style="flex:1;width:100%;background:#000;max-height:calc(100vh - 120px)"
           src="${url}"></video>`
      : `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
           <div style="font-size:72px">🎵</div>
           <div style="font-size:16px;font-weight:600;color:#fff;text-align:center;padding:0 20px">
             ${esc(media.title||'未命名')}</div>
           <audio id="media-player-el" controls style="width:90%;max-width:400px" src="${url}"></audio>
         </div>`
    }
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px;background:rgba(0,0,0,0.8)">
      <label style="color:#ccc;font-size:12px">倍速</label>
      <select id="speed-sel" style="background:#222;color:#fff;border:none;padding:4px 8px;border-radius:6px;font-size:13px"
        onchange="document.getElementById('media-player-el').playbackRate=parseFloat(this.value)">
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1" selected>1×</option>
        <option value="1.25">1.25×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2×</option>
      </select>
      <button onclick="downloadMedia(${id})"
        style="background:rgba(255,255,255,0.12);border:none;color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer">
        ⬇ 下載
      </button>
    </div>`;

  document.body.appendChild(modal);

  // 恢復上次播放位置
  const player = document.getElementById('media-player-el');
  if(media.lastPos > 3){
    player.currentTime = media.lastPos;
  }

  // 關閉時釋放 URL
  modal._objectUrl = url;

  // 更新播放記錄
  media.lastPlay  = Date.now();
  media.playCount = (media.playCount||0) + 1;
  await dp('leisuremedia', media);
  const idx = _M.allMedia.findIndex(m => m.id === id);
  if(idx >= 0){ _M.allMedia[idx].lastPlay = media.lastPlay; }
}

async function closeMediaPlayer(id, fallbackPos){
  const modal  = document.getElementById('media-player-modal');
  const player = document.getElementById('media-player-el');
  if(modal){
    // 記錄播放位置
    const pos = player ? Math.floor(player.currentTime) : fallbackPos;
    if(pos > 0){
      try{
        const media = await dg('leisuremedia', Number(id));
        if(media){ media.lastPos = pos; await dp('leisuremedia', media); }
      }catch(_){}
    }
    if(modal._objectUrl) URL.revokeObjectURL(modal._objectUrl);
    modal.remove();
  }
}

async function downloadMedia(id){
  const media = await dg('leisuremedia', id);
  if(!media?.blob){ toast('檔案不存在'); return; }
  const url = URL.createObjectURL(media.blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download= (media.title||'media') + '.' + (media.fileType||'mp4');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function toggleMediaFav(id, btn){
  try{
    const media = await dg('leisuremedia', id);
    if(!media) return;
    media.favorite = !media.favorite;
    await dp('leisuremedia', media);
    btn.className = media.favorite ? 'book-fav on' : 'book-fav';
    btn.textContent = media.favorite ? '⭐' : '☆';
    const idx = _M.allMedia.findIndex(m => m.id === id);
    if(idx >= 0) _M.allMedia[idx].favorite = media.favorite;
  }catch(e){ logError('toggleMediaFav',e); }
}

async function confirmDeleteMedia(id){
  if(!confirm('確定刪除這筆影音？此操作無法復原。')) return;
  await dd('leisuremedia', id);
  _M.allMedia = _M.allMedia.filter(m => m.id !== id);
  _renderMediaList();
  toast('已刪除');
}

// ── 工具函式 ─────────────────────────────────────────────────
function _fmtDur(sec){
  if(!sec) return '';
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = Math.floor(sec%60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
           : `${m}:${String(s).padStart(2,'0')}`;
}
