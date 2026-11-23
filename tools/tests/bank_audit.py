# 題庫內容唯讀稽核：python -X utf8 tools/tests/bank_audit.py <exam_data.json> [輸出.md]
# 只讀不改。列出：答案不在選項、選項重複或空白、同考試同年同科同題號重複、題幹與選項完全相同的重複題、
#   解析寫的正確選項與答案不一致、相關法條指到法規庫裡不存在的條號、各卷題號缺號、沒有解析的題目。
import json, re, sys, collections
src = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else None
D = json.load(open(src, encoding='utf-8-sig'))
Q = D['questions']; LAWS = D.get('laws') or []
art = collections.defaultdict(set)
for l in LAWS: art[l['lawName']].add(l['articleNumber'])
R = collections.defaultdict(list)
def tag(q): return f"ID {q['id']}｜{q['exam']} {q['year']}年 {q['subject']} 第{q['num']}題"
# 使用者已對照原卷、原卷選項就是重複的（2026-11-23 確認）：1508 警佐110刑法5、2825 二技108法規2
DUP_OK = {1508, 2825}
FW = str.maketrans('ＡＢＣＤＥ', 'ABCDE')
for q in Q:
    if q['type'] != 'mc': continue
    opts = q.get('options') or {}
    ans = (q.get('answer') or '').translate(FW).upper()
    if not opts: R['選擇題沒有選項'].append(tag(q)); continue
    if not ans: R['選擇題沒有答案'].append(tag(q))
    bad = [c for c in ans if c not in opts]
    if bad: R['答案不在選項裡'].append(tag(q) + f"｜答案 {ans}，選項 {''.join(sorted(opts))}")
    empty = [k for k, v in opts.items() if not str(v).strip()]
    if empty: R['選項空白'].append(tag(q) + '｜' + ''.join(empty))
    vals = [re.sub(r'\s', '', str(v)) for v in opts.values() if str(v).strip()]
    if len(vals) != len(set(vals)):
        if q['id'] in DUP_OK: R['選項文字重複（已對照原卷，原卷如此）'].append(tag(q))
        else: R['選項文字重複'].append(tag(q))
    # 解析的正確選項：「正確為(B)」「故(C)正確」「(B)(D)正確」；只比單一明確寫法，官方送分／更正題略過
    #   「【解析更正】原解析寫…」是更正說明，引用的是舊解析的寫法，不算
    note = '\n'.join(l for l in (q.get('note') or '').split('\n') if not l.startswith('【解析更正】'))
    if '【官方】' in note or q.get('answerAlt') or q.get('answerFree'): continue
    if '⚠' in note or '檢核' in note: pass   # 解析已自己註明疑義或新舊法並列，不重複列
    else:
        neg = re.search(r'錯誤|不正確|有誤|不適當|非屬|不包括|不屬於|何者非|為非|不得|不符', q['stem'])
        # 解析把哪些選項說成「錯」：行首「(A)(C)錯」；說成正確：「故(A)(B)正確」「正確為(A)」「(A)(B)正確」
        said_wrong = set(re.findall(r'\(([A-E])\)', ''.join(re.findall(r'(?m)^((?:\([A-E]\))+)\s*錯', note))))
        said_ok = set()
        for m in re.finditer(r'(?<!疑)((?:\([A-E]\))+)\s*正確|正確(?:答案)?為\s*((?:\([A-E]\))+)|[，。；]選\s*((?:\([A-E]\))+)', note):
            said_ok |= set(re.findall(r'[A-E]', m.group(1) or m.group(2) or m.group(3)))
        a = set(ans)
        if neg:
            m2 = re.search(r'錯誤(?:者|的)?為\s*((?:\([A-E]\))+)', note)
            if m2 and set(re.findall(r'[A-E]', m2.group(1))) != a:
                R['解析寫的選項和答案不同'].append(tag(q) + f"｜否定題，答案 {ans}，解析寫錯誤者為 {''.join(sorted(re.findall(r'[A-E]', m2.group(1))))}")
        elif (said_wrong & a) or (said_ok - a):
            R['解析寫的選項和答案不同'].append(tag(q) + f"｜答案 {ans}，解析說正確 {''.join(sorted(said_ok)) or '—'}、說錯 {''.join(sorted(said_wrong)) or '—'}")
    if not note.strip(): R['沒有解析'].append(tag(q))
