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

**维度口径（bao 2026-07-03 澄清）**：量/价/换手/成交额/市值等**常规维度全保留**（行情、K线、筛选器都带全列）；情绪+强度是叠在常规维度**之上**的第一等新增信号（普通行情工具没有的那层）。

**核心信号（数据服务的第一等公民，全部 akshare 免 key 可得）**：
- **市场情绪**：涨跌家数比 · 涨停/跌停家数 · 炸板率 · 昨涨停今表现（赚钱效应）· 情绪周期阶段判定（冰点/修复/发酵/高潮/退潮 —— 判定规则参考 youzi MIT 情绪周期派 + dalh 92科比四阶段，自写）
- **强度**：连板天梯（最高板/晋级率）· 板块强度榜（涨幅+主力净流入+涨停家数）· 个股强度（量比/换手/相对大盘 RS）

**v1 工具面（Irisy 写的服务，6-8 个 tool）**：
`market_mood()` 情绪总貌+周期阶段 · `limit_ladder()` 连板天梯 · `sector_strength()` 板块强度榜 · `screen_strong(criteria)` 强势股筛选 · `stock_quote(symbols)` · `stock_kline(symbol)` —— 每个返回结构化 JSON，reference 现货：hhxg-python(MIT) 的数据路径 + UZI 的免 key API 注册表。

**选股（重点1）**：筛选条件 = 情绪门槛（周期阶段允许才出手 —— 退哥 market-regime 三态）+ 强度条件（连板高度/板块排名/RS）→ 结果落 smart-table；策略存行可复跑。
**复盘（重点2）**：收盘后一句「今天复盘」→ ① 情绪面（周期阶段+赚钱效应数字）② 强度面（天梯+板块轮动 —— plate-rotation MIT 双源件）③ 自选/持仓表现归因 → 结构化 md 进 daily note + 交易日记表。
**后置**：题材深挖/游资 persona 面板/缠论择时/盯盘 dashboard —— 素材已备齐（附录清单），v1 不做。

## 3. 切片（每片 dev-loop + checker）

> **P2 基建实录（2026-07-03 凌晨）**：Irisy 经 gate 建 `tables/stocks-watchlist.md`（8 列全维度）+ `tables/stocks-strategies.md`（strong-stocks 策略行：pct≥5/量比≥2/换手≥5/额≥3亿）+ 结果表；**S4 git 归属层首次真实开火** —— pkm 真 vault 里 `irisy <irisy@ctrl.local>` 的合并 commit 三连（agent: smart_table_create…），AI-vs-user 文件层审计成立。**残留（数据窗）**：行情/筛选依赖的全市场 spot 表（东财 push2）与板块源同样凌晨维护 —— 盘中验收：填自选真行情 + 跑 strong-stocks 策略出结果。

> **P1 完成实录（2026-07-03 凌晨，全程真 gate 调用 caller=irisy，审计在册）**：写服务（211 行 fastmcp+akshare，源码 `pkm/projects/stock-cn/service/main.py`）→ validate 首次报缺 actions → 按结构化反馈自纠 → `{"ok":true}` → install 成功 → 暴露通用缺口（`server` 块无人消费）→ **当场修两个 kernel 能力**（装包即连总线 + boot 自动重连，commit `59a32b4`，所有 mcp-server 型包受益）→ app 重启后 `stock-cn_*` 六工具上 gate（104 工具）→ **经 gate 真调 market_mood 返回 07-03 实盘**：涨停池 108/炸板率 32.5%/最高 4 板/周期 ferment。介绍页 intro.md（含真实输出示例）同步产出。**残留**：sector_strength 三源在凌晨维护窗全挂，盘中重验；vault root 乌龙已纠（真 root = `~/Documents/pkm`，文件已搬）。

