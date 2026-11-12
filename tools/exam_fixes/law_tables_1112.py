"""2026-11-12：法規資料庫 4 筆「圖片改文字」的排版（Claude 版）。

以 GPT 第二版文字（已對照原始 PDF／DOC／舊圖核對）為底，改成 App 的表格語法：
  【標題】 → 段落標題；「甲 | 乙 | 丙」連續幾行 → 表格（第一行表頭；手機上每列一張卡片）
App v4.36.0 起，非「法規條文」類別的資料有這些標記時，就照 SOP 排版顯示。
文字內容一字不改，只重排；make_fixes_1112.py 會呼叫 fmt(id, gpt_text) 取得排版後內容，並驗證內容沒有遺漏。"""
import re


def _t325(t):
    # 加給表：先放一張級別／數額總表，下面各級的支給對象維持條列（1.、(1) 依層級內縮）
    t = re.sub(r'^【(第[一二三]級)】支給數額 ([\d,]+) 元$', r'【\1　每月 \2 元】', t, flags=re.M)
    head, rest = t.split('\n', 1)
    unit, rest = rest.split('\n', 1)
    amt = re.findall(r'^【(第[一二三]級)　每月 ([\d,]+) 元】$', rest, flags=re.M)
    assert len(amt) == 3, amt
    tbl = '級別 | 每月支給數額（元）\n' + '\n'.join(f'{a} | {b}' for a, b in amt)
    return head + '\n' + unit + '\n\n' + tbl + '\n' + rest


def _t1730(t):
    # 尿液毒品濃度值：一～五維持條文排版，「六、其他」改成表格；代謝物、異構物併入母品項同一列
    a, b = t.split('【確認判定檢出濃度】\n')
    rows, cur = [], None
    for ln in b.strip().split('\n'):
        m = re.match(r'^(\d+)．(.+)：([\d]+ ng/mL)$', ln)
        if m:
            cur = [m.group(1), m.group(2), [m.group(3)]]; rows.append(cur); continue
        m = re.match(r'^（\d）(代謝物|異構物):(.+)：([\d]+ ng/mL)$', ln)
        assert m and cur, ln
        cur[1] += '；' + m.group(1) + '：' + m.group(2)
        cur[2].append(m.group(3))
    out = []
    for n, name, cs in rows:
        c = cs[0] if len(set(cs)) == 1 else '、'.join(cs)
        if len(cs) > 1 and len(set(cs)) == 1:
            c = '各 ' + c
        out.append(f'{n}．{name} | {c}')   # 序號併入品項欄：兩欄的表在手機上仍是表格
    return a.rstrip() + '\n毒品品項或其代謝物 | 確認判定檢出濃度\n' + '\n'.join(out)


_T3154 = """警察機關配備警械種類如下（內政部113年7月8日公告附件）：

【警棍、警刀】
種類 | 品項
警棍 | 木質警棍、膠質警棍、鋼（鐵）質伸縮警棍
警刀 | 各式警刀

【槍械】
種類 | 品項
手槍 | 各式手槍
衝鋒槍 | 各式衝鋒槍
步槍 | 半自動步槍、自動步槍
霰彈槍 | 各式霰彈槍
機槍 | 輕機槍、重機槍
火砲 | 迫擊砲、無後座力砲、戰防砲

【其他器械】
種類 | 品項
瓦斯器械 | 瓦斯噴霧器（罐）、瓦斯槍、瓦斯警棍（棒）、瓦斯電氣警棍（棒）、瓦斯噴射筒、瓦斯手榴彈、煙幕彈（罐）、鎮撼（閃光）彈
電氣器械 | 電氣警棍（棒）（電擊器）、擊昏槍、擊昏彈包
噴射器械 | 瓦斯粉沫噴射車、高壓噴水噴瓦斯車、噴射裝甲車
應勤器械 | 警銬、警繩、防暴網"""


def _t3155(t):
    # 特種工商業範圍表：原表就是「種類｜範圍」兩欄
    pairs = re.findall(r'^【\d+\. (.+?)】\n(.+)$', t, flags=re.M)
    assert len(pairs) == 20, len(pairs)
    head = t.split('\n【')[0].strip()
    tail = t[t.index('附記：'):].strip()
    return head + '\n\n種類 | 範圍\n' + '\n'.join(f'{a} | {b}' for a, b in pairs) + '\n\n' + tail


def _items(s):
    # 驗證用：把文字拆成最小詞項（去掉排版符號），比對新舊版詞項集合相同
    s = re.sub(r'【|】|\||：|:|；|、|，|\n|\s|（\d）|\(\d+\)|^\d+[．.]|各 ', ' ', s, flags=re.M)
    return s


FMT = {325: _t325, 1730: _t1730, 3154: lambda t: _T3154, 3155: _t3155}


def fmt(i, t):
    return FMT[i](t)
