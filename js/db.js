// ══ db.js — IndexedDB 核心（純原生，永不降版）═══════════════
// 解法：不帶版本號開啟，讓瀏覽器自動使用現有版本
// onupgradeneeded 只補缺失的 store / index，不重建
const DB_NAME='PoliceExamPro';
let db;

const REVIEW_INTERVALS=[1,3,7,14,30,60,180];

function initDB(){
  return new Promise((res,rej)=>{
    // ★ 不指定版本號 → 永遠不會出現「請求版本 < 現有版本」
    const r = indexedDB.open(DB_NAME);

    r.onupgradeneeded = e => {
      const d   = e.target.result;
      const tx  = e.target.transaction;

      // ── questions store ──────────────────────────────────
      let qs;
      if(!d.objectStoreNames.contains('questions')){
        qs = d.createObjectStore('questions',{keyPath:'id',autoIncrement:true});
      } else {
        qs = tx.objectStore('questions');
      }
      const qIdx = ['subject','createdAt','nextReview','reviewLevel',
                    'difficultyScore','type','starred'];
      qIdx.forEach(ix=>{ if(!qs.indexNames.contains(ix)) qs.createIndex(ix,ix,{unique:false}); });

      // ── laws store ───────────────────────────────────────
      let ls;
      if(!d.objectStoreNames.contains('laws')){
        ls = d.createObjectStore('laws',{keyPath:'id',autoIncrement:true});
      } else {
        ls = tx.objectStore('laws');
      }
      ['lawName','category','articleNumber'].forEach(ix=>{
        if(!ls.indexNames.contains(ix)) ls.createIndex(ix,ix,{unique:false});
      });

      // ── attempts store ───────────────────────────────────
      let as_;
      if(!d.objectStoreNames.contains('attempts')){
        as_ = d.createObjectStore('attempts',{keyPath:'id',autoIncrement:true});
      } else {
        as_ = tx.objectStore('attempts');
      }
      ['qid','date','responseTime'].forEach(ix=>{
        if(!as_.indexNames.contains(ix)) as_.createIndex(ix,ix,{unique:false});
      });

      // ── conceptGroups store ──────────────────────────────
      if(!d.objectStoreNames.contains('conceptGroups')){
        d.createObjectStore('conceptGroups',{keyPath:'id',autoIncrement:true});
      }

      // ── settings store（key-value，存 motto / gdriveClientId 等）
      if(!d.objectStoreNames.contains('settings')){
        d.createObjectStore('settings',{keyPath:'key'});
      }

      // ── countdowns store（考試倒數列表）─────────────────
      if(!d.objectStoreNames.contains('countdowns')){
        d.createObjectStore('countdowns',{keyPath:'id',autoIncrement:true});
      }
    };

    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror   = e => rej(e.target.error);
    r.onblocked = () => rej(new Error('IndexedDB blocked'));
  });
}

// ── CRUD（原版介面，完全不變）────────────────────────────────
const dg=(st,k)=>new Promise((r,j)=>{const t=db.transaction(st,'readonly');const q=t.objectStore(st).get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>j();});

const da=(st,idx,qry)=>{
  if(!idx&&!qry){
    const cached=_cacheGet(st);
    if(cached)return Promise.resolve(cached);
    return new Promise((r,j)=>{
      const t=db.transaction(st,'readonly');
      const q=t.objectStore(st).getAll();
      q.onsuccess=()=>{_cacheSet(st,q.result);r(q.result);};
      q.onerror=()=>j([]);
    });
  }
  return new Promise((r,j)=>{
    const t=db.transaction(st,'readonly');
    const o=t.objectStore(st);
    const q=idx?o.index(idx).getAll(qry):o.getAll();
    q.onsuccess=()=>r(q.result);
    q.onerror=()=>j([]);
  });
};

const dp=(st,data)=>new Promise((r,j)=>{
  const t=db.transaction(st,'readwrite');
  const q=t.objectStore(st).put(data);
  q.onsuccess=()=>{_cacheInvalidate(st);r(q.result);};
  q.onerror=e=>j(e.target.error||new Error('dp failed'));
  t.onerror=e=>j(e.target.error||new Error('tx failed'));
});

const dd=(st,k)=>new Promise((r,j)=>{
  const t=db.transaction(st,'readwrite');
  const req=t.objectStore(st).delete(k);
  req.onsuccess=()=>{_cacheInvalidate(st);r();};
  req.onerror=()=>j();
});

const dc=(st)=>new Promise((r,j)=>{
  const t=db.transaction(st,'readwrite');
  const req=t.objectStore(st).clear();
  req.onsuccess=()=>{_cacheInvalidate(st);r();};
  req.onerror=()=>j();
});

