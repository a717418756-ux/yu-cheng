'use strict';
/* ══ HELPERS ══ */
function $el(id){return document.getElementById(id);}
function $qs(s){return document.querySelector(s);}
function $all(s){return document.querySelectorAll(s);}
function $bind(id,ev,fn){var el=$el(id);if(!el){console.error('[DOM] missing #'+id);return;}el.addEventListener(ev,fn);}
function uuid(){return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});}
function fmtTime(s){if(!s||isNaN(s))return'0:00';s=Math.floor(s);var m=Math.floor(s/60),ss=s%60;return m+':'+(ss<10?'0':'')+ss;}
function fmtDate(ts){if(!ts)return'';var d=new Date(ts);return d.getFullYear()+'/'+(d.getMonth()+1).toString().padStart(2,'0')+'/'+d.getDate().toString().padStart(2,'0');}
function debounce(fn,ms){var t;return function(){clearTimeout(t);t=setTimeout(fn,ms);};}

/* ══ TOAST ══ */
var Toast=(function(){
  function show(msg,type){
    type=type||'info';
    var stack=$el('toast-stack');
    var t=document.createElement('div');
    t.className='toast toast-'+type;
    t.innerHTML='<div class="toast-dot"></div><span>'+msg+'</span>';
    stack.appendChild(t);
    setTimeout(function(){t.classList.add('hide');setTimeout(function(){t.remove();},320);},2800);
  }
  return{success:function(m){show(m,'success');},error:function(m){show(m,'error');},warn:function(m){show(m,'warn');},info:function(m){show(m,'info');}};
})();

/* ══ MODAL ══ */
var Modal=(function(){
  var ov,cb;
  function init(){
    ov=$el('modal-ov');
    $bind('modalCancel','click',function(){ov.classList.remove('open');});
    $bind('modalConfirm','click',function(){ov.classList.remove('open');if(cb)cb();});
    ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('open');});
  }
  function show(title,body,confirmCb,confirmText){
    $el('modalTitle').textContent=title||'';
    $el('modalBody').textContent=body||'';
    $el('modalConfirm').textContent=confirmText||'確認';
    cb=confirmCb;ov.classList.add('open');
  }
  return{init:init,show:show};
})();

/* ══ ROUTER ══ */
var Router=(function(){
  var current='home',hist=[],cbs={},homeSection='study';
  function _pageEl(id){return $el(id.startsWith('page-')?id:'page-'+id);}
  function go(id){
    if(id===current)return;
    var prev=_pageEl(current);
    if(prev){prev.classList.remove('active');prev.classList.add('slide-out');setTimeout(function(){prev.classList.remove('slide-out');},260);}
    hist.push(current);current=id;
    var next=_pageEl(id);
    if(next)next.classList.add('active');
    var fabKey=id==='home'?('home-'+homeSection):id;
    FAB.update(fabKey);
    if(cbs[id])cbs[id]();
  }
  function back(){if(hist.length>0)go(hist.pop());else go('home');}
  function onEnter(id,fn){cbs[id]=fn;}
  function setHomeSection(sec){homeSection=sec;if(current==='home')FAB.update('home-'+sec);}
  function initNav(){
    $all('[data-section]').forEach(function(t){
      t.addEventListener('click',function(){
        $all('[data-section]').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        var sec=t.dataset.section;homeSection=sec;
        var sp=$el('study-panel'),ep=$el('exam-panel');
        if(sp)sp.classList.toggle('active',sec==='study');
        if(ep)ep.classList.toggle('active',sec==='exam');
        FAB.update('home-'+sec);
      });
    });
  }
  return{go:go,back:back,onEnter:onEnter,initNav:initNav,setHomeSection:setHomeSection,current:function(){return current;}};
})();

/* ══ DB ══ */
var DB=(function(){
  var db;var NAME='KnowledgeForceDB',VER=1;
  function open(){
    return new Promise(function(res,rej){
      var req=indexedDB.open(NAME,VER);
      req.onupgradeneeded=function(e){
        var d=e.target.result;
        function mk(name,opts){if(!d.objectStoreNames.contains(name))return d.createObjectStore(name,opts);return req.transaction.objectStore(name);}
        var questions=mk('questions',{keyPath:'id'});
        mk('laws',{keyPath:'id'});mk('chunks',{keyPath:'id'});mk('reviews',{keyPath:'id'});
        mk('attempts',{keyPath:'id'});mk('analytics',{keyPath:'id'});mk('settings',{keyPath:'key'});mk('courses',{keyPath:'id'});
        try{questions.createIndex('subject','subject',{unique:false});}catch(e){}
        try{questions.createIndex('nextReview','nextReview',{unique:false});}catch(e){}
      };
      req.onsuccess=function(e){db=e.target.result;res(db);};
      req.onerror=function(){rej(req.error);};
    });
  }
  function tx(store,mode){return db.transaction(store,mode).objectStore(store);}
  function getAll(store){return new Promise(function(res,rej){var r=tx(store,'readonly').getAll();r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error);};});}
  function get(store,key){return new Promise(function(res,rej){var r=tx(store,'readonly').get(key);r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error);};});}
  function put(store,item){return new Promise(function(res,rej){var r=tx(store,'readwrite').put(item);r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error);};});}
  function del(store,key){return new Promise(function(res,rej){var r=tx(store,'readwrite').delete(key);r.onsuccess=function(){res();};r.onerror=function(){rej(r.error);};});}
  function clear(store){return new Promise(function(res,rej){var t=db.transaction(store,'readwrite');var req=t.objectStore(store).clear();req.onsuccess=function(){res();};req.onerror=function(e){rej(e.target.error);};});}
  return{open:open,getAll:getAll,get:get,put:put,del:del,clear:clear};
})();

/* ══ PE DB (PoliceExamPro IndexedDB - merged) ══ */
const DB_NAME='PoliceExamPro',DB_VER=3;
let _peDb;
const REVIEW_INTERVALS=[1,3,7,14,30,60,180];
function initDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=e.target.result,oldVer=e.oldVersion;
      if(!d.objectStoreNames.contains('questions')){
        const s=d.createObjectStore('questions',{keyPath:'id',autoIncrement:true});
        ['subject','createdAt','nextReview','reviewLevel','difficultyScore','type','starred'].forEach(idx=>{try{s.createIndex(idx,idx,{unique:false});}catch(e){}});
      }
      if(!d.objectStoreNames.contains('laws')){
        const s=d.createObjectStore('laws',{keyPath:'id',autoIncrement:true});
        ['lawName','category','articleNumber'].forEach(idx=>{try{s.createIndex(idx,idx,{unique:false});}catch(e){}});
      }
      if(!d.objectStoreNames.contains('attempts')){
        const s=d.createObjectStore('attempts',{keyPath:'id',autoIncrement:true});
        ['qid','date','responseTime'].forEach(idx=>{try{s.createIndex(idx,idx,{unique:false});}catch(e){}});
      }
      if(!d.objectStoreNames.contains('conceptGroups'))d.createObjectStore('conceptGroups',{keyPath:'id',autoIncrement:true});
    };
    r.onsuccess=e=>{_peDb=e.target.result;res(_peDb);};
    r.onerror=e=>rej(e.target.error);
  });
}
const _cache={},_CACHE_TTL=30000;
function _cacheGet(key){const c=_cache[key];if(!c)return null;if(Date.now()-c.ts>_CACHE_TTL){delete _cache[key];return null;}return c.data;}
function _cacheSet(key,data){_cache[key]={data,ts:Date.now()};}
function _cacheInvalidate(st){delete _cache[st];}
const dg=(st,k)=>new Promise((r,j)=>{if(!_peDb)return j(new Error('DB not ready'));const t=_peDb.transaction(st,'readonly');const q=t.objectStore(st).get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>j();});
const da=(st,idx,qry)=>{
  if(!idx&&!qry){const ckey=st;const cached=_cacheGet(ckey);if(cached)return Promise.resolve(cached);return new Promise((r,j)=>{if(!_peDb)return j(new Error('DB not ready'));const t=_peDb.transaction(st,'readonly');const q=t.objectStore(st).getAll();q.onsuccess=()=>{_cacheSet(ckey,q.result);r(q.result);};q.onerror=()=>j([]);});}
  return new Promise((r,j)=>{if(!_peDb)return j(new Error('DB not ready'));const t=_peDb.transaction(st,'readonly');const o=t.objectStore(st);const q=idx?o.index(idx).getAll(qry):o.getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j([]);});
};
const dp=(st,data)=>new Promise((r,j)=>{if(!_peDb)return j(new Error('DB not ready'));const t=_peDb.transaction(st,'readwrite');const q=t.objectStore(st).put(data);q.onsuccess=()=>{_cacheInvalidate(st);r(q.result);};q.onerror=e=>j(e.target.error||new Error('dp failed'));t.onerror=e=>j(e.target.error||new Error('tx failed'));});
const dd=(st,k)=>new Promise((r,j)=>{if(!_peDb)return j(new Error('DB not ready'));const t=_peDb.transaction(st,'readwrite');const req=t.objectStore(st).delete(k);req.onsuccess=()=>{_cacheInvalidate(st);r();};req.onerror=()=>j();});
const dc=(st)=>new Promise((r,j)=>{if(!_peDb)return j(new Error('DB not ready'));const t=_peDb.transaction(st,'readwrite');const req=t.objectStore(st).clear();req.onsuccess=()=>{_cacheInvalidate(st);r();};req.onerror=()=>j();});
function bulkPut(st,items){
  return new Promise((res,rej)=>{
    if(!_peDb)return rej(new Error('DB not ready'));
    const tx=_peDb.transaction(st,'readwrite');const os=tx.objectStore(st);let n=0;
    tx.oncomplete=()=>{_cacheInvalidate(st);res(n);};tx.onerror=e=>rej(e);
    items.forEach(it=>{os.put(it).onsuccess=()=>n++;});
  });
}
const _errLog=[];
function logError(context,err){const entry={t:new Date().toISOString(),ctx:context,msg:err?.message||String(err)};_errLog.push(entry);if(_errLog.length>50)_errLog.shift();console.error('[PoliceExam]',context,err);}
function calcNextReview(level,correct){if(!correct){return{level:Math.max(0,level-1),next:Date.now()+86400000};}const newLevel=Math.min(level+1,REVIEW_INTERVALS.length-1);const days=REVIEW_INTERVALS[newLevel];return{level:newLevel,next:Date.now()+days*86400000};}
function getDangerLevel(q,recentAts){const qa=recentAts.filter(a=>a.qid===q.id).sort((a,b)=>b.date-a.date);const last3=qa.slice(0,3);const wrongStreak=last3.length>=2&&last3.every(a=>!a.correct);const lastWrong=last3.length>0&&!last3[0].correct;const hesitant=last3.some(a=>a.responseTime>40000);if(wrongStreak)return'🔴';if(lastWrong)return'🟠';if(hesitant)return'🟡';return'🟢';}
async function getPriorityPool(mode='all'){try{const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);if(!qs.length)return[];const now=Date.now();const mcQs=qs.filter(q=>q.type==='mc');let pool=mcQs;if(mode==='wrong'){const ws=getWrong(qs,ats);pool=mcQs.filter(q=>ws.has(q.id));}else if(mode==='star'){pool=mcQs.filter(q=>q.starred);}else if(mode==='review'){pool=mcQs.filter(q=>(q.nextReview||0)<=now);}else if(mode==='new'){pool=mcQs.filter(q=>!q.reviewLevel&&q.reviewLevel!==0);}const levelOrder={'🔴':0,'🟠':1,'🟡':2,'🟢':3};pool.sort((a,b)=>{const da_=getDangerLevel(a,ats);const db_=getDangerLevel(b,ats);return(levelOrder[da_]||3)-(levelOrder[db_]||3);});return pool;}catch(e){logError('getPriorityPool',e);return[];}}
const APP_VER='V1150527-3';

/* ══ STORE ══ */
var Store=(function(){
  var s={apiKey:'',examName:'警察升官等',examDate:null,dailyLimit:20,skipSec:10,defaultSpeed:1.0,homeSection:'study'};
  async function load(){for(var k in s){try{var r=await DB.get('settings',k);if(r&&r.value!==undefined)s[k]=r.value;}catch(e){}}}
  async function save(k,v){s[k]=v;try{await DB.put('settings',{key:k,value:v});}catch(e){}}
  function get(k){return s[k];}
  return{load:load,save:save,get:get,state:s};
})();

/* ══ SPACED REP ══ */
var Spaced=(function(){
  var IVLS=[1,2,4,7,14,30];
  function next(level,result){if(result==='pass')level=Math.min(5,level+1);else level=0;return{level:level,nextReviewAt:Date.now()+IVLS[level]*86400000};}
  function isDue(item){return!item.nextReviewAt||Date.now()>=item.nextReviewAt;}
  return{next:next,isDue:isDue,IVLS:IVLS};
})();

/* ══ WAVEUI ══ */
var WaveUI=(function(){
  var canvas,ctx,audio,wave=[],raf;
  function init(audioEl){canvas=$el('waveform');if(!canvas)return;ctx=canvas.getContext('2d');audio=audioEl;genWave();canvas.addEventListener('touchstart',function(e){var touch=e.touches[0];var rect=canvas.getBoundingClientRect();var x=(touch.clientX-rect.left)/rect.width;if(audio&&audio.duration)audio.currentTime=x*audio.duration;},{passive:true});canvas.addEventListener('click',function(e){var rect=canvas.getBoundingClientRect();var x=(e.clientX-rect.left)/rect.width;if(audio&&audio.duration)audio.currentTime=x*audio.duration;});}
  function genWave(){wave=[];for(var i=0;i<180;i++){wave.push(Math.abs(0.1+Math.random()*0.9*Math.sin(i*0.14+Math.random())));}}
  function draw(){if(!canvas||!ctx)return;var W=canvas.offsetWidth,H=canvas.height;if(canvas.width!==W)canvas.width=W;ctx.clearRect(0,0,W,H);var prog=(audio&&audio.duration)?audio.currentTime/audio.duration:0;var n=wave.length,bw=W/n;for(var i=0;i<n;i++){var amp=wave[i]*H*0.44;var x=i*bw;ctx.fillStyle=(i/n)<=prog?'rgba(232,201,107,.92)':'rgba(255,255,255,.15)';ctx.beginPath();ctx.roundRect(x+bw*.1,H/2-amp,bw*.82,amp*2,2);ctx.fill();}}
  function startAnim(){cancelAnimationFrame(raf);tick();}
  function stopAnim(){cancelAnimationFrame(raf);draw();}
  function tick(){draw();if(audio&&!audio.paused)raf=requestAnimationFrame(tick);}
  return{init:init,draw:draw,startAnim:startAnim,stopAnim:stopAnim};
})();

/* ══ FAB ══ */
var FAB=(function(){
  var wrap,scrim,mainBtn,isOpen=false;
  var menus={
    'home-study':[{icon:'⚙️',label:'設定',action:'go',arg:'page-settings'},{icon:'🔄',label:'今日複習',action:'go',arg:'page-review'},{icon:'💡',label:'碎片庫',action:'go',arg:'page-s-library'},{icon:'➕',label:'匯入課程',action:'go',arg:'page-import'}],
    'home-exam':[{icon:'⚙️',label:'設定',action:'go',arg:'page-settings'},{icon:'⚖',label:'資料庫',action:'go',arg:'page-pg-db'},{icon:'📚',label:'題目庫',action:'go',arg:'page-q-library'}],
    'page-q-library':[{icon:'🏠',label:'首頁',action:'go',arg:'home'},{icon:'🗄',label:'資料庫',action:'go',arg:'page-pg-db'},{icon:'⚙️',label:'設定',action:'go',arg:'page-settings'}],
    'page-pg-db':[{icon:'🏠',label:'首頁',action:'go',arg:'home'},{icon:'📚',label:'題目庫',action:'go',arg:'page-q-library'},{icon:'⚙️',label:'設定',action:'go',arg:'page-settings'}],
    'page-pg-stats':[{icon:'🏠',label:'首頁',action:'go',arg:'home'},{icon:'🤖',label:'AI 分析',action:'fn',fn:'buildAI'}],
    'page-settings':[{icon:'🏠',label:'首頁',action:'go',arg:'home'}],
    'page-review':[{icon:'🏠',label:'首頁',action:'go',arg:'home'},{icon:'💡',label:'碎片庫',action:'go',arg:'page-s-library'}],
    'page-import':[{icon:'🏠',label:'首頁',action:'go',arg:'home'},{icon:'💡',label:'碎片庫',action:'go',arg:'page-s-library'}],
    'page-exam-import':[{icon:'🏠',label:'首頁',action:'go',arg:'home'},{icon:'📚',label:'題庫',action:'go',arg:'page-q-library'}],
    'default':[{icon:'🏠',label:'首頁',action:'go',arg:'home'},{icon:'⚙️',label:'設定',action:'go',arg:'page-settings'}]
  };
  function init(){wrap=$el('fab-wrap');scrim=$el('fab-scrim');mainBtn=$el('fab-main');if(!wrap||!mainBtn)return;mainBtn.addEventListener('click',function(){toggle();});scrim.addEventListener('click',function(){close();});}
  function toggle(){isOpen?close():open();}
  function open(){isOpen=true;wrap.classList.add('open');scrim.classList.add('open');mainBtn.classList.add('open');}
  function close(){isOpen=false;wrap.classList.remove('open');scrim.classList.remove('open');mainBtn.classList.remove('open');}
  function update(pageId){close();var key=menus[pageId]?pageId:'default';var items=menus[key]||menus['default'];var container=$el('fabItems');if(!container)return;container.innerHTML=items.map(function(item){return'<div class="fab-item"><div class="fab-label">'+item.label+'</div><div class="fab-circle" data-action="'+(item.action)+'" data-arg="'+(item.arg||'')+'" data-fn="'+(item.fn||'')+'">'+item.icon+'</div></div>';}).join('');container.querySelectorAll('[data-action]').forEach(function(el){el.addEventListener('click',function(){var act=el.dataset.action,arg=el.dataset.arg,fn=el.dataset.fn;close();setTimeout(function(){if(act==='go'&&arg)Router.go(arg);else if(act==='exam')openExamMenu();else if(act==='fn'&&fn&&window[fn])window[fn]();},80);});});}
  function updateBadge(count){var existing=wrap&&wrap.querySelector('.fab-badge');if(existing)existing.remove();if(count>0&&wrap){var b=document.createElement('div');b.className='fab-badge';b.textContent=count>99?'99+':count;mainBtn.style.position='relative';mainBtn.appendChild(b);}}
  return{init:init,close:close,update:update,updateBadge:updateBadge};
})();

