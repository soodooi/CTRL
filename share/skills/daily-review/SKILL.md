---
name: daily-review
description: 「今天复盘」的标准流程——情绪面+强度面+自选归因三段，写进当日 daily note，并更新交易日记表。当用户说「复盘」「今天总结」时使用。
---

# 日复盘流程（按需加载）

1. `stock-cn_market_mood` → 情绪段（阶段+池+炸板率+昨涨停今表现）
2. `stock-cn_limit_ladder` + `stock-cn_sector_strength` → 强度段（天梯高度、晋级情况、强板块 Top5）
3. `smart_table_query` tables/stocks-watchlist.md → 自选段（谁强谁弱，对照大盘）
4. 组装三段 markdown → `note_periodic`(daily, create=true) 拿到路径 → `doc_produce` append_section 追加「盘面复盘 YYYY-MM-DD」
5. 若有交易：追加行到 tables/stocks-journal.md（无表则先建）

红线：每个数字都来自当次调用；缺数据的段落明说「数据源不可用」，不补编。

## 结构化复盘行（追加到复盘表）

daily note 是叙述性复盘；复盘表 `tables/stocks-review.md` 是结构化的可查询/可视化记录（飞书式多视图：grid 编辑 / calendar 按日看 / summary 月度统计）。每次复盘同时 `smart_table_append_row` 追一行：
date / index_pct / mood_stage(select) / zt_count / max_streak / my_action(select: flat|probe|add|trim|exit) / symbols / pnl / attribution / lesson / score(rating)。
mood_stage/zt_count/max_streak 从 `stock-cn_market_mood` 取真值填入 —— 不编。
