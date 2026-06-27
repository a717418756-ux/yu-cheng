// ══ utils.js — 工具函式 ═════════════════════════════════════
// 全域狀態
const S = {
  page:'home', filter:'all', subF:'all', lawCat:'all',
  editId:null, editLawId:null,
  qType:'mc', correct:'A',
  quiz:{q:[],idx:0,ans:false,res:[],mode:''},
  curLaw:null, curLawName:'', lawSort:'name', bulkParsed:[], aiMd:'', aiJson:''
};

function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── 題幹標記語法渲染（填空、畫線、強調）─────────────────────
// 先 esc 防 XSS，再把標記轉成樣式 HTML：
//   ___（3個以上底線）     → 填空底線
//   [[文字]]               → 填空（含提示字，顯示為底線含淡字）
//   **文字**               → 畫線強調（底線）
//   __文字__（雙底線夾字） → 粗體
// 回傳 HTML 字串，須以 innerHTML 套用
function renderStemMarkup(text){
  let h = esc(text || '');
  // [[提示]] → 填空底線含淡字（先處理，避免與 ___ 衝突）
  h = h.replace(/\[\[([^\]]*)\]\]/g, (m, inner)=>
    `<span class="q-blank">${inner ? '<span class="q-blank-hint">'+inner+'</span>' : ''}</span>`);
  // **文字** → 畫線強調
  h = h.replace(/\*\*([^*]+)\*\*/g, '<span class="q-underline">$1</span>');
  // //文字// → 粗體（改用斜線，避免與底線 ___ 衝突）
  h = h.replace(/\/\/([^/\n]+)\/\//g, '<strong class="q-bold">$1</strong>');
  // ___ 連續3個以上底線 → 填空空格
  h = h.replace(/_{3,}/g, '<span class="q-blank"></span>');
  // 行首 >> → 段落首行縮排兩格（須在換行轉換前處理，逐行判斷）
  h = h.split('\n').map(line=>{
    if(/^\s*&gt;&gt;\s?/.test(line)){
      return '<span class="q-indent">'+line.replace(/^\s*&gt;&gt;\s?/,'')+'</span>';
    }
    return line;
  }).join('\n');
  // 換行保留
  h = h.replace(/\n/g, '<br>');
  return h;
}
// 將字串安全嵌入 onclick="fn('...')" 的單引號 JS 字串中：
// 先跳脫 JS 層（\ 與 '），再跳脫 HTML 屬性層
function escJs(s){ return esc((s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }
function br(s){ return esc(s||'').split('\n').join('<br>').split('\r').join(''); }
function toast(m,d=2200){ const e=document.getElementById('toast');if(!e)return;e.textContent=m;e.classList.add('on');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('on'),d); }
function today(){ return new Date().toISOString().slice(0,10); }
function dl(c,fn,t='text/plain'){ const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:t}));a.download=fn;a.click(); }
function kwArr(s){ return (s||'').split(/[,，、\s]+/).map(k=>k.trim()).filter(Boolean); }

// ── 空格清理（PDF/OCR 常見問題）──────────────────────────────
function cleanSpaces(text){
  if(!text)return text;
  let t=text;
  // 1. 不可見字元
  t=t.replace(/\u00A0/g,' ').replace(/\u200B/g,'').replace(/\uFEFF/g,'').replace(/\u3000/g,' ');
  // 2. 連續空格 → 單一
  t=t.replace(/[ \t]{2,}/g,' ');
  // 3. 中文字/標點之間的空格 → 直接合併（數字間空格保留）
  let prev='';
  while(prev!==t){
    prev=t;
    t=t.replace(/([\u4e00-\u9fff\uff00-\uffef，。！？、：；「」【】（）]) ([\u4e00-\u9fff\uff00-\uffef，。！？、：；「」【】（）])/g,'$1$2');
  }
  // 4. 中文行中換行 → 合併（非段落換行）
  t=t.replace(/([\u4e00-\u9fff，。！？、：；])\n([\u4e00-\u9fff，。！？])/g,'$1$2');
  // 5. 行尾空白
  t=t.replace(/[ \t]+$/gm,'');
  return t.trim();
}