/* ══ UTILS (PE) ══ */
const S={page:'home',filter:'all',subF:'all',lawCat:'all',editId:null,editLawId:null,qType:'mc',correct:'A',quiz:{q:[],idx:0,ans:false,res:[],mode:''},curLaw:null,curLawName:'',lawSort:'name',lawSortDir:'asc',bulkParsed:[],aiMd:'',aiJson:''};
let _lawSortBy='name';
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function br(s){return esc(s||'').split('\n').join('<br>').split('\r').join('');}
function toast(m,d=2200){Toast.info(m);}
function today(){return new Date().toISOString().slice(0,10);}
function dl(c,fn,t='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:t}));a.download=fn;a.click();}
function kwArr(s){return(s||'').split(/[,，、\s]+/).map(k=>k.trim()).filter(Boolean);}
function cleanSpaces(text){if(!text)return text;let t=text;t=t.replace(/\u00A0/g,' ').replace(/\u200B/g,'').replace(/\uFEFF/g,'').replace(/\u3000/g,' ');t=t.replace(/[ \t]{2,}/g,' ');let prev='';while(prev!==t){prev=t;t=t.replace(/([\u4e00-\u9fff\uff00-\uffef，。！？、：；「」【】（）]) ([\u4e00-\u9fff\uff00-\uffef，。！？、：；「」【】（）])/g,'$1$2');}return t.replace(/[ \t]+$/gm,'').trim();}
const KW_POOL=['比例原則','正當法律程序','臨檢','身分查證','即時強制','行政裁量','警械使用','強制力','合理懷疑','現行犯','通知到場','管束','扣留','警察職權','公共秩序','社會安全','行政救濟','陳述意見','書面告知','告知義務','蒐集資料','偵查','搜索','扣押','逮捕','拘提','通訊監察','秘密蒐證','釣魚偵查','控制下交付','陷害教唆','法律保留','裁量怠惰','裁量濫用','警察補充性','緊急危難','正當防衛','緊急避難','正當理由','警察勤務','勤區查察','巡邏','守望','值班','備勤','社維法','集遊法','警職法','警察法','警勤條例','警械條例'];
function autoKeywords(text){return KW_POOL.filter(kw=>(text||'').includes(kw));}
const ZHN={'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'百':100,'千':1000};
function zh2n(s){let n=0,c=0;for(const ch of s){const v=ZHN[ch];if(v===undefined)continue;if(v>=10){if(c===0)c=1;n+=c*v;c=0;}else c=v;}return n+c;}
function art2n(art){const m=art.match(/第([一二三四五六七八九十百千\d]+)條/);if(!m)return 0;const s=m[1];return/^\d+$/.test(s)?parseInt(s):zh2n(s);}
function getWrong(qs,ats){const s=new Set();for(const q of qs){const qa=ats.filter(a=>a.qid===q.id&&a.correct!==null).sort((a,b)=>b.date>a.date?1:-1);if(!qa.length)continue;const r=qa.slice(0,3);if(r.every(a=>!a.correct)||(qa.filter(a=>!a.correct).length/qa.length>0.5&&qa.length>=2))s.add(q.id);}return s;}
let _cfmCb=null;
function cfm(t,s,cb){_cfmCb=cb;$el('cfm-t').textContent=t;$el('cfm-s').textContent=s;$el('cfm-ov').style.display='flex';}
$el('cfm-ok').onclick=function(){$el('cfm-ov').style.display='none';if(_cfmCb)_cfmCb();};
/* ══ HOME PAGE ══ */
var HomePage=(function(){
  async function render(){
    setGreeting();setCountdown();
    try{
      var courses=await DB.getAll('courses');
      var chunks=await DB.getAll('chunks');
      var reviews=await DB.getAll('reviews');
      var attempts=await DB.getAll('attempts');
      var questions=await DB.getAll('questions');
      var today_=new Date().toDateString();
      var todayRevs=reviews.filter(function(r){return new Date(r.reviewedAt).toDateString()===today_;});
      var dueChunks=chunks.filter(function(c){return Spaced.isDue(c);});
      var streak=calcStreak(reviews);
      setText('sStat0',todayRevs.length);setText('sStat1',streak);setText('sStat2',dueChunks.length);setText('sStat3',courses.length);
      FAB.updateBadge(dueChunks.length);
      renderCourses(courses);
    }catch(e){console.error('[Home]',e);}
  }
  function setGreeting(){
    var h=new Date().getHours();
    var label=h<5?'深夜好':h<12?'早安':h<18?'午安':h<21?'晚安':'夜安';
    var lbl=$el('greetLabel');var date=$el('homeDate');
    if(lbl)lbl.textContent=label;
    var name=$el('greetName');
    if(name){var saved=localStorage.getItem('kfMotto');name.textContent=saved||'加油';}
    var mottoEl=$el('homeMotto');if(mottoEl){mottoEl.textContent=localStorage.getItem('kfTagline')||'';}
    if(date){var d=new Date();var days=['日','一','二','三','四','五','六'];date.textContent=(d.getMonth()+1)+'月'+d.getDate()+'日　星期'+days[d.getDay()];}
  }
  function setCountdown(){
    var examDate=Store.get('examDate');var examName=Store.get('examName');var wrap=$el('homeCountdown');var nameEl=$el('cdExamName');var daysEl=$el('cdDays');
    if(!wrap)return;
    if(examDate){wrap.style.display='inline-flex';if(nameEl)nameEl.textContent=examName||'考試';if(daysEl){var diff=Math.ceil((new Date(examDate)-new Date())/86400000);daysEl.textContent=diff>0?diff:'今天！';}}
    else wrap.style.display='none';
  }
  function renderCourses(courses){
    var el=$el('courseList');if(!el)return;
    if(!courses||courses.length===0){el.innerHTML='<div class="empty"><div class="ic">🎧</div><div class="empty-title">尚無課程</div><div class="empty-desc">點右下角 + 匯入第一堂課</div></div>';return;}
    el.innerHTML=courses.map(function(c){return'<div class="c-card fu" data-cid="'+c.id+'"><div class="c-thumb">🎧</div><div class="c-info"><div class="c-title">'+esc(c.title)+'</div><div class="c-meta">'+fmtTime(c.audioDuration||0)+' · '+fmtDate(c.createdAt)+'</div></div><div style="color:var(--t3);font-size:16px">›</div></div>';}).join('');
    el.querySelectorAll('.c-card').forEach(function(card){var cid=card.dataset.cid;var pressT;card.addEventListener('touchstart',function(){pressT=setTimeout(function(){Modal.show('刪除課程','確定刪除此課程？',async function(){await DB.del('courses',cid);Toast.success('已刪除課程');render();},'刪除');},700);},{passive:true});card.addEventListener('touchend',function(){clearTimeout(pressT);},{passive:true});card.addEventListener('click',function(){PlayerPage.load(cid);Router.go('page-player');});});
  }
  function calcStreak(reviews){var days={};reviews.forEach(function(r){days[new Date(r.reviewedAt).toDateString()]=true;});var s=0,d=new Date();while(days[d.toDateString()]){s++;d.setDate(d.getDate()-1);}return s;}
  function setText(id,v){var el=$el(id);if(el)el.textContent=v;}
  return{render:render};
})();

function editMottoPrompt(){
  var cur=localStorage.getItem('kfMotto')||'';
  var val=prompt('設定主標題勉勵詞（空白=恢復預設）：',cur);
  if(val===null)return;
  localStorage.setItem('kfMotto',val.trim());
  var el=$el('greetName');if(el)el.textContent=val.trim()||'加油';
  var tag=prompt('設定副標語（可空白）：',localStorage.getItem('kfTagline')||'');
  if(tag!==null){localStorage.setItem('kfTagline',tag.trim());var me=$el('homeMotto');if(me)me.textContent=tag.trim();}
}
/* ══ IMPORT PAGE ══ */
var ImportPage=(function(){
  var pages=[],audioFile=null,tags=[];
  function init(){
    $bind('audioInput','change',function(e){var f=e.target.files[0];if(!f)return;audioFile=f;renderAudio(f);});
    $bind('pagesInput','change',function(e){Array.from(e.target.files).forEach(function(f){pages.push(f);});renderPages();});
    $bind('impTagInput','keydown',function(e){if(e.key==='Enter'&&e.target.value.trim()){addTag(e.target.value.trim());e.target.value='';}});
    $bind('btnCreateCourse','click',createCourse);
  }
  function addTag(t){if(tags.indexOf(t)<0){tags.push(t);renderTags();}}
  function removeTag(t){tags=tags.filter(function(x){return x!==t;});renderTags();}
  function renderTags(){var el=$el('impTagList');if(!el)return;el.innerHTML=tags.map(function(t){return'<span class="tpill">'+esc(t)+'<span class="tpill-x" data-tag="'+esc(t)+'">✕</span></span>';}).join('');el.querySelectorAll('.tpill-x').forEach(function(x){x.addEventListener('click',function(){removeTag(x.dataset.tag);});});}
  function renderAudio(f){var list=$el('audioFileList');if(!list)return;var preview=$el('audioPreview');var url=URL.createObjectURL(f);preview.src=url;preview.addEventListener('loadedmetadata',function(){var dur=fmtTime(preview.duration);list.innerHTML='<div class="file-row"><div class="file-row-icon">🎵</div><div class="file-row-name">'+esc(f.name)+'</div><div class="file-row-meta">'+dur+'</div><div class="file-row-btn" id="audioPlayBtn">▶</div><div class="file-row-btn" id="audioDel">✕</div></div>';var pb=list.querySelector('#audioPlayBtn');if(pb)pb.addEventListener('click',function(){if(preview.paused){preview.play();pb.textContent='⏸';}else{preview.pause();pb.textContent='▶';}});var db=list.querySelector('#audioDel');if(db)db.addEventListener('click',function(){audioFile=null;$el('audioDropUI').style.borderColor='';$el('audioDropUI').style.background='';$el('audioFileList').innerHTML='';$el('btnCreateCourse').disabled=true;preview.src='';});});var dz=$el('audioDropUI');if(dz){dz.style.borderColor='var(--teal)';dz.style.background='var(--teal2)';}$el('btnCreateCourse').disabled=false;}
  function renderPages(){var list=$el('pagesFileList');if(!list)return;if(pages.length===0){list.innerHTML='';return;}list.innerHTML=pages.map(function(f,i){return'<div class="file-row"><div class="file-row-icon">🖼</div><div class="file-row-name">'+esc(f.name)+'</div><div class="file-row-btn" data-pi="'+i+'">👁</div><div class="file-row-btn" data-di="'+i+'">✕</div></div>';}).join('');list.querySelectorAll('[data-pi]').forEach(function(btn){btn.addEventListener('click',function(){var idx=parseInt(btn.dataset.pi);var url=URL.createObjectURL(pages[idx]);$el('imgPrevEl').src=url;$el('imgPrevOv').classList.add('open');});});list.querySelectorAll('[data-di]').forEach(function(btn){btn.addEventListener('click',function(){pages.splice(parseInt(btn.dataset.di),1);renderPages();});});}
  async function createCourse(){
    var title=($el('impTitle').value||'').trim();
    if(!title){Toast.warn('請輸入課程名稱');return;}
    if(!audioFile){Toast.warn('請選擇音訊檔案');return;}
    var btn=$el('btnCreateCourse');btn.disabled=true;btn.textContent='儲存中…';
    try{
      var audioBuf=await new Promise(function(res){var r=new FileReader();r.onload=function(){res(r.result);};r.readAsArrayBuffer(audioFile);});
      var audioDur=await new Promise(function(res){var a=document.createElement('audio');var u=URL.createObjectURL(audioFile);a.src=u;a.addEventListener('loadedmetadata',function(){res(a.duration);URL.revokeObjectURL(u);});a.addEventListener('error',function(){res(0);});});
      var pagesData=await Promise.all(pages.map(async function(f,i){var dataUrl=await new Promise(function(res2){var r=new FileReader();r.onload=function(){res2(r.result);};r.readAsDataURL(f);});return{id:i,imageUrl:dataUrl,time:i*60};}));
      var course={id:uuid(),title:title,description:($el('impDesc').value||'').trim(),tags:tags.slice(),pages:pagesData,audioData:audioBuf,audioDuration:audioDur,createdAt:Date.now()};
      await DB.put('courses',course);
      Toast.success('課程「'+title+'」建立成功！');
      pages=[];audioFile=null;tags=[];
      $el('impTitle').value='';$el('impDesc').value='';$el('impTagInput').value='';
      $el('audioFileList').innerHTML='';$el('pagesFileList').innerHTML='';$el('impTagList').innerHTML='';
      $el('audioDropUI').style.borderColor='';$el('audioDropUI').style.background='';
      btn.disabled=true;btn.textContent='建立課程';
      Router.go('home');await HomePage.render();
    }catch(e){console.error('[Import]',e);Toast.error('建立失敗：'+e.message);btn.disabled=false;btn.textContent='建立課程';}
  }
  function reset(){pages=[];audioFile=null;tags=[];}
  return{init:init,reset:reset};
})();
$el('imgPrevOv').addEventListener('click',function(){this.classList.remove('open');});
/* ══ PLAYER PAGE ══ */
var PlayerPage=(function(){
  var courseId=null,currentSlide=0,playState=false;
  var audio=null;
  function init(){
    audio=$el('audioPreview');
    document.querySelectorAll('.speed-btn').forEach(function(btn){btn.addEventListener('click',function(){document.querySelectorAll('.speed-btn').forEach(function(b){b.classList.remove('on');});btn.classList.add('on');if(audio)audio.playbackRate=parseFloat(btn.dataset.spd);});});
    $bind('btnPlay','click',togglePlay);
    $bind('btnBack10','click',function(){if(audio)audio.currentTime=Math.max(0,audio.currentTime-10);});
    $bind('btnFwd10','click',function(){if(audio)audio.currentTime=Math.min(audio.duration||0,audio.currentTime+10);});
    $bind('btnSkipB','click',function(){if(audio)audio.currentTime=0;});
    $bind('btnSkipF','click',function(){if(audio)audio.currentTime=audio.duration||0;});
    if(audio){
      audio.addEventListener('timeupdate',function(){$el('playerCur').textContent=fmtTime(audio.currentTime);updateSlideByTime();WaveUI.draw();});
      audio.addEventListener('loadedmetadata',function(){$el('playerDur').textContent=fmtTime(audio.duration);WaveUI.draw();});
      audio.addEventListener('ended',function(){$el('btnPlay').textContent='▶';playState=false;WaveUI.stopAnim();});
    }
  }
  async function load(cid){
    courseId=cid;currentSlide=0;
    try{
      var c=await DB.get('courses',cid);if(!c)return;
      $el('playerTitle').textContent=c.title;$el('playerBarTitle').textContent=c.title;
      $el('playerMeta').textContent=fmtDate(c.createdAt)+' · '+fmtTime(c.audioDuration||0);
      if(c.audioData){var blob=new Blob([c.audioData],{type:'audio/mp3'});audio.src=URL.createObjectURL(blob);}
      WaveUI.init(audio);
      renderSlides(c.pages||[]);
      renderChunks(cid);
    }catch(e){console.error('[Player]',e);}
  }
  function renderSlides(pgs){
    var strip=$el('playerThumbStrip');if(!strip)return;
    if(!pgs.length){strip.innerHTML='';$el('playerPageImg').style.display='none';return;}
    strip.innerHTML=pgs.map(function(p,i){return'<img class="player-thumb'+(i===0?' active-slide':'')+'" src="'+p.imageUrl+'" data-idx="'+i+'" data-time="'+p.time+'">';}).join('');
    strip.querySelectorAll('.player-thumb').forEach(function(img){img.addEventListener('click',function(){var idx=parseInt(img.dataset.idx);setSlide(idx);if(audio&&img.dataset.time)audio.currentTime=parseFloat(img.dataset.time);});});
    setSlide(0);
  }
  function setSlide(idx){
    currentSlide=idx;
    var imgs=$el('playerThumbStrip').querySelectorAll('.player-thumb');var pi=$el('playerPageImg');
    imgs.forEach(function(img,i){img.classList.toggle('active-slide',i===idx);});
    if(imgs[idx]){pi.src=imgs[idx].src;pi.style.display='block';}
  }
  function updateSlideByTime(){
    if(!audio)return;
    var t=audio.currentTime;var imgs=$el('playerThumbStrip').querySelectorAll('.player-thumb');
    var best=0;imgs.forEach(function(img,i){if(parseFloat(img.dataset.time||0)<=t)best=i;});
    if(best!==currentSlide)setSlide(best);
  }
  async function renderChunks(cid){
    var el=$el('chunkList');if(!el)return;
    try{var chunks=await DB.getAll('chunks');var cs=chunks.filter(function(c){return c.courseId===cid;}).sort(function(a,b){return(a.time||0)-(b.time||0);});if(!cs.length){el.innerHTML='<div class="empty"><div class="ic">💡</div><div class="empty-desc">尚無碎片，播放中按截取</div></div>';return;}el.innerHTML=cs.map(function(c){var lv=c.reviewLevel||0;return'<div class="chunk-card"><div style="display:flex;align-items:center;justify-content:space-between"><div class="chunk-title">'+esc(c.content||'').slice(0,60)+'</div><span class="chunk-lv chunk-lv-'+Math.min(lv,5)+'">Lv'+lv+'</span></div><div class="chunk-meta">'+fmtTime(c.time||0)+'</div></div>';}).join('');}catch(e){}
  }
  function togglePlay(){
    if(!audio)return;
    if(audio.paused){audio.play();$el('btnPlay').textContent='⏸';playState=true;WaveUI.startAnim();}
    else{audio.pause();$el('btnPlay').textContent='▶';playState=false;WaveUI.stopAnim();}
  }
  return{init:init,load:load};
})();
/* ══ REVIEW PAGE ══ */
var ReviewPage=(function(){
  async function render(){
    try{
      var chunks=await DB.getAll('chunks');var reviews=await DB.getAll('reviews');
      var due=chunks.filter(function(c){return Spaced.isDue(c);});
      var today_=new Date().toDateString();
      var todayDone=reviews.filter(function(r){return new Date(r.reviewedAt).toDateString()===today_;});
      var streak=calcStreak(reviews);
      setText('revDue',due.length);setText('revToday',todayDone.length);setText('revStreak',streak);setText('revTotal',chunks.length);
      var circle=document.querySelector('.review-circle');
      if(circle&&chunks.length)circle.style.setProperty('--prog',Math.round(due.length/chunks.length*360)+'deg');
      renderHeatmap(reviews);
    }catch(e){}
  }
  function calcStreak(reviews){var days={};reviews.forEach(function(r){days[new Date(r.reviewedAt).toDateString()]=true;});var s=0,d=new Date();while(days[d.toDateString()]){s++;d.setDate(d.getDate()-1);}return s;}
  function renderHeatmap(reviews){
    var el=$el('heatmap');if(!el)return;
    var days=91,cells=[];var d=new Date();
    for(var i=days-1;i>=0;i--){var dd=new Date(d);dd.setDate(d.getDate()-i);var ds=dd.toDateString();var cnt=reviews.filter(function(r){return new Date(r.reviewedAt).toDateString()===ds;}).length;var v=cnt===0?0:cnt<3?1:cnt<7?2:3;cells.push('<div class="hm-cell" data-v="'+v+'" title="'+dd.toLocaleDateString('zh-TW')+'"></div>');}
    el.innerHTML=cells.join('');
  }
  function setText(id,v){var el=$el(id);if(el)el.textContent=v;}
  async function start(){Toast.info('複習功能開發中');}
  return{render:render,start:start};
})();
/* ══ S LIBRARY ══ */
var SLibrary=(function(){
  function init(){}
  async function render(){
    try{var chunks=await DB.getAll('chunks');renderList(chunks);}catch(e){}
  }
  function renderList(chunks){
    var el=$el('slibList');if(!el)return;
    if(!chunks.length){el.innerHTML='<div class="empty"><div class="ic">💡</div><div class="empty-title">暫無碎片</div><div class="empty-desc">在學習艙中截取碎片</div></div>';return;}
    el.innerHTML=chunks.map(function(c){var lv=c.reviewLevel||0;return'<div class="chunk-card fu"><div style="display:flex;align-items:center;justify-content:space-between"><div class="chunk-title">'+esc(c.content||'').slice(0,60)+'</div><span class="chunk-lv chunk-lv-'+Math.min(lv,5)+'">Lv'+lv+'</span></div><div class="chunk-meta">'+fmtDate(c.createdAt)+'</div></div>';}).join('');
  }
  return{init:init,render:render};
})();
/* ══ SETTINGS PAGE ══ */
var SettingsPage=(function(){
  function init(){
    var en=$el('examNameInput');var ed=$el('examDateInput');var ak=$el('apiKeyInput');
    var savedName=Store.get('examName');var savedDate=Store.get('examDate');var savedKey=Store.get('apiKey');
    if(en&&savedName)en.value=savedName;
    if(ed&&savedDate)ed.value=savedDate;
    if(ak&&savedKey)ak.value=savedKey;
    var sname=$el('setExamName');if(sname&&savedName)sname.textContent=savedName;
    renderDbInfo();
    if(typeof GD!=='undefined') GD.init();
  }
  async function renderDbInfo(){
    try{
      var[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
      var subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
      $el('db-info').innerHTML='題目：'+qs.length+'<br>法條：'+ls.length+'<br>作答：'+ats.length+'<br>科目：'+(subs.join('、')||'（無）')+'<br>題型：選擇 '+qs.filter(q=>q.type==='mc').length+' / 申論 '+qs.filter(q=>q.type==='es').length;
      $el('exp-info').textContent=qs.length+' 題・'+ls.length+' 條・'+ats.length+' 筆';
    }catch(e){}
  }
  return{init:init};
})();

async function saveExamSettings(){
  var name=($el('examNameInput').value||'').trim();var date=$el('examDateInput').value;
  if(!name){Toast.warn('請輸入考試名稱');return;}
  await Store.save('examName',name);if(date)await Store.save('examDate',date);
  var sname=$el('setExamName');if(sname)sname.textContent=name;
  Toast.success('考試設定已儲存 ✓');
  await HomePage.render();
}
async function saveApiKey(){
  var key=($el('apiKeyInput').value||'').trim();
  if(!key){Toast.warn('請輸入 API Key');return;}
  await Store.save('apiKey',key);Toast.success('API Key 已儲存 ✓');
}
/* ══ EXAM (PE Quiz) ══ */
let _qStart=0;
const peQuiz={q:[],idx:0,ans:false,res:[],mode:'',_selected:new Set()};

function goKfPage(id){Router.go(id.startsWith('page-')?id:'page-'+id);}
function openExamMenu(){const el=$el('exam-menu');if(el){el.style.display='flex';}}
function closeExamMenu(){const el=$el('exam-menu');if(el){el.style.display='none';}}

async function startQ(mode){try{
  const pool=await getPriorityPool(mode);
  if(!pool.length){Toast.info(mode==='wrong'?'目前沒有錯題':'目前沒有題目');return;}
  startQWithPool(pool,mode);
}catch(e){logError('startQ',e);}}

function startQWithPool(pool,mode){
  Object.assign(peQuiz,{q:pool,idx:0,ans:false,res:[],mode:mode||'all',_selected:new Set()});
  const qfoot=$el('qfoot');if(qfoot)qfoot.style.display='';
  renderQCard();
  $el('qv').style.display='flex';
}

function renderQCard(){
  const{q,idx}=peQuiz;
  if(idx>=q.length){showQDone();return;}
  const qu=q[idx];_qStart=Date.now();peQuiz._selected=new Set();
  ['qbadge','qmeta','q-type-hint','qstem','qopts','qres'].forEach(id=>{const el=$el(id);if(el)el.style.display='';});
  const doneArea=$el('qdone-area');if(doneArea){doneArea.style.display='none';doneArea.innerHTML='';}
  const qfoot=$el('qfoot');if(qfoot)qfoot.style.display='';
  $el('qpb').style.width=((idx/q.length)*100)+'%';
  $el('qct').textContent=(idx+1)+'/'+q.length;
  const danger=getDangerLevel(qu,[])||'';
  $el('qbadge').className='badge '+(qu.type==='mc'?'bmc':'bes');
  $el('qbadge').textContent=(qu.type==='mc'?'選擇':'申論');
  $el('qmeta').textContent=[qu.subject,qu.year,qu.num?'第'+qu.num+'題':'',danger].filter(Boolean).join(' · ');
  $el('qstem').textContent=qu.stem||'';
  const resEl=$el('qres');resEl.className='qres';resEl.textContent='';
  const noteEl=$el('qnote');noteEl.style.display='none';noteEl.textContent='';
  const star=$el('qstar');star.className='qfb qstar'+(qu.starred?' on':'');star.textContent=qu.starred?'★':'☆';
  $el('qnxt').classList.add('hide');
  if(qu.type==='mc'){
    $el('qes').style.display='none';
    const optsEl=$el('qopts');
    const ansStr=(qu.answer||'').replace(/[, ]/g,'');const isMulti=ansStr.length>1;
    peQuiz._selected=new Set();
    const hintEl=$el('q-type-hint');if(hintEl)hintEl.textContent=isMulti?'🔢 複選題（可選多個）':'☑ 單選題';
    optsEl.innerHTML=Object.entries(qu.options||{}).map(([k,v])=>'<div class="qopt" data-key="'+k+'" onclick="selectOptByEl(this)"><div class="qok">'+k+'</div><div class="qov">'+esc(v)+'</div></div>').join('');
    const cfmBtn=$el('qmulti-confirm');if(cfmBtn){cfmBtn.classList.remove('hide');cfmBtn.textContent='確認答案';}
    const lawEl=$el('qlaw');if(lawEl)lawEl.style.display='none';
  }else{
    $el('qopts').innerHTML='';$el('qes').style.display='block';
    $el('qrevbtn').textContent='顯示參考答案 / 解析';$el('qrevbtn').disabled=false;
    const cfmBtnEs=$el('qmulti-confirm');if(cfmBtnEs)cfmBtnEs.classList.add('hide');
    showQLawLinks(qu);
  }
}

function showQLawLinks(qu){
  const lawEl=$el('qlaw');const listEl=$el('qlaw-list');const laws=qu.relatedLaws||[];
  if(!laws.length){if(lawEl)lawEl.style.display='none';return;}
  if(listEl)listEl.innerHTML=laws.map(l=>'<span class="tag" style="color:var(--pur);cursor:pointer" onclick="showLawPop(\''+esc(l.ref||l.lawName||'')+'\')">⚖ '+esc(l.ref||l.lawName||'')+'</span>').join('');
  if(lawEl)lawEl.style.display='block';
}

function selectOptByEl(el){
  const qu=peQuiz.q[peQuiz.idx];if(!qu||peQuiz.ans)return;
  const k=el.querySelector('.qok').textContent;
  const ansStr=(qu.answer||'').replace(/[, ]/g,'');const isMulti=ansStr.length>1;
  if(isMulti){if(peQuiz._selected.has(k))peQuiz._selected.delete(k);else peQuiz._selected.add(k);}
  else{peQuiz._selected=new Set([k]);}
  document.querySelectorAll('.qopt').forEach(o=>{const ok=o.querySelector('.qok')?.textContent;o.classList.toggle('selected-opt',peQuiz._selected.has(ok));});
}

async function submitAnswer(){try{
  const qu=peQuiz.q[peQuiz.idx];if(!qu||peQuiz.ans)return;
  if(qu.type==='es'){revealES();return;}
  if(!peQuiz._selected.size){Toast.warn('請先選擇答案');return;}
  peQuiz.ans=true;
  const responseTime=Date.now()-_qStart;
  const ansStr=(qu.answer||'').toUpperCase().split('').sort().join('');
  const selStr=[...peQuiz._selected].sort().join('');
  const correct=selStr===ansStr;
  const hesitant=responseTime>40000;
  const curLevel=qu.reviewLevel||0;
  const{level:newLevel,next:nextReview}=calcNextReview(curLevel,correct);
  qu.reviewLevel=newLevel;qu.nextReview=nextReview;qu.lastReview=Date.now();
  qu.wrongCount=(qu.wrongCount||0)+(correct?0:1);
  await dp('questions',qu);
  await dp('attempts',{qid:qu.id,correct,date:today(),responseTime,hesitationFlag:hesitant});
  const opts=document.querySelectorAll('.qopt');
  const correctKeys=(qu.answer||'').toUpperCase().split('');
  opts.forEach(o=>{const k=o.querySelector('.qok')?.textContent;if(!k)return;const isC=correctKeys.includes(k);const isS=peQuiz._selected.has(k);o.classList.remove('selected-opt');if(isC)o.classList.add('correct');else if(isS)o.classList.add('wrong');else o.classList.add('dim');});
  const cfmBtn=$el('qmulti-confirm');if(cfmBtn)cfmBtn.classList.add('hide');
  const resEl=$el('qres');resEl.className='qres on '+(correct?'c':'w');
  let msg=correct?'✓ 正確！':'✗ 正確答案：'+(qu.answer||'');
  if(hesitant)msg+=' ⚠ 作答超過40秒';
  resEl.textContent=msg;
  if(qu.note){const noteEl=$el('qnote');noteEl.style.display='block';noteEl.textContent='📝 '+qu.note;}
  showQLawLinks(qu);$el('qlaw').style.display='block';
  $el('qnxt').classList.remove('hide');
  peQuiz.res.push({qid:qu.id,correct,responseTime,hesitant});
}catch(e){logError('submitAnswer',e);}}

function revealES(){
  const qu=peQuiz.q[peQuiz.idx];const ans=qu.answerEs||qu.answer||'';
  const resEl=$el('qres');resEl.className='qres on r';
  resEl.innerHTML='<b>參考解析：</b><br>'+esc(ans);resEl.style.display='block';
  const rb=$el('qrevbtn');if(rb)rb.disabled=true;
  $el('qnxt').classList.remove('hide');
}

function nextQ(){peQuiz.idx++;peQuiz.ans=false;renderQCard();}

function exitQ(){$el('qv').style.display='none';}

function toggleQStar(){
  const qu=peQuiz.q[peQuiz.idx];if(!qu)return;
  qu.starred=!qu.starred;dp('questions',qu).catch(()=>{});
  const star=$el('qstar');if(star){star.textContent=qu.starred?'★':'☆';star.classList.toggle('on',qu.starred);}
}

function showQDone(){
  const {res,q}=peQuiz;
  const correct=res.filter(r=>r.correct).length;
  const acc=q.length?Math.round(correct/Math.min(res.length,q.length)*100):0;
  const avgT=res.length?Math.round(res.reduce((s,r)=>s+(r.responseTime||0),0)/res.length/1000):0;
  const qfoot=$el('qfoot');if(qfoot)qfoot.style.display='none';
  ['qbadge','qmeta','q-type-hint','qstem','qopts','qres'].forEach(id=>{const el=$el(id);if(el)el.style.display='none';});
  const doneArea=$el('qdone-area');if(!doneArea)return;
  doneArea.style.display='flex';
  doneArea.innerHTML='<div class="done-trophy">🏆</div>'+
    '<div class="done-title">本次測驗完成！</div>'+
    '<div class="done-stats">'+
      '<div class="done-stat"><div class="done-stat-val">'+correct+'</div><div class="done-stat-lbl">答對題數</div></div>'+
      '<div class="done-stat"><div class="done-stat-val">'+acc+'%</div><div class="done-stat-lbl">正確率</div></div>'+
      '<div class="done-stat"><div class="done-stat-val">'+q.length+'</div><div class="done-stat-lbl">總題數</div></div>'+
      '<div class="done-stat"><div class="done-stat-val">'+avgT+'s</div><div class="done-stat-lbl">平均作答</div></div>'+
    '</div>'+
    '<button class="btn-gold" onclick="exitQ()" style="width:100%;max-width:280px;padding:14px;border-radius:12px;font-size:15px;font-weight:700">返回</button>';
}

async function startQuick(){try{
  const pool=await getPriorityPool('all');
  if(!pool.length){Toast.info('目前沒有題目');return;}
  startQWithPool(pool.slice(0,5),'quick');
}catch(e){logError('startQuick',e);}}

async function startNumberMode(){
  const qs=await da('questions').catch(()=>[]);
  const mc=qs.filter(q=>q.type==='mc');
  if(!mc.length){Toast.info('題庫是空的');return;}
  window._numPool=mc;window._numIdx=0;window._numScore=0;
  $el('num-ov').style.display='flex';nextNumQ();
}
function nextNumQ(){
  const pool=window._numPool||[];if(!pool.length)return;
  const q=pool[Math.floor(Math.random()*pool.length)];window._numCur=q;
  $el('num-q').textContent=q.stem?q.stem.slice(0,30)+'…':q.subject||'—';
  $el('num-ans').value='';const res=$el('num-res');res.className='num-ans';res.style.display='none';
  $el('num-next').style.display='none';
}
function checkNumAns(){
  const v=$el('num-ans').value.trim();const q=window._numCur;if(!q||!v)return;
  const correct=v===q.answer;const res=$el('num-res');
  res.className='num-ans '+(correct?'ok':'ng');
  res.textContent=correct?'✓ 正確！':'✗ 答案：'+q.answer;res.style.display='block';
  $el('num-next').style.display='block';
  if(correct)window._numScore=(window._numScore||0)+1;
  $el('num-score').textContent='本次得分：'+(window._numScore||0);
}
/* ══ QUESTIONS (PE) ══ */
let _dupResolve=null;

async function renderHome(){try{
  const[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  const now=Date.now();const todayStr=today();
  setText2('eStat2',qs.length);setText2('eStat3',qs.filter(q=>(q.nextReview||0)<=now&&q.reviewLevel!==undefined).length);
  const todayAtt=ats.filter(a=>a.date===todayStr);const correct=todayAtt.filter(a=>a.correct).length;
  setText2('eStat0',todayAtt.length);setText2('eStat1',todayAtt.length?Math.round(correct/todayAtt.length*100)+'%':'—');
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))];
  ['bi-subs','bi-subs2'].forEach(id=>{const el=$el(id);if(el)el.innerHTML=subs.map(s=>'<option value="'+esc(s)+'">').join('');});
  const expEl=$el('exp-info');if(expEl)expEl.textContent=qs.length+' 題・'+ls.length+' 條・'+ats.length+' 筆';
}catch(e){logError('renderHome',e);}}

function setText2(id,v){const el=$el(id);if(el)el.textContent=v;}

async function renderList(){try{
  const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const kw=($el('si')?.value||'').toLowerCase().trim();
  const f=S.filter||'all';const sf=S.subF||'all';const ws=getWrong(qs,ats);
  let fl=qs.filter(q=>{
    if(f==='mc'&&q.type!=='mc')return false;
    if(f==='es'&&q.type!=='es')return false;
    if(f==='wrong'&&!ws.has(q.id))return false;
    if(f==='star'&&!q.starred)return false;
    if(sf!=='all'&&q.subject!==sf)return false;
    if(kw){
      // searchBlob 優先（saveQ 時預建索引），fallback 即時組合
      const h=(q.searchBlob||(q.stem||'')+(q.subject||'')+(q.keywords||[]).join(' ')).toLowerCase();
      if(!h.includes(kw))return false;
    }
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const lcEl=$el('lc');
  if(lcEl)lcEl.textContent='共 '+fl.length+' 題';
  // 科目 chip
  const subs=[...new Set(qs.map(q=>q.subject).filter(Boolean))].sort();
  const schips=$el('schips');
  if(schips){
    schips.innerHTML='';
    ['all',...subs].forEach(s=>{
      const b=document.createElement('button');
      b.className='chip'+((s==='all'&&sf==='all')||(s!=='all'&&sf===s)?' on':'');
      b.textContent=s==='all'?'全部科目':s;
      b.onclick=()=>{S.subF=s;renderList();};
      schips.appendChild(b);
    });
  }
  // Infinite scroll
  const PAGE=50;let page=0;
  const el=$el('qlist');if(!el)return;
  el.innerHTML='';
  const pgEl=$el('page-q-library');
  if(window._qlScroll&&pgEl)pgEl.removeEventListener('scroll',window._qlScroll);
  const _mkQCard=(q)=>{
    const danger=getDangerLevel(q,ats);
    const div=document.createElement('div');
    div.className='card fu';
    div.style.cssText='margin:5px 16px;cursor:pointer';
    div.innerHTML=
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">'+
        '<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'+
        (q.year?'<span class="tag">'+esc(q.year)+'</span>':'')+
        (q.exam?'<span class="tag">'+esc(q.exam)+'</span>':'')+
        '<span class="tag">'+esc(q.subject||'未分類')+'</span>'+
        '<span style="font-size:12px;margin-left:auto">'+danger+'</span>'+
        '<span style="font-size:14px;margin-left:4px">'+(q.starred?'★':'☆')+'</span>'+
      '</div>'+
      '<div style="font-size:13px;color:var(--t1);line-height:1.6;margin-bottom:8px;word-break:break-word">'+esc((q.stem||'').slice(0,120))+'</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
        '<button class="chip" style="font-size:11px" onclick="event.stopPropagation();editQ('+q.id+')">✏ 編輯</button>'+
        '<button class="chip" style="font-size:11px" onclick="event.stopPropagation();startSingleQ('+q.id+')">▶ 練習</button>'+
        '<button class="chip" style="font-size:11px" onclick="event.stopPropagation();toggleStar('+q.id+')">'+(q.starred?'★':'☆')+'</button>'+
        '<button class="chip" style="font-size:11px;color:var(--red);margin-left:auto" onclick="event.stopPropagation();delQ('+q.id+')">🗑</button>'+
      '</div>';
    return div;
  };
  const loadMore=()=>{
    const batch=fl.slice(page*PAGE,(page+1)*PAGE);
    if(!batch.length)return;
    batch.forEach(q=>el.appendChild(_mkQCard(q)));
    page++;
    if(lcEl){
      const shown=Math.min(page*PAGE,fl.length);
      lcEl.textContent=shown<fl.length?'共 '+fl.length+' 題（已顯示 '+shown+'，繼續滑動）':'共 '+fl.length+' 題';
    }
  };
  loadMore();
  if(pgEl){
    const onScroll=()=>{if(pgEl.scrollHeight-pgEl.scrollTop-pgEl.clientHeight<200)loadMore();};
    window._qlScroll=onScroll;
    pgEl.addEventListener('scroll',onScroll,{passive:true});
  }
}catch(e){logError('renderList',e);}}
const _debouncedRenderList=debounce(renderList,200);

function setF(f,btn){S.filter=f;document.querySelectorAll('[onclick*="setF"]').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderList();}

async function toggleStar(id){try{const q=await dg('questions',id);if(!q)return;q.starred=!q.starred;await dp('questions',q);toast(q.starred?'已收藏 ⭐':'取消收藏');renderList();}catch(e){}}

async function startSingleQ(id){try{const q=await dg('questions',id);if(!q)return;startQWithPool([q],'single');}catch(e){}}

async function delQ(id){try{
  if(!confirm('確定刪除此題目？'))return;
  await dd('questions',id);toast('已刪除');renderList();
}catch(e){logError('delQ',e);}}

async function editQ(id){try{
  const q=await dg('questions',id);if(!q)return;
  S.editId=id;
  $el('qstemInput').value=q.stem||'';$el('answerInput').value=q.answer||'';
  $el('optA').value=q.options?.A||'';$el('optB').value=q.options?.B||'';
  $el('optC').value=q.options?.C||'';$el('optD').value=q.options?.D||'';
  $el('answerEs').value=q.answerEs||'';$el('subInput').value=q.subject||'';
  $el('yrInput').value=q.year||'';$el('exInput').value=q.exam||'';
  $el('numInput').value=q.num||'';$el('noteInput').value=q.note||'';
  peSetQT(q.type||'mc');
  $el('ei-edit-info').style.display='block';
  switchEiTab('single',document.getElementById('eitab-single'));
  Router.go('page-exam-import');
}catch(e){logError('editQ',e);}}

async function saveQ(){try{
  const stem=($el('qstemInput').value||'').trim();if(!stem){Toast.warn('請輸入題目');return;}
  const type=S.qType;const opts={};
  if(type==='mc'){['A','B','C','D'].forEach(k=>{const v=($el('opt'+k)?.value||'').trim();if(v)opts[k]=v;});}
  const q={stem,type,options:opts,answer:($el('answerInput')?.value||'').trim().toUpperCase(),
    answerEs:($el('answerEs')?.value||'').trim(),subject:($el('subInput')?.value||'').trim(),
    year:($el('yrInput')?.value||'').trim(),exam:($el('exInput')?.value||'').trim(),
    num:parseInt($el('numInput')?.value)||undefined,note:($el('noteInput')?.value||'').trim(),
    keywords:autoKeywords(stem),createdAt:Date.now(),reviewLevel:0,nextReview:Date.now(),
  };
  if(S.editId){q.id=S.editId;const old=await dg('questions',S.editId).catch(()=>({}));Object.assign(q,{reviewLevel:old?.reviewLevel||0,nextReview:old?.nextReview||Date.now(),wrongCount:old?.wrongCount||0});}
  await dp('questions',q);S.editId=null;$el('ei-edit-info').style.display='none';
  Toast.success((S.editId?'已更新':'已儲存')+' ✓');resetEiForm();
  await renderHome();
}catch(e){logError('saveQ',e);}}

function resetEiForm(){['qstemInput','answerInput','optA','optB','optC','optD','answerEs','subInput','yrInput','exInput','numInput','noteInput'].forEach(id=>{const el=$el(id);if(el)el.value='';});S.editId=null;$el('ei-edit-info').style.display='none';}
function peSetQT(t){S.qType=t;['mc','es'].forEach(x=>{const b=$el('qt-'+x);if(b)b.classList.toggle('on',x===t);});if($el('opts-wrap'))$el('opts-wrap').style.display=t==='mc'?'':'none';if($el('es-wrap'))$el('es-wrap').style.display=t==='es'?'':'none';}
function switchEiTab(tab,btn){['single','bulk','json'].forEach(t=>{const el=$el('ei-'+t);if(el)el.style.display=t===tab?'':'none';});document.querySelectorAll('[id^="eitab-"]').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');}

async function openBulkDelQ(){try{
  const qs=await da('questions');
  if(!qs.length){toast('目前無題目');return;}
  const years=[...new Set(qs.map(q=>q.year||'').filter(Boolean))].sort().reverse();
  const exams=[...new Set(qs.map(q=>q.exam||'').filter(Boolean))].sort();
  const subs=[...new Set(qs.map(q=>q.subject||'').filter(Boolean))].sort();
  const modal=document.createElement('div');
  modal.id='bulk-del-q-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.7);display:flex;align-items:flex-end;backdrop-filter:blur(3px)';
  modal.innerHTML='<div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:85vh;overflow-y:auto;border-top:1px solid var(--bd2)"><div style="width:36px;height:4px;background:var(--bg4);border-radius:2px;margin:0 auto 16px"></div><div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:6px">🗑 題目大量刪除</div><div style="font-size:12px;color:var(--t2);margin-bottom:12px;line-height:1.6">依條件篩選刪除，或指定題號。<b style="color:var(--red)">刪除後無法復原。</b></div><div style="display:flex;flex-direction:column;gap:10px"><div><label style="font-size:12px;font-weight:600;color:var(--t2);display:block;margin-bottom:4px">年度</label><input id="bdq-year" list="bdq-yl" placeholder="例：113（留空不限）" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px"><datalist id="bdq-yl">'+years.map(y=>'<option value="'+y+'">').join('')+'</datalist></div><div><label style="font-size:12px;font-weight:600;color:var(--t2);display:block;margin-bottom:4px">考試別</label><input id="bdq-exam" list="bdq-el" placeholder="例：升官等（留空不限）" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px"><datalist id="bdq-el">'+exams.map(e=>'<option value="'+e+'">').join('')+'</datalist></div><div><label style="font-size:12px;font-weight:600;color:var(--t2);display:block;margin-bottom:4px">科目</label><input id="bdq-sub" list="bdq-sl" placeholder="例：警察法規（留空不限）" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px"><datalist id="bdq-sl">'+subs.map(s=>'<option value="'+s+'">').join('')+'</datalist></div><div><label style="font-size:12px;font-weight:600;color:var(--t2);display:block;margin-bottom:4px">指定題號（逗號分隔，留空刪除所有符合條件）</label><input id="bdq-nums" placeholder="例：1,2,5,10" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px"></div></div><div id="bdq-preview" style="margin-top:12px;font-size:12px;color:var(--t2)"></div><div style="display:flex;gap:8px;margin-top:16px"><button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t1);font-size:13px;font-weight:600;cursor:pointer" onclick="document.getElementById(\'bulk-del-q-modal\').remove()">取消</button><button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t2);font-size:13px;font-weight:600;cursor:pointer" onclick="previewBulkDelQ()">預覽</button><button style="flex:1;padding:12px;border-radius:10px;background:var(--red);color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:none" onclick="confirmBulkDelQ()">確認刪除</button></div></div>';
  document.body.appendChild(modal);
}catch(e){logError('openBulkDelQ',e);}}

async function previewBulkDelQ(){try{
  const targets=_filterBulkDelQ(await da('questions'));
  const el=document.getElementById('bdq-preview');
  if(el)el.innerHTML='<span style="color:var(--org)">符合條件：<b>'+targets.length+'</b> 題將被刪除</span>';
}catch(e){logError('previewBulkDelQ',e);}}

async function confirmBulkDelQ(){try{
  const targets=_filterBulkDelQ(await da('questions'));
  if(!targets.length){toast('無符合條件的題目');return;}
  if(!confirm('確定刪除 '+targets.length+' 題？\n此操作無法復原！'))return;
  for(const q of targets)await dd('questions',q.id);
  const m=document.getElementById('bulk-del-q-modal');if(m)m.remove();
  toast('已刪除 '+targets.length+' 題 ✓');
  renderHome();renderList();
}catch(e){logError('confirmBulkDelQ',e);}}

function _filterBulkDelQ(qs){
  const yr=(document.getElementById('bdq-year')||{}).value?.trim()||'';
  const ex=(document.getElementById('bdq-exam')||{}).value?.trim()||'';
  const sub=(document.getElementById('bdq-sub')||{}).value?.trim()||'';
  const nums=(document.getElementById('bdq-nums')||{}).value?.trim()||'';
  const numSet=nums?new Set(nums.split(/[,，、\s]+/).map(n=>n.trim()).filter(Boolean)):null;
  return qs.filter(q=>{
    if(yr&&(q.year||'')!==yr)return false;
    if(ex&&(q.exam||'')!==ex)return false;
    if(sub&&(q.subject||'')!==sub)return false;
    if(numSet&&!numSet.has(String(q.num||'')))return false;
    return true;
  });
}

/* ── Browse ── */
let _browseQs=[];
async function openBrowse(){try{
  window._brType=window._brType||'all';
  _browseQs=await da('questions');
  const subs=[...new Set(_browseQs.map(q=>q.subject).filter(Boolean))].sort();
  const chEl=$el('br-chips');
  if(chEl)chEl.innerHTML=
    '<button class="chip on" onclick="setBrFilter(this,\'all\')">全部科目</button>'+
    subs.map(s=>'<button class="chip" onclick="setBrFilter(this,\''+esc(s)+'\')">'+esc(s)+'</button>').join('');
  const years=[...new Set(_browseQs.map(q=>q.year).filter(Boolean))].sort().reverse();
  const yrEl=$el('br-year-chips2');
  if(yrEl)yrEl.innerHTML=
    '<button class="chip on" onclick="setBrYear(this,\'\')">全部年度</button>'+
    years.map(y=>'<button class="chip" onclick="setBrYear(this,\''+esc(y)+'\')">'+esc(y)+'</button>').join('');
  window._brFilter='all';window._brYear='';
  const kwEl=$el('br-search');if(kwEl)kwEl.value='';
  browseSearch();
  $el('browse-ov').style.display='flex';
}catch(e){logError('openBrowse',e);}}
function closeBrowse(){$el('browse-ov').style.display='none';}
function setBrFilter(el,v){document.querySelectorAll('#br-chips .chip').forEach(c=>c.classList.remove('on'));el.classList.add('on');window._brFilter=v;browseSearch();}
function setBrYear(el,v){document.querySelectorAll('#br-year-chips2 .chip').forEach(c=>c.classList.remove('on'));el.classList.add('on');window._brYear=v;browseSearch();}
function setBrType(el,typeFilter){
  document.querySelectorAll('#br-type-all,#br-type-mc,#br-type-es').forEach(b=>{if(b)b.classList.remove('on');});
  el.classList.add('on');window._brType=typeFilter;renderBrowseList();
}
function setBrTab(tab,btn){document.querySelectorAll('[id^="brtab-"]').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');}
function browseSearch(){renderBrowseList();}
const _debouncedBrowseSearch=debounce(browseSearch,200);
function setBrTypeQ(v,el){window._brType=v;document.querySelectorAll('[onclick*="setBrTypeQ"]').forEach(b=>b.classList.remove('on'));if(el)el.classList.add('on');browseSearch();}

function renderBrowseList(){
  const kw=($el('br-search')?.value||'').toLowerCase().trim();
  const f=window._brFilter||'all';
  const yr=window._brYear||'';
  const typeF=window._brType||'all';
  let fl=_browseQs.filter(q=>{
    if(typeF!=='all'&&q.type!==typeF)return false;
    if(f!=='all'&&q.subject!==f)return false;
    if(yr&&q.year!==yr)return false;
    if(kw){
      // searchBlob 優先加速
      const h=((q.searchBlob)||(q.stem||'')+(q.subject||'')+(q.year||'')+(q.keywords||[]).join(' ')+(q.tags||[]).join(' ')).toLowerCase();
      if(!h.includes(kw))return false;
    }
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const el=$el('br-list');if(!el)return;
  if(!fl.length){el.innerHTML='<div class="empty"><div class="ic">🔍</div><div style="color:var(--t2)">沒有符合的題目</div></div>';return;}
  el.innerHTML=fl.map(q=>{
    const rl=(q.relatedLaws||[]).map(l=>
      '<span class="tag" style="color:var(--pur);cursor:pointer" onclick="showLawPop(\''+esc(l.ref||l.lawName||'')+'\')">⚖ '+esc(l.ref||l.lawName||'')+'</span>'
    ).join('');
    const opts=q.type==='mc'?Object.entries(q.options||{}).map(([k,v])=>
      '<div style="font-size:12px;color:var(--t2);padding:1px 0">('+k+') '+esc(v)+'</div>'
    ).join(''):'';
    return '<div class="card" style="margin:5px 12px">'
      +'<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;flex-wrap:wrap">'
        +'<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'
        +'<span class="tag">'+esc(q.subject||'未分類')+'</span>'
        +(q.year?'<span class="tag">'+esc(q.year)+'</span>':'')
        +(q.exam?'<span class="tag">'+esc(q.exam)+'</span>':'')
        +(q.num?'<span class="tag">第'+esc(q.num)+'題</span>':'')
        +(q.starred?'<span style="color:var(--org)">⭐</span>':'')
        +(q.reviewLevel!==undefined?'<span class="tag" style="color:var(--acc)">Lv'+q.reviewLevel+'</span>':'')
      +'</div>'
      +'<div style="font-size:14px;line-height:1.65;color:var(--t1);margin-bottom:6px;word-break:break-all">'+esc(q.stem||'')+'</div>'
      +opts
      +(q.answer?'<div style="font-size:12px;color:var(--grn);margin-top:4px;font-weight:600">答案：'+esc(q.answer)+'</div>':'')
      +(q.answerEs?'<div style="font-size:12px;color:var(--t2);margin-top:3px">解析：'+esc(q.answerEs).slice(0,80)+'…</div>':'')
      +(rl?'<div style="margin-top:6px">'+rl+'</div>':'')
    +'</div>';
  }).join('');
}
/* ══ INLINE BROWSE (page-pg-list) ══ */
let _inlineQs=[],_inlineLaws=[];
let _ibQType='all',_ibQSub='all',_ibQYear='';
let _ibLawCat='all',_ibLawName='all';

async function openInlineBrowse(){try{
  _inlineQs=await da('questions');
  _inlineLaws=await da('laws');
  _buildInlineQChips();
  renderInlineList();
}catch(e){logError('openInlineBrowse',e);}}

function switchBrowseTab(tab,btn){
  document.querySelectorAll('#page-pg-list .chip-row .chip[id^="tab-"]').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  const qPanel=$el('browse-q-panel'),dPanel=$el('browse-d-panel');
  if(tab==='q'){
    if(qPanel)qPanel.style.display='';
    if(dPanel)dPanel.style.display='none';
    _buildInlineQChips();
    renderInlineList();
  }else{
    if(qPanel)qPanel.style.display='none';
    if(dPanel)dPanel.style.display='';
    _buildInlineLawChips();
    renderInlineLawList();
  }
}

function _buildInlineQChips(){
  const subs=[...new Set(_inlineQs.map(q=>q.subject).filter(Boolean))].sort();
  const subEl=$el('bq-sub-chips');
  if(subEl)subEl.innerHTML='<button class="chip'+(_ibQSub==='all'?' on':'')+'" onclick="setInlineQSub(\'all\',this)">全部科目</button>'+
    subs.map(s=>'<button class="chip'+(_ibQSub===s?' on':'')+'" onclick="setInlineQSub(\''+esc(s)+'\',this)">'+esc(s)+'</button>').join('');
  const years=[...new Set(_inlineQs.map(q=>q.year).filter(Boolean))].sort().reverse();
  const yrEl=$el('bq-year-chips');
  if(yrEl)yrEl.innerHTML='<button class="chip"'+(!_ibQYear?' class="on"':'')+' onclick="setInlineQYear(\'\',this)">全部年度</button>'+
    years.map(y=>'<button class="chip'+(_ibQYear===y?' on':'')+'" onclick="setInlineQYear(\''+esc(y)+'\',this)">'+esc(y)+'</button>').join('');
  // fix: make "全部年度" on by default
  const firstYr=yrEl&&yrEl.querySelector('button');if(firstYr&&!_ibQYear)firstYr.classList.add('on');
}

function setInlineQSub(v,btn){
  _ibQSub=v;
  document.querySelectorAll('#bq-sub-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderInlineList();
}
function setInlineQYear(v,btn){
  _ibQYear=v;
  document.querySelectorAll('#bq-year-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderInlineList();
}
function setBrowseQType(v,btn){
  _ibQType=v;
  document.querySelectorAll('#bq-type-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderInlineList();
}

function renderInlineList(){
  const kw=($el('bq-search')?.value||'').toLowerCase().trim();
  let fl=_inlineQs.filter(q=>{
    if(_ibQType!=='all'&&q.type!==_ibQType)return false;
    if(_ibQSub!=='all'&&q.subject!==_ibQSub)return false;
    if(_ibQYear&&q.year!==_ibQYear)return false;
    if(kw){const h=((q.stem||'')+(q.subject||'')+(q.year||'')).toLowerCase();if(!h.includes(kw))return false;}
    return true;
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const cntEl=$el('bq-count');if(cntEl)cntEl.textContent=fl.length;
  const el=$el('bq-list');if(!el)return;
  if(!fl.length){el.innerHTML='<div class="empty"><div class="ic">🔍</div><div class="empty-desc">沒有符合的題目</div></div>';return;}
  el.innerHTML=fl.slice(0,80).map(q=>{
    const opts=q.type==='mc'?Object.entries(q.options||{}).map(([k,v])=>'<div style="font-size:12px;color:var(--t2);padding:1px 0">('+k+') '+esc(v)+'</div>').join(''):'';
    return'<div class="card fu" style="margin:5px 16px">'+
      '<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;flex-wrap:wrap">'+
        '<span class="badge '+(q.type==='mc'?'bmc':'bes')+'">'+(q.type==='mc'?'選擇':'申論')+'</span>'+
        (q.subject?'<span class="tag">'+esc(q.subject)+'</span>':'')+
        (q.year?'<span class="tag">'+esc(q.year)+'</span>':'')+
        (q.num?'<span class="tag">第'+esc(String(q.num))+'題</span>':'')+
        (q.starred?'<span style="margin-left:auto;font-size:13px">★</span>':'')+
      '</div>'+
      '<div style="font-size:14px;line-height:1.65;color:var(--t1);margin-bottom:6px">'+esc(q.stem||'')+'</div>'+
      opts+
      (q.answer?'<div style="font-size:12px;color:var(--grn);margin-top:4px;font-weight:600">答案：'+esc(q.answer)+'</div>':'')+
    '</div>';
  }).join('');
}

function _buildInlineLawChips(){
  const names=[...new Set(_inlineLaws.map(l=>l.lawName).filter(Boolean))].sort();
  const nameEl=$el('bd-law-chips');
  if(nameEl)nameEl.innerHTML='<button class="chip'+(_ibLawName==='all'?' on':'')+'" onclick="setInlineLawName(\'all\',this)">全部法律</button>'+
    names.map(n=>'<button class="chip'+(_ibLawName===n?' on':'')+'" onclick="setInlineLawName(\''+esc(n)+'\',this)">'+esc(n)+'</button>').join('');
}
function setBrowseLawCat(v,btn){
  _ibLawCat=v;
  document.querySelectorAll('#bd-cat-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  _ibLawName='all';
  _buildInlineLawChips();
  renderInlineLawList();
}
function setInlineLawName(v,btn){
  _ibLawName=v;
  document.querySelectorAll('#bd-law-chips .chip').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderInlineLawList();
}

function renderInlineLawList(){
  const kw=($el('bd-search')?.value||'').toLowerCase().trim();
  let fl=_inlineLaws.filter(l=>{
    if(_ibLawCat!=='all'&&l.category!==_ibLawCat)return false;
    if(_ibLawName!=='all'&&l.lawName!==_ibLawName)return false;
    if(kw){const h=((l.lawName||'')+(l.article||'')+(l.content||'')).toLowerCase();if(!h.includes(kw))return false;}
    return true;
  }).sort((a,b)=>(a.articleNumber||0)-(b.articleNumber||0));
  const cntEl=$el('bd-count');if(cntEl)cntEl.textContent=fl.length;
  const el=$el('bd-list');if(!el)return;
  if(!fl.length){el.innerHTML='<div class="empty"><div class="ic">📜</div><div class="empty-desc">沒有符合的資料</div></div>';return;}
  el.innerHTML=fl.slice(0,100).map(l=>'<div class="card fu" style="margin:5px 16px">'+
    '<div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:4px">'+esc(l.lawName||'')+(l.article?' · '+esc(l.article):'')+'</div>'+
    (l.articleTitle?'<div style="font-size:12px;color:var(--t2);margin-bottom:4px">'+esc(l.articleTitle)+'</div>':'')+
    '<div style="font-size:13px;color:var(--t1);line-height:1.7;white-space:pre-wrap;word-break:break-all">'+esc(l.content||'')+'</div>'+
    (l.note?'<div style="font-size:11px;color:var(--pur);margin-top:6px;padding:5px 8px;border-radius:6px;background:var(--pur2)">📝 '+esc(l.note)+'</div>':'')+
  '</div>').join('');
}
async function renderDB(){try{
  const ls=await da('laws');
  const kw=($el('lsi')?.value||'').toLowerCase().trim();
  // §條號 語法解析：「警職法§6」「§6」
  let kwLaw='',kwArt='',kwText=kw;
  const secM=kw.match(/^(.*)§\s*(\d+)\s*$/);
  if(secM){kwLaw=secM[1].trim().toLowerCase();kwArt=secM[2];kwText='';}
  const lawCat=S.lawCat||'all';
  let fl=ls.filter(l=>{
    if(lawCat!=='all'&&l.category!==lawCat)return false;
    if(!kw)return true;
    if(kwArt){
      const nameMatch=!kwLaw||(l.lawName||'').toLowerCase().includes(kwLaw);
      const artMatch=String(l.articleNumber||'')===kwArt||
                     (l.article||'').replace(/\s/g,'').includes('第'+kwArt+'條');
      return nameMatch&&artMatch;
    }
    const h=((l.lawName||'')+(l.article||'')+(l.title||'')+(l.content||'')+(l.keywords||[]).join(' ')).toLowerCase();
    return h.includes(kwText);
  });
  const byName={};fl.forEach(l=>{const n=l.lawName||'未分類';if(!byName[n])byName[n]=[];byName[n].push(l);});
  const el=$el('llist');if(!el)return;
  if(!fl.length){el.innerHTML='<div class="empty"><div class="ic">📜</div><div style="color:var(--t2)">尚無資料</div></div>';return;}
  const sortBy=S.lawSort||'name';
  const dir=S.lawSortDir||'asc';  // 'asc' = 正向, 'desc' = 反向
  const rev=(n)=>dir==='desc'?-n:n;   // 輔助：反向時取負值
  const toDate=s=>{if(!s)return'';const m=s.match(/民國(\d+)年(\d+)月(\d+)日/);if(m)return String(parseInt(m[1])+1911)+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');return s;};
  const sortedEntries=Object.entries(byName).sort((a,b)=>{
    if(sortBy==='amend'){
      const da_=toDate(a[1][0]?.amendDate)||'0000';
      const db_=toDate(b[1][0]?.amendDate)||'0000';
      // 預設 asc = 新→舊（db_ > da_ 時 b 排前）
      return rev(db_.localeCompare(da_));
    }
    if(sortBy==='count') return rev(b[1].length-a[1].length);
    // name: 預設 asc = A→Z
    return rev(a[0].localeCompare(b[0],'zh-TW'));
  });
  // Infinite scroll
  const PAGE=50;let page=0;
  el.innerHTML='';
  const _mkCard=([name,laws])=>{
    const cat=laws[0].category||'statute';
    const catLabel={statute:'法規條文',sop:'SOP',supplement:'補充資料',interpretation:'函釋'}[cat]||cat;
    const favCount=laws.filter(l=>l.favorite).length;
    const icon=cat==='sop'?'📋':cat==='supplement'?'📄':'⚖';
    const orgLine=(laws[0]?.org||laws[0]?.amendDate)
      ?('<div style="font-size:10px;color:var(--t2);margin-top:1px">'+(laws[0]?.org?'🏛 '+esc(laws[0].org):'')+(laws[0]?.org&&laws[0]?.amendDate?' · ':'')+(laws[0]?.amendDate?'📅 '+esc(laws[0].amendDate):'')+'</div>'):'';
    const div=document.createElement('div');
    div.className='lw-card card';
    div.dataset.lawname=name;
    div.style.marginBottom='6px';
    div.innerHTML=
      '<div style="display:flex;align-items:center;gap:8px">'
        +'<span style="font-size:20px">'+icon+'</span>'
        +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:15px;font-weight:700;color:var(--t0)">'+esc(name)+'</div>'
          +'<div style="font-size:11px;color:var(--t2);margin-top:2px">'+catLabel+' · '+laws.length+' 條'+(favCount?' · ⭐'+favCount:'')+'</div>'
          +orgLine
        +'</div>'
        +'<span style="color:var(--t2);font-size:18px">›</span>'
        +'<button class="lw-del" data-lawname="'+esc(name)+'">🗑</button>'
      +'</div>';
    div.addEventListener('click',function(e){
      if(e.target.classList.contains('lw-del'))return;
      openLawGroup(this.dataset.lawname);
    });
    div.querySelector('.lw-del').addEventListener('click',function(e){
      e.stopPropagation();delLawGroup(this.dataset.lawname);
    });
    return div;
  };
  const loadMore=()=>{
    const batch=sortedEntries.slice(page*PAGE,(page+1)*PAGE);
    if(!batch.length)return;
    batch.forEach(entry=>el.appendChild(_mkCard(entry)));
    page++;
    const total=sortedEntries.length;const shown=Math.min(page*PAGE,total);
    const lc=$el('db-lc');
    if(lc)lc.textContent=shown<total?'顯示 '+shown+' / '+total+' 筆，繼續滑動載入':'共 '+total+' 筆';
  };
  loadMore();
  const pg=$el('page-pg-db');
  if(pg){
    if(pg._dbScroll)pg.removeEventListener('scroll',pg._dbScroll);
    const onScroll=()=>{if(pg.scrollHeight-pg.scrollTop-pg.clientHeight<150)loadMore();};
    pg._dbScroll=onScroll;
    pg.addEventListener('scroll',onScroll,{passive:true});
  }
}catch(e){logError('renderDB',e);}}
const _debouncedRenderDB=debounce(renderDB,220);
function renderLaws(){return renderDB();}

// setLC — 類別篩選 chip
function setLC(el,cat){
  document.querySelectorAll('#lchips .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');S.lawCat=cat;renderDB();
}
// setLawCat — 相容舊呼叫（overlay 等處使用）
function setLawCat(cat,btn){S.lawCat=cat;document.querySelectorAll('[onclick*="setLawCat"]').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');renderDB();}

// openLawGroup / delLawGroup（資料庫卡片點擊）
function openLawGroup(name){showLaw(name);}
async function delLawGroup(name){
  const ls=await da('laws').catch(()=>[]);
  const targets=ls.filter(l=>l.lawName===name);
  if(!confirm('確定刪除「'+name+'」共 '+targets.length+' 條法條？\n無法復原！'))return;
  try{for(const l of targets)await dd('laws',l.id);toast('已刪除「'+name+'」共 '+targets.length+' 條');renderDB();}
  catch(e){logError('delLawGroup',e);}
}

async function showLaw(lawName){try{
  const ls=await da('laws');const articles=ls.filter(l=>l.lawName===lawName).sort((a,b)=>(a.articleNumber||0)-(b.articleNumber||0));
  $el('lv-title').textContent=lawName;$el('lv-sub').textContent='共 '+articles.length+' 條';
  S.curLaw=articles;S.curLawName=lawName;
  renderLvArts(articles);$el('lv').style.display='flex';
}catch(e){logError('showLaw',e);}}

function filterLvArts(){
  if(!S.curLaw)return;const kw=($el('lv-search')?.value||'').toLowerCase().trim();
  const fl=kw?S.curLaw.filter(l=>((l.article||'')+(l.content||'')+(l.title||'')).toLowerCase().includes(kw)):S.curLaw;
  renderLvArts(fl);
}

function renderLvArts(articles){
  const el=$el('lv-body');if(!el)return;
  el.innerHTML=articles.map(l=>'<div class="lv-article">'+
    '<div class="lv-art-num">'+esc(l.article||'第?條')+'</div>'+
    (l.title?'<div class="lv-art-title">'+esc(l.title)+'</div>':'')+
    '<div class="lv-art-content">'+esc(l.content||'')+'</div>'+
    (l.note?'<div class="lv-art-note">📝 '+esc(l.note)+'</div>':'')+
  '</div>').join('');
}

function exitLaw(){$el('lv').style.display='none';}

async function showLawPop(ref){try{
  if(!ref){closeLawPop();return;}
  const ls=await da('laws');
  const parts=ref.match(/^(.+?)§(\d+)$/);
  let match;
  if(parts)match=ls.find(l=>l.lawName&&l.lawName.includes(parts[1].trim())&&String(l.articleNumber)===parts[2]);
  else match=ls.find(l=>l.lawName===ref||(l.article||'').includes(ref));
  $el('lawpop-title').textContent=ref;
  $el('lawpop-body').textContent=match?(match.content||'（無內容）'):'找不到對應法條：'+ref;
  $el('lawpop-ov').style.display='flex';
}catch(e){}}
function closeLawPop(){$el('lawpop-ov').style.display='none';}
async function openBulkDelLaw(){try{
  const laws=await da('laws');
  if(!laws.length){toast('目前無法條');return;}
  const names=[...new Set(laws.map(l=>l.lawName||'').filter(Boolean))].sort();
  const modal=document.createElement('div');
  modal.id='bulk-del-law-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.7);display:flex;align-items:flex-end;backdrop-filter:blur(3px)';
  modal.innerHTML='<div style="width:100%;max-width:520px;margin:0 auto;background:var(--bg1);border-radius:20px 20px 0 0;padding:20px 16px 32px;max-height:85vh;overflow-y:auto;border-top:1px solid var(--bd2)"><div style="width:36px;height:4px;background:var(--bg4);border-radius:2px;margin:0 auto 16px"></div><div style="font-size:15px;font-weight:700;color:var(--t0);margin-bottom:6px">🗑 法條大量刪除</div><div style="font-size:12px;color:var(--t2);margin-bottom:12px;line-height:1.6">依法律名稱刪除，或指定條號。<b style="color:var(--red)">刪除後無法復原。</b></div><div style="display:flex;flex-direction:column;gap:10px"><div><label style="font-size:12px;font-weight:600;color:var(--t2);display:block;margin-bottom:4px">法律名稱</label><input id="bdl-name" list="bdl-nl" placeholder="例：警察職權行使法（留空不限）" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px"><datalist id="bdl-nl">'+names.map(n=>'<option value="'+esc(n)+'">').join('')+'</datalist></div><div><label style="font-size:12px;font-weight:600;color:var(--t2);display:block;margin-bottom:4px">指定條號（逗號分隔，留空刪除該法全部條文）</label><input id="bdl-arts" placeholder="例：1,2,10" style="width:100%;padding:9px 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd);color:var(--t0);font-size:14px"></div></div><div id="bdl-preview" style="margin-top:12px;font-size:12px;color:var(--t2)"></div><div style="display:flex;gap:8px;margin-top:16px"><button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t1);font-size:13px;font-weight:600;cursor:pointer" onclick="document.getElementById(\'bulk-del-law-modal\').remove()">取消</button><button style="flex:1;padding:12px;border-radius:10px;background:var(--bg3);border:1px solid var(--bd);color:var(--t2);font-size:13px;font-weight:600;cursor:pointer" onclick="previewBulkDelLaw()">預覽</button><button style="flex:1;padding:12px;border-radius:10px;background:var(--red);color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:none" onclick="confirmBulkDelLaw()">確認刪除</button></div></div>';
  document.body.appendChild(modal);
}catch(e){logError('openBulkDelLaw',e);}}

async function previewBulkDelLaw(){try{
  const targets=_filterBulkDelLaw(await da('laws'));
  const el=document.getElementById('bdl-preview');
  if(el)el.innerHTML='<span style="color:var(--org)">符合條件：<b>'+targets.length+'</b> 條將被刪除</span>';
}catch(e){logError('previewBulkDelLaw',e);}}

async function confirmBulkDelLaw(){try{
  const targets=_filterBulkDelLaw(await da('laws'));
  if(!targets.length){toast('無符合條件的法條');return;}
  if(!confirm('確定刪除 '+targets.length+' 條法條？\n此操作無法復原！'))return;
  for(const l of targets)await dd('laws',l.id);
  const m=document.getElementById('bulk-del-law-modal');if(m)m.remove();
  toast('已刪除 '+targets.length+' 條 ✓');renderDB();
}catch(e){logError('confirmBulkDelLaw',e);}}

function _filterBulkDelLaw(laws){
  const name=(document.getElementById('bdl-name')||{}).value?.trim()||'';
  const arts=(document.getElementById('bdl-arts')||{}).value?.trim()||'';
  const artSet=arts?new Set(arts.split(/[,，、\s]+/).map(n=>n.trim()).filter(Boolean)):null;
  return laws.filter(l=>{
    if(name&&(l.lawName||'')!==name)return false;
    if(artSet&&!artSet.has(String(l.articleNumber||'')))return false;
    return true;
  });
}

function showAddLaw(){openLawSheet(null);}
function openLawSheet(law){
  const isEdit=!!law;
  $el('law-sh-t').textContent=isEdit?'編輯法條':'新增法條';
  $el('l-name').value=law?law.lawName||'':'';
  $el('l-art').value=law?law.article||'':'';
  $el('l-chapter').value=law?law.chapter||'':'';
  $el('l-title-field').value=law?law.articleTitle||'':'';
  $el('l-cat').value=law?law.category||'statute':'statute';
  $el('l-content').value=law?law.content||'':'';
  $el('l-kw').value=law?((law.keywords||[]).join(',')):'';
  $el('l-related').value=law?law.relatedLaws||'':'';
  $el('l-src').value=law?law.source||'':'';
  $el('l-note').value=law?law.note||'':'';
  window._editLawId=law?law.id:null;
  $el('law-ov').style.display='flex';
}
function closeLawSh(){$el('law-ov').style.display='none';window._editLawId=null;}
async function saveLaw(){
  const name=($el('l-name').value||'').trim();
  const content=($el('l-content').value||'').trim();
  if(!name){Toast.warn('請填寫法律名稱');return;}
  if(!content){Toast.warn('請填寫法條內容');return;}
  const catMap={statute:'法規條文',sop:'SOP',supplement:'補充資料',interpretation:'函釋'};
  const art=($el('l-art').value||'').trim();
  const artNum=art?art2n(art):0;
  const obj={
    lawName:name,article:art,articleNumber:artNum,
    chapter:($el('l-chapter').value||'').trim(),
    articleTitle:($el('l-title-field').value||'').trim(),
    category:$el('l-cat').value||'statute',
    content:content,
    keywords:kwArr($el('l-kw').value||''),
    relatedLaws:($el('l-related').value||'').trim(),
    source:($el('l-src').value||'').trim(),
    note:($el('l-note').value||'').trim(),
    updatedAt:Date.now()
  };
  if(window._editLawId){obj.id=window._editLawId;}
  else{obj.createdAt=Date.now();}
  try{
    await dp('laws',obj);
    Toast.success((window._editLawId?'已更新':'已新增')+' · '+name+' '+art);
    closeLawSh();renderDB();
  }catch(e){Toast.error('儲存失敗：'+e.message);}
}

/* ── 批次匯入法條 ── */
function showBulkLaw(){$el('bl-name').value='';$el('bl-src').value='';$el('bl-text').value='';$el('bl-cat').value='statute';$el('bl-prev').textContent='';$el('blaw-ov').style.display='flex';}
function closeBulkLaw(){$el('blaw-ov').style.display='none';}
function prevBulkLaw(){
  const text=$el('bl-text').value||'';
  const parsed=parseLawText(text,$el('bl-name').value||'法規');
  $el('bl-prev').textContent='解析：共 '+parsed.length+' 條';
}
async function importBulkLaw(){
  const name=($el('bl-name').value||'').trim();
  if(!name){Toast.warn('請填寫法律名稱');return;}
  const text=$el('bl-text').value||'';
  if(!text.trim()){Toast.warn('請貼入法條文字');return;}
  const items=parseLawText(text,name,$el('bl-cat').value||'statute',$el('bl-src').value||'');
  if(!items.length){Toast.warn('解析結果為0條，請確認格式');return;}
  try{
    await bulkPut('laws',items);
    Toast.success('已批次匯入 '+items.length+' 條法條 ✓');
    closeBulkLaw();renderDB();
  }catch(e){Toast.error('匯入失敗：'+e.message);}
}
function parseLawText(text,lawName,category,source){
  category=category||'statute';source=source||'';
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  const arts=[];let cur=null;
  const artRe=/^第\s*([一二三四五六七八九十百千\d]+)\s*條\s*(.*)$/;
  for(const line of lines){
    const m=line.match(artRe);
    if(m){
      if(cur)arts.push(cur);
      const artStr='第'+m[1]+'條';
      const rest=(m[2]||'').trim();
      cur={lawName,article:artStr,articleNumber:art2n(artStr),chapter:'',articleTitle:'',
        category,content:rest,keywords:[],relatedLaws:'',source,note:'',createdAt:Date.now(),updatedAt:Date.now()};
    }else if(cur){
      cur.content+=(cur.content?'\n':'')+line;
    }
  }
  if(cur)arts.push(cur);
  return arts;
}

/* ── 大量貼題（題目庫） ── */
function openBulkImportQ(){
  $el('bi-text').value='';
  $el('bi-ans').value='';
  ['bi-sub','bi-yr','bi-ex','bi-part','bi-chapter','bi-section'].forEach(id=>{const el=$el(id);if(el)el.value='';});
  const r=$el('bulk-result');if(r)r.classList.add('hide');
  S.bulkParsed=[];
  $el('bulk-q-ov').style.display='flex';
}
function closeBulkImportQ(){$el('bulk-q-ov').style.display='none';}

/* ── 新增/編輯題目 sheet ── */
function showAddQ(q){
  const isEdit=!!q;
  $el('add-q-title').textContent=isEdit?'編輯題目':'新增題目';
  $el('fq-sub').value=q?q.subject||'':'';
  $el('fq-yr').value=q?q.year||'':'';
  $el('fq-ex').value=q?q.exam||'':'';
  $el('fq-num').value=q?q.num||'':'';
  $el('fq-stem').value=q?q.stem||'':'';
  $el('fq-kw').value=q?((q.keywords||[]).join(',')):'';
  $el('fq-note').value=q?q.note||'':'';
  $el('fq-laws').value=q?q.relatedLaws||'':'';
  $el('fq-must-kw').value=q?((q.mustKeywords||[]).join(',')):'';
  $el('fq-is-number').checked=q?!!q.isNumberQ:false;
  const isMC=!q||q.type==='mc';
  setAddQType(isMC?'mc':'es');
  if(q&&q.type==='mc'&&q.options){
    ['A','B','C','D','E'].forEach(k=>{const el=$el('fq-opt'+k);if(el)el.value=q.options[k]||'';});
    window._addQCorrect=q.answer||'A';
    updateOptMarks();
  }else if(q&&q.type==='es'){
    $el('fq-es').value=q.answerEs||q.answer||'';
  }
  window._editQId=q?q.id:null;
  $el('add-q-ov').style.display='flex';
}
function closeAddQ(){$el('add-q-ov').style.display='none';window._editQId=null;window._addQCorrect='A';}
function setAddQType(t){
  window._addQType=t;
  const isMC=t==='mc';
  $el('fq-mc-btn').style.background=isMC?'var(--sky)':'var(--bg3)';
  $el('fq-mc-btn').style.color=isMC?'#0a0c10':'var(--t2)';
  $el('fq-es-btn').style.background=!isMC?'var(--org)':'var(--bg3)';
  $el('fq-es-btn').style.color=!isMC?'#0a0c10':'var(--t2)';
  $el('fq-opts-wrap').style.display=isMC?'block':'none';
  $el('fq-es-wrap').style.display=!isMC?'block':'none';
  $el('fq-must-kw-wrap').style.display=!isMC?'block':'none';
}
function toggleOptCorrect(k){
  if(!window._addQCorrect)window._addQCorrect='';
  if(window._addQCorrect.includes(k))window._addQCorrect=window._addQCorrect.replace(k,'');
  else window._addQCorrect+=k;
  updateOptMarks();
}
function updateOptMarks(){
  ['A','B','C','D','E'].forEach(k=>{
    const btn=$el('fq-opt-btn-'+k);
    if(!btn)return;
    const on=(window._addQCorrect||'').includes(k);
    btn.style.background=on?'var(--grn)':'var(--bg3)';
    btn.style.borderColor=on?'var(--grn)':'var(--bd)';
    btn.style.color=on?'#0a0c10':'var(--t2)';
  });
}
async function saveAddQ(){
  const stem=($el('fq-stem').value||'').trim();
  if(!stem){Toast.warn('請填寫題目內容');return;}
  const type=window._addQType||'mc';
  const opts={};
  if(type==='mc'){
    ['A','B','C','D','E'].forEach(k=>{const v=($el('fq-opt'+k)||{}).value||'';if(v.trim())opts[k]=v.trim();});
  }
  const obj={
    type,stem,
    options:opts,
    answer:(window._addQCorrect||'').toUpperCase(),
    answerEs:type==='es'?($el('fq-es').value||'').trim():'',
    subject:($el('fq-sub').value||'').trim(),
    year:($el('fq-yr').value||'').trim(),
    exam:($el('fq-ex').value||'').trim(),
    num:($el('fq-num').value||'').trim(),
    keywords:kwArr($el('fq-kw').value||''),
    mustKeywords:kwArr($el('fq-must-kw').value||''),
    relatedLaws:($el('fq-laws').value||'').trim(),
    note:($el('fq-note').value||'').trim(),
    isNumberQ:!!$el('fq-is-number').checked,
    starred:false,reviewLevel:0,nextReview:Date.now(),
    wrongCount:0,correctStreak:0,difficultyScore:5,
    updatedAt:Date.now()
  };
  if(window._editQId){obj.id=window._editQId;}
  else{obj.createdAt=Date.now();}
  try{
    await dp('questions',obj);
    Toast.success((window._editQId?'已更新':'已新增')+'題目 ✓');
    closeAddQ();renderList();renderHome();
  }catch(e){Toast.error('儲存失敗：'+e.message);}
}

/* ── 排序選單 ── */
function openLawSortMenu(){
  // 移除舊的（若重複開啟）
  const old=document.getElementById('sort-scrim');if(old)old.remove();
  const curSort=S.lawSort||'name';
  const curDir=S.lawSortDir||'asc';  // 'asc' or 'desc'
  // 每個 key 對應：[升序標籤, 降序標籤]
  const OPTS=[
    ['name',  '名稱 A → Z',   '名稱 Z → A'],
    ['count', '條數 多 → 少', '條數 少 → 多'],
    ['amend', '日期 新 → 舊', '日期 舊 → 新'],
  ];
  const items=OPTS.map(([v,ascL,descL])=>{
    const isActive=curSort===v;
    const label=isActive?(curDir==='desc'?descL:ascL):ascL;
    const arrow=isActive?(curDir==='desc'?'↑':'↓'):'';
    return '<div class="sort-row'+(isActive?' sort-row-on':'')+'" onclick="setLawSort(\''+v+'\');document.getElementById(\'sort-scrim\').remove()">'+
      '<span class="sort-row-label">'+label+'</span>'+
      '<span class="sort-row-check">'+
        (isActive
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="var(--sky)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '')+
      '</span>'+
    '</div>';
  }).join('');
  const html=
    '<div id="sort-scrim" style="position:fixed;inset:0;z-index:850;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center" onclick="if(event.target===this)this.remove()">'+
      '<div style="width:100%;max-width:520px;background:var(--bg1);border-radius:22px 22px 0 0;border-top:1px solid var(--bd2);padding:0 0 calc(16px + env(safe-area-inset-bottom,0px))" onclick="event.stopPropagation()">'+
        '<div style="width:36px;height:4px;background:var(--bg4);border-radius:2px;margin:12px auto 0"></div>'+
        '<div style="padding:16px 20px 8px;font-size:13px;font-weight:700;color:var(--t2);letter-spacing:.08em;text-transform:uppercase">排序方式 <span style="font-size:11px;font-weight:400;color:var(--t3)">（再次點選同項反向）</span></div>'+
        items+
      '</div>'+
    '</div>';
  const d=document.createElement('div');d.innerHTML=html;document.body.appendChild(d.firstChild);
}

function setLawSort(sort){
  if(S.lawSort===sort){
    // 同一排序項：切換升降序
    S.lawSortDir=(S.lawSortDir==='desc'?'asc':'desc');
  }else{
    S.lawSort=sort;
    _lawSortBy=sort;
    S.lawSortDir='asc';  // 切換新排序項：重置為升序
  }
  // Toast 顯示目前狀態
  const LABELS={name:'名稱',count:'條數',amend:'日期'};
  const dirLabel=S.lawSortDir==='desc'?'↑ 反向':'↓ 正向';
  Toast.info((LABELS[sort]||sort)+' '+dirLabel);
  renderDB();
}
/* ══ STATS ══ */
let _dchart=null;
let _aiMd='',_aiJson='',_exportText='',_exportJsonData=null;
let _exportLimit=10,_aiModel='claude-sonnet-4-20250514';

function switchStatTab(tab,btn){
  document.querySelectorAll('[id^="stab-"]').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  ['overview','export','ai'].forEach(t=>{
    const el=document.getElementById('stat-'+t+'-panel');
    if(el)el.style.display=t===tab?'':'none';
  });
}
function setExportLimit(n,btn){
  _exportLimit=n;
  document.querySelectorAll('[id^="elim-"]').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
}
function setAIModel(m,btn){
  _aiModel=m;
  document.querySelectorAll('[id^="aimodel-"]').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
}

async function renderStats(){try{
  const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const total=qs.length,totalAts=ats.length,correct=ats.filter(a=>a.correct).length;
  const rate=totalAts?Math.round(correct/totalAts*100):0;
  setText2('st-q',total);setText2('st-a',totalAts);setText2('st-r',totalAts?rate+'%':'—');
  const subMap={};
  qs.forEach(q=>{const s=q.subject||'未分類';if(!subMap[s])subMap[s]={total:0,correct:0};subMap[s].total++;});
  ats.forEach(a=>{const q=qs.find(q=>q.id===a.qid);if(!q)return;const s=q.subject||'未分類';if(!subMap[s])return;if(a.correct!==null&&a.correct)subMap[s].correct++;});
  const bars=document.getElementById('subj-bars');
  if(bars)bars.innerHTML=Object.entries(subMap).sort((a,b)=>{const ra=a[1].total?a[1].correct/a[1].total:1;const rb=b[1].total?b[1].correct/b[1].total:1;return ra-rb;}).map(([s,d])=>{const r=d.total?Math.round(d.correct/d.total*100):0;const color=r>=80?'var(--grn)':r>=60?'var(--org)':'var(--red)';return'<div class="sr"><div class="sn" title="'+s.replace(/"/g,"&quot;")+'">'+s+'</div><div class="sbw"><div class="sbar" style="width:'+r+'%;background:'+color+'"></div></div><div class="sp">'+r+'%</div></div>';}).join('');
  const days=7;const labels=[],data=[];
  for(let i=days-1;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const ds=d.toISOString().slice(0,10);labels.push(ds.slice(5));data.push(ats.filter(a=>a.date===ds).length);}
  const ctx=document.getElementById('dchart');if(_dchart)_dchart.destroy();
  _dchart=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data,backgroundColor:'rgba(232,201,107,.25)',borderColor:'var(--gold)',borderWidth:1,borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{color:'#7a869e',font:{size:11}},grid:{color:'rgba(255,255,255,.05)'}},x:{ticks:{color:'#7a869e',font:{size:11}},grid:{display:false}}}}});
  const wrongEl=document.getElementById('wrong-subs');const dangerMap={'🔴':0,'🟠':0,'🟡':0,'🟢':0};
  qs.forEach(q=>{const lv=getDangerLevel(q,ats);dangerMap[lv]++;});
  if(wrongEl)wrongEl.innerHTML=Object.entries(dangerMap).map(([lv,cnt])=>'<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:16px;width:24px">'+lv+'</span><div style="flex:1;background:var(--bg3);border-radius:3px;height:7px;overflow:hidden"><div style="height:7px;border-radius:3px;background:var(--gold);width:'+(qs.length?cnt/qs.length*100:0)+'%"></div></div><span style="font-size:12px;color:var(--t2);font-weight:600;width:42px;text-align:right">'+cnt+' 題</span></div>').join('');
  const kwMap={};ats.filter(a=>!a.correct).forEach(a=>{const q=qs.find(q=>q.id===a.qid);if(!q)return;(q.keywords||[]).forEach(kw=>{kwMap[kw]=(kwMap[kw]||0)+1;});});
  const kwCloud=document.getElementById('kw-cloud');
  if(kwCloud)kwCloud.innerHTML=Object.entries(kwMap).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([kw,cnt])=>'<span class="tag" style="font-size:'+Math.min(14,10+cnt)+'px;cursor:default">'+kw+' <b style="color:var(--red)">'+cnt+'</b></span>').join('');
}catch(e){logError('renderStats',e);}}

async function buildExportText(){try{
  const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const incWrong=document.getElementById('eo-wrong')?.checked;
  const incWeak=document.getElementById('eo-weak')?.checked;
  const incKw=document.getElementById('eo-kw')?.checked;
  const incStem=document.getElementById('eo-stem')?.checked;
  const limit=_exportLimit||10;
  const lines=[];
  const now=new Date().toLocaleString('zh-TW');
  lines.push('# KnowledgeForce 學習弱點報告');
  lines.push('產生時間：'+now+'  |  總題數：'+qs.length+'  |  總作答：'+ats.length);
  lines.push('');
  if(incWrong){
    const dangerQs=qs.filter(q=>getDangerLevel(q,ats)==='🔴');
    const show=limit>0?dangerQs.slice(0,limit):dangerQs;
    lines.push('## 🔴 高危險錯題（連錯 2 次以上）');
    if(!show.length)lines.push('（暫無）');
    else show.forEach((q,i)=>{
      lines.push((i+1)+'. ['+(q.subject||'')+(q.year?' '+q.year:'')+'] 第'+(q.num||'?')+'題');
      if(incStem&&q.stem)lines.push('   題目：'+(q.stem||'').slice(0,80)+(q.stem.length>80?'…':''));
      if(q.answer)lines.push('   答案：'+q.answer);
    });
    lines.push('');
  }
  if(incWeak){
    const subErr={};
    ats.filter(a=>!a.correct).forEach(a=>{const q=qs.find(q=>q.id===a.qid);if(!q)return;const s=q.subject||'未分類';subErr[s]=(subErr[s]||0)+1;});
    lines.push('## 📉 最弱科目排行');
    Object.entries(subErr).sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([s,n],i)=>{lines.push((i+1)+'. '+s+'：錯誤 '+n+' 次');});
    lines.push('');
  }
  if(incKw){
    const kwMap={};
    ats.filter(a=>!a.correct).forEach(a=>{const q=qs.find(q=>q.id===a.qid);if(!q)return;(q.keywords||[]).forEach(kw=>{kwMap[kw]=(kwMap[kw]||0)+1;});});
    const topKws=Object.entries(kwMap).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([kw,n])=>kw+'('+n+')');
    lines.push('## 🔑 高頻錯誤關鍵字');
    lines.push(topKws.join('、')||'（暫無）');
    lines.push('');
  }
  lines.push('---');
  lines.push('請協助分析以上弱點，並：');
  lines.push('1. 指出最需優先加強的主題');
  lines.push('2. 針對高危錯題說明正確觀念');
  lines.push('3. 提供具體複習建議');
  _exportText=lines.join('\n');
  _exportJsonData={generatedAt:now,questions:qs,attempts:ats};
  const ta=document.getElementById('export-textarea');if(ta)ta.value=_exportText;
  const cc=document.getElementById('export-char-count');if(cc)cc.textContent=_exportText.length;
  const res=document.getElementById('export-result');if(res)res.style.display='';
  Toast.success('已產生 '+_exportText.length+' 字摘要 ✓');
}catch(e){logError('buildExportText',e);Toast.error('產生失敗');}}

function updateExportPreview(){}

async function copyExportText(){try{
  const ta=document.getElementById('export-textarea');
  const text=ta?ta.value:_exportText;
  await navigator.clipboard.writeText(text);
  Toast.success('已複製 '+text.length+' 字 ✓');
}catch(e){Toast.warn('請手動選取複製');}}

function dlExportText(){
  if(!_exportText){Toast.warn('請先產生摘要');return;}
  dl(_exportText,'弱點報告_'+today()+'.txt','text/plain');
}
function dlExportJson(){
  if(!_exportJsonData){Toast.warn('請先產生摘要');return;}
  dl(JSON.stringify(_exportJsonData,null,2),'弱點報告_'+today()+'.json','application/json');
}

async function buildAI(){try{
  const key=Store.get('apiKey');
  const btn=document.getElementById('ai-call-btn');
  const icon=document.getElementById('ai-call-icon');
  const lbl=document.getElementById('ai-call-label');
  if(!key){Toast.info('未設定 API Key，改為本地產生報告');await _buildAILocal();return;}
  if(btn)btn.disabled=true;
  if(icon)icon.textContent='⏳';
  if(lbl)lbl.textContent='分析中…';
  const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const subErr={};
  ats.filter(a=>!a.correct).forEach(a=>{const q=qs.find(q=>q.id===a.qid);if(!q)return;const s=q.subject||'未分類';subErr[s]=(subErr[s]||0)+1;});
  const dangerQs=qs.filter(q=>getDangerLevel(q,ats)==='🔴').slice(0,10);
  const kwMap={};
  ats.filter(a=>!a.correct).forEach(a=>{const q=qs.find(q=>q.id===a.qid);if(!q)return;(q.keywords||[]).forEach(kw=>{kwMap[kw]=(kwMap[kw]||0)+1;});});
  const prompt='你是警察特考輔導專家，以下是考生學習弱點資料，請給出具體實用建議（繁體中文）。\n\n'
    +'總題數：'+qs.length+'  作答：'+ats.length+'  正確率：'+(ats.length?Math.round(ats.filter(a=>a.correct).length/ats.length*100):0)+'%\n\n'
    +'最弱科目：\n'+Object.entries(subErr).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,n])=>'- '+s+'：錯'+n+'次').join('\n')+'\n\n'
    +'高危錯題：\n'+dangerQs.map(q=>'- ['+q.subject+'] '+(q.stem||'').slice(0,50)).join('\n')+'\n\n'
    +'高頻錯誤關鍵字：'+Object.entries(kwMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,n])=>k+'('+n+')').join('、')+'\n\n'
    +'請提供：1.優先加強主題 2.正確法律觀念 3.複習策略 4.容易混淆考點';
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:_aiModel,max_tokens:1200,messages:[{role:'user',content:prompt}]})
    });
    const data=await resp.json();
    if(!resp.ok)throw new Error(data.error?.message||'API 錯誤 '+resp.status);
    const text=data.content?.map(c=>c.text||'').join('')||'（無回應）';
    _aiMd=text;
    const mdEl=document.getElementById('ai-md');if(mdEl)mdEl.textContent=text;
    const aiOut=document.getElementById('ai-out');if(aiOut)aiOut.classList.remove('hide');
    Toast.success('AI 分析完成 ✓');
  }catch(apiErr){
    logError('buildAI-API',apiErr);
    Toast.warn('API 呼叫失敗（'+apiErr.message+'），改為本地產生');
    await _buildAILocal();
  }
}catch(e){logError('buildAI',e);Toast.error('分析失敗');}
finally{
  const btn=document.getElementById('ai-call-btn');if(btn)btn.disabled=false;
  const icon=document.getElementById('ai-call-icon');if(icon)icon.textContent='✨';
  const lbl=document.getElementById('ai-call-label');if(lbl)lbl.textContent='呼叫 AI 分析';
}}

async function _buildAILocal(){
  const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);
  const subErr={};ats.filter(a=>!a.correct).forEach(a=>{const q=qs.find(q=>q.id===a.qid);if(!q)return;const s=q.subject||'未分類';subErr[s]=(subErr[s]||0)+1;});
  const dangerQs=qs.filter(q=>getDangerLevel(q,ats)==='🔴').slice(0,10);
  const lines=['# 警察特考弱點分析報告（本地）',
    '> 產生時間：'+new Date().toLocaleString('zh-TW')+' | 總題數：'+qs.length+' | 總作答：'+ats.length,'',
    '## 🔴 高危險錯題',
    ...dangerQs.map(q=>'- Q'+(q.num||'?')+' ['+q.subject+'] '+(q.stem||'').slice(0,40)+'…'),'',
    '## 📊 最弱科目',
    ...Object.entries(subErr).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,n])=>'- '+s+'：錯誤 '+n+' 次'),'',
    '> 提示：在設定頁儲存 AI API Key 後，可取得更深入的 AI 分析。'];
  _aiMd=lines.join('\n');
  const mdEl=document.getElementById('ai-md');if(mdEl)mdEl.textContent=_aiMd;
  const aiOut=document.getElementById('ai-out');if(aiOut)aiOut.classList.remove('hide');
  Toast.success('本地報告已產生 ✓');
}

