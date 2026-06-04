# RPA vs API vs MCP — 集成层对比 + CTRL 视角下的判断

**Date**: 2026-06-04
**Trigger**: bao 2026-06-04 — "调研一下，什么是 RPA，跟 api，mcp 对比一下"
**Status**: 科普 + 战略思考 doc；无 ADR 改动诉求；CTRL 立场判断已锁在文末

---

## TL;DR

三者**不是替代关系，是层级**：

- **API** = 程序间结构化接口，**基础设施**。
- **MCP** = API 之上的 **agent 适配层**（绝大多数 MCP server 内部就是包一层 API）；让 LLM agent 能用标准化方式调 N 个工具，不用各自 glue。
- **RPA** = 当目标系统**没有 API** 时的 **UI fallback**——软件机器人模仿人点击 / 键入 / 读屏 / OCR 跨系统串流程。

CTRL 立场（详见 §5）：
1. keycap 协议 = MCP（ADR-002 §7 锁），不变。
2. 第三方 backend 接入优先 API → 没 API 才考虑 RPA。
3. RPA 工具（UiPath / Power Automate Desktop / 影刀 / 弘玑 / 来也）可作 **keycap source**（用户自带，CTRL 提供 hotkey + workspace 显示），但**不进 substrate**（不在 CTRL 内核里塞一个屏幕代理 agent，会破坏 vim test + 端侧化哲学）。
4. OPC tool aggregator 重定位（memory `decision_ctrl_repositioned_as_aggregator`）视角下，RPA 类工具应在 Discover 网页有 rating / 评测条目，跟 SaaS / CLI / MCP server 并列。

---

## 1 三者定义 + 起源

### 1.1 RPA (Robotic Process Automation)

软件机器人模拟人在 GUI 上的操作来跨系统串流程。

- **起源**：~2000s 初，从屏幕抓取 (screen scraping) + UI automation testing 工具演化而来；2012 左右 Blue Prism / UiPath / Automation Anywhere 商业化定型。
- **本质**：把人当 API 用——目标系统拒不开放 API 时，让机器人通过 UI 还原"如果一个人在做这件事会按哪些按钮"。
- **代表产品**：
  - 海外：UiPath, Automation Anywhere, Blue Prism, Microsoft Power Automate Desktop, WorkFusion
  - 国内：影刀 RPA（杭州，金融 / 电商）、弘玑 Cyclone、来也科技 UiBot、阿里云 RPA、实在智能
- **典型用法**：财务对账（拉飞书审批 → 填 SAP → 截图回填 OA）、电商搬运（A 平台库存 → B 平台上架）、政务表单填报、银行 mainframe 抽数。

### 1.2 API (Application Programming Interface)

程序间的结构化接口，约定数据 schema + 调用方式。

- **形态**：REST / GraphQL / gRPC / SOAP / 厂商 SDK / WebSocket / Webhook。
- **本质**：双方达成显式契约，结构化数据交换；不依赖任何视觉表现。
- **接入前提**：**目标系统主动暴露**，并发 key / OAuth credential。
- **现代假设**：所有云原生 SaaS 默认有 API（Stripe / Notion / Linear / Slack / Figma / GitHub / Cloudflare），但老系统（用友 NC / 金蝶 EAS / 部分政务平台）仍然没有，或 API 仅给企业版客户。

### 1.3 MCP (Model Context Protocol)

Anthropic 2024-11 开源协议，标准化 LLM agent 调外部 tool / 读 resource / 取 prompt 的方式。

- **形态**：JSON-RPC over stdio / WebSocket / SSE；client（agent，如 Claude Code / Cursor / Cline / Continue / Zed）和 server（暴露工具的进程）双向通信。
- **本质**：解决"N 个 agent × M 个工具 = N×M 适配"的胶水爆炸问题——让每个工具实现一次 MCP server，所有 agent 即可消费。同样作用 USB 对硬件 / LSP 对 IDE。
- **生态**：
  - 官方 server: filesystem, github, postgres, slack, google-drive, puppeteer, sentry, brave-search …
  - 社区 server 已数千个（mcp.so, glama.ai/mcp, smithery.ai 三大目录）
  - 接受方：Anthropic Claude (官方), OpenAI GPT (2026 起官方支持), Cursor, Cline, Continue, Zed, Windsurf, JetBrains, 国内 Trae / 通义灵码也已实装
- **接入前提**：需有人写 MCP server（通常是 ~200 LOC 薄 wrapper, 内部包 API / CLI / DB / 文件系统）。
- **CTRL 关系**：ADR-002 §7 已锁——所有 keycap 通过 MCP 暴露给 Pi brain。

---

## 2 12 维度对比表

