"""2026-11-12：GPT「考古題解析覆核」(逐題覆核/exam_data_考古題解析覆核.json) 整合。

GPT 的檔案＝平台備份 exam_data.json，只改了 139 題解析（note）與 4 筆法規（圖片改成文字），答案、作答紀錄都沒動。
Claude 複核後整合規則：
1. 解析以 GPT 新版為主（多數是把「⚠待查」補成有出處的公布／施行日期與條號）。
2. GPT 刪掉、但沒有錯的內容補回來（「不亂刪」）：
   - 「法源（資料庫未收）」行
   - GPT 只寫查核說明、沒逐一解說選項的題目，把舊的選項解說以「原解析（覆核前版本）：」補回
   - 269、284 舊解題保留，只拿掉已被 GPT 以官方更正版否定的「⚠疑答案有誤」那一句
   不補回已證實錯誤的內容（例：97年12月決議的舊見解當現行法、§17Ⅱ→應為§18Ⅲ、平均地權條例§60-3（現行無此條）、
   989「現行法應改為(C)」、1761「受傷人數通報門檻非15人」）。
3. 2687 舊解析「登記報到改列§31」更正為§41、法源改為施測時的§23（全國法規資料庫現行性侵害犯罪防治法：§41 登記報到、§31 為身心治療）。
4. 法規 4 筆：圖片改文字（11-12 第二版：GPT 重排後，Claude 再排成表格，見 law_tables_1112.py）。已對照 GPT 附的原始 PDF/DOC（與舊圖）核對；特種工商業範圍表「播放」依原表改為「播映」。
   只在資料庫裡仍是原本那張圖時才換。

輸出：data/exam_fixes.json 新增 round=2026-11-12（noteNew＋noteHash；lawContent＋lawHash），由 App「考古題答案更正」套用。
用法：python make_fixes_1112.py <平台備份 exam_data.json> <GPT 覆核 json> [輸出修正後備份路徑]"""
import json, sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import law_tables_1112

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
ROUND = '2026-11-12'
OLDTAG = '原解析（覆核前版本）：'


def h(s):
    x = 0
    for c in (s or ''):
        x = (x * 31 + ord(c)) & 0xFFFFFFFF
    return x


# 要補回的舊行：(行開頭, 是否加「原解析」標籤, 要截掉的句子起點)
RESTORE = {
    269: [('解題：', True, '⚠疑答案有誤')],
    284: [('解題：', True, '⚠疑答案有誤'), ('學說／釋字：實務：準強盜', False, None)],
    1761: [('解題：', True, None), ('(B)(C)(D)錯', True, None), ('法源（資料庫未收）', False, None)],
    2150: [('法源（資料庫未收）', False, None)],
    2180: [('解題：', True, None), ('(A)(D)錯', True, None), ('(E)錯', True, None), ('法源（資料庫未收）', False, None)],
    2267: [('解題：', True, None), ('(A)(B)(C)錯', True, None), ('法源（資料庫未收）', False, None)],
    2482: [('解題：', True, None), ('(A)(B)(D)錯', True, None), ('法源（資料庫未收）', False, None)],
    2677: [('(A)(C)錯', True, None), ('(B)錯', True, None)],
    2900: [('解題：', True, None), ('(C)錯', True, None), ('(D)錯', True, None), ('法源（資料庫未收）', False, None)],
    3477: [('(A)(C)(D)錯', True, None), ('法源（資料庫未收）', False, None)],
    4746: [('(A)錯', True, None), ('(C)錯', True, None), ('學說／釋字：', False, None)],
    4776: [('法源（資料庫未收）', False, None)],
    5603: [('(A)錯', True, None), ('(B)錯', True, None), ('(C)錯', True, None), ('法源（資料庫未收）', False, None)],
}
NOTE_REP = {
    2687: [('登記報到改列§31', '登記報到改列§41（§31 為身心治療、輔導或教育）'),
           ('法源（資料庫未收）：性侵害犯罪防治法第31條', '法源（資料庫未收）：性侵害犯罪防治法第23條（109年施測時；112年修正後為第41條）')],
}
LAW_REP = {
    3155: [('播放錄影節目', '播映錄影節目'), ('電影播放以外', '電影播映以外'), ('錄影節目帶播放場業', '錄影節目帶播映場業')],
}


def keyof(q):
    k = dict(exam=q['exam'], year=str(q['year']), subject=q['subject'], num=str(q['num']))
    if q.get('groupId'):
        k.update(groupId=q['groupId'], groupOrder=q.get('groupOrder'))
    return k


