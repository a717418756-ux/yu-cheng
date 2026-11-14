"""SOP 流程圖 → SVG（真文字＋原檔線條），v4.43。

  原則：不理解、不重畫。每個框、每條線、每個箭頭都是 PDF 裡的向量路徑，照座標搬過來；
        每個字都是 PDF 文字層的字，照原本的位置、字級放回去，只是變成可選取、可搜尋的文字。
  顏色：PDF 只有黑、白、灰三種，轉成 class（k 黑、w 白、g 灰），App 依主題（淺色／深色／電子紙）上色。
  字型：原檔是標楷體，手機多半沒有，所以每一段字都加 textLength（PDF 上量到的寬度），
        換成別的字型也會被壓回原本的寬度，不會超出框。
"""
import fitz, re, base64, collections


def _cls(rgb):
    if rgb is None:
        return None
    if max(rgb) - min(rgb) > 0.12:      # 有彩度（紅、藍、黃底…）：保留原色，不跟主題走
        return '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in rgb)
    v = sum(rgb) / 3
    return 'k' if v < 0.3 else ('w' if v > 0.95 else 'g')


def _font(name):
    """原檔字型 → class（只在整頁模式用）：tl 英數襯線（Times）、ts 無襯線（Arial／Calibri）、tm 等寬、tg 明體；楷體與不認得的不加"""
    n = name.lower()
    if 'kai' in n: return ''
    if 'times' in n or 'nimbus' in n or 'roman' in n: return 'tl'
    if 'arial' in n or 'calibri' in n or 'helvet' in n: return 'ts'
    if 'courier' in n or 'mono' in n: return 'tm'
    if 'ming' in n or 'song' in n or '明' in name: return 'tg'
    return ''