| 片 | 内容 | 验收（可验证） |
|---|---|---|
| **P1 编码创造流走通 ✅ 2026-07-03 完成** | 我以 Irisy 身份：写 `projects/stock-cn/service/main.py`（fastmcp+akshare：行情/K线/MACD 筛选 3-5 个 tool，crib MIT 参考）→ manifest（service+免责）→ validate → install → provision 起 → `stock-cn_*` 上 gate | 「筛出今天 MACD 金叉的股票」真机出真数；服务源码在 vault 里 vim 可读；审计 ledger + git 归属（author=irisy）都有记录 |
| **P2 ②选股（重点）🟡 2026-07-03 基建完成，待盘中数据验收** | 筛选工具加全（技术/量化/龙虎榜/北向）；结果表 + 「策略」表（条件存行、一键复跑）；AI 列标注 | 「用我存的『强势股』策略再筛一遍」跑通；结果在 Tables 面板 |
| **P3 ⑥复盘（重点）🟡 2026-07-03 复盘模块建成** | 日复盘生成（当日盘面+自选表现+持仓归因）进 daily note；交易日记表 + 完成清单（task 源）；「今天复盘」一句话三件套 | 连续两天真机复盘，数字全真源、可回溯（note_history） |
| **P4 ①盯盘+③分析+④题材** | 自选表+Chart 视图+择时判词；单股决策看板；题材拆解 md；知识层第一批 commons（缠/利弗莫尔/流派，MIT 现成复用） | 「深挖宁德时代」「新能源题材拆一下」真机 |
| **P5 ⑤持仓管理** | ghostfolio 有则连（source_query 汇合）；无则持仓 smart-table 手记 + 盈亏列 | 「我持仓怎么样」真机（ghostfolio 或手记表） |
| **P6 发布** | evals + `mcp_pack_publish` → `ctrl-stock-cn`（MIT） | Discover 可见可装 |

## 3.4 P2 前端展示规划（bao 2026-07-03「规划一下前端如何展示」；全部现有端点，零新组件）

| 面 | 内容 | 用什么（现货核对） |
|---|---|---|
| **Irisy 对话（主面）** | 情绪/天梯/筛选一问一答 | `stock-cn_*` 工具 ✅ 已通；**pack 条按类目聚合**：L1 选股票 → stocks 类包全显（ghostfolio+stock-cn，manifest `category` 字段 + contextPacks 同类归并 —— 2026-07-03 已实装）✅ |
| **自选股表** | `stocks/watchlist.md`：代码/名称/现价/涨跌%/量比/换手/成本/备注 + AI 标注列 | smart_table_create + produce 填行情；Tables 面板 + Sparkline/Chart 视图 ✅ 现货 |
| **筛选结果 + 策略表** | 结果落 `stocks/screens/<date>-<name>.md`；策略存 `stocks/strategies.md`（一行=一组条件），「用策略X再筛」= Irisy 读行→screen_strong→写结果表 | smart-table 全套 ✅ |
| **复盘** | daily note 尾追「盘面复盘」章节（情绪+强度+自选归因）+ 交易日记表 `stocks/journal.md` + 完成清单（`- [ ]`） | note_periodic + doc_produce append_section + task 源 ✅ |
| **板块热度** | 板块表 + 涨跌幅色阶列（热力图降级方案） | smart-table 色阶（前端已有 color 列机制）✅ |
| **包详情** | intro.md 渲染进 Discover/库详情页 | 前端小片（与 §3.5 连通状态同批）⬜ |
| **Stocks scene 工作区** | 打开股票 L1 = FeaturePackScene（actions + 未来 record_source records 视图） | ✅ 现货；record_source 后续加 |

## 3.45 persona × 功能包 组合模型（bao 2026-07-03 钦定，纠正过度设计）

- **persona 只有两个原型**：① **个人助理**（默认，通用）② **coding**（= 写代码 + 建功能包；`code-companion` 终端陪伴 与 `tool-maker` 建包是同一 coding 家族的两个 UI 变体 —— bash-block vs mcp-slot token，底层两套 UI 契约故留两 role，概念同源）。**不为每个域造 persona。**
- **功能包 = 工具 + 知识库(含 skills)，叠加在 persona 上**，不自带 persona。默认组合 = **个人助理 + 功能包**（股票就是这个：助理 persona + 股票包的 KB/skills/工具，专业性全来自包，不需要「盘手」persona —— 我此前造的 trader-desk 是过度设计，已删）。
- **scene→persona 全映射，无裸态**：home/notes/tables/任意功能包 → 个人助理 persona；coding/建包 → coding persona。功能包场景通过 `roleForPack` 自然落到个人助理（未知包→DEFAULT），叠加其 KB scope + skills 一行指针 + 同类包聚合。
- **skills 按需调用**：注入的只是「你的域 skills 在 `<kb>/skills`，任务匹配才 skill_list/skill_read」一行，内容绝不整包灌（渐进披露）。
- **全局 brief 只装跨场景通用能力**；域 playbook 搬进包 KB skills（股票段已搬 → `skills/mood-cycle.md` + `skills/daily-review.md`）。

