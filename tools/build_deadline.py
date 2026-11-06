"""記憶庫「期限時效（警法＋行政法）」建置。

來源（tools/deadline/）：
  總整理.md            Claude 時效期間總整理（逐字取自法規庫條文；已依 GPT 復核更正行訴§106項次、集遊法加註釋字718）
  curated.json         人工整理：易錯（含 GPT 官方抽核 12 項，已與法規庫條文核對）、修法時間軸、口訣、整合規則
  gpt/audit_data.json  GPT 期限時效復核包（1,853 筆期限候選、284 時間考古題、341 修法提醒、500 題官答比對）
  gpt/10_法源查漏.csv、gpt/11_相同期限反查.csv

輸出：
  data/memory/deadline.json         記憶庫科目原稿（再由 build_data.py 產生 deadline.min.json）
  data/memory/deadline_audit.json   GPT 復核包精簡版（App 的「📋 期限總表」「📝 考古對照」分頁讀取）

用法：cd tools && python -X utf8 build_deadline.py && python -X utf8 build_data.py --promotion ../../Promotion/data
"""
import csv, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'deadline')
MEM = os.path.join(ROOT, 'data', 'memory')

CH_NUM = '一二三四五六七八九'


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def dump(o, p, indent=None):
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(o, f, ensure_ascii=False, indent=indent, separators=None if indent else (',', ':'))


def strip_md(s):
    return re.sub(r'\*\*(.+?)\*\*', r'\1', s).strip()


def norm_ref(s):
    """條號欄 → 記憶庫 ref 字串（釋808 → 釋字第808號，讓按鈕可點）。"""
    s = strip_md(s)
    # 括號補充說明：只留其中的條號（「訴願§40（行訴§54同為15日）」→「訴願§40、行訴§54」）
    s = re.sub(r'（[^）]*）', lambda m: ('、' + _refs_in(m.group(0))) if '§' in m.group(0) else '', s)
    s = re.sub(r'釋(\d+)', r'釋字第\1號', s)
    return s.replace('（', '(').replace('）', ')')


