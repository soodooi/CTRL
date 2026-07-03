---
title: ctrl-stock-cn — A股管理助手功能包规划（Irisy 编码创造流，governing）
kind: plan
created_at: 2026-07-03
owner: bao
author: claude (模拟 Irisy)
purpose: bao「不做交易，主要做管理，选股和复盘是重点；按道理是 Irisy 用 coding 能力来开发，也就是用户所需」
serves: 功能包真命题第二个种子 —— 验证「Irisy 用 coding 能力按用户所需开发功能包」（比装现成包更硬的创造中心命题）
related:
  - "[[stock-skill-ecosystem-research.md]]"   # 深研定盘
  - "[[capability-pack-map.md]]"
  - "[[irisy-endpoint-truth.md]]"
  - 002-substrate.md §7.5(产品级三属性) + §7.2(provision) + §14
  - 004-cap.md §1(pack shell 沙箱 — 默认断网,决定了数据层形态)
---

# ctrl-stock-cn — A股管理助手（不做交易；选股 + 复盘是重点）

> **本包的真命题（bao 2026-07-03 校准）**：不是「装一个现成包」，而是 **Irisy 用 coding 能力开发用户所需** —— 用户说需求，Irisy 写代码、建表、写 skill，包随需求生长。dev 的工作 = 把这条编码创造流加固到能跑。
> **不做交易**：无下单、无券商通道。管理（自选/持仓账本/复盘）+ 选股 + 复盘。

## 0. 关键工程事实（决定形态，不能拍脑袋）

1. **pack shell sandbox 默认断网**（ADR-004 §1）→「Irisy 写 fetch 脚本当 pack action 跑」**走不通**（akshare 要联网）。
2. **provision 服务模型是网络的正门**（§7.2，ghostfolio 先例）：manifest 声明本地 service → provision 引擎拉起 → 调用经 `:17873` gate（审计/可见性）。
3. ∴ **Irisy 编码的落点 = 写一个本地数据服务**（Python fastmcp/HTTP + akshare，~百行）+ manifest，而不是写沙箱内脚本。MIT 的 `tradingview-akshare-mcp` 从「直接装」降级为 **Irisy 抄作业的参考实现**（licence 干净，可 crib 结构）。

## 1. 创造流（这就是要验证的能力，每一步都是已有端点）

```
用户:「我要能筛 MACD 金叉的 A股助手」
  ↓ Irisy（coding）
① 写代码   服务源码落 vault: projects/stock-cn/service/main.py（fastmcp + akshare）
            —— vim 可读、git 归属层记 author=irisy、bao 随时能改
② 写包     manifest（service: uv run …/main.py + capabilities + 免责声明）
③ 验证     mcp_pack_validate（evals 先行，坏包不装）
④ 装+起    mcp_pack_install → provision 拉起服务 → mcp_host 连 bus
⑤ 可用     工具以 stock-cn_* 出现在 gate；Irisy 建自选/复盘 smart-table
  ↓ 用户提新需求（「加龙虎榜筛选」）
⑥ 生长     Irisy 改 main.py 加一个 tool → 重起服务 → 新能力上 gate（包随需求生长）
```

**与 ghostfolio 种子的分工**：ghostfolio = 连**现成**自托管 app；stock-cn = **Irisy 现写**的服务。两种形态合起来 = 创造中心全谱。

## 2. 产品信息架构 —— 六 viewer（bao 前次调研，重点加权后）

| 优先 | viewer | 功能点 | CTRL 落法（全部现有端点） |
|---|---|---|---|
| **重点** | ② 选股 Screener | 量化/技术(MACD金叉/趋势共振/强势)/游资/题材选股 + 龙虎榜/北向筛 | `stock-cn_*` 筛选工具 → 结果落 smart-table；筛选条件本身存成可复跑的「策略行」 |
| **重点** | ⑥ 复盘 Review | 日复盘 + 板块轮动复盘 + 交易日记(盈亏归因) + 完成清单 | 复盘 md 进 daily note（note_periodic）+ 交易日志 smart-table + 清单 = task 源 |
| 次 | ① 盯盘/择时 | 自选盯盘+涨跌+择时判词+板块热度+快讯 | smart-table + Sparkline/SmartTableChart（已 shipped）；热力图缺口→色阶列先顶 |
| 次 | ③ 分析 | 单股深挖(技术60/消息30/宏观10 评分)+流派视角+缠/利弗莫尔择时 | 数据工具+知识 skill → doc_produce 决策看板 md |
| 次 | ④ 题材 | 产业链拆解+轮动节奏 | 题材 md + 板块 smart-table |
| 改性质 | ⑤ 持仓（**管理，非交易**） | 真实持仓（ghostfolio 或手记）+ 盈亏/配比 + 模拟账本 | ghostfolio source_query（有则连）+ 持仓 smart-table（手动/半自动记）；**无下单** |

## 2.5 CTRL 版本 v1 收窄（bao 2026-07-03「市场情绪、强度是关键；先把选股和复盘做好，其他后续」）

**v1 只做两件事，两个关键信号贯穿**：

**核心信号（数据服务的第一等公民，全部 akshare 免 key 可得）**：
- **市场情绪**：涨跌家数比 · 涨停/跌停家数 · 炸板率 · 昨涨停今表现（赚钱效应）· 情绪周期阶段判定（冰点/修复/发酵/高潮/退潮 —— 判定规则参考 youzi MIT 情绪周期派 + dalh 92科比四阶段，自写）
- **强度**：连板天梯（最高板/晋级率）· 板块强度榜（涨幅+主力净流入+涨停家数）· 个股强度（量比/换手/相对大盘 RS）