## 3.5 功能包库 UX 两个必修（bao 2026-07-03 实测反馈）

1. **基础包应显示 connected**：功能包库里 builtin/基础 MCP 应当开箱即连、状态列真实显示 connected（现在用户分不清哪些活着）。落点 = Discover/库页状态列接 `mcp_host.list_installed` 的连接真相 + builtin 自动连接核查。前端小片，排 P2 前。
2. **每个包必须有「图文介绍页」（Irisy 创造流的必产物）**：用户不知道一个 MCP 是什么 → 包详情页 = `intro.md`（这是什么/你可以对 Irisy 说什么/真实输出示例/权限与治理/怎么长大），**Irisy 做包时必须生成**，且输出示例必须来自真实冒烟（防吹牛）。stock-cn 的 `projects/stock-cn/intro.md` 已按此标准产出（含 07-03 实盘 mood 输出）——它就是 create-feature-pack 标准 skill 里「介绍页」一步的模板。库页/详情页渲染 intro.md = 前端小片，与 1 同批。

## 3.6 复盘模块 = 首个产品级智能表格系统（bao 2026-07-03「智能表格操作页面改成产品级；stock 先创建复盘模块」）

**核实定盘**：智能表格单表页面**已是产品级**（`SmartTableView` 36KB：8 视图本地切换 grid/kanban/calendar/chart/gallery/form/summary/timeline + 记录卡侧栏 + 筛选/排序/分组 + 字段编辑器）。用户之前看到「一张表不成系统」是**内容问题**（表少+无关联+screen 前缀漏），非能力问题。

**复盘模块（Irisy 经 gate 建成）**：
- `tables/stocks-review.md` 复盘表，11 富字段（date / select mood 冰点-退潮 / number 涨停数/连板 / select action flat-exit / rating 评分 / text 归因-心得）—— 产品级字段类型。
- 今日真实复盘行（`stock-cn_market_mood` 真数：ferment / 涨停108 / 4板 / 炸板率0.325），数字不编。
- 前端本地即可切 grid（编辑）/ calendar（按日看复盘）/ summary（月度统计）—— 产品级多视图，无需 gate 建。
- daily-review skill 更新：复盘 = daily note 叙述 + 复盘表结构化行（互补）。

**stock workspace 现为 4 表系统**（前缀 tables/stocks-）：watchlist / strategies / screen / review —— 飞书式多维表格 App 雏形。修了 screen 表前缀（P2 漏的）→ 入 workspace。

**待续（成完整「系统」）**：表间关联（自选 reference 个股 / 复盘 rollup 自选表现 / 持仓 lookup 行情）—— 关系型字段能力已在（§14 v30），下一步建关联让 4 表成关联系统。

## 3.7 功能管线驱动的表系统（bao 2026-07-03「建全六 viewer 其余表 + 表间关联，根据功能管线来做」）

**数据管线（表和关联跟着数据流走）**：
```
情绪(mood) + 强度(ladder) ─┐
板块强度(sector工具) ───────┼→ [sectors 板块] ←rollup─ 自选股数
                            │        ↑reference(sector)
[strategies 策略] → 筛选 → [screen 结果] ─加入→ [watchlist 自选] ─建仓→ [positions 持仓]
                                                   │ ↑reference(theme)          │
[themes 题材] ─────────────────────────────────────┘                          │
[analysis 决策看板] ─reference(stock)→ [watchlist] ─lookup name/price          │
每日收盘 → [review 复盘] ←rollup── 当日 positions 盈亏 / watchlist 表现 ────────┘
```

**8 表 ↔ 六 viewer**：
| 表 | viewer | 状态 |
|---|---|---|
| stocks-watchlist 自选 | ①盯盘 | ✅ |
| stocks-strategies 策略 | ②选股 | ✅ |
| stocks-screen-<date> 结果 | ②选股 | ✅ |
| stocks-review 复盘 | ⑥复盘 | ✅ |
| **stocks-sectors 板块** ✅ | ①盯盘热度/④题材 | 建 |
| **stocks-themes 题材** ✅ | ④题材 | 建 |
| **stocks-analysis 决策看板** ✅ | ③分析 | 建 |
| **stocks-positions 持仓** ✅ | ⑤持仓 | 建 |

