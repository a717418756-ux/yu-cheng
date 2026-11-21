// 考古題排名「🎯 考試範圍」分類的回歸測試：node tools/tests/predict_scope.test.js [exam_data.json]
//   沒給備份檔時只跑固定樣本；給了就把整個題庫的警察法規題分類一遍並印出各考試題數
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'predict.js'), 'utf8');
const win = {};
const ctx = { window: win, localStorage: { getItem: () => null, setItem(){} }, console, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const P = win._predictScope;
const sc = id => P.SCOPES.find(x => x.id === id);

assert.strictEqual(P.refLaw('社會秩序維護法§22'), '社會秩序維護法');
assert.strictEqual(P.refLaw('警察法第3條'), '警察法');
assert.strictEqual(P.refLaw('《警察法施行細則》§13'), '警察法施行細則');
assert.strictEqual(P.refLaw('釋字第535號'), '釋字');
assert.deepStrictEqual(JSON.parse(JSON.stringify(P.family('警察法施行細則'))), { law:'警察法', own:false });
assert.deepStrictEqual(JSON.parse(JSON.stringify(P.family('警械使用事件補償辦法'))), { law:'警械使用條例', own:false });
assert.strictEqual(P.family('警察人員人事條例'), null);
const q = (refs, extra) => Object.assign({ stem:'', note:'', keywords:[], relatedLaws: refs.map(ref => ({ ref })) }, extra || {});
// 警佐班不考集會遊行法、行政執行法
assert.strictEqual(P.qScope(q(['集會遊行法§9']), sc('zuo')).tier, 'out');
assert.strictEqual(P.qScope(q(['集會遊行法§9']), sc('2tech')).tier, 'own');
assert.strictEqual(P.qScope(q(['行政執行法§36', '警察法§9']), sc('zuo')).tier, 'own');
// 只引用子法 → 相關命令
assert.strictEqual(P.qScope(q(['治安顧慮人口查訪辦法§3']), sc('zuo')).tier, 'rel');
// 槍砲條例只在升官等
assert.strictEqual(P.qScope(q(['槍砲彈藥刀械管制條例§5']), sc('up')).tier, 'own');
assert.strictEqual(P.qScope(q(['槍砲彈藥刀械管制條例§5']), sc('p34')).tier, 'out');
// 行政中立法：一般四等、警察三四等有，警正班沒有
assert.strictEqual(P.qScope(q(['公務人員行政中立法§5']), sc('g4')).tier, 'own');
assert.strictEqual(P.qScope(q(['公務人員行政中立法§5']), sc('zheng')).tier, 'out');
// 沒有 relatedLaws：從解析找全名，長名優先（施行細則不會被算成本法）
assert.deepStrictEqual(JSON.parse(JSON.stringify(P.qLaws(q([], { note:'依警察法施行細則第10條' })))), ['警察法施行細則']);
assert.strictEqual(P.qScope(q([], { note:'依警察法施行細則第10條' }), sc('zuo')).tier, 'rel');
// 每部法律各自判斷：直接引用警察法、只引用警械子法 → 警察法算本法，警械算相關命令
{ const r = JSON.parse(JSON.stringify(P.qScope(q(['警察法§9', '警械使用事件補償辦法§21']), sc('zuo'))));
  assert.deepStrictEqual([r.tier, r.own, r.rel], ['own', ['警察法'], ['警械使用條例']]); }
{ const r = JSON.parse(JSON.stringify(P.qScope(q(['警械使用條例§4', '警械使用事件補償辦法§21']), sc('zuo'))));
  assert.deepStrictEqual([r.own, r.rel], [['警械使用條例'], []]); }
console.log('fixed samples ok');

const file = process.argv[2];
if(file){
  const d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const qs = d.questions.filter(x => x.subject === '警察法規');
  const noLaw = qs.filter(x => !P.qLaws(x).length);
  console.log('警察法規題', qs.length, '・完全找不到法規名', noLaw.length);
  P.SCOPES.forEach(s => {
    const c = { own:0, rel:0, out:0 }, cs = { own:0, rel:0, out:0 };
    qs.forEach(x => { const t = P.qScope(x, s).tier; c[t]++; if(x.exam === s.src) cs[t]++; });
    console.log(s.name.padEnd(12, '　'), '全部', JSON.stringify(c), s.src ? '｜' + s.src + '歷屆 ' + JSON.stringify(cs) : '');
  });
  noLaw.forEach(x => console.log('  無法規名：', x.exam, x.year, x.num, x.stem.slice(0, 40)));
}