**v1 工具面（Irisy 写的服务，6-8 个 tool）**：
`market_mood()` 情绪总貌+周期阶段 · `limit_ladder()` 连板天梯 · `sector_strength()` 板块强度榜 · `screen_strong(criteria)` 强势股筛选 · `stock_quote(symbols)` · `stock_kline(symbol)` —— 每个返回结构化 JSON，reference 现货：hhxg-python(MIT) 的数据路径 + UZI 的免 key API 注册表。

**选股（重点1）**：筛选条件 = 情绪门槛（周期阶段允许才出手 —— 退哥 market-regime 三态）+ 强度条件（连板高度/板块排名/RS）→ 结果落 smart-table；策略存行可复跑。
**复盘（重点2）**：收盘后一句「今天复盘」→ ① 情绪面（周期阶段+赚钱效应数字）② 强度面（天梯+板块轮动 —— plate-rotation MIT 双源件）③ 自选/持仓表现归因 → 结构化 md 进 daily note + 交易日记表。
**后置**：题材深挖/游资 persona 面板/缠论择时/盯盘 dashboard —— 素材已备齐（附录清单），v1 不做。

## 3. 切片（每片 dev-loop + checker）

| 片 | 内容 | 验收（可验证） |
|---|---|---|
| **P1 编码创造流走通** | 我以 Irisy 身份：写 `projects/stock-cn/service/main.py`（fastmcp+akshare：行情/K线/MACD 筛选 3-5 个 tool，crib MIT 参考）→ manifest（service+免责）→ validate → install → provision 起 → `stock-cn_*` 上 gate | 「筛出今天 MACD 金叉的股票」真机出真数；服务源码在 vault 里 vim 可读；审计 ledger + git 归属（author=irisy）都有记录 |
| **P2 ②选股（重点）** | 筛选工具加全（技术/量化/龙虎榜/北向）；结果表 + 「策略」表（条件存行、一键复跑）；AI 列标注 | 「用我存的『强势股』策略再筛一遍」跑通；结果在 Tables 面板 |
| **P3 ⑥复盘（重点）** | 日复盘生成（当日盘面+自选表现+持仓归因）进 daily note；交易日记表 + 完成清单（task 源）；「今天复盘」一句话三件套 | 连续两天真机复盘，数字全真源、可回溯（note_history） |
| **P4 ①盯盘+③分析+④题材** | 自选表+Chart 视图+择时判词；单股决策看板；题材拆解 md；知识层第一批 commons（缠/利弗莫尔/流派，MIT 现成复用） | 「深挖宁德时代」「新能源题材拆一下」真机 |
| **P5 ⑤持仓管理** | ghostfolio 有则连（source_query 汇合）；无则持仓 smart-table 手记 + 盈亏列 | 「我持仓怎么样」真机（ghostfolio 或手记表） |
| **P6 发布** | evals + `mcp_pack_publish` → `ctrl-stock-cn`（MIT） | Discover 可见可装 |

## 4. 红线

- **不做交易**：无下单工具、无券商凭证。所有「写」都是表格/笔记（照常过 review gate + 审计 + git 归属）。
- **投资免责**：数据+管理工具，非投顾（manifest/README 声明）。
- **前端零 bespoke**：全部走现有 viewer（smart-table/chart/md/daily note/task）。
- **Irisy 写的代码放 vault**（`projects/stock-cn/`）：vim test + git 归属 + bao 可改 —— 代码也是用户资产。
- 锁点不动：5 primitives / 三动词 / gate / plain-text / secret-not-LLM。

## 5. 终局：蒸馏成标准 skill `create-feature-pack`（bao 2026-07-03）

股票包做完后，把整条编码创造流**蒸馏成 Irisy 的标准 skill**，用户从此能用 Irisy 集成任意目标：

| 集成目标 | 形态（两个种子各证一半） | 展示（前端 = CTRL 端点） |
|---|---|---|
| **app**（自托管/本地开源软件） | ghostfolio 形态：REST connector（§14.12 record_source manifest） | smart-table / records view |
| **MCP**（现成 MCP server） | provision + mcp_host 连 bus，工具命名空间上 gate | Irisy 对话 + 表格 |
| **API**（任意 REST/无现成服务） | stock-cn 形态：**Irisy 写本地服务**（fastmcp/HTTP，源码进 vault）+ provision | md 决策看板（doc_produce）/ 智能表格 / **html**（render-html skill 落 vault，workspace 打开） |

skill 内容 = 本 plan §1 创造流的固化：判形态（app/MCP/API 三分支）→ 写码或写 manifest → validate → install → provision → 冒烟 → 选展示面（md/表格/html）→（可选）publish。**教训入册**：上次 create-feature-pack skill「自以为完成实际没落盘」（CLAUDE.md 反例 2026-06-27）——这次先用股票包把流跑真，skill 是从真流程里蒸馏，不是凭空写。

## 6. 待 bao 拍

1. P1 的服务形态：**Irisy 写 fastmcp+akshare 本地服务**（源码进 vault，provision 拉起）—— 对齐「Irisy 用 coding 开发」了吗？
2. 优先序：P1 创造流 → P2 选股 → P3 复盘（两个重点提前），P4-P6 随后 —— OK？
