// ══ tts.js — Web Speech API 朗讀模組 ══════════════════════
// 使用 Android 系統 TTS（window.speechSynthesis），離線可用
// 若手機安裝多個 TTS 引擎（Samsung TTS、Google TTS 等），
// 在 Android 系統設定啟用後即自動出現在選單
// 依賴：db.js（getSetting、setSetting）、utils.js（toast）
// ════════════════════════════════════════════════════════════

(function(){
  'use strict';

  // ── 狀態 ────────────────────────────────────────────────────
  const _TTS = {
    speaking:   false,
    paused:     false,
    utterances: [],
    idx:        0,
    rate:       1.0,
    voiceURI:   '',
    mode:       '',
    panel:      null,
    collapsed:  false,
    audio:      null,  // Azure 播放用的 HTMLAudioElement
  };

  // ── Azure TTS via GAS ───────────────────────────────────────
  // 快取 Azure 設定（避免每段都讀 IndexedDB）
  let _azureCache = { key:'', url:'' };
  async function _loadAzureConfig(){
    if(!_azureCache.key){
      _azureCache.key = await getSetting('tts_azure_key','').catch(()=>'');
      _azureCache.url = await getSetting('gasWebAppUrl','').catch(()=>'');
    }
    return _azureCache;
  }

  // Prefetch：預先 fetch 下一段音訊，減少段落間停頓
  let _prefetchCache = null;  // { idx, promise }
  function _prefetchNext(idx, voiceName){
    const nextIdx  = idx + 1;
    const nextText = _TTS.utterances[nextIdx];
    if(!nextText?.trim()) return;
    if(_prefetchCache?.idx === nextIdx) return;  // 已在 prefetch
    _prefetchCache = {
      idx: nextIdx,
      promise: _loadAzureConfig().then(({ key:azureKey, url:gasUrl })=>{
        if(!azureKey || !gasUrl) return null;
        return fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action:'azure_tts', text:nextText, voiceName,
            rate:_TTS.rate, azureKey,
          }),
        }).then(r => r.ok ? r.json() : null).catch(()=>null);
      }),
    };
  }

  async function _speakAzure(text, voiceName){
    try{
      const { key:azureKey, url:gasUrl } = await _loadAzureConfig();
      if(!azureKey || !gasUrl) throw new Error('請先設定 Azure Key 和 GAS 網址');

      // 優先使用 prefetch 快取
      let json = null;
      if(_prefetchCache?.idx === _TTS.idx && _prefetchCache.promise){
        json = await _prefetchCache.promise;
        _prefetchCache = null;
      }
      if(!json){
        const res = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action:'azure_tts', text, voiceName, rate:_TTS.rate, azureKey }),
        });
        if(!res.ok) throw new Error(`GAS HTTP ${res.status}`);
        json = await res.json();
      }
      if(!json.ok) throw new Error(json.error || '無回傳音訊');
      // 播放 base64 mp3（存到 _TTS.audio 讓 _pause/_stop 可控制）
      if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
      return new Promise(resolve=>{
        const audio = new Audio('data:audio/mp3;base64,' + json.audio);
        _TTS.audio = audio;
        // 開始播放時預先 fetch 下一段（減少段落間停頓）
        _prefetchNext(_TTS.idx, voiceName);
        audio.onended = ()=>{
          _TTS.audio = null;
          if(!_TTS.speaking){ resolve(); return; }
          _TTS.idx++;
          _updatePanelState();
          _speakNext();
          resolve();
        };
        audio.onerror = ()=>{
          _TTS.audio = null;
          _TTS.idx++;
          _speakNext();
          resolve();
        };
        audio.play().catch(()=>{
          _TTS.audio = null;
          _TTS.idx++;
          _speakNext();
          resolve();
        });
      });
    }catch(e){
      console.error('[Azure TTS]', e.message);
      toast('Azure TTS：' + e.message);
      _TTS.idx++;
      _speakNext();
    }
  }

  // ── 取得系統 zh-TW 聲音，去重 ──────────────────────────────
  function _getVoices(){
    const all = speechSynthesis.getVoices();
    // 只取 zh-TW，去重
    const seen = new Set();
    return all.filter(v => v.lang === 'zh-TW').filter(v => {
      const key = v.name.replace(/\s+/g,'').toLowerCase();
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── 朗讀核心 ─────────────────────────────────────────────────
  async function _speak(segments, mode){
    _stop();
    if(!segments?.length){ toast('沒有可朗讀的文字'); return; }
    _TTS.utterances = segments;
    _TTS.idx        = 0;
    if(mode) _TTS.mode = mode;
    await _createPanel(_TTS.mode);
    setTimeout(()=>{
      const s = document.getElementById('tts-rate');
      if(s){
        const pct = ((_TTS.rate - 0.5) / 1.5 * 100).toFixed(1);
        s.style.setProperty('--seek-pct', pct + '%');
      }
      _TTS.speaking = true;
      _updatePanelState();
      _speakNext();
    }, 80);
  }

  async function _speakNext(){
    if(!_TTS.speaking || _TTS.idx >= _TTS.utterances.length){
      if(_TTS.speaking) _stop();
      return;
    }
    const rawText = _TTS.utterances[_TTS.idx];
    if(!rawText?.trim()){ _TTS.idx++; _speakNext(); return; }

    // 限 150 字，超過截斷插回佇列（Android bug：長段落易靜默停止）
    const text = rawText.length > 150
      ? rawText.slice(0, rawText.lastIndexOf('，', 150) + 1 || 150)
      : rawText;
    if(text.length < rawText.length){
      _TTS.utterances.splice(_TTS.idx + 1, 0, rawText.slice(text.length));
    }

    // 若選了 Azure 聲音，改走 Azure 引擎
    if(_TTS.voiceURI && _TTS.voiceURI.startsWith('azure:')){
      await _speakAzure(text, _TTS.voiceURI.replace('azure:',''));
      return;
    }

    const utter    = new SpeechSynthesisUtterance(text);
    utter.lang     = 'zh-TW';
    utter.rate     = _TTS.rate;
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

  // ── 暫停 / 繼續 / 停止 ───────────────────────────────────────
  function _pause(){
    if(!_TTS.paused){
      if(_TTS.audio) _TTS.audio.pause();
      else speechSynthesis.pause();
      _TTS.paused = true;
      _updatePanelState();
    }
  }
  function _resume(){
    if(_TTS.paused){
      if(_TTS.audio) _TTS.audio.play().catch(()=>{});
      else speechSynthesis.resume();
      _TTS.paused = false;
      _updatePanelState();
    }
  }
  function _stop(){
    _stopKeepalive();
    speechSynthesis.cancel();
    if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
    _prefetchCache = null;
    _TTS.speaking = false;
    _TTS.paused   = false;
    _TTS.idx      = 0;
    _updatePanelState();
  }

  // ── Keepalive（Android speechSynthesis 靜默停止防護）────────
  let _keepaliveTimer = null;
  function _startKeepalive(){
    _stopKeepalive();
    _keepaliveTimer = setInterval(()=>{
      if(_TTS.speaking && !_TTS.paused && !speechSynthesis.speaking){
        _speakNext();
      }
    }, 3000);
  }
  function _stopKeepalive(){
    if(_keepaliveTimer){ clearInterval(_keepaliveTimer); _keepaliveTimer = null; }
  }

  // ── 取得 epub 當前章節文字 ──────────────────────────────────
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
      // fallback：從 iframe DOM 取
      const viewer = document.getElementById('epub-viewer');
      const iframe = viewer?.querySelector('iframe');
      const doc    = iframe?.contentDocument || iframe?.contentWindow?.document;
      if(!doc) return [];
      const paras  = [...doc.body.querySelectorAll('p,h1,h2,h3,h4,li')]
        .map(el => el.innerText?.trim()).filter(t => t && t.length > 1);
      return paras.length ? paras : [doc.body.innerText?.trim()].filter(Boolean);
    }catch(e){ return []; }
  }

  // ── 取得法條文字（純文字，無 emoji）────────────────────────
  function _getLawText(){
    const lawName    = window.currentLawName    || document.getElementById('lv-name')?.textContent?.trim() || '';
    const lawContent = window.currentLawContent || '';
    if(!lawContent && !lawName) return [];
    const segments = lawName ? [lawName] : [];
    if(lawContent){
      lawContent.split('\n').map(s=>s.trim()).filter(s=>s.length>1)
        .forEach(s => segments.push(s));
    }
    return segments;
  }

  // ── 浮動控制列 ───────────────────────────────────────────────
  async function _createPanel(mode){
    const existing = document.getElementById('tts-panel');
    if(existing) existing.remove();

    // 等待聲音清單載入（Chrome 非同步，最多等 500ms）
    if(!speechSynthesis.getVoices().length){
      await new Promise(resolve=>{
        const t = setTimeout(resolve, 500);
        const prev = speechSynthesis.onvoiceschanged;
        speechSynthesis.onvoiceschanged = ()=>{
          clearTimeout(t);
          speechSynthesis.onvoiceschanged = prev;  // 還原，不覆寫全域 handler
          resolve();
        };
      });
    }

    const voices    = _getVoices();
    const azureKey  = await getSetting('tts_azure_key','').catch(()=>'');

    // 系統聲音選項
    let voiceOpts = voices.map(v => {
      const name = v.name.replace(/\s*\([^)]*\)/g,'').trim();
      const sel  = v.voiceURI === _TTS.voiceURI ? ' selected' : '';
      return `<option value="${v.voiceURI}"${sel}>${name}</option>`;
    }).join('');

    // Azure 聲音選項（有設 Key 才顯示）
    if(azureKey){
      const azureVoices = [
        { id:'azure:zh-TW-HsiaoChenNeural', name:'🟣 Azure 曉臻（女）' },
        { id:'azure:zh-TW-YunJheNeural',    name:'🟣 Azure 雲哲（男）' },
      ];
      voiceOpts += azureVoices.map(v=>{
        const sel = v.id === _TTS.voiceURI ? ' selected' : '';
        return `<option value="${v.id}"${sel}>${v.name}</option>`;
      }).join('');
    }

    const hasChoice = voices.length > 0 || !!azureKey;

    const panel = document.createElement('div');
    panel.id = 'tts-panel';
    panel.innerHTML = `
      <!-- 迷你浮動球（收合狀態）-->
      <button id="tts-miniball" class="tts-miniball" onclick="_ttsExpand()" title="展開">
        <svg id="tts-ball-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="1"/>
          <rect x="14" y="4" width="4" height="16" rx="1"/>
        </svg>
      </button>

      <!-- 完整控制列 -->
      <div class="tts-sheet" id="tts-sheet">
        <div class="tts-handle" onclick="_ttsCollapse()"></div>

        <!-- 資訊列 -->
        <div class="vp-info" style="padding:0 14px 8px">
          <div class="vp-info-text">
            <div class="vp-title" style="font-size:15px">
              ${mode === 'epub' ? '📖 朗讀本頁' : '⚖ 朗讀法條'}
            </div>
            <div class="vp-artist">
              <span id="tts-progress">—</span>
            </div>
          </div>
          <button onclick="_ttsCollapse()" class="vpc-btn vpc-sm" style="color:rgba(255,255,255,0.4)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>

        <!-- 聲音選擇（有多個時才顯示）-->
        ${hasChoice ? `
        <div style="padding:0 16px 10px;display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:rgba(255,255,255,0.3);flex-shrink:0">聲音</span>
          <select id="tts-voice-sel" class="tts-voice-sel" onchange="_ttsSetVoice(this.value)">
            ${voiceOpts}
          </select>
        </div>` : ''}

        <!-- 語速列 -->
        <div class="vp-progress-wrap">
          <input id="tts-rate" class="vp-seek" type="range"
            min="0.5" max="2" step="0.1" value="${_TTS.rate}"
            style="--seek-pct:33%"
            oninput="_ttsSetRate(this.value)">
          <div class="vp-times">
            <span style="font-size:11px;color:rgba(255,255,255,0.3)">慢</span>
            <span id="tts-rate-lbl" style="font-size:11px;color:rgba(255,255,255,0.6)">${_TTS.rate}x</span>
            <span style="font-size:11px;color:rgba(255,255,255,0.3)">快</span>
          </div>
        </div>

        <!-- 控制按鈕列 -->
        <div class="vp-controls">
          <button class="vpc-btn vpc-side" onclick="_ttsStop()" title="停止">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
          </button>
          <button id="tts-playpause" class="vpc-btn vpc-main" onclick="_ttsToggle()">
            <svg id="tts-pp-icon" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          </button>
          <button class="vpc-btn vpc-side" onclick="_ttsCollapse()" title="收合">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
    const icon = document.getElementById('tts-pp-icon');
    const prog = document.getElementById('tts-progress');
    const iconSvg = _TTS.paused
      ? '<polygon points="5,3 19,12 5,21"/>'
      : '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
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
    if(_TTS.speaking){
      _stop();
      // 停止時還原按鈕外觀
      const btn = document.getElementById('tts-epub-btn');
      if(btn){ btn.style.color=''; btn.style.opacity=''; }
      return;
    }
    // 開始朗讀時標示按鈕
    const btn = document.getElementById('tts-epub-btn');
    if(btn){ btn.style.color='var(--acc)'; btn.style.opacity='1'; }
    let segments = _getEpubPageText();
    if(segments && typeof segments.then === 'function')
      segments = await segments.catch(()=>[]);
    if(!segments?.length){ toast('無法取得頁面文字'); return; }
    _speak(segments, 'epub');
  };

  window.ttsReadLaw = function(){
    if(_TTS.speaking){ _stop(); return; }
    const segments = _getLawText();
    if(!segments.length){ toast('沒有可朗讀的法條'); return; }
    _speak(segments, 'law');
  };

  window._ttsToggle = ()=>{ _TTS.paused ? _resume() : _pause(); };

  window._ttsStop = ()=>{
    _stop();
    // 還原喇叭按鈕外觀
    const btn = document.getElementById('tts-epub-btn');
    if(btn){ btn.style.color=''; btn.style.opacity=''; }
    if(_TTS.panel){
      _TTS.panel.style.transition = 'opacity .3s,transform .3s';
      _TTS.panel.style.opacity    = '0';
      _TTS.panel.style.transform  = 'translateY(12px)';
      const p = _TTS.panel;
      setTimeout(()=> p.remove(), 320);
      _TTS.panel = null;
    }
  };

  window._ttsSetRate = (v)=>{
    _TTS.rate = parseFloat(v);
    const lbl = document.getElementById('tts-rate-lbl');
    if(lbl) lbl.textContent = _TTS.rate.toFixed(1)+'x';
    const slider = document.getElementById('tts-rate');
    if(slider){
      const pct = ((_TTS.rate - 0.5) / 1.5 * 100).toFixed(1);
      slider.style.setProperty('--seek-pct', pct + '%');
    }
    if(_TTS.speaking && !_TTS.paused){
      speechSynthesis.cancel();
      setTimeout(()=> _speakNext(), 80);
    }
  };

  window._ttsSetVoice = async (uri)=>{
    _TTS.voiceURI = uri;
    setSetting('tts_voice_uri', uri).catch(()=>{});
    if(_TTS.speaking && !_TTS.paused){
      speechSynthesis.cancel();
      await new Promise(r => setTimeout(r, 80));
      _speakNext();
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

  // 聲音清單非同步載入（Chrome 需要等 onvoiceschanged）
  function _initDefaultVoice(){
    const voices = _getVoices();
    if(!voices.length) return;
    // 若未選或選了不存在的聲音，重設為第一個
    if(!_TTS.voiceURI || !voices.find(v => v.voiceURI === _TTS.voiceURI)){
      _TTS.voiceURI = voices[0].voiceURI;
    }
    const sel = document.getElementById('tts-voice-sel');
    if(sel) sel.value = _TTS.voiceURI;
  }

  // 讀取上次儲存的聲音選擇
  getSetting('tts_voice_uri', '').then(uri => {
    if(uri) _TTS.voiceURI = uri;
  }).catch(()=>{});

  if(typeof speechSynthesis !== 'undefined'){
    if(speechSynthesis.onvoiceschanged !== undefined)
      speechSynthesis.onvoiceschanged = _initDefaultVoice;
    if(speechSynthesis.getVoices().length) _initDefaultVoice();
  }

  window.addEventListener('beforeunload', ()=> speechSynthesis.cancel());

})();