async function copyAI(){try{await navigator.clipboard.writeText(_aiMd);Toast.success('已複製 ✓');}catch(e){Toast.warn('請手動選取複製');}}
function dlAI(type){
  if(!_aiMd){Toast.warn('請先執行分析');return;}
  if(type==='md')dl(_aiMd,'弱點分析_'+today()+'.md','text/markdown');
  else dl(JSON.stringify({generatedAt:new Date().toISOString(),report:_aiMd},null,2),'弱點分析_'+today()+'.json','application/json');
}
/* ══ SETTINGS FUNCTIONS ══ */
async function expJSON(){try{
  const[qs,ats,ls]=await Promise.all([da('questions'),da('attempts'),da('laws')]);
  dl(JSON.stringify({version:2,exportedAt:new Date().toISOString(),questions:qs,laws:ls,attempts:ats},null,2),'警察考題庫_'+today()+'.json','application/json');
  Toast.success('已匯出 JSON');
}catch(e){logError('expJSON',e);}}

async function impJSON(e){
  const file=e.target.files[0];if(!file)return;
  try{
    let data;try{data=JSON.parse(await file.text());}catch(pe){Toast.error('JSON 格式錯誤');return;}
    const qs=Array.isArray(data)?data:Array.isArray(data.questions)?data.questions:null;
    if(!qs){Toast.error('找不到 questions 欄位');return;}
    const qItems=qs.map(({id,...r})=>r);
    const lawItems=Array.isArray(data.laws)?data.laws.map(({id,...r})=>r):[];
    const attItems=Array.isArray(data.attempts)?data.attempts.map(({id,...r})=>r):[];
    await bulkPut('questions',qItems);
    if(lawItems.length)await bulkPut('laws',lawItems);
    if(attItems.length)await bulkPut('attempts',attItems);
    Toast.success('已匯入 '+qItems.length+' 題'+(lawItems.length?' · '+lawItems.length+' 條法條':'')+'✓');
    e.target.value='';renderHome();SettingsPage.init();
  }catch(err){logError('impJSON',err);Toast.error('匯入失敗：'+(err?.message||String(err)));}}