// 關鍵字自動提取
const KW_POOL = ['比例原則','正當法律程序','臨檢','身分查證','即時強制','行政裁量',
  '警械使用','強制力','合理懷疑','現行犯','通知到場','管束','扣留',
  '警察職權','公共秩序','社會安全','行政救濟','陳述意見','書面告知',
  '告知義務','蒐集資料','偵查','搜索','扣押','逮捕','拘提',
  '通訊監察','秘密蒐證','釣魚偵查','控制下交付','陷害教唆',
  '法律保留','裁量怠惰','裁量濫用','警察補充性','緊急危難','正當防衛',
  '緊急避難','正當理由','警察勤務','勤區查察','巡邏','臨檢','守望',
  '值班','備勤','社維法','集遊法','警職法','警察法','警勤條例','警械條例'];
function autoKeywords(text){ return KW_POOL.filter(kw=>(text||'').includes(kw)); }

// 條號轉數字
const ZHN = {'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'百':100,'千':1000};
function zh2n(s){ let n=0,c=0;for(const ch of s){const v=ZHN[ch];if(v===undefined)continue;if(v>=10){if(c===0)c=1;n+=c*v;c=0;}else c=v;}return n+c; }
function art2n(art){
  if(!art) return 0;
  const m=art.match(/第([一二三四五六七八九十百千\d]+)條/);
  if(!m) return 0;
  const s=m[1];
  const main=/^\d+$/.test(s)?parseInt(s):zh2n(s);
  // 子條號：「第10條之2」「第10-1條」「第十條之一」都要納入排序
  // 主號 ×1000 + 子號，確保 10、10-1、10-2、11 正確排列
  let sub=0;
  const mSub=art.match(/條之([一二三四五六七八九十百千\d]+)/) || art.match(/第[一二三四五六七八九十百千\d]+[-－]([一二三四五六七八九十百千\d]+)條/);
  if(mSub){ const ss=mSub[1]; sub=/^\d+$/.test(ss)?parseInt(ss):zh2n(ss); }
  return main*1000 + Math.min(sub,999);
}

// 錯題演算法
function getWrong(qs,ats){
  const s=new Set();
  for(const q of qs){
    const qa=ats.filter(a=>a.qid===q.id&&a.correct!==null).sort((a,b)=>b.date>a.date?1:-1);
    if(!qa.length)continue;
    const r=qa.slice(0,3);
    if(r.every(a=>!a.correct)||(qa.filter(a=>!a.correct).length/qa.length>0.5&&qa.length>=2))s.add(q.id);
  }
  return s;
}

// debounce：防止高頻觸發（用於 oninput 搜尋）
function debounce(fn, delay=200){
  let timer=null;
  return function(...args){
    clearTimeout(timer);
    timer=setTimeout(()=>fn.apply(this,args), delay);
  };
}

// Confirm dialog
let _cfmCb=null;
function cfm(t,s,cb){
  _cfmCb=cb;
  document.getElementById('cfm-t').textContent=t;
  document.getElementById('cfm-s').textContent=s;
  document.getElementById('cfm-ok').onclick=()=>{closeCfm();_cfmCb?.();};
  document.getElementById('cfm-cn').onclick=()=>closeCfm();
  document.getElementById('cfm-ov').classList.add('on');
}
function closeCfm(){ document.getElementById('cfm-ov').classList.remove('on'); }

const OCR_FIX = {
  '職橾':'職權','職棰':'職權','職権':'職權',
  '集會游行':'集會遊行','行政執亍':'行政執行',
  '即時強制力':'即時強制','社維法':'社會秩序維護法',
  '止當法律':'正當法律','比例庵則':'比例原則',
};

// ── 選項符號對照表（NFKC 前處理）────────────────────────────
const OPT_SYMBOL_MAP = {
  // 註：所有圈圈數字（①②③ / ❶❷❸ / ⑴⑵⑶）一律不列入選項對應，
  //     因實際題目中它們是「題目內編號」（如題幹列舉「①前項 ②後項」），
  //     而非選項符號，列入會誤切題幹
  'ㄅ':'A','ㄆ':'B','ㄇ':'C','ㄈ':'D',
  // 圈圈字母（大寫）Ⓐ Ⓑ Ⓒ Ⓓ Ⓔ → A B C D E
  'Ⓐ':'A','Ⓑ':'B','Ⓒ':'C','Ⓓ':'D','Ⓔ':'E',
  // 圈圈字母（小寫）ⓐ ⓑ ⓒ ⓓ ⓔ
  'ⓐ':'A','ⓑ':'B','ⓒ':'C','ⓓ':'D','ⓔ':'E',
  // 括號字母 ⒜ ⒝ ⒞ ⒟ ⒠
  '⒜':'A','⒝':'B','⒞':'C','⒟':'D','⒠':'E',
  // 全形括號字母 （A）（B）→ A B（全形括號 + 全形/半形字母）
  'Ａ':'A','Ｂ':'B','Ｃ':'C','Ｄ':'D','Ｅ':'E',
  // 方塊/圓形符號 → 無名選項分隔 §OPT§
  '☒':'§OPT§','☐':'§OPT§','□':'§OPT§','■':'§OPT§',
  '▢':'§OPT§','◯':'§OPT§','○':'§OPT§','●':'§OPT§',
  '◉':'§OPT§','◎':'§OPT§','▪':'§OPT§','▫':'§OPT§',
  '◆':'§OPT§','◇':'§OPT§','▶':'§OPT§','▷':'§OPT§',
  '►':'§OPT§','▸':'§OPT§','‣':'§OPT§',
  // 幾何圖形區塊補充（U+25A3~U+25FF，PDF常見）
  '▣':'§OPT§','▤':'§OPT§','▥':'§OPT§','▦':'§OPT§','▧':'§OPT§','▨':'§OPT§','▩':'§OPT§',
  '▬':'§OPT§','▭':'§OPT§','▮':'§OPT§','▯':'§OPT§','▰':'§OPT§','▱':'§OPT§',
  '◈':'§OPT§','◊':'§OPT§','◌':'§OPT§','◍':'§OPT§','◐':'§OPT§','◑':'§OPT§',
  '◒':'§OPT§','◓':'§OPT§','◔':'§OPT§','◕':'§OPT§','◖':'§OPT§','◗':'§OPT§',
  '◼':'§OPT§','◻':'§OPT§','◾':'§OPT§','◽':'§OPT§',
  // Dingbats / Misc Symbols
  '✦':'§OPT§','✧':'§OPT§','✪':'§OPT§','✫':'§OPT§','✬':'§OPT§','✭':'§OPT§',
  '❑':'§OPT§','❒':'§OPT§','❏':'§OPT§',
};

// ── 1. preprocessQuestionText ───────────────────────────────
function preprocessQuestionText(text){
  if(!text) return '';
  let t = text;

  // ★ PUA 私用區選項字元 → (A)(B)(C)(D)(E)(F) 文字
  //   某些題庫 PDF 用私用區自訂字型畫選項符號，先在最前面換成標準括號字母，
  //   後續的「(A) → §A§」流程即可正常辨識（涵蓋 E18C~E191 = A~F）
  const _puaOpt = {
    '\uE18C':'(A)','\uE18D':'(B)','\uE18E':'(C)',
    '\uE18F':'(D)','\uE190':'(E)','\uE191':'(F)'
  };
  t = t.replace(/[\uE18C-\uE191]/g, c => _puaOpt[c] || c);

  // OCR 錯字修正
  Object.entries(OCR_FIX).forEach(([wrong,right])=>{ t=t.split(wrong).join(right); });

  // 選項符號替換（必須在 NFKC 前，否則 ①→1）
  Object.entries(OPT_SYMBOL_MAP).forEach(([sym,val])=>{
    if(val==='§OPT§'){
      t=t.split(sym).join('§OPT§');
    } else {
      t=t.split(sym).join('§'+val+'§');
    }
  });

  // 「行首未知符號偵測」：任何非字母/數字/中文的符號，
  // 只要重複出現在 2 行以上的行首，就視為選項分隔符號
  {
    const lineArr=t.split('\n');
    const lineStartMap={};
    lineArr.forEach(line=>{
      const trimmed=line.trim();
      if(!trimmed)return;
      const ch=trimmed[0];
      const cp=ch.codePointAt(0);
      // 排除：字母、數字、中文、常見標點、已知選項標記
      const isWordOrPunct=
        (cp>=0x41&&cp<=0x7A)||(cp>=0x61&&cp<=0x7A)||  // A-Z a-z
        (cp>=0x30&&cp<=0x39)||                          // 0-9
        (cp>=0x4E00&&cp<=0x9FFF)||                      // 中文
        (cp>=0xFF01&&cp<=0xFF60)||                      // 全形字母數字
        '（(）)【】「」『』。，、；：！？…—'.includes(ch)||
        ch==='§';  // 已轉換的標記
      if(!isWordOrPunct){
        lineStartMap[ch]=(lineStartMap[ch]||0)+1;
      }
    });
    // 找出現 2 次以上且不是已知選項標記 §A§ 的符號
    // 排除所有圈數字（①②③…⑩、❶…❿、⑴…⑽、㈠…㈩），它們是題目內編號不是選項符號
    const _circledAll = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳❶❷❸❹❺❻❼❽❾❿⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩]$/;
    const detected=Object.entries(lineStartMap)
      .filter(([ch,n])=>n>=1&&!_circledAll.test(ch))
      .sort((a,b)=>b[1]-a[1]);
    if(detected.length>0){
      detected.forEach(([sep])=>{
        // 行首符號替換為 §OPT§
        // 同時處理行中出現的同一符號（如「▩甲 ▩乙 ▩丙」在同一行）
        const escapedSep=sep.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        t=t.split('\n').map(line=>{
          const trimmed=line.trim();
          if(!trimmed) return line;
          if(trimmed.startsWith(sep)){
            // 行首有符號：整行替換（含行中的同一符號）
            const replaced=trimmed.slice(sep.length).trim()
              .replace(new RegExp('\\s*'+escapedSep+'\\s*','g'),'\n§OPT§ ');
            return '\n§OPT§ '+replaced;
          }
          // 行中有符號但行首沒有：也切開
          if(trimmed.includes(sep)){
            return '\n'+trimmed.replace(new RegExp('\\s*'+escapedSep+'\\s*','g'),'\n§OPT§ ');
          }
          return line;
        }).join('\n');
      });
    }
    // 同時保留 Private Use Area 偵測（PDF 私有字元）
    const pvtMap2={};
    for(const ch of t){
      const cp=ch.codePointAt(0);
      if(cp>=0xE000&&cp<=0xF8FF) pvtMap2[ch]=(pvtMap2[ch]||0)+1;
    }
    const pvtSep2=Object.entries(pvtMap2).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1])[0];
    if(pvtSep2) t=t.split(pvtSep2[0]).join('§OPT§');
  }

  // NFKC 正規化（全形→半形）
  // ★ 但 NFKC 會把圈數字 ①→1、⑴→(1)、❶→1，破壞題目內編號，故先保護再還原
  const _circledChars = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮❶❷❸❹❺❻❼❽❾❿⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩';
  const _circledStash = [];
  t = t.replace(new RegExp('['+_circledChars+']','g'), (ch)=>{
    _circledStash.push(ch);
    return '\uF0F0'+(_circledStash.length-1)+'\uF0F1';  // 用 PUA 佔位符暫存
  });
  t=t.normalize('NFKC');
  // 還原圈數字
  t = t.replace(/\uF0F0(\d+)\uF0F1/g, (m,i)=>_circledStash[parseInt(i)]||'');

  // 換行統一
  t=t.replace(/\r\n/g,'\n').replace(/\r/g,'\n');

  // ★ 全行格式：在選項和題號前插入換行
  // 讓「...委員會 (B)...」→「...委員會\n(B)...」
  // 讓「...委員會 2. 下一題」→「...委員會\n2. 下一題」
  t=t.replace(/([^(\n])\s*\(([A-Ha-h])\)/g,'$1\n($2)');
  t=t.replace(/([\u4e00-\u9fff\uff00-\uffef\u3000-\u303f）)\]】」])\s*(\d{1,3}[.、．]\s)/g,'$1\n$2');

  // 不可見字元清除
  t=t.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g,'').replace(/\u3000/g,' ');

  // 全形括號選項：（A）(A) → §A§
  t=t.replace(/[（(]\s*([A-Ha-h])\s*[）)]/g,(_,k)=>'§'+k.toUpperCase()+'§');

  // ★ 問題(1)修正：行首「孤立括號」或「bullet 類符號」→ §OPT§
  // 涵蓋 PDF 複製常見亂象：
  //   1. 孤立全形/半形括號開頭「（ 內容」「( 內容」（括號內沒有字母編號）
  //   2. bullet 點號開頭「• · ‧ ‒ – — * ◦ ▪ ▸ → ・ ．」
  //   一旦該符號在 2 行以上的行首重複出現，才視為選項（避免誤判單行括號補充）
  {
    const _bulletChars = '•·‧‒–—*◦▪▸→・．';
    // 全文「行首」孤立括號數（只算行首，避免題幹中的 (補充) 或書名號《》被誤判）
    const _parenLineStart = t.split('\n').filter(ln=>{
      const tr = ln.trim();
      return /^[（(]\s*(?![A-Ha-h]\s*[）)])/.test(tr);
    }).length;
    const parenTotal = _parenLineStart;
    // bullet 總數（含同行）
    const _bulletAll = t.match(new RegExp('['+_bulletChars.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+']','g'));
    const bulletTotal = _bulletAll ? _bulletAll.length : 0;
    // 行首孤立括號 ≥2 → 視為選項分隔（只切行首，不動行中括號）
    if(parenTotal >= 2){
      const _parenRe = /^[（(]\s*(?![A-Ha-h]\s*[）)])/;
      t = t.split('\n').map(ln=>{
        const tr = ln.trim();
        // 只有「行首」是孤立括號才切，行中間的括號（書名號、補充說明）不動
        if(_parenRe.test(tr)){
          return tr.replace(/^[（(]\s*/, '§OPT§ ');
        }
        return ln;
      }).join('\n');
    }
    // bullet 總數 ≥2 → 視為選項分隔
    if(bulletTotal >= 2){
      const _escClass = _bulletChars.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      // 同行內每個 bullet 都切（含同列多選項）
      const _bReAll = new RegExp('['+_escClass+']\\s*','g');
      t = t.split('\n').map(ln=>{
        const tr = ln.trim();
        if(_bulletChars.includes(tr[0])){
          return tr.replace(_bReAll, '\n§OPT§ ');
        }
        return ln;
      }).join('\n');
    }
  }

  // 數字括號選項：(1)(2)(3)(4) → §A§§B§§C§§D§
  // 只在沒有字母選項(A)(B)(C)(D)的情況下才啟用（有字母選項時 (1) 是題號）
  if(!/[（(][A-Ha-h][）)]/.test(t) && !/[§][A-H][§]/.test(t)){
    t=t.replace(/(?:^|(?<=\n))[（(]([1-4１-４])[）)]\s*/gm,(_,n)=>{
      const MAP={'1':'A','2':'B','3':'C','4':'D','１':'A','２':'B','３':'C','４':'D'};
      return '\n§'+(MAP[n]||n)+'§ ';
    });
  }

  // 讓選項各自換行（§OPT§ 和 §A§ 前後加換行）
  t=t.replace(/([^\n])§OPT§/g,'$1\n§OPT§');
  t=t.replace(/([^\n])§([A-H])§/g,'$1\n§$2§');
  t=t.replace(/§([A-H])§\s*/g,'\n§$1§ ');
  t=t.replace(/§OPT§\s*/g,'\n§OPT§ ');

  // ★ 題號從選項內容中拆出：當選項符號後面黏著「數字+空白+中文長句」
  //   （下一題題號被前一題答案選項吸進來的情況），在題號前斷行。
  //   例：「§C§ 6 依警察教育…」→「§C§」「6 依警察教育…」
  t=t.replace(/(§(?:OPT|[A-H])§[^\n]*?)\s(\d{1,3})\s+([\u4e00-\u9fff])/g, (m, head, num, zh)=>{
    // 量詞起頭不切（避免「§A§ 3 公里」被誤拆）
    if('年月日時分秒週天個件名條款項元萬千百公里度次'.includes(zh)) return m;
    return head + '\n' + num + ' ' + zh;
  });

  // 中文字間多餘空格（保留數字前後）
  let prev='';
  let _wLim1=0;
  while(prev!==t&&_wLim1++<8){
    prev=t;
    t=t.replace(/([\u4e00-\u9fff，。！？、：；]) ([\u4e00-\u9fff，。！？、：；])/g,'$1$2');
  }

  // 行尾空白
  t=t.replace(/[ \t]+$/gm,'');

  return t.trim();
}

