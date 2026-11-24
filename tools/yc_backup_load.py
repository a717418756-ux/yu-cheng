# 讀 Y.C. 平台備份檔（exam_data.json、雲端備份 YC_Platform_backup.json）給工具腳本用。
#   v4.33 起雲端備份、v4.58.2 起本機備份的內容是「gz1:」＋ gzip 後的 base64；舊的未壓縮 JSON 照樣讀。
#   雲端檔可能多包一層 {data:"…"} 或 {ok:true, data:{…}}，最多拆三層（同 settings.js _readExamFile、桌面 yc_backup.load_backup）。
import base64, gzip, json

GZ = 'gz1:'


def gz_unpack(s):
    if isinstance(s, str) and s.startswith(GZ):
        return gzip.decompress(base64.b64decode(s[len(GZ):])).decode('utf-8')
    return s


def load(path):
    with open(path, encoding='utf-8-sig') as f:
        data = json.loads(gz_unpack(f.read().strip()))
    for _ in range(3):
        if isinstance(data, dict) and 'questions' not in data and 'laws' not in data and 'data' in data:
            inner = data['data']
            data = json.loads(gz_unpack(inner.strip())) if isinstance(inner, str) else inner
        else:
            break
    return data
