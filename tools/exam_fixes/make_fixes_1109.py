"""2026-11-09：整合 GPT exam_research_master.json（V1～V6 累積）並經 Claude 對照官方答案原檔複核。

輸出：
  data/exam_fixes.json   ← 在既有 11-07 更正之後追加本輪更正（答案、可接受答案、送分、解析、關聯法條、題號）
  data/exam_research.json ← 各題查證紀錄（GPT 來源與限制說明＋官方答案核對狀態），App 作答後於解析下方顯示

用法：python make_fixes_1109.py <master.json> <platform exam_data.json> [輸出修正後備份路徑]

官方答案原檔（Claude 已逐張目視核對）：
  108 警佐：中央警察大學108年警佐班…測驗題解答修正版(二)
  112 警佐：中央警察大學112年警佐班…測驗題解答更正版（112.3.23）
  113 警佐：中央警察大學113年警佐班…測驗題解答更正版（113.3.18）
  115 二技：中央警察大學115學年度二技各科試題解答（修正版，115.5.20）
  考選部：114 警察特考三等警察法規、110 升官等法學知識與英文、108 升官等行政法 測驗題標準答案更正
未取得原檔：114 二技英文第10題（依 GPT 蒐集之警大修正版，標示待確認）"""
import json, sys, os, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
DATE = '2026-11-09'

S108 = '中央警察大學108年警佐班測驗題解答修正版(二)'
S112 = '中央警察大學112年警佐班測驗題解答更正版（112.3.23）'
S113 = '中央警察大學113年警佐班測驗題解答更正版（113.3.18釋疑會議決議）'
S115 = '中央警察大學115學年度二技試題解答修正版（115.5.20釋疑會議決議）'
SM114 = '考選部114年警察特考三等警察法規測驗題標準答案更正'
SM110 = '考選部110年升官等考試法學知識與英文測驗題標準答案更正'
SM108 = '考選部108年升官等考試行政法測驗題標準答案更正'
SG114 = '中央警察大學114學年度二技修正版（GPT 蒐集；Claude 未取得原檔，待確認）'


def jsh(s):
    """與 App data.js applyExamFixes 的雜湊相同（x*31+碼位，無號32位元）"""
    x = 0
    for c in (s or ''):
        x = (x * 31 + ord(c)) & 0xFFFFFFFF
    return x


