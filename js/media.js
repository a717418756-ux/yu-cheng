// ══ media.js — 影音庫（黑膠播放器 + 海報牆）══════════════════
// 依賴：db.js（_db, dp, dd, dg, logError）
// 頁面：pg-media
// ════════════════════════════════════════════════════════════

// ── 狀態 ────────────────────────────────────────────────────
const _M = {
  filter:   'all',
  kw:       '',
  page:     0,
  PAGE:     20,
  allMedia: [],
  // 正在播放
  nowId:    null,
  nowType:  null,   // 'audio' | 'video'
  playlist: [],     // 當前播放列表（同類型排序）
  playIdx:  0,
};

// 音頻播放器實例（全域唯一）
let _audioEl = null;
let _vinylTimer = null;   // 黑膠旋轉 animation
let _sleepTimer = null;   // 睡眠定時器

// ════════════════════════════════════════════════════════════
// 頁面渲染入口
// ════════════════════════════════════════════════════════════
async function renderMedia(){
  try{
    _M.page     = 0;
    _M.allMedia = await _getMediaMetaList();
    _renderMediaPage();
  }catch(e){ logError('renderMedia',e); }
}

async function _getMediaMetaList(){
  const all = await _db.leisuremedia.toArray();
  return all.map(({blob:_b, ...meta}) => meta);
}

function _filteredMedia(){
  const kw = _M.kw.toLowerCase();
  let list = _M.allMedia;
  if(_M.filter==='recent') list=[...list].filter(m=>m.lastPlay).sort((a,b)=>(b.lastPlay||0)-(a.lastPlay||0));
  else if(_M.filter==='fav')   list=list.filter(m=>m.favorite);
  else if(_M.filter==='video') list=list.filter(m=>m.type==='video');
  else if(_M.filter==='audio') list=list.filter(m=>m.type==='audio');
  if(kw) list=list.filter(m=>
    (m.title||'').toLowerCase().includes(kw)||
    (m.category||'').toLowerCase().includes(kw)||
    (m.tags||[]).join(' ').toLowerCase().includes(kw)
  );
  return list;
}

// ── 首頁佈局（影片海報牆 + 音頻橫列）──────────────────────
function _renderMediaPage(){
  const el  = document.getElementById('media-list');
  const cnt = document.getElementById('media-count');
  if(!el) return;

  const list  = _filteredMedia();
  const total = list.length;
  if(cnt) cnt.textContent = total ? `共 ${total} 筆` : '';

  if(!total){
    el.innerHTML=`<div class="empty"><span class="ic">🎬</span><span>尚無影音，點右上角＋新增</span></div>`;
    return;
  }

  const batch  = list.slice(0, (_M.page+1)*_M.PAGE);
  const videos = batch.filter(m=>m.type==='video');
  const audios = batch.filter(m=>m.type==='audio');
  el.innerHTML='';

  // 全部 / 最近 / 收藏：影片在上，音頻在下
  const showBoth = ['all','recent','fav'].includes(_M.filter);
  if((showBoth||_M.filter==='video') && videos.length){
    el.appendChild(_mkVideoSection(videos));
  }
  if((showBoth||_M.filter==='audio') && audios.length){
    el.appendChild(_mkAudioSection(audios));
  }

  // 無限捲動
  if(batch.length<total){
    const trig=document.createElement('div');
    trig.style.height='20px';
    el.appendChild(trig);
    const obs=new IntersectionObserver(entries=>{
      if(entries[0].isIntersecting){obs.disconnect();_M.page++;_renderMediaPage();}
    },{rootMargin:'80px'});
    obs.observe(trig);
  }
}

// ════════════════════════════════════════════════════════════
// 影片海報牆區塊
// ════════════════════════════════════════════════════════════
function _mkVideoSection(videos){
  const sec=document.createElement('div');
  sec.innerHTML=`
    <div class="media-sec-hd-row">
      <div class="media-sec-hd-big">影片</div>
      <button class="media-sec-more${_M.filter==='video'?' active':''}" onclick="_filterToType('video')">
        ${_M.filter==='video'?'收起 ‹':'更多 ›'}
      </button>
    </div>`;
  const grid=document.createElement('div');
  grid.className='media-video-grid';
  // 主頁最多顯示4個，其餘點更多才看到
  const preview = _M.filter==='all' ? videos.slice(0,4) : videos;
  preview.forEach(m=>grid.appendChild(_mkVideoCard(m)));
  sec.appendChild(grid);
  return sec;
}

