# 用法：python tools/tests/predict_refs_check.py data/predict.json ../平台備份/exam_data.json
# 沒有問題時只印 stat；有問題會列出缺題、考試別／科目／年度不符、猜題、法規名對不上等
"""核對 predict.json 每一個題目引用都對得到平台備份題庫的真題（考試、科目、年度、條文）。"""
import json, collections, re, sys
P = json.load(open(sys.argv[1], encoding='utf-8'))
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..')); from yc_backup_load import load as _yc_load  # 也讀壓縮過（gz1:）的備份
D = _yc_load(sys.argv[2])
qs = D['questions']
byid = {str(q['id']): q for q in qs}
byzuo = {}
for q in qs:
    if q['exam'] == '警佐班': byzuo.setdefault((q['subject'], f"{q['year']}-{q['num']}"), []).append(q)
stat = collections.Counter(); bad = collections.defaultdict(list)
def text(q): return q['stem'] + ' ' + ' '.join((q.get('options') or {}).values()) + ' ' + q.get('note','') + ' ' + ' '.join(r.get('ref','') for r in q.get('relatedLaws') or [])
def chk_id(sub, where, qid, years=None, law=None):
    stat['ref'] += 1
    q = byid.get(str(qid))
    if not q: bad['缺題'].append((sub, where, qid)); return
    if q['exam'] != '警大二技': bad['考試別不符'].append((sub, where, qid, q['exam']))
    if q['subject'] != sub: bad['科目不符'].append((sub, where, qid, q['subject']))
    if years is not None and str(q['year']) not in years: bad['年度不符'].append((sub, where, qid, q['year']))
    if 'tags' in q and any('猜' in t for t in q['tags'] or []): bad['猜題'].append((sub, where, qid))
    if law and law.replace('中華民國','')[:2] not in text(q): stat['law_not_in_text'] += 1; bad['法規名不在題目/解析'].append((sub, where, qid))
for s in P['subjects']:
    sub = s['name']
    for a in s.get('articles') or []:
        for qid in a.get('question_ids') or []: chk_id(sub, a['law']+a['article'], qid, set(a.get('by_year',{})), a['law'])
        if len(a.get('question_ids') or []) != a['count']: bad['題數與ID數不符'].append((sub, a['law']+a['article'], a['count'], len(a.get('question_ids') or [])))
    for k, p in (s.get('points') or {}).items():
        for r in p.get('rows') or []:
            for qid in r.get('question_ids') or []: chk_id(sub, k+':'+r['name'], qid)
    t = s.get('trend') or {}
    for x in (t.get('newest') or []) + (t.get('zuo') or []):
        for qid in x.get('question_ids') or []: chk_id(sub, 'trend:'+x['law']+x['article'], qid)
    z = s.get('zuo')
    if z:
        for a in z['articles']:
            for k in a.get('keys') or []:
                stat['zref'] += 1
                m = byzuo.get((sub, k))
                if not m: bad['警佐班缺題'].append((sub, a['law']+a['article'], k)); continue
                if len(m) > 1: bad['警佐班同年題號重複'].append((sub, k, len(m)))
                if k.split('-')[0] not in a.get('by_year', {}): bad['警佐班年度不符'].append((sub, k))
                if a['law'].replace('中華民國','')[:2] not in text(m[0]): bad['警佐班法規名不在題目/解析'].append((sub, a['law']+a['article'], k))
    # 額外文字：predict.json 內是否帶題目本文（自創題）
for s in P['subjects']:
    for key in ('questions', 'guess', 'variants'):
        if key in s: bad['含題目本文欄位'].append((s['name'], key))
print('stat', dict(stat))
for k, v in bad.items():
    print(f'## {k}: {len(v)}')
    for x in v[:15]: print('   ', x)
