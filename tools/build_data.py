"""產生記憶庫、猜題庫、英語考點的靜態資料（data/）。

用法：
  python3 tools/build_data.py --promotion ../Promotion/data --pack 警大二技預測資料包_xxx.json

- 記憶庫：刑法、刑訴、勤務取自 Promotion 記憶樹（criminal/procedure/duty.json），
  合併 data/memory/_extras.json 的口訣與易錯；警察法規、憲法直接維護在 data/memory/。
- 猜題庫：從預測資料包取排名與回測，題目只留 ID（題目本身在平台題庫裡）。
- 英語考點：從預測資料包取英文題目（題幹、選項、答案、題型）。
資料包更新時重跑本程式即可。
"""
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEM = os.path.join(ROOT, 'data', 'memory')

SUBJECTS = [  # 記憶庫顯示順序
    ('police', '警察法規'),
    ('constitution', '憲法、法學緒論'),
    ('criminal', '刑法'),
    ('procedure', '刑事訴訟法'),
    ('duty', '警察勤務'),
]


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def dump(obj, p):
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', os.path.relpath(p, ROOT), os.path.getsize(p) // 1024, 'KB')


def build_memory(promo_dir):
    extras = load(os.path.join(MEM, '_extras.json'))
    index = []
    for sid, name in SUBJECTS:
        if sid in extras:
            d = load(os.path.join(promo_dir, sid + '.json'))
            d.setdefault('mnemonics', []).extend(extras[sid].get('mnemonics', []))
            d.setdefault('traps', []).extend(extras[sid].get('traps', []))
            d['source'] = 'Promotion 升官等記憶樹 ' + d.get('updated', '')
            dump(d, os.path.join(MEM, sid + '.min.json'))
        else:
            d = load(os.path.join(MEM, sid + '.json'))
            dump(d, os.path.join(MEM, sid + '.min.json'))
        index.append({'id': sid, 'name': name})
    dump({'subjects': index}, os.path.join(MEM, 'index.json'))


def _trim_rank(r):
    out = {k: r[k] for k in ('rank', 'law', 'article', 'article_n', 'count', 'recent_count',
                             'last_year', 'by_year', 'question_ids') if k in r}
    if r.get('text'):
        out['text'] = r['text'][:220]
    if r.get('other_exams'):
        out['other'] = r['other_exams']
    return out


def _bt_summary(bt):
    """backtest[題型][層級].summary → {層級: {K: {hit, rand}}}"""
    out = {}
    for _kind, levels in (bt or {}).items():
        for lv, v in levels.items():
            s = v.get('summary', {})
            out[lv] = {k: {'hit': round(s[k]['hit_rate'], 3), 'rand': round(s[k]['random_rate'], 3)} for k in s}
    return out


def build_predict(pack):
    subs = []
    for s in pack['subjects']:
        o = {'name': s['name'], 'status': s['status'], 'years': s.get('years', []),
             'recent_years': s.get('recent_years', []), 'question_count': s.get('question_count', 0)}
        if s.get('article_ranking'):
            o['articles'] = [_trim_rank(r) for r in s['article_ranking'][:120]]
            o['laws'] = [{k: r[k] for k in ('rank', 'law', 'count', 'recent_count', 'last_year', 'by_year') if k in r}
                         for r in s.get('law_ranking', [])[:25]]
            o['backtest'] = _bt_summary(s.get('backtest'))
        if s.get('topic_types'):
            t = s['topic_types']
            o['topics'] = {'overall': t.get('overall'), 'recent': t.get('recent'), 'by_year': t.get('by_year'),
                           'misallocated_rate': (t.get('backtest_summary') or {}).get('misallocated_rate')}
        if s.get('point_rankings'):
            o['points'] = {}
            for kind, pr in s['point_rankings'].items():
                rows = pr.get('ranking') or pr.get('rows') or []
                o['points'][kind] = {
                    'levels': pr.get('levels'), 'backtest': _bt_summary(pr.get('backtest')),
                    'rows': [{k: r[k] for k in ('rank', 'name', 'sub', 'count', 'recent_count', 'last_year', 'question_ids') if k in r}
                             for r in rows[:40]]}
        subs.append(o)
    meta = {k: pack['meta'][k] for k in ('exam', 'generated_at', 'year_range')}
    dump({'meta': meta, 'subjects': subs}, os.path.join(ROOT, 'data', 'predict.json'))


def build_english(pack):
    qs = [q for q in pack['questions'] if q['subject'] == '英文']
    out = []
    for q in qs:
        o = {'id': q['id'], 'y': q['year'], 'n': q['num'], 't': q.get('topic_type', ''),
             's': q['stem'], 'o': q.get('options', {}), 'a': q.get('answer', '')}
        if q.get('groupStem'):
            o['g'] = q['groupStem']
            o['gid'] = q.get('groupId', '')
            o['go'] = q.get('groupOrder', 0)   # 題組內順序；題組題的 n 是整組範圍（如 11-15）
        out.append(o)
    eng = next(s for s in pack['subjects'] if s['name'] == '英文')
    dump({'meta': {'exam': pack['meta']['exam'], 'generated_at': pack['meta']['generated_at']},
          'topics': {k: (eng.get('topic_types') or {}).get(k) for k in ('overall', 'recent')}, 'questions': out},
         os.path.join(ROOT, 'data', 'english_exam.json'))


def _art_ref(law, art):
    """('警察法', '16') → 警察法第16條；('刑法', '2-1') → 刑法第2條之1；非條號（如釋字）原樣接上。"""
    if art is None or art == '':
        return law
    m = re.fullmatch(r'(\d+)(?:-(\d+))?', str(art))
    if not m:
        return law + str(art)
    return law + '第' + m.group(1) + '條' + ('之' + m.group(2) if m.group(2) else '')


def build_variants(promo_dir):
    """Promotion 選擇題猜題（升官等：警察法規、行政法、憲法與法學緒論，原題＋變化題）→ 平台題目格式。"""
    d = load(os.path.join(promo_dir, 'mcq.json'))
    subj = dict(d['subjects'])
    names = {'police': '警察法規', 'admin': '行政法', 'const': '憲法、法學緒論'}
    out = []
    for it in d['items']:
        ans = it['a'] if isinstance(it['a'], list) else [it['a']]
        note = it.get('ex', '')
        if it.get('why'):
            note += '\n【猜題理由】' + it['why']
        out.append({
            'subject': names.get(it['s'], subj.get(it['s'], it['s'])),
            'variant': bool(it.get('v')), 'topic': it.get('topic', ''),
            'stem': it['q'], 'options': {'ABCDE'[i]: o for i, o in enumerate(it['o'])},
            'answer': ''.join(sorted('ABCDE'[i] for i in ans)), 'note': note,
            'laws': [_art_ref(law, art) for law, art in it.get('refs', [])],
        })
    dump({'title': d.get('title', ''), 'version': d.get('version', ''), 'items': out},
         os.path.join(ROOT, 'data', 'variants.json'))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--promotion', required=True, help='Promotion/data 資料夾')
    ap.add_argument('--pack', required=True, help='預測資料包 JSON')
    a = ap.parse_args()
    build_memory(a.promotion)
    build_variants(a.promotion)
    pack = load(a.pack)
    if pack['meta'].get('schema_version') != '2':
        sys.exit('預測資料包格式版本不符（需要 schema_version 2）')
    build_predict(pack)
    build_english(pack)
