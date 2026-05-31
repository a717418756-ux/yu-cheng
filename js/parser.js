const OCR_FIX = {
  '職橾':'職權','職棰':'職權','職権':'職權',
  '集會游行':'集會遊行','行政執亍':'行政執行',
  '即時強制力':'即時強制','社維法':'社會秩序維護法',
  '止當法律':'正當法律','比例庵則':'比例原則',
};

// ── 選項符號對照表（NFKC 前處理）────────────────────────────
const OPT_SYMBOL_MAP = {
  // 圓圈數字 → 直接對應 A B C D E
  '①':'A','②':'B','③':'C','④':'D','⑤':'E',
  '❶':'A','❷':'B','❸':'C','❹':'D','❺':'E',
  '⑴':'A','⑵':'B','⑶':'C','⑷':'D','⑸':'E',
  'ㄅ':'A','ㄆ':'B','ㄇ':'C','ㄈ':'D',
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
    const detected=Object.entries(lineStartMap)
      .filter(([ch,n])=>n>=1&&!ch.match(/^[①②③④⑤❶❷❸❹]$/))
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
  t=t.normalize('NFKC');

  // 換行統一
  t=t.replace(/\r\n/g,'\n').replace(/\r/g,'\n');

  // ★ 全行格式：在選項和題號前插入換行
  // 讓「...委員會 (B)...」→「...委員會\n(B)...」
  // 讓「...委員會 2. 下一題」→「...委員會\n2. 下一題」
  t=t.replace(/([^(\n])\s*\(([A-Ea-e])\)/g,'$1\n($2)');
  t=t.replace(/([\u4e00-\u9fff\uff00-\uffef\u3000-\u303f）)\]】」])\s*(\d{1,3}[.、．]\s)/g,'$1\n$2');

  // 不可見字元清除
  t=t.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g,'').replace(/\u3000/g,' ');

  // 全形括號選項：（A）(A) → §A§
  t=t.replace(/[（(]\s*([A-Ea-e])\s*[）)]/g,(_,k)=>'§'+k.toUpperCase()+'§');
  // 數字括號選項：(1)(2)(3)(4) → §A§§B§§C§§D§
  // 只在沒有字母選項(A)(B)(C)(D)的情況下才啟用（有字母選項時 (1) 是題號）
  if(!/[（(][A-Ea-e][）)]/.test(t) && !/[§][A-E][§]/.test(t)){
    t=t.replace(/(?:^|(?<=\n))[（(]([1-4１-４])[）)]\s*/gm,(_,n)=>{
      const MAP={'1':'A','2':'B','3':'C','4':'D','１':'A','２':'B','３':'C','４':'D'};
      return '\n§'+(MAP[n]||n)+'§ ';
    });
  }

  // 讓選項各自換行（§OPT§ 和 §A§ 前後加換行）
  t=t.replace(/([^\n])§OPT§/g,'$1\n§OPT§');
  t=t.replace(/([^\n])§([A-E])§/g,'$1\n§$2§');
  t=t.replace(/§([A-E])§\s*/g,'\n§$1§ ');
  t=t.replace(/§OPT§\s*/g,'\n§OPT§ ');

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