def _n(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def _path(items, close, f=None):
    """f：座標換算 (x, y) → (x, y)，不給就照原座標"""
    f = f or (lambda x, y: (x, y))
    P = lambda p: '%s %s' % tuple(_n(v) for v in f(p.x, p.y))
    d, cur = [], None
    for it in items:
        k = it[0]
        if k == 're':
            r = it[1]
            (xa, ya), (xb, yb) = f(r.x0, r.y0), f(r.x1, r.y1)
            d.append('M%s %sH%sV%sH%sZ' % (_n(xa), _n(ya), _n(xb), _n(yb), _n(xa))); cur = None
        elif k == 'qu':
            q = it[1]
            d.append('M%sL%sL%sL%sZ' % (P(q.ul), P(q.ur), P(q.lr), P(q.ll))); cur = None
        else:
            p0 = it[1]
            if cur is None or abs(cur.x - p0.x) > 0.01 or abs(cur.y - p0.y) > 0.01:
                d.append('M' + P(p0))
            if k == 'l':
                d.append('L' + P(it[2])); cur = it[2]
            elif k == 'c':
                d.append('C%s %s %s' % (P(it[2]), P(it[3]), P(it[4]))); cur = it[4]
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
        st = ''
        if f and f[0] == '#': st += 'fill:%s;' % f
        if s and s[0] == '#': st += 'stroke:%s;' % s
        a.append('class="%s"' % ' '.join(['fn' if not f else 'fc' if f[0] == '#' else 'f' + f, 'sn' if not s else 'sc' if s[0] == '#' else 's' + s]))
        if st:
            a.append('style="%s"' % st)
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
        vis = bool(f and f != 'w') or bool(s and s != 'w')
        els.append(dict(kind='path', rect=fitz.Rect(dr['rect']), svg='<path d="%s" %s/>' % (d, ' '.join(a)), attrs=' '.join(a), text='', vis=vis, dr=dr))
    # PDF 裡的圖片（掃描頁、印章、照片）：原始圖檔原封不動放回原位置
    for im in pg.get_image_info(xrefs=True):
        r = fitz.Rect(im['bbox'])
        if not im.get('xref') or not r.intersects(clip):
            continue
        tr = im.get('transform') or (1, 0, 0, 1, 0, 0)
        try:
            x = pg.parent.extract_image(im['xref'])
        except Exception:
            x = None
        ok = bool(x) and x.get('ext') in ('png', 'jpeg', 'jpg') and abs(tr[1]) < 0.01 and abs(tr[2]) < 0.01 and tr[0] > 0 and tr[3] > 0 and not x.get('smask')
        if ok:
            data, mime = x['image'], 'image/' + ('png' if x['ext'] == 'png' else 'jpeg')
        else:   # 旋轉、特殊格式、有透明遮罩：把這塊範圍照畫面轉成圖
            data, mime = pg.get_pixmap(clip=r, dpi=150).tobytes('png'), 'image/png'
        els.append(dict(kind='image', rect=r, text='', vis=True, bytes=len(data), svg='<image x="%s" y="%s" width="%s" height="%s" preserveAspectRatio="none" href="data:%s;base64,%s"/>' % (
            _n(r.x0), _n(r.y0), _n(r.width), _n(r.height), mime, base64.b64encode(data).decode())))
    for b in pg.get_text('rawdict')['blocks']:
        for ln in b.get('lines', []):
            rot = abs(ln['dir'][0] - 1) > 0.01 or abs(ln['dir'][1]) > 0.01   # 直排或旋轉的字：這裡照橫排放，位置會不對，由呼叫端決定要不要改用圖
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
                els.append(dict(kind='text', rect=r, text=body, vis=True, rot=rot, t=dict(ox=ox, oy=oy, size=sp['size'], w=w, bold=bold, color=sp.get('color') or 0, font=_font(sp.get('font') or ''))))
    return els


# ══ 版面放鬆（v4.44）════════════════════════════════════════════════════════════
#   原檔的字行距＝字高（有的還更小，字會疊在一起），框也貼著字，手機上看很擠。
#   做法是「整張圖同一個公式換算」，不動任何一個東西的相對位置：
#     ・線條、框、箭頭：只往垂直方向等比例拉高 SY 倍（y' = Y0 + SY·(y − Y0)），水平不動。
#       橫線還是橫線、直線變長、框變高，原本接在一起的還是接在一起；線寬不跟著變（non-scaling-stroke）。
#     ・字：字級不跟著拉高，只縮成 FS 倍，每一行的中心點用同一個公式換算。
#       框裡的字以「框的中心」為準往內縮（對齊方式不變）；框外的字（是／否）以自己的中心為準。
#     結果：行距變成原本的 SY/FS 倍，字和框邊之間多出空隙，流程和樣式不變。
SY = 1.25
FS = 0.88
LW = 1.0    # 流程圖所有線條統一的粗細（pt）。原檔的箭頭線是 1pt 寬的實心長方形，其他線是 0.75pt 的框線，兩種看起來一粗一細，這裡統一成 1pt


def _arrow(dr):
    """原檔的箭頭＝實心的「細長方形線身＋三角形箭頭」。回傳 (線身起點, 箭頭尖, 箭頭長, 箭頭半寬)；不是這種形狀回 None"""
    if dr['type'] != 'f':
        return None
    its = dr['items']
    if len(its) < 4 or any(it[0] != 'l' for it in its[-3:]) or any(it[0] not in ('l', 're') for it in its):
        return None
    tri = [its[-3][1], its[-2][1], its[-1][1]]
    pts = []
    for it in its[:-3]:
        pts += [it[1].tl, it[1].br] if it[0] == 're' else [it[1], it[2]]
    body = fitz.Rect(min(p.x for p in pts), min(p.y for p in pts), max(p.x for p in pts), max(p.y for p in pts))
    vert = body.height >= body.width
    if min(body.width, body.height) > 3:
        return None
    c = fitz.Point((body.x0 + body.x1) / 2, (body.y0 + body.y1) / 2)
    key = (lambda p: p.y) if vert else (lambda p: p.x)
    tip = max(tri, key=lambda p: abs(key(p) - key(c)))
    base = [p for p in tri if p is not tip]
    if abs(key(base[0]) - key(base[1])) > 0.2:
        return None          # 斜的箭頭：不處理
    sgn = 1 if key(tip) > key(c) else -1
    if vert:
        start = fitz.Point(tip.x, body.y0 if sgn > 0 else body.y1)
        return start, fitz.Point(tip), abs(tip.y - base[0].y), abs(base[0].x - base[1].x) / 2
    start = fitz.Point(body.x0 if sgn > 0 else body.x1, tip.y)
    return start, fitz.Point(tip), abs(tip.x - base[0].x), abs(base[0].y - base[1].y) / 2


# ══ 連續的線（v4.47）══════════════════════════════════════════════════════════════
#   原檔一條線常是好幾段分開畫的：箭頭線身、轉角前後各一段、跨頁接線，段與段之間有 0.3～1pt 的錯位，
#   轉角是兩段方頭疊在一起，放大看就像拼接。這裡把所有「水平／垂直的連接線」放進一個線網：
#     1. 同一直線上、錯位 ≤ SNAP、首尾相接（間隔 ≤ GAPJ）的段合併成一段，位置取較長那段
#     2. 線頭離另一條線 ≤ SNAP 的，接到那條線上（轉角、T 字）
#     3. 跨頁接線的小折角：另一側那段線若「一頭是轉折、另一頭是箭頭指進方框」，整段平移對齊，折角消失
#     4. 首尾相連的段串成一筆（一個 path），轉角用尖角，箭頭只畫在線的末端
#   框、菱形、圓角框不動。位移最多 SNAP（跨頁接線最多 JOG），流程和接到哪個框都不變。
SNAP = 2.5
GAPJ = 3.0
JOG = 40.0


def _boxy(dr):
    """方框（含圓角框）＝邊都是水平／垂直；菱形這種斜邊的不算（箭頭要對準頂點，不能平移）"""
    for it in dr['items']:
        if it[0] == 'l' and abs(it[1].x - it[2].x) > 0.6 and abs(it[1].y - it[2].y) > 0.6:
            return False
    return True


def _add(net, xa, ya, xb, yb, head=None):
    """加一段水平或垂直線（換算後座標）；head＝(hl, hw)：箭頭在 (xb, yb) 那端"""
    if abs(xa - xb) < 0.01 and abs(ya - yb) < 0.01:
        return
    v = abs(xa - xb) <= abs(ya - yb)
    c = (xa + xb) / 2 if v else (ya + yb) / 2
    a0, b0 = (ya, yb) if v else (xa, xb)
    sg = dict(o='v' if v else 'h', c=c, a=min(a0, b0), b=max(a0, b0), heads=[], join=False)
    if head:
        sg['heads'].append(dict(at=b0, d=1 if b0 > a0 else -1, hl=head[0], hw=head[1]))
    net['segs'].append(sg)


def _conn(e, f, net):
    """是連接線（直／橫的開放線、箭頭）就放進線網並回 True；其他（框、菱形、斜線）回 False"""
    if not e['vis']:
        return False
    dr = e['dr']
    a = _arrow(dr)
    if a:
        st, tp, hl, hw = a
        (sx, sy), (tx, ty) = f(st.x, st.y), f(tp.x, tp.y)
        _add(net, sx, sy, tx, ty, (hl, hw))
        return True
    if dr['type'] != 's' or dr.get('closePath') or not dr['items'] or any(it[0] != 'l' for it in dr['items']):
        return False
    if any(abs(it[1].x - it[2].x) > 0.6 and abs(it[1].y - it[2].y) > 0.6 for it in dr['items']):
        return False
    for it in dr['items']:
        (xa, ya), (xb, yb) = f(it[1].x, it[1].y), f(it[2].x, it[2].y)
        _add(net, xa, ya, xb, yb)
    return True


def _merge(segs):
    """同一直線上、錯位 ≤ SNAP、首尾相接的段合併"""
    changed = True
    while changed:
        changed = False
        for i, p in enumerate(segs):
            for q in segs[i + 1:]:
                if p['o'] != q['o'] or abs(p['c'] - q['c']) > SNAP:
                    continue
                if q['a'] - p['b'] > GAPJ or p['a'] - q['b'] > GAPJ:
                    continue
                keep = p if p['b'] - p['a'] >= q['b'] - q['a'] else q
                p['c'] = keep['c']; p['a'] = min(p['a'], q['a']); p['b'] = max(p['b'], q['b'])
                p['heads'] += q['heads']; p['join'] = p['join'] or q['join']
                segs.remove(q); changed = True
                break
            if changed:
                break


def _touch(segs):
    """線頭離另一條（垂直方向的）線 ≤ SNAP：線頭接到那條線上；碰到的是那條線的端點附近，就連端點一起對齊（轉角）"""
    for p in segs:
        for end in ('a', 'b'):
            for q in segs:
                if q is p or q['o'] == p['o']:
                    continue
                if abs(p[end] - q['c']) > SNAP or not (q['a'] - SNAP <= p['c'] <= q['b'] + SNAP):
                    continue
                p[end] = q['c']
                for qe in ('a', 'b'):            # 轉角：對方的端點也對到這條線上
                    if abs(q[qe] - p['c']) <= SNAP:
                        q[qe] = p['c']
                break


def _ends_at(segs, sg, end):
    """哪些段的線頭接在 sg 的 end 端點上（轉角）"""
    pt = sg[end]
    return [q for q in segs if q is not sg and q['o'] != sg['o'] and abs(q['c'] - pt) < 0.01
            and any(abs(q[e] - sg['c']) < 0.01 for e in ('a', 'b'))]


def _side(segs, sg):
    """接在 sg 身上（不在端點）的其他段數：有的話不能平移"""
    n = 0
    for q in segs:
        if q is sg or q['o'] == sg['o']:
            continue
        if sg['a'] + 0.01 < q['c'] < sg['b'] - 0.01 and any(abs(q[e] - sg['c']) < 0.01 for e in ('a', 'b')):
            n += 1
        if abs(q['c'] - sg['a']) < 0.01 or abs(q['c'] - sg['b']) < 0.01:
            if q['a'] + 0.01 < sg['c'] < q['b'] - 0.01:
                n += 1                            # sg 的端點是 T 字接在 q 中間
    return n


def _straighten(net):
    """跨頁接線的折角：V1（上）—H（折角）—V2（下）。V2 或 V1 能整段平移就平移，H 就不用了"""
    segs = net['segs']
    for H in [s for s in segs if s['o'] == 'h' and s.get('jog')]:
        if H not in segs or H['b'] - H['a'] > JOG:
            continue
        V = [q for q in segs if q['o'] == 'v' and any(abs(q['c'] - H[e]) < 0.01 for e in ('a', 'b'))
             and (abs(q['a'] - H['c']) < 0.01 or abs(q['b'] - H['c']) < 0.01)]
        if len(V) != 2:
            continue
        for mv, st in ((V[0], V[1]), (V[1], V[0])):
            far = 'b' if abs(mv['a'] - H['c']) < 0.01 else 'a'
            if _side(segs, mv):
                continue
            ok = False
            hd = [h for h in mv['heads'] if abs(h['at'] - mv[far]) < 0.01]
            if hd:                                 # 遠端是箭頭：要指進方框，平移後仍在框邊內
                y = mv[far] + hd[0]['d'] * 1.5
                ok = any(bx and r.x0 + 4 <= st['c'] <= r.x1 - 4 and r.y0 - 2 <= y <= r.y1 + 2 for r, bx in net['boxes'])
            elif not _ends_at(segs, mv, far):      # 遠端是從方框邊出發的線頭：平移後仍在框邊內
                y = mv[far]
                ok = any(bx and r.x0 + 4 <= st['c'] <= r.x1 - 4 and (abs(r.y0 - y) < 2 or abs(r.y1 - y) < 2) for r, bx in net['boxes'])
            else:                                  # 遠端是轉角：那段橫線改接過來，長度要夠
                cs = _ends_at(segs, mv, far)
                if len(cs) == 1 and not cs[0]['heads'] or len(cs) == 1 and all(abs(h['at'] - mv['c']) > 0.01 for h in cs[0]['heads']):
                    q = cs[0]
                    qe = 'a' if abs(q['a'] - mv['c']) < 0.01 else 'b'
                    other = q['b'] if qe == 'a' else q['a']
                    ok = abs(other - st['c']) > 4 and (other - mv['c']) * (other - st['c']) > 0
                    if ok:
                        q[qe] = st['c']
            if ok:
                mv['c'] = st['c']
                segs.remove(H)
                _merge(segs)
                break


def _lines(net):
    segs = net['segs']
    for i in net['joins']:
        for sg in segs[i:]:
            sg['join'] = True
            if sg['o'] == 'h':
                sg['jog'] = True
    _merge(segs)
    _touch(segs)
    _merge(segs)
    _straighten(net)
    segs[:] = [sg for sg in segs if sg['b'] - sg['a'] > 0.05]   # 對齊後長度變 0 的小折角（例：錯位 1pt 的接線）不要
    # 串成一筆：端點相同（且那個點只有兩段相接）就接起來
    key = lambda x, y: (round(x, 2), round(y, 2))
    pts = lambda sg: [(sg['c'], sg['a']), (sg['c'], sg['b'])] if sg['o'] == 'v' else [(sg['a'], sg['c']), (sg['b'], sg['c'])]
    deg = collections.Counter(key(*p) for sg in segs for p in pts(sg))
    used, out, tips = set(), [], []
    for sg in segs:
        for h in sg['heads']:
            x, y = (sg['c'], h['at']) if sg['o'] == 'v' else (h['at'], sg['c'])
            tips.append((x, y, h['d'], sg['o'], h['hl'], h['hw']))
    tipset = {key(x, y): (d, o, hl) for x, y, d, o, hl, hw in tips}

    def nxt(p, cur):
        if deg[key(*p)] != 2:
            return None
        for sg in segs:
            if id(sg) in used or sg is cur:
                continue
            a, b = pts(sg)
            if key(*a) == key(*p):
                return sg, b
            if key(*b) == key(*p):
                return sg, a
        return None

    def trim(p, q):
        """線的末端如果是箭頭尖，線身停在箭頭底（不要從三角形尖端穿出去）"""
        t = tipset.get(key(*p))
        if not t:
            return p
        d, o, hl = t
        return (p[0] - d * hl * 0.9, p[1]) if o == 'h' else (p[0], p[1] - d * hl * 0.9)

    for sg in segs:
        if id(sg) in used:
            continue
        used.add(id(sg))
        a, b = pts(sg)
        line = [a, b]
        cur = sg                                   # 往 b 方向接
        while True:
            r = nxt(line[-1], cur)
            if not r or key(*r[1]) == key(*line[0]):
                break
            used.add(id(r[0])); cur = r[0]; line.append(r[1])
        cur = sg                                   # 往 a 方向接
        while True:
            r = nxt(line[0], cur)
            if not r or key(*r[1]) == key(*line[-1]):
                break
            used.add(id(r[0])); cur = r[0]; line.insert(0, r[1])
        line[0] = trim(line[0], line[1]); line[-1] = trim(line[-1], line[-2])
        out.append('<path d="M%s" class="fn sk" stroke-width="%s" stroke-linejoin="miter" stroke-linecap="square"/>' % (
            'L'.join('%s %s' % (_n(x), _n(y)) for x, y in line), _n(LW)))
    for x, y, d, o, hl, hw in tips:
        if o == 'v':
            out.append('<path d="M%s %sL%s %sL%s %sZ" class="fk sn"/>' % (_n(x), _n(y), _n(x - hw), _n(y - d * hl), _n(x + hw), _n(y - d * hl)))
        else:
            out.append('<path d="M%s %sL%s %sL%s %sZ" class="fk sn"/>' % (_n(x), _n(y), _n(x - d * hl), _n(y - hw), _n(x - d * hl), _n(y + hw)))
    return ''.join(out)


def _geo(e, f):
    """流程圖的一個線條元素 → 換算後的 SVG。
    ・箭頭：線身改成和其他線一樣的框線（LW），從換算後的起點畫到箭頭底；箭頭三角形大小不變，尖端落在換算後的位置
    ・其他：每個點照 f 換算，框線粗細統一成 LW"""
    dr = e['dr']
    a = _arrow(dr) if e['vis'] else None
    if a:
        s, t, hl, hw = a
        (sx, sy), (tx, ty) = f(s.x, s.y), f(t.x, t.y)
        if abs(sx - tx) < 0.01:      # 直的
            d = 1 if ty > sy else -1
            return ('<path d="M%s %sV%s" class="fn sk" stroke-width="%s"/>' % (_n(sx), _n(sy), _n(ty - d * hl * 0.9), _n(LW))
                    + '<path d="M%s %sL%s %sL%s %sZ" class="fk sn"/>' % (_n(tx), _n(ty), _n(tx - hw), _n(ty - d * hl), _n(tx + hw), _n(ty - d * hl)))
        d = 1 if tx > sx else -1     # 橫的
        return ('<path d="M%s %sH%s" class="fn sk" stroke-width="%s"/>' % (_n(sx), _n(ty), _n(tx - d * hl * 0.9), _n(LW))
                + '<path d="M%s %sL%s %sL%s %sZ" class="fk sn"/>' % (_n(tx), _n(ty), _n(tx - d * hl), _n(ty - hw), _n(tx - d * hl), _n(ty + hw)))
    attrs = re.sub(r'stroke-width="[\d.]+"', 'stroke-width="%s"' % _n(LW), e['attrs'])
    return '<path d="%s" %s/>' % (_path(dr['items'], dr.get('closePath'), f), attrs)


def _chroma(c):
    v = (c >> 16 & 255, c >> 8 & 255, c & 255)
    return max(v) - min(v) > 30


def _anchor(e, shapes):
    """字的水平縮放基準：包住它的最小框（看得到的線條）的中心；沒有框就用自己的中心。
    裡面還框著別的框的（外框、欄位框）不算"""
    r = e['rect']; c = fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
    cand = [s for s in shapes if s.contains(c) and s.width >= r.width - 1
            and not any(o is not s and o.width * o.height > 60 and s.contains(o) for o in shapes)]
    s = min(cand, key=lambda s: s.width * s.height) if cand else r
    return (s.x0 + s.x1) / 2


def _render(pages, X0, X1, Y0, Y1, extra='', SY=None, FS=None, fonts=False):
    """pages：[(要畫的元素, 這頁往下移多少)]；extra：另外畫的線（接點連線，已是疊好後的座標）。
    SY／FS 不給就用上面的流程圖設定；fonts＝要不要照原檔字型分 class（整頁模式用）"""
    SY = globals()['SY'] if SY is None else SY
    FS = globals()['FS'] if FS is None else FS
    my = lambda y: Y0 + SY * (y - Y0)
    flow = not fonts     # 流程圖模式：座標直接換算、線條粗細統一；整頁模式：照原樣
    geo, txt = [], []
    net = dict(segs=[], heads=[], boxes=[], joins=[])
    for els, dy in pages:
        if flow:
            fdy = (lambda x, y, dy=dy: (x, my(y + dy)))
            for e in els:
                if e['kind'] == 'image':
                    geo.append(e['svg'])
                elif e['kind'] == 'path' and not _conn(e, fdy, net):
                    geo.append(_geo(e, fdy))
                    if e['vis']:
                        net['boxes'].append((fitz.Rect(*fdy(e['rect'].x0, e['rect'].y0), *fdy(e['rect'].x1, e['rect'].y1)), _boxy(e['dr'])))
        else:
            geo.append('<g transform="translate(0 %s)">' % _n(dy) + ''.join(e['svg'] for e in els if e['kind'] in ('image', 'path')) + '</g>')
        shapes = [e['rect'] for e in els if e['kind'] == 'path' and e['vis']]
        for e in els:
            if e['kind'] != 'text':
                continue
            t, r = e['t'], e['rect']
            ax = _anchor(e, shapes)
            cy = (r.y0 + r.y1) / 2 + dy
            x = ax + (t['ox'] - ax) * FS
            y = my(cy) + (t['oy'] + dy - cy) * FS
            ex = t['bold']
            if fonts and t['font']:
                ex += ' class="%s"' % t['font']
            if _chroma(t['color']):   # 彩色字（例：紅字標示修正）保留原色
                ex += ' style="fill:#%06x"' % t['color']
            txt.append('<text x="%s" y="%s" font-size="%s" textLength="%s" lengthAdjust="spacingAndGlyphs"%s>%s</text>' % (
                _n(x), _n(y), _n(t['size'] * FS), _n(t['w'] * FS), ex, _esc(e['text'])))
    if flow:
        # extra＝接點連線，每條是一串點（疊好後的座標）；和原檔的線一起放進線網，合併成連續的線
        for pts in (extra or []):
            q = [(x, my(y)) for x, y in pts]
            net['joins'].append(len(net['segs']))
            for (xa, ya), (xb, yb) in zip(q, q[1:]):
                _add(net, xa, ya, xb, yb)
        body = '<g>' + ''.join(geo) + _lines(net) + '</g><g>' + ''.join(txt) + '</g>'
    else:
        body = ('<g transform="matrix(1 0 0 %s 0 %s)">' % (_n(SY), _n(Y0 * (1 - SY))) + ''.join(geo) + '</g>'
                + '<g>' + ''.join(txt) + '</g>')
    return _wrap(X0, Y0, X1 - X0, SY * (Y1 - Y0), body, fonts)


def _wrap(x0, y0, w, h, body, fonts=False):
    return ('<svg xmlns="http://www.w3.org/2000/svg" class="sop-svg" viewBox="%s %s %s %s" width="%s" height="%s">' % (
        _n(x0), _n(y0), _n(w), _n(h), _n(w), _n(h))
        # 單獨開（放大檢視、<img>）時的顏色；App 內嵌時這段 <style> 和底色 rect 會被拿掉，改用主題色
        + '<style>.fk{fill:#000}.fw{fill:#fff}.fg{fill:#d9d9d9}.fn{fill:none}.sk{stroke:#000}.sw{stroke:#fff}.sn{stroke:none}'
        + 'text{fill:#000;font-family:"DFKai-SB","BiauKai","標楷體","Kaiti TC","STKaiti",serif}'
        + ('' if not fonts else '.tl{font-family:"Times New Roman",Times,"Noto Serif",serif}.ts{font-family:Arial,Helvetica,"Noto Sans",sans-serif}'
        + '.tm{font-family:"Courier New",monospace}.tg{font-family:"PMingLiU","MingLiU","Noto Serif TC","Noto Serif CJK TC","Songti TC",serif}') + '</style>'
        + '<rect x="%s" y="%s" width="%s" height="%s" fill="#fff" class="bg"/>' % (_n(x0), _n(y0), _n(w), _n(h))
        + body + '</svg>')


def _chars(els):
    return re.sub(r'\s+', '', ''.join(e['text'] for e in els if e['kind'] == 'text'))


def flow_svg(pg, clip):
    """回傳 (svg 字串, 放進 SVG 的字（去空白）)"""
    clip = fitz.Rect(clip)
    els = elements(pg, clip)
    return _render([(els, 0.0)], clip.x0, clip.x1, clip.y0, clip.y1), _chars(els)


# ══ 整頁照搬（補充資料、表格、附表、原檔整頁）══════════════════════════════════════
#   不切版、不拉高、不縮字：整頁每個東西照原檔座標放。四周空白裁掉（只留 margin），手機上字比較大。
#   回傳的 info 給核對表用：
#     text_ok＝SVG 裡的字和 PDF 文字層一字不差；rotated＝直排／旋轉的字有幾段（>0 時位置會不對，呼叫端應改用整頁圖）；
#     images／image_bytes＝內嵌圖片數與大小；colored＝彩色字段數；scan＝這頁有圖而且幾乎沒有字（掃描頁，圖裡的字搜尋不到）
def page_svg(pg, crop=True, margin=12):
    els = elements(pg, pg.rect)
    box = fitz.Rect(pg.rect)
    vis = [e['rect'] & box for e in els if e['vis']]
    vis = [r for r in vis if not r.is_empty]
    if crop and vis:
        b = fitz.Rect(min(r.x0 for r in vis), min(r.y0 for r in vis), max(r.x1 for r in vis), max(r.y1 for r in vis))
        box = fitz.Rect(max(box.x0, b.x0 - margin), max(box.y0, b.y0 - margin), min(box.x1, b.x1 + margin), min(box.y1, b.y1 + margin))
    svg = _render([(els, 0.0)], box.x0, box.x1, box.y0, box.y1, SY=1, FS=1, fonts=True)
    ch = _chars(els)
    cnt = lambda s: collections.Counter(re.sub(r'\s+', '', s))
    imgs = [e for e in els if e['kind'] == 'image']
    info = dict(chars=len(ch), text_ok=cnt(ch) == cnt(pg.get_text()), images=len(imgs), image_bytes=sum(e['bytes'] for e in imgs),
                rotated=sum(1 for e in els if e.get('rot')), colored=sum(1 for e in els if e['kind'] == 'text' and _chroma(e['t']['color'])),
                scan=bool(imgs) and len(ch) < 100, bytes=len(svg.encode('utf8')))
    return svg, ch, info


# ══ 跨頁接點（A、B、C 圓圈）直接連線（v4.43）══════════════════════════════════════
#   原檔一頁放不下時，用圓圈 A／B／C 把上一頁底部接到下一頁頂部。這裡把連續幾頁疊成一張，
#   拿掉成對的圓圈，改畫一條線把兩端的線頭接起來。只做「機械上確定」的情況，否則照原樣分頁：
#     ・上一頁底部的圓圈字母＝下一頁頂部的圓圈字母（一一對應）
#     ・上一頁的圓圈只有上緣接線頭、下一頁的只有下緣接線頭
#     ・接線的橫段彼此不重疊（不會交叉看不清楚）
#   拿掉的只有：成對的圓圈和裡面的字母、下一頁頂部重複的「流程」「權責人員」、上一頁底部的「(續下頁)」與頁碼，
#   以及原檔用來墊字、看不到的白色方塊。其他任何東西落在要切掉的範圍就中止（照原樣分頁）。
GAP = 10           # 疊起來後，上一頁圓圈底到下一頁圓圈頂的距離（pt）；圓圈本身拿掉後也是空白，所以不用留太多
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


def _stub(els, c, where, skip=(), reach=8.0):
    """圓圈上緣（where='top'）或下緣的線頭：原檔線條（或箭頭尖）最靠近該緣的端點；reach pt 內沒有就回 None。
    skip：不算的元素 id（例如要拿掉的、指向圓圈的箭頭，這時找的是箭頭後面那條線的線頭）"""
    r = c['r']; cx = (r.x0 + r.x1) / 2; y = r.y0 if where == 'top' else r.y1
    best, bd = None, reach
    for e in els:
        if e['kind'] != 'path' or not e['vis'] or e is c['el'] or id(e) in skip:
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


def _arrows_into(els, c):
    """箭頭尖碰到圓圈的小實心三角形（指向接點的箭頭）。圓圈拿掉、改成直接連線後，這個箭頭就停在線中間，一起拿掉"""
    box = fitz.Rect(c['r'].x0 - 1.5, c['r'].y0 - 1.5, c['r'].x1 + 1.5, c['r'].y1 + 1.5)
    res = []
    for e in els:
        if e['kind'] != 'path' or not e['vis'] or e is c['el'] or 'f' not in e['dr']['type']:
            continue
        r = e['rect']
        if max(r.width, r.height) <= 12 and r.intersects(box):
            res.append(e)
    return res


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
    out, chars, removed, offs, arrows = [], [], [], [], []
    yend = None
    for k, els in enumerate(pages):
        drop = set()
        top_cut = bot_cut = None
        if k > 0:
            for _, d in joins[k - 1]:
                drop |= {id(d['el']), id(d['txt'])} | {id(a) for a in _arrows_into(els, d)}
            top_cut = min(d['r'].y0 for _, d in joins[k - 1])
        if k < len(pages) - 1:
            for c, _ in joins[k]:
                drop |= {id(c['el']), id(c['txt'])} | {id(a) for a in _arrows_into(els, c)}
            bot_cut = max(c['r'].y1 for c, _ in joins[k])
        arrows.append(drop)
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
        out.append((keep, dy))
        chars.append(_chars(keep))
        yend = (bot_cut if bot_cut is not None else clips[k].y1) + dy
    # 接線：上一頁的線頭（圓圈上方）→ 往下到兩頁中間 → 橫移 → 往下到下一頁的線頭（圓圈下方）
    #   線頭不算指向圓圈、已拿掉的箭頭，找的是箭頭後面那條線的端點，所以接起來是一條完整的線
    links = []
    for k, pr in enumerate(joins):
        da, db = offs[k], offs[k + 1]
        my = max(c['r'].y1 for c, _ in pr) + da + GAP / 2
        segs = []
        for c, d in pr:
            pa = _stub(pages[k], c, 'top', arrows[k], 16)
            pb = _stub(pages[k + 1], d, 'bottom', arrows[k + 1], 16)
            assert pa and pb, '第 %d、%d 段圓圈 %s 找不到線頭' % (k + 1, k + 2, c['L'])
            ax, ay = pa.x, pa.y + da
            bx, by = pb.x, pb.y + db
            segs.append((min(ax, bx), max(ax, bx)))
            sw = c['el']['dr'].get('width') or 0.75
            links.append([(ax, ay), (ax, by)] if abs(ax - bx) < 0.6 else [(ax, ay), (ax, my), (bx, my), (bx, by)])
        segs.sort()
        for (a0, a1), (b0, b1) in zip(segs, segs[1:]):
            assert a1 + 4 < b0, '第 %d、%d 段的接線橫段會重疊' % (k + 1, k + 2)
    svg = _render(out, x0, x1, clips[0].y0, yend, links)
    return svg, ''.join(chars), [x for x in removed if x]