**关联（reference/lookup/rollup，§14.13 AddField relation；跟着管线）**：
1. `watchlist.sector` → **reference** → sectors（自选股属哪个板块）
2. `watchlist.theme` → **reference** → themes（自选股属哪个题材）
3. `positions.stock` → **reference** → watchlist（持仓来自自选）
4. `analysis.stock` → **reference** → watchlist；`analysis.price` → **lookup** via stock → watchlist.price（决策看板拉现价）
5. `sectors.watch_count` → **rollup** via watchlist.sector → count（板块里我关注几只）
6. `positions.name` → **lookup** via stock → watchlist.name

管线是设计源：新表字段服务于「上游产出→下游消费」，关联让孤立表变成一个数据系统。

**2026-07-03 建成实录（Irisy 经 gate）**：8 表系统全建 —— 新增 sectors/themes/analysis/positions 4 表（含 select 富字段）；6 关系型列真落盘验证：watchlist.sector/theme = reference / positions.stock_ref + name(lookup) / analysis.stock_ref + price(lookup) / sectors.watch_count = rollup(count)。改自选的 sector → sectors 板块的 watch_count 自动变；建仓时 positions 经 lookup 拉自选的 name。**4 孤立表 → 8 表关联系统（飞书式多维表格 App 成型）**。git 归属 author=irisy。**待续**：填真实内容（板块强度真数、题材研究、持仓）+ workspace scene 视觉验收。

## 4. 红线

- **不做交易**：无下单工具、无券商凭证。所有「写」都是表格/笔记（照常过 review gate + 审计 + git 归属）。
- **投资免责**：数据+管理工具，非投顾（manifest/README 声明）。
- **前端零 bespoke**：全部走现有 viewer（smart-table/chart/md/daily note/task）。
- **Irisy 写的代码放 vault**（`projects/stock-cn/`）：vim test + git 归属 + bao 可改 —— 代码也是用户资产。
- 锁点不动：5 primitives / 三动词 / gate / plain-text / secret-not-LLM。

## 5. 标准 skill `create-feature-pack` ✅ 2026-07-03 已蒸馏

从跑通的 stock-cn 真流程蒸馏（非凭空写 —— 上次「自以为完成实际没落盘」的反例已避免）。落 `~/.claude/skills/create-feature-pack/`，已经 gate `skill_list` 验证可发现。

**8 步流程**（Irisy coding persona 按需 skill_read）：0 判形态（app/MCP/API 三分支）→ 1 写服务代码（API 形态，沙箱断网决定必须是 service 非 fetch 脚本）→ 2 写 manifest（无 persona 字段、带 category）→ 3 validate（evals 先行，坏包不装）→ 4 install+connect（返回 `<name>_*` 工具名）→ 5 冒烟真调（唯一「做完」证据）→ 6 **写 intro.md（必产物，输出示例必须来自真实冒烟，防吹牛）**→ 7 KB + 按需 skills → 8（可选）publish MIT commons。

**4 个 reference**（渐进读）：forms.md（三形态判定表）· manifest-template.md · service-template.md · intro-template.md。

**内嵌的架构真相**（= 本 session 定的模型）：功能包不自带 persona（叠在个人助理上）；前端只用 CTRL 端点（smart-table/daily note/FeaturePackScene，零 bespoke）；secret 走 credential store 不进 LLM；域 playbook 进包 skills 不进全局 brief。

**后续迭代空间**（bao「有了基本架构，后续逐步迭代升级」）：app 形态的 record_source 模板补全 · 建包 UI（slot-token）与 coding 终端合一 · publish 自包含打包 · skill 自身随每个新包的实战反馈校准。

## 5.5 硬编码打补丁的清算（bao 2026-07-03「硬编码的都不是系统该做的」）

我承认这一段一直在硬编码打补丁而非让系统通用。bao 点出后清算：

**认错的硬编码**：手改 manifest 塞 `category` · 为过 validate 塞假 `self_check` action · category「聚合」前端特判 · （更早）trader-desk persona + PACK_PERSONAS 映射。这些全违反 §7.4「manifest=数据 / runtime=通用 / 加 pack 零代码」。

