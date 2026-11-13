"""法規資料庫「新增一筆」（lawNew）寫進 data/exam_fixes.json，手機按「考古題答案更正」→「檢查」就會加入。

每筆的內容放在 tools/exam_fixes/sop/ 的 .txt（App 的 SOP 文字格式：【標題】、□ 步驟、◇ 判斷＋是：/否：、甲 | 乙 表格），
原始 PDF 存在 Desktop\\Y.C\\原始資料庫。資料庫已有同名資料時不新增；若內容仍是先前版本（PREV 的 hash）才換成新版。

v4.41 原檔頁面：先跑 import_sop_pdf.py（PDF → 每頁一張圖＋逐字文字，存在 sop/_pages.json），這裡再併進每筆資料：
  pages（每頁圖片的路徑）、pagesText（逐字文字，搜尋用）。App 預設顯示原檔頁面。
  ・LAWS 裡有手動排版的（.txt）：content 維持排版版，App 可切換「原檔／文字排版」
  ・_pages.json 有、LAWS 沒有的：自動建一筆，content 就是逐字文字（不重排、不改寫）
  ・LAWS_META 可替自動建立的補關鍵字、關聯法條、來源
用法：python import_sop_pdf.py && python add_laws.py"""
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


# 自動建立的 SOP（只有 PDF、沒有手動排版）可在這裡補資料：名稱 → dict(keywords=[...], relatedLaws=[...], source='...')
LAWS_META = {}

if __name__ == '__main__':
    fx_path = os.path.join(ROOT, 'data', 'exam_fixes.json')
    FX = json.load(open(fx_path, encoding='utf8'))
    pj = os.path.join(HERE, 'sop', '_pages.json')
    PAGES = json.load(open(pj, encoding='utf8')) if os.path.exists(pj) else {}
    items = list(LAWS)
    for name, pg in PAGES.items():
        if any(it['law']['lawName'] == name for it in LAWS):
            continue
        items.append(dict(file=None, round='', law=dict(dict(
            lawName=name, category='sop', org='內政部警政署', amendDate=pg.get('amendDate', ''),
            source='原檔：' + pg.get('file', '')), **LAWS_META.get(name, {}))))
    for it in items:
        law = dict(it['law'])
        pg = PAGES.get(law['lawName'])
        if pg:
            law['pages'], law['pagesText'] = pg['pages'], pg['pagesText']
        # v4.42：有整理版（import_sop_pdf.py 從原檔切出的「流程圖＋完整作業內容」）就用它；
        #   手動重排的 .txt 會漏字、邏輯會跑掉，只留在 tools 當存檔，不再放進 App
        if pg and pg.get('content'):
            law['content'] = pg['content']
        else:
            law['content'] = open(os.path.join(HERE, it['file']), encoding='utf8').read().strip() if it['file'] else pg['pagesText']
        assert '|' not in law['lawName']
        old = next((f for f in FX['fixes'] if f.get('lawNew', {}).get('lawName') == law['lawName']), None)
        prev = set(old.get('lawHash', [])) | {h(old['lawNew']['content'])} if old else set()
        prev.discard(h(law['content']))
        new = dict(round=it['round'] or (old or {}).get('round', ''), lawNew=law)
        if prev:
            new['lawHash'] = sorted(prev)
        FX['fixes'] = [f for f in FX['fixes'] if f is not old] + [new]
        print(('更新 ' if old else '新增 ') + law['lawName'], len(law['content']), '字', ('＋原檔 %d 頁' % len(law['pages'])) if pg else '')
    json.dump(FX, open(fx_path, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