# 重複
key = collections.defaultdict(list)
for q in Q:
    if q['type'] == 'mc' and '-' not in str(q['num']): key[(q['exam'], str(q['year']), q['subject'], q['type'], str(q['num']))].append(q)   # 題組「41-45」共用題號；申論題各卷（如刑法、刑訴兩卷）各自編號，不比
for k, v in key.items():
    if len(v) > 1 and k[3]: R['同考試同年同科同題號重複'].append(' ／ '.join(tag(x) for x in v))
sig = collections.defaultdict(list)
for q in Q:
    s = re.sub(r'\s', '', q['stem']) + '|' + '|'.join(re.sub(r'\s', '', str(v)) for k, v in sorted((q.get('options') or {}).items()))
    if len(q['stem']) > 8: sig[s].append(q)
for v in sig.values():
    if len(v) > 1:
        same_ans = len({x['answer'] for x in v}) == 1
        R['題幹與選項完全相同（不同卷別重出或重複匯入）' + ('' if same_ans else '・答案不一致')].append(' ／ '.join(tag(x) + f"（答 {x['answer']}）" for x in v))
# 缺號（同一卷：考試＋年＋科）
vol = collections.defaultdict(set)
for q in Q:
    m = re.match(r'^(\d+)(?:-(\d+))?$', str(q['num']))
    if m: vol[(q['exam'], str(q['year']), q['subject'], q['type'])].update(range(int(m.group(1)), int(m.group(2) or m.group(1)) + 1))
for k, ns in sorted(vol.items()):
    if k[3] != 'mc': continue
    miss = sorted(set(range(min(ns), max(ns) + 1)) - ns)
    blocks, cur = [], []
    for n in miss:
        if cur and n != cur[-1] + 1: blocks.append(cur); cur = []
        cur.append(n)
    if cur: blocks.append(cur)
    miss = [n for b in blocks if len(b) < 5 for n in b]   # 連續 5 題以上的空段多半是卷別結構（另一科、非選擇題），不列
    if miss: R['選擇題卷內缺號'].append(f'{k[0]} {k[1]}年 {k[2]}：共 {len(ns)} 題，缺 {miss[:12]}{"…" if len(miss) > 12 else ""}')
# 相關法條指到不存在的條號（只檢查法規庫有收的法規）
miss_art = collections.Counter()
for q in Q:
    for r in q.get('relatedLaws') or []:
        m = re.match(r'^(.+?)§(\d+)(?:-(\d+))?', r.get('ref') or '')
        if not m or m.group(1) not in art: continue
        n = int(m.group(2)) * 1000 + int(m.group(3) or 0)
        if n not in art[m.group(1)]: miss_art[(r['ref'].split('Ⅰ')[0], q['id'])] += 1
by_ref = collections.defaultdict(list)
for (ref, qid) in miss_art: by_ref[ref].append(str(qid))
for ref, ids in sorted(by_ref.items(), key=lambda x: -len(x[1])):
    R['相關法條在法規庫找不到這一條'].append(f'{ref}（{len(ids)} 題：ID {"、".join(ids[:8])}{"…" if len(ids) > 8 else ""}）')
lines = [f'# 題庫內容稽核（唯讀）', '', f'來源：`{src}`，題目 {len(Q)} 題、法規條文 {len(LAWS)} 條。本報告只列出疑點，沒有改任何題目或答案。', '']
for k, v in R.items():
    lines += [f'## {k}：{len(v)} 筆', ''] + [f'- {x}' for x in v[:200]] + ([f'- …其餘 {len(v) - 200} 筆略'] if len(v) > 200 else []) + ['']
if not R: lines.append('沒有發現疑點。')
txt = '\n'.join(lines)
if out: open(out, 'w', encoding='utf-8').write(txt)
print('\n'.join(f'{k}: {len(v)}' for k, v in R.items()) or '沒有疑點')
