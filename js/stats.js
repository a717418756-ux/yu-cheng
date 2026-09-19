// ══ stats.js — 統計分析 + AI 弱點診斷 + 考題匯出（出題趨勢）══════════
// 依賴：db.js(getDangerLevel), utils.js(getWrong/today/dl/esc), data.js
// 公開 API：renderStats / clearWrongAts / buildAI / copyAI / dlAI / updateAIExport / exportAI

(function(){
'use strict';

let _dchart = null;

// 作答結果三態：true 答對、false 答錯、null 不計分（申論題、無標準答案）。
// ★ 過去用 !a.correct 判斷答錯，會把申論的 null 也算成錯，污染所有錯誤統計。
const _isWrong    = a => a.correct === false;
const _isAnswered = a => a.correct === true || a.correct === false;
const _pct = (n, d) => d ? Math.round(n / d * 100) : 0;
const _daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// 每題的作答彙總（一次掃過 attempts，避免 qs.find 巢狀迴圈）
function _attemptStats(ats){
  const m = new Map();
  for(const a of ats){
    if(!_isAnswered(a)) continue;
    let s = m.get(a.qid);
    if(!s){ s = { n:0, wrong:0 }; m.set(a.qid, s); }
    s.n++; if(_isWrong(a)) s.wrong++;
  }
  return m;
}

// 最近一個尚未到期的倒數（考試日）
async function _nextExam(){
  const cds = await da('countdowns').catch(() => []);
  const t = today();
  const up = (cds || []).filter(c => c.date && c.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  if(!up) return null;
  const days = Math.ceil((new Date(up.date) - new Date(t)) / 86400000);
  return { name: up.name || '考試', date: up.date, days };
}

// ════════════════════════════════════════════════════════════
// 【統計頁渲染】
// ════════════════════════════════════════════════════════════
async function renderStats(){  try{
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  const qById = new Map(qs.map(q => [q.id, q]));
  const answered = ats.filter(_isAnswered);
  const correct = answered.filter(a => a.correct).length;
  document.getElementById('st-q').textContent = qs.length;
  document.getElementById('st-a').textContent = answered.length;
  document.getElementById('st-r').textContent = answered.length ? _pct(correct, answered.length) + '%' : '—';

  // 各科正確率 = 該科答對次數 ÷ 該科作答次數
  // ★ 原本除以「該科題數」，題庫越大正確率越低，與實際表現無關
  const subMap = {};
  for(const a of ats){
    const q = qById.get(a.qid); if(!q) continue;
    const s = q.subject || '未分類';
    const d = subMap[s] || (subMap[s] = { n:0, ok:0, time:0, tn:0 });
    if(_isAnswered(a)){ d.n++; if(a.correct) d.ok++; }
    if(a.responseTime){ d.time += a.responseTime; d.tn++; }
  }
  const bars = document.getElementById('subj-bars');
  const rows = Object.entries(subMap).filter(([, d]) => d.n);
  bars.innerHTML = rows.length ? rows
    .sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n)
    .map(([s, d]) => {
      const r = _pct(d.ok, d.n);
      const avgT = d.tn ? Math.round(d.time / d.tn / 1000) : 0;
      const color = r >= 80 ? 'var(--grn)' : r >= 60 ? 'var(--org)' : 'var(--red)';
      return `<div class="sr">
        <div class="sn" title="${esc(s)}">${esc(s)}</div>
        <div class="sbw"><div class="sbar" style="width:${r}%;background:${color}"></div></div>
        <div class="sp">${r}%</div>
        <div style="font-size:10px;color:var(--t2);width:40px;text-align:right">${avgT}s</div>
      </div>`;
    }).join('')
    : '<div style="font-size:12px;color:var(--t2)">尚無作答記錄</div>';

  // 學習軌跡：最近 30 天，畫面顯示 7 天，左右滑動查看
  const totalDays = 30, visibleDays = 7;
  const labels = [], data = [];
  for(let i = totalDays - 1; i >= 0; i--){
    const ds = _daysAgo(i);
    labels.push(ds.slice(5));
    data.push(ats.filter(a => a.date === ds).length);
  }
  const ctx = document.getElementById('dchart');
  if(_dchart) _dchart.destroy();
  const chartWrap = ctx?.parentElement;
  if(chartWrap){
    chartWrap.style.overflowX = 'auto';
    chartWrap.style.overflowY = 'hidden';
    chartWrap.style.webkitOverflowScrolling = 'touch';
    chartWrap.style.scrollSnapType = 'x mandatory';
    setTimeout(() => { chartWrap.scrollLeft = chartWrap.scrollWidth; }, 100);
  }
  const barW = Math.round((chartWrap?.clientWidth || 320) / visibleDays);
  if(ctx){
    ctx.style.width = (barW * totalDays) + 'px';
    ctx.style.height = '110px';
    ctx.width = barW * totalDays;
    ctx.height = 110;
  }
  _dchart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: '#58a6ff55', borderColor: '#58a6ff',
      borderWidth: 1, borderRadius: 4, barThickness: Math.max(18, barW - 8) }] },
    options: { animation: false, responsive: false, plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8b949e', maxTicksLimit: 4 }, grid: { color: '#30363d' } },
        x: { ticks: { color: '#8b949e', maxRotation: 0 }, grid: { display: false } }
      } }
  });

  // 危險等級分佈
  const dangerMap = { '🔴':0, '🟠':0, '🟡':0, '🟢':0 };
  qs.forEach(q => { dangerMap[getDangerLevel(q, ats)]++; });
  document.getElementById('wrong-subs').innerHTML = Object.entries(dangerMap).map(([lv, cnt]) =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <span style="font-size:16px">${lv}</span>
      <div style="flex:1;background:var(--bg3);border-radius:3px;height:8px;overflow:hidden">
        <div style="height:8px;border-radius:3px;background:var(--acc);width:${qs.length ? cnt / qs.length * 100 : 0}%"></div>
      </div>
      <span style="font-size:12px;color:var(--t2)">${cnt} 題</span>
    </div>`).join('');

  // 高頻錯誤關鍵概念
  const kwMap = {};
  for(const a of ats){
    if(!_isWrong(a)) continue;
    (qById.get(a.qid)?.keywords || []).forEach(kw => { kwMap[kw] = (kwMap[kw] || 0) + 1; });
  }
  document.getElementById('kw-cloud').innerHTML =
    Object.entries(kwMap).sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([kw, cnt]) => `<span class="tag" style="font-size:${Math.min(14, 10 + cnt)}px">${esc(kw)}(${cnt})</span>`).join('');

  _fillExportFilters(qs);
  }catch(e){ logError('renderStats', e); }}

async function clearWrongAts(){  try{
  const ats = await da('attempts');
  const wrong = ats.filter(_isWrong);
  if(!wrong.length){ toast('目前無錯誤記錄'); return; }
  if(!confirm('確定刪除 ' + wrong.length + ' 筆錯誤作答記錄？\n正確作答記錄保留，此操作無法復原。')) return;
  for(const a of wrong) await dd('attempts', a.id);
  toast('已刪除 ' + wrong.length + ' 筆錯誤記錄 ✓');
  renderStats();
  }catch(e){ logError('clearWrongAts', e); }}

// 題目內容（給 AI 看的精簡格式；選項同一行以節省長度）
function _qText(q, maxStem){
  const stem = (q.stem || '').replace(/\s+/g, ' ').trim();
  const lines = [maxStem && stem.length > maxStem ? stem.slice(0, maxStem) + '…' : stem];
  const opts = Object.entries(q.options || {}).map(([k, v]) => `(${k})${String(v).replace(/\s+/g, ' ').trim()}`);
  if(q.type !== 'es' && opts.length) lines.push(opts.join(' '));
  return lines.join('\n');
}
function _qMeta(q, st){
  const parts = [];
  if(q.type === 'es'){
    const es = (q.answerEs || '').replace(/\s+/g, ' ').trim();
    if(es) parts.push('參考答案：' + (es.length > 300 ? es.slice(0, 300) + '…' : es));
  } else parts.push('答：' + (q.answer || '（未填）'));
  if((q.keywords || []).length) parts.push('概念：' + q.keywords.join('、'));
  const laws = (q.relatedLaws || []).map(r => r.ref || r.lawName).filter(Boolean);
  if(laws.length) parts.push('法條：' + laws.join('、'));
  if(st && st.wrong) parts.push(`我錯${st.wrong}次／作答${st.n}次`);
  return parts.join('｜');
}

// ════════════════════════════════════════════════════════════
// 【AI 弱點診斷】依作答紀錄產生報告，貼給 AI 取得個人化建議
// ════════════════════════════════════════════════════════════
async function buildAI(){  try{
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  const answered = ats.filter(_isAnswered);
  if(!answered.length){ toast('尚無作答記錄，先練習一些題目再產生'); return; }
  const qById = new Map(qs.map(q => [q.id, q]));
  const qStat = _attemptStats(ats);
  const exam = await _nextExam();
  const d7 = _daysAgo(7);

  // 整體與近 7 天對比
  const recent = answered.filter(a => a.date >= d7), older = answered.filter(a => a.date < d7);
  const rateAll = _pct(answered.filter(a => a.correct).length, answered.length);
  const rate7 = _pct(recent.filter(a => a.correct).length, recent.length);
  const rateOld = _pct(older.filter(a => a.correct).length, older.length);
  const reviewDue = qs.filter(q => q.type === 'mc' && (q.nextReview || 0) <= Date.now()).length;
  const untouched = qs.filter(q => q.type === 'mc' && !qStat.has(q.id)).length;

  // 各科：作答、正確率、近 7 天正確率、平均秒數
  const sub = {};
  for(const a of answered){
    const q = qById.get(a.qid); if(!q) continue;
    const d = sub[q.subject || '未分類'] || (sub[q.subject || '未分類'] = { n:0, ok:0, rn:0, rok:0, t:0, tn:0 });
    d.n++; if(a.correct) d.ok++;
    if(a.date >= d7){ d.rn++; if(a.correct) d.rok++; }
    if(a.responseTime){ d.t += a.responseTime; d.tn++; }
  }
  const subRows = Object.entries(sub).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);

  // 關鍵概念與法條：錯誤次數＋錯誤率（至少作答 2 次才列，避免 1 次失手就上榜）
  const kw = {}, law = {};
  for(const a of answered){
    const q = qById.get(a.qid); if(!q) continue;
    const w = _isWrong(a) ? 1 : 0;
    (q.keywords || []).forEach(k => { const d = kw[k] || (kw[k] = { n:0, w:0 }); d.n++; d.w += w; });
    (q.relatedLaws || []).forEach(r => { const k = r.ref || r.lawName; if(!k) return;
      const d = law[k] || (law[k] = { n:0, w:0 }); d.n++; d.w += w; });
  }
  const topBy = (m, n) => Object.entries(m).filter(([, d]) => d.w && d.n >= 2)
    .sort((a, b) => b[1].w - a[1].w || b[1].w / b[1].n - a[1].w / a[1].n).slice(0, n);

  // 記憶斷層：近 7 天內，同一概念在 2 個以上不同日子答錯
  const gapDays = {};
  for(const a of recent){
    if(!_isWrong(a)) continue;
    (qById.get(a.qid)?.keywords || []).forEach(k => { (gapDays[k] || (gapDays[k] = new Set())).add(a.date); });
  }
  const gaps = Object.entries(gapDays).filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, 8);

  // 危險題（附完整題目與答案，讓 AI 能逐題講解）
  const lvOrder = { '🔴':0, '🟠':1 };
  const danger = qs.filter(q => q.type === 'mc' && qStat.has(q.id))
    .map(q => ({ q, lv: getDangerLevel(q, ats) }))
    .filter(x => x.lv in lvOrder)
    .sort((a, b) => lvOrder[a.lv] - lvOrder[b.lv] || qStat.get(b.q.id).wrong - qStat.get(a.q.id).wrong)
    .slice(0, 12);

  // 不穩題：最近一次雖答對但作答超過 40 秒（多半是猜的或觀念模糊）
  const lastAt = new Map();
  for(const a of answered){
    const p = lastAt.get(a.qid);
    if(!p || a.date > p.date || (a.date === p.date && (a.id || 0) > (p.id || 0))) lastAt.set(a.qid, a);
  }
  const shaky = [...lastAt.values()].filter(a => a.correct && a.hesitationFlag)
    .map(a => qById.get(a.qid)).filter(q => q && q.type === 'mc').slice(0, 8);

  const L = [];
  L.push('# 警察特考 弱點診斷報告');
  L.push(`> 產生：${new Date().toLocaleString('zh-TW')}` + (exam ? `｜${exam.name}：${exam.date}（剩 ${exam.days} 天）` : ''));
  L.push('');
  L.push('## 整體');
  L.push(`- 題庫 ${qs.length} 題｜作答 ${answered.length} 次｜整體正確率 ${rateAll}%`);
  L.push(`- 近 7 天正確率 ${recent.length ? rate7 + '%' : '—'}（${recent.length} 次）；更早 ${older.length ? rateOld + '%' : '—'}（${older.length} 次）`);
  L.push(`- 待複習 ${reviewDue} 題｜從未作答的選擇題 ${untouched} 題`);
  L.push('');
  L.push('## 各科表現（由弱到強）');
  L.push('| 科目 | 作答 | 正確率 | 近7天 | 平均秒數 |');
  L.push('|---|---|---|---|---|');
  subRows.forEach(([s, d]) => L.push(`| ${s} | ${d.n} | ${_pct(d.ok, d.n)}% | ${d.rn ? _pct(d.rok, d.rn) + '%' : '—'} | ${d.tn ? Math.round(d.t / d.tn / 1000) : '—'} |`));
  const kwTop = topBy(kw, 12), lawTop = topBy(law, 8);
  if(kwTop.length){
    L.push('', '## 高頻錯誤概念（錯誤次數／作答次數）');
    kwTop.forEach(([k, d]) => L.push(`- ${k}：錯 ${d.w}／${d.n}（${_pct(d.w, d.n)}%）`));
  }
  if(lawTop.length){
    L.push('', '## 常錯法條');
    lawTop.forEach(([k, d]) => L.push(`- ${k}：錯 ${d.w}／${d.n}`));
  }
  if(gaps.length){
    L.push('', '## 記憶斷層（近 7 天在不同日子反覆答錯）');
    gaps.forEach(([k, s]) => L.push(`- ${k}（${s.size} 天）`));
  }
  if(danger.length){
    L.push('', '## 危險題（最近連錯或最後一次答錯）');
    danger.forEach(({ q, lv }, i) => {
      L.push('', `**${i + 1}. ${lv} ${q.year || ''}${q.exam ? ' ' + q.exam : ''} ${q.subject || ''} 第${q.num || '?'}題**`);
      L.push(_qText(q, 200));
      L.push(_qMeta(q, qStat.get(q.id)));
    });
  }
  if(shaky.length){
    L.push('', '## 不穩題（答對但猶豫超過 40 秒）');
    shaky.forEach(q => L.push(`- [${q.subject || ''}] ${(q.stem || '').replace(/\s+/g, ' ').slice(0, 60)}…｜答：${q.answer || ''}`));
  }
  L.push('', '---', '## 請你協助');
  L.push(`我是警察，正在準備${exam ? `「${exam.name}」（${exam.date}，剩 ${exam.days} 天）` : '升官等考試'}。請根據以上資料：`);
  L.push('1. 依嚴重程度排出我的前 5 個弱點，說明判斷依據（請看正確率與近 7 天的變化）');
  if(danger.length) L.push('2. 逐題講解「危險題」：正確觀念、錯誤選項錯在哪、易混淆的點（條列、精簡）');
  L.push(`3. ${exam ? `為剩下的 ${exam.days} 天` : '為接下來幾週'}排出每週複習重點，弱科優先，並保留考前總複習時間`);
  L.push('4. 高頻錯誤概念請整理成比較表或記憶口訣');
  if(shaky.length) L.push('5. 不穩題請提示快速判斷的關鍵字');

  S.aiMd = L.join('\n');
  document.getElementById('ai-md').textContent = S.aiMd;
  const out = document.getElementById('ai-out');
  out.classList.remove('hide');
  out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  toast('診斷報告已產生 ✓');
  }catch(e){ logError('buildAI', e); }}

async function _copy(text){
  try{ await navigator.clipboard.writeText(text); toast('已複製，貼到 ChatGPT／Claude 即可 ✓'); }
  catch(e){ toast('無法存取剪貼簿，請改用下載'); }
}
function copyAI(){ if(S.aiMd) _copy(S.aiMd); }
function dlAI(){ if(S.aiMd) dl(S.aiMd, '弱點診斷_' + today() + '.md', 'text/markdown'); }

// ════════════════════════════════════════════════════════════
// 【考題匯出】依條件篩選，連同分析指令給 AI 找出題趨勢
// ════════════════════════════════════════════════════════════
const _AX_SOFT_LIMIT = 120000;   // 超過約 12 萬字，AI 一次多半讀不完

function _fillExportFilters(qs){
  const sel = (id, opts, keepAll) => {
    const el = document.getElementById(id); if(!el) return;
    const cur = el.value;
    el.innerHTML = (keepAll ? `<option value="">${keepAll}</option>` : '')
      + opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    if([...el.options].some(o => o.value === cur)) el.value = cur;
  };
  const uniq = f => [...new Set(qs.map(f).filter(Boolean))];
  const years = uniq(q => q.year).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
  sel('ax-sub', uniq(q => q.subject).sort(), '全部科目');
  sel('ax-exam', uniq(q => q.exam).sort(), '全部考試別');
  sel('ax-y1', years, '最早');
  sel('ax-y2', years, '最新');
  updateAIExport();
}

async function _exportSet(){
  const [qs, ats] = await Promise.all([da('questions'), da('attempts')]);
  const v = id => document.getElementById(id)?.value || '';
  const f = { sub: v('ax-sub'), exam: v('ax-exam'), y1: v('ax-y1'), y2: v('ax-y2'),
              type: v('ax-type') || 'all', scope: v('ax-scope') || 'all' };
  const yn = y => parseInt(y) || 0;
  const wrong = f.scope === 'wrong' ? getWrong(qs, ats) : null;
  const list = qs.filter(q =>
    (!f.sub || q.subject === f.sub) &&
    (!f.exam || q.exam === f.exam) &&
    (!f.y1 || yn(q.year) >= yn(f.y1)) &&
    (!f.y2 || yn(q.year) <= yn(f.y2)) &&
    (f.type === 'all' || q.type === f.type) &&
    (f.scope !== 'wrong' || wrong.has(q.id)) &&
    (f.scope !== 'star' || q.starred))
    .sort((a, b) => yn(b.year) - yn(a.year) || (a.exam || '').localeCompare(b.exam || '')
      || (a.subject || '').localeCompare(b.subject || '') || (parseInt(a.num) || 0) - (parseInt(b.num) || 0));
  return { list, f, qStat: _attemptStats(ats) };
}

function _filterLabel(f){
  const y = f.y1 || f.y2 ? `${f.y1 || '最早'}–${f.y2 || '最新'}` : '全部';
  const type = { all:'全部', mc:'選擇題', es:'申論題' }[f.type];
  const scope = { all:'全部題目', wrong:'只含錯題', star:'只含收藏' }[f.scope];
  return `科目 ${f.sub || '全部'}｜年度 ${y}｜考試別 ${f.exam || '全部'}｜題型 ${type}｜${scope}`;
}

async function _exportMd({ list, f, qStat }){
  const exam = await _nextExam();
  const L = ['# 考題資料（供 AI 分析出題趨勢）',
    `> ${_filterLabel(f)}｜共 ${list.length} 題｜產生 ${today()}`, '',
    '## 請你分析',
    '1. 依年度統計各「關鍵概念」與「法條」出現次數，列出在 2 個以上年度重複出現的考點',
    '2. 比較近 3 年與更早年度：哪些考點變熱門、哪些變冷門',
    '3. 若含多個考試別，說明各考試別的出題偏好差異',
    '4. 依出題頻率排出最該準備的前 15 個考點，每個附一句重點',
    `5. 推測${exam ? `「${exam.name}」（${exam.date}）` : '下一次考試'}可能的出題方向`,
    '6. 題目後標「我錯 N 次」的是我的弱點，請特別指出「高頻又常錯」的考點',
    ''];
  let head = '', lastGroup = '';
  for(const q of list){
    const h = `## ${q.year || '未知年度'}｜${q.exam || '未分類'}｜${q.subject || '未分類'}`;
    if(h !== head){ L.push(h, ''); head = h; lastGroup = ''; }
    if(q.groupId && q.groupStem && q.groupId !== lastGroup){
      L.push('〔題組〕' + q.groupStem.replace(/\s+/g, ' ').trim(), '');
      lastGroup = q.groupId;
    }
    L.push(`**${q.num || '?'}.** ` + _qText(q), _qMeta(q, qStat.get(q.id)), '');
  }
  return L.join('\n');
}