async function expWrong(){try{
  const[qs,ats]=await Promise.all([da('questions'),da('attempts')]);const wids=getWrong(qs,ats);const wqs=qs.filter(q=>wids.has(q.id));
  if(!wqs.length){Toast.info('目前沒有錯題');return;}
  const grp={};wqs.forEach(q=>{const s=q.subject||'未分類';if(!grp[s])grp[s]=[];grp[s].push(q);});
  let out='<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>錯題整理</title><style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;line-height:1.8}h1{border-bottom:2px solid #333;padding-bottom:7px}h2{color:#1f6feb}.q{margin:14px 0;padding:14px;border:1px solid #ddd;border-radius:8px}.ans{color:#1f6feb;font-weight:600}</style></head><body><h1>錯題整理</h1>';
  Object.entries(grp).forEach(([sub,sqs])=>{out+='<h2>'+sub+'</h2>';sqs.forEach((q,i)=>{out+='<div class="q"><div style="font-size:14px;font-weight:600;margin-bottom:8px">'+(i+1)+'. '+esc(q.stem||'')+'</div>';if(q.type==='mc')Object.entries(q.options||{}).forEach(([k,v])=>{out+='<div>('+k+') '+esc(v)+'</div>';});if(q.answer)out+='<div class="ans">答案：'+esc(q.answer)+'</div>';out+='</div>';});});
  out+='</body></html>';
  dl(out,'警察考題_錯題_'+today()+'.html','text/html');Toast.success('匯出 '+wqs.length+' 題');
}catch(e){logError('expWrong',e);}}