// ── 2. normalizeOptions ─────────────────────────────────────
// ── 3. parseQuestions 主解析函式 ───────────────────────────
// ═══════════════════════════════════════════════════════════════════
// 新解析邏輯：按用戶指定的規則
// 規則1：行首是數字 → 題號，題幹讀到 ？ 或 ： 為止
// 規則2：行首是不明符號（重複出現）→ 選項分隔
// 規則3：選項跨行 → 遇到下一個符號前都追加到同一選項
// 規則4：(A)(B)/①② 等已知符號照常辨識
// 規則5：題目/選項內空格跳行整理整齊
// ═══════════════════════════════════════════════════════════════════

// ─────── 整理文字：去多餘空白、標點後空格 ─────────────────────────
function _tidyText(s){
  if(!s) return '';
  return cleanSpaces(
    s.replace(/\s+/g,' ')
     .replace(/([，。！？、：；,.!?:;])\s+/g,'$1')
     .trim()
  );
}

function parseQuestions(rawText){
  if(!rawText||!rawText.trim()) return [];

  // ★ 直接呼叫 preprocessQuestionText（含 OPT_SYMBOL_MAP、行首符號偵測、？/：切行等）
  let t = preprocessQuestionText(rawText);

  // 中文題號：一、二、 → 1. 2.（preprocessQuestionText 未處理）
  const ZH={'一':'1','二':'2','三':'3','四':'4','五':'5',
             '六':'6','七':'7','八':'8','九':'9','十':'10'};
  t=t.replace(/^([一二三四五六七八九十]+)[、．。.]/gm,(_,n)=>(ZH[n]||n)+'. ');

  // ── 逐行解析 ─────────────────────────────────────────────────────
  const allLines=t.split('\n').map(l=>l.trim()).filter(Boolean);
  const questions=[];
  let curQ=null, curOptKey=null, optIdx=0;
  const OPT_KEYS=['A','B','C','D','E','F','G','H'];

  function finishQ(){
    if(!curQ) return;
    curQ.stem=_tidyText(curQ.stem);
    Object.keys(curQ.options).forEach(k=>{ curQ.options[k]=_tidyText(curQ.options[k]); });
    curQ.type=Object.keys(curQ.options).length>=2?'mc':'es';
    if(curQ.stem) questions.push(curQ);
    curQ=null; curOptKey=null; optIdx=0;
  }

  function newQ(num, stemStart){
    finishQ();
    curQ={
      num, stem:stemStart, type:'es', options:{},
      answer:'', answerEs:'', keywords:[], mustKeywords:[], tags:[],
      note:'', starred:false, createdAt:Date.now(),
      reviewLevel:0, nextReview:Date.now(), lastReview:null,
      wrongCount:0, correctStreak:0, difficultyScore:5,
    };
    curOptKey=null; optIdx=0;
  }

  function addOpt(content){
    if(!curQ||!content.trim()) return;
    const key=OPT_KEYS[optIdx++]||'?';
    curQ.options[key]=content.trim();
    curOptKey=key;
  }

  function appendLine(text){
    if(!curQ||!text.trim()) return;
    if(curOptKey && curQ.options[curOptKey]!==undefined){
      // 【規則3】選項跨行：合併到當前選項
      curQ.options[curOptKey]+=' '+text;
    } else {
      // 【規則3】題幹跨行：合併到題幹
      curQ.stem+=(curQ.stem?' ':'')+text;
    }
  }

  for(const line of allLines){
    // ── 已知字母選項 §A§ §B§ ─────────────────────────────────────
    const mAlpha=line.match(/^§([A-H])§\s*(.*)/);
    if(mAlpha){
      if(!curQ) continue;
      const key=mAlpha[1];
      if(curQ.options[key]!==undefined){
        curQ.options[key]+=' '+mAlpha[2]; // 跨行追加
      } else {
        curQ.options[key]=mAlpha[2].trim();
        const ki=OPT_KEYS.indexOf(key);
        if(ki>=optIdx) optIdx=ki+1;
      }
      curOptKey=key;
      continue;
    }

    // ── §OPT§ 未命名選項 ──────────────────────────────────────────
    const mAnon=line.match(/^§OPT§\s*(.*)/);
    if(mAnon){
      if(!curQ){ continue; }
      const optContent=mAnon[1];
      addOpt(optContent);
      continue;
    }

    // ── 【規則1】行首數字 → 新題目（簡單規則）──────────────────
    // 行首是「數字 + 標點(.、．)」→ 一定是題號
    // 行首是「數字 + 空格」→ 也是題號（但若正在收選項中且內容很短，視為選項內容）
    const mNum=line.match(/^(\d{1,3})(?:[.、．）)）]\s*|\s+)([\s\S]+)/);
    let mNumIsQ = false;
    if(mNum && parseInt(mNum[1])<=500){
      const rest = mNum[2].trim();
      const hasPunct = /^(\d{1,3})[.、．）)）]/.test(line);  // 數字後有標點符號
      if(hasPunct){
        // 數字+標點 → 一定是題號（如 7. 14. 都正確識別，不管號碼是否連續）
        mNumIsQ = true;
      } else {
        // 數字+空格 → 是題號，但排除「正在收選項且後面太短」（避免選項內數字誤判）
        mNumIsQ = rest.length > 3;
      }
    }
    if(mNumIsQ){
      const num=mNum[1];
      const rest=mNum[2].trim();
      // 題幹 = 題號後的全部內容，不以 ？或：截斷
      // 選項由後續的 (A) 等選項符號自然觸發；題幹跨行也會持續累加直到遇到選項
      newQ(num, rest);
      continue;
    }

    // ── 中文題號 一、二、 ────────────────────────────────────────
    const mZh=line.match(/^([一二三四五六七八九十]+)[、．。]\s*([\s\S]+)/);
    if(mZh && ZH[mZh[1]]){
      const rest=mZh[2].trim();
      newQ(ZH[mZh[1]], rest);
      continue;
    }

    // ── 其他行：追加到選項或題幹 ────────────────────────────────
    appendLine(line);
  }

  finishQ();

  return questions.map(q=>({
    ...q,
    keywords: autoKeywords(q.stem),
    mustKeywords: [],
    searchBlob: ((q.stem||'')+' '+(autoKeywords(q.stem)||[]).join(' ')).toLowerCase(),
  }));
}