def merge(qid, old, new):
    A = old.split('\n')
    B = new.split('\n')
    add = []
    for pre, tag, cut in RESTORE.get(qid, []):
        hit = [l for l in A if l.startswith(pre) and l not in B]
        assert len(hit) == 1, (qid, pre, hit)
        l = hit[0]
        if cut:
            assert cut in l, (qid, cut)
            l = l[:l.index(cut)].rstrip()
        add.append((OLDTAG + l) if tag else l)
    out = '\n'.join(B + add)
    for a, b in NOTE_REP.get(qid, []):
        assert out.count(a) <= 1, (qid, a)   # GPT 新版若已自行更正就不必再換
        out = out.replace(a, b)
    return out


def build(P, G):
    po = {q['id']: q for q in P['questions']}
    fixes, merged = [], {}
    for q in G['questions']:
        o = po[q['id']]
        assert o.get('answer') == q.get('answer'), q['id']
        if (o.get('note') or '') == (q.get('note') or ''):
            continue
        nn = merge(q['id'], o.get('note') or '', q.get('note') or '')
        merged[q['id']] = nn
        old = o.get('note') or ''
        # 手機上若是由 App 套用「官方更正」附加說明，結尾沒有「；2026-11-07 核對」→ 兩種都認
        hs = {h(old), h(old.replace('；2026-11-07 核對）', '）'))}
        fixes.append(dict(keyof(o), qid=q['id'], noteNew=nn, noteHash=sorted(hs)))
    pl = {l['id']: l for l in P['laws']}
    for l in G['laws']:
        o = pl[l['id']]
        if o.get('content') == l.get('content'):
            continue
        assert (o.get('content') or '').startswith('data:image'), l['id']
        c = l['content']
        for a, b in LAW_REP.get(l['id'], []):
            c = c.replace(a, b)   # GPT 新版若已改正就沒有原字串
        c = law_tables_1112.fmt(l['id'], c)   # Claude 表格排版（內容不改，只重排；見 law_tables_1112.py）
        fixes.append(dict(lawName=o['lawName'], lawId=o['id'], lawHash=[h(o['content'])], lawContent=c))
    return fixes, merged


def apply(P, fixes):
    n = 0
    for f in fixes:
        if 'lawContent' in f:
            for l in P['laws']:
                if l['lawName'] == f['lawName'] and h(l['content']) in f['lawHash']:
                    l['content'] = f['lawContent']; n += 1
            continue
        for q in P['questions']:
            if q['exam'] != f['exam'] or str(q['year']) != f['year'] or q['subject'] != f['subject']:
                continue
            if 'groupId' in f:
                if q.get('groupId') != f['groupId'] or q.get('groupOrder') != f['groupOrder']:
                    continue
            elif str(q['num']) != f['num']:
                continue
            if h(q.get('note')) in f['noteHash']:
                q['note'] = f['noteNew']; n += 1
    return n


if __name__ == '__main__':
    P = json.load(open(sys.argv[1], encoding='utf8'))
    G = json.load(open(sys.argv[2], encoding='utf8'))
    new, merged = build(P, G)
    for f in new:
        f['round'] = ROUND
    fx_path = os.path.join(ROOT, 'data', 'exam_fixes.json')
    FX = json.load(open(fx_path, encoding='utf8'))
    # 同一輪重跑（GPT 更新檔案）：手機可能已套用上一版，把上一版的結果與可接受原文也列入可接受的原文
    prev = {(f.get('qid') or ('law', f.get('lawId'))): f for f in FX['fixes'] if f.get('round') == ROUND}
    for f in new:
        p = prev.get(f.get('qid') or ('law', f.get('lawId')))
        if not p:
            continue
        if 'noteNew' in f:
            f['noteHash'] = sorted(set(f['noteHash']) | set(p.get('noteHash', [])) | {h(p['noteNew'])} - {h(f['noteNew'])})
        else:
            old = p.get('lawHash') or [p['lawImgHash']]
            f['lawHash'] = sorted(set(f['lawHash']) | set(old) | {h(p['lawContent'])} - {h(f['lawContent'])})
    FX['fixes'] = [f for f in FX['fixes'] if f.get('round') != ROUND] + new
    FX['date'] = '2026-11-12'
    if '11-12' not in FX['source']:
        FX['source'] += '；11-12 GPT 考古題解析覆核（139 題解析、4 筆法規文字化）經 Claude 對照法規資料庫與原始文件複核'
    json.dump(FX, open(fx_path, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
    print('new fixes', collections.Counter('law' if 'lawContent' in f else 'note' for f in new), 'total', len(FX['fixes']))
    if len(sys.argv) > 3:
        print('applied', apply(P, new), 're-apply', apply(P, new))
        json.dump(P, open(sys.argv[3], 'w', encoding='utf8'), ensure_ascii=False)
