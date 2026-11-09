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
    ('deadline', '期限時效（警法＋行政法）'),   # tools/build_deadline.py 產生 deadline.json
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
            # 複核後的文字修正（Promotion 原檔不動，建置時套用；找不到就報錯，避免修正悄悄失效）
            raw = json.dumps(d, ensure_ascii=False)
            for fx in extras[sid].get('fixes', []):
                n = raw.count(fx['find'])
                if not n:
                    sys.exit(f'{sid} 找不到要修正的文字：{fx["find"]}')
                raw = raw.replace(fx['find'], fx['replace'])
            d = json.loads(raw)
            d['chapters'].extend(extras[sid].get('chapters', []))
            d.setdefault('mnemonics', []).extend(extras[sid].get('mnemonics', []))
            d.setdefault('traps', []).extend(extras[sid].get('traps', []))
            d['source'] = 'Promotion 升官等記憶樹 ' + d.get('updated', '')
            dump(d, os.path.join(MEM, sid + '.min.json'))
        else:
            d = load(os.path.join(MEM, sid + '.json'))
            dump(d, os.path.join(MEM, sid + '.min.json'))
        index.append({'id': sid, 'name': name, **({'audit': True} if d.get('audit') else {})})
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


_NEG = re.compile(r'錯誤|不正確|非屬|不屬|不包括|不適用|何者為非|不符|有誤')
_NUM = re.compile(r'\d|[一二三四五六七八九十百]+[日月年時小人款條項次倍分]|幾')
_CASE = re.compile(r'[甲乙丙丁][男女]?[於因與為向持駕將被在]|某[甲乙人男女]')


def _style(qs):
    n = len(qs) or 1
    pct = lambda r: round(100 * sum(1 for q in qs if r.search(q['stem'] or '')) / n)
    multi = round(100 * sum(1 for q in qs if len(re.sub(r'[^A-E]', '', q.get('answer') or '')) > 1) / n)
    return {'n': len(qs), 'neg': pct(_NEG), 'num': pct(_NUM), 'case': pct(_CASE), 'multi': multi}


def _trend(s, qs):
    """趨勢：出題風格（全期 vs 近3次）、最近兩年才首次出現的條文、警佐班考得多的條文。"""
    recent = set(s.get('recent_years') or [])
    t = {'style': {'all': _style(qs), 'recent': _style([q for q in qs if q['year'] in recent])}}
    arts = s.get('article_ranking') or []
    if arts:
        last = max(s['years'])
        t['newest'] = [{'law': a['law'], 'article': a['article'], 'article_n': a['article_n'], 'count': a['count'],
                        'first': min(int(y) for y in a['by_year']), 'question_ids': a['question_ids']}
                       for a in arts if a.get('by_year') and min(int(y) for y in a['by_year']) >= last - 1][:20]
        z = sorted((a for a in arts if (a.get('other_exams') or {}).get('警佐班')),
                   key=lambda a: -a['other_exams']['警佐班'])[:25]
        t['zuo'] = [{'law': a['law'], 'article': a['article'], 'article_n': a['article_n'],
                     'zuo': a['other_exams']['警佐班'], 'count': a['count'], 'question_ids': a['question_ids']} for a in z]
    return t


def build_predict(pack, zpath=None):
    if zpath and not os.path.exists(zpath):
        print('（找不到警佐班分析檔 ' + zpath + '，略過警佐班資料）')
        zpath = None
    zuo, reasons, xval = _zuo(zpath) if zpath else ({}, {}, {})
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
        o['trend'] = _trend(s, [q for q in pack['questions'] if q['subject'] == s['name']])
        if s['name'] in zuo:
            zr = zuo[s['name']]
            for r in zr['articles']:
                r['text'] = _law_text(r['law'], r['article_n'])
            o['zuo'] = zr
        rs = {ex: reasons.get(ex + '|' + s['name']) for ex in ('警大二技', '警佐班') if reasons.get(ex + '|' + s['name'])}
        if rs:
            o['reasons'] = rs
            o['xval'] = {ex: xval.get(ex + '|' + s['name']) for ex in ('警大二技', '警佐班') if xval.get(ex + '|' + s['name'])}
        subs.append(o)
    meta = {k: pack['meta'][k] for k in ('exam', 'generated_at', 'year_range')}
    if zuo:
        meta['zuo_years'] = [min(min(v['years']) for v in zuo.values()), max(max(v['years']) for v in zuo.values())]
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