// ── 5. parseAnswerStr ────────────────────────────────────────
function parseAnswerStr(str){
  if(!str||!str.trim()) return {};
  const map={};
  for(const m of str.matchAll(/(\d{1,3})[.、\s]*([A-Ha-h])/g)){
    map[parseInt(m[1])]=m[2].toUpperCase();
  }
  return map;
}

// ── 6. parseBulkText（相容舊介面）──────────────────────────
function parseBulkText(text){
  return parseQuestions(text).map(q=>({
    ...q,
    answer:q.answer||'',
    answerEs:q.answerEs||'',
  }));
}

// ── 7. 震動回饋（Haptic Feedback）──────────────────────────
// 在支援的裝置上輕震，提供實體操作感；不支援則靜默忽略
// type: 'light'(輕點) | 'success'(成功) | 'error'(錯誤) | 'medium'
function haptic(type='light'){
  try{
    if(!navigator.vibrate) return;
    // eink 模式不震動（Boox 等電子閱讀器多無馬達且追求安靜）
    if(document.documentElement.dataset.theme === 'eink') return;
    const patterns = {
      light:   10,
      medium:  20,
      success: [12, 40, 12],
      error:   [25, 50, 25],
    };
    navigator.vibrate(patterns[type] ?? 10);
  }catch(_){}
}

// ── 骨架屏載入（v2.11.45）：在資料載入前顯示佔位，減少空白感 ──
function showSkeleton(containerId, rows){
  const el = document.getElementById(containerId);
  if(!el) return;
  rows = rows || 4;
  let html = '<div class="skeleton-wrap">';
  for(let i=0;i<rows;i++){
    html += `<div class="skeleton-row">
      <div class="skeleton-thumb"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line w70"></div>
        <div class="skeleton-line w40"></div>
      </div>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}
