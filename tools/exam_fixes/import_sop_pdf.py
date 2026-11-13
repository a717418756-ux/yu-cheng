"""SOP 原檔匯入：把 PDF 原封不動放進 App（v4.41）。

  原則：不理解、不重排、不改字。畫面＝PDF 每一頁的圖；搜尋用的文字＝程式從 PDF 文字層逐字抽出。
  （以前的做法是讀懂後用 App 的流程語法重打，流程圖的箭頭只能靠解讀，會漏、邏輯會跑掉。）

  來源：Desktop\\Y.C\\原始資料庫\\作業程序SOP\\*.pdf，檔名「正式名稱_民國日期7碼.pdf」
  產出：data/sop/<代碼>/01.png …   每頁一張圖（寬 1400、16 階灰階 PNG，約 0.1–0.2 MB）
        tools/exam_fixes/sop/_pages.json   名稱 → { pages, pagesText, amendDate, file, sha1 }
        tools/exam_fixes/sop/_匯入核對表.md  每份的頁數、每頁字數、沒有文字層的頁（掃描檔）、與舊排版版的差異
  之後跑 add_laws.py 寫進 data/exam_fixes.json。

  用法：python import_sop_pdf.py            （只處理新的或內容有變的 PDF）
        python import_sop_pdf.py --all      （全部重做）
"""
import fitz, glob, hashlib, io, json, os, re, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.abspath(os.path.join(ROOT, '..', '原始資料庫', '作業程序SOP'))
OUT = os.path.join(ROOT, 'data', 'sop')
PAGES_JSON = os.path.join(HERE, 'sop', '_pages.json')
REPORT = os.path.join(HERE, 'sop', '_匯入核對表.md')
WIDTH = 1400
PAGE_MARK = '〔原檔第 %d 頁〕'


def norm(s):
    """比對用：去掉所有空白與換行（PDF 會在行尾斷行，不算內容差異）"""
    return re.sub(r'\s+', '', s or '')


def page_text(pg):
    """逐字抽出一頁的文字：照 PDF 內的順序，只去掉行尾空白與整行空白，不改任何字"""
    lines = [ln.rstrip() for ln in pg.get_text().split('\n')]
    return '\n'.join(ln for ln in lines if ln.strip())


def render(pg, path):
    z = WIDTH / pg.rect.width
    pm = pg.get_pixmap(matrix=fitz.Matrix(z, z), colorspace=fitz.csGRAY)
    im = Image.frombytes('L', (pm.width, pm.height), pm.samples)
    b = io.BytesIO()
    im.quantize(16).save(b, format='PNG', optimize=True)
    open(path, 'wb').write(b.getvalue())
    return len(b.getvalue())


def main():
    redo = '--all' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    db = json.load(open(PAGES_JSON, encoding='utf8')) if os.path.exists(PAGES_JSON) else {}
    rep = ['# SOP 原檔匯入核對表', '',
           '由 `import_sop_pdf.py` 產生。文字是程式從 PDF 文字層逐字抽出，沒有人工改寫。', '',
           '| 名稱 | 版本日期 | 頁數 | 文字字數 | 圖片合計 | 沒有文字層的頁 | 狀態 |', '|---|---|---|---|---|---|---|']
    detail = []
    for pdf in sorted(glob.glob(os.path.join(SRC, '*.pdf'))):
        base = os.path.splitext(os.path.basename(pdf))[0]
        m = re.match(r'^(.*?)_(\d{7})$', base)
        name, ymd = (m.group(1), m.group(2)) if m else (base, '')
        sha = hashlib.sha1(open(pdf, 'rb').read()).hexdigest()
        code = 'sop-' + hashlib.sha1(name.encode('utf8')).hexdigest()[:8]
        old = db.get(name)
        if old and old.get('sha1') == sha and not redo and all(os.path.exists(os.path.join(ROOT, p)) for p in old['pages']):
            total = sum(os.path.getsize(os.path.join(ROOT, p)) for p in old['pages'])
            rep.append('| %s | %s | %d | %d | %.1f MB | %s | 沒有變動 |' % (
                name, ymd, len(old['pages']), len(norm(old['pagesText'])), total / 1048576, '、'.join(map(str, old.get('noText', []))) or '無'))
            continue
        doc = fitz.open(pdf)
        d = os.path.join(OUT, code)
        os.makedirs(d, exist_ok=True)
        for f in glob.glob(os.path.join(d, '*.png')):
            os.remove(f)
        pages, texts, sizes, no_text, per = [], [], 0, [], []
        for i, pg in enumerate(doc, 1):
            fn = '%02d.png' % i
            sizes += render(pg, os.path.join(d, fn))
            pages.append('data/sop/%s/%s' % (code, fn))
            t = page_text(pg)
            # 核對：存進去的文字去掉空白後，必須和 PDF 文字層去掉空白後一字不差
            assert norm(t) == norm(pg.get_text()), '第 %d 頁文字與 PDF 不一致' % i
            n = len(norm(t))
            per.append(n)
            if n < 20:
                no_text.append(i)
            texts.append(PAGE_MARK % i + '\n' + t)
        text = '\n\n'.join(texts)
        amend = '民國%s年%s月%s日' % (ymd[:3], ymd[3:5], ymd[5:]) if ymd else ''
        db[name] = dict(pages=pages, pagesText=text, amendDate=amend, file=os.path.basename(pdf), sha1=sha, noText=no_text)
        rep.append('| %s | %s | %d | %d | %.1f MB | %s | %s |' % (
            name, ymd, len(pages), len(norm(text)) - sum(len(norm(PAGE_MARK % i)) for i in range(1, len(pages) + 1)),
            sizes / 1048576, '、'.join(map(str, no_text)) or '無', '更新' if old else '新增'))
        detail += ['', '## ' + name, '', '每頁字數：' + '、'.join('p%d %d' % (i + 1, n) for i, n in enumerate(per))]
        if no_text:
            detail.append('⚠ 第 ' + '、'.join(map(str, no_text)) + ' 頁沒有文字層（掃描或純圖），畫面照常顯示，但搜尋不到這幾頁的內容。')
        # 與舊的「讀懂後重排」版本比較：PDF 裡有、排版版沒有的文字行
        txt = os.path.join(HERE, 'sop', name + '.txt')
        if os.path.exists(txt):
            fmt = norm(open(txt, encoding='utf8').read())
            miss = [ln for ln in page_text_all(doc) if len(norm(ln)) >= 4 and norm(ln) not in fmt]
            detail += ['', '與舊的文字排版版（`sop/%s.txt`）比較：PDF 共 %d 行文字，其中 %d 行在排版版裡找不到一模一樣的字句（排版版是重新斷句、改寫過的）。前 15 行：' % (
                name, len(page_text_all(doc)), len(miss)), ''] + ['- ' + ln for ln in miss[:15]]
        print(name, len(pages), '頁', '%.1f MB' % (sizes / 1048576))
    json.dump(db, open(PAGES_JSON, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
    open(REPORT, 'w', encoding='utf8', newline='\n').write('\n'.join(rep + detail) + '\n')


def page_text_all(doc):
    return [ln.strip() for pg in doc for ln in pg.get_text().split('\n') if ln.strip()]


if __name__ == '__main__':
    main()
