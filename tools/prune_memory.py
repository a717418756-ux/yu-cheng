"""考點記憶庫（v4.74）：刪掉警大二技、警佐班、警正升官等「都沒考過」的記憶庫內容。

用法：
  python -X utf8 tools/prune_memory.py <exam_data.json>
    1. 從題庫取三個考試（考試別＝警大二技／警佐班／升官等，不含「猜題」標籤）每一題的關聯法條，
       寫出 data/memory/_tested.json（考過的「法規全名|條號」、釋字／憲判字號、法規名）。
    2. 重新建置記憶庫（tools/build_data.build_memory，會讀 _tested.json 刪除沒考過的內容），
       並寫出刪除清單 docs/考點記憶庫_刪除清單.md。

判斷規則（不猜）：
  - 法條樹節點、數字、口訣、易錯、閃卡、修法：有法條（或釋字、憲判）參照、而且全部都沒出現在三個考試的關聯法條裡 → 刪除。
  - 沒有任何可判斷的參照（觀念、學理、章節標題）→ 保留（沒有資料可以判斷，不亂刪）。
  - 「考過」有兩種證據：①題目的關聯法條；②題幹、選項、解析文字裡寫到「法規名第N條」「法規名§N」（關聯法條沒標齊的題目也找得到）。
  - 標「新法」的節點（連同底下的子節點）→ 保留並列在清單（剛修法還沒有考古題可以判斷）。
  - 父節點自己沒考過、但底下有考過的子節點 → 保留父節點當架構。
  - 對照表沒有參照欄位 → 不動。
參照解析與 App（js/memory.js parseRefs）同一套規則。
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEM = os.path.join(ROOT, 'data', 'memory')
EXAMS = ['警大二技', '警佐班', '升官等']

# ── 與 js/memory.js 相同的法規簡稱 ──
LAW_ALIAS = {
    '刑法': '中華民國刑法', '刑訴': '刑事訴訟法', '刑訴法': '刑事訴訟法',
    '憲法': '中華民國憲法', '增修': '中華民國憲法增修條文', '憲法增修條文': '中華民國憲法增修條文', '增修條文': '中華民國憲法增修條文',
    '勤務條例': '警察勤務條例', '社維法': '社會秩序維護法', '職權法': '警察職權行使法', '警職法': '警察職權行使法',
    '集遊法': '集會遊行法', '查訪辦法': '治安顧慮人口查訪辦法', '人事條例': '警察人員人事條例', '警械條例': '警械使用條例',
    '通保法': '通訊保障及監察法', '家暴法': '家庭暴力防治法', '道交條例': '道路交通管理處罰條例', '跟騷法': '跟蹤騷擾防制法',
    '施行法': '刑法施行法', '行執法': '行政執行法', '訪查辦法': '警察勤務區訪查辦法',
    '勤指中心作業規定': '警察機關勤務指揮中心作業規定', '勤休要點': '警察機關輪班輪休人員勤休實施要點',
    '訪查作業規定': '警察勤務區訪查作業規定', '設置基準': '警察分駐所派出所設置基準',
    '行程': '行政程序法', '行罰': '行政罰法', '行執': '行政執行法', '行訴': '行政訴訟法', '訴願': '訴願法',
    '國賠': '國家賠償法', '社維': '社會秩序維護法', '警職': '警察職權行使法', '集遊': '集會遊行法', '道交': '道路交通管理處罰條例',
    '公保': '公務人員保障法', '公懲': '公務員懲戒法', '政資': '政府資訊公開法', '跟騷': '跟蹤騷擾防制法', '警械': '警械使用條例',
    '家暴': '家庭暴力防治法', '考績法': '公務人員考績法', '處理辦法': '違反社會秩序維護法案件處理辦法',
    '社維處理辦法': '違反社會秩序維護法案件處理辦法', '警械補償辦法': '警械使用事件補償辦法',
    '調查小組辦法': '警械使用調查小組組織及運作辦法', '遴選第三人辦法': '警察遴選第三人蒐集資料辦法', '勤區訪查辦法': '警察勤務區訪查辦法',
}
LAWLIKE = re.compile(r'(法|律|條例|通則|規則|細則|辦法|綱要|標準|準則|規程|要點|規定|原則|基準)(第[\d一二三四五六七八九十百]+[點條](之\d+)?)?$|釋字|憲判')


def full_law(n):
    n = re.sub(r'[（(].*?[)）]', '', n or '').strip()
    return LAW_ALIAS.get(n, n)


def plain_key(s):
    """釋字、憲判字號統一寫法（「113憲判5」「113年憲判字第5號」→ 113憲判5；「釋字第670號」→ 釋字670）"""
    t = s or ''
    m = re.search(r'釋字\s*(?:第)?\s*(\d+)', t)
    if m:
        return '釋字' + m.group(1)
    m = re.search(r'(\d+)\s*年?\s*憲判\s*字?\s*(?:第)?\s*(\d+)', t)
    if m:
        return m.group(1) + '憲判' + m.group(2)
    return re.sub(r'^司法院|^大法官', '', re.sub(r'[第號\s　]', '', t))


def parse_refs(ref):
    """同 js/memory.js parseRefs：回傳 [{'key':..} 或 {'plain':..} 或 {}]"""
    out, last = [], ''
    for part in re.split(r'[、；;，,]', str(ref or '')):
        p = part.strip()
        if not p:
            continue
        if re.match(r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ①-⑳]', p) and out:
            continue
        m = re.match(r'^(.*?)§\s*(\d+)(?:[-－之](\d+))?', p) or re.match(r'^(.*?)第(\d+)條(?:之(\d+))?', p)
        if m:
            law = full_law(m.group(1)) or last
            if not law:
                out.append({})
                continue
            last = law
            out.append({'key': law + '|' + str(int(m.group(2)) * 1000 + (int(m.group(3)) if m.group(3) else 0)), 'law': law})
            # 範圍「§299～§304」「第8條至第10條」：中間每一條都算
            rg = re.search(r'[～~至到]\s*(?:§\s*|第)?(\d+)', p[m.end():])
            if rg and int(m.group(2)) < int(rg.group(1)) <= int(m.group(2)) + 60:
                for k in range(int(m.group(2)) + 1, int(rg.group(1)) + 1):
                    out.append({'key': law + '|' + str(k * 1000), 'law': law})
            continue
        pt = re.match(r'^(.*?)(第[\d一二三四五六七八九十百]+點.*)$', p)
        if pt and LAWLIKE.search(p):
            out.append({'plain': full_law(pt.group(1)) + pt.group(2), 'law': full_law(pt.group(1))})
            continue
        if LAWLIKE.search(p):
            if re.search(r'釋字|憲判', p):
                out.append({'plain': p})
            else:
                out.append({'plain': full_law(p), 'law': full_law(p), 'whole': True})
        else:
            out.append({})
    return out


CN = {'零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}


def cn2num(t):
    if t.isdigit():
        return int(t)
    n, cur = 0, 0
    for ch in t:
        if ch in CN:
            cur = CN[ch]
        elif ch == '十':
            n += (cur or 1) * 10; cur = 0
        elif ch == '百':
            n += (cur or 1) * 100; cur = 0
        elif ch == '千':
            n += (cur or 1) * 1000; cur = 0
    return n + cur


def text_keys(text, names):
    """題幹、選項、解析裡的「法規名第N條（之M）」「法規名§N（-M）」→ 法規全名|條號"""
    out = set()
    if not text:
        return out
    for m in names.finditer(text):
        law = full_law(m.group(1))
        main, sub = m.group(2) or m.group(4), m.group(3) or m.group(5)
        if not main:
            continue
        out.add(law + '|' + str(cn2num(main) * 1000 + (cn2num(sub) if sub else 0)))
    return out


def tested_from_bank(path):
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from yc_backup_load import load   # 認得 gz1: 壓縮
    d = load(path)
    keys, plains, laws, n = set(), set(), set(), 0
    # 文字比對用的法規名：題庫法規資料庫的全部法規名＋簡稱（長的先比，免得「刑法」吃掉「刑法施行法」）
    names = {l.get('lawName', '') for l in d.get('laws', []) if l.get('lawName')} | set(LAW_ALIAS) | set(LAW_ALIAS.values())
    names = sorted((x for x in names if len(x) >= 2), key=len, reverse=True)
    NUM = '[0-9０-９零〇一二兩三四五六七八九十百千]+'
    rx = re.compile('(' + '|'.join(map(re.escape, names)) + ')(?:\\s*第\\s*(' + NUM + ')\\s*條(?:之\\s*(' + NUM + '))?|\\s*§\\s*(\\d+)(?:[-－之](\\d+))?)')
    textk = set()
    for q in d.get('questions', []):
        if q.get('exam') not in EXAMS or '猜題' in (q.get('tags') or []):
            continue
        refs = q.get('relatedLaws') or []
        if refs:
            n += 1
        opts = q.get('options')
        opts = ' '.join(opts.values() if isinstance(opts, dict) else (opts or []))
        textk |= text_keys(' '.join(str(x or '') for x in (q.get('stem'), q.get('groupStem'), opts, q.get('note'), q.get('answerEs'))), rx)
        for x in refs:
            r = x if isinstance(x, str) else (x or {}).get('ref', '')
            for p in parse_refs(r):
                if p.get('key'):
                    keys.add(p['key']); laws.add(p['law'])
                elif p.get('plain'):
                    plains.add(plain_key(p['plain']))
                    if p.get('law'):
                        laws.add(p['law'])
    only_text = textk - keys
    keys |= textk
    laws |= {k.split('|')[0] for k in textk}
    return {'exams': EXAMS, 'questions_with_refs': n, 'keys': sorted(keys), 'plains': sorted(plains), 'laws': sorted(laws),
            'text_only': len(only_text)}


class Pruner:
    """build_data.build_memory 用：依 _tested.json 刪掉沒考過的內容，記下刪了什麼"""

    def __init__(self, tested):
        self.keys = set(tested['keys']); self.plains = set(tested['plains']); self.laws = set(tested['laws'])
        self.removed, self.kept_new = [], []

    def verdict(self, ref):
        """True＝考過、False＝有參照但都沒考過、None＝沒有可判斷的參照"""
        rs = [p for p in parse_refs(ref) if p.get('key') or p.get('plain')]
        if not rs:
            return None
        for p in rs:
            if p.get('key') and p['key'] in self.keys:
                return True
            if p.get('plain'):
                if plain_key(p['plain']) in self.plains:
                    return True
                if p.get('whole') and p.get('law') in self.laws:   # 整部法規（沒有條號）：那部法規有考過就算
                    return True
        return False

    def tree(self, sid, ch, nodes, path):
        out = []
        for n in nodes or []:
            if n.get('tag') == '新法' and self.verdict(n.get('ref')) is False:
                self.kept_new.append((sid, ch, ' › '.join(path + [n.get('t', '')]), n.get('ref')))
                out.append(n)   # 新法：連同子節點整個保留
                continue
            kids = self.tree(sid, ch, n.get('c'), path + [n.get('t', '')])
            v = self.verdict(n.get('ref'))
            if v is False and not kids:
                if n.get('tag') == '新法':
                    self.kept_new.append((sid, ch, ' › '.join(path + [n.get('t', '')]), n.get('ref')))
                else:
                    self.removed.append((sid, '法條樹', ch + '｜' + ' › '.join(path + [n.get('t', '')]), n.get('ref')))
                    continue
            m = dict(n)
            if 'c' in n:
                m['c'] = kids
                if not kids:
                    m.pop('c')
            out.append(m)
        return out

    def items(self, sid, kind, arr, label):
        out = []
        for x in arr or []:
            if isinstance(x, dict) and self.verdict(x.get('ref')) is False:
                self.removed.append((sid, kind, label(x), x.get('ref')))
                continue
            out.append(x)
        return out

    def subject(self, sid, d):
        d = dict(d)
        chs = []
        for ch in d.get('chapters', []):
            t = self.tree(sid, ch.get('title', ''), ch.get('tree'), [])
            if t:
                chs.append(dict(ch, tree=t))
            else:
                self.removed.append((sid, '整章', ch.get('title', ''), '（整章的條文都沒考過）'))
        d['chapters'] = chs
        d['numbers'] = self.items(sid, '數字', d.get('numbers'), lambda x: x.get('k', ''))
        d['mnemonics'] = self.items(sid, '口訣', d.get('mnemonics'), lambda x: x.get('title', ''))
        d['traps'] = self.items(sid, '易錯', d.get('traps'), lambda x: x.get('title', ''))
        d['cards'] = self.items(sid, '閃卡', d.get('cards'), lambda x: x.get('q', ''))
        d['updates'] = self.items(sid, '修法', d.get('updates'), lambda x: (x.get('date', '') + ' ' + x.get('text', ''))[:60])
        return d

    def report(self, path, tested):
        NAME = {'police': '警察法規', 'constitution': '憲法、法學緒論', 'criminal': '刑法', 'procedure': '刑事訴訟法', 'duty': '警察勤務', 'deadline': '期限時效'}
        L = ['# 考點記憶庫：刪除清單', '',
             '依題庫 ' + '、'.join(tested['exams']) + ' 考古題判斷：關聯法條（' + str(tested['questions_with_refs']) + ' 題有標），'
             '加上題幹、選項、解析文字裡寫到的「法規名第N條」（多找到 ' + str(tested.get('text_only', 0)) + ' 條關聯法條沒標的）。'
             '下列記憶庫內容的參照法條、釋字都沒有在這三個考試出現過，已從資料刪除（`tools/prune_memory.py`）。',
             '要找回原文：git 歷史（v4.73.0 以前的 data/memory/*.min.json），或 Promotion 原始記憶樹。', '']
        cnt = {}
        for sid, kind, _, _ in self.removed:
            cnt.setdefault(sid, {}).setdefault(kind, 0)
            cnt[sid][kind] += 1
        L += ['| 科目 | 刪除 |', '|---|---|']
        for sid in NAME:
            if sid in cnt:
                L.append('| ' + NAME[sid] + ' | ' + '、'.join(k + ' ' + str(v) for k, v in cnt[sid].items()) + ' |')
        L += ['', '## 保留但沒考過的「新法」節點（剛修法，還沒有考古題可以判斷）', '']
        L += ['- ' + NAME.get(s, s) + '｜' + c + '｜' + p + '（' + str(r) + '）' for s, c, p, r in self.kept_new] or ['（無）']
        L += ['', '## 明細', '']
        for sid in NAME:
            rows = [x for x in self.removed if x[0] == sid]
            if not rows:
                continue
            L += ['### ' + NAME[sid], '', '| 類別 | 內容 | 參照 |', '|---|---|---|']
            L += ['| ' + k + ' | ' + str(t).replace('|', '／') + ' | ' + str(r).replace('|', '／') + ' |' for _, k, t, r in rows]
            L.append('')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w', encoding='utf-8').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    t = tested_from_bank(sys.argv[1])
    with open(os.path.join(MEM, '_tested.json'), 'w', encoding='utf-8') as f:
        json.dump(t, f, ensure_ascii=False, separators=(',', ':'))
    print('考過：條文', len(t['keys']), '（其中只在題目文字找到', t['text_only'], '）、釋字憲判等', len(t['plains']), '、法規', len(t['laws']), '（', t['questions_with_refs'], '題有關聯法條）')
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import build_data as b
    b.build_memory(os.path.join(ROOT, '..', 'Promotion', 'data'))