async function clearAts(){try{await dc('attempts');Toast.success('作答記錄已清除');SettingsPage.init();}catch(e){logError('clearAts',e);}}
async function delAll(){try{await dc('questions');await dc('attempts');await dc('laws');Toast.success('已全部刪除');SettingsPage.init();renderHome();}catch(e){logError('delAll',e);}}
/* ══ GOOGLE DRIVE SYNC ══
   流程：
   1. 使用者填入 OAuth Client ID → 存 localStorage
   2. gdSignIn() → Google Identity Services 授權 → 取得 access_token
   3. gdBackup() → 讀 IndexedDB → JSON → 上傳/覆蓋 Drive 檔案
   4. gdRestore() → 從 Drive 下載 JSON → 寫入 IndexedDB
   注意：token 有效期 1 小時，重整頁面後需重新登入（標準 OAuth implicit 流程）
══ */
const GD = (function(){
  const BACKUP_FILENAME = 'KnowledgeForce_backup.json';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  let _token = null;
  let _tokenClient = null;
  let _userInfo = null;

  /* ── 讀取 client id ── */
  function _getClientId(){
    const el = $el('gd-client-id');
    const saved = localStorage.getItem('gdClientId');
    if(el && el.value.trim()) return el.value.trim();
    return saved || '';
  }
  function _saveClientId(id){ localStorage.setItem('gdClientId', id); }

  /* ── UI state helpers ── */
  function _setStatus(text, cls){
    const pill = $el('gd-status-pill');
    if(!pill) return;
    pill.textContent = text;
    pill.className = 'gd-status ' + (cls || 'gd-idle');
  }
  function _setLoading(btnId, loading){
    const btn = $el(btnId);
    if(!btn) return;
    btn.disabled = loading;
  }
  function _showAuth(authed){
    const ua = $el('gd-unauth'), aa = $el('gd-auth');
    if(ua) ua.style.display = authed ? 'none' : '';
    if(aa) aa.style.display = authed ? '' : 'none';
  }
  function _setLastSync(text){
    const el = $el('gd-last-sync');
    if(el) el.textContent = text;
  }

  /* ── 初始化（每次進設定頁呼叫） ── */
  function init(){
    const savedId = localStorage.getItem('gdClientId');
    const clientIdEl = $el('gd-client-id');
    if(savedId && clientIdEl) clientIdEl.value = savedId;
    const lastSync = localStorage.getItem('gdLastSync');
    if(lastSync) _setLastSync('上次同步：' + lastSync);
    if(_token){
      _showAuth(true);
      _setStatus('已連線', 'gd-ok');
    } else {
      _showAuth(false);
      _setStatus('未連線', 'gd-idle');
    }
  }

  /* ── 登入 ── */
  async function signIn(){
    const clientId = _getClientId();
    if(!clientId || !clientId.includes('.apps.googleusercontent.com')){
      Toast.warn('請先填入正確的 Client ID');
      return;
    }
    _saveClientId(clientId);
    /* 確認 GSI 已載入 */
    if(typeof google === 'undefined' || !google.accounts){
      Toast.error('Google Identity 函式庫尚未載入，請稍候再試');
      return;
    }
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: async (resp) => {
        if(resp.error){ Toast.error('授權失敗：' + resp.error); return; }
        _token = resp.access_token;
        /* 取得使用者資訊 */
        try{
          const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: 'Bearer ' + _token }
          });
          _userInfo = await r.json();
          const nameEl = $el('gd-user-name');
          const emailEl = $el('gd-user-email');
          const avatarEl = $el('gd-user-avatar');
          if(nameEl) nameEl.textContent = _userInfo.name || '使用者';
          if(emailEl) emailEl.textContent = _userInfo.email || '';
          if(avatarEl){
            if(_userInfo.picture) avatarEl.innerHTML = '<img src="'+_userInfo.picture+'" style="width:32px;height:32px;border-radius:50%;object-fit:cover">';
            else avatarEl.textContent = (_userInfo.name||'U')[0];
          }
        }catch(e){ /* 不影響主流程 */ }
        _showAuth(true);
        _setStatus('已連線 ✓', 'gd-ok');
        Toast.success('Google 帳號授權成功 ✓');
      }
    });
    _tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  /* ── 登出 ── */
  function signOut(){
    if(_token && typeof google !== 'undefined'){
      try{ google.accounts.oauth2.revoke(_token, ()=>{}); }catch(e){}
    }
    _token = null; _userInfo = null;
    _showAuth(false);
    _setStatus('未連線', 'gd-idle');
    Toast.info('已登出 Google');
  }

  /* ── 找到已存在的備份檔 ID ── */
  async function _findFileId(){
    const r = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=name%3D%22'+encodeURIComponent(BACKUP_FILENAME)+'%22+and+trashed%3Dfalse&fields=files(id,name,modifiedTime)',
      { headers: { Authorization: 'Bearer ' + _token } }
    );
    const data = await r.json();
    return (data.files && data.files.length) ? data.files[0] : null;
  }

  /* ── 備份 ── */
  async function backup(){
    if(!_token){ Toast.warn('請先登入 Google'); return; }
    _setLoading('gd-btn-backup', true);
    _setStatus('備份中…', 'gd-warn');
    try{
      const [qs, ats, ls] = await Promise.all([da('questions'), da('attempts'), da('laws')]);
      const payload = JSON.stringify({
        version: 2, exportedAt: new Date().toISOString(),
        questions: qs, laws: ls, attempts: ats
      }, null, 2);
      const existing = await _findFileId();
      let url, method;
      const meta = { name: BACKUP_FILENAME, mimeType: 'application/json' };
      if(existing){
        url = 'https://www.googleapis.com/upload/drive/v3/files/'+existing.id+'?uploadType=multipart';
        method = 'PATCH';
      } else {
        url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        method = 'POST';
      }
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', new Blob([payload], { type: 'application/json' }));
      const r = await fetch(url, {
        method, headers: { Authorization: 'Bearer ' + _token }, body: form
      });
      if(!r.ok){ const e = await r.json(); throw new Error(e.error?.message || r.status); }
      const now = new Date().toLocaleString('zh-TW');
      localStorage.setItem('gdLastSync', now);
      _setLastSync('上次同步：' + now);
      _setStatus('已備份 ✓', 'gd-ok');
      Toast.success('已備份至 Google Drive ✓（'+qs.length+' 題・'+ls.length+' 條）');
    }catch(e){
      _setStatus('備份失敗', 'gd-err');
      Toast.error('備份失敗：' + (e.message || String(e)));
      logError('gdBackup', e);
    }finally{
      _setLoading('gd-btn-backup', false);
      setTimeout(()=>_setStatus('已連線', 'gd-ok'), 3000);
    }
  }

  /* ── 還原 ── */
  async function restore(){
    if(!_token){ Toast.warn('請先登入 Google'); return; }
    cfm('從雲端還原', '將覆蓋寫入現有資料（題目不重複），確定繼續？', async function(){
      _setLoading('gd-btn-restore', true);
      _setStatus('還原中…', 'gd-warn');
      try{
        const file = await _findFileId();
        if(!file){ Toast.warn('雲端尚無備份檔案'); _setStatus('已連線', 'gd-ok'); return; }
        const r = await fetch('https://www.googleapis.com/drive/v3/files/'+file.id+'?alt=media', {
          headers: { Authorization: 'Bearer ' + _token }
        });
        if(!r.ok) throw new Error('下載失敗 ' + r.status);
        const data = await r.json();
        const qs = Array.isArray(data.questions) ? data.questions.map(({id,...x})=>x) : [];
        const ls = Array.isArray(data.laws) ? data.laws.map(({id,...x})=>x) : [];
        const as_ = Array.isArray(data.attempts) ? data.attempts.map(({id,...x})=>x) : [];
        await bulkPut('questions', qs);
        if(ls.length) await bulkPut('laws', ls);
        if(as_.length) await bulkPut('attempts', as_);
        const now = new Date().toLocaleString('zh-TW');
        localStorage.setItem('gdLastSync', now);
        _setLastSync('上次同步：' + now);
        _setStatus('已還原 ✓', 'gd-ok');
        Toast.success('已從雲端還原 ✓（'+qs.length+' 題・'+ls.length+' 條）');
        renderHome(); SettingsPage.init();
      }catch(e){
        _setStatus('還原失敗', 'gd-err');
        Toast.error('還原失敗：' + (e.message || String(e)));
        logError('gdRestore', e);
      }finally{
        _setLoading('gd-btn-restore', false);
        setTimeout(()=>{ if(_token) _setStatus('已連線', 'gd-ok'); }, 3000);
      }
    });
  }

  return { init, signIn, signOut, backup, restore };
})();

