"""2026-11-23：題庫稽核（docs/題庫稽核_2026-11-22.md）3 題解析與官方答案矛盾，使用者確認「答案以官方，解析錯誤修改」。

- 答案都不動（都已對照官方答案 ✔）；只整段換解析（noteNew＋noteHash：手機上仍是原解析才換，自己改過的不覆蓋）。
- 4152 二技115 刑法29（誣告罪）：官方 ABD。原解析認 (E)「一狀誣告三人成立三罪」正確 → 改為 (E) 錯。
- 4189 二技115 勤務26（訪查執行基準）：官方 ABC。依法規資料庫《警察勤務區訪查作業規定》第3點末段原文
  「治安、婦幼、交通、安寧秩序」，毒品不在其中 → (E) 錯。
- 5214 警佐114 勤務27（Ratcliffe 4I）：官方 ABE。4I＝Intent、Interpret、Influence、Impact，資訊不是 → (C) 錯。
- 1508、2825 兩題選項重複：使用者對照原卷，原卷就是如此，不改（bank_audit.py 列為已確認）。

用法：python -X utf8 make_fixes_1123.py <平台備份 exam_data.json>
      （只寫 data/exam_fixes.json，不改備份檔）"""
import json, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
ROUND = '2026-11-23'
TAIL = '【解析更正】原解析{x}，與官方答案{a}不符；答案維持官方答案，解析依{b}改寫（2026-11-23 題庫稽核）。'


def h(s):
    x = 0
    for c in (s or ''):
        x = (x * 31 + ord(c)) & 0xFFFFFFFF
    return x


NEW = {
    4152: '\n'.join([
        '解題：依刑法§169Ⅰ，誣告罪須意圖他人受刑事或懲戒處分，向該管公務員誣告；本題(A)(B)(D)正確。',
        '(A)正確：乙未滿14歲，依§18Ⅰ不罰，無從受刑事處分，甲不成立誣告罪。',
        '(B)正確：未指定犯人而向該管公務員誣告犯罪，成立§171Ⅰ未指定犯人誣告罪。',
        '(C)錯：欠債不還屬民事糾紛，非刑事或懲戒處分之事由，不成立誣告罪。',
        '(D)正確：誣告乙吃案（廢弛職務），意圖乙受刑事及懲戒處分，向乙服務之警察機關申告，成立§169Ⅰ。',
        '(E)錯：依官方答案，採誣告罪以保護國家司法權正確行使（國家法益）為主之見解，以一狀誣告數人僅侵害一個國家法益，論以一個誣告罪，非成立3罪（另有見解認兼具個人法益而成立數罪想像競合，本題官方未採）。',
        '學說／釋字：實務：未滿14歲人不受刑事處分，誣告之不成立第169條；誣告罪以國家法益為主，一狀誣告數人僅成立一罪。',
        TAIL.format(x='認(E)正確、選(A)(B)(D)(E)', a='(A)(B)(D)', b='官方答案'),
    ]),
    4189: '\n'.join([
        '解題：依警察勤務區訪查作業規定第3點末段，警察分局應就影響轄區治安、婦幼、交通、安寧秩序等事項，審慎檢討評估，訂定符合地方特性之訪查工作執行基準，陳報警察局核定；警察局彙整各分局執行基準後，統一報警政署備查，故(A)(B)(C)正確。',
        '(D)錯：維安非規定列舉之評估事項。',
        '(E)錯：毒品非規定列舉之評估事項（規定為治安、婦幼、交通、安寧秩序）。',
        TAIL.format(x='把(E)毒品也算正確、寫「(A)(B)(C)(E)正確」', a='(A)(B)(C)', b='規定原文'),
    ]),
    5214: '\n'.join([
        '解題：Ratcliffe（2016）情資導向警政之4I模式為意圖（Intent）、闡釋（Interpret）犯罪環境、影響（Influence）決策者、決策者衝擊（Impact）犯罪環境，故(A)衝擊、(B)影響、(E)闡釋正確。',
        '(C)錯：資訊（Information）非4I要素；4I的另一個I為意圖（Intent）。',
        '(D)錯：事件（Incident）非4I模式要素。',
        '學說／釋字：學理（Ratcliffe 2016）：4I＝意圖（Intent）、闡釋（Interpret）、影響（Influence）、衝擊（Impact）。',
        TAIL.format(x='把(C)資訊也算正確、寫「(A)(B)(C)(E)正確」', a='(A)(B)(E)', b='Ratcliffe 4I 模式'),
    ]),
}
ANS = {4152: 'ABD', 4189: 'ABC', 5214: 'ABE'}

if __name__ == '__main__':
    P = json.load(open(sys.argv[1], encoding='utf8'))
    qs = {q['id']: q for q in P['questions']}
    fx_path = os.path.join(ROOT, 'data', 'exam_fixes.json')
    FX = json.load(open(fx_path, encoding='utf8'))
    FX['fixes'] = [f for f in FX['fixes'] if f.get('round') != ROUND]   # 重跑時換掉同一輪
    for qid, nn in NEW.items():
        q = qs[qid]
        assert q['answer'] == ANS[qid], (qid, q['answer'])
        FX['fixes'].append(dict(exam=q['exam'], year=str(q['year']), subject=q['subject'], num=str(q['num']),
                                qid=qid, noteNew=nn, noteHash=[h(q.get('note') or '')], round=ROUND))
    FX['date'] = ROUND
    add = '；11-23 題庫稽核：3 題解析與官方答案矛盾，依官方答案改寫解析（答案不動）'
    if add not in FX['source']:
        FX['source'] += add
    json.dump(FX, open(fx_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print('exam_fixes.json：本輪', len(NEW), '題，共', len(FX['fixes']), '筆')
