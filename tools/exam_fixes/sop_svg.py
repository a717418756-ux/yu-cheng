"""SOP 流程圖 → SVG（真文字＋原檔線條），v4.43。

  原則：不理解、不重畫。每個框、每條線、每個箭頭都是 PDF 裡的向量路徑，照座標搬過來；
        每個字都是 PDF 文字層的字，照原本的位置、字級放回去，只是變成可選取、可搜尋的文字。
  顏色：PDF 只有黑、白、灰三種，轉成 class（k 黑、w 白、g 灰），App 依主題（淺色／深色／電子紙）上色。
  字型：原檔是標楷體，手機多半沒有，所以每一段字都加 textLength（PDF 上量到的寬度），
        換成別的字型也會被壓回原本的寬度，不會超出框。
"""
import fitz, re


def _cls(rgb):
    if rgb is None:
        return None
    v = sum(rgb) / 3
    return 'k' if v < 0.3 else ('w' if v > 0.95 else 'g')


def _n(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def _path(items, close):
    d, cur = [], None
    for it in items:
        k = it[0]
        if k == 're':
            r = it[1]
            d.append('M%s %sH%sV%sH%sZ' % (_n(r.x0), _n(r.y0), _n(r.x1), _n(r.y1), _n(r.x0))); cur = None
        elif k == 'qu':
            q = it[1]
            d.append('M%s %sL%s %sL%s %sL%s %sZ' % (_n(q.ul.x), _n(q.ul.y), _n(q.ur.x), _n(q.ur.y), _n(q.lr.x), _n(q.lr.y), _n(q.ll.x), _n(q.ll.y))); cur = None
        else:
            p0 = it[1]
            if cur is None or abs(cur.x - p0.x) > 0.01 or abs(cur.y - p0.y) > 0.01:
                d.append('M%s %s' % (_n(p0.x), _n(p0.y)))
            if k == 'l':
                d.append('L%s %s' % (_n(it[2].x), _n(it[2].y))); cur = it[2]
            elif k == 'c':
                d.append('C%s %s %s %s %s %s' % (_n(it[2].x), _n(it[2].y), _n(it[3].x), _n(it[3].y), _n(it[4].x), _n(it[4].y))); cur = it[4]
    if close:
        d.append('Z')
    return ''.join(d)


def _esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def elements(pg, clip):
    """裁切範圍內的元素：[dict(kind='path'|'text', rect, svg, text, vis, dr)]，座標＝PDF 頁面座標"""
    clip = fitz.Rect(clip)
    els = []
    for dr in pg.get_drawings():
        if not dr['rect'].intersects(clip) and not clip.contains(dr['rect']):
            continue
        d = _path(dr['items'], dr.get('closePath'))
        if not d:
            continue
        a = []
        f = _cls(dr.get('fill')) if 'f' in dr['type'] else None
        s = _cls(dr.get('color')) if 's' in dr['type'] else None
        a.append('class="%s"' % ' '.join(['f' + f if f else 'fn', ('s' + s) if s else 'sn']))
        if s:
            a.append('stroke-width="%s"' % _n(dr.get('width') or 1))
            ds = dr.get('dashes') or ''
            m = re.match(r'\[([\d. ]+)\]', ds)
            if m and m.group(1).strip():
                a.append('stroke-dasharray="%s"' % m.group(1).strip())
            if dr.get('lineJoin') is not None:
                a.append('stroke-linejoin="%s"' % ['miter', 'round', 'bevel'][int(dr['lineJoin'])])
        if dr.get('even_odd'):
            a.append('fill-rule="evenodd"')
        # 看得到＝有黑或灰的填色／框線（白底白框是原檔用來墊字的，看不到）
        vis = f in ('k', 'g') or s in ('k', 'g')
        els.append(dict(kind='path', rect=fitz.Rect(dr['rect']), svg='<path d="%s" %s/>' % (d, ' '.join(a)), text='', vis=vis, dr=dr))
    for b in pg.get_text('rawdict')['blocks']:
        for ln in b.get('lines', []):
            for sp in ln['spans']:
                # 只取中心點落在裁切範圍內的字；頭尾空白不放（寬度只量有字的部分）
                cs = [c for c in sp['chars'] if clip.contains(fitz.Point((c['bbox'][0] + c['bbox'][2]) / 2, (c['bbox'][1] + c['bbox'][3]) / 2))]
                while cs and not cs[0]['c'].strip():
                    cs.pop(0)
                while cs and not cs[-1]['c'].strip():
                    cs.pop()
                if not cs:
                    continue
                body = ''.join(c['c'] for c in cs)
                ox, oy = cs[0]['origin']
                w = cs[-1]['bbox'][2] - cs[0]['bbox'][0]
                bold = ' font-weight="bold"' if sp['flags'] & 16 else ''
                r = fitz.Rect(cs[0]['bbox'][0], min(c['bbox'][1] for c in cs), cs[-1]['bbox'][2], max(c['bbox'][3] for c in cs))
                els.append(dict(kind='text', rect=r, text=body, vis=True, svg='<text x="%s" y="%s" font-size="%s" textLength="%s" lengthAdjust="spacingAndGlyphs"%s>%s</text>' % (
                    _n(ox), _n(oy), _n(sp['size']), _n(w), bold, _esc(body))))
    return els


def _wrap(x0, y0, w, h, body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" class="sop-svg" viewBox="%s %s %s %s" width="%s" height="%s">' % (
        _n(x0), _n(y0), _n(w), _n(h), _n(w), _n(h))
        # 單獨開（放大檢視、<img>）時的顏色；App 內嵌時這段 <style> 和底色 rect 會被拿掉，改用主題色
        + '<style>.fk{fill:#000}.fw{fill:#fff}.fg{fill:#d9d9d9}.fn{fill:none}.sk{stroke:#000}.sw{stroke:#fff}.sn{stroke:none}'
        + 'text{fill:#000;font-family:"DFKai-SB","BiauKai","標楷體","Kaiti TC","STKaiti",serif}</style>'
        + '<rect x="%s" y="%s" width="%s" height="%s" fill="#fff" class="bg"/>' % (_n(x0), _n(y0), _n(w), _n(h))
        + body + '</svg>')