function _mkVideoCard(m){
  const div=document.createElement('div');
  div.className='media-vcard';
  const dur=m.duration?_fmtDur(m.duration):'';
  div.innerHTML=`
    <div class="mvc-poster" onclick="playVideo(${m.id})">
      ${m.thumbnail
        ?`<img src="${m.thumbnail}" loading="lazy"
            style="width:100%;height:100%;object-fit:cover;border-radius:10px 10px 0 0">`
        :`<div class="mvc-no-poster">🎬</div>`}
      ${dur?`<div class="mvc-dur-badge">${dur}</div>`:''}
      <div class="mvc-play-icon">▶</div>
    </div>
    <div class="mvc-meta-row">
      <div class="mvc-title-txt" onclick="playVideo(${m.id})">${esc(m.title||'未命名')}</div>
      <button class="mv-fav-btn${m.favorite?' on':''}"
        onclick="toggleMediaFav(${m.id},this)">${m.favorite?'⭐':'☆'}</button>
    </div>
    ${m.category?`<div class="mvc-cat">${esc(m.category)}</div>`:''}`;
  return div;
}

// ════════════════════════════════════════════════════════════
// 音頻黑膠列表區塊
// ════════════════════════════════════════════════════════════
function _mkAudioSection(audios){
  const sec=document.createElement('div');
  sec.innerHTML=`
    <div class="media-sec-hd-row">
      <div class="media-sec-hd-big">音頻</div>
      <button class="media-sec-more${_M.filter==='audio'?' active':''}" onclick="_filterToType('audio')">
        ${_M.filter==='audio'?'收起 ‹':'更多 ›'}
      </button>
    </div>`;
  const list=document.createElement('div');
  list.className='media-audio-list';
  // 主頁最多顯示5個
  const preview = _M.filter==='all' ? audios.slice(0,5) : audios;
  preview.forEach((m,i)=>list.appendChild(_mkAudioRow(m,i)));
  sec.appendChild(list);
  return sec;
}

