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
VER = 3   # 產出格式版本：改了切版規則就加一，舊的會自動重做
PAGE_MARK = '〔原檔第 %d 頁〕'


def norm(s):
    """比對用：去掉所有空白與換行（PDF 會在行尾斷行，不算內容差異）"""
    return re.sub(r'\s+', '', s or '')


def page_text(pg):
    """逐字抽出一頁的文字：照 PDF 內的順序，只去掉行尾空白與整行空白，不改任何字"""
    lines = [ln.rstrip() for ln in pg.get_text().split('\n')]
    return '\n'.join(ln for ln in lines if ln.strip())


def render(pg, path, clip=None):
    z = WIDTH / pg.rect.width
    pm = pg.get_pixmap(matrix=fitz.Matrix(z, z), colorspace=fitz.csGRAY, clip=clip)
    im = Image.frombytes('L', (pm.width, pm.height), pm.samples)
    b = io.BytesIO()
    im.quantize(16).save(b, format='PNG', optimize=True)
    open(path, 'wb').write(b.getvalue())
    return len(b.getvalue())


# ══ 整理版（v4.42）：流程圖和作業內容分開，兩邊都完整 ══════════════════════════
#   警政署 SOP 的版型：左邊「流程」＋「權責人員」，右邊一個長框「作業內容」，同一列擠在 A4 上，手機看不清楚。
#   整理版用程式切開，不經人工改寫：
#     ・右邊長框裡的字 → 逐字抽出，接成完整的「作業內容」文字（跨頁接起來）
#     ・左邊流程＋權責人員 → 原樣裁成一張圖（箭頭、判斷框都是原檔的）
#     ・標題列以上的字（名稱、依據…）、沒有圖的純文字頁 → 逐字文字
#     ・表單頁（附表）→ 整頁圖
#   斷行規則：PDF 每行在欄寬處斷開，這裡只把同一段的行接回去——遇到「一、」「(一)」「1.」「(1)」「甲、」開頭才換段。不增刪任何字。
#   核對：每頁「放進文字的字＋留在圖裡的字＋略去的頁首頁尾」必須等於該頁全部的字，否則中止。
MARK = re.compile(r'^\s*([一二三四五六七八九十百]+、|[（(][一二三四五六七八九十]+[)）]|\d+[.．、]|[（(]\d+[)）]|[甲乙丙丁戊己庚辛壬癸]、|※|註：|附表)')
TOP = re.compile(r'^([一二三四五六七八九十]+)、(.{2,14}?)[：:]\s*$')
RUNHEAD = re.compile(r'^(\(續\).*作業程序|[（(]第.{1,3}頁，共.{1,3}頁[)）]|[（(]續下頁[)）]|\d{1,3})$')


def join_lines(lines, title=False):
    # title=True（第一頁最上面）：第一個「一、」之前是名稱、發文字號，各自一行不相接
    out, started = [], not title
    for ln in lines:
        t = ln.strip()
        if not t:
            continue
        if MARK.match(t):
            started = True; out.append(t)
        elif out and started:
            out[-1] += t
        else:
            out.append(t)
    return out


def lines_of(pg, clip=None):
    """一頁（或一個區域）的文字行：[(y0, x0, 文字)]，照 PDF 內的順序"""
    res = []
    for b in pg.get_text('dict', clip=clip)['blocks']:
        for ln in b.get('lines', []):
            t = ''.join(sp['text'] for sp in ln['spans'])
            if t.strip():
                res.append((ln['bbox'], t))
    return res


