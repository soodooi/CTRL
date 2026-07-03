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
| **P3 ⑥复盘（重点）** | 日复盘生成（当日盘面+自选表现+持仓归因）进 daily note；交易日记表 + 完成清单（task 源）；「今天复盘」一句话三件套 | 连续两天真机复盘，数字全真源、可回溯（note_history） |
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

## 6. 待 bao 拍## 6. 待 bao 拍

1. P1 的服务形态：**Irisy 写 fastmcp+akshare 本地服务**（源码进 vault，provision 拉起）—— 对齐「Irisy 用 coding 开发」了吗？
2. 优先序：P1 创造流 → P2 选股 → P3 复盘（两个重点提前），P4-P6 随后 —— OK？
