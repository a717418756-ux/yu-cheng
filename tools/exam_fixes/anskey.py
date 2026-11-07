"""解析答案 PDF：找出「題號列」（同一行多個連續整數），題號下方到下一題號列之間、x 位置對齊的英文字母即答案。
回傳每頁一組 {題號: 答案字串}（同一份 PDF 多科時依出現順序分段）。"""
import fitz, re, sys, json


def parse(path):
    doc = fitz.open(path)
    blocks = []      # 每段（遇到題號從 1 重新開始就切段）
    cur = {}
    for page in doc:
        words = page.get_text('words')   # x0,y0,x1,y1,text,...
        rows = {}
        for w in words:
            key = round((w[1] + w[3]) / 2 / 3)   # 以 3pt 分行
            rows.setdefault(key, []).append(w)
        lines = sorted(rows.items())
        headers = []
        for k, ws in lines:
            nums = [tuple(w[:4]) + (re.sub(r'[第題]', '', w[4]),) for w in ws if re.fullmatch(r'第?\d{1,3}題?', w[4])]
            if len(nums) >= 5:
                vals = [int(w[4]) for w in sorted(nums, key=lambda w: w[0])]
                if all(b - a == 1 for a, b in zip(vals, vals[1:])) or sorted(vals) == list(range(min(vals), max(vals) + 1)):
                    headers.append((k, sorted(nums, key=lambda w: w[0])))
        for i, (k, nums) in enumerate(headers):
            ytop = k * 3
            ybot = headers[i + 1][0] * 3 if i + 1 < len(headers) else 1e9
            # 欄界：相鄰題號中點
            xs = [((w[0] + w[2]) / 2) for w in nums]
            bounds = [(-1e9 if j == 0 else (xs[j - 1] + xs[j]) / 2, 1e9 if j == len(xs) - 1 else (xs[j] + xs[j + 1]) / 2) for j in range(len(xs))]
            cells = {int(w[4]): [] for w in nums}
            for w in words:
                yc = (w[1] + w[3]) / 2
                if ytop + 4 < yc < ybot - 2 and re.fullmatch(r'[A-E#＃]+|[一-龥]+', w[4]):
                    xc = (w[0] + w[2]) / 2
                    for j, (a, b) in enumerate(bounds):
                        if a <= xc < b:
                            cells[int(nums[j][4])].append((yc, xc, w[4]))
            for n, ws in cells.items():
                if n == 1 and cur and min(cur) == 1 and 1 in cur:
                    blocks.append(cur); cur = {}
                ans = ''.join(t for _, _, t in sorted(ws) if re.fullmatch(r'[A-E#＃]+', t))
                chi = ''.join(t for _, _, t in sorted(ws) if not re.fullmatch(r'[A-E#＃]+', t))
                if ans or chi:
                    cur[n] = ans + (('｜' + chi) if chi else '')
    if cur: blocks.append(cur)
    return blocks


if __name__ == '__main__':
    for b in parse(sys.argv[1]):
        print(len(b), json.dumps(dict(sorted(b.items())), ensure_ascii=False))
