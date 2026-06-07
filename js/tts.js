// ══ tts.js — Web Speech API 朗讀模組 ═══════════════════════
// 功能：epub 電子書 + 法條全文 TTS 朗讀
// 依賴：utils.js（toast）
// 不修改任何現有邏輯，純新增
// ════════════════════════════════════════════════════════════

(function(){
  'use strict';

  // ── 狀態 ────────────────────────────────────────────────────
  const _TTS = {
    speaking:   false,
    paused:     false,
    utterances: [],   // 分段佇列
    idx:        0,    // 目前段落
    rate:       1.0,
    pitch:      1.0,
    voiceURI:   '',   // 選擇的聲音
    mode:       '',   // 'epub' | 'law'
    panel:      null, // 目前顯示的浮動控制列
    collapsed:  false,// 是否收合為迷你球
  };

  // ── 取得可用中文聲音 ──────────────────────────────────────
  function _getVoices(){
    return speechSynthesis.getVoices().filter(v =>
      v.lang.startsWith('zh') || v.lang.startsWith('cmn')
    );
  }

  // ── 主要朗讀函式 ──────────────────────────────────────────
  function _speak(segments, mode){
    // 先 cancel 停止舊播放（不呼叫 _updatePanelState，避免移除 panel）
    speechSynthesis.cancel();
    _TTS.speaking = false;
    _TTS.paused   = false;
    _TTS.idx      = 0;

    if(!segments?.length){ toast('沒有可朗讀的文字'); return; }
    _TTS.utterances = segments;
    if(mode) _TTS.mode = mode;

    // 建立 panel（此時 speaking 還是 false，不會被 _updatePanelState 移除）
    _createPanel(_TTS.mode);
    // 初始化滑桿進度色
    setTimeout(()=>{
      const s=document.getElementById('tts-rate');
      if(s){const p=((_TTS.rate-0.5)/1.5*100).toFixed(1);s.style.setProperty('--seek-pct',p+'%');}
    },20);

    // 設為播放中再更新 UI
    _TTS.speaking = true;
    _updatePanelState();
    // 初始化語速滑桿的進度條顏色
    const _s = document.getElementById('tts-rate');
    if(_s){
      const pct = ((_TTS.rate - 0.5) / 1.5 * 100).toFixed(1);
      _s.style.setProperty('--seek-pct', pct + '%');
    }

    // 啟動 Android keepalive，防止 TTS 被系統中斷
    _startKeepalive();
    // 短暫延遲讓 Chrome 的 speechSynthesis.cancel() 完全生效
    setTimeout(()=> _speakNext(), 80);
  }

  // Android Chrome keepalive：每 10s resume 防止 TTS 被系統中斷
  let _keepaliveTimer = null;
  function _startKeepalive(){
    _stopKeepalive();
    // Android bug：speechSynthesis 可能靜默停止但 _TTS.speaking 仍為 true
    // 偵測到停止時，重新朗讀當前段落
    _keepaliveTimer = setInterval(()=>{
      if(_TTS.speaking && !_TTS.paused && !speechSynthesis.speaking){
        // 偵測到異常停止，重新從當前段落繼續
        _speakNext();
      }
    }, 3000);
  }
  function _stopKeepalive(){
    if(_keepaliveTimer){ clearInterval(_keepaliveTimer); _keepaliveTimer = null; }
  }

  // Android Chrome speechSynthesis bug：長文朗讀會在約15秒後靜默停止


  function _speakNext(){
    if(_TTS.idx >= _TTS.utterances.length){
      _stop();
      return;
    }
    const rawText = _TTS.utterances[_TTS.idx];
    if(!rawText?.trim()){ _TTS.idx++; _speakNext(); return; }
    // Android bug：單段超過 150 字容易靜默停止，自動截斷
    const text = rawText.length > 150
      ? rawText.slice(0, rawText.lastIndexOf('，', 150) + 1 || 150)
      : rawText;
    // 若截斷，把剩餘部分插回佇列
    if(text.length < rawText.length){
      _TTS.utterances.splice(_TTS.idx + 1, 0, rawText.slice(text.length));
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = 'zh-TW';
    utter.rate  = _TTS.rate;
    utter.pitch = _TTS.pitch;

    if(_TTS.voiceURI){
      const v = speechSynthesis.getVoices().find(v => v.voiceURI === _TTS.voiceURI);
      if(v) utter.voice = v;
    }

    utter.onend = ()=>{
      if(!_TTS.speaking) return;
      _TTS.idx++;
      _updatePanelState();
      _speakNext();
    };
    utter.onerror = (e)=>{
      if(e.error === 'interrupted' || e.error === 'canceled') return;
      _TTS.idx++;
      _speakNext();
    };

    if(!_keepaliveTimer) _startKeepalive();
    speechSynthesis.speak(utter);
  }

  function _pause(){
    if(speechSynthesis.speaking && !speechSynthesis.paused){
      speechSynthesis.pause();
      _TTS.paused = true;
      _updatePanelState();
    }
  }

  function _resume(){
    if(speechSynthesis.paused){
      speechSynthesis.resume();
      _TTS.paused = false;
      _updatePanelState();
    }
  }

  function _stop(){
    _stopKeepalive();
    speechSynthesis.cancel();
    _TTS.speaking = false;
    _TTS.paused  = false;
    _TTS.idx     = 0;
    _updatePanelState();
  }

  function _togglePause(){
    if(_TTS.paused) _resume();
    else _pause();
  }

  // ── epub：取得當前頁面文字 ──────────────────────────────
  function _getEpubPageText(){
    try{
      // 方法1：epub.js Section 取當前章節純文字（不含 HTML 標籤）
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
      // 方法2：從 iframe DOM 取（fallback）
      const viewer = document.getElementById('epub-viewer');
      const iframe = viewer?.querySelector('iframe');
      const doc    = iframe?.contentDocument || iframe?.contentWindow?.document;
      if(!doc) return [];
      const body = doc.body;
      if(!body) return [];
      const paras = [...body.querySelectorAll('p,h1,h2,h3,h4,li')]
        .map(el => el.innerText?.trim())
        .filter(t => t && t.length > 1);
      return paras.length ? paras : [body.innerText?.trim()].filter(Boolean);
    }catch(e){ return []; }
  }

  // ── 法條：取得當前顯示的法條文字 ──────────────────────
  function _getLawText(){
    // 使用 openLawGroup 存入的純文字（window.currentLawContent）
    // 格式：「第X條 內容」逐條換行，無 emoji 和按鈕文字
    const lawName    = window.currentLawName    || document.getElementById('lv-name')?.textContent?.trim() || '';
    const lawContent = window.currentLawContent || '';

    if(!lawContent && !lawName) return [];

    const segments = lawName ? [lawName] : [];

    // 按條分段：每條「第X條」開頭為一段
    if(lawContent){
      lawContent.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 1)
        .forEach(s => segments.push(s));
    }

    return segments;
  }

  // ── 浮動控制列 ────────────────────────────────────────────
  function _createPanel(mode){
    const existing = document.getElementById('tts-panel');
    if(existing) existing.remove();

    const voices    = _getVoices();
    const hasVoice  = voices.length > 1;
    const voiceOpts = hasVoice
      ? voices.map(v=>{
          const name = v.name.replace(/Microsoft|Google|Apple/g,'').replace(/\(.+?\)/g,'').trim().slice(0,14);
          const sel  = v.voiceURI === _TTS.voiceURI ? ' selected' : '';
          return `<option value="${v.voiceURI}"${sel}>${name}</option>`;
        }).join('')
      : '';

    const panel = document.createElement('div');
    panel.id = 'tts-panel';
    panel.innerHTML = `
      <!-- 迷你浮動球（收合狀態）-->
      <button id="tts-miniball" class="tts-miniball" onclick="_ttsExpand()" title="展開控制列">
        <svg id="tts-ball-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="1"/>
          <rect x="14" y="4" width="4" height="16" rx="1"/>
        </svg>
      </button>

      <!-- 完整控制列（展開狀態）-->
      <div class="tts-sheet" id="tts-sheet">
        <!-- 拖把手（點擊收合）-->
        <div class="tts-handle" onclick="_ttsCollapse()" title="收合"></div>

        <!-- 標題列：模式 + 進度 + 收合按鈕 -->
        <div class="tts-head">
          <span class="tts-mode-lbl">${mode === 'epub' ? '📖 朗讀本頁' : '⚖ 朗讀法條'}</span>
          <span id="tts-progress" class="tts-prog">—</span>
          <button onclick="_ttsCollapse()" class="tts-collapse-btn" title="收合到背景">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>

        <!-- 聲音選擇（有多個聲音才顯示）-->
        ${hasVoice ? `
        <div class="tts-voice-row">
          <span class="tts-sub-lbl">聲音</span>
          <select id="tts-voice" class="tts-voice-sel" onchange="_ttsSetVoice(this.value)">
            ${voiceOpts}
          </select>
        </div>` : ''}

        <!-- 語速列 -->
        <div class="tts-rate-row">
          <span class="tts-sub-lbl">語速</span>
          <div class="tts-track-wrap">
            <input id="tts-rate" class="tts-track" type="range"
              min="0.5" max="2" step="0.1" value="${_TTS.rate}"
              oninput="_ttsSetRate(this.value)">
          </div>
          <span id="tts-rate-lbl" class="tts-rate-num">${_TTS.rate}x</span>
        </div>

        <!-- 控制按鈕列 -->
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
    // 確保下拉選單顯示正確的預設聲音
    setTimeout(_initDefaultVoice, 0);
    return panel;
  }
  function _updatePanelState(){
    const btn  = document.getElementById('tts-playpause');
    const icon = document.getElementById('tts-pp-icon');
    const prog = document.getElementById('tts-progress');
    if(btn){
      btn.style.background = _TTS.paused
        ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.14)';
      btn.style.boxShadow = _TTS.paused
        ? 'none' : '0 0 0 1.5px rgba(255,255,255,0.25),0 4px 16px rgba(0,0,0,0.4)';
    }
    const iconSvg = _TTS.paused
      ? '<polygon points="5,3 19,12 5,21"/>'
      : '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    if(icon) icon.innerHTML = iconSvg;
    // 同步迷你球 icon
    const ballIcon = document.getElementById('tts-ball-icon');
    if(ballIcon) ballIcon.innerHTML = iconSvg;
    if(prog){
      prog.textContent = _TTS.speaking
        ? `${_TTS.idx+1} / ${_TTS.utterances.length}`
        : '—';
    }
    // panel 移除只由 _ttsStop() 明確觸發，不在這裡自動消失
  }

  // ── 公開 API ─────────────────────────────────────────────────

  // epub 頁面朗讀（由 epub 工具列按鈕呼叫）
  window.ttsReadEpub = async function(){
    if(_TTS.speaking){ _stop(); return; }
    // _getEpubPageText 可能回傳 Promise（epub.js Section 非同步載入）
    let segments = _getEpubPageText();
    if(segments && typeof segments.then === 'function'){
      segments = await segments.catch(()=>[]);
    }
    if(!segments || !segments.length){
      toast('無法取得頁面文字（可能是圖片頁或加密內容）'); return;
    }
    _TTS.mode = 'epub';
    _speak(segments, 'epub');
  };

  // 法條朗讀（由法條頁面按鈕呼叫）
  window.ttsReadLaw = function(){
    if(_TTS.speaking){ _stop(); return; }
    const segments = _getLawText();
    if(!segments.length){ toast('沒有可朗讀的法條'); return; }
    _TTS.mode = 'law';
    _speak(segments, 'law');
  };

  // 控制列按鈕呼叫
  window._ttsToggle   = ()=> _TTS.paused ? _resume() : _pause();
  window._ttsSkip     = ()=>{
    if(!_TTS.speaking) return;
    speechSynthesis.cancel();
    _TTS.idx = Math.min(_TTS.idx + 1, _TTS.utterances.length - 1);
    setTimeout(()=> _speakNext(), 60);
  };
  window._ttsStop     = ()=>{
    _stop();
    if(_TTS.panel){
      _TTS.panel.style.transition = 'opacity .3s,transform .3s';
      _TTS.panel.style.opacity = '0';
      _TTS.panel.style.transform = 'translateY(12px)';
      const p = _TTS.panel;
      setTimeout(()=>{ p.remove(); }, 320);
      _TTS.panel = null;
    }
  };
  window._ttsSetRate  = (v)=>{
    _TTS.rate = parseFloat(v);
    const lbl = document.getElementById('tts-rate-lbl');
    if(lbl) lbl.textContent = _TTS.rate.toFixed(1)+'x';
    // 更新進度條背景色（仿 vp-seek 的 CSS variable）
    const slider = document.getElementById('tts-rate');
    if(slider){
      const pct = ((_TTS.rate - 0.5) / 1.5 * 100).toFixed(1);
      slider.style.setProperty('--seek-pct', pct + '%');
    }
    if(_TTS.speaking && !_TTS.paused){
      // 重新開始當前段落（Web Speech API 無法即時改速）
      speechSynthesis.cancel();
      setTimeout(()=> _speakNext(), 80);
    }
  };
  window._ttsSetVoice = (uri)=>{
    _TTS.voiceURI = uri;
    // 切換聲音後立即重新播放當前段落，讓新聲音生效
    if(_TTS.speaking && !_TTS.paused){
      speechSynthesis.cancel();
      setTimeout(()=> _speakNext(), 80);
    }
  };

  // 收合：隱藏完整控制列，顯示迷你球，朗讀繼續
  window._ttsCollapse = ()=>{
    const sheet = document.getElementById('tts-sheet');
    const ball  = document.getElementById('tts-miniball');
    if(sheet) sheet.classList.add('tts-hidden');
    if(ball)  ball.classList.add('tts-ball-visible');
    _TTS.collapsed = true;
  };

  // 展開：顯示完整控制列，隱藏迷你球
  window._ttsExpand = ()=>{
    const sheet = document.getElementById('tts-sheet');
    const ball  = document.getElementById('tts-miniball');
    if(sheet) sheet.classList.remove('tts-hidden');
    if(ball)  ball.classList.remove('tts-ball-visible');
    _TTS.collapsed = false;
  };

  // 頁面離開時停止
  window.addEventListener('beforeunload', ()=> speechSynthesis.cancel());

  // 聲音清單延遲載入（Chrome 需要等 onvoiceschanged）
  function _initDefaultVoice(){
    const voices = _getVoices();
    if(!voices.length) return;
    // 優先選 zh-TW，其次 zh-TW 以外的中文
    const preferred = voices.find(v => v.lang === 'zh-TW')
                   || voices.find(v => v.lang.startsWith('zh'))
                   || voices[0];
    if(preferred && !_TTS.voiceURI){
      _TTS.voiceURI = preferred.voiceURI;
    }
    // 更新已顯示的下拉選單
    const sel = document.getElementById('tts-voice');
    if(sel && _TTS.voiceURI) sel.value = _TTS.voiceURI;
  }

  if(speechSynthesis.onvoiceschanged !== undefined){
    speechSynthesis.onvoiceschanged = _initDefaultVoice;
  }
  // 有些瀏覽器聲音已同步載入
  if(speechSynthesis.getVoices().length) _initDefaultVoice();

})();