**根因**：把「股票有两个包」当问题，然后硬编码「解决」，制造更多特判。系统层面 ghostfolio 与 stock-cn 就是两个独立 manifest，各自数据驱动展示，不该由我硬绑或纠结合并。

**改成系统化的四处（未来所有工具型包零特判受益）**：
- **缺口A（kernel + 前端）**：validate 与 loadInstalledPacks 都只认 actions/record_source → 工具型 `server` 包被拒/不显示，逼我塞假 action。修：两处都接受 `server` 块作为能力面（+ 回归测试）。删 stock-cn 假 action。
- **缺口B（前端）**：无 record_source 的包 scene 空白。修：fallback 渲染包的 `intro.md`（数据驱动，任何声明 knowledge_base + 带 intro.md 的包受益）。
- **缺口C（前端）**：category 聚合特判 → 退，回归「一次一个场景」。
- **清数据**：stock-cn/ghostfolio 手改的 category 去掉；ghostfolio 还原独立（它是持仓接入种子，不是 A股助手）。
- **修 skill**：create-feature-pack 里教的「塞 self_check smoke action」「category 必填」是错的，已改为「server 包自成立、不塞假 action、category 可选、intro.md 是工具包的 scene 展示」。

结果：424 kernel 测试 + tsc + ratchet 全绿。**stock-cn 现在是纯工具包，validate 过、前端显示、scene 展示 intro.md，零硬编码。**

## 6. 待 bao 拍## 6. 待 bao 拍

1. P1 的服务形态：**Irisy 写 fastmcp+akshare 本地服务**（源码进 vault，provision 拉起）—— 对齐「Irisy 用 coding 开发」了吗？
2. 优先序：P1 创造流 → P2 选股 → P3 复盘（两个重点提前），P4-P6 随后 —— OK？

## 4. 架构参考:ChanStock(全栈缠论产品)+ 缠论参考栈(2026-07-06)

bao 校准:「获取真实可用 skill/产品做参考」——不重造轮子,以真实产品为架构模板。

### 架构参考 = `ChanStock`(TensorCode666/stock-chanlun,完全开源)
一个活体缠论股票产品,形态就是 CTRL 股票包该有的样子:
```
数据(多源降级 新浪→腾讯→东财, AKShare)
  → 缠论识别(5-K分型 → 笔 → 线段 → 中枢 → MACD面积背驰 → 三类买卖点)
  → 指标(TA-Lib)+ 规则引擎(可无 LLM 运行)
  → AI 可选(DeepSeek/Gemini 自然语言缠论 + SSE 流式对话)
  → 前端 Vue3 + ECharts(LTTB 降采样扛 600+ K线)+ 自选/筛选
```
**对 CTRL 的映射**:数据层→pack 服务(Ashare/腾讯多源,已做,此机代理墙需真机)· 缠论识别→(未来 czsc 引擎或 AI 代理级)· 规则引擎兜底→one-shot gate 工具 · AI 层→Irisy · 前端→smart-table(自选监控 stocks-monitor)+ 未来 K线 viewer。**数据源级联(新浪→腾讯→东财)印证了可达源打法。**

### 缠论参考栈(取两样 + 一避雷)
- **纪律层 → `chanlun-trading-system`(MIT skill)**:结构优先门控(先定级别/先认结构/先写失效点;指标只是过滤器不定义买卖点)。**已吸收进 `stock-analysis-cn` skill 的个股分析(结构先行 → 指标过滤 → 决策带失效点)。**
- **计算引擎 → `czsc`(Apache 5.4k★)/ `chan.py`**:自动 分型/笔/中枢/背驰 + 220 信号。做真结构识别时 crib/调它。
- **⚠️ 避雷 `chanlun-pro`(yijixiuxin)**:名义 Apache 实则微信授权付费门。

## 7. N 系列重规划(bao 2026-07-11 拍板;hephaestus pack-builder 窗口执行)

> bao 校准 ×2:「开发功能包是 Irisy 来做」+「你要建立整个流程和能力」。P1-P3 已完成(P3 还长出了 launchd 收盘 cron),P4 过半;N 系列接着干,全程经 `:17873` gate 以 caller=irisy 驱动(审计在册),dev 只加固流程不替 Irisy 写包。

