"""2026-11-09（第二批）：存檔題庫全面複核後的解析修正。答案不動（均已對照官方答案）。

1. 刑法§321 刪除「夜間」的修正日期更正為 108年5月29日（全國法規資料庫沿革：108.5.29 修正公布第320、321條；108.12.25 修正未含第321條）
2. 113 警佐勤務 6、7 題：舊句「故選(A)(D)」改為官方擇一給分說明
3. 原「分析建議答案、非官方答案」的句子：建議答案已與官方答案一致者，改寫為已核對
4. 9 題只有簡短個人筆記的警察法規題：附加完整解題（保留原筆記）

每筆以 noteRep（原句→新句，只在解析含原句時替換）或 noteAdd（附加）表示，由 App「考古題答案更正」套用。
用法：python make_fixes_1109b.py <platform exam_data.json> [輸出修正後備份路徑]"""
import json, sys, os, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
ROUND = '2026-11-09b'

REP = {
    1847: [('108年12月25日修正已刪除「夜間」', '108年5月29日修正已刪除「夜間」')],
    2409: [('108年12月25日修正第321條第1項第1款刪除「夜間」', '108年5月29日修正第321條第1項第1款刪除「夜間」')],
    2595: [('108年5月29日修正第321條提高罰金（題目即考此修正）；108年12月25日再修正刪除「夜間」',
            '108年5月29日修正第321條，提高罰金並刪除「夜間」要件（題目即考此修正）')],
    486: [('108年修正第321條刪除「夜間」要件（⚠公布日待查）', '108年5月29日修正公布第321條，刪除「夜間」要件')],
    308: [('故選(A)(D)。', '官方答案(A)或(D)擇一給分（兩者均為錯誤敘述）。')],
    309: [('故選(B)(C)。', '官方答案(B)或(C)擇一給分（兩者均為錯誤敘述）。')],
}

ADD = {
    5: '解題：依警察法§9①及施行細則§10①，警察命令中央由內政部發布。(A)偶發性及緊急性集會遊行處理原則由內政部訂定發布，屬中央發布之警察命令，(A)正確。'
       '(B)錯：警械種類依警械使用條例之授權定之（舊法由行政院定之，111年10月19日修正後改由內政部定之），非依警察法§9發布之警察命令。'
       '(C)錯：治安顧慮人口查訪作業規定為內政部警政署訂定之行政規則。'
       '(D)錯：沒入物品處分規則係依社會秩序維護法§93Ⅱ授權訂定，非依警察法§9發布之警察命令。',
    6: '解題：本題選錯誤者。(D)錯：依釋字第626號，中央警察大學碩士班招生簡章係對報考者發生規範效力之對外規定（大法官並就其內容進行違憲審查），非「對內」發布之一般性規範，故選(D)。'
       '(A)對：釋字第445號，集遊法§29對不遵從解散及制止命令之首謀者科以刑責，屬立法自由形成範圍。'
       '(B)對：釋字第535號，警察勤務條例已非單純之組織法，實兼有行為法之性質。'
       '(C)對：釋字第535號理由，警察法§2、§9①僅具組織法之劃定職權與管轄事務性質，欠缺行為法之功能。',
    5016: '解題：(A)對：社維法§80②，在公共場所或公眾得出入之場所意圖與人性交易而拉客，處新臺幣3萬元以下罰鍰。'
          '(B)對：§81②意圖媒合性交易而拉客，處3日以下拘留併處1萬元以上5萬元以下罰鍰，情節重大者得加重拘留至5日。'
          '(C)對：§91-1Ⅰ，直轄市、縣（市）政府得因地制宜制定自治條例，規劃得從事性交易之區域及其管理。'
          '(D)錯：依§91-1之自治條例規範，性交易場所應辦理登記「及申請執照」。'
          '(E)錯：媒合性交易之廣告不在法律容許範圍內。',
    5017: '解題：(A)對：警職法§15Ⅰ，查訪目的在防制治安顧慮人口再犯。'
          '(B)對：§15Ⅱ，查訪期間以刑執行完畢或假釋出獄後3年內為限。'
          '(C)對：§15Ⅲ，查訪辦法由內政部定之。'
          '(D)對：治安顧慮人口查訪作業規定由內政部警政署訂定（行政規則）。'
          '(E)錯：查訪辦法§4Ⅰ，由「戶籍地」警察機關每個月實施查訪一次，非實際住居所在地。',
    5020: '解題：警察常年訓練辦法§5，術科訓練以鍛鍊體魄、執勤技能及各種武器射擊技術為主，(A)(B)(E)正確。'
          '(C)執勤要領、(D)專業知識屬§5①學科訓練（陶冶品德修養、專業知識、法令規章及執勤要領）。',
    5024: '解題：社維法§63Ⅰ①無正當理由攜帶具有殺傷力之器械、化學製劑或其他危險物品。'
          '(A)錯：現行法定罰為3日以下拘留或新臺幣3萬元以下罰鍰。'
          '(B)錯：不以已持之要脅他人生命、身體而產生實質危險為必要。'
          '(C)(D)(E)對：實務見解認該器械客觀上具殺傷力，持有行為依當時客觀環境及社會通念已逾通常使用之目的及範疇，即易造成社會秩序不安；「無正當理由」指所持目的與該器械通常使用之目的不同。',
    5025: '解題：「藉端滋擾住戶、工廠、公司行號、公共場所或公眾得出入之場所」規定於社維法§68②，處3日以下拘留或新臺幣1萬2千元以下罰鍰，(D)正確；(E)錯：非§78Ⅰ②（§78係影印、仿製通用紙幣等行為）。'
          '(C)對：實務定義「藉端滋擾」係行為人本於滋擾意圖，以言語、行動等方式藉特定事端擴大發揮，逾越一般社會觀念所容許之合理範圍。'
          '(B)對：除客觀上場所安寧秩序有無遭一定程度破壞外，並應綜合一切情事判斷行為人意圖。'
          '(A)錯：不能僅以言語不悅耳、聲量較大或粗暴逾矩，即認構成藉端滋擾。'
          '（註：法規庫現行§68條文罰鍰仍為新臺幣1萬2千元以下。）',
    5026: '解題：警職法§15Ⅰ①所列為曾犯殺人、強盜、搶奪、放火、妨害性自主、恐嚇取財、擄人勒贖、竊盜、詐欺、妨害自由、組織犯罪之罪，經執行完畢或假釋出獄者，(A)詐欺、(C)竊盜、(E)妨害自由屬之。(B)傷害、(D)侵占不在其列。',
    5027: '解題：(A)錯：扣留規定於警職法第三章「即時強制」，非直接強制。'
          '(B)對：§21，警察對軍器、凶器或其他危險物品，為預防危害之必要，得扣留之。'
          '(C)錯：§22Ⅲ，扣留期間不得逾30日；扣留原因未消失時得延長，延長期間不得逾2個月。'
          '(D)對：§23Ⅰ②，保管、照料或持有所費過鉅或有困難者，得予變賣。'
          '(E)對：§24Ⅱ，扣留之物返還時，得收取扣留及保管費用。',
}