_LAWS = {}
_LAW_ALIAS = {'中華民國刑法': '刑法', '憲法': '中華民國憲法', '憲法增修條文': '中華民國憲法增修條文'}


def _law_text(law, n):
    a = _LAWS.get(_LAW_ALIAS.get(law, law), {}).get('a', {})
    key = str(n // 1000) + ('-' + str(n % 1000) if n % 1000 else '')
    return a.get(key, '')


def _art_ref(law, art):
    """('警察法', '16') → 警察法第16條；('刑法', '2-1') → 刑法第2條之1；非條號（如釋字）原樣接上。"""
    if art is None or art == '':
        return law
    m = re.fullmatch(r'(\d+)(?:-(\d+))?', str(art))
    if not m:
        return law + str(art)
    return law + '第' + m.group(1) + '條' + ('之' + m.group(2) if m.group(2) else '')


GUESS = os.path.join(ROOT, 'tools', 'guess')
GUESS_SUBJ = {'const': '憲法、法學緒論', 'police': '警察法規', 'duty': '警察勤務', 'crim': '刑法與刑事訴訟法', 'chi': '國文'}


def _split_refs(ref):
    """「警察法§3、§4、釋字第718號」→ ['警察法第3條', '警察法第4條', '釋字第718號']；沒有條號的學理、作業規定不列。"""
    out, law = [], ''
    for part in re.split(r'[、，,]', ref or ''):
        part = part.strip()
        m = re.match(r'^(.*?)§\s*(\d+)(?:-(\d+))?(?:～§?(\d+))?', part)
        if m:
            law = m.group(1).strip() or law
            out.append(_art_ref(law, m.group(2) + ('-' + m.group(3) if m.group(3) else '')))
            if m.group(4) and not m.group(3):          # §6～§10：區間內每一條都列
                out += [_art_ref(law, str(n)) for n in range(int(m.group(2)) + 1, int(m.group(4)) + 1)]
        elif re.search(r'釋字第\d+號|\d{3}年憲判字第\d+號', part):
            out.append(re.search(r'釋字第\d+號|\d{3}年憲判字第\d+號', part).group(0))
    return out


def _pick_lines(t, ctx, cut):
    """長條文只留和題目最相關的幾行（依兩字詞重疊打分），保持原順序，中間省略處以「…」標示"""
    big = lambda x: {x[i:i + 2] for i in range(len(x) - 1)}
    cb = big(re.sub(r'\s', '', ctx))
    lines = [l for l in t.split('\n') if l.strip()]
    ranked = sorted(range(len(lines)), key=lambda i: -len(big(lines[i]) & cb))
    keep, n = set(), 0
    for i in ranked:
        if n + len(lines[i]) > cut and keep:
            break
        keep.add(i); n += len(lines[i])
    out, prev = [], -1
    for i in sorted(keep):
        if i != prev + 1:
            out.append('…')
        out.append(lines[i]); prev = i
    if prev != len(lines) - 1:
        out.append('…')
    return '\n'.join(out)


def _ref_texts(refs, limit=3, cut=320, ctx=''):
    """['刑法第2條', '刑法第2條之1'] → ['刑法§2：條文…']；法規庫沒有的（作業規定、釋字）略過"""
    if not _LAWS:
        _LAWS.update(load(os.path.join(ROOT, '..', 'Promotion', 'data', 'laws.json'))['laws'])
    out = []
    for r in refs:
        if re.fullmatch(r'釋字第\d+號|\d{3}年憲判字第\d+號', r):     # 大法官解釋、憲法判決：附解釋文／主文
            t = _LAWS.get('大法官解釋及憲法判決', {}).get('a', {}).get(r, '')
            m = re.search(r'(?:解釋文|主文)：\n?(.+?)(?:\n理由|$)', t, re.S)
            if m:
                t = m.group(1).strip()
                out.append(r + '：' + (t if len(t) <= cut else t[:cut] + '…'))
            if len(out) >= limit:
                break
            continue
        m = re.fullmatch(r'(.+?)第(\d+)條(?:之(\d+))?', r)
        if not m:
            continue
        t = _law_text(m.group(1), int(m.group(2)) * 1000 + int(m.group(3) or 0)).strip()
        if t and len(t) > cut and ctx:
            t = _pick_lines(t, ctx, cut)
        if t:
            out.append(m.group(1) + '§' + m.group(2) + ('-' + m.group(3) if m.group(3) else '') + '：' + (t if len(t) <= cut else t[:cut] + '…'))
        if len(out) >= limit:
            break
    return out


def build_variants():
    """tools/guess/*.json（116 年二技＋警佐班猜題：各科猜題 100＋變化題 100）→ 平台題目格式。
    來源檔欄位：k 猜/變、src 母題（變化題）、r 出題理由類別、w 理由說明、t s單選/m多選、q 題幹、o 選項、a 答案、e 詳解、ref 法條。"""
    import glob, hashlib, csv
    out, seen = [], set()
    # GPT 第18輪覆核（最後 77 題的最新等級）：附在詳解後面，提醒尚未全部選項定案
    rv = {}
    rvp = os.path.join(GUESS, 'review18', '05_剩餘77題最新狀態.csv')
    if os.path.exists(rvp):
        for r in csv.DictReader(open(rvp, encoding='utf-8-sig')):
            rv[r['題號']] = r
    fixed = set(load(os.path.join(GUESS, 'review18', 'fixed.json'))) if os.path.exists(os.path.join(GUESS, 'review18', 'fixed.json')) else set()
    for f in sorted(glob.glob(os.path.join(GUESS, '[a-z]*.json'))):
        base = os.path.basename(f)[:-5]
        sub = GUESS_SUBJ[base.split('_')[0]]
        for idx, it in enumerate(load(f)):
            note = it['e'] + '\n【出題理由】' + it['r'] + '：' + it['w']
            if it.get('src'):
                m = re.match(r'(警佐|警大)(\d+)-(\d+)', it['src'])
                note += '\n【母題】' + ({'警佐': '警佐班', '警大': '警大二技'}[m.group(1)] + ' ' + m.group(2) + ' 年第 ' + m.group(3) + ' 題' if m else it['src'])
            gid = it.get('id') or base + '#' + str(idx)
            g = rv.get(gid)
            if g:
                lv = {'R': 'R 核心有官方依據', 'S': 'S 部分佐證', 'U': 'U 缺關鍵正式法源', 'X': 'X 題目設計須修正'}.get(g['最新等級'], g['最新等級'])
                note += '\n【GPT 第' + g['最新輪次'] + '輪覆核】' + lv + '：' + g['本輪結論摘要']
                if gid in fixed:
                    note += '（已依建議修正題目或詳解，2026-11-07）'
                elif g['最新等級'] != 'R':
                    note += '（尚未逐選項核到最新版規定）'
            if gid in seen:
                sys.exit('猜題編號重複：' + gid)
            seen.add(gid)
            laws_ = _split_refs(it.get('ref', ''))
            # 詳解只寫條號（如「§2Ⅲ。」）：補上法規庫條文原文，作答後不用再點開法條
            if len(it['e']) < 40:
                arts = _ref_texts(laws_, ctx=it['q'] + ' ' + it['e'] + ' ' + ' '.join(it['o'][('ABCDE'.index(c))] for c in it['a'] if c in 'ABCDE' and 'ABCDE'.index(c) < len(it['o'])))
                if arts:
                    note = it['e'] + '\n【條文】' + '\n'.join(arts) + note[len(it['e']):]
            h = hashlib.sha1(json.dumps([it['q'], it['o'], it['a'], note, laws_], ensure_ascii=False).encode()).hexdigest()[:12]
            out.append({
                'gid': gid,     # 固定編號（來源檔的 id，寫入後不再變）：已匯入的題目靠它同步更新
                'h': h,         # 內容版本：來源改過才覆蓋已匯入的題目，使用者自己的修改不動
                'subject': sub, 'variant': it['k'] == '變', 'reason': it['r'], 'src': it.get('src', ''),
                'multi': it['t'] == 'm', 'stem': it['q'], 'options': {'ABCDE'[i]: o for i, o in enumerate(it['o'])},
                'answer': it['a'], 'note': note, 'ref': it.get('ref', ''), 'laws': laws_,
                **({'rv': g['最新等級']} if g else {}),
            })
    # 警佐二類 40 題型方向（GPT 2026-11-07）：每題型對到猜題庫的相關題目
    zuo2 = None
    zp = os.path.join(ROOT, 'tools', 'zuo', 'zuo2')
    if os.path.exists(os.path.join(zp, 'curated.json')):
        cur = load(os.path.join(zp, 'curated.json'))
        by_sub = {}
        for r in csv.DictReader(open(os.path.join(zp, '04_警佐二類考題方向40題型.csv'), encoding='utf-8-sig')):
            sub = cur['subj'][r['subject']]
            kw = cur['kw'].get(r['subject'] + '|' + r['rank_in_subject'], '')
            if kw.startswith('@'):        # 「@出題理由」：直接對出題理由（國文題型用）
                hits = [o['gid'] for o in out if o['reason'] == kw[1:]]
            else:
              hits = [o['gid'] for o in out if kw and o['subject'] == sub and
                    re.search(kw, o['stem'] + ' ' + ''.join(o['options'].values()) + ' ' + o['ref'] + ' ' + o['note'].split('\n【出題理由】')[-1])]
            by_sub.setdefault(sub, []).append({'n': int(r['rank_in_subject']), 'p': r['priority'], 't': r['guess_topic'],
                                               'd': r['variant_question_design'], 's': r['support_level'], 'exam': r['subject'], 'g': hits,
                                               **({'x': '國文不做猜題，請練考古題'} if not kw and r['subject'].startswith('國文') and int(r['rank_in_subject']) <= 5 else {})})
        zuo2 = {'date': '2026-11-07', 'format': cur['format'], 'scoring': cur['scoring'], 'eligibility': cur['eligibility'], 'subjects': by_sub}
    # 改寫過題幹的舊版題目：使用者若已匯入，同步時刪除
    retired = load(os.path.join(GUESS, '_retired.json')) if os.path.exists(os.path.join(GUESS, '_retired.json')) else []
    dump({'title': '116 年警大二技・警佐班（佐二類）猜題庫', 'version': '2026-11-07',
          'review': {'round': 18, 'date': '2026-11-07', 'counts': {k: sum(1 for r in rv.values() if r['最新等級'] == k) for k in 'RSUX'},
                     'fixed': sorted(fixed),
                     'claude': {'date': '2026-11-07', 'checked': 800, 'fixed': ['const_v1#22', 'crim_g1#28'], 'added': sum(1 for o in out if '_z1#' in o['gid'])}} if rv else None,
          'zuo2': zuo2, 'items': out, 'retired': retired}, os.path.join(ROOT, 'data', 'variants.json'))


def _zuo(zpath):
    """警佐班分析（tools/zuo/zuo_analysis.json）→ 各科條文排名、近三年出題理由回測、交互驗證。"""
    z = load(zpath)
    by = {}
    for q in z['questions']:
        by.setdefault(q['s'], []).append(q)
    res = {}
    for sub, qs in by.items():
        years = sorted({q['y'] for q in qs})
        recent = years[-3:]
        cnt = {}
        for q in qs:
            for a in q['a']:
                c = cnt.setdefault(a, {'count': 0, 'recent_count': 0, 'by_year': {}, 'keys': []})
                c['count'] += 1
                c['recent_count'] += q['y'] in recent
                c['by_year'][str(q['y'])] = c['by_year'].get(str(q['y']), 0) + 1
                c['keys'].append(str(q['y']) + '-' + str(q['n']))
        rows = []
        for a, c in cnt.items():
            m = re.match(r'(.+?)第(\d+)條(?:之(\d+))?$', a)
            if not m:
                continue
            rows.append(dict(law=m.group(1), article='第' + m.group(2) + '條' + ('之' + m.group(3) if m.group(3) else ''),
                             article_n=int(m.group(2)) * 1000 + int(m.group(3) or 0), last_year=max(int(k.split('-')[0]) for k in c['keys']), **c))
        rows.sort(key=lambda r: (-r['count'], -r['recent_count'], r['law'], r['article_n']))
        for i, r in enumerate(rows[:120]):
            r['rank'] = i + 1
        res[sub] = {'question_count': len(qs), 'years': years, 'recent_years': recent, 'articles': rows[:120]}
    return res, z['reasons'], z['xval']


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--promotion', required=True, help='Promotion/data 資料夾')
    ap.add_argument('--pack', required=True, help='預測資料包 JSON')
    ap.add_argument('--zuo', default=os.path.join(ROOT, 'tools', 'zuo', 'zuo_analysis.json'), help='警佐班分析（排名、出題理由回測、交互驗證）')
    a = ap.parse_args()
    _LAWS.update(load(os.path.join(a.promotion, 'laws.json'))['laws'])
    build_memory(a.promotion)
    build_variants()
    pack = load(a.pack)
    if pack['meta'].get('schema_version') != '2':
        sys.exit('預測資料包格式版本不符（需要 schema_version 2）')
    build_predict(pack, a.zuo)
    build_english(pack)
