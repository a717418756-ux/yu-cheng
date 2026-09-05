// ════════════════════════════════════════════════════════════
// 【TTS 語音朗讀模組（Azure + 瀏覽器語音，含預取）】
// ════════════════════════════════════════════════════════════
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
    highlightEls: null, // 朗讀同步反白：每段對應的 DOM 元素（法條卡片）
    _turning:   false,  // epub 自動翻頁續讀中的防重入旗標
    _lastChapFp: null,  // epub 章節去重指紋（避免翻頁後重複唸同章）
  };

  // ── Azure TTS via GAS ───────────────────────────────────────
  // 快取 Azure 設定（避免每段都讀 IndexedDB）
  let _azureCache = null;  // { key, url, ts } — 僅快取已設定的值
  async function _loadAzureConfig(){
    const now = Date.now();
    // 快取 30 秒，且只在 key/url 都有值時才快取（避免快取空值）
    if(_azureCache && _azureCache.key && _azureCache.url && now - _azureCache.ts < 30000){
      return _azureCache;
    }
    const key = await getSetting('tts_azure_key','').catch(()=>'');
    const url = await getSetting('gasWebAppUrl','').catch(()=>'');
    if(key && url) _azureCache = { key, url, ts: now };
    return { key, url };
  }

  // 分段長度上限（依引擎而定）
  //   系統語音：Android 的 speechSynthesis 遇長段落會靜默停止，必須限 150 字。
  //   Azure：播的是預先合成好的 mp3（HTML <audio>），沒有上述問題，
  //          用較大分段 → 網路往返次數減半、接縫變少，朗讀更連貫。
  function _segLimit(){
    return (_TTS.voiceURI && _TTS.voiceURI.startsWith('azure:')) ? 300 : 150;
  }

  // 段落截斷規則（播放與 prefetch 共用，兩邊必須完全一致，
  // 否則預抓的音訊比實際要唸的段落長 → 後續段落被重複朗讀）
  function _truncSeg(raw){
    const lim = _segLimit();
    return raw.length > lim
      ? raw.slice(0, raw.lastIndexOf('，', lim) + 1 || lim)
      : raw;
  }

  // Prefetch：預先 fetch 下一段音訊，減少段落間停頓
  let _prefetchCache = null;  // { idx, promise }
  function _prefetchNext(idx, voiceName){
    const nextIdx  = idx + 1;
    const nextRaw  = _TTS.utterances[nextIdx];
    if(!nextRaw?.trim()) return;
    // ★ 必須與 _speakNext 用同一套截斷，快取音訊才會等於屆時真正要唸的文字
    const nextText = _truncSeg(nextRaw);
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
            rate:_TTS.rate, azureKey, region:'eastasia',
          }),
        })
        .then(r => r.ok ? r.json() : null)
        // 只有真正成功（ok 且有 audio）才當有效快取，否則回 null 讓主流程重抓
        .then(j => (j && j.ok && j.audio) ? j : null)
        .catch(()=>null);
      }),
    };
  }

  async function _speakAzure(text, voiceName){
    // 缺設定時：明確提示並停止，不要默默改用離線聲音（避免使用者誤以為 Azure 壞了）
    const { key:azureKey, url:gasUrl } = await _loadAzureConfig();
    if(!azureKey || !gasUrl){
      const miss = !azureKey && !gasUrl ? 'Azure Key 和 GAS 網址'
                 : !gasUrl ? 'GAS 網址' : 'Azure Key';
      toast(`Azure 朗讀需要${miss}，請到設定頁填入`);
      console.warn('[Azure TTS] 設定不完整：', { hasKey:!!azureKey, hasUrl:!!gasUrl });
      _stop();
      return;
    }
    try{
      console.log('[Azure TTS] 請求中:', { voiceName, textLen:text.length, gasUrl:gasUrl.slice(0,40)+'…' });

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
          body: JSON.stringify({ action:'azure_tts', text, voiceName, rate:_TTS.rate, azureKey, region:'eastasia' }),
        });
        if(!res.ok) throw new Error(`GAS HTTP ${res.status}`);
        json = await res.json();
      }
      console.log('[Azure TTS] GAS 回傳:', { ok:json?.ok, hasAudio:!!json?.audio, audioLen:json?.audio?.length||0, error:json?.error });
      if(!json.ok) throw new Error(json.error || '無回傳音訊');
      if(!json.audio) throw new Error('GAS 回傳缺少 audio 欄位');
      // 播放 base64 mp3（存到 _TTS.audio 讓 _pause/_stop 可控制）
      if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
      return new Promise(resolve=>{
        const audio = new Audio('data:audio/mp3;base64,' + json.audio);
        _TTS.audio = audio;
        // 開始播放時預先 fetch 下一段（減少段落間停頓）
        _prefetchNext(_TTS.idx, voiceName);
        // ★ 防止 onended/onerror/play().catch 多重觸發造成同段重複或跳段：
        //   每次播放只允許「結算」一次
        let _settled = false;
        const _advance = (bump)=>{
          if(_settled) return;
          _settled = true;
          _TTS.audio = null;
          if(!_TTS.speaking){ resolve(); return; }
          if(bump) _TTS.idx++;
          _updatePanelState();
          _speakNext();
          resolve();
        };
        audio.onended = ()=> _advance(true);
        audio.onerror = (ev)=>{
          console.error('[Azure TTS] audio 播放錯誤:', audio.error?.code, audio.error?.message);
          _advance(true);
        };
        audio.play().then(()=>{
          console.log('[Azure TTS] 開始播放 ✓');
        }).catch((err)=>{
          console.error('[Azure TTS] audio.play() 被拒:', err.name, err.message);
          // 自動播放被擋時，不要跳過該段，改用系統 TTS 念出來
          if(_settled) return;
          _settled = true;
          _TTS.audio = null;
          _speakWithSystem(text);
          resolve();
        });
      });
    }catch(e){
      console.error('[Azure TTS]', e.message);
      // Azure 失敗時 fallback 到系統 TTS（讓使用者至少聽得到聲音）
      toast('Azure TTS 失敗，改用系統語音');
      _speakWithSystem(text);
    }
  }

  // 系統 TTS fallback（中文）
  function _speakWithSystem(text){
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = 'zh-TW';
    utter.rate  = _TTS.rate;
    utter.onend = ()=>{
      if(!_TTS.speaking) return;
      _TTS.idx++;
      _updatePanelState();
      _speakNext();
    };
    utter.onerror = (e)=>{
      // 與另一條系統語音路徑一致的防護：
      //   interrupted/canceled 代表是程式主動 cancel（停止、切換聲音、調語速），
      //   不是真的播放失敗，此時不可前進，否則會憑空跳過一段。
      if(e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      if(!_TTS.speaking) return;   // 已停止朗讀就不再推進
      _TTS.idx++;
      _speakNext();
    };
    if(!_keepaliveTimer) _startKeepalive();
    speechSynthesis.speak(utter);
  }

  // ── 取得系統 zh-TW 聲音，去重 ──────────────────────────────
  function _getVoices(){
    const all = speechSynthesis.getVoices();
    const seen = new Set();
    const dedup = (list) => list.filter(v => {
      const key = v.name.replace(/\s+/g,'').toLowerCase();
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // 優先 zh-TW；若無則取任何含「中文」或 zh 的聲音
    const tw = all.filter(v => v.lang === 'zh-TW');
    if(tw.length) return dedup(tw);
    const zh = all.filter(v => v.lang.startsWith('zh') || v.name.includes('Chinese') || v.name.includes('中文'));
    return dedup(zh);
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
      // epub 模式：本頁唸完 → 自動翻下一頁並續讀（法條等其他模式維持原本停止行為）
      if(_TTS.speaking && _TTS.mode === 'epub' && !_TTS._turning){
        _epubAdvanceAndContinue();
        return;
      }
      if(_TTS.speaking) _stop();
      return;
    }
    const rawText = _TTS.utterances[_TTS.idx];
    if(!rawText?.trim()){ _TTS.idx++; _speakNext(); return; }

    // 朗讀同步反白：高亮當前段對應的 DOM 元素（法條卡片）
    _applyReadingHighlight(_TTS.idx);

    // 限 150 字，超過截斷插回佇列（Android bug：長段落易靜默停止）
    const text = _truncSeg(rawText);
    if(text.length < rawText.length){
      // ★ 佇列同步更新為「實際唸出的那一段」：原本這裡留著未截斷全文，
      //   只要 idx 有任何一次沒推進，就會重複朗讀同一小段。
      _TTS.utterances[_TTS.idx] = text;
      _TTS.utterances.splice(_TTS.idx + 1, 0, rawText.slice(text.length));
      // highlightEls 同步插入（截斷出的後半段沿用同一元素），避免索引錯位
      if(Array.isArray(_TTS.highlightEls)){
        _TTS.highlightEls.splice(_TTS.idx + 1, 0, _TTS.highlightEls[_TTS.idx] || null);
      }
    }

    // 若選了 Azure 聲音，直接走 Azure 引擎（內部會自行檢查 key/url 並 fallback）
    if(_TTS.voiceURI && _TTS.voiceURI.startsWith('azure:')){
      _stopKeepalive();   // 清掉先前系統語音 fallback 可能殘留的計時器，避免它打斷 Azure
      await _speakAzure(text, _TTS.voiceURI.replace('azure:',''));
      return;
    }

    const utter    = new SpeechSynthesisUtterance(text);
    utter.lang     = 'zh-TW';
    utter.rate     = _TTS.rate;
    if(_TTS.voiceURI && _TTS.voiceURI !== 'default'){
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
      if(e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      if(!_TTS.speaking) return;   // 已停止朗讀就不再推進（與 onend 的判斷一致）
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
    _TTS._turning = false;      // 重置翻頁旗標，避免停止後卡住
    _clearReadingHighlight();      // 清除朗讀同步反白
    _TTS.highlightEls = null;
    _updatePanelState();
  }

  // ── Keepalive（Android speechSynthesis 靜默停止防護）────────
  let _keepaliveTimer = null;
  function _startKeepalive(){
    _stopKeepalive();
    _keepaliveTimer = setInterval(()=>{
      // ★ Azure 用 HTML <audio> 播放，speechSynthesis.speaking 恆為 false。
      //   若不排除，這裡會每 3 秒對「同一個 idx」再呼叫一次 _speakNext()，
      //   造成同一小段被重新抓取並重播 → 症狀：一小段無限重複。
      //   keepalive 只為了解決系統語音在 Android 的靜默停止，Azure 不需要也不相容。
      if(_TTS.audio) return;                                           // Azure 音訊播放中
      if(_TTS.voiceURI && _TTS.voiceURI.startsWith('azure:')) return;  // 目前選用 Azure 引擎
      if(_TTS.speaking && !_TTS.paused && !speechSynthesis.speaking){
        _speakNext();
      }
    }, 3000);
  }
  function _stopKeepalive(){
    if(_keepaliveTimer){ clearInterval(_keepaliveTimer); _keepaliveTimer = null; }
  }

  // ── 取得 epub 當前章節文字 ──────────────────────────────────
  // 策略：優先從 iframe DOM 抓（最穩定）；若抓不到再用 epub.js API
  function _getEpubPageText(){
    // 取「整章」文字一次給足：段落多 → prefetch 有效 → 段落間無延遲。
    //   配合 _ttsSpokenChap 去重（記錄已唸過的章節指紋），避免翻頁後重複唸同一章。
    //   不取「當前頁」是因為分頁模式一頁段落太少，會頻繁翻頁+等待，造成明顯間隔。
    let result = null;
    try{
      const viewer = document.getElementById('epub-viewer');
      const iframes = viewer ? [...viewer.querySelectorAll('iframe')] : [];
      for(const iframe of iframes){
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if(!doc || !doc.body) continue;
        const paras = [...doc.body.querySelectorAll('p,h1,h2,h3,h4,li,div')]
          .map(el => el.innerText?.trim()).filter(t => t && t.length > 1);
        if(paras.length){ result = paras; break; }
        const raw = doc.body.innerText?.trim();
        if(raw && raw.length > 1){
          result = raw.split(/\n+/).map(s=>s.trim()).filter(s=>s.length>1);
          break;
        }
      }
    }catch(e){}
    if(!result || !result.length) return [];

    // 章節去重：用前 3 段組指紋，若與上次相同 → 這章已唸過（翻頁停在同章），回空讓上層續翻
    const fp = result.slice(0,3).join('|').slice(0,120);
    if(_TTS._lastChapFp === fp) return null;   // null = 同章，交由翻頁邏輯處理
    _TTS._lastChapFp = fp;
    return result;
  }

  // ── epub 朗讀：本頁唸完自動翻下一頁並續讀 ─────────────────────
  // 翻頁後需等 iframe 重新渲染，才能取到新頁文字。用 relocated 事件 + 逾時保底。
  async function _epubAdvanceAndContinue(){
    const rendition = window._epubRendition;
    if(!rendition){ _stop(); return; }
    _TTS._turning = true;  // 防重入旗標

    // 連續翻頁，直到取到「新章文字」或到書末（同章時 _getEpubPageText 回 null）
    let guard = 0;                       // 防無限翻頁上限
    while(guard++ < 60){
      let beforeCfi = '';
      try{ beforeCfi = rendition.currentLocation()?.start?.cfi || ''; }catch(e){}

      const waitRelocated = ()=> new Promise(resolve=>{
        let done = false;
        const onRel = ()=>{ if(done) return; done = true; rendition.off('relocated', onRel); resolve(); };
        rendition.on('relocated', onRel);
        setTimeout(()=>{ if(done) return; done = true; rendition.off('relocated', onRel); resolve(); }, 600);
      });

      try{
        rendition.next();
        await waitRelocated();
      }catch(e){ _TTS._turning=false; _stop(); return; }

      if(!_TTS.speaking){ _TTS._turning=false; return; }  // 被停止

      // 到書末（位置沒變）→ 結束
      let afterCfi = '';
      try{ afterCfi = rendition.currentLocation()?.start?.cfi || ''; }catch(e){}
      if(afterCfi && beforeCfi && afterCfi === beforeCfi){
        _TTS._turning=false; _stop(); toast('已讀完'); return;
      }

      // 取新位置文字
      let segs = _getEpubPageText();
      if(segs && typeof segs.then === 'function') segs = await segs.catch(()=>[]);

      if(segs === null) continue;         // 同章，繼續翻下一頁
      if(!_TTS.speaking){ _TTS._turning=false; return; }
      if(!segs?.length){ continue; }      // 空白頁，繼續翻（不停止）

      // 取到新章文字 → 續讀
      _prefetchCache = null;              // 清舊頁預抓，避免重複播放
      _TTS.utterances = segs;
      _TTS.idx = 0;
      _TTS._turning = false;
      _speakNext();
      return;
    }
    // 翻頁超過上限（防呆）
    _TTS._turning=false; _stop();
  }

  // ── 取得法條文字（純文字，無 emoji）────────────────────────
  // 套用朗讀反白到第 idx 段對應的元素，並捲動到可視區
  function _applyReadingHighlight(idx){
    const els = _TTS.highlightEls;
    if(!Array.isArray(els)) return;
    _clearReadingHighlight();
    const el = els[idx];
    if(!el) return;
    el.classList.add('tts-reading-hl');
    try{ el.scrollIntoView({ behavior:'smooth', block:'center' }); }catch(_){}
  }
  // 清除所有朗讀反白
  function _clearReadingHighlight(){
    document.querySelectorAll('.tts-reading-hl')
      .forEach(el => el.classList.remove('tts-reading-hl'));
  }

  function _getLawText(){
    const lawName    = window.currentLawName    || document.getElementById('lv-name')?.textContent?.trim() || '';
    const lawContent = window.currentLawContent || '';
    if(!lawContent && !lawName) return [];
    const segments = lawName ? [lawName] : [];
    if(lawContent){
      lawContent.split('\n').map(s=>s.trim()).filter(s=>s.length>1)
        .forEach(s => segments.push(s));
    }
    // 建立段落→法條卡片對應（供朗讀同步反白）：依文字比對找出每段所屬卡片
    try{
      _TTS.highlightEls = _mapSegmentsToLawCards(segments);
    }catch(_){ _TTS.highlightEls = null; }
    return segments;
  }

  // 把朗讀段落對應到畫面上的法條卡片元素（以「條」為高亮單位）
  function _mapSegmentsToLawCards(segments){
    const cards = [...document.querySelectorAll('#lbody .law-art-card[data-law-id]')];
    if(!cards.length) return null;
    // 每張卡片的純文字（去空白）供比對
    const cardTexts = cards.map(c => (c.textContent||'').replace(/\s+/g,''));
    return segments.map(seg=>{
      const key = seg.replace(/\s+/g,'').slice(0, 12);  // 取前段特徵比對
      if(!key) return null;
      const i = cardTexts.findIndex(t => t.includes(key));
      return i >= 0 ? cards[i] : null;
    });
  }

  // ── 浮動控制列 ───────────────────────────────────────────────
  async function _createPanel(mode){
    const existing = document.getElementById('tts-panel');
    if(existing) existing.remove();

    // 等待聲音清單載入（Chrome 非同步，最多等 500ms）
    // 等待聲音清單載入，並加 10ms 緩衝確保 getVoices() 已填充
    if(!speechSynthesis.getVoices().length){
      await new Promise(resolve=>{
        const t = setTimeout(resolve, 600);
        const prev = speechSynthesis.onvoiceschanged;
        speechSynthesis.onvoiceschanged = ()=>{
          speechSynthesis.onvoiceschanged = prev;
          clearTimeout(t);
          setTimeout(resolve, 10); // 給瀏覽器 10ms 填充聲音清單
        };
      });
    } else {
      // 已有聲音但可能未含 zh-TW，等一個 microtask
      await new Promise(r => setTimeout(r, 0));
    }

    const voices    = _getVoices();
    const azureKey  = await getSetting('tts_azure_key','').catch(()=>'');

    // 聲音選項：固定三個（系統預設 + Azure 曉臻 + Azure 雲哲）
    const defSel = (!_TTS.voiceURI || _TTS.voiceURI === 'default') ? ' selected' : '';
    let voiceOpts = `<option value="default"${defSel}>🔵 系統預設（離線）</option>`;

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

    const hasChoice = !!azureKey;  // 只有設定 Azure Key 時才顯示選單

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
    _TTS._lastChapFp = null;   // 重置章節去重指紋（每次重新開始朗讀都要清）
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
      // ★ 與切換聲音相同的處理：speechSynthesis.cancel() 停不掉 Azure 的 <audio>，
      //   不手動停會造成「舊速率還在播、新速率又開始」兩軌重疊；
      //   prefetch 快取是用舊速率合成的，必須丟棄否則下一段仍是舊速率。
      if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
      _prefetchCache = null;
      setTimeout(()=> _speakNext(), 80);
    }
  };

  window._ttsSetVoice = async (uri)=>{
    _TTS.voiceURI = uri;
    setSetting('tts_voice_uri', uri).catch(()=>{});
    if(_TTS.speaking && !_TTS.paused){
      speechSynthesis.cancel();
      // ★ speechSynthesis.cancel() 停不掉 Azure 的 <audio>：
      //   不手動停會變成「舊聲音還在播、新聲音又開始」兩軌重疊；
      //   prefetch 快取也必須丟棄，否則下一段仍是切換前的舊聲音。
      if(_TTS.audio){ _TTS.audio.pause(); _TTS.audio = null; }
      _prefetchCache = null;
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
    // Azure 聲音不在系統 voices 清單裡，屬正常，絕不可被重設覆蓋
    if(_TTS.voiceURI && _TTS.voiceURI.startsWith('azure:')){
      const sel = document.getElementById('tts-voice-sel');
      if(sel) sel.value = _TTS.voiceURI;
      return;
    }
    const voices = _getVoices();
    if(!voices.length) return;
    // 若未選或選了不存在的系統聲音，重設為第一個
    if(!_TTS.voiceURI || _TTS.voiceURI === 'default' || !voices.find(v => v.voiceURI === _TTS.voiceURI)){
      _TTS.voiceURI = voices[0].voiceURI;
    }
    const sel = document.getElementById('tts-voice-sel');
    if(sel) sel.value = _TTS.voiceURI;
  }

  // 讀取上次儲存的聲音選擇；若是 azure: 但 Key 未設定則不套用
  getSetting('tts_voice_uri', '').then(async uri => {
    if(!uri) return;
    if(uri.startsWith('azure:')){
      const key = await getSetting('tts_azure_key','').catch(()=>'');
      if(!key) return;  // Key 不存在，不套用 azure 聲音
    }
    _TTS.voiceURI = uri;
  }).catch(()=>{});

  if(typeof speechSynthesis !== 'undefined'){
    if(speechSynthesis.onvoiceschanged !== undefined)
      speechSynthesis.onvoiceschanged = _initDefaultVoice;
    if(speechSynthesis.getVoices().length) _initDefaultVoice();
  }

  window.addEventListener('beforeunload', ()=> speechSynthesis.cancel());

})();