**新输入(bao 提供,~/Downloads 三个第三方 skill,2026-07-11)**:
1. **炒股养家 skill**(SKILL.md + 6 refs ~1300 行):养家心法——大局观/情绪博弈/概率/知行合一/反向博弈 + 8 条决策启发式。
2. **顶级游资联盟会诊 skill**(Python 系统):12 游资(心法型5/战法型5/席位型2)独立推演 → 六维度 → 分歧识别(自然语言不投票)→ 综合报告;16 类数据采集层 + EmotionState 契约;12 份游资心法 md。
3. **股市复盘全流程模板**(轻):五模块复盘(大盘环境/板块主线/连板梯队/情绪周期/次日策略)+ 合规词汇表(建议→策略分析/推荐→值得关注/买入→关注/卖出→离场)。

**整理决策**:知识层归包 KB(§6 标准);养家蒸馏成**镜片**非 persona(§3.45 两原型锁);**不 vendoring 会诊 Python 引擎**(Irisy 即推演引擎,AI-is-pipe + 轻量最小),data_layer 只当 N2 数据面 gap 清单 + 端点 crib 参考;复盘模板并入 daily-review skill。落点:`projects/stock-cn/skills/{yangjia-lens,trader-council,daily-review}.md` + `knowledge/traders/`(12 份)+ `knowledge/yangjia/`(6 refs)。
**⚠️ 版权红线**:三者是第三方付费材料,本地 KB 个人用 OK;**P6/N6 publish(MIT commons)不得原样打包**,发布物须自写蒸馏或剔除(knowledge/README.md 已注明)。

| 片 | 内容 | 验收 |
|---|---|---|
| **N1 知识层落 KB** | 三个 skill 蒸馏 + 心法/参考文件搬运,经 gate vault_write(caller=irisy) | vault 落盘 + gate vault_read 真读到 + 审计在册 |
| **N2 数据面补齐 + 修活口** | 按 EmotionState 契约补缺:北向/两融/公告/要闻/概念三层/分时/同板块龙头;修收盘 cron「AI 信号」503 | 新工具经 gate 真调出数;收盘任务连续全绿 |
| **N3 会诊真跑** | 模式A(代码)/模式B(新闻)全流程,报告落 reports/ + analysis 表 | 真机一次完整会诊,数字全真源 |
| **N4 复盘升级验收** | 五模块模板生效 | 连续两天自动复盘全绿、可回溯 |
| **N5 持仓管理**(原 P5) | 持仓手记表 + 盈亏列填活 | 「我持仓怎么样」真机 |
| **N6 发布**(原 P6) | evals + publish(剔第三方版权内容) | Discover 可见可装 |

**N1 实录(2026-07-11,已完成)**:
- **落盘**:`knowledge/traders/` 12 份 + `knowledge/yangjia/` 6 份 + `skills/{yangjia-lens,trader-council,daily-review}.md` + `intro.md`(加会诊/养家入口 + 知识层说明),镜像同步到 `~/.ctrl/mcps/ctrl-stock-cn/`。**验收**:三 skill + intro + 小知识文件经 gate `vault_read`(caller=irisy)真读到,审计在册;大文件(16KB 级 CJK)读写触发 N2-0 bug(下条),改直接落盘(plain-text 即 truth,vim-test 过)。
- **🐛 N2-0(新发现,N3 会诊的硬前置)**:gate `vault_read`/`vault_write` 对**刚修改的大 CJK 笔记**(≈16KB 心法档案)永久挂起 —— 无审计行、kernel 0% CPU(park 等待非自旋)、同时 `vault_list`/`kernel_status`/`mcp_pack_list`/小文件读写全部秒回。repro:写/读 `knowledge/traders/Asking.md`(16781B)必挂,合成 ASCII 100KB 与 CJK 12k 字**新**文件不挂。嫌疑:按大小/变更触发的同步重嵌入(embed)等待一个不返回的通道(参考 2026-07-07 `spawn_blocking` 饿死同族教训:先查 async 路径里的阻塞/死等,账本才是真相)。N3 要 Irisy 读 12 份心法档案 → 此 bug 不修会诊跑不了。
- 收盘 cron「AI 信号」503 根因当场找到:python urllib 在无代理环境变量时回退读 **macOS 系统代理(Clash)**,把 127.0.0.1:17873 的请求送进代理 → 503/连接被断;修法 = `ProxyHandler({})` 显式禁代理(N2 落到 `cron/close.py`;会诊 skill 的 data_layer 同样满地 `os.environ.pop("HTTP_PROXY")`,同病相怜的旁证)。
- gate streamable-HTTP 驱动注意:响应 SSE 流在结果后可能继续推事件,客户端要按 request id 流式取果即断,读到 EOF 会挂。