/* 全域代理函式（HTML onclick 使用） */
function gdSignIn()  { GD.signIn();   }
function gdSignOut() { GD.signOut();  }
function gdBackup()  { GD.backup();   }
function gdRestore() { GD.restore();  }
/* ══ BULK IMPORT ══ */
function parseBulk(){try{
  const biEl=$el('bi-text');if(!biEl){Toast.warn('找不到輸入框');return;}
  const text=biEl.value||'';if(!text.trim()){Toast.warn('請先貼入題目文字');return;}
  const parsed=parseBulkText(text);S.bulkParsed=parsed;
  const ansStr=($el('bi-ans')||{}).value||'';const ansMap=parseAnswerStr(ansStr);
  const biPart=($el('bi-part')||{}).value||'';const biChapter=($el('bi-chapter')||{}).value||'';const biSection=($el('bi-section')||{}).value||'';
  parsed.forEach((q,i)=>{const n=parseInt(q.num)||i+1;if(ansMap[n])q.answer=ansMap[n];if(biPart)q.part=biPart.trim();if(biChapter)q.chapter=biChapter.trim();if(biSection)q.section=biSection.trim();});
  const mc=parsed.filter(q=>q.type==='mc').length;const es=parsed.filter(q=>q.type==='es').length;
  const statsEl=$el('bulk-stats');if(statsEl)statsEl.innerHTML='<span class="tag">'+parsed.length+' 題</span><span class="tag">選擇 '+mc+'</span><span class="tag">申論 '+es+'</span>';
  const prevEl=$el('prev-list');if(prevEl)prevEl.innerHTML=parsed.map(q=>'<div class="pi '+(q.answer||q.type==='es'?'ok':'warn')+'"><div class="pi-n">第'+q.num+'題 · '+(q.type==='mc'?'選擇題':'申論題')+(q.answer?' · 答案:'+q.answer:'')+'</div><div class="pi-s">'+esc(q.stem||'')+'</div></div>').join('');
  const resEl=$el('bulk-result');if(resEl)resEl.classList.remove('hide');
  if(!parsed.length)Toast.warn('解析結果為0題');else Toast.success('解析完成：'+parsed.length+' 題 ✓');
}catch(err){Toast.error('解析錯誤：'+err.message);console.error('parseBulk error:',err);}}

