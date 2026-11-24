// 資料夾備份／還原的回歸測試（v4.49，GPT 11-18 複查的各項）。
// 用 Node 跑真正的 js/settings.js：整份載入，只在 IIFE 結尾多露出要測的函式；
// 資料庫（da／dc／bulkPut／_db）和資料夾（File System Access API）用記憶體替身。
// 執行：node tools/tests/settings_backup.test.js   （全部通過最後印「全部通過」，失敗會丟錯、結束碼 1）
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

// 第一個參數可指定別的 settings.js（例如改版前的那份，確認這些測試真的抓得到原本的問題）
const SRC = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', '..', 'js', 'settings.js'), 'utf8');
const EXPOSE = ['_gzPack', '_readExamFile', '_archiveExam', '_restoreTable', '_restoreDir', '_backupDir', '_sameFile'];
const END = 'window.Settings = Settings;';
assert.strictEqual(SRC.split(END).length, 2, '找不到 IIFE 結尾');
const code = SRC.replace(END, END + '\nwindow.__T = {' + EXPOSE.join(',') + '};');

// ── 記憶體資料夾：和瀏覽器的 FileSystemDirectoryHandle 同樣的用法 ──
const notFound = n => Object.assign(new Error(n + ' not found'), { name: 'NotFoundError' });
class Dir {
  constructor(name){ this.name = name; this.files = new Map(); this.dirs = new Map(); }
  async getFileHandle(n, o = {}){
    if(!this.files.has(n)){ if(!o.create) throw notFound(n); this.files.set(n, new File([], n)); }
    const d = this;
    return { getFile: async () => d.files.get(n),
             createWritable: async () => { const parts = []; return { write: async x => parts.push(x), close: async () => d.files.set(n, new File(parts, n)) }; } };
  }
  async getDirectoryHandle(n, o = {}){
    if(!this.dirs.has(n)){ if(!o.create) throw notFound(n); this.dirs.set(n, new Dir(n)); }
    return this.dirs.get(n);
  }
  async removeEntry(n){ if(!this.files.delete(n) && !this.dirs.delete(n)) throw notFound(n); }
  async *entries(){ for(const [n] of this.files) yield [n, await this.getFileHandle(n)]; for(const [n, d] of this.dirs) yield [n, d]; }
  put(n, data){ this.files.set(n, new File([data], n)); return this; }
  async text(n){ return await this.files.get(n).text(); }
}

// ── 記憶體資料庫 ──
const DB = {};
const tables = ['questions','laws','attempts','settings','countdowns','usageLogs','refbooks','learnmedia','englishMaterials',
                'englishVocab','healthLogs','ebooks','leisuremedia','snapshots'];