function bulkPut(st,items){
  return new Promise((res,rej)=>{
    const tx=db.transaction(st,'readwrite');
    const os=tx.objectStore(st);
    let n=0;
    tx.oncomplete=()=>{_cacheInvalidate(st);res(n);};
    tx.onerror=e=>rej(e);
    items.forEach(it=>{os.put(it).onsuccess=()=>n++;});
  });
}

// ── 錯誤記錄（輕量版，避免無聲失敗）────────────────────────
const _errLog=[];
function logError(context, err){
  const entry={t:new Date().toISOString(),ctx:context,msg:err?.message||String(err)};
  _errLog.push(entry);
  if(_errLog.length>50)_errLog.shift(); // 最多保留50筆
  console.error('[PoliceExam]',context,err);
}
// ── 輕量快取（避免重複全量讀取）────────────────────────────
const _cache={};
const _CACHE_TTL=30000; // 30秒 TTL（操作後自動失效）

function _cacheGet(key){
  const c=_cache[key];
  if(!c)return null;
  if(Date.now()-c.ts>_CACHE_TTL){delete _cache[key];return null;}
  return c.data;
}
function _cacheSet(key,data){ _cache[key]={data,ts:Date.now()}; }
function _cacheInvalidate(st){ delete _cache[st]; }

// ── 遺忘曲線核心 ────────────────────────────────────────────
function calcNextReview(level, correct){
  if(!correct){
    // 答錯：降級，明天再複習
    return {level:Math.max(0,level-1), next:Date.now()+86400000};
  }
  const newLevel=Math.min(level+1, REVIEW_INTERVALS.length-1);
  const days=REVIEW_INTERVALS[newLevel];
  return {level:newLevel, next:Date.now()+days*86400000};
}

// ── 取今日待複習題目 ────────────────────────────────────────
// ── 取今日新題（從未複習）────────────────────────────────────
// ── 危險等級計算 ─────────────────────────────────────────────
function getDangerLevel(q, recentAts){
  const qa=recentAts.filter(a=>a.qid===q.id).sort((a,b)=>b.date-a.date);
  const last3=qa.slice(0,3);
  const wrongStreak=last3.length>=2&&last3.every(a=>!a.correct);
  const lastWrong=last3.length>0&&!last3[0].correct;
  const hesitant=last3.some(a=>a.responseTime>40000);
  if(wrongStreak) return '🔴';  // 連錯2次以上
  if(lastWrong) return '🟠';   // 最近答錯
  if(hesitant) return '🟡';    // 猶豫超過40秒
  return '🟢';                  // 穩定
}

// ── 優先排序：危險題優先 ─────────────────────────────────────
async function getPriorityPool(mode='all'){  try{
  const [qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  if(!qs.length) return [];
  const now=Date.now();

  // 測驗只取選擇題（申論題在題目閱覽瀏覽，不進測驗模式）
  const mcQs=qs.filter(q=>q.type==='mc');
  let pool=mcQs;
  if(mode==='wrong'){const ws=getWrong(qs,ats);pool=mcQs.filter(q=>ws.has(q.id));}
  else if(mode==='star'){pool=mcQs.filter(q=>q.starred);}
  else if(mode==='review'){pool=mcQs.filter(q=>(q.nextReview||0)<=now);}
  else if(mode==='new'){pool=mcQs.filter(q=>!q.reviewLevel&&q.reviewLevel!==0);}

  // 按危險等級排序
  const levelOrder={'🔴':0,'🟠':1,'🟡':2,'🟢':3};
  pool.sort((a,b)=>{
    const da_=getDangerLevel(a,ats);
    const db_=getDangerLevel(b,ats);
    return (levelOrder[da_]||3)-(levelOrder[db_]||3);
  });
  return pool;
  }catch(e){ logError('getPriorityPool',e); return []; }}

// ── settings store helpers ────────────────────────────────────
async function getSetting(key, fallback=''){
  try{
    const r = await dg('settings', key);
    return (r && r.value !== undefined) ? r.value : fallback;
  }catch(e){ return fallback; }
}
async function setSetting(key, value){
  try{ await dp('settings', {key, value}); }catch(e){ logError('setSetting',e); }
}

// ── countdowns store helpers ──────────────────────────────────
async function getCountdowns(){
  try{ return await da('countdowns'); }catch(e){ return []; }
}
async function saveCountdowns(list){
  try{
    await dc('countdowns');
    if(list.length) await bulkPut('countdowns', list);
  }catch(e){ logError('saveCountdowns',e); }
}

const APP_VER = 'v1150531-3';