// ─────── 輔助：找題幹結尾（？ 或 ：）的位置 ──────────────────────
function _findQEnd(str){
  // 找第一個「？」「?」「：」「:」的位置
  for(let i=0;i<str.length;i++){
    if(str[i]==='？'||str[i]==='?'||str[i]==='：'||str[i]===':') return i;
  }
  return -1;
}

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
    const mAlpha=line.match(/^§([A-E])§\s*(.*)/);
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

    // ── 【規則1】行首數字 → 新題目 ───────────────────────────────
    const mNum=line.match(/^(\d{1,3})(?:[.、．）)）]\s*|\s+)([\s\S]+)/);
    // 確認是題號行：數字後面有標點分隔 OR 後面是中文長句（非量詞開頭）
    const mNumIsQ = mNum && parseInt(mNum[1])<=500 && (
      /^(\d{1,3})[.、．）)）]/.test(line) || // 標點型：1. 1、1） 絕對是題號
      (mNum[2].trim().length > 3 &&           // 空格型：後面要夠長
       !/^[年月日時分秒週天個件名條款項元萬千百公里]/.test(mNum[2].trim())) // 非量詞開頭
    );
    if(mNumIsQ){
      const num=mNum[1];
      const rest=mNum[2].trim();
      // 【規則1】找題幹結尾（？ 或 ：）
      const endIdx=_findQEnd(rest);
      const stemPart=endIdx>=0 ? rest.slice(0,endIdx+1) : rest;
      const after=endIdx>=0 ? rest.slice(endIdx+1).trim() : '';
      newQ(num, stemPart);
      // ？/：後面可能還有選項內容（同行）
      if(after) appendLine(after);
      continue;
    }

    // ── 中文題號 一、二、 ────────────────────────────────────────
    const mZh=line.match(/^([一二三四五六七八九十]+)[、．。]\s*([\s\S]+)/);
    if(mZh && ZH[mZh[1]]){
      const rest=mZh[2].trim();
      const endIdx=_findQEnd(rest);
      newQ(ZH[mZh[1]], endIdx>=0 ? rest.slice(0,endIdx+1) : rest);
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
  for(const m of str.matchAll(/(\d{1,3})[.、\s]*([A-Ea-e])/g)){
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
function parseLawText(rawText, lawName, category, source){
  if(!rawText||!rawText.trim()) return [];

  const lines = rawText.split('\n').map(l=>l.trim()).filter(Boolean);
  const items = [];

  // ── 三層結構狀態 ──────────────────────────────────────────
  let curPart    = '';  // 編（最上層）：第一編 總則
  let curChapter = '';  // 章（中層）：第一章 總則
  let curSection = '';  // 節（最下層）：第一節 一般規定
  let curArtNum  = null;
  let curTitle   = '';
  let contentLines = [];

  // 正規表達式：只認「章節編節」行，條號只認阿拉伯數字
  // 數字部分：支援阿拉伯數字、中文數字、及中文數字間有空格（如「十 三」）
  // 支援「編」（最上層結構）
  const _numPart = '((?:[一二三四五六七八九十百千\\d]+\\s*)+?)';
  const partRe    = new RegExp('^第\\s*'+_numPart+'\\s*[篇編]\\s*(.+)?');
  const chapterRe = new RegExp('^第\\s*'+_numPart+'\\s*章\\s*(.+)?');
  const sectionRe = new RegExp('^第\\s*'+_numPart+'\\s*節\\s*(.+)?');
  const articleRe = /^第\s*(\d+)\s*條\s*(?:[（(]([^）)]+)[）)])?(.*)$/;

  // 中文數字→阿拉伯數字
  const zh2num = (s) => {
    const map={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
               '十':10,'百':100,'千':1000};
    if(/^\d+$/.test(s)) return parseInt(s);
    let result=0, temp=0;
    for(const ch of s){
      const v=map[ch]; if(!v) continue;
      if(v>=10){result+=(temp||1)*v;temp=0;}else temp=v;
    }
    return result+temp;
  };

  // 格式化層級名稱（「第N編/章/節 名稱」→ 標準格式）
  const fmtLevel = (type, num, name) => {
    // 去除中文數字間的空格再轉換（如「十 三」→「十三」→13）
    const cleanNum = typeof num==='string' ? num.replace(/\s+/g,'') : num;
    const n = zh2num(cleanNum);
    const s = name ? name.trim() : '';
    return '第'+n+type+(s?' '+s:'');
  };

  // 儲存目前條文
  const saveArticle = () => {
    if(curArtNum===null) return;
    const content = contentLines.join('\n').trim();
    if(!content && !curTitle) return;
    const artNum = parseInt(curArtNum, 10);
    items.push({
      lawName:       lawName||'',
      article:       '第 '+artNum+' 條',  // 顯示用
      articleNumber: artNum,               // 數字排序用
      title:         curTitle||'',
      content:       content||curTitle||'',
      category:      category||'statute',
      part:          curPart||'',          // 編
      chapter:       curChapter||'',       // 章
      section:       curSection||'',       // 節
      source:        source||'',
      keywords:      [],
      relatedLaws:   [],
      favorite:      false,
      createdAt:     Date.now(),
    });
    curArtNum=null; curTitle=''; contentLines=[];
  };

  for(const line of lines){
    // ── 編（最優先）──────────────────────────────────────
    const pM = line.match(partRe);
    if(pM){ saveArticle(); curPart=fmtLevel('編',pM[1],pM[2]); curChapter=''; curSection=''; continue; }

    // ── 章 ───────────────────────────────────────────────
    const chM = line.match(chapterRe);
    if(chM){ saveArticle(); curChapter=fmtLevel('章',chM[1],chM[2]); curSection=''; continue; }

    // ── 節 ───────────────────────────────────────────────
    const secM = line.match(sectionRe);
    if(secM){ saveArticle(); curSection=fmtLevel('節',secM[1],secM[2]); continue; }

    // ── 條號（只認阿拉伯數字）────────────────────────────
    const artM = line.match(articleRe);
    if(artM){
      saveArticle();
      curArtNum = artM[1];
      curTitle  = (artM[2]||'').trim();
      const tail = (artM[3]||'').trim();
      if(tail) contentLines.push(tail);
      continue;
    }

    // ── 條文內容（追加）──────────────────────────────────
    if(curArtNum!==null) contentLines.push(line);
  }
  saveArticle();
  return items;
}