const sandbox = {
  console, Blob, File, TextEncoder, TextDecoder, DecompressionStream, CompressionStream, Response, fetch, atob, btoa,
  setTimeout, clearTimeout, Promise, URL,
  window: {}, navigator: { userAgent: 'node' },
  localStorage: { _m: {}, getItem(k){ return this._m[k] ?? null; }, setItem(k, v){ this._m[k] = String(v); } },
  document: { addEventListener(){}, readyState: 'loading', getElementById: () => null, hidden: false },
  GAS_URL_KEY: 'gasWebAppUrl', GAS_PWD_KEY: 'gasPassword', GAS_BACKUP_FILE: 'YC_Platform_backup.json', APP_VERSION: 'test',
  da: async t => (DB[t] || []).map(r => ({ ...r })),
  dc: async t => { DB[t] = []; },
  bulkPut: async (t, rows) => { DB[t] = (DB[t] || []).concat(rows.map(r => ({ ...r }))); },
  dg: async () => null, dp: async () => {}, dd: async () => {},
  _db: Object.assign({ transaction: async (...a) => a[a.length - 1](), tables: tables.map(name => ({ name })) },
                     Object.fromEntries(tables.map(t => [t, {}]))),
  logError: () => {}, toast: () => {}, esc: s => String(s), _cacheInvalidate: () => {},
  art2n: () => 0, _lawBlob: () => '', askConfirm: async () => true, askInput: async () => '測試',
};
// Node 沒有 FileReader：補 readAsDataURL（_blobToBase64 用）
sandbox.FileReader = class { readAsDataURL(b){ b.arrayBuffer().then(ab => { this.result = 'data:' + (b.type || 'application/octet-stream') + ';base64,' + Buffer.from(ab).toString('base64'); this.onload && this.onload(); }, e => { this.error = e; this.onerror && this.onerror(); }); } };
sandbox.window = sandbox; sandbox.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'settings.js' });
const T = sandbox.__T;
const plain = x => JSON.parse(JSON.stringify(x));   // 沙箱裡的陣列原型不同，比內容前先轉成一般資料

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// ── 損毀檔、包裝檔 ──
test('_readExamFile 拆 {data:"…"}、{ok,data:{}}；壞檔標 damaged 並帶原檔', async () => {
  const bk = { version: 3, questions: [{ id: 1 }], laws: [] };
  const d = new Dir('x').put('a.json', JSON.stringify({ data: JSON.stringify(bk) }))
                       .put('b.json', JSON.stringify({ ok: true, data: bk }))
                       .put('c.json', '﻿' + JSON.stringify(bk))
                       .put('bad.json', '{"questions":[');
  for(const n of ['a.json', 'b.json', 'c.json']) assert.deepStrictEqual(plain((await T._readExamFile(d, n)).data.questions), [{ id: 1 }], n);
  const e = await T._readExamFile(d, 'bad.json').then(() => null, x => x);
  assert(e && e.damaged && e.file && /內容損毀/.test(e.message));
  const nf = await T._readExamFile(d, 'none.json').then(() => null, x => x);
  assert.strictEqual(nf.name, 'NotFoundError');
});

// ── history 檔名 ──
test('同一秒的兩份不同備份，history 兩份都留著', async () => {
  const root = new Dir('root');
  for(const [ms, id] of [['100', 'aaa-1'], ['900', 'bbb-2']]){
    const data = { exportedAt: '2026-11-18T00:00:00.' + ms + 'Z', meta: { backupId: id }, questions: [{ id: ms }] };
    await T._archiveExam(root, { data, file: new File([JSON.stringify(data)], 'exam_data.json') });
  }
  const hist = root.dirs.get('history'), idx = JSON.parse(await hist.text('index.json'));
  assert.strictEqual(idx.length, 2);
  assert.notStrictEqual(idx[0].file, idx[1].file);
  assert.deepStrictEqual(JSON.parse(await hist.text(idx[1].file)).questions, [{ id: '100' }]);
});

test('損毀的 exam_data.json 原封不動移進 history（_damaged）', async () => {
  const root = new Dir('root');
  await T._archiveExam(root, { data: null, file: new File(['壞掉的內容'], 'exam_data.json', { lastModified: 1763424000000 }) });
  const hist = root.dirs.get('history'), idx = JSON.parse(await hist.text('index.json'));
  assert(/_damaged\.json$/.test(idx[0].file));
  assert.strictEqual(await hist.text(idx[0].file), '壞掉的內容');
});

test('權限等讀取錯誤原樣往外丟（localBackup 會停下不寫），不當成損毀、也不當成沒有檔', async () => {
  const d = new Dir('沒權限');
  d.getFileHandle = async () => { throw Object.assign(new Error('沒有權限'), { name: 'NotAllowedError' }); };
  const e = await T._readExamFile(d, 'exam_data.json').then(() => null, x => x);
  assert.strictEqual(e.name, 'NotAllowedError');
  assert(!e.damaged);
  // localBackup 的判斷寫在原始碼裡：只有 NotFoundError 當沒有檔、damaged 走 history、其他 throw
  assert(/if\(e\.name === 'NotFoundError'\)\{\}\s*else if\(e\.damaged\)[\s\S]{0,200}else throw e;/.test(SRC), 'localBackup 讀檔錯誤分支');
  assert(!/_readExamFile\(dirHandle, 'exam_data\.json'\)\.catch\(\(\)=>null\)/.test(SRC), '不能再把所有錯誤吞成 null');
});