async function importBulk(){
  if(!S.bulkParsed.length){Toast.warn('請先解析題目');return;}
  const sub=($el('bi-sub')||{}).value||'';const yr=($el('bi-yr')||{}).value||'';const ex=($el('bi-ex')||{}).value||'';
  const items=S.bulkParsed.map(q=>({...q,subject:sub||q.subject||'',year:yr||q.year||'',exam:ex||q.exam||''}));
  try{await bulkPut('questions',items);Toast.success('已匯入 '+items.length+' 題 ✓');S.bulkParsed=[];$el('bulk-result').classList.add('hide');renderHome();}
  catch(err){Toast.error('匯入失敗：'+err.message);}
}

function clearBulk(){$el('bi-text').value='';$el('bi-ans').value='';['bi-part','bi-chapter','bi-section'].forEach(id=>{const el=$el(id);if(el)el.value='';});$el('bulk-result').classList.add('hide');S.bulkParsed=[];}

/* ── 大量貼題 overlay 的解析/匯入（使用新的 bulk-q-ov 中的元素） ── */
function parseBulkQ(){try{
  const biEl=$el('bi-text');if(!biEl){Toast.warn('找不到輸入框');return;}
  const text=biEl.value||'';if(!text.trim()){Toast.warn('請先貼入題目文字');return;}
  const parsed=parseBulkText(text);S.bulkParsed=parsed;
  const ansStr=($el('bi-ans')||{}).value||'';const ansMap=parseAnswerStr(ansStr);
  parsed.forEach((q,i)=>{const n=parseInt(q.num)||i+1;if(ansMap[n])q.answer=ansMap[n];});
  const sub=($el('bi-sub')||{}).value||'';const yr=($el('bi-yr')||{}).value||'';const ex=($el('bi-ex')||{}).value||'';
  parsed.forEach(q=>{if(sub)q.subject=sub;if(yr)q.year=yr;if(ex)q.exam=ex;});
  const mc=parsed.filter(q=>q.type==='mc').length;const es=parsed.filter(q=>q.type==='es').length;
  const statsEl=$el('bulk-q-stats');if(statsEl)statsEl.innerHTML='<span class="tag">'+parsed.length+' 題</span><span class="tag">選擇 '+mc+'</span><span class="tag">申論 '+es+'</span>';
  const prevEl=$el('bulk-q-prev-list');if(prevEl)prevEl.innerHTML=parsed.map(q=>'<div class="pi '+(q.answer||q.type==='es'?'ok':'warn')+'"><div class="pi-n">第'+q.num+'題 · '+(q.type==='mc'?'選擇題':'申論題')+(q.answer?' · 答案:'+q.answer:'')+'</div><div class="pi-s">'+esc(q.stem||'')+'</div></div>').join('');
  const resEl=$el('bulk-q-result');if(resEl)resEl.classList.remove('hide');
  if(!parsed.length)Toast.warn('解析結果為0題');else Toast.success('解析完成：'+parsed.length+' 題 ✓');
}catch(err){Toast.error('解析錯誤：'+err.message);}}