| 维度 | RPA | API | MCP |
|---|---|---|---|
| **集成层** | UI / GUI 像素 / DOM / accessibility tree | 程序间 schema | LLM agent 与 tool 之间的标准化协议 |
| **接入主体** | 拟人（机器人扮演用户） | 程序 ↔ 程序 | LLM agent ↔ tool server |
| **目标系统配合度** | 不需要（**最大优势**） | 必须主动暴露 + 发 key | 需有人写 MCP server（薄 wrapper, 通常包 API / CLI） |
| **稳定性** | UI 改版即坏（**最大痛点**） | 高，破坏性变更走 v2 | 高，schema 化 tool 定义 |
| **执行速度** | 慢（受人类操作时序 + UI 渲染等待限制） | 快（毫秒级） | 快（毫秒级 tool 调用 + LLM 推理） |
| **维护成本** | 高（脚本脆弱，UI 微改就要 revisit；专门 RPA developer 岗位） | 中（跟随 version 升级 + breaking change） | 低（schema 自描述，LLM 自适应参数变化） |
| **可观测性** | 录屏 + 日志，难自动断言 | log + metric + trace 成熟 | tool call trace 天然结构化（agent 历史可重放） |
| **凭证模型** | 机器人持员工账号登录（合规灰区，审计困难） | OAuth / API key 细颗粒授权 + scope | OAuth + capability scope（spec 仍在演进，2026-Q2 稳定中） |
| **数据流向** | UI ↔ UI（信息靠抓屏 / OCR 还原） | 程序 ↔ 程序（结构化 payload） | LLM ↔ tool（agent 作中枢调度） |
| **适用场景** | 老系统 / 无 API SaaS / 银行 mainframe / SAP / 政务 / 跨多个 UI 拼接流程 | 现代 SaaS 互联 / 后端集成 / 服务 mesh | AI agent 时代标准 tool layer / 一个 agent 接 N 工具 |
| **不适用场景** | 高频实时 / 高并发 / 需要严格 SLA / 厂商明令禁止机器人的平台 | 目标系统死不开放 API | 工具本身无 schema / 用户不想让 LLM 经手 / 高确定性 batch 流程 |
| **典型产品 / 实现** | UiPath, Automation Anywhere, Blue Prism, Power Automate Desktop, 影刀, 弘玑, 来也, 实在 | Stripe API, Notion API, GitHub API, REST/GraphQL/gRPC 服务 | Anthropic SDK, mcp.so / glama / smithery 目录, GitHub / Filesystem / Postgres official servers |

---

## 3 三者协作图

```
                  ┌──────────────────────────┐
                  │   LLM Agent (Pi / Claude / GPT)   │
                  └──────────────┬───────────┘
                                 │ MCP (JSON-RPC)
                  ┌──────────────▼───────────┐
                  │      MCP Server          │  ← 标准化适配层
                  │  (薄 wrapper, ~200 LOC)  │
                  └──────────────┬───────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
       (有 API)              (无 API)            (本机资源)
            │                    │                    │
            ▼                    ▼                    ▼
       REST / gRPC            RPA 机器人          Filesystem
       Stripe API           (UiPath /          Database
       Notion API            影刀 / 弘玑)       Shell
       GitHub API                │
            │                    │
            ▼                    ▼
      目标 SaaS              目标老系统
      (云原生)               (SAP / OA / 政务)
```

**关键观察**：MCP server 是 agent 时代的"通用插头"。底下可以是 API、可以是 RPA 机器人、可以是本机进程——上层 LLM 不需要知道。

例：UiPath 2026 起出了官方 MCP server，把现有 RPA workflow 包成 tool，让 Claude / GPT 能直接调"在 SAP 里录一笔订单"——RPA 厂商在主动给自己加 MCP 出口。

---

## 4 各自局限 + 当下趋势

### 4.1 RPA 在衰退？不，在升级

- 2018-2022：RPA 是企业自动化主旋律（UiPath IPO $35B 市值峰值）。
- 2023-2024：LLM 冲击，"intelligent automation" 取代纯 RPA——加 OCR 准度提升 + 表单理解 + 多模态 fallback。
- 2025-2026：RPA 厂商集体套 LLM + 出 MCP server。新名字 = "agentic RPA" / "AI workforce"（UiPath Maestro, Automation Anywhere AARI, 影刀 AI Agent）。
- **本质转向**：RPA 不再是"录制 → 回放"，而是"LLM 看屏 → 决定下一步 → 操作"，跟 Anthropic computer-use / OpenAI Operator 同源。
- **CTRL 视角**：computer-use / Operator 也是 RPA 的现代形态——只是把"录制脚本"换成"LLM 实时决策"。

### 4.2 API 不会消失，但纯 API 集成商在被压

- API 仍是地基，不可替代。
- 但"卖 N 个 SaaS API 集成"（Zapier / Make / n8n）的商业模式被 agent 时代挤压——LLM 自己能读 OpenAPI spec 现场写调用代码。
- 厂商主动给 LLM agent 端铺路：OpenAI App Actions、Anthropic Tool Use、MCP 都是反方向（让 agent 直接消费 API，不经 Zapier 中介）。

### 4.3 MCP 仍年轻

- 还不到 18 个月，spec 仍在演进（authorization spec 2026-Q1 才稳）。
- 已是事实标准（OpenAI 2026-03 官方采用是关键转折）。
- 下一步：MCP marketplace 商业化（Smithery 已融资），跟 npm / pypi 类似的"工具包注册中心"+evals+排名+评测。
- **CTRL Discover 网页 SSOT 就在这个位置**——比 mcp.so 多了 native client + hotkey + 创作者经济（memory `decision_ctrl_repositioned_as_aggregator`）。

