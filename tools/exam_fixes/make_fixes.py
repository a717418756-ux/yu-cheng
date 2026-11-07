"""考古題官方答案更正（2026-11-07 Claude 對照中央警察大學、考選部官方答案 PDF 及釋疑結果）。
輸出 data/exam_fixes.json（App「設定 → 考古題答案更正」套用），並可直接修正備份檔：
  python make_fixes.py <exam_data.json> [輸出備份路徑]
每筆以 考試別＋年度＋科目＋題號（題組另加 groupId＋groupOrder）對應題目；
答案只在目前答案等於 from 時才改；詳解只在目前詳解等於原文時整段替換，否則在最後附加更正說明。"""
import json, sys, os, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC109 = '中央警察大學109學年度二技試題解答公告版（修正版）及標準答案釋疑結果'
SRC115 = '中央警察大學115年警佐班測驗題解答更正版（115.3.16釋疑會議決議）'

FIX = [
    # (考試, 年, 科目, 題號, 原答案, 新答案, [(詳解原句, 新句), ...], 附加說明, 來源)
    ('警大二技', '109', '警察勤務', '24', 'ABCD', 'ABD',
     [('(A)(B)(C)(D)正確。', '(A)(B)(D)正確。\n(C)錯：規定用詞為「記事人口」，選項寫「記事人員」非該規定之用詞定義（官方釋疑理由）。')],
     '【官方更正】釋疑後答案由(A)(B)(C)(D)更正為(A)(B)(D)。', SRC109),
    ('警大二技', '109', '警察勤務', '29', 'AC', 'C',
     [('(A)(C)正確。', '(C)正確。\n(A)錯：一圖為「警勤區轄境圖」，選項寫「警勤區轄境區」用詞不符（官方釋疑理由）。')],
     '【官方更正】釋疑後答案由(A)(C)更正為(C)。', SRC109),
    ('警大二技', '109', '警察勤務', '30', 'CE', 'ACE',
     [('屬重大竊盜案件，(C)(E)正確。', '屬重大竊盜案件，(A)(C)(E)正確。'),
      ('(A)錯：總值應為50萬元以上。', '(A)對：依警察偵查犯罪手冊第24點，失竊物總值新臺幣100萬元以上之案件屬重大竊盜（官方釋疑理由）。')],
     '【官方更正】釋疑後答案由(C)(E)更正為(A)(C)(E)。', SRC109),
    ('警大二技', '109', '刑法與刑事訴訟法', '23', 'BCD', 'CD',
     [('解題：(B)刑法處罰無形偽造者為§213公務員登載不實、§215業務登載不實；(C)', '解題：(C)'),
      ('故選(B)(C)(D)。', '故選(C)(D)。(B)錯：處罰無形偽造之條文除§213、§215外，尚有§214使公務員登載不實罪，選項漏列（官方釋疑理由）。')],
     '【官方更正】釋疑後答案由(B)(C)(D)更正為(C)(D)。', SRC109),
    ('警佐班', '115', '憲法、法學緒論', '18', 'AB', 'A',
     [('官方答案(A)(B)均給分，(B)依增修§6Ⅰ①本屬考試院職權，應係試題疑義送分，⚠待查。', '官方答案：(A)。')],
     '【官方更正】官方更正版本題答案為(A)，並無(B)均給分。', SRC115),
    ('警佐班', '115', '警察勤務', '26', 'ABCE', 'ABCD',
     [('⚠疑答案有誤：官方答案為(A)(B)(C)(E)，依同規定第2點，(D)屬特殊刑案、(E)屬重大刑案，建議答案為(A)(B)(C)(D)。', '官方答案：釋疑後更正為(A)(B)(C)(D)。')],
     '【官方更正】釋疑後答案由(A)(B)(C)(E)更正為(A)(B)(C)(D)。', SRC115),
]
# 送分／均給分：答案不動，詳解補官方說明
GIVE = [
    ('警大二技', '109', '刑法與刑事訴訟法', '20', '【官方】本題釋疑後「均給分」（答案保留原公告(B)供練習）。', SRC109),
    ('警大二技', '109', '警察勤務', '39', '【官方】本題釋疑後「均給分」（答案保留原公告(A)(B)(C)(E)供練習）。', SRC109),
]
# 題號漏填（題組）：依 groupId＋groupOrder 對應，補題號
NUM = [('升官等', '111', '英文', '111_english_46-50', 47, '46-50'),
       ('升官等', '113', '英文', '113_english_46-50', 50, '46-50')]


def h(s):
    return hashlib.sha1((s or '').encode('utf8')).hexdigest()[:12]


def build(questions):
    by = {}
    for q in questions:
        by.setdefault((q['exam'], q['year'], q['subject'], str(q['num'])), []).append(q)
    out = []
    for ex, y, s, n, old, new, reps, add, src in FIX:
        qs = by.get((ex, y, s, n), [])
        assert len(qs) == 1, (ex, y, s, n, len(qs))
        q = qs[0]
        note = q['note']
        for a, b in reps:
            assert note.count(a) == 1, (n, a)
            note = note.replace(a, b)
        note += '\n' + add + '（' + src + '；2026-11-07 核對）'
        out.append({'exam': ex, 'year': y, 'subject': s, 'num': n, 'from': old, 'answer': new,
                    'noteFrom': h(q['note']), 'note': note, 'noteAdd': add + '（' + src + '）'})
    for ex, y, s, n, add, src in GIVE:
        q = by[(ex, y, s, n)][0]
        out.append({'exam': ex, 'year': y, 'subject': s, 'num': n, 'noteFrom': h(q['note']),
                    'note': q['note'] + '\n' + add, 'noteAdd': add})
    for ex, y, s, gid, go, num in NUM:
        out.append({'exam': ex, 'year': y, 'subject': s, 'groupId': gid, 'groupOrder': go, 'numFrom': '', 'setNum': num})
    return out


def match(q, f):
    if q['exam'] != f['exam'] or q['year'] != f['year'] or q['subject'] != f['subject']:
        return False
    if 'groupId' in f:
        return q.get('groupId') == f['groupId'] and q.get('groupOrder') == f['groupOrder']
    return str(q['num']) == f['num']


def apply(questions, fixes):
    log = []
    for f in fixes:
        for q in questions:
            if not match(q, f):
                continue
            if 'answer' in f and q['answer'] == f['from']:
                q['answer'] = f['answer']; log.append((q['id'], 'answer', f['from'], f['answer']))
            if 'note' in f and not q['note'].endswith(f['noteAdd']) and f['noteAdd'] not in q['note']:
                q['note'] = f['note'] if h(q['note']) == f['noteFrom'] else q['note'] + '\n' + f['noteAdd']
                log.append((q['id'], 'note'))
            if 'setNum' in f and str(q['num']) == f['numFrom']:
                q['num'] = f['setNum']; log.append((q['id'], 'num', f['setNum']))
    return log


if __name__ == '__main__':
    D = json.load(open(sys.argv[1], encoding='utf8'))
    fixes = build(D['questions'])
    json.dump({'date': '2026-11-07', 'source': '中央警察大學、考選部官方答案與釋疑結果', 'fixes': fixes},
              open(os.path.join(HERE, '..', '..', 'data', 'exam_fixes.json'), 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
    print('fixes', len(fixes))
    if len(sys.argv) > 2:
        log = apply(D['questions'], fixes)
        for l in log: print(l)
        json.dump(D, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False)
        print('wrote', sys.argv[2])