# ── 108 警佐刑法：平台原無官方答案（分析建議），依官方修正版更正 ──
NEW_NOTE = {
    1828: ('A', 'B', ['C'], '官方答案：(B)或(C)均給分（' + S108 + '）。\n'
           '解題：甲以竊盜故意侵入儲貨場，並藏匿於貨物旁伺機下手，官方認已達竊盜之著手（實務採密接行為說：已接近財物，與竊取行為密接），因未得手而成立竊盜未遂；'
           '至於是否另構成§321Ⅰ①侵入建築物之加重竊盜，因命題時該款以「夜間」為要件，且儲貨場是否屬「有人居住之建築物」有爭議，故(B)竊盜未遂、(C)加重竊盜未遂均給分（官方未公布釋疑理由，以上為依答案推論之理由）。\n'
           '(A)錯：官方不採「僅達預備階段」之見解。\n'
           '(D)錯：侵入行為與竊盜未遂不另數罪併罰。\n'
           '（題庫原無答案，原分析建議(A)；' + DATE + ' 依官方修正版更正。）'),
    1846: ('AC', 'ABC', None, '官方答案：(A)(B)(C)（' + S108 + '）。\n'
           '(A)對：§84Ⅱ但書，因保安處分先於刑罰執行者，行刑權時效自保安處分執行完畢之日起算。\n'
           '(B)對：§83Ⅰ追訴權之時效因起訴而停止進行；依法應停止偵查或因犯罪行為人逃匿而通緝，致不能開始或繼續偵查者亦同。選項敘述雖不精確，官方認屬正確。\n'
           '(C)對：§82本刑應加重或減輕者，追訴權時效期間仍依本刑計算。\n'
           '(D)錯：§80Ⅱ犯罪行為有繼續之狀態者，自行為終了之日起算。\n'
           '(E)錯：§80Ⅰ②最重本刑三年以上十年未滿有期徒刑之罪，時效期間為二十年。\n'
           '修法：⚠108年5月29日修正§80Ⅰ①，最重本刑死刑、無期徒刑或10年以上之罪而發生死亡結果者，不適用追訴權時效；與本題選項無涉。\n'
           '（題庫原無答案，原分析建議(A)(C)；' + DATE + ' 依官方修正版更正。）'),
    1847: ('E', 'D', None, '官方答案：(D)（' + S108 + '；官方未公布釋疑理由）。\n'
           '解題：丙、丁依計畫侵入A宅行竊，為共同正犯；乙勸甲入宅行竊而使其生犯意，屬教唆。官方以(D)「丙丁成立加重竊盜之共同正犯，乙成立加重竊盜之教唆犯」為答案。\n'
           '⚠命題時§321Ⅰ①仍以「夜間」侵入住宅為要件，依當時條文日間侵入似僅成立普通竊盜，原解析因此建議(E)；惟官方公告答案為(D)，以官方為準。108年5月29日修正已刪除「夜間」，現行法侵入住宅竊盜不分日夜均屬加重竊盜，(D)與現行法相符。\n'
           '(A)(B)錯：結夥三人以上須在場共同實行，僅共謀而未在場者不計入。\n'
           '(C)錯：乙僅勸誘，屬教唆，非共同正犯。\n'
           '(E)錯：官方認丙、丁成立加重竊盜，非普通竊盜。\n'
           '（題庫原無答案，原分析建議(E)；' + DATE + ' 依官方修正版更正。）'),
    1855: ('BCE', 'BC', None, '官方答案：(B)(C)（' + S108 + '）。\n'
           '解題：命題時刑訴§182所列得拒絕證言之業務人員為醫師、藥師、助產士、宗教師、律師、辯護人、公證人、會計師或其業務上佐理人，(B)助產士、(C)藥師屬之。\n'
           '(A)社工師、(D)醫檢師：未列於§182。\n'
           '(E)心理師：命題時尚未列入§182，故官方答案不含(E)；其後修法已增列「心理師」，依現行法(E)亦屬之（現行法應選(B)(C)(E)）。\n'
           '（題庫原無答案，原分析依現行條文建議(B)(C)(E)；' + DATE + ' 依官方修正版更正。）'),
    1856: ('ADE', 'AE', None, '官方答案：(A)(E)（' + S108 + '）。\n'
           '(A)對：§160，證人之個人意見或推測之詞，以實際經驗為基礎者，得為證據。\n'
           '(E)對：§159之5Ⅱ，當事人等知有不得為證據之情形而未於言詞辯論終結前聲明異議，視為同意。\n'
           '(B)錯：§186Ⅰ①未滿十六歲者不得令其具結，其未經具結之證言並非當然無證據能力。\n'
           '(C)錯：§159之1Ⅱ限於向「檢察官」所為之陳述；向檢察事務官所為者，另依§159之2、§159之3判斷。\n'
           '(D)錯：§159之3④須「經證明具有可信之特別情況，且為證明犯罪事實之存否所必要」，選項僅稱「顯有可信之情況」，要件不完整。\n'
           '（題庫原無答案，原分析建議(A)(D)(E)；' + DATE + ' 依官方修正版更正。）'),
    1860: ('B', 'BC', None, '官方答案：(B)(C)（' + S108 + '）。\n'
           '(B)對：§128Ⅱ②但書，被告或犯罪嫌疑人不明者，搜索票得不予記載，仍可聲請。\n'
           '(C)對：§150Ⅰ僅「當事人及審判中之辯護人」得於搜索或扣押時在場，偵查中辯護人並無在場權。\n'
           '(A)錯：§128Ⅲ搜索票由法官簽名。\n'
           '(D)錯：核發搜索票無須訊問被告（§128Ⅳ核發搜索票之程序不公開）。\n'
           '(E)錯：不符§131急迫要件之無票搜索屬違法搜索，可能成立刑法§307違法搜索罪，不因起出違禁品或丙坦承犯罪而合法。\n'
           '（題庫原無答案，原分析建議(B)；' + DATE + ' 依官方修正版更正。）'),
}