test('v4.58.2 本機 exam_data.json 壓縮：寫進去的是 gz1:，讀回來內容一樣；舊的未壓縮檔照樣讀；history 原封不動', async () => {
  const data = { version: 3, exportedAt: '2026-11-24T08:00:00.000Z', meta: { backupId: 'b1' },
                 questions: Array.from({ length: 300 }, (_, i) => ({ id: i + 1, question: '依道路交通管理處罰條例第' + i + '條，下列何者正確？', answer: 'A' })),
                 laws: [{ id: 1, lawName: '刑法', content: '第一條 行為之處罰，以行為時之法律有明文規定者為限。' }] };
  const body = JSON.stringify(data), packed = await T._gzPack(body);
  assert(packed.startsWith('gz1:'), '要壓縮');
  assert(packed.length < body.length / 2, '壓縮後要明顯變小');
  const d = new Dir('備份').put('exam_data.json', packed);
  const r = await T._readExamFile(d, 'exam_data.json');
  assert.deepStrictEqual(plain(r.data), data);
  const old = await T._readExamFile(new Dir('舊').put('exam_data.json', body), 'exam_data.json');   // 舊版未壓縮
  assert.deepStrictEqual(plain(old.data), data);
  await T._archiveExam(d, r);                                     // 移進 history 的是原檔（壓縮的），還原舊版也讀得到
  const hist = d.dirs.get('history'), idx = JSON.parse(await hist.text('index.json'));
  assert.strictEqual(await hist.text(idx[0].file), packed);
  assert.deepStrictEqual(plain((await T._readExamFile(hist, idx[0].file)).data), data);
  assert(/const examFile = await _gzPack\(examBody\);\s*await _writeFile\(dirHandle, 'exam_data\.json', examFile\);/.test(SRC), 'localBackup 要寫壓縮後的內容');
});

// ── 附件身分 ──
test('_restoreTable：同 id 但不同筆（建立時間不同）不沿用這台的檔案；同一筆才沿用', async () => {
  const blob = new File(['舊書內容'], '1.pdf');
  DB.refbooks = [{ id: 1, title: '舊書', createdAt: 111, blob }];
  await T._restoreTable('refbooks', [{ id: 1, title: '別台的新書', createdAt: 222 }]);
  assert.strictEqual(DB.refbooks[0].blob, undefined);
  DB.refbooks = [{ id: 1, title: '舊書', createdAt: 111, blob }];
  await T._restoreTable('refbooks', [{ id: 1, title: '改了名字', createdAt: 111 }]);
  assert.strictEqual(DB.refbooks[0].blob, blob);
  DB.refbooks = [{ id: 1, title: '舊書', createdAt: 111, fileSize: 9, blob }];
  await T._restoreTable('refbooks', [{ id: 1, title: '舊書', createdAt: 111, fileSize: 10 }]);   // 檔案換過
  assert.strictEqual(DB.refbooks[0].blob, undefined);
  DB.refbooks = [{ id: 1, title: '舊書', blob }];                                                  // 舊資料沒有建立時間：比名稱
  await T._restoreTable('refbooks', [{ id: 1, title: '舊書' }]);
  assert.strictEqual(DB.refbooks[0].blob, blob);
});

