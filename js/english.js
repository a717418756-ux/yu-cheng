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

    // 逐句渲染：每句一個可點擊段落（之後跟讀/查詞用）
    bodyEl.innerHTML = (m.sentences||[]).map((s,i)=>
      `<p class="eng-sent" data-si="${i}">${esc(s)}</p>`
    ).join('');
    ov.style.display = 'flex';
    _stopTTS();
    _setupAudio(m);  // 載入該材料的朗讀/詳解音檔
  }catch(e){ logError('openMaterial',e); }
}

function closeMaterial(){
  _stopTTS();
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

// ════════ 動態載入第三方庫 ════════
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
  openEngAudioMgr, toggleEngAudio, engAudioSeek
};
window.English = English;
Object.assign(window, English);

})();
