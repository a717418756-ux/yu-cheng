import json, os, sys
r = json.load(open(sys.argv[1], encoding='utf8'))
ok = [x for x in r if x['status'].startswith('OK')]
no = [x for x in r if not x['status'].startswith('OK')]
L = ['# 考古題官方答案核對報告（2026-11-07）', '',
     '方法：`anskey.py` 讀取 `Desktop/考古題` 內考選部、中央警察大學答案 PDF（含更正版／釋疑結果），`compare.py` 依「考試別＋年度＋科目＋題號」逐題比對平台題庫答案；不一致者逐張開啟 PDF 目視確認，並對照釋疑結果文件。', '',
     '- 有官方答案可比對：%d 份考卷、%d 題；修正 6 題（見 `make_fixes.py`），其餘一致；「A或C」「送分」類 16 題已目視確認平台答案正確。' % (len(ok), sum(x['n'] for x in ok)),
     '- 本機無官方答案：%d 份考卷、%d 題，已輸出 `Desktop/Y.C/考古題答案待確認_給GPT/*.md` 待核對。' % (len(no), sum(x['n'] for x in no)),
     '- 警佐班 112、113 年答案 PDF 為 0 位元組空檔；升官等偶數年與 107 年英文、三等 114 年警察法規、二技 113～115 年無答案檔。', '',
     '| 考試 | 年度 | 科目 | 題數 | 結果 | 官方答案檔 |', '|---|---|---|---:|---|---|']
for x in r:
    src = os.path.basename(x.get('src', '').replace(chr(92), '/'))
    L.append('| %s | %s | %s | %d | %s | %s |' % (x['exam'], x['year'], x['subj'], x['n'], '一致' if x['status'].startswith('OK') else '無官方答案', src))
open('核對報告.md', 'w', encoding='utf8', newline='\n').write('\n'.join(L) + '\n')
print(len(ok), sum(x['n'] for x in ok), len(no), sum(x['n'] for x in no))
