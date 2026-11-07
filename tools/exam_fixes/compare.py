import json, re, os, glob, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anskey import parse
ROOT = r'C:\Users\宇誠\Desktop\考古題'
DATA = r'C:\Users\宇誠\.claude\uploads\6edb5f7c-7248-4400-a52e-d56428cf9dfd\44ddb6fa-exam_data.json'
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'keys_cache.json')

FAM = {'升官等': ['升官等'], '三等考試': ['特考'], '警佐班': ['警佐班'], '警大二技': ['二技', '二技甄選']}


def year_of(path):
    m = re.search(r'(1\d\d)(?:年|學年|170|160|070|060|三等|警佐|二技|\s|_)', path.replace(ROOT, ''))
    return m.group(1) if m else None


def load_keys():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding='utf8'))
    out = []
    for f in sorted(glob.glob(ROOT + r'\**\*.pdf', recursive=True)):
        b = os.path.basename(f)
        if '~$' in b or not re.search(r'ANS|MOD|答案|解答', b):
            continue
        try:
            blocks = parse(f)
        except Exception as e:
            print('ERR', f, e); continue
        for i, bl in enumerate(blocks):
            out.append({'file': f.replace(ROOT + '\\', ''), 'idx': i, 'year': year_of(f), 'ans': {str(k): v for k, v in bl.items()}})
    json.dump(out, open(CACHE, 'w', encoding='utf8'), ensure_ascii=False)
    return out


def qnum(q):
    n = str(q['num'])
    if '-' in n and q.get('groupOrder'):
        return str(q['groupOrder'])
    return n


def ok_or(v, app):
    ans, _, chi = v.partition('｜')
    a = norm(app)
    return '或' in chi and (ans.startswith(a) or ans.endswith(a))


def norm(a):
    return ''.join(sorted(set(re.sub(r'[^A-E]', '', a or ''))))


def keyval(v):
    """官方答案字串 → (正規化答案, 特殊註記)"""
    ans, _, chi = v.partition('｜')
    special = ''
    if '#' in ans or '＃' in ans:
        special = '一律給分(#)'
    if '或' in chi:
        special = '複數答案(或)'
    return norm(ans), special


if __name__ == '__main__':
    keys = load_keys()
    D = json.load(open(DATA, encoding='utf8'))
    groups = collections.defaultdict(list)
    for q in D['questions']:
        if q['type'] == 'mc':
            groups[(q['exam'], q['year'], q['subject'])].append(q)
    report = []
    for (exam, year, subj), qs in sorted(groups.items()):
        fams = FAM[exam]
        cands = [k for k in keys if k['year'] == year and k['file'].split('\\')[0] in fams]
        best = None
        for k in cands:
            hit = tot = 0
            for q in qs:
                v = k['ans'].get(qnum(q))
                if v is None: continue
                a, sp = keyval(v)
                if not a and not sp: continue
                tot += 1
                hit += (a == norm(q['answer'])) or bool(sp)
            if tot >= max(5, len(qs) * 0.5):
                score = hit / tot
                if not best or score > best[0] or (score == best[0] and tot > best[1]):
                    best = (score, tot, k)
        row = {'exam': exam, 'year': year, 'subj': subj, 'n': len(qs)}
        if not best or best[0] < 0.6:
            row['status'] = 'NOKEY' if not best else 'LOWMATCH %.2f %s' % (best[0], best[2]['file'])
            row['ids'] = [q['id'] for q in qs]
        else:
            k = best[2]
            row['status'] = 'OK %.3f' % best[0]
            row['src'] = k['file'] + '#' + str(k['idx'])
            mism = []
            for q in qs:
                v = k['ans'].get(qnum(q))
                if v is None:
                    mism.append({'id': q['id'], 'num': q['num'], 'app': q['answer'], 'key': None}); continue
                a, sp = keyval(v)
                if (sp or a != norm(q['answer'])) and not ok_or(v, q['answer']):
                    mism.append({'id': q['id'], 'num': q['num'], 'app': q['answer'], 'key': v})
            row['mism'] = mism
        report.append(row)
    json.dump(report, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'compare_report.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    for r in report:
        print(r['exam'], r['year'], r['subj'], r['n'], r['status'], r.get('src', ''), 'mism=%d' % len(r.get('mism', [])) if 'mism' in r else '')