# ════════ 總整理.md → 法條樹／對照表／數字／閃卡 ════════
def parse_manuscript():
    lines = open(os.path.join(SRC, '總整理.md'), encoding='utf-8').read().split('\n')
    chapters, compare, numbers, cards = [], [], [], []
    ch = None          # 目前章
    grp = None         # 目前 ### 小節（node）；None 表示直接掛在章底下
    sub_title = ''     # 小節標題（對照表標題用）
    i = 0

    def target():
        return grp['c'] if grp is not None else ch['tree']

    while i < len(lines):
        ln = lines[i]
        m = re.match(r'^## ([一二三四五六七八九])、(.+)$', ln)
        if m:
            ch = {'id': 'd%02d' % (CH_NUM.index(m.group(1)) + 1), 'title': m.group(1) + '、' + m.group(2).strip(), 'tree': []}
            chapters.append(ch); grp = None; sub_title = ch['title']; i += 1; continue
        if ln.startswith('## ') or ln.startswith('# '):
            ch = None if not ln.startswith('## 〇') else None
            if ln.startswith('## 附錄'):
                break
            i += 1; continue
        if ch is None:
            i += 1; continue
        m = re.match(r'^### (.+)$', ln)
        if m:
            grp = {'t': m.group(1).strip(), 'c': []}
            ch['tree'].append(grp); sub_title = grp['t']; i += 1; continue
        # 粗體段落標題：「**社維法處罰種類數字（§19）**」或「**X**：說明」
        m = re.match(r'^\*\*(.+?)\*\*(：(.+))?$', ln.strip())
        if m and not ln.startswith('|'):
            if m.group(3):
                target().append({'t': m.group(1), 'd': strip_md(m.group(3))})
            else:
                node = {'t': m.group(1), 'c': []}
                ch['tree'].append(node) if grp is None else grp['c'].append(node)
                grp = node; sub_title = m.group(1)
            i += 1; continue
        # 表格
        if ln.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.match(r'^-+$', c) for c in cells):
                    rows.append(cells)
                i += 1
            head, body = rows[0], rows[1:]
            ref_col = next((k for k, h in enumerate(head) if h in ('條號', '條文')), None)
            for r in body:
                r = r + [''] * (len(head) - len(r))
                node = {'t': strip_md(r[0])}
                if r[0].startswith('**'):
                    node['tag'] = '必考'
                if '【講義舊法】' in ''.join(r):
                    node['tag'] = '易錯'
                parts = []
                for k in range(1, len(head)):
                    if k == ref_col or not r[k] or r[k] == '—':
                        continue
                    parts.append((head[k] + '：' if len(head) > 2 else '') + strip_md(r[k]))
                if parts:
                    node['d'] = '\n'.join(parts)
                if ref_col is not None and r[ref_col] and ref_col != 0:
                    node['ref'] = norm_ref(r[ref_col])
                elif ref_col == 0:
                    node['ref'] = norm_ref(r[0])
                target().append(node)
                # 數字速記：有「期間／上限」欄＋條號欄
                pc = next((k for k, h in enumerate(head) if h in ('期間', '上限')), None)
                if pc is not None and ref_col is not None and r[pc] and r[pc] != '—' and len(strip_md(r[pc])) <= 60:
                    numbers.append({'k': strip_md(r[0]), 'v': strip_md(r[pc]), 'ref': norm_ref(r[ref_col])})
            if len(head) - (1 if ref_col not in (None, 0) else 0) >= 3 and ch['id'] != 'd07':
                compare.append({'ch': ch['id'], 'title': sub_title,
                                'cols': [strip_md(h) for h in head[1:]],
                                'rows': [[strip_md(c) for c in (r + [''] * (len(head) - len(r)))] for r in body]})
            elif ch['id'] == 'd07':   # 卡6 回復原狀、卡10 金額門檻：表格卡
                compare.append({'ch': ch['id'], 'title': sub_title, 'cols': [strip_md(h) for h in head[1:]],
                                'rows': [[strip_md(c) for c in (r + [''] * (len(head) - len(r)))] for r in body]})
                cards.append({'ch': ch['id'], 'q': sub_title + '：逐項說出期間或門檻',
                               'a': '\n'.join('・' + '｜'.join(strip_md(c) for c in r) for r in body)})
            continue
        # 程式碼區塊 → 樹
        if ln.startswith('```'):
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i]); i += 1
            i += 1
            target().extend(parse_flow(block))
            continue
        # 條列
        m = re.match(r'^- (.+)$', ln)
        if m:
            items = []
            while i < len(lines) and lines[i].startswith('- '):
                items.append(strip_md(lines[i][2:])); i += 1
            for it in items:
                n = {'t': it}
                refs = _refs_in(it)
                if refs:
                    n['ref'] = refs
                target().append(n)
            if ch['id'] == 'd07':
                cards.append({'ch': ch['id'], 'q': sub_title + '：有哪些規定？', 'a': '\n'.join('・' + x for x in items)})
            continue
        # 引言：易錯／講義舊法
        m = re.match(r'^> (.+)$', ln)
        if m:
            t = strip_md(m.group(1))
            mm = re.match(r'^(易錯|【講義舊法】)：?(.+)$', t)
            if mm:
                target().append({'t': '易錯提醒' if mm.group(1) == '易錯' else '講義舊法 vs 現行法', 'd': mm.group(2).strip(), 'tag': '易錯'})
            i += 1; continue
        i += 1
    return chapters, compare, numbers, cards


_LAWS_ABBR = '行程|行罰|行執|行訴|國賠|社維|警職|集遊|道交|公保|公懲|政資|訴願|跟騷|警械|提審法|處理辦法|考績法|家暴|勤務條例|行政執行法|行政罰法|警察職權行使法'


