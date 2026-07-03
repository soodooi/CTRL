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

| 片 | 内容 | 验收（可验证） |
|---|---|---|
| **P1 数据包成包** | Irisy 流程走通：manifest（`ctrl-stock-cn`，声明外部 MCP：uvx 命令 + provision + capabilities）→ `mcp_pack_validate` → `install` → provision 起 server → mcp_host 连上 bus → 工具以 `stock-cn_*` 出现在 gate | Irisy 真机：「装 A股助手」一句话 → `stock-cn_*` 工具可调；review_gate 已预置 `stock-cn_run` 分类 ✅；审计 ledger 有记录 |
| **P2 自选股表** | `stocks/watchlist.md` smart-table（列：代码/名称/现价/涨跌%/成本/持仓/备注 + AI 列「技术面一句话」）；Irisy 用 `smart_table_produce` 填行情、`run_ai_column` 跑标注 | 「加茅台进自选」「自选今天怎么样」两句真机跑通；表在 Tables 面板可见（**CTRL 端点前端**） |
| **P3 盘前/盘后简报** | 简报 = 数据包工具 + `note_periodic`（写进当日 daily note）+（可选）skill 化成 `a-share-brief` | 「给我盘前简报」→ daily note 里出现结构化简报，数字全真源 |
| **P4 持仓只读** | easytrader / miniQMT 只读桥（需 bao 券商环境）→ 持仓进 smart-table | bao 机器实测；无环境则 mock 验收（诚实 gap） |
| **P5 交易下单** | 下单工具（默认**模拟盘**）；实盘开关显式配置；**每笔订单过 review gate 人工批准** + 审计 + git 归属 | 模拟盘下单全链路：Irisy 提交 → 弹审批 → 批准执行/拒绝取消；**绝无静默下单路径**（测试断言） |
| **P6 发布** | `mcp_pack_publish` → `ctrl-stock-cn`（MIT）；含 evals | 包在 Discover 可见可装 |

## 4. 红线（合规 + 锁点自检）

- **投资建议免责**：包定位 = 数据 + 工具，不是投顾（上游 stock-mcp 同款声明进 manifest/README）。
- **下单三闸**：默认模拟盘 → 实盘需显式配置 → 每笔人工批准（review gate，fail-closed 超时拒绝）。券商凭证走 keychain/credential store，**永不进 LLM**（§14 锁）。
- **前端零 bespoke**：UI = 已有的 records view / smart-table / daily note / Irisy 对话。发现要写新前端 = 设计错了，回来改规划。
- 锁点不动：5 primitives / 三动词 / gate / plain-text（自选股和简报都是 vim 可读的 md）。

## 5. 本规划先要 bao 拍的两个点

1. **P1 外部 MCP 选型**：推 `tradingview-akshare-mcp`（A股专精、failover、缓存）为主；`stock-mcp` 留作多市场升级。OK？
2. **P4/P5 券商通道**：easytrader（模拟客户端操作，脆）vs miniQMT（券商量化终端，要开通）——你用哪家券商/是否有 QMT 权限？P5 前需要这个信息（P1-P3 不阻塞）。