# ── 官方「或」：擇一給分（非複選）→ 單一答案＋可接受答案 ──
OR_FIX = {270: ('BD', 'B', ['D'], S113), 308: ('AD', 'A', ['D'], S113), 309: ('BC', 'B', ['C'], S113),
          5601: ('AB', 'A', ['B'], SM108), 3893: ('AB', 'A', ['B'], SG114), 4223: ('BD', 'B', ['D'], S115)}
# ── 平台答案為官方可接受組合之一 → 補其他可接受答案 ──
ALT = {1832: (['C'], S108), 1820: (['BCDE'], S108), 1770: (['ACD'], S108), 1779: (['AE'], S108),
       1730: (['CD'], S108), 1731: (['BC'], S108), 529: (['CD'], S112), 336: (['ABC'], S113), 342: (['AC'], S113)}
# ── 官方一律給分 ──
FREE = {4380: SM114, 1783: S108, 310: S113, 313: S113, 5535: SM110, 4141: S115, 4172: S115, 4180: S115}

# ── 原解析空白／「測試」→ 補 GPT V6 解析（Claude 已對照平台法規庫條文） ──
FILL = [4, 186, 4989, 4992, 4993, 5019]
# ── 關聯法條：GPT V6 增列（僅追加，不刪原有） ──
LAWS = [4, 186, 4989, 4992, 4993, 5019]

LINKHDR = '【法條來源｜官方法規全文（非逐字法條核證）】'


def letters(s):
    return '(' + ')('.join(s) + ')'


def keyof(q):
    return {'exam': q['exam'], 'year': str(q['year']), 'subject': q['subject'], 'num': str(q['num'])}


def strip_links(note):
    return note.split('\n\n' + LINKHDR)[0].rstrip()


def build(M, P):
    pq = {q['id']: q for q in P['questions']}
    mq = {q['id']: q for q in M['questions']}
    out = []
    for i, (old, new, alt, note) in NEW_NOTE.items():
        q = pq[i]
        assert q['answer'] == old, (i, q['answer'])
        f = dict(keyof(q), qid=i, **{'from': old, 'answer': new, 'noteNew': note, 'noteHash': jsh(q['note']),
                                     'noteAdd': '【官方更正】答案由' + letters(old) + '更正為' + letters(new) + (('或' + letters(alt[0])) if alt else '') + '（' + S108 + '；' + DATE + ' 核對）'})
        if alt: f['alt'] = alt
        out.append(f)
    for i, (old, new, alt, src) in OR_FIX.items():
        q = pq[i]; assert q['answer'] == old, (i, q['answer'])
        out.append(dict(keyof(q), qid=i, **{'from': old, 'answer': new, 'alt': alt,
                    'noteAdd': '【官方】本題官方答案為' + letters(new) + '或' + letters(alt[0]) + '，擇一即給分（非複選）；平台原寫作' + old + '，已改為單選並接受兩種答案（' + src + '；' + DATE + ' 核對）。'}))
    for i, (alt, src) in ALT.items():
        q = pq[i]
        out.append(dict(keyof(q), qid=i, **{'altFor': q['answer'], 'alt': alt,
                    'noteAdd': '【官方】本題官方答案為' + letters(q['answer']) + '或' + letters(alt[0]) + '，兩者均給分（' + src + '；' + DATE + ' 核對）。'}))
    for i, src in FREE.items():
        q = pq[i]
        out.append(dict(keyof(q), qid=i, **{'free': True,
                    'noteAdd': '【官方】本題一律給分（送分）；作答任選皆計為答對，答案' + letters(q['answer']) + '保留供練習參考（' + src + '；' + DATE + ' 核對）。'}))
    for i in FILL:
        q = pq[i]; assert q['note'] in ('', '測試'), (i, q['note'])
        out.append(dict(keyof(q), qid=i, **{'noteNew': strip_links(mq[i]['note']), 'noteHash': jsh(q['note'])}))
    dif = {d['id']: d for d in M['analysis']['preExistingBackupDifferencesOtherThanNote']}
    for i in LAWS:
        q = pq[i]
        have = {(x.get('ref') if isinstance(x, dict) else x) for x in q.get('relatedLaws') or []}
        add = [x['ref'] for x in dif[i]['v6'] if x['ref'] not in have]
        if add:
            out.append(dict(keyof(q), qid=i, addLaws=add))
    out.append({'exam': '警佐班', 'year': '113', 'subject': '國文', 'groupId': '113_Chinese_3-4', 'groupOrder': 4,
                'qid': 350, 'numFrom': '', 'setNum': '3-4'})
    return out


