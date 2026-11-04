"""記憶庫內容對照條文：每一筆（樹節點、數字、口訣、易錯、閃卡、對照表）列出引用條文全文，
並自動標出「說明裡的數字在條文裡找不到」的可疑處。輸出 Markdown 供人工或其他 AI 複核。

用法：python3 tools/verify_memory.py --laws ../Promotion/data/laws.json --out 記憶庫內容複核.md [--subjects police,constitution]
"""
import argparse, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALIAS = {'刑法': '刑法', '中華民國刑法': '刑法', '刑訴': '刑事訴訟法', '刑訴法': '刑事訴訟法', '憲法': '中華民國憲法',
         '增修': '中華民國憲法增修條文', '憲法增修條文': '中華民國憲法增修條文', '增修條文': '中華民國憲法增修條文',
         '勤務條例': '警察勤務條例', '社維法': '社會秩序維護法', '職權法': '警察職權行使法', '集遊法': '集會遊行法',
         '查訪辦法': '治安顧慮人口查訪辦法', '人事條例': '警察人員人事條例', '警械條例': '警械使用條例', '施行法': '刑法施行法'}
CN = {'零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}


def cn2int(s):
    """中文數字（至「萬」）→ int；含「分之」時不處理。"""
    total, sec, num = 0, 0, 0
    for ch in s:
        if ch in CN:
            num = CN[ch]
        elif ch == '十':
            sec += (num or 1) * 10; num = 0
        elif ch == '百':
            sec += (num or 1) * 100; num = 0
        elif ch == '千':
            sec += (num or 1) * 1000; num = 0
        elif ch == '萬':
            total += (sec + num) * 10000; sec = num = 0
    return total + sec + num


def nums_in_text(t):
    """條文裡出現的數字（中文數字轉阿拉伯；分數轉「1/2」）。"""
    out = set(re.findall(r'\d+(?:\.\d+)?', t))
    for a, b in re.findall(r'([一二三四五六七八九十]+)分之([一二三四五六七八九十]+)', t):
        out.add(f'{cn2int(b)}/{cn2int(a)}')
    for m in re.findall(r'[零〇一二兩三四五六七八九十百千萬]+', t):
        out.add(str(cn2int(m)))
    return out


def nums_in_claim(t):
    t = re.sub(r'§\s*\d+(?:[-－之]\d+)?[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]*[①-⑩]*', '', t)        # 條號不算
    t = re.sub(r'第\d+(?:條|項|款|號|屆|任|階|題)(?:之\d+)?', '', t)
    t = re.sub(r'釋字?\d+|\d+憲判\d+|\d+年憲判字第\d+號|\d+\.\d+\.\d+', '', t)     # 解釋字號、日期
    t = re.sub(r'[一二三四五六七八九十]等', '', t)
    out = set()
    for a, b in re.findall(r'(\d+)/(\d+)', t):
        out.add(f'{a}/{b}')
    t2 = re.sub(r'\d+/\d+', '', t)
    for n in re.findall(r'\d+(?:\.\d+)?', t2.replace(',', '')):
        out.add(n)
    for m in re.findall(r'(\d+)萬', t2):          # 「3萬」→ 30000，不再單獨比對 3
        out.discard(m)
        out.add(str(int(m) * 10000))
    return out


def parse_refs(ref):
    out, last = [], ''
    for p in re.split(r'[、；;，,]', ref or ''):
        p = p.strip()
        m = re.match(r'^(.*?)§\s*(\d+)(?:[-－之](\d+))?', p) or re.match(r'^(.*?)第(\d+)條(?:之(\d+))?', p)
        if m:
            law = ALIAS.get(m.group(1).strip(), m.group(1).strip()) or last
            last = law
            out.append((law, m.group(2) + ('-' + m.group(3) if m.group(3) else ''), p))
        elif re.search(r'釋字|憲判', p):
            m = re.search(r'釋字第?(\d+)號?', p)
            k = f'釋字第{m.group(1)}號' if m else p.replace('解釋', '')
            m2 = re.match(r'(\d+)年憲判字第(\d+)號', p)
            if m2:
                k = p
            out.append(('大法官解釋及憲法判決', k, p))
        else:
            out.append((ALIAS.get(p, p), None, p))
    return out


def items(d):
    chs = {c['id']: c['title'] for c in d['chapters']}

    def walk(nodes, trail):
        for n in nodes or []:
            t = trail + [n['t']]
            yield ('樹', ' › '.join(t), n.get('d', ''), n.get('ref', ''))
            yield from walk(n.get('c'), t)
    for ch in d['chapters']:
        yield from walk(ch['tree'], [ch['title']])
    for c in d.get('compare', []):
        for r in c['rows']:
            yield ('對照表', c['title'] + ' › ' + r[0], '｜'.join(f'{h}：{v}' for h, v in zip(c['cols'], r[1:])), '')
    for n in d.get('numbers', []):
        yield ('數字', n['k'], n['v'], n.get('ref', ''))
    for m in d.get('mnemonics', []):
        yield ('口訣', m['title'], '口訣：' + m['code'] + '\n項目：' + '；'.join(m['items']) + '\n邏輯：' + m.get('logic', ''), m.get('ref', ''))
    for t in d.get('traps', []):
        yield ('易錯', t['title'], '✗ ' + t['wrong'] + '\n✓ ' + t['right'], t.get('ref', ''))
    for c in d.get('cards', []):
        yield ('閃卡', c['q'], c['a'], c.get('ref', ''))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--laws', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--subjects', default='police,constitution,criminal,procedure,duty')
    ap.add_argument('--kinds', default='', help='只輸出這些類型，如 口訣,易錯（預設全部）')
    a = ap.parse_args()
    L = json.load(open(a.laws, encoding='utf-8'))['laws']
    md, flags_all, stats = [], [], {}
    appendix = {}   # 條文只在附錄列一次
    for sid in a.subjects.split(','):
        d = json.load(open(os.path.join(ROOT, 'data', 'memory', sid + '.min.json'), encoding='utf-8'))
        md.append(f'\n# {d["name"]}\n')
        n_item = n_flag = n_missing = 0
        for kind, title, body, ref in items(d):
            if a.kinds and kind not in a.kinds.split(','):
                continue
            n_item += 1
            refs = parse_refs(ref)
            texts, missing = [], []
            for law, art, label in refs:
                if art is None:
                    continue
                t = (L.get(law) or {}).get('a', {}).get(art)
                if t:
                    texts.append((f'{law} {"第"+art.replace("-","條之")+"條" if law!="大法官解釋及憲法判決" else art}'.replace('條之', '條之', 1), t))
                else:
                    missing.append(label)
            flag = ''
            if texts and body:
                claim = nums_in_claim(body)
                have = set().union(*(nums_in_text(t) for _, t in texts))
                bad = sorted(x for x in claim - have if x not in ('0', '1') and not x.endswith('/1'))
                if bad:
                    flag = '數字在引用條文中找不到：' + '、'.join(bad)
            if missing:
                n_missing += 1
            if flag:
                n_flag += 1
                flags_all.append((d['name'], kind, title, flag))
            md.append(f'\n### [{kind}] {title}\n')
            if body:
                md.append('**內容**：' + body.replace('\n', '  \n') + '\n')
            if ref:
                md.append(f'**引用**：{ref}\n')
            if flag:
                md.append(f'> ⚠️ 自動檢查：{flag}\n')
            if missing:
                md.append(f'> ℹ️ 本地條文庫沒有：{"、".join(missing)}（需另行查證）\n')
            if texts:
                md.append('**對照條文**：' + '、'.join(f'[{h}](#{h.replace(" ", "-")})' for h, _ in texts) + '\n')
                for h, t in texts:
                    appendix.setdefault(h, t)
        stats[d['name']] = (n_item, n_flag, n_missing)
    head = ['# 記憶庫內容複核清單\n',
            '> **給複核者（例如 ChatGPT）的指示**：以下是警察特考（警大二技、升官等）備考 App「記憶庫」的內容。'
            '請逐筆對照所附條文全文與你所知的現行法規、大法官解釋及憲法判決，找出：①與條文不符的數字、期間、款數、機關、要件；'
            '②「得」與「應」、「減輕」與「減輕或免除」等用語錯誤；③口訣項目與條文款次不一致或漏款；④已修法或已失效仍寫成現行。'
            '沒有問題的不必列出。條文全文未附者（中央法規標準法、民法等）請依你所知的現行條文判斷，並註明「依記憶」。\n',
            '每一筆列出：內容、引用、對照條文；條文全文集中在文末附錄（取自平台法規庫匯出與全國法規資料庫轉錄）。',
            '「⚠️ 自動檢查」只比對數字，是否真的有錯請人工判斷；「ℹ️」表示本地沒有該條文（如中央法規標準法、民法），需自行查證。\n',
            '## 請複核者依下列格式回報\n',
            '```\n科目｜類型｜標題｜問題（錯誤／不精確／缺漏）｜正確內容｜依據條文\n```\n',
            '## 統計\n', '| 科目 | 筆數 | 數字可疑 | 缺條文 |', '|---|---|---|---|']
    head += [f'| {k} | {v[0]} | {v[1]} | {v[2]} |' for k, v in stats.items()]
    head += ['\n## 自動檢查可疑清單\n'] + [f'- {s}｜{k}｜{t}｜{f}' for s, k, t, f in flags_all]
    tail = ['\n---\n# 附錄：引用條文全文\n'] + [f'\n### {h}\n\n' + t.replace(chr(10), '  ' + chr(10)) + '\n' for h, t in sorted(appendix.items())]
    open(a.out, 'w', encoding='utf-8').write('\n'.join(head) + '\n' + '\n'.join(md) + '\n'.join(tail))
    print(stats)
    for x in flags_all:
        print(' | '.join(x))


if __name__ == '__main__':
    main()