def _chars(els):
    return re.sub(r'\s+', '', ''.join(e['text'] for e in els if e['kind'] == 'text'))


def flow_svg(pg, clip):
    """回傳 (svg 字串, 放進 SVG 的字（去空白）)"""
    clip = fitz.Rect(clip)
    els = elements(pg, clip)
    return _wrap(clip.x0, clip.y0, clip.width, clip.height, ''.join(e['svg'] for e in els)), _chars(els)


# ══ 跨頁接點（A、B、C 圓圈）直接連線（v4.43）══════════════════════════════════════
#   原檔一頁放不下時，用圓圈 A／B／C 把上一頁底部接到下一頁頂部。這裡把連續幾頁疊成一張，
#   拿掉成對的圓圈，改畫一條線把兩端的線頭接起來。只做「機械上確定」的情況，否則照原樣分頁：
#     ・上一頁底部的圓圈字母＝下一頁頂部的圓圈字母（一一對應）
#     ・上一頁的圓圈只有上緣接線頭、下一頁的只有下緣接線頭
#     ・接線的橫段彼此不重疊（不會交叉看不清楚）
#   拿掉的只有：成對的圓圈和裡面的字母、下一頁頂部重複的「流程」「權責人員」、上一頁底部的「(續下頁)」與頁碼，
#   以及原檔用來墊字、看不到的白色方塊。其他任何東西落在要切掉的範圍就中止（照原樣分頁）。
GAP = 26           # 疊起來後，上一頁圓圈底到下一頁圓圈頂的距離（pt）
_JUNK_BOTTOM = re.compile(r'^([（(]續下頁[)）]|\d{1,3})$')
_JUNK_TOP = re.compile(r'^(流程|權責人員)$')
_CONT = re.compile(r'^[（(]續下頁[)）]$')   # 接起來後就沒有「下頁」了，不論位置都拿掉


def _circles(els):
    res = []
    for e in els:
        if e['kind'] != 'path' or not e['vis']:
            continue
        r, ks = e['rect'], set(it[0] for it in e['dr']['items'])
        if ks == {'c'} and abs(r.width - r.height) < 4 and 18 < r.width < 45:
            ts = [t for t in els if t['kind'] == 'text' and r.contains(fitz.Point((t['rect'].x0 + t['rect'].x1) / 2, (t['rect'].y0 + t['rect'].y1) / 2))]
            if len(ts) == 1 and re.fullmatch(r'[A-Z]', ts[0]['text']):
                res.append(dict(el=e, txt=ts[0], L=ts[0]['text'], r=r))
    return res


def _stub(els, c, where):
    """圓圈上緣（where='top'）或下緣的線頭：原檔線條（或箭頭尖）最靠近該緣的端點；8pt 內沒有就回 None"""
    r = c['r']; cx = (r.x0 + r.x1) / 2; y = r.y0 if where == 'top' else r.y1
    best, bd = None, 8.0
    for e in els:
        if e['kind'] != 'path' or not e['vis'] or e is c['el']:
            continue
        for it in e['dr']['items']:
            if it[0] not in ('l', 'c'):
                continue
            for p in (it[1], it[-1]):
                if abs(p.x - cx) > r.width / 2:
                    continue
                dd = (y - p.y) if where == 'top' else (p.y - y)   # 線頭要在圓的外側（或剛好碰到）
                if -1.5 <= dd < bd:
                    best, bd = fitz.Point(p), dd
    return best


def _edge_ok(els, c, where):
    """圓圈只有上緣（where='top'）或只有下緣有線頭接著"""
    t, b = _stub(els, c, 'top'), _stub(els, c, 'bottom')
    return bool(t and not b) if where == 'top' else bool(b and not t)


def _ends(els):
    """一頁的（頂部圓圈, 底部圓圈）。頂部＝比其他看得到的線條都高；底部＝比其他都低"""
    cs = _circles(els)
    cid = {id(c['el']) for c in cs}
    other = [e['rect'] for e in els if e['kind'] == 'path' and e['vis'] and id(e) not in cid]
    if not other:
        return [], []
    top = [c for c in cs if c['r'].y0 < min(r.y0 for r in other) + 1]
    bot = [c for c in cs if c['r'].y1 > max(r.y1 for r in other) - 1]
    return top, bot


