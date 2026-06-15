// ══ english.js — 英語學習庫（第一階段）═══════════════════════
// 依賴：db.js(da/dp/dg/dd), utils.js(esc/toast)
// 功能：三種上傳(貼文字/PDF抽取/圖片OCR) + 閱讀 + TTS逐句高亮朗讀
// 全離線免費：TTS 用瀏覽器內建 speechSynthesis
//
// 設計：一篇材料 = { title, sourceType, sentences:[...], createdAt }
//   句子是學習的最小單位，逐句朗讀、逐句高亮、之後逐句跟讀。
//
// 公開 API 見檔尾 window.English

(function(){
'use strict';

let _curMaterial = null;   // 目前開啟的材料
let _ttsQueue = [];        // 朗讀佇列（句子索引）
let _ttsIdx = -1;          // 目前朗讀到第幾句
let _ttsPlaying = false;
let _ttsRate = 0.9;        // 語速（英語學習稍慢）

// ════════ 句子切分 ════════
// 把整段英文切成句子陣列（學習的最小單位）
function _splitSentences(text){
  if(!text) return [];
  // 正規化空白、保留段落
  const norm = text.replace(/\r\n/g,'\n').replace(/[ \t]+/g,' ').trim();
  const out = [];
  // 先依段落（雙換行）分，段內再依句末標點切
  norm.split(/\n\s*\n/).forEach(para=>{
    const p = para.trim();
    if(!p) return;
    // 句末標點：. ! ? 後接空白或結尾；保留標點。避免縮寫誤切（Mr. Dr. 等）
    const parts = p.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [p];
    parts.forEach(s=>{
      const t = s.trim();
      if(t) out.push(t);
    });
  });
  return out;
}

// ════════ 列表頁渲染 ════════
async function renderEnglish(){
  const el = document.getElementById('eng-list');
  if(!el) return;
  let mats = [];
  try{ mats = await da('englishMaterials'); }catch(e){ logError('renderEnglish',e); }
  mats.sort((a,b)=>(b.lastRead||b.createdAt||0)-(a.lastRead||a.createdAt||0));

  if(!mats.length){
    el.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--t2)">
      <div style="font-size:44px;margin-bottom:12px">📖</div>
      <div style="font-size:15px;font-weight:600;color:var(--t1);margin-bottom:6px">尚無英語材料</div>
      <div style="font-size:12px;line-height:1.8">點右上角 ＋ 上傳第一篇英文<br>支援貼上文字、PDF、拍照/圖片</div>
    </div>`;
    return;
  }

  el.innerHTML = mats.map(m=>{
    const cnt = (m.sentences||[]).length;
    const icon = m.sourceType==='pdf' ? '📄' : m.sourceType==='ocr' ? '📷' : '📝';
    const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString('zh-TW') : '';
    const hasAudio = (m.audioRead instanceof Blob) || (m.audioDetail instanceof Blob);
    const audioTag = hasAudio ? ' · 🎵' : '';
    return `<div class="eng-card" data-id="${m.id}">
      <div class="eng-card-icon">${icon}</div>
      <div class="eng-card-body">
        <div class="eng-card-title">${esc(m.title||'未命名')}</div>
        <div class="eng-card-meta">${cnt} 句 · ${esc(date)}${audioTag}</div>
      </div>
      <button class="eng-card-del" data-del="${m.id}" title="刪除">×</button>
    </div>`;
  }).join('');
}

// 列表事件委派（卡片開啟 / 刪除）
function _initEngListDelegation(){
  const el = document.getElementById('eng-list');
  if(!el || el._engBound) return;
  el._engBound = true;
  el.addEventListener('click', e=>{
    const del = e.target.closest('[data-del]');
    if(del){
      e.stopPropagation();
      _delMaterial(+del.dataset.del);
      return;
    }
    const card = e.target.closest('.eng-card[data-id]');
    if(card) openMaterial(+card.dataset.id);
  });
}

async function _delMaterial(id){
  cfm('刪除材料','確定刪除這篇英語材料？單字本記錄會保留。', async()=>{
    try{ await dd('englishMaterials', id); renderEnglish(); toast('已刪除'); }
    catch(e){ logError('_delMaterial',e); }
  });
}

// ════════ 上傳：選擇來源 ════════
function openEngUpload(){
  const ov = document.createElement('div');
  ov.id = 'eng-upload-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = `<div class="eng-sheet">
    <div class="eng-sheet-bar"></div>
    <div class="eng-sheet-title">上傳英語材料</div>
    <div class="eng-up-opts">
      <button class="eng-up-opt" data-src="text"><span class="eu-ic">📝</span><span class="eu-tx"><b>貼上文字</b><small>直接貼英文段落</small></span></button>
      <button class="eng-up-opt" data-src="pdf"><span class="eu-ic">📄</span><span class="eu-tx"><b>PDF 檔案</b><small>自動抽取文字</small></span></button>
      <button class="eng-up-opt" data-src="ocr"><span class="eu-ic">📷</span><span class="eu-tx"><b>拍照 / 圖片</b><small>OCR 辨識文字（較慢）</small></span></button>
    </div>
    <button class="eng-sheet-cancel" data-cancel>取消</button>
  </div>`;
  ov.addEventListener('click', e=>{
    if(e.target===ov || e.target.closest('[data-cancel]')){ ov.remove(); return; }
    const opt = e.target.closest('[data-src]');
    if(opt){ ov.remove(); _startUpload(opt.dataset.src); }
  });
  document.body.appendChild(ov);
}

function _startUpload(src){
  if(src==='text') _uploadText();
  else if(src==='pdf') _uploadPDF();
  else if(src==='ocr') _uploadOCR();
}

// ── 貼上文字 ──
function _uploadText(){
  const ov = document.createElement('div');
  ov.id = 'eng-text-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = `<div class="eng-sheet">
    <div class="eng-sheet-bar"></div>
    <div class="eng-sheet-title">貼上英文</div>
    <input id="eng-txt-title" class="eng-input" placeholder="標題（例：CNN 新聞 0614）">
    <textarea id="eng-txt-body" class="eng-textarea" placeholder="在此貼上英文段落..."></textarea>
    <div class="eng-sheet-btns">
      <button class="btn bg" data-cancel style="flex:1">取消</button>
      <button class="btn bp" data-save style="flex:2">建立材料</button>
    </div>
  </div>`;
  ov.addEventListener('click', e=>{
    if(e.target===ov || e.target.closest('[data-cancel]')){ ov.remove(); return; }
    if(e.target.closest('[data-save]')){
      const title = (document.getElementById('eng-txt-title').value||'').trim() || '未命名材料';
      const body  = (document.getElementById('eng-txt-body').value||'').trim();
      if(!body){ toast('請貼上英文內容'); return; }
      _saveMaterial(title, 'text', body);
      ov.remove();
    }
  });
  document.body.appendChild(ov);
  setTimeout(()=>document.getElementById('eng-txt-body')?.focus(), 200);
}

// ── PDF 抽取文字 ──
function _uploadPDF(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,application/pdf';
  inp.onchange = async ()=>{
    const file = inp.files[0]; if(!file) return;
    toast('讀取 PDF 中…');
    try{
      const lib = await _ensurePdfLib();
      const buf = await file.arrayBuffer();
      const pdf = await lib.getDocument({data:buf}).promise;
      let text = '';
      for(let i=1; i<=pdf.numPages; i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // 依 y 座標重組行，避免文字錯亂
        text += content.items.map(it=>it.str).join(' ') + '\n\n';
      }
      if(!text.trim()){ toast('PDF 無可抽取文字（可能是掃描圖檔，請用拍照/圖片 OCR）'); return; }
      _saveMaterial(file.name.replace(/\.pdf$/i,''), 'pdf', text);
    }catch(e){ logError('_uploadPDF',e); toast('PDF 讀取失敗：'+e.message); }
  };
  inp.click();
}

// ── 圖片 OCR ──
function _uploadOCR(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async ()=>{
    const file = inp.files[0]; if(!file) return;
    const prog = _ocrProgress();
    try{
      const Tess = await _ensureTesseract();
      const { data } = await Tess.recognize(file, 'eng', {
        logger: m=>{ if(m.status==='recognizing text') prog.set(Math.round(m.progress*100)); }
      });
      prog.close();
      const text = (data.text||'').trim();
      if(!text){ toast('未辨識到文字，請換清晰的圖片'); return; }
      _saveMaterial(file.name.replace(/\.[^.]+$/,'')||'拍照材料', 'ocr', text);
    }catch(e){ prog.close(); logError('_uploadOCR',e); toast('OCR 失敗：'+e.message); }
  };
  inp.click();
}

function _ocrProgress(){
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center';
  ov.innerHTML = `<div style="background:var(--bg1);border-radius:14px;padding:24px 32px;text-align:center;min-width:200px">
    <div style="font-size:13px;color:var(--t1);margin-bottom:10px">OCR 辨識中…</div>
    <div style="font-size:24px;font-weight:700;color:var(--acc)"><span id="ocr-pct">0</span>%</div>
    <div style="font-size:11px;color:var(--t2);margin-top:8px">首次使用需下載辨識引擎</div>
  </div>`;
  document.body.appendChild(ov);
  return {
    set:(p)=>{ const el=document.getElementById('ocr-pct'); if(el) el.textContent=p; },
    close:()=>ov.remove()
  };
}

// ── 儲存材料 ──
async function _saveMaterial(title, sourceType, rawText){
  const sentences = _splitSentences(rawText);
  if(!sentences.length){ toast('內容無法切分為句子'); return; }
  try{
    await dp('englishMaterials', {
      title, sourceType, sentences,
      createdAt: Date.now(), lastRead: Date.now()
    });
    toast(`已建立「${title}」（${sentences.length} 句）✓`);
    renderEnglish();
  }catch(e){ logError('_saveMaterial',e); toast('儲存失敗：'+e.message); }
}

// ════════ 閱讀器 ════════
async function openMaterial(id){
  try{
    const m = await dg('englishMaterials', id);
    if(!m){ toast('材料不存在'); return; }
    _curMaterial = m;
    m.lastRead = Date.now();
    dp('englishMaterials', m).catch(()=>{});

    const ov = document.getElementById('eng-reader');
    const titleEl = document.getElementById('eng-reader-title');
    const bodyEl = document.getElementById('eng-reader-body');
    if(!ov || !bodyEl) return;
    if(titleEl) titleEl.textContent = m.title||'';

    // 逐句渲染：每句一個可點擊段落 + 跟讀按鈕
    // 跟讀用 Azure（MediaRecorder 錄音），故檢測錄音能力，非 SpeechRecognition
    const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    bodyEl.innerHTML = (m.sentences||[]).map((s,i)=>`
      <div class="eng-sent-wrap">
        <p class="eng-sent" data-si="${i}">${esc(s)}</p>
        ${canRecord ? `<div class="eng-repeat-row" data-ri="${i}">
          <button class="eng-repeat-btn" onclick="startRepeat(this,${i})" title="跟讀此句">🎙</button>
        </div>` : ''}
      </div>`
    ).join('');
    ov.style.display = 'flex';
    _stopTTS();
    _setupAudio(m);  // 載入該材料的朗讀/詳解音檔
  }catch(e){ logError('openMaterial',e); }
}

function closeMaterial(){
  _stopTTS();
  _stopRecording();
  _teardownAudio();  // 釋放音檔 objectURL，避免記憶體洩漏
  const ov = document.getElementById('eng-reader');
  if(ov) ov.style.display = 'none';
  _curMaterial = null;
}

// ════════ TTS 逐句高亮朗讀 ════════
function toggleEngTTS(){
  if(_ttsPlaying){ _pauseTTS(); }
  else{ _playTTS(); }
}

function _playTTS(){
  if(!_curMaterial) return;
  if(!('speechSynthesis' in window)){ toast('此裝置不支援語音朗讀'); return; }
  // 從目前句或第一句開始
  if(_ttsIdx < 0) _ttsIdx = 0;
  _ttsPlaying = true;
  _updateTTSBtn();
  _speakSentence(_ttsIdx);
}

function _speakSentence(idx){
  const sents = _curMaterial?.sentences || [];
  if(idx >= sents.length){ _stopTTS(); toast('朗讀完成 ✓'); return; }
  _ttsIdx = idx;
  _highlightSentence(idx);

  const u = new SpeechSynthesisUtterance(sents[idx]);
  u.lang = 'en-US';
  u.rate = _ttsRate;
  // 選英語語音
  const voices = speechSynthesis.getVoices();
  const enVoice = voices.find(v=>/en[-_]US/i.test(v.lang)) || voices.find(v=>/^en/i.test(v.lang));
  if(enVoice) u.voice = enVoice;

  u.onend = ()=>{
    if(_ttsPlaying) _speakSentence(idx+1);
  };
  u.onerror = ()=>{ if(_ttsPlaying) _speakSentence(idx+1); };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function _highlightSentence(idx){
  const body = document.getElementById('eng-reader-body');
  if(!body) return;
  body.querySelectorAll('.eng-sent.reading').forEach(el=>el.classList.remove('reading'));
  const cur = body.querySelector(`.eng-sent[data-si="${idx}"]`);
  if(cur){
    cur.classList.add('reading');
    cur.scrollIntoView({behavior:'smooth', block:'center'});
  }
}

function _pauseTTS(){
  _ttsPlaying = false;
  speechSynthesis.cancel();
  _updateTTSBtn();
}

function _stopTTS(){
  _ttsPlaying = false;
  _ttsIdx = -1;
  try{ speechSynthesis.cancel(); }catch(e){}
  const body = document.getElementById('eng-reader-body');
  if(body) body.querySelectorAll('.eng-sent.reading').forEach(el=>el.classList.remove('reading'));
  _updateTTSBtn();
}

function _updateTTSBtn(){
  const btn = document.getElementById('eng-tts-btn');
  if(btn) btn.textContent = _ttsPlaying ? '⏸ 暫停' : '▶ 朗讀';
}

function setEngRate(r){
  _ttsRate = r;
  const lbl = document.getElementById('eng-rate-lbl');
  if(lbl) lbl.textContent = r.toFixed(1)+'×';
  // 若正在朗讀，從當前句以新語速重啟
  if(_ttsPlaying){ speechSynthesis.cancel(); _speakSentence(_ttsIdx); }
}

// 語速增減（按鈕用，含 0.5~1.5 邊界）
function engRateStep(delta){
  let r = Math.round((_ttsRate + delta)*10)/10;
  r = Math.max(0.5, Math.min(1.5, r));
  setEngRate(r);
}

// ════════ 音檔播放（朗讀 mp3 / 詳解 mp3）════════
// 音檔以 Blob 存在材料物件的 audioRead / audioDetail 欄位（IndexedDB 原生支援 Blob，離線可播）
const _engAudio = { read:null, detail:null };  // Audio 物件
let _engAudioUrls = { read:null, detail:null }; // objectURL（用後釋放）

// 開啟閱讀器時，載入該材料的音檔
function _setupAudio(material){
  _teardownAudio();
  const bar = document.getElementById('eng-audio-bar');
  let any = false;
  ['read','detail'].forEach(kind=>{
    const blob = kind==='read' ? material.audioRead : material.audioDetail;
    const row = document.getElementById('eng-audio-'+kind);
    if(blob instanceof Blob){
      const url = URL.createObjectURL(blob);
      _engAudioUrls[kind] = url;
      const audio = new Audio(url);
      audio.preload = 'metadata';
      audio.ontimeupdate = ()=>_updateAudioUI(kind);
      audio.onended = ()=>{ _updateAudioPlayBtn(kind,false); };
      audio.onloadedmetadata = ()=>_updateAudioUI(kind);
      _engAudio[kind] = audio;
      if(row) row.style.display = 'flex';
      any = true;
    } else {
      if(row) row.style.display = 'none';
    }
  });
  if(bar) bar.style.display = any ? 'block' : 'none';
}

function _teardownAudio(){
  ['read','detail'].forEach(kind=>{
    if(_engAudio[kind]){ try{ _engAudio[kind].pause(); }catch(e){} _engAudio[kind]=null; }
    if(_engAudioUrls[kind]){ URL.revokeObjectURL(_engAudioUrls[kind]); _engAudioUrls[kind]=null; }
  });
}

function toggleEngAudio(kind){
  const audio = _engAudio[kind];
  if(!audio) return;
  // 播一個時暫停另一個 + 暫停 TTS
  if(audio.paused){
    _pauseTTS();
    const other = kind==='read' ? 'detail' : 'read';
    if(_engAudio[other] && !_engAudio[other].paused){ _engAudio[other].pause(); _updateAudioPlayBtn(other,false); }
    audio.play().catch(e=>toast('播放失敗：'+e.message));
    _updateAudioPlayBtn(kind,true);
  } else {
    audio.pause();
    _updateAudioPlayBtn(kind,false);
  }
}

function engAudioSeek(kind, val){
  const audio = _engAudio[kind];
  if(!audio || !audio.duration) return;
  audio.currentTime = (val/100)*audio.duration;
}

function _updateAudioUI(kind){
  const audio = _engAudio[kind];
  if(!audio) return;
  const seek = document.getElementById('eng-au-seek-'+kind);
  const time = document.getElementById('eng-au-time-'+kind);
  if(audio.duration){
    if(seek) seek.value = (audio.currentTime/audio.duration)*100;
    if(time) time.textContent = _fmtTime(audio.currentTime)+' / '+_fmtTime(audio.duration);
  }
}

function _updateAudioPlayBtn(kind, playing){
  const btn = document.querySelector('.eng-au-play[data-au="'+kind+'"]');
  if(btn) btn.textContent = playing ? '⏸' : '▶';
}

function _fmtTime(sec){
  if(!isFinite(sec)) return '0:00';
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return m+':'+String(s).padStart(2,'0');
}

// ── 音檔管理面板（上傳/移除）──
function openEngAudioMgr(){
  if(!_curMaterial){ toast('請先開啟材料'); return; }
  const m = _curMaterial;
  const ov = document.createElement('div');
  ov.id = 'eng-audio-mgr';
  ov.style.cssText = 'position:fixed;inset:0;z-index:420;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
  const row = (kind,label,icon)=>{
    const has = (kind==='read'?m.audioRead:m.audioDetail) instanceof Blob;
    return `<div class="eng-aum-row">
      <span class="eng-aum-label">${icon} ${label}</span>
      ${has
        ? `<span class="eng-aum-has">已附加</span><button class="eng-aum-btn del" data-del="${kind}">移除</button>`
        : `<button class="eng-aum-btn" data-add="${kind}">上傳 MP3</button>`}
    </div>`;
  };
  ov.innerHTML = `<div class="eng-sheet">
    <div class="eng-sheet-bar"></div>
    <div class="eng-sheet-title">管理音檔</div>
    <div style="font-size:12px;color:var(--t2);margin-bottom:14px">每篇可附「朗讀」與「詳解」兩個音檔，離線儲存可播放。</div>
    ${row('read','朗讀音檔','📖')}
    ${row('detail','詳解音檔','💡')}
    <button class="eng-sheet-cancel" data-cancel>關閉</button>
  </div>`;
  ov.addEventListener('click', e=>{
    if(e.target===ov || e.target.closest('[data-cancel]')){ ov.remove(); return; }
    const add = e.target.closest('[data-add]');
    if(add){ _pickAudio(add.dataset.add, ov); return; }
    const del = e.target.closest('[data-del]');
    if(del){ _removeAudio(del.dataset.del, ov); return; }
  });
  document.body.appendChild(ov);
}

function _pickAudio(kind, ov){
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='audio/*,.mp3';
  inp.onchange = async ()=>{
    const file = inp.files[0]; if(!file) return;
    try{
      const m = await dg('englishMaterials', _curMaterial.id);
      if(kind==='read') m.audioRead = file; else m.audioDetail = file;
      await dp('englishMaterials', m);
      _curMaterial = m;
      toast('音檔已附加 ✓');
      if(ov) ov.remove();
      _setupAudio(m);  // 重新載入音檔列
    }catch(e){ logError('_pickAudio',e); toast('附加失敗：'+e.message); }
  };
  inp.click();
}

async function _removeAudio(kind, ov){
  try{
    const m = await dg('englishMaterials', _curMaterial.id);
    if(kind==='read') delete m.audioRead; else delete m.audioDetail;
    await dp('englishMaterials', m);
    _curMaterial = m;
    toast('已移除音檔');
    if(ov) ov.remove();
    _setupAudio(m);
  }catch(e){ logError('_removeAudio',e); }
}

// 點句子 → 從該句開始朗讀
function _initReaderDelegation(){
  const body = document.getElementById('eng-reader-body');
  if(!body || body._engBound) return;
  body._engBound = true;
  body.addEventListener('click', e=>{
    const sent = e.target.closest('.eng-sent[data-si]');
    if(sent){
      _ttsIdx = +sent.dataset.si;
      _ttsPlaying = true;
      _updateTTSBtn();
      _speakSentence(_ttsIdx);
    }
  });
}

// ════════ 跟讀糾正（Azure Pronunciation Assessment）════════
// 流程：取得 Azure Token → MediaRecorder 錄音（webm/mp4）
//       → POST 到 Azure Speech REST API（含 Pronunciation Assessment 參數）
//       → 解析 NBest[0].Words[] 逐字顯示發音分數
// 依賴：getSetting('tts_azure_key') 已在 settings.js 存入 IndexedDB

const _AZ_REGION  = 'eastasia';
const _AZ_LANG    = 'en-US';
let   _azPAToken  = null;   // { token, expiry }
let   _mediaRec   = null;   // 目前的 MediaRecorder
let   _recChunks  = [];
let   _recStartTs = 0;      // 錄音起始時間（判斷是否太短）

// ── 取得 Azure 授權 Token（10 分鐘有效，自動快取）──────────
async function _getAzToken(){
  const now = Date.now();
  if(_azPAToken && _azPAToken.expiry > now + 30000) return _azPAToken.token;
  const key = await getSetting('tts_azure_key','').catch(()=>'');
  if(!key) throw new Error('請先在「設定」填入 Azure Key');
  const res = await fetch(
    `https://${_AZ_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    { method:'POST', headers:{ 'Ocp-Apim-Subscription-Key': key } }
  );
  if(!res.ok) throw new Error(`Token 取得失敗（HTTP ${res.status}）`);
  const token = await res.text();
  _azPAToken = { token, expiry: now + 9 * 60 * 1000 };
  return token;
}

// ── 停止目前錄音（若有）──────────────────────────────────────
function _stopRecording(){
  if(_mediaRec && _mediaRec.state !== 'inactive') _mediaRec.stop();
  _mediaRec = null;
}

// ── 主入口：點 🎙 按鈕 ────────────────────────────────────────
async function startRepeat(btn, idx){
  // 若正在錄音 → 停止
  if(_mediaRec && _mediaRec.state === 'recording'){
    _stopRecording();
    return;
  }

  const sents = _curMaterial?.sentences || [];
  const original = sents[idx];
  if(!original) return;

  // 暫停 TTS 避免干擾麥克風
  if(_ttsPlaying){ _pauseTTS(); }

  // 先確認有 Azure Key（避免錄完才報錯）
  const key = await getSetting('tts_azure_key','').catch(()=>'');
  if(!key){
    toast('請先在「設定」填入 Azure Key 才能使用跟讀糾正');
    return;
  }

  // 取得麥克風權限
  let stream;
  try{
    stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  }catch(e){
    toast('無法開啟麥克風：' + (e.message||e));
    return;
  }

  // 按鈕：錄音中狀態
  const origTxt = btn.textContent;
  btn.textContent = '⏹';
  btn.classList.add('eng-repeat-btn-rec');
  btn.title = '點擊停止錄音';

  _recChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
    : 'audio/mp4';
  const rec = new MediaRecorder(stream, { mimeType });
  _mediaRec = rec;

  rec.ondataavailable = e=>{ if(e.data.size>0) _recChunks.push(e.data); };
  rec.onstop = async ()=>{
    stream.getTracks().forEach(t=>t.stop());
    // 還原按鈕
    btn.textContent = origTxt;
    btn.classList.remove('eng-repeat-btn-rec');
    btn.title = '跟讀此句';
    _mediaRec = null;

    const dur = Date.now() - _recStartTs;
    if(dur < 800){ toast('錄音太短，請按住到念完再放開'); _recChunks=[]; return; }
    if(!_recChunks.length){ toast('未收到錄音資料，請重念'); return; }
    const webmBlob = new Blob(_recChunks, { type: mimeType });
    _recChunks = [];
    // 轉成 Azure 最穩定的 WAV(16kHz 單聲道 PCM)再送，解決 webm 空辨識
    _showRepeatLoading(idx);
    let wavBlob;
    try{
      wavBlob = await _webmToWav(webmBlob);
    }catch(e){
      console.error('[AzurePA] WAV 轉換失敗', e);
      _clearRepeatResult(idx);
      toast('音訊處理失敗，請重念');
      return;
    }
    await _assessPronunciation(idx, original, wavBlob, 'audio/wav');
  };

  _recStartTs = Date.now();
  rec.start(100);  // 每 100ms 產生一次資料片段，確保短句也能完整收集
  // 最長 15 秒自動停止
  setTimeout(()=>{ if(rec.state==='recording') rec.stop(); }, 15000);
}

// ── webm/opus → WAV(16kHz 單聲道 PCM 16-bit)──────────────────
// Azure REST 對 WAV PCM 支援最穩定，避免 webm 容器解不出語音(空辨識)
async function _webmToWav(blob){
  const arrayBuf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(arrayBuf);
  ctx.close();

  // 降到 16kHz 單聲道
  const targetRate = 16000;
  const srcCh0 = decoded.getChannelData(0);
  const ratio = decoded.sampleRate / targetRate;
  const outLen = Math.floor(srcCh0.length / ratio);
  const pcm = new Float32Array(outLen);
  for(let i=0; i<outLen; i++){
    pcm[i] = srcCh0[Math.floor(i * ratio)];
  }

  // Float32 → Int16
  const int16 = new Int16Array(outLen);
  for(let i=0; i<outLen; i++){
    const s = Math.max(-1, Math.min(1, pcm[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  // 組 WAV header
  const dataSize = int16.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const wr = (off, str)=>{ for(let i=0;i<str.length;i++) dv.setUint8(off+i, str.charCodeAt(i)); };
  wr(0,'RIFF'); dv.setUint32(4, 36+dataSize, true); wr(8,'WAVE');
  wr(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true);
  dv.setUint16(22,1,true); dv.setUint32(24,targetRate,true);
  dv.setUint32(28,targetRate*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true);
  wr(36,'data'); dv.setUint32(40,dataSize,true);
  for(let i=0;i<int16.length;i++) dv.setInt16(44+i*2, int16[i], true);

  return new Blob([buf], { type:'audio/wav' });
}

// ── 送 Azure Pronunciation Assessment REST ────────────────────
async function _assessPronunciation(idx, original, audioBlob, mimeType){
  _showRepeatLoading(idx);

  let token;
  try{ token = await _getAzToken(); }
  catch(e){ toast(e.message); _clearRepeatResult(idx); return; }

  // Pronunciation Assessment 參數（JSON → base64，UTF-8 乾淨編碼）
  const paObj = {
    ReferenceText:  original,
    GradingSystem:  'HundredMark',
    Granularity:    'Phoneme',
    Dimension:      'Comprehensive',
    EnableMiscue:   true,
  };
  // 用 TextEncoder 產生標準 UTF-8 base64（Azure 要求；舊的 unescape 寫法在某些情況會被拒）
  const paJson  = JSON.stringify(paObj);
  const paBytes = new TextEncoder().encode(paJson);
  let paBin = '';
  paBytes.forEach(b => paBin += String.fromCharCode(b));
  const paHeader = btoa(paBin);

  const url = `https://${_AZ_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`
    + `?language=${_AZ_LANG}&format=detailed`;

  // Azure REST 音訊格式宣告
  let contentType;
  if(mimeType.includes('wav'))       contentType = 'audio/wav; codecs=audio/pcm; samplerate=16000';
  else if(mimeType.includes('webm')) contentType = 'audio/webm; codecs=opus';
  else if(mimeType.includes('ogg'))  contentType = 'audio/ogg; codecs=opus';
  else if(mimeType.includes('mp4'))  contentType = 'audio/mp4';
  else                               contentType = mimeType;

  let result;
  try{
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization':           `Bearer ${token}`,
        'Content-Type':            contentType,
        'Pronunciation-Assessment': paHeader,
        'Accept':                  'application/json',
      },
      body: audioBlob,
    });
    if(!res.ok){
      const txt = await res.text().catch(()=>'');
      throw new Error(`Azure HTTP ${res.status}：${txt.slice(0,120)}`);
    }
    result = await res.json();
  }catch(e){
    _clearRepeatResult(idx);
    toast('評估失敗：' + e.message);
    console.error('[AzurePA]', e);
    return;
  }

  _clearRepeatResult(idx);

  // 先檢查辨識狀態：沒聽到語音時明確提示，而非顯示 0 分誤導
  const status = result?.RecognitionStatus;
  console.log('[AzurePA] 辨識結果:', { status, hasNBest:!!result?.NBest?.length, raw:result });
  if(status && status !== 'Success'){
    const msg = status === 'InitialSilenceTimeout' ? '沒偵測到聲音，請靠近麥克風後重念'
              : status === 'NoMatch' ? '聽不清楚，請大聲清晰地重念一次'
              : status === 'BabbleTimeout' ? '背景太吵，請在安靜環境重念'
              : `辨識未成功（${status}）`;
    toast(msg);
    return;
  }
  if(!result?.NBest?.length){
    toast('沒收到發音資料，請重念一次');
    return;
  }

  _showPAResult(idx, original, result);
}

function _showRepeatLoading(idx){
  _clearRepeatResult(idx);
  const body = document.getElementById('eng-reader-body');
  if(!body) return;
  const div = document.createElement('div');
  div.className = 'eng-repeat-res';
  div.dataset.ri = idx;
  div.innerHTML = '<span style="color:var(--t2)">⏳ Azure 評估中…</span>';
  _insertAfterSent(body, idx, div);
}
function _clearRepeatResult(idx){
  document.getElementById('eng-reader-body')
    ?.querySelectorAll(`.eng-repeat-res[data-ri="${idx}"]`)
    .forEach(el=>el.remove());
}
function _insertAfterSent(body, idx, el){
  const anchor = body.querySelector(`.eng-repeat-row[data-ri="${idx}"]`)
               || body.querySelector(`.eng-sent[data-si="${idx}"]`);
  if(anchor?.nextSibling) anchor.parentNode.insertBefore(el, anchor.nextSibling);
  else if(anchor) anchor.after(el);
}

// ── 解析並顯示結果 ────────────────────────────────────────────
function _showPAResult(idx, original, result){
  const body = document.getElementById('eng-reader-body');
  if(!body) return;

  const nb    = result?.NBest?.[0];
  // 發音評估分數可能在 NBest[0].PronunciationAssessment（標準），
  // 少數情況在 result 頂層，兩處都讀，取到有效值為止
  const pa    = nb?.PronunciationAssessment || result?.PronunciationAssessment || {};
  const words = nb?.Words || [];

  const accScore   = Math.round(pa.AccuracyScore     ?? 0);
  const fluScore   = Math.round(pa.FluencyScore      ?? 0);
  const compScore  = Math.round(pa.CompletenessScore ?? 0);
  const totalScore = Math.round(pa.PronScore ?? ((accScore + fluScore + compScore) / 3));

  // 若分數全 0 但有辨識文字 → 評估沒啟動，印出結構供診斷並提示
  if(accScore===0 && fluScore===0 && compScore===0){
    console.warn('[AzurePA] 分數全0，PronunciationAssessment 內容：', pa, '完整 NBest[0]：', nb);
    toast('發音評估未回傳分數，請看 Console 診斷');
  }

  const scoreColor = s => s>=90 ? 'var(--grn,#4caf7d)' : s>=70 ? 'var(--org,#f5a623)' : 'var(--red,#e05c57)';

  const wordsHtml = words.map(w=>{
    const ws  = Math.round(w.PronunciationAssessment?.AccuracyScore ?? 0);
    const err = w.PronunciationAssessment?.ErrorType ?? 'None';
    const badge = err==='Omission'  ? '<sup class="eng-pa-err">漏</sup>'
                : err==='Insertion' ? '<sup class="eng-pa-err">多</sup>' : '';
    return `<span class="eng-pa-word" style="color:${scoreColor(ws)}" title="準確度 ${ws}%">`
         + `${esc(w.Word)}${badge}</span>`;
  }).join(' ');

  const div = document.createElement('div');
  div.className = 'eng-repeat-res';
  div.dataset.ri = idx;
  div.innerHTML = `
    <div class="eng-pa-scores">
      <div class="eng-pa-score-item">
        <span class="eng-pa-score-val" style="color:${scoreColor(accScore)}">${accScore}</span>
        <span class="eng-pa-score-lbl">準確度</span>
      </div>
      <div class="eng-pa-score-item">
        <span class="eng-pa-score-val" style="color:${scoreColor(fluScore)}">${fluScore}</span>
        <span class="eng-pa-score-lbl">流暢度</span>
      </div>
      <div class="eng-pa-score-item">
        <span class="eng-pa-score-val" style="color:${scoreColor(compScore)}">${compScore}</span>
        <span class="eng-pa-score-lbl">完整度</span>
      </div>
      <div class="eng-pa-score-item eng-pa-score-total">
        <span class="eng-pa-score-val" style="color:${scoreColor(totalScore)}">${totalScore}</span>
        <span class="eng-pa-score-lbl">綜合</span>
      </div>
    </div>
    <div class="eng-pa-words">${wordsHtml || '<span style="color:var(--t2)">（未偵測到語音）</span>'}</div>
    <div style="font-size:10px;color:var(--t2);margin-top:6px">
      辨識：${esc(nb?.Display || nb?.Lexical || '—')}
    </div>`;

  _insertAfterSent(body, idx, div);
  div.scrollIntoView({ behavior:'smooth', block:'nearest' });
}


let _pdfLib = null;
async function _ensurePdfLib(){
  if(_pdfLib) return _pdfLib;
  await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  _pdfLib = lib;
  return lib;
}
let _tess = null;
async function _ensureTesseract(){
  if(_tess) return _tess;
  await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js');
  _tess = window.Tesseract;
  return _tess;
}
function _loadScript(src){
  return new Promise((resolve,reject)=>{
    if([...document.scripts].some(s=>s.src===src)){ resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = ()=>reject(new Error('載入失敗：'+src));
    document.head.appendChild(s);
  });
}

// ════════ 初始化委派 ════════
function _initEnglish(){
  _initEngListDelegation();
  _initReaderDelegation();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', _initEnglish);
else _initEnglish();

// ════════ 公開 API ════════
const English = {
  renderEnglish, openEngUpload, openMaterial, closeMaterial,
  toggleEngTTS, setEngRate, engRateStep,
  openEngAudioMgr, toggleEngAudio, engAudioSeek,
  startRepeat,
};
window.English = English;
Object.assign(window, English);

})();