function _mkAudioRow(m,i){
  const div=document.createElement('div');
  div.className='media-arow';
  div.id=`arow-${m.id}`;
  const dur=m.duration?_fmtDur(m.duration):'';
  const isPlaying=_M.nowId===m.id;
  div.innerHTML=`
    <div class="mar-vinyl${isPlaying?' spinning':''}" onclick="playAudio(${m.id})">
      ${m.thumbnail
        ?`<img src="${m.thumbnail}" loading="lazy"
            style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        :`<div class="mar-vinyl-inner"></div>`}
    </div>
    <div class="mar-info" onclick="playAudio(${m.id})">
      <div class="mar-title${isPlaying?' playing':''}">${esc(m.title||'未命名')}</div>
      <div class="mar-meta">${m.category||''}${dur?' · '+dur:''}</div>
    </div>
    <div class="mar-actions">
      ${dur?`<span class="mar-dur">${dur}</span>`:''}
      <button class="mv-fav-btn${m.favorite?' on':''}"
        onclick="toggleMediaFav(${m.id},this)">${m.favorite?'⭐':'☆'}</button>
      <button class="mar-more" onclick="openMediaDetail(${m.id})">⋯</button>
    </div>`;
  return div;
}

// ════════════════════════════════════════════════════════════
// 音頻播放器（黑膠模式）
// ════════════════════════════════════════════════════════════
async function playAudio(id){
  const meta=_M.allMedia.find(m=>m.id===id);
  if(!meta) return;

  // 建立播放列表（同頁面所有音頻，按顯示順序）
  const audioList=_filteredMedia().filter(m=>m.type==='audio');
  _M.playlist=audioList;
  _M.playIdx =audioList.findIndex(m=>m.id===id);
  _M.nowId   =id;
  _M.nowType ='audio';

  // 讀取 Blob
  const full=await dg('leisuremedia',id);
  if(!full?.blob){
    // 無附加檔案，但仍可開詳情視窗讓使用者刪除
    openMediaDetail(id);
    toast('此音頻無附加檔案，可在詳情中刪除');
    return;
  }

  // 停掉舊播放器
  if(_audioEl){_audioEl.pause();_audioEl.src='';}
  _clearVinyl();

  const url=URL.createObjectURL(full.blob);

  // 顯示黑膠播放器
  _showVinylPlayer(meta, url, full);

  // 更新播放記錄
  full.lastPlay=Date.now();
  full.playCount=(full.playCount||0)+1;
  await dp('leisuremedia',full);
  const idx=_M.allMedia.findIndex(m=>m.id===id);
  if(idx>=0) _M.allMedia[idx].lastPlay=full.lastPlay;

  // 更新列表高亮
  _updateAudioRowHighlight(id);
  _showMiniBar(meta.title,'audio');
}

function _showVinylPlayer(meta, url, full){
  document.getElementById('vinyl-player-ov')?.remove();

  const ov=document.createElement('div');
  ov.id='vinyl-player-ov';
  ov.style.cssText=`position:fixed;inset:0;z-index:600;
    background:linear-gradient(160deg,#0d0818 0%,#130d22 40%,#0a0a14 100%);
    display:flex;flex-direction:column;overflow:hidden`;

  const lastPos=full.lastPos||0;

  const isFav = meta.favorite || false;
  ov.innerHTML=`
    <!-- 頂部列 -->
    <div class="vp-topbar">
      <button class="vp-back" onclick="closeVinylPlayer()">
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <path d="M1 5H13M1 5L5 1M1 5L5 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="vp-mode-lbl">黑膠模式</div>
      <button class="vp-more" onclick="openMediaDetail(${meta.id})">
        <svg width="18" height="4" viewBox="0 0 18 4" fill="currentColor">
          <circle cx="2" cy="2" r="2"/><circle cx="9" cy="2" r="2"/><circle cx="16" cy="2" r="2"/>
        </svg>
      </button>
    </div>

    <!-- 黑膠唱片 -->
    <div class="vp-vinyl-wrap">
      <div class="vp-tonearm"></div>
      <!-- 唱盤底圖（真實唱盤圖片） -->
      <div class="vp-record" id="vp-record">
        <div class="vp-record-groove"></div>
        <!-- 封面圖疊在中央，自動裁圓 -->
        <div class="vp-record-label" id="vp-label-inner">
          ${meta.thumbnail
            ?`<img src="${meta.thumbnail}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`
            :`<div class="vp-label-text">${esc(meta.title||'')}</div>`}
        </div>
        <div class="vp-record-center"></div>
      </div>
    </div>

    <!-- 曲目資訊 + 喜愛 -->
    <div class="vp-info">
      <div class="vp-info-text">
        <div class="vp-title">${esc(meta.title||'未命名')}</div>
        <div class="vp-artist">${esc(meta.category||'Y.C. 影音庫')}</div>
      </div>
      <button class="vp-fav-btn${isFav?' on':''}" id="vp-fav-btn"
        onclick="_vpToggleFav(${meta.id},this)">${isFav?'♥':'♡'}</button>
    </div>

    <!-- 進度條 -->
    <div class="vp-progress-wrap">
      <input type="range" id="vp-seek" class="vp-seek" value="0" min="0" max="100" step="0.1"
        oninput="_vpSeek(this.value)" style="width:100%">
      <div class="vp-times">
        <span id="vp-cur">0:00</span>
        <span id="vp-dur">0:00</span>
      </div>
    </div>

    <!-- 控制按鈕 -->
    <div class="vp-controls">
      <button class="vpc-btn" onclick="_vpPrev()">⏮</button>
      <button class="vpc-btn vpc-main" id="vp-play-btn" onclick="_vpToggle()">▶</button>
      <button class="vpc-btn" onclick="_vpNext()">⏭</button>
    </div>

    <!-- 下排工具列 -->
    <div class="vp-tools">
      <button class="vpt-btn" onclick="_vpCycleSpeed(this)">
        <span class="vpt-icon">🎚</span>1.0×
      </button>
      <button class="vpt-btn" onclick="_vpSleepTimer(this)" id="vp-sleep-btn">
        <span class="vpt-icon">⏱</span>定時
      </button>
      <button class="vpt-btn" onclick="openVpPlaylist()">
        <span class="vpt-icon">≡</span>列表
      </button>
    </div>

    <!-- 隱藏 audio 元素 -->
    <audio id="vp-audio" src="${url}" style="display:none"></audio>`;

  document.body.appendChild(ov);

  _audioEl=document.getElementById('vp-audio');
  if(lastPos>3) _audioEl.currentTime=lastPos;

  // 事件綁定
  _audioEl.ontimeupdate=_vpTimeUpdate;
  _audioEl.onloadedmetadata=()=>{
    document.getElementById('vp-dur').textContent=_fmtDurSec(_audioEl.duration);
    document.getElementById('vp-seek').max=_audioEl.duration;
    // 更新 MediaSession duration
    if('mediaSession' in navigator && _audioEl.duration){
      try{ navigator.mediaSession.setPositionState({duration:_audioEl.duration,position:_audioEl.currentTime||0}); }catch(_){}
    }
  };
  _audioEl.onended=_vpNext;
  _audioEl.play().then(()=>{
    document.getElementById('vp-play-btn').textContent='⏸';
    _startVinylSpin();
    _setupMediaSession(meta);
  }).catch(()=>{});
}

// MediaSession API：通知列 / 鎖屏 控制
function _setupMediaSession(meta){
  if(!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  meta.title  || '未命名',
    artist: meta.category || 'Y.C. 影音庫',
    album:  'Y.C. All-in-one',
    artwork: meta.thumbnail ? [{src:meta.thumbnail,sizes:'192x192',type:'image/jpeg'}] : [],
  });
  navigator.mediaSession.setActionHandler('play',         ()=>{ if(_audioEl){_audioEl.play();_startVinylSpin();document.getElementById('vp-play-btn').textContent='⏸';} });
  navigator.mediaSession.setActionHandler('pause',        ()=>{ if(_audioEl){_audioEl.pause();_stopVinylSpin();document.getElementById('vp-play-btn').textContent='▶';} });
  navigator.mediaSession.setActionHandler('previoustrack',()=>_vpPrev());
  navigator.mediaSession.setActionHandler('nexttrack',    ()=>_vpNext());
  navigator.mediaSession.setActionHandler('seekto', e=>{ if(_audioEl && e.seekTime!=null) _audioEl.currentTime=e.seekTime; });
}

// 收藏切換（黑膠播放器內）
async function _vpToggleFav(id, btn){
  try{
    const m = await dg('leisuremedia', id); if(!m) return;
    m.favorite = !m.favorite;
    await dp('leisuremedia', m);
    btn.className = m.favorite ? 'vp-fav-btn on' : 'vp-fav-btn';
    btn.textContent = m.favorite ? '♥' : '♡';
    const idx = _M.allMedia.findIndex(x=>x.id===id);
    if(idx>=0) _M.allMedia[idx].favorite = m.favorite;
  }catch(e){ logError('_vpToggleFav',e); }
}

// 黑膠旋轉
function _startVinylSpin(){
  const rec=document.getElementById('vp-record');
  if(rec) rec.classList.add('spinning');
}
function _stopVinylSpin(){
  const rec=document.getElementById('vp-record');
  if(rec) rec.classList.remove('spinning');
}
function _clearVinyl(){
  _stopVinylSpin();
  if(_sleepTimer){clearTimeout(_sleepTimer);_sleepTimer=null;}
}

function closeVinylPlayer(){
  const ov=document.getElementById('vinyl-player-ov');
  if(!ov) return;
  // 儲存播放位置
  if(_audioEl && _M.nowId){
    const pos=Math.floor(_audioEl.currentTime);
    dg('leisuremedia',_M.nowId).then(m=>{
      if(m){m.lastPos=pos;dp('leisuremedia',m);}
    }).catch(()=>{});
    _audioEl.pause();
    URL.revokeObjectURL(_audioEl.src);
  }
  _clearVinyl();
  ov.remove();
  _updateMiniBar();
}

// 進度相關
function _vpTimeUpdate(){
  if(!_audioEl) return;
  const cur=_audioEl.currentTime;
  const dur=_audioEl.duration||1;
  const seek=document.getElementById('vp-seek');
  if(seek && !seek.matches(':active')){
    seek.value=cur;
    // 更新已播放填色
    const pct=Math.round(cur/dur*1000)/10;
    seek.style.setProperty('--seek-pct', pct+'%');
  }
  const curEl=document.getElementById('vp-cur');
  if(curEl) curEl.textContent=_fmtDurSec(cur);
}
function _vpSeek(val){
  if(!_audioEl) return;
  _audioEl.currentTime=parseFloat(val);
  const pct=Math.round(parseFloat(val)/(_audioEl.duration||1)*1000)/10;
  const seek=document.getElementById('vp-seek');
  if(seek) seek.style.setProperty('--seek-pct', pct+'%');
}
function _vpToggle(){
  if(!_audioEl) return;
  const btn=document.getElementById('vp-play-btn');
  if(_audioEl.paused){
    _audioEl.play(); btn.textContent='⏸'; _startVinylSpin();
  } else {
    _audioEl.pause(); btn.textContent='▶'; _stopVinylSpin();
  }
}
function _vpPrev(){
  if(_M.playlist.length<2) return;
  _M.playIdx=(_M.playIdx-1+_M.playlist.length)%_M.playlist.length;
  playAudio(_M.playlist[_M.playIdx].id);
}
function _vpNext(){
  if(_M.playlist.length<2) return;
  _M.playIdx=(_M.playIdx+1)%_M.playlist.length;
  playAudio(_M.playlist[_M.playIdx].id);
}
function _vpCycleSpeed(btn){
  if(!_audioEl) return;
  const speeds=[0.75,1,1.25,1.5,2];
  const cur=_audioEl.playbackRate;
  const nxt=speeds[(speeds.indexOf(cur)+1)%speeds.length];
  _audioEl.playbackRate=nxt;
  btn.textContent=nxt+'×';
}
function _vpSleepTimer(btn){
  const opts=[15,30,60,0];
  const cur=parseInt(btn.dataset.min||'0');
  const nxt=opts[(opts.indexOf(cur)+1)%opts.length];
  btn.dataset.min=nxt;
  if(_sleepTimer){clearTimeout(_sleepTimer);_sleepTimer=null;}
  if(nxt>0){
    btn.textContent=`⏱ ${nxt}分`;
    _sleepTimer=setTimeout(()=>{
      if(_audioEl) _audioEl.pause();
      _stopVinylSpin();
      document.getElementById('vp-play-btn').textContent='▶';
    },nxt*60000);
  } else {
    btn.textContent='⏱ 定時';
  }
}

// 播放列表彈窗
function openVpPlaylist(){
  const existing=document.getElementById('vp-playlist-panel');
  if(existing){existing.remove();return;}
  const panel=document.createElement('div');
  panel.id='vp-playlist-panel';
  panel.style.cssText=`position:absolute;bottom:0;left:0;right:0;
    background:rgba(20,16,30,0.97);border-top:1px solid rgba(255,255,255,0.1);
    max-height:55%;overflow-y:auto;z-index:10;padding-bottom:16px`;
  panel.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:12px 16px 8px;position:sticky;top:0;background:rgba(20,16,30,0.97)">
      <div style="font-size:13px;font-weight:700;color:#fff">
        播放列表 (${_M.playlist.length})</div>
      <button onclick="document.getElementById('vp-playlist-panel').remove()"
        style="background:none;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer">✕</button>
    </div>
    ${_M.playlist.map((m,i)=>`
      <div onclick="playAudio(${m.id})"
        style="display:flex;align-items:center;gap:12px;padding:10px 16px;
        cursor:pointer;${i===_M.playIdx?'background:rgba(168,85,247,0.15)':''}
        border-bottom:1px solid rgba(255,255,255,0.04)">
        ${i===_M.playIdx
          ?`<div style="width:16px;font-size:12px;color:#a855f7">♪</div>`
          :`<div style="width:16px;font-size:11px;color:rgba(255,255,255,0.3);text-align:center">${i+1}</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:${i===_M.playIdx?'#a855f7':'#fff'};
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title||'未命名')}</div>
        </div>
        ${m.duration?`<div style="font-size:11px;color:rgba(255,255,255,0.4)">${_fmtDur(m.duration)}</div>`:''}
      </div>`).join('')}`;
  document.getElementById('vinyl-player-ov').appendChild(panel);
}

// ════════════════════════════════════════════════════════════
// 影片播放器
// ════════════════════════════════════════════════════════════
async function playVideo(id){
  const full=await dg('leisuremedia',id);
  if(!full?.blob){
    openMediaDetail(id);
    toast('此影片無附加檔案，可在詳情中刪除');
    return;
  }

  _M.nowId  =id;
  _M.nowType='video';

  const url=URL.createObjectURL(full.blob);
  const ov=document.createElement('div');
  ov.id='video-player-ov';
  ov.style.cssText=`position:fixed;inset:0;z-index:600;background:#000;
    display:flex;flex-direction:column`;

  ov.innerHTML=`
    <div class="vvp-topbar">
      <button class="vvp-back" onclick="closeVideoPlayer(${id})">←</button>
      <div class="vvp-title">${esc(full.title||'影片')}</div>
      <button class="vvp-more" onclick="openMediaDetail(${id})">⋮</button>
    </div>
    <div style="flex:1;position:relative;background:#000;display:flex;align-items:center">
      <video id="video-el" controls playsinline preload="metadata"
        style="width:100%;max-height:calc(100vh - 110px)"
        src="${url}"></video>
    </div>
    <div class="vvp-toolbar">
      <button class="vvp-tool-btn" id="vvp-speed-btn" onclick="_vvpCycleSpeed(this)">
        <span class="vvp-tool-val">1.0×</span>
        <span class="vvp-tool-lbl">倍速</span>
      </button>
      <button class="vvp-tool-btn" onclick="downloadMedia(${id})">
        <span class="vvp-tool-val">⬇</span>
        <span class="vvp-tool-lbl">下載</span>
      </button>
      <button class="vvp-tool-btn" onclick="openMediaDetail(${id})">
        <span class="vvp-tool-val">⋮</span>
        <span class="vvp-tool-lbl">更多</span>
      </button>
    </div>`;

  document.body.appendChild(ov);

  const vidEl=document.getElementById('video-el');
  if(full.lastPos>3) vidEl.currentTime=full.lastPos;

  // 更新播放記錄
  full.lastPlay=Date.now();
  full.playCount=(full.playCount||0)+1;
  await dp('leisuremedia',full);

  _showMiniBar(full.title,'video');
}

function _vvpCycleSpeed(btn){
  const vidEl = document.getElementById('video-el');
  if(!vidEl) return;
  const speeds = [0.75, 1, 1.25, 1.5, 2];
  const cur = vidEl.playbackRate;
  const nxt = speeds[(speeds.indexOf(cur)+1)%speeds.length];
  vidEl.playbackRate = nxt;
  const span = btn.querySelector('span');
  if(span) span.textContent = nxt.toFixed(2).replace('.00','').replace(/\.?0+$/,'');
}

async function closeVideoPlayer(id){
  const ov=document.getElementById('video-player-ov');
  const vidEl=document.getElementById('video-el');
  if(vidEl && id){
    const pos=Math.floor(vidEl.currentTime);
    try{
      const m=await dg('leisuremedia',id);
      if(m){m.lastPos=pos;await dp('leisuremedia',m);}
    }catch(_){}
    vidEl.pause();
    URL.revokeObjectURL(vidEl.src);
  }
  ov?.remove();
  _updateMiniBar();
}

// ════════════════════════════════════════════════════════════
// 迷你播放列（底部常駐）
// ════════════════════════════════════════════════════════════
function _showMiniBar(title, type){
  let bar=document.getElementById('media-mini-bar');
  if(!bar){
    bar=document.createElement('div');
    bar.id='media-mini-bar';
    // 插在 pg-media 的 page 底部之上
    document.getElementById('pg-media').appendChild(bar);
  }
  bar.className='media-mini-bar';
  const icon=type==='audio'?'🎵':'🎬';
  bar.innerHTML=`
    <div class="${type==='audio'?'mmb-vinyl':'mmb-thumb'}"
      onclick="${type==='audio'?`document.getElementById('vinyl-player-ov')?.remove();playAudio(${_M.nowId})`:`document.getElementById('video-player-ov')?.remove();playVideo(${_M.nowId})`}">
      ${icon}
    </div>
    <div class="mmb-info"
      onclick="${type==='audio'?`document.getElementById('vinyl-player-ov')?.remove();playAudio(${_M.nowId})`:`document.getElementById('video-player-ov')?.remove();playVideo(${_M.nowId})`}">
      <div class="mmb-title">${esc(title||'')}</div>
      <div class="mmb-status">正在播放</div>
    </div>
    ${type==='audio'?`
    <button class="mmb-btn" onclick="_vpToggle()" title="播放/暫停">⏯</button>
    <button class="mmb-btn" onclick="_vpNext()" title="下一首">⏭</button>`
    :''}
    <button class="mmb-btn" onclick="${type==='audio'?'closeVinylPlayer()':'closeVideoPlayer('+_M.nowId+')'}">✕</button>`;
}

function _updateMiniBar(){
  const bar=document.getElementById('media-mini-bar');
  if(bar) bar.remove();
  _M.nowId=null; _M.nowType=null;
}

function _updateAudioRowHighlight(id){
  // 清除舊高亮
  document.querySelectorAll('.media-arow').forEach(r=>{
    r.querySelector('.mar-title')?.classList.remove('playing');
    r.querySelector('.mar-vinyl')?.classList.remove('spinning');
  });
  const row=document.getElementById(`arow-${id}`);
  if(row){
    row.querySelector('.mar-title')?.classList.add('playing');
    row.querySelector('.mar-vinyl')?.classList.add('spinning');
  }
}

// ════════════════════════════════════════════════════════════
// 新增影音（上傳表單）
// ════════════════════════════════════════════════════════════
function openAddMedia(){
  const ov=document.createElement('div');
  ov.id='add-media-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end';
  ov.innerHTML=`
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:90vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
      <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:14px">新增影音</div>

      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div id="am-thumb-preview" onclick="document.getElementById('am-thumb-inp').click()"
          style="width:72px;height:72px;border-radius:10px;background:rgba(255,255,255,0.06);
          border:1.5px dashed rgba(255,255,255,0.2);cursor:pointer;flex-shrink:0;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          font-size:10px;color:var(--t2);gap:4px">
          <span style="font-size:22px">🖼</span>縮圖
        </div>
        <input type="file" id="am-thumb-inp" accept="image/*" style="display:none"
          onchange="previewMediaThumb(this)">
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
          <input id="am-title" placeholder="標題 *" class="finput">
          <input id="am-category" placeholder="分類（如：法律課程）" class="finput">
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--t2);margin-bottom:5px">類型</div>
        <div style="display:flex;gap:8px">
          <button id="am-type-video" onclick="setAmType('video',this)"
            style="flex:1;padding:8px;border-radius:8px;border:1.5px solid var(--acc);
            background:rgba(110,168,254,0.15);color:var(--acc);font-size:13px;cursor:pointer">🎬 影片</button>
          <button id="am-type-audio" onclick="setAmType('audio',this)"
            style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);
            background:rgba(255,255,255,0.04);color:var(--t2);font-size:13px;cursor:pointer">🎵 音頻</button>
        </div>
      </div>

      <label style="font-size:11px;color:var(--t2);display:flex;align-items:center;
        gap:8px;margin-bottom:16px">
        <button onclick="document.getElementById('am-file-inp').click()"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--bd);color:var(--t1);
          padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer">選擇檔案</button>
        <span id="am-file-lbl" style="color:var(--t2);flex:1;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis">尚未選擇（可空）</span>
        <input type="file" id="am-file-inp" accept="video/*,audio/*" style="display:none"
          onchange="am_onFileChange(this)">
      </label>

      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('add-media-ov').remove()"
          style="flex:1;padding:12px;background:rgba(255,255,255,0.06);border:1px solid var(--bd);
          color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">取消</button>
        <button onclick="saveNewMedia()"
          style="flex:2;padding:12px;background:rgba(37,98,200,0.85);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700">儲存</button>
      </div>
    </div>`;
  ov.onclick=e=>{if(e.target===ov) ov.remove();};
  document.body.appendChild(ov);
  // 預設選影片
  window._amType='video';
}

function setAmType(type, btn){
  window._amType=type;
  ['video','audio'].forEach(t=>{
    const b=document.getElementById(`am-type-${t}`);
    if(!b) return;
    const on=t===type;
    b.style.borderColor=on?'var(--acc)':'rgba(255,255,255,0.12)';
    b.style.background=on?'rgba(110,168,254,0.15)':'rgba(255,255,255,0.04)';
    b.style.color=on?'var(--acc)':'var(--t2)';
  });
}

function previewMediaThumb(inp){
  if(!inp.files[0]) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const p=document.getElementById('am-thumb-preview');
    if(p){
      p.innerHTML=`<img src="${e.target.result}"
        style="width:100%;height:100%;object-fit:cover;border-radius:10px">`;
      p.style.border='none';
    }
  };
  reader.readAsDataURL(inp.files[0]);
}

function am_onFileChange(inp){
  const f=inp.files[0];
  if(!f) return;
  const lbl=document.getElementById('am-file-lbl');
  if(lbl) lbl.textContent=f.name;
  // 自動判斷類型
  const type=f.type.startsWith('video/')?'video':'audio';
  setAmType(type,document.getElementById(`am-type-${type}`));
}

async function saveNewMedia(){
  const title=document.getElementById('am-title')?.value.trim();
  if(!title){toast('請填寫標題');return;}
  const thumbInp=document.getElementById('am-thumb-inp');
  const fileInp =document.getElementById('am-file-inp');
  let thumbnail=null;
  if(thumbInp?.files[0]){
    thumbnail=await _compressMediaThumb(thumbInp.files[0]);
  }
  const media={
    title,
    type:     window._amType||'video',
    category: document.getElementById('am-category')?.value.trim()||'',
    fileType: fileInp?.files[0]?.name.split('.').pop().toLowerCase()||'',
    fileSize: fileInp?.files[0]?.size||0,
    blob:     fileInp?.files[0]||null,
    thumbnail,
    duration: null,
    tags:     [],
    favorite: false,
    lastPlay: null,
    lastPos:  0,
    playCount:0,
    createdAt:Date.now(),
  };
  try{
    await dp('leisuremedia',media);
    toast('已新增：'+title);
    document.getElementById('add-media-ov')?.remove();
    renderMedia();
  }catch(e){logError('saveNewMedia',e);toast('儲存失敗：'+e.message);}
}

function _compressMediaThumb(file){
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        const maxW=180,maxH=180;
        let w=img.width,h=img.height;
        const scale=Math.min(maxW/w,maxH/h,1);
        canvas.width=Math.round(w*scale);
        canvas.height=Math.round(h*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/jpeg',0.8));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════
// 影音詳情 / 下載 / 收藏 / 刪除
// ════════════════════════════════════════════════════════════
async function openMediaDetail(id){
  const m=await dg('leisuremedia',id);
  if(!m){toast('找不到');return;}
  const ov=document.createElement('div');
  ov.id='media-detail-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:700;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end';
  ov.innerHTML=`
    <div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);
      border-radius:20px 20px 0 0;padding:20px 16px 32px">
      <div style="width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px"></div>
      <div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:4px">${esc(m.title||'')}</div>
      <div style="font-size:11px;color:var(--t2);margin-bottom:14px">
        ${m.type==='video'?'🎬 影片':'🎵 音頻'} · ${m.category||'未分類'} · ${_fmtSize(m.fileSize||0)}
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('media-detail-ov').remove()"
          style="flex:1;padding:11px;background:rgba(255,255,255,0.06);border:1px solid var(--bd);
          color:var(--t1);border-radius:10px;cursor:pointer;font-size:13px">關閉</button>
        ${m.blob?`<button onclick="downloadMedia(${id})"
          style="flex:1;padding:11px;background:rgba(37,98,200,0.85);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:13px">⬇ 下載</button>`:''}
        <button onclick="confirmDeleteMedia(${id})"
          style="flex:1;padding:11px;background:rgba(200,50,50,0.7);color:#fff;
          border:none;border-radius:10px;cursor:pointer;font-size:13px">🗑 刪除</button>
      </div>
    </div>`;
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  document.body.appendChild(ov);
}

async function downloadMedia(id){
  const m=await dg('leisuremedia',id);
  if(!m?.blob){toast('無附加檔案');return;}
  const url=URL.createObjectURL(m.blob);
  const a=document.createElement('a');
  a.href=url;a.download=(m.title||'media')+'.'+(m.fileType||'mp4');
  a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}

async function toggleMediaFav(id,btn){
  try{
    const m=await dg('leisuremedia',id);if(!m)return;
    m.favorite=!m.favorite;await dp('leisuremedia',m);
    btn.className=`mv-fav-btn${m.favorite?' on':''}`;
    btn.textContent=m.favorite?'⭐':'☆';
    const idx=_M.allMedia.findIndex(x=>x.id===id);
    if(idx>=0) _M.allMedia[idx].favorite=m.favorite;
  }catch(e){logError('toggleMediaFav',e);}
}

async function confirmDeleteMedia(id){
  if(!confirm('確定刪除？此操作無法復原。')) return;
  await dd('leisuremedia',id);
  _M.allMedia=_M.allMedia.filter(m=>m.id!==id);
  _renderMediaPage();toast('已刪除');
  document.getElementById('media-detail-ov')?.remove();
}

// ════════════════════════════════════════════════════════════
// 篩選 / 搜尋觸發
// ════════════════════════════════════════════════════════════
function setMediaFilter(btn,filter){
  document.querySelectorAll('#media-chips .chip').forEach(c=>c.classList.remove('on'));
  if(btn) btn.classList.add('on');
  _M.filter=filter;_M.page=0;_renderMediaPage();
}

// 點「更多」切換篩選；已在該篩選則切回全部（toggle）
function _filterToType(type){
  _M.filter = (_M.filter === type) ? 'all' : type;
  _M.page = 0;
  _renderMediaPage();
}
function searchMedia(){
  _M.kw=(document.getElementById('media-si')?.value||'').trim();
  _M.page=0;_renderMediaPage();
}

// ════════════════════════════════════════════════════════════
// 工具
// ════════════════════════════════════════════════════════════
function _fmtDur(sec){
  if(!sec) return '';
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=Math.floor(sec%60);
  return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
function _fmtDurSec(sec){
  if(!sec||isNaN(sec)) return '0:00';
  const m=Math.floor(sec/60),s=Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function _fmtSize(bytes){
  if(!bytes) return '';
  if(bytes<1048576) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1048576).toFixed(1)+'MB';
}
