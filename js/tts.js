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

    // 設為播放中再更新 UI
    _TTS.speaking = true;
    _updatePanelState();

    // 短暫延遲讓 Chrome 的 speechSynthesis.cancel() 完全生效
    setTimeout(()=> _speakNext(), 80);
  }

  function _speakNext(){
    if(_TTS.idx >= _TTS.utterances.length){
      _stop();
      return;
    }
    const text = _TTS.utterances[_TTS.idx];
    if(!text?.trim()){ _TTS.idx++; _speakNext(); return; }

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
      if(e.error === 'interrupted') return;
      _TTS.idx++;
      _speakNext();
    };

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
      const viewer = document.getElementById('epub-viewer');
      const iframe = viewer?.querySelector('iframe');
      const doc    = iframe?.contentDocument || iframe?.contentWindow?.document;
      if(!doc) return [];
      const body = doc.body;
      if(!body) return [];
      // 取得可視區段落文字，分段以控制朗讀節奏
      const paras = [...body.querySelectorAll('p,h1,h2,h3,h4,li,div')].filter(el=>{
        const text = el.innerText?.trim();
        return text && text.length > 1 && !el.querySelector('p,div');
      }).map(el => el.innerText.trim()).filter(Boolean);
      return paras.length ? paras : [body.innerText.trim()];
    }catch(e){ return []; }
  }

  // ── 法條：取得當前顯示的法條文字 ──────────────────────
  function _getLawText(){
    const lbody = document.getElementById('lbody');
    if(!lbody) return [];
    const lawName = document.getElementById('lv-name')?.textContent || '';
    const segments = [lawName];
    lbody.querySelectorAll('.lw-art,.lw-card-art').forEach(art=>{
      const title   = art.querySelector('.lw-art-title,.art-title')?.innerText?.trim();
      const content = art.querySelector('.lw-art-content,.art-content')?.innerText?.trim();
      if(title)   segments.push(title);
      if(content) segments.push(content);
    });
    if(segments.length <= 1){
      // fallback：直接取 lbody 文字
      const raw = lbody.innerText?.trim();
      if(raw) segments.push(raw);
    }
    return segments.filter(Boolean);
  }

  // ── 浮動控制列 ────────────────────────────────────────────
  function _createPanel(mode){
    const existing = document.getElementById('tts-panel');
    if(existing) existing.remove();

    const voices    = _getVoices();
    const hasVoice  = voices.length > 1;
    const voiceOpts = hasVoice
      ? voices.map(v=>{
          const name = v.name.replace(/Microsoft|Google|Apple/g,'').trim().slice(0,10);
          const sel  = v.voiceURI === _TTS.voiceURI ? ' selected' : '';
          return `<option value="${v.voiceURI}"${sel}>${name}</option>`;
        }).join('')
      : '';

    const panel = document.createElement('div');
    panel.id = 'tts-panel';

    panel.innerHTML = `
      <div class="tts-inner">
        <div class="tts-row tts-row-top">
          <div id="tts-progress" class="tts-progress">—</div>
          ${hasVoice ? `<select id="tts-voice" class="tts-voice" onchange="_ttsSetVoice(this.value)">${voiceOpts}</select>` : ''}
        </div>
        <div class="tts-row tts-row-rate">
          <span class="tts-label">慢</span>
          <input id="tts-rate" class="tts-slider" type="range"
            min="0.5" max="2" step="0.1" value="${_TTS.rate}"
            oninput="_ttsSetRate(this.value)">
          <span class="tts-label">快</span>
          <span id="tts-rate-lbl" class="tts-rate-val">${_TTS.rate}x</span>
        </div>
        <div class="tts-row tts-row-ctrl">
          <button id="tts-playpause" class="tts-btn tts-btn-main" onclick="_ttsToggle()">⏸</button>
          <button class="tts-btn tts-btn-stop" onclick="_ttsStop()">■</button>
        </div>
      </div>`;

    document.body.appendChild(panel);
    _TTS.panel = panel;
    return panel;
  }
  function _updatePanelState(){
    const btn  = document.getElementById('tts-playpause');
    const prog = document.getElementById('tts-progress');
    if(btn){
      btn.textContent = _TTS.paused ? '▶' : '⏸';
      btn.style.background = _TTS.paused ? 'rgba(255,255,255,0.15)' : 'var(--acc)';
    }
    if(prog){
      prog.textContent = _TTS.speaking
        ? `${_TTS.idx+1}/${_TTS.utterances.length}`
        : '—';
    }
    if(!_TTS.speaking && _TTS.panel){
      // 朗讀結束，淡出移除
      _TTS.panel.style.transition = 'opacity .4s';
      _TTS.panel.style.opacity = '0';
      setTimeout(()=>{ _TTS.panel?.remove(); _TTS.panel=null; }, 400);
    }
  }

  // ── 公開 API ─────────────────────────────────────────────────

  // epub 頁面朗讀（由 epub 工具列按鈕呼叫）
  window.ttsReadEpub = function(){
    if(_TTS.speaking){ _stop(); return; }
    const segments = _getEpubPageText();
    if(!segments.length){ toast('無法取得頁面文字（可能是圖片頁或加密內容）'); return; }
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
  window._ttsStop     = ()=>{ _stop(); _TTS.panel?.remove(); _TTS.panel=null; };
  window._ttsSetRate  = (v)=>{
    _TTS.rate = parseFloat(v);
    const lbl = document.getElementById('tts-rate-lbl');
    if(lbl) lbl.textContent = _TTS.rate.toFixed(1)+'x';
    if(_TTS.speaking && !_TTS.paused){
      // 重新開始當前段落（Web Speech API 無法即時改速）
      speechSynthesis.cancel();
      setTimeout(()=> _speakNext(), 80);
    }
  };
  window._ttsSetVoice = (uri)=>{ _TTS.voiceURI = uri; };

  // 頁面離開時停止
  window.addEventListener('beforeunload', ()=> speechSynthesis.cancel());

  // 聲音清單延遲載入（Chrome 需要等 onvoiceschanged）
  if(speechSynthesis.onvoiceschanged !== undefined){
    speechSynthesis.onvoiceschanged = ()=> {};  // 觸發載入
  }

})();