async function importBulkQ(){
  if(!S.bulkParsed.length){Toast.warn('請先解析題目');return;}
  try{
    await bulkPut('questions',S.bulkParsed);
    Toast.success('已匯入 '+S.bulkParsed.length+' 題 ✓');
    S.bulkParsed=[];
    const r=$el('bulk-q-result');if(r)r.classList.add('hide');
    closeBulkImportQ();renderList();renderHome();
  }catch(err){Toast.error('匯入失敗：'+err.message);}
}

function clearBulkQ(){
  const biEl=$el('bi-text');if(biEl)biEl.value='';
  const ansEl=$el('bi-ans');if(ansEl)ansEl.value='';
  const r=$el('bulk-q-result');if(r)r.classList.add('hide');
  S.bulkParsed=[];
}

function parseAnswerStr(s){const map={};if(!s)return map;const parts=s.trim().split(/[\s,，]+/);parts.forEach((p,i)=>{const m=p.match(/^(\d+)[.\s]*([A-Ea-e]+)$/);if(m)map[parseInt(m[1])]=m[2].toUpperCase();else if(/^[A-Ea-e]+$/.test(p))map[i+1]=p.toUpperCase();});return map;}

function parseBulkText(text){
  if(!text||!text.trim())return[];
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  const questions=[];let curQ=null,curOptKey=null,optIdx=0;
  const OPT_KEYS=['A','B','C','D','E'];
  function finishQ(){if(!curQ)return;curQ.stem=curQ.stem.trim();Object.keys(curQ.options).forEach(k=>{curQ.options[k]=curQ.options[k].trim();});curQ.type=Object.keys(curQ.options).length>=2?'mc':'es';if(curQ.stem)questions.push(curQ);curQ=null;curOptKey=null;optIdx=0;}
  function newQ(num,stemStart){finishQ();curQ={num,stem:stemStart,type:'es',options:{},answer:'',answerEs:'',keywords:[],mustKeywords:[],tags:[],note:'',starred:false,createdAt:Date.now(),reviewLevel:0,nextReview:Date.now(),wrongCount:0,correctStreak:0,difficultyScore:5};}
  for(const line of lines){
    const mNum=line.match(/^(\d+)[.、。\s]\s*(.+)/);
    const mAlpha=line.match(/^[（(]?([A-Ea-e])[）)][.、\s]?\s*(.+)/);
    if(mNum){newQ(mNum[1],mNum[2]);continue;}
    if(mAlpha&&curQ){const k=mAlpha[1].toUpperCase();curQ.options[k]=mAlpha[2];curOptKey=k;const ki=OPT_KEYS.indexOf(k);if(ki>=optIdx)optIdx=ki+1;continue;}
    if(curQ){if(curOptKey&&curQ.options[curOptKey]!==undefined)curQ.options[curOptKey]+=' '+line;else curQ.stem+=' '+line;}
  }
  finishQ();return questions;
}
/* ══ GROUPS ══ */
const DEFAULT_CONCEPT_GROUPS=[
  {name:'臨檢群組',icon:'🔍',keywords:['臨檢','身分查證','查證身分','公共場所'],laws:['警職法§6','警職法§7'],desc:'警察職權行使法臨檢相關規定'},
  {name:'比例原則',icon:'⚖',keywords:['比例原則','適當性','必要性','相當性'],laws:['警職法§3','警察法§2'],desc:'比例原則三子原則及適用'},
  {name:'即時強制',icon:'⚡',keywords:['即時強制','管束','扣留','使用警械'],laws:['警職法§19','警械條例§4'],desc:'即時強制類型及要件'},
  {name:'集會遊行',icon:'📢',keywords:['集會','遊行','申請許可','解散'],laws:['集遊法§8','集遊法§11'],desc:'集會遊行法重點規定'},
  {name:'警察勤務',icon:'📋',keywords:['勤區查察','巡邏','臨檢','守望','值班','備勤'],laws:['警勤條例§9'],desc:'警察六大勤務方式'},
];

async function renderGroups(){try{
  const el=$el('groups-list');if(!el)return;
  const[qs,groups]=await Promise.all([da('questions'),da('conceptGroups').catch(()=>[])]);
  const allGroups=[...DEFAULT_CONCEPT_GROUPS,...groups];
  el.innerHTML=allGroups.map(g=>'<div class="group-card fu">'+
    '<div class="group-icon">'+g.icon+'</div>'+
    '<div class="group-name">'+esc(g.name)+'</div>'+
    '<div class="group-desc">'+esc(g.desc||'')+'</div>'+
    '<div class="group-laws">'+((g.laws||[]).map(l=>'<span class="tag" style="color:var(--pur);cursor:pointer" onclick="showLawPop(\''+esc(l)+'\')">⚖ '+esc(l)+'</span>').join(''))+'</div>'+
    '<div class="group-kws">'+((g.keywords||[]).map(kw=>'<span class="tag">'+esc(kw)+'</span>').join(''))+'</div>'+
    '<div style="margin-top:8px">'+
      '<button class="chip" style="font-size:11px" onclick="startGroupQ(\''+esc(JSON.stringify(g.keywords))+'\')">▶ 練習相關題目</button>'+
    '</div>'+
  '</div>').join('');
}catch(e){logError('renderGroups',e);}}

async function startGroupQ(kwsJson){try{
  const kws=JSON.parse(kwsJson);const qs=await da('questions');
  const pool=qs.filter(q=>q.type==='mc'&&kws.some(kw=>(q.stem||'').includes(kw)||(q.keywords||[]).includes(kw)));
  if(!pool.length){Toast.info('找不到相關題目');return;}
  startQWithPool(pool,'group');
}catch(e){}}

/* ══ ICON EDITOR ══ */
function openIconEditor(){const ov=$el('icon-ov');if(ov){ov.classList.add('on');}}
function closeIconEditor(){const ov=$el('icon-ov');if(ov){ov.classList.remove('on');}}
function resetAllIcons(){if(!confirm('確定重置所有圖示？'))return;localStorage.removeItem('customIcons');Toast.info('已重置，重新整理頁面生效');}
/* ══ BOOT ══ */
(function boot(){
  // Splash + app reveal handled by loading.js

  // Init
  function safe(name,fn){try{fn();}catch(e){console.error('[INIT] '+name+':',e.message);}}
  safe('Modal',   function(){Modal.init();});
  safe('Router',  function(){Router.initNav();});
  safe('FAB',     function(){FAB.init();FAB.update('home-study');});
  safe('Import',  function(){ImportPage.init();});
  safe('Player',  function(){PlayerPage.init();});
  safe('SLib',    function(){SLibrary.init();});

  // Router hooks
  Router.onEnter('home',           function(){HomePage.render();});
  Router.onEnter('page-s-library', function(){SLibrary.render();});
  Router.onEnter('page-review',    function(){ReviewPage.render();});
  Router.onEnter('page-settings',  function(){SettingsPage.init();});
  Router.onEnter('page-q-library', function(){renderList();});
  Router.onEnter('page-pg-db',     function(){renderDB();});
  Router.onEnter('page-pg-stats',  function(){renderStats();});
  Router.onEnter('page-pg-groups', function(){renderGroups();});
  Router.onEnter('page-pg-list',   function(){openInlineBrowse();});

  // Home section tabs
  document.querySelectorAll('.sec-tab').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('.sec-tab').forEach(function(x){
        x.classList.remove('active');
        x.setAttribute('aria-selected','false');
      });
      t.classList.add('active');
      t.setAttribute('aria-selected','true');
      var sec=t.id==='tab-study'?'study':'exam';
      Router.setHomeSection(sec);
      var sp=$el('study-panel'),ep=$el('exam-panel');
      if(sp)sp.classList.toggle('active',sec==='study');
      if(ep)ep.classList.toggle('active',sec==='exam');
    });
  });

  // Global back button delegation
  document.addEventListener('click',function(e){
    var btn=e.target.closest('[data-action="back"]');if(btn)Router.back();
  });

  // Async init
  (async function(){
    try{
      await Promise.all([DB.open(),initDB()]);
      await Store.load();
      await HomePage.render();
      await renderHome();
      var verEl=$el('app-ver');if(verEl)verEl.textContent=APP_VER;
    }catch(e){console.error('[DATA]',e);}
  })();
})();