**N2 实录(2026-07-11,已完成)**:
- **N2-0 修复 + 活体验证 ✅**:根因不是嵌入死等,是**审计账本按字节截断 UTF-8**——`persistence.rs:73` 的 `r[..4000]`(结果路径,读挂)+ `audit.rs:128` 的 `String::truncate(4000)`(args 路径,写挂,且 panic 在 dispatch 前所以文件不落盘)。字节 4000 落在 CJK 字符中间 → tokio 工具任务 panic → SSE 响应永不发送(心跳还在)→ 客户端永挂、无审计行。铁证:tauri-dev.log 里 19+15 次 panic,与字节二分定位的「完」字逐字对上。修法 = `floor_char_boundary` helper 两处落地 + 两条回归测试(3 字节 CJK 跨界 payload);440 lib 测试绿;**worktree 构建 headless kernel(:17999)活体复现原挂死用例 → 秒回**,账本截断行(caller=irisy,行尾 …<truncated>)落盘验证。教训:「kernel 0% CPU + 心跳还在 + 无审计行」也可能是 **panic 杀了任务**,不只是阻塞饿死——先翻 tauri-dev.log 找 panic。
- **cron 代理修复 ✅**:`cron/close.py` 换 `ProxyHandler({})` opener;同形状 initialize 直连活 gate 返回 200(修前 503)。活体全绿验证 = 今晚 18:30 收盘任务。
- **数据面补齐 ✅(6 新工具,10→16)**:`north_flow`(北向历史;净买额 2024-08 起交易所停发→返回仍活的领涨股/沪深300 列)· `margin_trading`(上交所两融)· `stock_notices`(个股公告)· `stock_news`(要闻/个股新闻)· `stock_concepts`(行业+概念板块两层,当日热度由 sector_strength 补第三层)· `stock_minutes`(1/5/15/30/60 分钟,走 EM 镜像 failover——akshare 分钟路径钉死主机会超时;EM 分钟 lmt 从窗口头数,需自己取尾)。全部函数级真数据冒烟绿(茅台公告/两融 14712 亿/07-10 收盘分时);同板块龙头 = leaders+sector_strength 组合,不加独立工具。trader-council skill 数据表 + intro.md 已同步,vault 与已装副本一致。
- **诚实缺口**:kernel 修复与新工具要**下次 app 重启**才上活 gate(运行中 app 从 main 检出构建 + 服务只在 boot 连接);重启后补 gate 级冒烟(读 Asking.md + 调 stock-cn_north_flow)。

**N3 实录(2026-07-11,已完成——12 游资会诊真跑,模式A)**:
- **执行环境**:PR #173 尚未合并时,用 worktree 构建的 **headless kernel(:17999,带 N2-0 修复)**跑通全程——真 kernel/gate/vault/数据,审计落同一账本;给 `ctrl_kernel.rs` 补了「boot 重连已装包」钩子(`reconnect_installed_pack_servers`,与桌面 app 同一钩子),stock-cn **16+1 工具首次全量上 gate**。
- **会诊标的:海兰信 300065**(07-10 真龙头:20cm 大长腿 + 龙虎榜净买 4.33 亿 + 重组催化)。**采集 29/29 全绿**:17 个数据调用(16 工具 + 概念双口径)+ 12 份心法档案 vault_read(最大 13.5K 字符 CJK,修复前必挂)。市场判定:退潮期(炸板率 49.7%/最高 2 板/两融五连降)vs 个股极强(超大单 +11.69 亿),矛盾局。
- **产出**:六维度 × 12 镜片独立推演 + 4 个自然语言分歧(超强势股 vs 龙头 / 退潮期能否出手 / 技术超买 vs 资金抢筹 / 席位型内部耐心分歧)+ 共识(无人主张现价追高;明日=判决日)+ 三剧本策略分析(合规词汇)。报告 `projects/stock-cn/reports/council-2026-07-11-300065.md`(**8.5KB CJK 经 gate 写入+回读双绿 = N2-0 两条路径的终极活体验证**);`tables/stocks-analysis.md` 追结论行(32/24/3, watch, 判决日剧本)。审计:1 小时窗口 caller=irisy 39 行在册。
- **小坑**:`smart_table_append_row` 的 values 只收字符串(整数 32 被拒),客户端侧转字符串即可——引擎侧是否该宽容收数值,留观察。
- **验收对照**:「真机一次完整会诊,数字全真源」✅(headless=真 kernel,honest note:非桌面 app 实例);合并+重启后 PWA 侧可直接在 Tables 面板看到结论行。

