// ══ folder-native.js — App 版的相容層（v4.56.0 資料夾存取；v4.57.0 下載、開啟 App 內檔案）══
// Android App（Capacitor）的 WebView 沒有瀏覽器的 showDirectoryPicker。
// 有 YcFolder 原生外掛時，在這裡補上同樣的介面（目錄／檔案 handle：getFileHandle、getDirectoryHandle、
// entries、removeEntry、getFile、createWritable），settings.js 的資料夾備份／還原原封不動就能用，
// 備份格式和電腦、平板完全相同，可互相還原。瀏覽器版不載入任何東西。
// ════════════════════════════════════════════════════════════
(function(){
  const C = window.Capacitor;
  const F = C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.YcFolder;
  if(!F) return;
  const err = (name, msg) => Object.assign(new Error(msg), { name });
  const CHUNK = 3 * 1024 * 1024;

  const MIME = { json:'application/json', pdf:'application/pdf', epub:'application/epub+zip', txt:'text/plain',
    mp3:'audio/mpeg', m4a:'audio/mp4', mp4:'video/mp4', webm:'video/webm', opus:'audio/ogg', ogg:'audio/ogg',
    wav:'audio/wav', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp' };
  const mimeOf = n => MIME[String(n).split('.').pop().toLowerCase()] || '';

  // Blob 一段 → base64（用瀏覽器內建的 FileReader，比自己轉快）
  const b64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => rej(r.error || new Error('讀取失敗'));
    r.readAsDataURL(blob);
  });
  const unb64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  class DirH {
    constructor(uri, name){ this.uri = uri; this.name = name; this.kind = 'directory'; this._native = true; this._kids = null; }
    async _list(){
      if(!this._kids){ const r = await F.list({ uri:this.uri }); this._kids = new Map((r.items || []).map(x => [x.name, x])); }
      return this._kids;
    }
    async _get(name, dir, create){
      const kids = await this._list();
      let x = kids.get(name);
      if(x && !!x.dir !== dir) throw err('TypeMismatchError', '「' + name + '」' + (dir ? '不是資料夾' : '是資料夾'));
      if(!x){
        if(!create) throw err('NotFoundError', '找不到「' + name + '」');
        const r = await F.create({ uri:this.uri, name, dir });
        if(r.name && r.name !== name && typeof logError === 'function') logError('folder-native', new Error('系統把「' + name + '」改名為「' + r.name + '」'));
        x = { name, uri:r.uri, dir, size:0, mtime:Date.now() };
        kids.set(name, x);
      }
      return dir ? new DirH(x.uri, name) : new FileH(x);
    }
    getFileHandle(name, o){ return this._get(name, false, !!(o && o.create)); }
    getDirectoryHandle(name, o){ return this._get(name, true, !!(o && o.create)); }
    async removeEntry(name){
      const kids = await this._list(), x = kids.get(name);
      if(!x) throw err('NotFoundError', '找不到「' + name + '」');
      await F.remove({ uri:x.uri });
      kids.delete(name);
    }
    async *entries(){
      for(const x of [...(await this._list()).values()]) yield [x.name, x.dir ? new DirH(x.uri, x.name) : new FileH(x)];
    }
    async *values(){ for await(const [, h] of this.entries()) yield h; }
    async *keys(){ for await(const [n] of this.entries()) yield n; }
    async queryPermission(){ return 'granted'; }
    async requestPermission(){ return 'granted'; }
  }

  class FileH {
    constructor(x){ this._x = x; this.name = x.name; this.kind = 'file'; this._native = true; }
    // 整份讀成 File（先複製到 App 暫存檔，再由 WebView 讀進來；讀完刪掉暫存檔）
    async getFile(){
      const r = await F.readToCache({ uri:this._x.uri });
      try{
        const res = await fetch(C.convertFileSrc(r.path));
        if(!res.ok) throw new Error('讀取「' + this.name + '」失敗（' + res.status + '）');
        const raw = await res.blob();
        return new File([raw], this.name, { type:mimeOf(this.name), lastModified:this._x.mtime || Date.now() });
      }finally{ F.dropCache({ path:r.path }).catch(()=>{}); }
    }
    // 比對內容用（settings.js _sameFile）：不必整份讀進來，只讀要比的那幾段
    _lazyFile(){
      const x = this._x;
      return { size:x.size, slice:(s, e) => ({ arrayBuffer:async () => {
        const r = await F.readRange({ uri:x.uri, start:s, end:Math.min(e, x.size) });
        return unb64(r.b64 || '').buffer;
      } }) };
    }
    async createWritable(){
      const x = this._x;
      let id = null, size = 0;
      const open = async () => { if(id == null){ id = (await F.writeOpen({ uri:x.uri })).id; } };
      return {
        async write(data){
          if(data && typeof data === 'object' && data.type === 'write' && 'data' in data) data = data.data;
          const blob = data instanceof Blob ? data : new Blob([data]);
          await open();
          for(let p = 0; p < blob.size; p += CHUNK) await F.writeChunk({ id, b64:await b64(blob.slice(p, p + CHUNK)) });
          size += blob.size;
        },
        async close(){ await open(); await F.writeClose({ id }); x.size = size; x.mtime = Date.now(); },
        async abort(){ if(id != null) await F.writeClose({ id }).catch(()=>{}); },
      };
    }
  }

  // ── v4.57 下載：網頁的 <a download> 在 App 裡沒有作用 → 存到手機「下載／Y.C.」資料夾 ──
  async function saveDownload(blob, name, mime){
    try{
      const r = await F.downloadOpen({ name, mime:mime || blob.type || 'application/octet-stream' });
      const id = (await F.writeOpen({ uri:r.uri })).id;
      try{ for(let p = 0; p < blob.size; p += CHUNK) await F.writeChunk({ id, b64:await b64(blob.slice(p, p + CHUNK)) }); }
      finally{ await F.writeClose({ id }); }
      if(typeof toast === 'function') toast('已存到手機「下載／Y.C.」：' + (r.name || name), 3500);
    }catch(e){
      if(typeof toast === 'function') toast('存檔失敗：' + (e.message || e));
      if(typeof logError === 'function') logError('appDownload', e);
    }
  }
  window._ycSaveDownload = saveDownload;
  window.dl = function(c, fn, t = 'text/plain'){
    const blob = c instanceof Blob ? c : new Blob([c], { type:t });
    return saveDownload(blob, fn, blob.type || t);
  };

  // ── v4.57 開啟 App 內的檔案（例：Apps Script 程式碼）：WebView 會整個跳過去、回不來 → 改在視窗裡顯示，可複製 ──
  const _open = window.open.bind(window);
  window.open = function(url, target, features){
    let u = null;
    try{ u = new URL(url, location.href); }catch(_){}
    if(u && u.origin === location.origin){ showLocal(u.href); return null; }
    return _open(url, target, features);   // 外部網址：App 會用手機的瀏覽器開
  };
  async function showLocal(href){
    let text = '';
    try{ const r = await fetch(href, { cache:'no-store' }); if(!r.ok) throw new Error(r.status); text = await r.text(); }
    catch(e){ if(typeof toast === 'function') toast('App 裡沒有這個檔案'); return; }
    document.getElementById('yc-txt-ov')?.remove();
    const ov = document.createElement('div');
    ov.id = 'yc-txt-ov';
    ov.className = 'media-ov-sheet z700-d';
    const name = decodeURIComponent(href.split('/').pop() || '');
    ov.innerHTML = '<div class="yt-sheet" style="height:88vh"><div class="yt-sheet-hd"><div class="yt-sheet-title"></div>'
      + '<button class="yt-x" aria-label="關閉">✕</button></div>'
      + '<div style="display:flex;gap:8px;margin-bottom:8px"><button class="yt-btn pri" data-act="copy">複製全部</button><button class="yt-btn" data-act="save">存到下載資料夾</button></div>'
      + '<pre style="flex:1;overflow:auto;margin:0;padding:10px;border-radius:10px;background:var(--bg2);color:var(--t1);font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all;user-select:text;-webkit-user-select:text"></pre></div>';
    ov.querySelector('.yt-sheet-title').textContent = name;
    ov.querySelector('pre').textContent = text;
    ov.querySelector('.yt-x').onclick = () => ov.remove();
    ov.querySelector('[data-act=copy]').onclick = async () => {
      try{ await navigator.clipboard.writeText(text); toast('已複製'); }
      catch(_){ const sel = getSelection(), rg = document.createRange(); rg.selectNodeContents(ov.querySelector('pre')); sel.removeAllRanges(); sel.addRange(rg); toast('請長按選取的文字複製'); }
    };
    ov.querySelector('[data-act=save]').onclick = () => saveDownload(new Blob([text], { type:'text/plain' }), name + (/\.txt$/.test(name) ? '' : '.txt'), 'text/plain');
    ov.onclick = e => { if(e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  }

  window.showDirectoryPicker = async () => {
    try{
      const r = await F.pick();
      return (window._ycFolderLast = new DirH(r.uri, r.name || '資料夾'));   // 最後選的資料夾（除錯用）
    }catch(e){
      if(/取消/.test(e.message || '') || e.code === 'AbortError') throw err('AbortError', '已取消');
      throw e;
    }
  };
})();

// ── v4.57 朗讀：App 的 WebView 沒有 speechSynthesis → 用 Android 系統朗讀（YcTts 外掛）補上同樣的介面 ──
//   朗讀程式（tts.js、english.js、engexam.js）不用改；系統朗讀不能暫停，暫停＝先停下、繼續時從這一句重唸
(function(){
  const C = window.Capacitor;
  const T = C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.YcTts;
  if(!T || 'speechSynthesis' in window) return;
  class Utterance extends EventTarget {
    constructor(text){ super(); this.text = text || ''; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1;
      this.onstart = this.onend = this.onerror = this.onboundary = this.onpause = this.onresume = this.onmark = null; }
  }
  const live = new Map();
  let seq = 0, voices = [];
  const fire = (u, type, extra) => {
    const ev = Object.assign(new Event(type), { utterance:u, charIndex:0, elapsedTime:0 }, extra || {});
    try{ const h = u['on' + type]; if(typeof h === 'function') h.call(u, ev); }catch(e){ console.error(e); }
    u.dispatchEvent(ev);
  };
  const ss = new EventTarget();
  Object.assign(ss, {
    speaking:false, paused:false, pending:false, onvoiceschanged:null, _held:null,
    getVoices(){ return voices; },
    speak(u){
      if(!(u instanceof Utterance)) return;
      if(ss.paused){ (ss._held = ss._held || []).push(u); return; }
      const id = 'u' + (++seq);
      live.set(id, u); ss.pending = true;
      T.speak({ id, text:String(u.text || ''), lang:u.lang || '', voice:u.voice ? u.voice.voiceURI : '',
        rate:+u.rate || 1, pitch:+u.pitch || 1, volume:u.volume == null ? 1 : +u.volume })
        .catch(() => { if(live.delete(id)) fire(u, 'error', { error:'synthesis-failed' }); });
    },
    cancel(){
      const us = [...live.values()];
      live.clear(); ss._held = null;
      ss.speaking = ss.pending = ss.paused = false;
      T.cancel().catch(()=>{});
      us.forEach((u, i) => fire(u, 'error', { error:i ? 'canceled' : 'interrupted' }));
    },
    pause(){
      if(ss.paused) return;
      ss.paused = true;
      ss._held = [...live.values()];
      live.clear();
      ss.speaking = false;
      T.cancel().catch(()=>{});
    },
    resume(){
      if(!ss.paused) return;
      ss.paused = false;
      const h = ss._held || []; ss._held = null;
      h.forEach(u => ss.speak(u));
    },
  });
  T.addListener('tts', e => {
    const u = live.get(e.id); if(!u) return;
    if(e.type === 'start'){ ss.speaking = true; fire(u, 'start'); return; }
    live.delete(e.id);
    if(!live.size){ ss.speaking = false; ss.pending = false; }
    fire(u, e.type === 'error' ? 'error' : 'end', e.type === 'error' ? { error:'synthesis-failed' } : {});
  });
  T.getVoices().then(r => {
    voices = (r.voices || []).map(v => ({ voiceURI:v.name, name:v.lang + (v.local ? '' : '（需網路）') + '・' + v.name,
      lang:v.lang, localService:!!v.local, default:v.name === r.default }));
    const ev = new Event('voiceschanged');
    try{ if(typeof ss.onvoiceschanged === 'function') ss.onvoiceschanged(ev); }catch(e){ console.error(e); }
    ss.dispatchEvent(ev);
  }).catch(()=>{});
  window.speechSynthesis = ss;
  window.SpeechSynthesisUtterance = Utterance;
})();