# 「建議答案、非官方」句型 → 已核對（只在句中字母等於目前答案時改寫）
PAT = [
    (re.compile(r'（題庫原無答案，已填入本分析建議答案((?:\([A-E]\))+)，非官方答案）'), '（題庫原無答案；本答案{L}已對照官方答案一致，2026-11 核對）'),
    (re.compile(r'原分析建議答案：((?:\([A-E]\))+)(?=[。；（])'), '官方答案：{L}（已核對）'),
    (re.compile(r'檢核：原答案空白，建議答案((?:\([A-E]\))+)(?=[。；])'), '檢核：原答案空白，已對照官方答案為{L}'),
    (re.compile(r'原題答案空白，建議答案：((?:\([A-E]\))+)。'), '原題答案空白，已對照官方答案為{L}。'),
]


def keyof(q):
    d = {'exam': q['exam'], 'year': str(q['year']), 'subject': q['subject']}
    if q.get('groupId') and '-' in str(q['num']):
        d.update(groupId=q['groupId'], groupOrder=q['groupOrder'])
    else:
        d['num'] = str(q['num'])
    return d


def build(P, verified):
    pq = {q['id']: q for q in P['questions']}
    out = []
    for i, reps in REP.items():
        q = pq[i]
        for a, b in reps:
            assert a in q['note'] or b in q['note'], (i, a)
        out.append(dict(keyof(q), qid=i, noteRep=[{'a': a, 'b': b} for a, b in reps]))
    for i, txt in ADD.items():
        out.append(dict(keyof(q := pq[i]), qid=i, noteAdd='【解題補充 2026-11-09】' + txt))
    n = 0
    for q in P['questions']:
        if q['type'] != 'mc' or q['id'] not in verified:
            continue
        reps = []
        for rx, tpl in PAT:
            for m in rx.finditer(q['note'] or ''):
                if ''.join(sorted(re.findall(r'[A-E]', m.group(1)))) == ''.join(sorted(q['answer'])):
                    reps.append({'a': m.group(0), 'b': tpl.format(L=m.group(1))})
        if reps:
            out.append(dict(keyof(q), qid=q['id'], noteRep=reps)); n += 1
    print('rep', len(REP), 'add', len(ADD), 'reword', n)
    return out


def apply(questions, fixes):
    log = []
    for f in fixes:
        for q in questions:
            if q['exam'] != f['exam'] or str(q['year']) != f['year'] or q['subject'] != f['subject']:
                continue
            if 'groupId' in f:
                if q.get('groupId') != f['groupId'] or q.get('groupOrder') != f['groupOrder']: continue
            elif str(q['num']) != f['num']:
                continue
            for r in f.get('noteRep', []):
                if r['a'] in q['note']:
                    q['note'] = q['note'].replace(r['a'], r['b']); log.append((q['id'], 'rep'))
            if f.get('noteAdd') and f['noteAdd'][:24] not in q['note']:
                q['note'] = (q['note'] + '\n' if q['note'] else '') + f['noteAdd']; log.append((q['id'], 'add'))
    return log


if __name__ == '__main__':
    P = json.load(open(sys.argv[1], encoding='utf8'))
    R = json.load(open(os.path.join(ROOT, 'data', 'exam_research.json'), encoding='utf8'))['items']
    verified = {int(k) for k, v in R.items() if v.get('ok', '').startswith('✔')}
    fx_path = os.path.join(ROOT, 'data', 'exam_fixes.json')
    FX = json.load(open(fx_path, encoding='utf8'))
    FX['fixes'] = [f for f in FX['fixes'] if f.get('round') != ROUND]
    new = build(P, verified)
    for f in new: f['round'] = ROUND
    FX['fixes'] += new
    json.dump(FX, open(fx_path, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
    print('fixes total', len(FX['fixes']))
    if len(sys.argv) > 2:
        log = apply(P['questions'], new)
        print('applied', collections.Counter(l[1] for l in log), 'questions', len({l[0] for l in log}))
        json.dump(P, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False)
        print('re-apply', len(apply(P['questions'], new)))