### skill 现状(股票功能包的知识层)
包挂三个可发现 skill,各司其职、互不冲突:
- **`stock-analysis-cn`** —— 个股深挖(结构优先 regime-framed:市场→缠论结构→指标过滤→决策)。已吸收缠论纪律。
- **`mood-cycle`** —— 情绪周期(92科比四阶段判定 + 纪律)。
- **`daily-review`** —— 日复盘(情绪+强度+归因三段)。
方法论全部以真实可用产品为参考(92科比/缠论/板块轮动),不自造。

## 6. pack skill 归属标准 + backlog（bao 2026-07-07「那就干吧」拍板）

### 标准：pack skill 归包 KB，经 vault_read 读（不落全局 `~/.claude/skills`）
- **一个功能包的 skill 属于这个包**：canonical home = 包 KB `<kbDir>/skills/*.md`（stock-cn = `projects/stock-cn/skills/{stock-analysis-cn,mood-cycle,daily-review}.md`），manifest 声明 `skills[]` + `knowledge_base`，打开场景注入「你的域 skills 在 `<kbDir>/skills`」一行指针，Irisy 按需 **vault_read** 取。
- **不再往全局 `~/.claude/skills` 放 pack skill**（那是 dev/个人层，如 `create-feature-pack`）。理由:包越多全局层越污染命名空间;包 KB 自洽(装包即带方法论、卸包即走)、检索按 kb scope 收敛、可随包分发。对齐 ADR-002 §7.4（manifest=数据 / runtime=通用 / 加包零代码）+ 本 GOAL 的功能包命题。
- 2026-07-07 落实:三个 stock skill 已从 `~/.claude/skills` 撤下,只留包 KB。**所有后续功能包按此标准**（写进 `create-feature-pack` 标准 skill 的「7 KB + 按需 skills」步)。

### backlog（记着,非本片）
- ~~**gate `skill_read` 并发挂起 bug**~~ **✅ 已修(2026-07-07,commit `15a77e0`)**：根因不是玄学并发,而是**阻塞 fs I/O 跑在异步运行时上** —— `list_local_skills`/`read_local_skill` 是 `async fn` 但函数体全是同步 `std::fs`(尤其 `list_local_skills` 对 `~/.claude/plugins/cache` 做三层无界递归遍历 + 逐个 `read_to_string`)。gate 经共享 tokio 运行时服务它们 → 阻塞调用直接占 async worker 线程 → plugin 缓存一大就把线程池饿死 → SSE session 读不到下一条消息、只剩 20s 心跳、连 trivial `skill_read` 都排在饿死 worker 上挂几分钟;`vault_read` 恰在没被饿死那刻就秒回 = 间歇性来源。修法 = 标准 tokio 铁律 `spawn_blocking`(挪到阻塞线程池,永不饿死 async worker;`mcp_server.rs:3343` 已有先例)。验证:cargo build 干净 + 442 lib 测试全绿;活体 load 证据需 app 在跑(诚实 runtime gap,饿死负载相关、不好单测确定性复现)。**教训**:「间歇挂起 + 心跳还在」= 运行时被阻塞 I/O 饿死的典型味道 —— 先查 async fn 里有没有裸 `std::fs`,别先怀疑锁(账本才是真相,memory `feedback-read-audit-ledger-not-guess-irisy`)。
- **(观察,非急)** Skills capability-face 目前全局-only:`skill_list`/`skill_read` root 只扫 `~/.claude/skills` + plugin cache,够不到包 KB。终态可把「当前活跃包的 `<kb>/skills`」并进 root,让 pack skill 成为 Skills face 一等公民(并发既已修好、skill_read 可靠了,这增强更划算)。不与「归包 KB」标准冲突(KB 仍是唯一 home),留作单独增强片。