def build_layout(doc, code, d):
    """回傳 (content 文字, 核對列表)；版型對不上時回傳 (None, 原因)"""
    out, body, tbuf, checks, flow_n, flow_started, forms = [], [], [], [], 0, False, []
    def emit_text(lines, target, title=False):
        for t in join_lines(lines, title):
            m = TOP.match(t)
            nonlocal flow_started
            if m and target is out:
                if m.group(2).endswith('流程'):
                    if not flow_started:
                        target.append(''); target.append('【流程圖】'); flow_started = True
                else:
                    target.append(''); target.append('【' + m.group(2) + '】')
            target.append(t)
    def flush_text():   # 連續的純文字頁接成一段再輸出（段落跨頁時才接得起來）
        nonlocal tbuf
        if tbuf:
            emit_text(tbuf, out); tbuf = []
    for i, pg in enumerate(doc, 1):
        allc = len(norm(pg.get_text()))
        draws = pg.get_drawings()
        first = next((t.strip() for bb, t in sorted(lines_of(pg), key=lambda x: x[0][1]) if not RUNHEAD.match(t.strip())), '')
        if forms or first.startswith('附表'):   # 附表（表單）：從第一張起到最後都是整頁圖
            flush_text()
            forms.append(i)
            checks.append((i, '表單頁（整頁圖）', allc, 0, allc, 0))
            continue
        boxes = [r['rect'] for r in draws if r['rect'].height > 250 and r['rect'].x0 > pg.rect.width * 0.5 and r['rect'].width > 100]
        if boxes:
            box = max(boxes, key=lambda r: r.height)
            hdr = [w for w in pg.get_text('words') if w[4] in ('流程', '權責人員', '作業內容')]
            hy = min([w[1] for w in hdr] + [box.y0]) - 3
            flush_text()
            top, inimg, drop, btxt, flab = [], 0, 0, [], []
            for bb, t in lines_of(pg):
                cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
                if box.x0 - 3 <= cx <= box.x1 + 3 and box.y0 - 3 <= cy <= box.y1 + 3:
                    btxt.append(t)
                elif bb[3] <= hy + 4:
                    if RUNHEAD.match(t.strip()): drop += len(norm(t))
                    else: top.append(t)
                elif RUNHEAD.match(t.strip()) or t.strip() == '作業內容':
                    drop += len(norm(t))
                elif TOP.match(t.strip()):   # 寫在流程區裡的小標（例：三、分局流程：）也拿出來當文字
                    flab.append(t)
                else:
                    inimg += len(norm(t))
            emit_text(top, out, title=(i == 1))
            emit_text(flab, out)
            left = [r['rect'] for r in draws if r['rect'].x1 < box.x0 and r['rect'].y0 > hy]
            if len(left) >= 3:
                if not flow_started:
                    out.append(''); out.append('【流程圖】'); flow_started = True
                x0 = max(0, min(r.x0 for r in left) - 14); y1 = min(pg.rect.height, max(r.y1 for r in left) + 14)
                fn = 'f%02d.png' % i
                render(pg, os.path.join(d, fn), clip=fitz.Rect(x0, hy, box.x0 - 4, y1))
                flow_n += 1
                out.append('![流程圖（原檔第 %d 頁）](data/sop/%s/%s)' % (i, code, fn))
            else:
                drop += inimg; inimg = 0   # 這一頁左邊沒有流程圖，只剩欄位標題
            body += btxt
            kept = sum(len(norm(t)) for t in top + flab + btxt)
            checks.append((i, '流程＋作業內容', allc, kept, inimg, drop))
            assert kept + inimg + drop == allc, '第 %d 頁字數對不起來：%d+%d+%d≠%d' % (i, kept, inimg, drop, allc)
        elif len(draws) <= 3 and allc >= 150:
            if body:
                out += ['', '【作業內容】'] + join_lines(body); body = []
            keep, drop = [], 0
            for bb, t in lines_of(pg):
                if RUNHEAD.match(t.strip()): drop += len(norm(t))
                else: keep.append(t)
            tbuf += keep
            kept = sum(len(norm(t)) for t in keep)
            checks.append((i, '純文字頁', allc, kept, 0, drop))
            assert kept + drop == allc, '第 %d 頁字數對不起來' % i
        else:
            forms.append(i)
            checks.append((i, '表單頁（整頁圖）', allc, 0, allc, 0))
    if body:
        out += ['', '【作業內容】'] + join_lines(body)
    flush_text()
    if not flow_n:
        return None, '找不到「流程｜權責人員｜作業內容」版型'
    if forms:
        out += ['', '【附表】']
        out += ['![原檔第 %d 頁](data/sop/%s/%02d.png)' % (i, code, i) for i in forms]
    return chr(10).join(out).strip(), checks


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
        if old and old.get('sha1') == sha and old.get('v') == VER and not redo and all(os.path.exists(os.path.join(ROOT, p)) for p in old['pages']):
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
        content, checks = build_layout(doc, code, d)
        db[name] = dict(v=VER, pages=pages, pagesText=text, amendDate=amend, file=os.path.basename(pdf), sha1=sha, noText=no_text)
        if content:
            db[name]['content'] = content
        rep.append('| %s | %s | %d | %d | %.1f MB | %s | %s |' % (
            name, ymd, len(pages), len(norm(text)) - sum(len(norm(PAGE_MARK % i)) for i in range(1, len(pages) + 1)),
            sizes / 1048576, '、'.join(map(str, no_text)) or '無', '更新' if old else '新增'))
        detail += ['', '## ' + name, '', '每頁字數：' + '、'.join('p%d %d' % (i + 1, n) for i, n in enumerate(per))]
        if content:
            detail += ['', '整理版（流程圖＋完整文字）逐頁核對：每頁「放進文字＋留在圖裡＋略去的頁首頁尾」＝該頁全部字數', '',
                       '| 頁 | 類型 | 全部字數 | 放進文字 | 留在圖裡 | 略去（頁首、頁碼、續下頁） |', '|---|---|---|---|---|---|']
            detail += ['| %d | %s | %d | %d | %d | %d |' % c for c in checks]
        else:
            detail += ['', '⚠ 沒有產生整理版：' + checks + '。App 只顯示原檔整頁。']
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
