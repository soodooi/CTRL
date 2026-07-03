---
title: ctrl-stock-cn — A股交易助手功能包规划（Irisy 创建流演练，governing）
kind: plan
created_at: 2026-07-03
owner: bao
author: claude (模拟 Irisy)
purpose: bao「接下来做功能包能力；你模拟 Irisy；外部 app + MCP 连接；ctrl 前端用 ctrl 端点；先规划；先做 A股股票交易助手功能包」
serves: 功能包真命题第二个种子（ctrl-ghostfolio 之后）——「把开源软件变 AI-native」在金融垂直的落地 + Irisy 创作流的活体测试
related:
  - "[[stock-skill-ecosystem-research.md]]"   # 深研定盘（101 agent / 3 个 SKILL.md 真读）
  - "[[capability-pack-map.md]]"
  - "[[irisy-endpoint-truth.md]]"
  - 002-substrate.md §7.5(产品级三属性) + §14.12(通用 connector source) + §14.13(统一写侧)
---

# ctrl-stock-cn — A股交易助手功能包（规划）

> **角色设定（bao 钦定）**：本包由**Irisy 创建**（我模拟 Irisy 的创作流，dev 只加固流程）——「connectors are built by Irisy, not the dev」。
> **架构公式**：**外部 app（现成 MIT 股票 MCP server，本地 provision）× MCP 连接（经 `:17873` gate 治理）× CTRL 前端（只用 CTRL 端点：smart-table / §14 records view / Irisy 对话）**。

## 0. 深研已定盘的三个前提（stock-skill-ecosystem-research.md）

1. **数据层才是功能包该做的**（每个炒股 skill = 数据层 + 知识层；知识层是薄 markdown commons，以后叠）。
2. **现成 MIT 数据 MCP 可直接复用**：`kylefu8/tradingview-akshare-mcp`（A股专精：10 个 TA 工具，AkShare 主源 + Sina/Tencent failover，30s 缓存 + 本地 Parquet）或 `huweihua123/stock-mcp`（A/美/ETF/crypto 聚合）。**不重造数据轮子。**
3. **下单全行业强制人工确认** → CTRL 的 review gate 天然正对；社区无真实下单（合规），券商侧才有。

## 1. 用户故事（产品级三属性，§7.5 验收杆）

OPC 用户（非技术）对 Irisy 说：
- 「帮我装一个 A股助手」→ **创造中心**：Irisy discover→validate→install→provision，一句话装包
- 「把 贵州茅台、宁德时代 加进自选」→ 自选股 = **smart-table**（Bitable-parity 的那张表）
- 「今天自选股怎么样？」→ 行情经 gate 进表格；AI 列跑技术面/异动标注
- 「明早 9 点给我盘前简报」→ 简报写进**当日 daily note**（note_periodic 端点）
- 「买入 100 股 XX」→（P5）**review gate 弹人工确认**，批准才执行——绝不静默下单
- 「分享这个包」→ **分享中心**：mcp_pack_publish → `ctrl-stock-cn`（MIT commons）

## 1.5 产品信息架构 —— 六个 viewer（bao 供的前次调研，2026-07-03 收进唯一规划）

> 这是包的 **workspace 蓝图**（per-L1 workspace：功能包拥有自己的工作区，Irisy 把产出路由进来）。每个 viewer 都映射到**已有的 CTRL 端点/视图**，逐格核过：

| # | viewer | 功能点 | CTRL 落法（现有能力核对） |
|---|---|---|---|
| ① 盯盘/择时 | dashboard(summary+chart+banner) | 自选盯盘+现价涨跌+市场环境择时(缠/利弗莫尔判「激进/回调/空仓」)+板块热力图+热门概念+快讯 | 自选/涨跌 = smart-table + **Sparkline/SmartTableChart ✅**；择时判词 = Irisy+知识 skill 写进 markdown 看板；**热力图 = 唯一真缺口**（先用板块表排序+色阶列顶，热力图 viewer 后补） |
| ② 选股 Screener | SmartTable(条件进→结果表) | 量化/技术(MACD金叉/趋势共振/强势)/游资/题材选股+龙虎榜/北向筛 | `stock-cn_*` 筛选工具 → 结果落 smart-table（§14 typed query 天然是条件面）✅ |
| ③ 分析 Analysis | markdown 决策看板 | 单股深挖:技术60%+消息30%+宏观10% 评分/信号+6游资流派视角+缠/利弗莫尔择时点 | Irisy 调数据工具+知识 skill → `doc_produce` 写决策看板 md（Tiptap 渲染）✅；流派 = 知识层 commons |
| ④ 题材 Themes | markdown + sector SmartTable | 题材深挖(产业链上下游/传导逻辑/核心企业)+板块轮动节奏 | 题材 md（web_search+数据工具落 doc_produce）+ 板块 smart-table ✅ |
| ⑤ 持仓 Portfolio | SmartTable(grid+chart) | 真实持仓(**ghostfolio**)+盈亏/配比+模拟盘买卖+下单(review gate 人工确认) | **两个种子包在此汇合**：真实持仓走 ctrl-ghostfolio 的 source_query；模拟盘 = smart-table 账本；下单 P5 三闸 ✅ |
| ⑥ 复盘 Review | markdown + 交易日志 SmartTable | 日复盘+板块轮动复盘+交易日记(盈亏归因)+完成清单 | 复盘 md 进 **daily note**（note_periodic）+ 交易日志 smart-table + 清单 = task 源（`- [ ]`）✅ |