function _exportJson({ list, f, qStat }){
  // 只留分析需要的欄位：排除手寫標註（base64，很大）、搜尋索引與複習排程等內部欄位
  return JSON.stringify({
    generatedAt: new Date().toISOString(), filters: _filterLabel(f), count: list.length,
    questions: list.map(q => ({
      year: q.year || '', exam: q.exam || '', subject: q.subject || '', num: q.num || '',
      type: q.type, stem: q.stem || '', groupStem: q.groupStem || undefined,
      options: q.type === 'es' ? undefined : q.options,
      answer: q.type === 'es' ? undefined : q.answer,
      answerEs: q.type === 'es' ? (q.answerEs || '') : undefined,
      keywords: q.keywords || [],
      relatedLaws: (q.relatedLaws || []).map(r => r.ref || r.lawName).filter(Boolean),
      myAttempts: qStat.get(q.id)?.n || 0, myWrong: qStat.get(q.id)?.wrong || 0,
    })),
  }, null, 2);
}

async function updateAIExport(){  try{
  const info = document.getElementById('ax-info'); if(!info) return;
  const set = await _exportSet();
  if(!set.list.length){ info.textContent = '沒有符合條件的題目'; info.classList.remove('warn'); return; }
  const len = (await _exportMd(set)).length;
  const big = len > _AX_SOFT_LIMIT;
  const size = len >= 10000 ? `約 ${(len / 10000).toFixed(1)} 萬字` : `約 ${len} 字`;
  info.textContent = `符合 ${set.list.length} 題・${size}`
    + (big ? '　內容偏長，AI 可能讀不完，建議縮小年度或科目' : '');
  info.classList.toggle('warn', big);
  }catch(e){ logError('updateAIExport', e); }}

async function exportAI(kind){  try{
  const set = await _exportSet();
  if(!set.list.length){ toast('沒有符合條件的題目'); return; }
  const tag = (set.f.sub || '全部科目') + '_' + today();
  if(kind === 'json') return dl(_exportJson(set), '考題_' + tag + '.json', 'application/json');
  const md = await _exportMd(set);
  if(kind === 'md') return dl(md, '考題_' + tag + '.md', 'text/markdown');
  _copy(md);
  }catch(e){ logError('exportAI', e); }}

// ════════ 公開 API ════════
const Stats = { renderStats, clearWrongAts, buildAI, copyAI, dlAI, updateAIExport, exportAI };
window.Stats = Stats;
Object.assign(window, Stats);

})();
