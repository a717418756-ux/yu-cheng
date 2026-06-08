// ══ tts.js — 多引擎 TTS 朗讀模組 ══════════════════════════
// 支援三種引擎（依優先順序自動選擇）：
//   1. Google Cloud TTS  — 雲端，高品質，需 API key
//   2. Azure TTS via GAS — 雲端，高品質，需 GAS URL + Azure key
//   3. Web Speech API    — 本地，離線可用，無需設定
// 依賴：db.js（getSetting）, utils.js（toast）
// ════════════════════════════════════════════════════════════

(function(){
  'use strict';

  // ── 狀態 ────────────────────────────────────────────────────
  const _TTS = {
    speaking:   false,
    paused:     false,
    utterances: [],    // 分段文字佇列
    idx:        0,     // 目前段落索引
    rate:       1.0,
    voiceURI:   '',    // Web Speech 選擇的聲音
    engine:     'web', // 'web' | 'google' | 'azure'
    mode:       '',    // 'epub' | 'law'
    panel:      null,
    collapsed:  false,
    audio:      null,  // 雲端引擎用的 Audio 物件
  };

  // ── 引擎清單（供選單顯示）───────────────────────────────────
  // 動態偵測可用引擎，由 _buildEngineList() 組裝
  let _engines = [];  // [{ id, label, available }]

  async function _buildEngineList(){
    const googleKey = await getSetting('tts_google_key', '');
    const azureKey  = await getSetting('tts_azure_key', '');
    const gasUrl    = await getSetting(GAS_URL_KEY, '');

    // Web Speech：取 Google zh-TW，去重
    // 系統 TTS：固定 id 為 'web'，不依賴 getVoices() 非同步載入
    const webItems = [{
      id:        'web',
      label:     '🔵 系統 TTS（離線）',
      available: true,
      voiceURI:  '',  // 由 _initDefaultVoice 設定
    }];

    // Google Cloud TTS（有 Key 才加入選單）
    const googleItems = googleKey ? [
      { id:'google:zh-TW-Standard-A',  label:'🟢 Google 雲端 — 女聲A', available:true },
      { id:'google:zh-TW-Standard-B',  label:'🟢 Google 雲端 — 男聲B', available:true },
      { id:'google:zh-TW-Wavenet-A',   label:'🟢 Google WaveNet — 女聲', available:true },
      { id:'google:zh-TW-Wavenet-B',   label:'🟢 Google WaveNet — 男聲', available:true },
    ] : [];  // 沒填 Key：完全不顯示

    // Azure TTS via GAS（有 Key + GAS URL 才加入選單）
    const azureItems = (azureKey && gasUrl) ? [
      { id:'azure:zh-TW-HsiaoChenNeural', label:'🟣 Azure — 曉臻（自然女聲）', available:true },
      { id:'azure:zh-TW-YunJheNeural',    label:'🟣 Azure — 雲哲（自然男聲）', available:true },
    ] : [];  // 沒填 Key：完全不顯示

    _engines = [...webItems, ...googleItems, ...azureItems];

    // 設定預設引擎：優先讀上次儲存的選擇
    const saved = await getSetting('tts_engine_id', '');
    const found = _engines.find(e => e.id === saved && e.available);
    if(found){
      _TTS.engine = found.id;
    } else {
      // 沒有儲存或儲存的引擎不可用，預設系統 TTS
      _TTS.engine = 'web';
    }
    // web 引擎：動態取聲音
    if(_TTS.engine === 'web'){
      const wsv = _getWebSpeechVoices();
      _TTS.voiceURI = wsv[0]?.voiceURI || '';
    }
  }

  // ── Web Speech 聲音清單（去重）───────────────────────────────
  function _getWebSpeechVoices(){
    const all = speechSynthesis.getVoices();
    // 只取 zh-TW，優先 Google
    const tw = all.filter(v => v.lang === 'zh-TW');
    const google = tw.filter(v => v.name.toLowerCase().includes('google'));
    const result = google.length ? google : tw;
    // 去重：name 相似的只保留第一個
    const seen = new Set();
    return result.filter(v => {
      const key = v.name.replace(/\s+/g,'').toLowerCase();
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── 朗讀核心 ─────────────────────────────────────────────────

  function _speak(segments, mode){
    _stopAll();
    if(!segments?.length){ toast('沒有可朗讀的文字'); return; }
    _TTS.utterances = segments;
    _TTS.idx        = 0;
    if(mode) _TTS.mode = mode;
    _createPanel(_TTS.mode);
    setTimeout(async()=>{
      const s = document.getElementById('tts-rate');
      if(s){
        const pct = ((_TTS.rate - 0.5) / 1.5 * 100).toFixed(1);
        s.style.setProperty('--seek-pct', pct + '%');
      }
      _TTS.speaking = true;
      _updatePanelState();
      await _speakNext();
    }, 80);
  }

  async function _speakNext(){
    if(!_TTS.speaking || _TTS.idx >= _TTS.utterances.length){
      if(_TTS.speaking) _stopAll();
      return;
    }

    const rawText = _TTS.utterances[_TTS.idx];
    if(!rawText?.trim()){ _TTS.idx++; await _speakNext(); return; }

    // 限 150 字，超過截斷插回佇列
    const text = rawText.length > 150
      ? rawText.slice(0, rawText.lastIndexOf('，', 150) + 1 || 150)
      : rawText;
    if(text.length < rawText.length){
      _TTS.utterances.splice(_TTS.idx + 1, 0, rawText.slice(text.length));
    }

    const engineId = _TTS.engine || '';

    if(engineId.startsWith('google:')){
      await _speakGoogle(text, engineId.replace('google:',''));
    } else if(engineId.startsWith('azure:')){
      await _speakAzure(text, engineId.replace('azure:',''));
    } else {
      _speakWeb(text);
    }
  }

  // ── Web Speech ───────────────────────────────────────────────
  function _speakWeb(text){
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = 'zh-TW';
    utter.rate  = _TTS.rate;
    if(_TTS.voiceURI){
      const v = speechSynthesis.getVoices().find(v => v.voiceURI === _TTS.voiceURI);
      if(v) utter.voice = v;
    }
    utter.onend   = ()=>{ if(!_TTS.speaking) return; _TTS.idx++; _updatePanelState(); _speakNext(); };
    utter.onerror = (e)=>{ if(e.error==='interrupted'||e.error==='canceled') return; _TTS.idx++; _speakNext(); };
    if(!_keepaliveTimer) _startKeepalive();
    speechSynthesis.speak(utter);
  }

  // ── Google Cloud TTS ─────────────────────────────────────────
  async function _speakGoogle(text, voiceName){
    try{
      const key = await getSetting('tts_google_key','');
      if(!key) throw new Error('請先在設定頁填入 Google API Key');
      const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            input:      { text },
            voice:      { languageCode:'zh-TW', name:voiceName },
            audioConfig:{ audioEncoding:'MP3', speakingRate:_TTS.rate },
          }),
        }
      );
      if(!res.ok){
        const errJson = await res.json().catch(()=>({}));
        const msg = errJson?.error?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const json = await res.json();
      if(!json.audioContent) throw new Error('API 無回傳音訊');
      await _playBase64(json.audioContent);
    }catch(e){
      console.error('[Google TTS]', e.message);
      const msg = e.message.includes('API_KEY') || e.message.includes('key')
        ? 'API Key 錯誤，請重新確認'
        : e.message.includes('quota') || e.message.includes('QUOTA')
        ? 'Google TTS 免費額度已用完'
        : e.message;
      toast('Google TTS：' + msg);
      // 仍繼續下一段（不 fallback 到 web，讓使用者知道問題）
      _TTS.idx++;
      _speakNext();
    }
  }

  // ── Azure TTS via GAS ────────────────────────────────────────
  async function _speakAzure(text, voiceName){
    try{
      const azureKey = await getSetting('tts_azure_key','');
      const gasUrl   = await getSetting(GAS_URL_KEY,'');
      if(!azureKey || !gasUrl) throw new Error('未設定');
      const res = await fetch(gasUrl, {
        method:'POST',
        headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({
          action:    'azure_tts',
          text,
          voiceName,
          rate:      _TTS.rate,
          azureKey,
        }),
      });
      if(!res.ok) throw new Error(`GAS 錯誤 ${res.status}`);
      const json = await res.json();
      if(!json.ok || !json.audio) throw new Error(json.error||'無音訊');
      await _playBase64(json.audio);
    }catch(e){
      toast('Azure TTS 失敗，切換系統 TTS');
      _speakWeb(text);
    }
  }

  // ── 播放 base64 音訊（Google / Azure 共用）──────────────────
  function _playBase64(base64){
    return new Promise((resolve)=>{
      if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
      const audio = new Audio('data:audio/mp3;base64,' + base64);
      audio.playbackRate = 1.0;  // 速度由 API 控制
      _TTS.audio = audio;
      audio.onended = ()=>{
        _TTS.audio = null;
        if(!_TTS.speaking){ resolve(); return; }
        _TTS.idx++;
        _updatePanelState();
        _speakNext();
        resolve();
      };
      audio.onerror = (e)=>{
        console.warn('TTS audio error:', e);
        toast('雲端 TTS 播放失敗，切換系統 TTS');
        _TTS.audio = null;
        // fallback 到 Web Speech 繼續這段
        const curText = _TTS.utterances[_TTS.idx] || '';
        _TTS.idx++;
        if(curText) _speakWeb(curText);
        else _speakNext();
        resolve();
      };
      audio.play().catch((e)=>{
        console.warn('TTS play() blocked:', e);
        toast('雲端 TTS 無法播放，切換系統 TTS');
        _TTS.audio = null;
        const curText = _TTS.utterances[_TTS.idx] || '';
        _TTS.idx++;
        if(curText) _speakWeb(curText);
        else _speakNext();
        resolve();
      });
    });
  }

  // ── 暫停 / 繼續 / 停止 ───────────────────────────────────────
  function _pause(){
    _TTS.paused = true;
    if(_TTS.audio) _TTS.audio.pause();
    else speechSynthesis.pause();
    _updatePanelState();
  }
  function _resume(){
    _TTS.paused = false;
    if(_TTS.audio) _TTS.audio.play();
    else speechSynthesis.resume();
    _updatePanelState();
  }
  function _stopAll(){
    _stopKeepalive();
    speechSynthesis.cancel();
    if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
    _TTS.speaking = false;
    _TTS.paused   = false;
    _TTS.idx      = 0;
    _updatePanelState();
  }

  // ── Keepalive（Web Speech Android bug 防護）─────────────────
  let _keepaliveTimer = null;
  function _startKeepalive(){
    _stopKeepalive();
    _keepaliveTimer = setInterval(()=>{
      if(_TTS.speaking && !_TTS.paused && !_TTS.audio && !speechSynthesis.speaking){
        _speakNext();
      }
    }, 3000);
  }
  function _stopKeepalive(){
    if(_keepaliveTimer){ clearInterval(_keepaliveTimer); _keepaliveTimer = null; }
  }

  // ── 取得 epub 當前頁文字 ────────────────────────────────────
  function _getEpubPageText(){
    try{
      const rendition = window._epubRendition;
      const book      = window._epubBook;
      if(rendition && book){
        const loc = rendition.currentLocation();
        if(loc?.start?.cfi){
          const sectionHref = rendition.location?.start?.href;
          const section = sectionHref
            ? book.spine.get(sectionHref)
            : book.spine.get(loc.start.cfi);
          if(section){
            return section.load(book.load.bind(book)).then(contents=>{
              const text = (contents?.documentElement || contents)
                ?.textContent?.trim() || '';
              return text.split(/\n+/).map(s=>s.trim()).filter(s=>s.length>1);
            });
          }
        }
      }
      // fallback：iframe DOM
      const viewer = document.getElementById('epub-viewer');
      const iframe = viewer?.querySelector('iframe');
      const doc    = iframe?.contentDocument || iframe?.contentWindow?.document;
      if(!doc) return [];
      const paras  = [...doc.body.querySelectorAll('p,h1,h2,h3,h4,li')]
        .map(el => el.innerText?.trim()).filter(t => t && t.length > 1);
      return paras.length ? paras : [doc.body.innerText?.trim()].filter(Boolean);
    }catch(e){ return []; }
  }

  // ── 取得法條文字 ─────────────────────────────────────────────
  function _getLawText(){
    const lawName    = window.currentLawName    || document.getElementById('lv-name')?.textContent?.trim() || '';
    const lawContent = window.currentLawContent || '';
    if(!lawContent && !lawName) return [];
    const segments = lawName ? [lawName] : [];
    if(lawContent){
      lawContent.split('\n').map(s=>s.trim()).filter(s=>s.length>1).forEach(s=>segments.push(s));
    }
    return segments;
  }

  // ── 浮動控制列 ───────────────────────────────────────────────
  function _createPanel(mode){
    const existing = document.getElementById('tts-panel');
    if(existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'tts-panel';

    // 引擎選單 HTML
    const engineOpts = _engines.map(e =>
      `<option value="${e.id}" ${!e.available?'disabled':''} ${e.id===_TTS.engine?'selected':''}>
        ${e.label}${!e.available?' ⚙':''}
      </option>`
    ).join('');

    panel.innerHTML = `
      <button id="tts-miniball" class="tts-miniball" onclick="_ttsExpand()" title="展開控制列">
        <svg id="tts-ball-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="1"/>
          <rect x="14" y="4" width="4" height="16" rx="1"/>
        </svg>
      </button>

      <div class="tts-sheet" id="tts-sheet">
        <div class="tts-handle" onclick="_ttsCollapse()" title="收合"></div>

        <div class="tts-head">
          <span class="tts-mode-lbl">${mode==='epub'?'📖 朗讀本頁':'⚖ 朗讀法條'}</span>
          <span id="tts-progress" class="tts-prog">—</span>
          <button onclick="_ttsCollapse()" class="tts-collapse-btn" title="收合">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>

        <!-- 引擎選擇 -->
        <div class="tts-voice-row">
          <span class="tts-sub-lbl">聲音</span>
          <select id="tts-engine-sel" class="tts-voice-sel" onchange="_ttsSetEngine(this.value)">
            ${engineOpts}
          </select>
        </div>

        <!-- 語速 -->
        <div class="tts-rate-row">
          <span class="tts-sub-lbl">語速</span>
          <div class="tts-track-wrap">
            <input id="tts-rate" class="tts-track" type="range"
              min="0.5" max="2" step="0.1" value="${_TTS.rate}"
              oninput="_ttsSetRate(this.value)">
          </div>
          <span id="tts-rate-lbl" class="tts-rate-num">${_TTS.rate}x</span>
        </div>

        <!-- 控制按鈕 -->
        <div class="tts-controls">
          <button class="tts-btn-side" onclick="_ttsStop()" title="停止">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
          </button>
          <button id="tts-playpause" class="tts-btn-main" onclick="_ttsToggle()">
            <svg id="tts-pp-icon" width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          </button>
          <button class="tts-btn-side" onclick="_ttsCollapse()" title="收合到背景">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>
      </div>`;

    document.body.appendChild(panel);
    _TTS.panel = panel;
    return panel;
  }

  function _updatePanelState(){
    const btn  = document.getElementById('tts-playpause');
    const icon = document.getElementById('tts-pp-icon');
    const prog = document.getElementById('tts-progress');
    const iconSvg = _TTS.paused
      ? '<polygon points="5,3 19,12 5,21"/>'
      : '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    if(btn){
      btn.style.background = _TTS.paused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.14)';
      btn.style.boxShadow  = _TTS.paused ? 'none' : '0 0 0 1.5px rgba(255,255,255,0.25),0 4px 16px rgba(0,0,0,0.4)';
    }
    if(icon) icon.innerHTML = iconSvg;
    const ballIcon = document.getElementById('tts-ball-icon');
    if(ballIcon) ballIcon.innerHTML = iconSvg;
    if(prog){
      prog.textContent = _TTS.speaking
        ? `${_TTS.idx+1}/${_TTS.utterances.length}` : '—';
    }
  }

  // ── 公開 API ─────────────────────────────────────────────────
  window.ttsReadEpub = async function(){
    if(_TTS.speaking){ _stopAll(); return; }
    await _buildEngineList();
    let segments = _getEpubPageText();
    if(segments && typeof segments.then === 'function') segments = await segments.catch(()=>[]);
    if(!segments?.length){ toast('無法取得頁面文字'); return; }
    _speak(segments, 'epub');
  };

  window.ttsReadLaw = async function(){
    if(_TTS.speaking){ _stopAll(); return; }
    await _buildEngineList();
    const segments = _getLawText();
    if(!segments.length){ toast('沒有可朗讀的法條'); return; }
    _speak(segments, 'law');
  };

  window._ttsToggle   = ()=>{ _TTS.paused ? _resume() : _pause(); };

  window._ttsStop     = ()=>{
    _stopAll();
    if(_TTS.panel){
      _TTS.panel.style.transition = 'opacity .3s,transform .3s';
      _TTS.panel.style.opacity    = '0';
      _TTS.panel.style.transform  = 'translateY(12px)';
      const p = _TTS.panel;
      setTimeout(()=> p.remove(), 320);
      _TTS.panel = null;
    }
  };

  window._ttsSetRate  = (v)=>{
    _TTS.rate = parseFloat(v);
    const lbl = document.getElementById('tts-rate-lbl');
    if(lbl) lbl.textContent = _TTS.rate.toFixed(1)+'x';
    const slider = document.getElementById('tts-rate');
    if(slider){
      const pct = ((_TTS.rate - 0.5) / 1.5 * 100).toFixed(1);
      slider.style.setProperty('--seek-pct', pct + '%');
    }
    if(_TTS.speaking && !_TTS.paused){
      if(_TTS.audio){ _TTS.audio.playbackRate = _TTS.rate; }
      else{ speechSynthesis.cancel(); setTimeout(()=> _speakNext(), 80); }
    }
  };

  window._ttsSetEngine = async (id)=>{
    const eng = _engines.find(e => e.id === id);
    if(!eng || !eng.available){
      toast('此聲音需先在設定頁填入 API Key');
      // 還原選單
      const sel = document.getElementById('tts-engine-sel');
      if(sel) sel.value = _TTS.engine;
      return;
    }
    _TTS.engine = id;
    // web 引擎：動態取目前可用的第一個聲音
    if(id === 'web'){
      const wsv = _getWebSpeechVoices();
      _TTS.voiceURI = wsv[0]?.voiceURI || '';
    } else {
      _TTS.voiceURI = eng.voiceURI || '';
    }
    await setSetting('tts_engine_id', id);
    // 切換後重新播放當前段落
    if(_TTS.speaking && !_TTS.paused){
      if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
      speechSynthesis.cancel();
      setTimeout(()=> _speakNext(), 80);
    }
  };

  window._ttsCollapse = ()=>{
    const sheet = document.getElementById('tts-sheet');
    const ball  = document.getElementById('tts-miniball');
    if(sheet) sheet.classList.add('tts-hidden');
    if(ball)  ball.classList.add('tts-ball-visible');
    _TTS.collapsed = true;
  };

  window._ttsExpand = ()=>{
    const sheet = document.getElementById('tts-sheet');
    const ball  = document.getElementById('tts-miniball');
    if(sheet) sheet.classList.remove('tts-hidden');
    if(ball)  ball.classList.remove('tts-ball-visible');
    _TTS.collapsed = false;
  };

  // 聲音清單非同步載入
  function _initDefaultVoice(){
    const voices = _getWebSpeechVoices();
    if(!voices.length) return;
    // 如果目前是系統 TTS，更新 voiceURI
    if(_TTS.engine === 'web' || !_TTS.voiceURI){
      _TTS.voiceURI = voices[0].voiceURI;
    }
    const sel = document.getElementById('tts-engine-sel');
    if(sel) sel.value = _TTS.engine;
  }
  if(typeof speechSynthesis !== 'undefined'){
    if(speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = _initDefaultVoice;
    if(speechSynthesis.getVoices().length) _initDefaultVoice();
  }

  window.addEventListener('beforeunload', ()=>{ _stopAll(); });

})();