test('_restoreDir：缺檔且這台同 id 是別筆 → 列為缺檔，不算沿用', async () => {
  DB.refbooks = [{ id: 1, title: '舊書', createdAt: 111, blob: new File(['x'], '1.pdf') }];
  const root = new Dir('r'); (await root.getDirectoryHandle('refbooks', { create: true })).put('1.meta.json', JSON.stringify({ id: 1, title: '新書', createdAt: 222, fileType: 'pdf' }));
  const r = await T._restoreDir(root, 'refbooks', 'refbooks', m => m.fileType || 'bin');
  assert.deepStrictEqual(plain([r.kept, r.missing]), [0, ['新書']]);
  assert(!DB.refbooks[0].blob, '不能接上這台別本書的檔案');
});

// ── 備份資料夾 ──
test('_backupDir：刪掉的書說明檔拿掉（檔案本體留著）；同大小不同內容會重寫', async () => {
  const root = new Dir('r'), d = await root.getDirectoryHandle('ebooks', { create: true });
  d.put('1.meta.json', '{"id":1}').put('1.pdf', 'AAAA').put('2.meta.json', '{"id":2}').put('2.pdf', 'BBBB');
  await T._backupDir(root, 'ebooks', [{ id: 1, title: '書1', fileType: 'pdf', blob: new File(['CCCC'], 'x') }], m => m.fileType);
  assert(!d.files.has('2.meta.json'), '已刪的說明檔要拿掉');
  assert(d.files.has('2.pdf'), '檔案本體留著');
  assert.strictEqual(await d.text('1.pdf'), 'CCCC', '同大小不同內容要重寫');
});

test('_sameFile：大檔比開頭、中間、結尾；相同才略過', async () => {
  const big = n => { const b = Buffer.alloc(5 * 1048576, 65); b[n] = 66; return b; };
  const d = new Dir('d').put('a.bin', big(10));
  assert.strictEqual(await T._sameFile(d, 'a.bin', new File([big(10)], 'x')), true);
  assert.strictEqual(await T._sameFile(d, 'a.bin', new File([big(5 * 1048576 - 3)], 'x')), false);   // 結尾不同
  assert.strictEqual(await T._sameFile(d, 'a.bin', new File([big(Math.floor(5 * 1048576 / 2))], 'x')), false);   // 中間不同
});

// ── 選舊版本還原 ──
test('_restoreDir listRows：清單照舊版本；資料夾同編號是同一筆才拿檔案與縮圖；是別筆不拿', async () => {
  DB.refbooks = [];
  const root = new Dir('r'), d = await root.getDirectoryHandle('refbooks', { create: true });
  d.put('1.meta.json', JSON.stringify({ id: 1, title: '目前名稱', createdAt: 111, fileType: 'pdf' })).put('1.pdf', 'P1')
   .put('2.meta.json', JSON.stringify({ id: 2, title: '別的書', createdAt: 999, fileType: 'pdf' })).put('2.pdf', 'P2')
   .put('3.pdf', 'P3xx');                                    // 3 的說明檔已拿掉（目前已刪），檔案本體還在
  const hist = [{ id: 1, title: '舊版名稱', createdAt: 111, fileType: 'pdf' },
                { id: 2, title: '舊版的第2本', createdAt: 222, fileType: 'pdf' },
                { id: 3, title: '後來刪掉的', createdAt: 333, fileType: 'pdf', fileSize: 4 }];
  const r = await T._restoreDir(root, 'refbooks', 'refbooks', m => m.fileType, hist);
  const got = Object.fromEntries(DB.refbooks.map(x => [x.id, [x.title, x.blob ? x.blob.size : 0]]));
  assert.deepStrictEqual(got, { 1: ['舊版名稱', 2], 2: ['舊版的第2本', 0], 3: ['後來刪掉的', 4] });
  assert.deepStrictEqual(plain(r.missing), ['舊版的第2本']);
});

(async () => {
  let fail = 0;
  for(const [name, fn] of cases){
    try{ await fn(); console.log('✔ ' + name); }
    catch(e){ fail++; console.log('✘ ' + name + '\n   ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n   ')); }
  }
  console.log(fail ? fail + ' 項失敗' : '全部通過（' + cases.length + ' 項）');
  process.exitCode = fail ? 1 : 0;
})();