def research(M, P, verified):
    """各題查證紀錄：GPT V1～V6 追加內容（不併入解析），加上官方答案核對狀態"""
    pq = {q['id']: q for q in P['questions']}
    mq = {q['id']: q for q in M['questions']}
    items = {}
    for x in M['analysis']['cumulativeNoteChangeIndex']:
        i = x['id']; b = x['baseNote'] or ''; v = mq[i]['note'] or ''
        if i in FILL:
            s = v[len(strip_links(v)):] if not b or b == '測試' else v[len(b):]
        else:
            s = v[len(b):] if v.startswith(b) else ''
        s = s.strip()
        if s:
            items.setdefault(i, {})['t'] = s
    for i, txt in M['analysis']['lastNineCaseDetails'].items():
        i = int(i)
        miss = re.search(r'\*\*仍缺原件：\*\*(.+)', txt)
        if i in M['inputSnapshot']['unresolvedNoDirectSourceIds']:
            items.setdefault(i, {})['gap'] = '⚠ 尚缺直接原始依據' + ('：' + miss.group(1).strip() if miss else '')
    gpt = {a['id']: a for a in M['analysis']['officialAnswerAudit']}
    for i, q in pq.items():
        if q['type'] != 'mc':
            continue
        if i in verified:
            items.setdefault(i, {})['ok'] = '✔ 已對照官方答案（' + verified[i] + '）'
        elif i in gpt:
            a = gpt[i]
            items.setdefault(i, {})['ok'] = ('✔' if a['sameAsPlatform'] == '是' else '⚠') + ' GPT 對照官方答案：' + a['reportedOfficialAnswer'] + '（' + a['sourceStatus'] + '）'
            if a.get('sourceURL'):
                items[i]['u'] = a['sourceURL']
    for i, it in items.items():
        q = pq[i]
        it['k'] = q['exam'] + '|' + str(q['year']) + '|' + q['subject']
    return {'date': DATE, 'note': 'GPT V1～V6 查證紀錄（法規全文連結不等於逐字核證）＋官方答案核對狀態；Claude 複核後整理，不改動解析本文',
            'items': {str(k): v for k, v in sorted(items.items())}}


def verified_ids(P):
    """Claude 已對照官方答案原檔的題目：11-07 本機答案檔 3,965 題＋本輪 4 份警大、3 份考選部原檔"""
    rep = json.load(open(os.path.join(HERE, 'compare_report.json'), encoding='utf8'))
    G = collections.defaultdict(list)
    for q in P['questions']:
        if q['type'] == 'mc':
            G[(q['exam'], str(q['year']), q['subject'])].append(q['id'])
    v = {}
    for r in rep:
        if r['status'].startswith('OK'):
            for i in G[(r['exam'], r['year'], r['subj'])]:
                v[i] = '本機官方答案檔'
    new = [('警佐班', '108', S108), ('警佐班', '112', S112), ('警佐班', '113', S113), ('警大二技', '115', S115)]
    for (e, y, s), ids in G.items():
        for ne, ny, src in new:
            if e == ne and y == ny:
                for i in ids: v[i] = src
    for e, y, s, src in [('三等考試', '114', '警察法規', SM114), ('升官等', '110', '憲法、法學緒論', SM110), ('升官等', '108', '行政法', SM108)]:
        for i in G[(e, y, s)]: v[i] = src
    return v