def _refs_in(text, last=''):
    """從「（訴願§14Ⅰ）」「行訴§106、§4」之類文字抽出 ref 字串；沒寫法名的用前一個法名。"""
    out = []
    for m in re.finditer(r'(' + _LAWS_ABBR + r'|[一-龥]{2,14}(?:法|條例|辦法|規則|細則))?§\s*(\d+(?:-\d+)?)([ⅠⅡⅢⅣⅤⅥ]*)', text):
        law = re.sub(r'^.*[依見與及和]', '', m.group(1) or '') or last   # 「時效依警職法§31」→ 警職法
        if not law:
            continue
        last = law
        out.append(law + '§' + m.group(2) + m.group(3))
    for m in re.finditer(r'釋字?第?(\d+)號?', text):
        out.append('釋字第' + m.group(1) + '號')
    seen = []
    for r in out:
        if r not in seen:
            seen.append(r)
    return '、'.join(seen)


def parse_flow(block):
    """├─ └─ 縮排流程 → 樹節點。"""
    root = []
    stack = [(-1, {'c': root})]
    last_law = ''
    for raw in block:
        if not raw.strip():
            continue
        m = re.match(r'^([ │]*)(?:[├└]─\s*)?(.*)$', raw)
        depth = len(m.group(1)) // 1
        text = m.group(2).strip()
        if '├─' not in raw and '└─' not in raw and not raw.startswith(' '):
            depth = 0
        else:
            depth = len(m.group(1)) + 1
        lm = re.search(r'(' + _LAWS_ABBR + r')§', text)
        if lm:
            last_law = lm.group(1)
        node = {'t': text}
        refs = _refs_in(text, last_law)
        if refs:
            node['ref'] = refs
        while stack and stack[-1][0] >= depth:
            stack.pop()
        parent = stack[-1][1]
        parent.setdefault('c', []).append(node)
        stack.append((depth, node))
    return root


# ════════ GPT 復核包 → 精簡 JSON ════════
def build_audit():
    a = load(os.path.join(SRC, 'gpt', 'audit_data.json'))
    laws, types, dates = [], [], []

    def ix(arr, v):
        if v not in arr:
            arr.append(v)
        return arr.index(v)

    def qids(s):
        return [int(x) for x in re.findall(r'ID:(\d+)', s or '')]

    pcode = {}
    prio = {r['id'] for r in a['priority_rows']}
    dl = []
    for r in a['deadline_rows']:
        pcode.setdefault(r['法規'], r['官方法規連結'])
        dl.append([
            r['id'], ['警察法規', '行政法', '跨科參照（附錄）'].index(r['科別']), ix(types, r['類型']), ix(laws, r['法規']),
            r['條號'], r['時間文字'], r['法條原句'], ix(dates, r['法庫修正日']), int(r['考古題直接連結數'] or 0),
            int(r['其中時間題數'] or 0), qids(r['考題索引']),
            1 if r['Claude原稿附錄'] == 'Claude附錄有列' else 0,
            1 if r['Claude原稿主文'] == '原稿主文有法條定位' else 0,
            1 if r['官方抽核'].startswith('已核對') else 0,
            r['注意／修法風險'], 1 if r['id'] in prio else 0,
        ])
    tq = []
    for r in a['question_rows']:
        tq.append([r['序號'], 1 if r['優先考試'].startswith('主目標') else 0, r['科目'], r['考試'], r['年度'], r['題號'],
                   int(r['原始題庫ID']), r['題幹'], r['選項時間'], r['原始答案（未覆核）'], r['相關法條'],
                   1 if r['與本地法庫條文有連結'] == '有' else 0, r['原題備註摘錄'], 1 if r['修法或舊題風險'] == '優先複查' else 0,
                   r['官方當年答案'] or '', r['當年標準答案核對']])
    risk = [[1 if r['優先'].startswith('主目標') else 0, r['考試科目'], r['題號'], int(r['ID']), r['題目'], r['原答案'],
             r['原題疑義／修法註記'], r['相關法條']] for r in a['risk_rows']]
    oa = [[r['年度'], r['科目'], int(r['題號']), int(r['原始ID']), r['題目'], r['題庫答案'], r['官方最終答案'],
           r['官方更正註記'] if r['官方更正註記'] != '無該題更正註記' else ''] for r in a['official_answers']]
    links = {}
    for r in a['official_answers']:
        links[r['年度']] = r['來源網址']
    with open(os.path.join(SRC, 'gpt', '11_相同期限反查.csv'), encoding='utf-8-sig') as f:
        same = [[r['時間原文'], int(r['候選出現筆數']), r['相關法條例示']] for r in csv.DictReader(f)]
    with open(os.path.join(SRC, 'gpt', '10_法源查漏.csv'), encoding='utf-8-sig') as f:
        src = [[r['法源'], int(r['兩科題庫引用次數']), 1 if r['已否抽出時間句'].startswith('已在') else 0,
                0 if r['法源類型'].startswith('釋字') else 1] for r in csv.DictReader(f)]
    return {
        'date': a['metrics']['日期'], 'metrics': a['metrics'], 'exam_links': links,
        'laws': laws, 'types': types, 'dates': dates, 'pcode': pcode,
        'dl': dl, 'tq': tq, 'risk': risk, 'oa': oa, 'same': same, 'src': src,
    }