def can_join(a_els, b_els):
    """a 頁底部圓圈能不能和 b 頁頂部圓圈直接連起來；回傳 (配對列表 或 None, 原因)"""
    _, abot = _ends(a_els)
    btop, _ = _ends(b_els)
    if not abot or not btop:
        return None, '沒有跨頁圓圈'
    la, lb = sorted(c['L'] for c in abot), sorted(c['L'] for c in btop)
    if la != lb or len(set(la)) != len(la):
        return None, '圓圈字母對不上：%s／%s' % (''.join(la), ''.join(lb))
    pairs = []
    for c in sorted(abot, key=lambda c: c['r'].x0):
        d = next(x for x in btop if x['L'] == c['L'])
        if not _edge_ok(a_els, c, 'top') or not _edge_ok(b_els, d, 'bottom'):
            return None, '圓圈 %s 的線頭不是「上一頁接上緣、下一頁接下緣」' % c['L']
        pairs.append((c, d))
    return pairs, ''


def joined_svg(parts):
    """parts：[(pg, clip)]，相鄰兩頁都要能 can_join。回傳 (svg, 字, 拿掉的字列表)；不能接時丟 AssertionError"""
    pages = [elements(pg, cl) for pg, cl in parts]
    clips = [fitz.Rect(cl) for _, cl in parts]
    x0 = min(c.x0 for c in clips); x1 = max(c.x1 for c in clips)
    joins = []
    for k in range(len(pages) - 1):
        pr, why = can_join(pages[k], pages[k + 1])
        assert pr, '第 %d、%d 段接不起來：%s' % (k + 1, k + 2, why)
        joins.append(pr)
    body, chars, removed, links, offs = [], [], [], [], []
    yend = None
    for k, els in enumerate(pages):
        drop = set()
        top_cut = bot_cut = None
        if k > 0:
            for _, d in joins[k - 1]:
                drop |= {id(d['el']), id(d['txt'])}
            top_cut = min(d['r'].y0 for _, d in joins[k - 1])
        if k < len(pages) - 1:
            for c, _ in joins[k]:
                drop |= {id(c['el']), id(c['txt'])}
            bot_cut = max(c['r'].y1 for c, _ in joins[k])
        keep = []
        for e in els:
            if id(e) in drop or (bot_cut is not None and e['kind'] == 'text' and _CONT.match(e['text'])):
                removed.append(e['text']); continue
            if top_cut is not None and e['rect'].y1 < top_cut + 1:
                assert not e['vis'] or (e['kind'] == 'text' and _JUNK_TOP.match(e['text'])), '第 %d 段頂部有不能拿掉的東西：%s' % (k + 1, e['text'] or e['svg'][:80])
                removed.append(e['text']); continue
            if bot_cut is not None and e['rect'].y0 > bot_cut - 1:
                assert not e['vis'] or (e['kind'] == 'text' and _JUNK_BOTTOM.match(e['text'])), '第 %d 段底部有不能拿掉的東西：%s' % (k + 1, e['text'] or e['svg'][:80])
                removed.append(e['text']); continue
            keep.append(e)
        if k == 0:
            dy = 0.0
        else:
            # 上一頁底部圓圈下緣（疊好後的位置）＋GAP ＝ 這一頁頂部圓圈上緣
            dy = offs[k - 1] + max(c['r'].y1 for c, _ in joins[k - 1]) + GAP - top_cut
        offs.append(dy)
        body.append('<g transform="translate(0 %s)">' % _n(dy) + ''.join(e['svg'] for e in keep) + '</g>')
        chars.append(_chars(keep))
        yend = (bot_cut if bot_cut is not None else clips[k].y1) + dy
    # 接線：上一頁圓圈上緣（線頭）→ 往下到兩頁中間 → 橫移 → 往下到下一頁圓圈下緣（線頭）
    for k, pr in enumerate(joins):
        da, db = offs[k], offs[k + 1]
        my = max(c['r'].y1 for c, _ in pr) + da + GAP / 2
        segs = []
        for c, d in pr:
            pa, pb = _stub(pages[k], c, 'top'), _stub(pages[k + 1], d, 'bottom')
            ax, ay = pa.x, pa.y + da
            bx, by = pb.x, pb.y + db
            segs.append((min(ax, bx), max(ax, bx)))
            sw = c['el']['dr'].get('width') or 0.75
            body.append('<path d="M%s %sV%sH%sV%s" class="fn sk" stroke-width="%s"/>' % (_n(ax), _n(ay), _n(my), _n(bx), _n(by), _n(sw)))
        segs.sort()
        for (a0, a1), (b0, b1) in zip(segs, segs[1:]):
            assert a1 + 4 < b0, '第 %d、%d 段的接線橫段會重疊' % (k + 1, k + 2)
    svg = _wrap(x0, clips[0].y0, x1 - x0, yend - clips[0].y0, ''.join(body))
    return svg, ''.join(chars), [x for x in removed if x]
