// ══ folder-native.js — App 版的資料夾存取（v4.56.0）═══════════════
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
