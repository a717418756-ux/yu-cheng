# 可以給Claude了嗎？交接與審核指令

結論：**可以現在交叉審核；不能當作「800題已全部由現行法核驗正確」的完稿。** 交付 Claude 的任務應是查出缺陷、逐題引證，再協助建立116年警佐第二類專用模擬題，而非直接將800題全部匯入正式題庫。

## A. 真實進度與剩餘疑點
- 原始四科800題及全部原答案、原詳解：已封存。
- 第18輪：最末77題R8（核心有直接依據）、S61（部分支持）、U2（尚缺關鍵現行內規全文）、X6（待修改題幹/答案設計）。69題不能宣稱定案。
- 較早723題屬歷輪「已處理」記錄，**沒有驗證其全數都具官方最新法源**。
- 兩題關鍵缺失：`duty_g2#22`（重大事故情資報告附表）、`duty_v2#2`（聯合指揮所三級開設規定）。
- 六題需修題：`police_v1#15`, `police_v2#29`, `crim_v2#25`, `duty_g2#32`, `duty_g2#39`, `duty_g2#48`。

## B. 重要考科落差
115年警佐班第二類正式四科：國文與憲法、警察法規（警察法、社會秩序維護法、警械使用條例、警察職權行使法）、警察勤務（含警察勤務條例）、刑法及刑事訴訟法。
原800題中的「憲法與法學緒論」**不是**「國文與憲法」；須額外補國文題庫。不要把升官等行政法擴張為警佐二類的獨立考科。

## C. 對Claude逐題覆核的強制欄位
- `id`、`subject`、`exam_scope_match`（二類正式範圍內/跨考科補充/不屬主範圍）
- `original_question`、`options`、`original_answer`、`original_explanation`
- `review_status`（逐選項通過 / 需修正 / 缺權威來源 / 學說爭議）
- `each_option_reason`（對每一項 A-E 判定及理由）
- `primary_source_url`、`exact_article_or_rule`、`promulgation_date`、`effective_date`、`access_date`、`source_type`
- `error_category`、`revised_question`、`revised_answer`、`revised_explanation`、`revision_rationale`
- `past_year_topic`、`future_guess_priority`、`dont_overwrite_original=true`

## D. 處理順序
1. 先修6題X；補2題U的最新權威原文；再審61題S；而後抽查前723題高頻與修法風險。
2. 將800題按「警佐二類正式範圍」重分類。遇跨題或缺國文資料，另列缺口。
3. 另以111–115年官方試題「逐年、逐題」建立可回測清單，預測115年時不可使用115年題目或115年之後新增教材的出題標記。
4. 優先採中央警察大學的**更正版標準答案**；其次採一手法規、憲判、正式警政署函文及有效行政規則。
5. 每輪都輸出一包完整ZIP：保留原始第18輪所有檔案、800筆母檔、所有更正沿革、最新檔和回測補充。

## E. 歷史報考資格注意（不是116年正式公告）
115年第二類簡章列示考試資格須已具警察三等（乙等）或警佐晉升警正官等考試及格；可見升官等目標與警佐二類報考順序有關，正式116年仍須確認。

來源：
- 115年招生官方公告：https://daa.cpu.edu.tw/p/404-1033-45383.php
- 115年警佐班試題：https://se.cpu.edu.tw/p/404-1006-45581-1.php
- 115年更正答案：https://se.cpu.edu.tw/p/404-1006-45649.php
- 114年更正答案：https://se.cpu.edu.tw/p/406-1006-44152%2Cr257.php
- 近年警佐班試題合輯：https://www.kaozen.taipei/police-exam-past-papers/