**核对结论**：六格里五格纯现有端点组合（smart-table/chart/timeline/doc_produce/note_periodic/task/ghostfolio source），唯一前端缺口 = ①的板块热力图（降级方案先行，不阻塞）。

## 2. 架构（每层用什么、为什么）

```
外部 app 层   tradingview-akshare-mcp（MIT, 本地 uvx/pip 起, AkShare+新浪/腾讯 failover）
                │  stdio MCP（provision 引擎 §7.2 一键静默装起）
gate 治理层   :17873 mcp_host 注册 → 工具以 stock-cn_* 命名空间出现
                │  可见性(intent) + 审计(ledger) + 写审(review gate) + secret 不进 LLM
§14 化层     manifest record_source（§14.12 零代码）: 行情/K线 → source_describe/query
                │  自选股/持仓 = smart-table（§14.13 produce 全套 + AI 列）
CTRL 前端    只用 CTRL 端点：FeaturePackScene records view + TablesPanel + Irisy 对话
                │  （不为这个包写任何 bespoke 前端 —— bao 红线）
知识层(后叠)  游资/策略 skill = markdown commons 骑在数据包上（MIT 现成可复用）
```

**与 ghostfolio 包的分工**：ghostfolio = 「连用户自托管的开源 app」形态（REST connector）；stock-cn = 「provision 一个数据 MCP 当外部 app」形态（stdio MCP）。两个种子覆盖功能包的两种主形态。

## 3. 切片（每片 dev-loop + checker；P1-P3 不需要券商环境）

| 片 | 内容（映射 viewer） | 验收（可验证） |
|---|---|---|
| **P1 数据包成包** | Irisy 流程走通：manifest（`ctrl-stock-cn`，声明外部 MCP：uvx 命令 + provision + capabilities）→ `mcp_pack_validate` → `install` → provision 起 server → mcp_host 连上 bus → 工具以 `stock-cn_*` 出现在 gate —— **喂全部六格的数据地基** | Irisy 真机：「装 A股助手」一句话 → `stock-cn_*` 工具可调；review_gate 已预置 `stock-cn_run` 分类 ✅；审计 ledger 有记录 |
| **P2 ①盯盘+②选股** | 自选股 smart-table（现价/涨跌 + Sparkline/Chart 视图 + AI 列标注）+ 筛选条件→结果表；市场快讯列 | 「加茅台进自选」「自选今天怎么样」「筛 MACD 金叉的强势股」真机跑通；Tables 面板可见 |
| **P3 ①择时+③分析+⑥复盘骨架** | 择时判词+盘前/盘后简报进 daily note（note_periodic）；单股决策看板 md（doc_produce）；知识层第一批 commons（缠/利弗莫尔/流派 skill 复用 MIT 现成） | 「给我盘前简报」「深挖一下宁德时代」→ daily note + 决策看板生成，数字全真源 |
| **P4 ④题材 + ⑤持仓只读** | 题材深挖 md + 板块表；真实持仓接 **ctrl-ghostfolio**（两种子汇合）；easytrader/miniQMT 只读（需 bao 券商环境） | 「新能源题材拆一下」「我持仓怎么样」真机；无券商环境则 ghostfolio+mock 验收（诚实 gap） |
| **P5 ⑤下单** | 模拟盘账本买卖（smart-table produce）→ 实盘（显式开关）；**每笔订单过 review gate 人工批准** + 审计 + git 归属 | 模拟盘全链路：Irisy 提交 → 弹审批 → 批准执行/拒绝取消；**绝无静默下单路径**（测试断言） |
| **P6 ⑥复盘完整 + 发布** | 交易日记表+盈亏归因+完成清单（task 源）；`mcp_pack_publish` → MIT commons | 「今天复盘」一句生成三件套；包在 Discover 可见可装 |

## 4. 红线（合规 + 锁点自检）

- **投资建议免责**：包定位 = 数据 + 工具，不是投顾（上游 stock-mcp 同款声明进 manifest/README）。
- **下单三闸**：默认模拟盘 → 实盘需显式配置 → 每笔人工批准（review gate，fail-closed 超时拒绝）。券商凭证走 keychain/credential store，**永不进 LLM**（§14 锁）。
- **前端零 bespoke**：UI = 已有的 records view / smart-table / daily note / Irisy 对话。发现要写新前端 = 设计错了，回来改规划。
- 锁点不动：5 primitives / 三动词 / gate / plain-text（自选股和简报都是 vim 可读的 md）。

## 5. 本规划先要 bao 拍的两个点

1. **P1 外部 MCP 选型**：推 `tradingview-akshare-mcp`（A股专精、failover、缓存）为主；`stock-mcp` 留作多市场升级。OK？
2. **P4/P5 券商通道**：easytrader（模拟客户端操作，脆）vs miniQMT（券商量化终端，要开通）——你用哪家券商/是否有 QMT 权限？P5 前需要这个信息（P1-P3 不阻塞）。
