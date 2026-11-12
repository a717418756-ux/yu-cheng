"""法規資料庫「新增一筆」（lawNew）寫進 data/exam_fixes.json，手機按「考古題答案更正」→「檢查」就會加入。

每筆的內容放在 tools/exam_fixes/sop/ 的 .txt（App 的 SOP 文字格式：【標題】、□ 步驟、◇ 判斷＋是：/否：、甲 | 乙 表格），
原始 PDF 存在 Desktop\\Y.C\\原始資料庫。資料庫已有同名資料時不新增；若內容仍是先前版本（PREV 的 hash）才換成新版。
用法：python add_laws.py"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')


def h(s):
    x = 0
    for c in (s or ''):
        x = (x * 31 + ord(c)) & 0xFFFFFFFF
    return x


LAWS = [
    dict(file='sop/取締疑似施用毒品後駕車作業程序.txt', round='2026-11-12',
         law=dict(lawName='取締疑似施用毒品後駕車作業程序', category='sop',
                  org='內政部警政署', amendDate='民國115年05月13日',
                  source='警署刑毒緝字第1150006494號函頒定（修正）；警察機關分駐（派出）所常用勤務執行程序彙編（刑事類19）',
                  keywords=['毒駕', '唾液毒品快篩', '不能安全駕駛', '採尿', '鑑定許可書'],
                  relatedLaws=[{'ref': '中華民國刑法§185之3'}, {'ref': '道路交通管理處罰條例§35'},
                               {'ref': '刑事訴訟法§205之2'}, {'ref': '刑事訴訟法§88'}])),
]


if __name__ == '__main__':
    fx_path = os.path.join(ROOT, 'data', 'exam_fixes.json')
    FX = json.load(open(fx_path, encoding='utf8'))
    for it in LAWS:
        law = dict(it['law'])
        law['content'] = open(os.path.join(HERE, it['file']), encoding='utf8').read().strip()
        assert '|' not in law['lawName']
        old = next((f for f in FX['fixes'] if f.get('lawNew', {}).get('lawName') == law['lawName']), None)
        prev = set(old.get('lawHash', [])) | {h(old['lawNew']['content'])} if old else set()
        prev.discard(h(law['content']))
        new = dict(round=it['round'], lawNew=law)
        if prev:
            new['lawHash'] = sorted(prev)
        FX['fixes'] = [f for f in FX['fixes'] if f is not old] + [new]
        print(('更新 ' if old else '新增 ') + law['lawName'], len(law['content']), '字')
    json.dump(FX, open(fx_path, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