def apply(questions, fixes):
    """與 App applyExamFixes 相同邏輯，用於修正備份檔"""
    log = []
    for f in fixes:
        for q in questions:
            if q['exam'] != f['exam'] or str(q['year']) != f['year'] or q['subject'] != f['subject']:
                continue
            if 'groupId' in f:
                if q.get('groupId') != f['groupId'] or q.get('groupOrder') != f['groupOrder']: continue
            elif str(q['num']) != f['num']:
                continue
            if 'answer' in f and q['answer'] == f['from']:
                q['answer'] = f['answer']; log.append((q['id'], 'answer', f['from'], f['answer']))
            if 'alt' in f and q['answer'] == f.get('answer', f.get('altFor')) and q.get('answerAlt') != f['alt']:
                q['answerAlt'] = f['alt']; log.append((q['id'], 'alt', f['alt']))
            if f.get('free') and not q.get('answerFree'):
                q['answerFree'] = True; log.append((q['id'], 'free'))
            if 'noteNew' in f and jsh(q['note']) == f['noteHash']:
                q['note'] = f['noteNew']; log.append((q['id'], 'noteNew'))
            elif f.get('noteAdd') and f['noteAdd'] not in q['note'] and not ('noteNew' in f and q['note'] == f['noteNew']):
                q['note'] = (q['note'] + '\n' if q['note'] else '') + f['noteAdd']; log.append((q['id'], 'noteAdd'))
            if f.get('addLaws'):
                have = {(x.get('ref') if isinstance(x, dict) else x) for x in q.get('relatedLaws') or []}
                add = [r for r in f['addLaws'] if r not in have]
                if add:
                    q['relatedLaws'] = (q.get('relatedLaws') or []) + [{'ref': r} for r in add]; log.append((q['id'], 'laws', add))
            if 'setNum' in f and str(q['num']) == f['numFrom']:
                q['num'] = f['setNum']; log.append((q['id'], 'num', f['setNum']))
    return log


if __name__ == '__main__':
    M = json.load(open(sys.argv[1], encoding='utf8'))
    P = json.load(open(sys.argv[2], encoding='utf8'))
    fx_path = os.path.join(ROOT, 'data', 'exam_fixes.json')
    FX = json.load(open(fx_path, encoding='utf8'))
    FX['fixes'] = [f for f in FX['fixes'] if f.get('round') != DATE]
    new = build(M, P)
    for f in new: f['round'] = DATE
    FX['fixes'] += new
    FX['date'] = DATE
    FX['source'] = '中央警察大學、考選部官方答案與釋疑結果（11-07 本機答案檔；11-09 GPT 研究主檔差異經 Claude 對照官方原檔複核）'
    json.dump(FX, open(fx_path, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
    print('fixes total', len(FX['fixes']), 'new', len(new))
    R = research(M, P, verified_ids(P))
    json.dump(R, open(os.path.join(ROOT, 'data', 'exam_research.json'), 'w', encoding='utf8', newline='\n'), ensure_ascii=False, separators=(',', ':'))
    c = collections.Counter(k for v in R['items'].values() for k in v if k != 'k')
    print('research items', len(R['items']), dict(c))
    if len(sys.argv) > 3:
        log = apply(P['questions'], new)
        print('applied', len(log)); print(collections.Counter(l[1] for l in log))
        json.dump(P, open(sys.argv[3], 'w', encoding='utf8'), ensure_ascii=False)
        log2 = apply(P['questions'], new); print('idempotent re-apply changes:', len(log2))