---

## 5 CTRL 立场判断（本 doc 核心）

### 5.1 keycap 协议 = MCP，不动

ADR-002 §7 composition v1 锁。所有 keycap（builtin / mcp / oauth / local_agent / stss 5 source）通过 MCP 暴露给 Pi。

无 RPA-specific protocol，也无 plain-API binding——统一收口到 MCP。

### 5.2 第三方 backend 接入优先级

按以下顺序选：

1. **有 official API + OAuth** → 直接包 MCP server（Notion / GitHub / Linear / Stripe / 飞书 open platform）。
2. **有 official API 但只 enterprise tier** → 评估用户量，按需 MCP 包。
3. **无 API 但 web 端 OK** → 用户自己装 Playwright MCP / browser-use MCP，CTRL 不内置 headless browser。
4. **无 API 且必须 native app**（如 SAP GUI / 用友 NC client）→ RPA 工具是用户已有的现实方案，CTRL 视作 **外部 keycap source**（用户跑 UiPath / 影刀，CTRL 给 hotkey + workspace 显示进度），不内置 RPA runtime。

### 5.3 CTRL 不做 RPA substrate（vim test 守住）

考察：要不要在 ctrl-kernel 里内置一个"屏幕代理 agent"（类似 Anthropic computer-use）？

**结论：不做**。

理由：
- **vim test 反对**：屏幕代理是黑盒 + 重型 runtime（>100MB binary + 高 CPU），破坏 ≤18MB kernel + augmentation 哲学。
- **端侧化反对**：computer-use 类 agent 需要持续访问完整桌面截图 + accessibility tree，跟"本地是 truth"的 plain-text 哲学正交。
- **替代方案够用**：用户想要时可 `claude --computer-use` 或装一个 computer-use MCP server 当 keycap——是用户选择，不是 CTRL 默认。

唯一例外（潜在）：未来 v1.x 评估 "OCR keycap" 时, 如果发现端侧 Vision framework + 局部截图（不是全桌面 streaming）够用，可以做个轻量 ScreenshotActor primitive；那也只是 capability，不是 RPA agent。

### 5.4 RPA 在 OPC aggregator 视角下的位置

memory `decision_ctrl_repositioned_as_aggregator`：CTRL = AI/OPC tool aggregator + trust layer + native client。

RPA 类工具（UiPath / 影刀 / Power Automate Desktop）= **Discover 网页的一个品类**，跟 SaaS / CLI / MCP server / Skill / Persona 并列。CTRL 提供：
- 网页 SSOT：评测 / rating / 价格 / 使用门槛 / 学习曲线对比（影刀 vs 弘玑 vs 来也）
- Native client：用户已装的 RPA workflow 在 CTRL 工作区可见、可 hotkey 触发
- 不替代 RPA 厂商：CTRL 不写 RPA runtime，只做发现 / 评测 / 触发

### 5.5 创作者侧（keycap 作者）的指导

写 keycap 时优先级：

1. 目标系统有 MCP server 现成 → 直接消费。
2. 目标系统有 API → 写 MCP server 包一层，可 commit 回 OpenClaw + mcp.so 双发（memory `decision_openclaw_compat_layer` 桥）。
3. 目标系统无 API → 在 keycap manifest 标注"requires RPA tool X"，让用户自己装 UiPath / 影刀，keycap 通过 ST-SS 接 RPA workflow 的输出。
4. **不鼓励**自己写 puppeteer / playwright scraper 类 keycap（脆 + 法律灰区 + 维护成本）——除非是公开网页且对方 ToS 允许。

---

## 6 关键差异速记（一行版）

- **API 是地基** — 谁都绕不开。
- **MCP 是地基之上的 agent 标准插座** — 让 LLM 调 API 不用现场写 glue。
- **RPA 是没有插座时的电焊枪** — 直接焊到 UI 上，能用，但脆 + 慢 + 难维护。
- **三者会长期并存**：现代云用 API + MCP，老系统 + 国内政务 / 银行 mainframe 离不开 RPA。
- **AI 时代的 RPA = computer-use** — 同一个东西换了 LLM-driven 决策内核。

---

## 7 参考

- MCP spec: <https://modelcontextprotocol.io>
- MCP server 目录: mcp.so, glama.ai/mcp, smithery.ai
- UiPath MCP server (官方 2026-03): docs.uipath.com/mcp
- Anthropic computer-use: <https://docs.anthropic.com/en/docs/build-with-claude/computer-use>
- 影刀 RPA: <https://www.yingdao.com>
- Forrester 2025 RPA Wave report (访问需 Forrester 客户席位)
- CTRL 相关 ADR：002 substrate §7 composition (keycap MCP 锁), 002 substrate §3 brain (Pi), 005 irisy §1 lifecycle
- CTRL 相关 brainstorm：aggregator-positioning-2026-06-03.md, openclaw-compat-2026-06-03.md