def main():
    cur = load(os.path.join(SRC, 'curated.json'))
    chapters, compare, numbers, cards = parse_manuscript()
    # GPT 官方抽核易錯表（已與法規庫條文核對）→ 另成一章＋對照表＋閃卡
    g = cur['gpt_check']
    chapters.insert(0, {'id': 'd00', 'title': '〇、GPT 官方抽核：最易錯的期限（已核對條文）', 'lead': g['lead'],
                        'tree': [{'t': x['law'], 'd': x['diff'], 'ref': x['ref'], 'tag': '易錯'} for x in g['items']]})
    compare.insert(0, {'ch': 'd00', 'title': 'GPT 官方抽核：易混期限一覽', 'cols': ['關鍵差異', '核對條文'],
                       'rows': [[x['law'], x['diff'], x['ref']] for x in g['items']]})
    cards = [{'ch': 'd00', 'q': x['law'] + '：關鍵差異是什麼？', 'a': x['diff'], 'ref': x['ref']} for x in g['items']] + cards
    # 記憶圖合併（GPT 建議第7節）→ 章節
    chapters.append({'id': 'd10', 'title': '十、考前記憶圖（GPT 建議的五張合併圖）', 'lead': cur['charts_lead'],
                     'tree': cur['charts']})
    d = {
        'id': 'deadline', 'name': '期限時效（警法＋行政法）', 'updated': cur['updated'], 'intro': cur['intro'],
        'source': cur['source'], 'audit': True,
        'chapters': chapters, 'compare': compare, 'numbers': numbers, 'mnemonics': cur['mnemonics'],
        'traps': cur['traps'], 'cards': cards, 'updates': cur['updates'], 'fixlog': cur['fixlog'],
    }
    dump(d, os.path.join(MEM, 'deadline.json'), indent=1)
    au = build_audit()
    au['notes'] = cur['audit_notes']
    dump(au, os.path.join(MEM, 'deadline_audit.json'))
    n = lambda xs: sum(1 + n(x.get('c', [])) for x in xs)
    print('章', len(chapters), '節點', sum(n(c['tree']) for c in chapters), '對照表', len(compare), '數字', len(numbers),
          '閃卡', len(cards), '易錯', len(cur['traps']), '｜總表', len(au['dl']), '時間題', len(au['tq']),
          '修法提醒', len(au['risk']), '官答', len(au['oa']),
          '｜audit', os.path.getsize(os.path.join(MEM, 'deadline_audit.json')) // 1024, 'KB')


if __name__ == '__main__':
    main()
