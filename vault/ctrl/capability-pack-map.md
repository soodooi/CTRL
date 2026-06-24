---
title: CTRL 功能包全景图 + 种子 connector 优先级
kind: plan
created_at: 2026-06-23
owner: bao
author: claude (优先级提案,bao 可否决)
purpose: 把「CTRL 要实现哪些功能包」从散在三处(master-plan §二·五 / CLAUDE.md Top15 / marketplace plan)收成一张统管全局的图,并对种子 connector 拍优先级。
serves: 能力市场冷启动 + OPC「本地 AI 前端管业务系统」护城河
related:
  - "[[master-plan]]"            # §二·五 模块版图
  - "[[mcp-capability-marketplace]]"  # 市场机制 7 切片
  - "[[feishu-mcp-research]]"    # 首个 connector 参照
  - 010-communication.md         # seam ④⑤ 能力插件/第三方 = MCP
---

# CTRL 功能包全景图

> 读法:本文回答「CTRL 要实现哪些功能包」。GOAL.md = 当前活跃目标;master-plan = 全局地图;**本文 = 功能包这一维的统一清单 + 种子优先级**。

## 三层功能包(别混为一谈)

CTRL 的「功能包」是三种不同的东西,实现主体不同:

| 层 | 是什么 | 清单 | 谁实现 | 真相源 |
|---|---|---|---|---|
| **① 原生能力模块** | 按 Ctrl→intent 浮现的主能力,各对标一个成熟单点 | **固定 4 个**:Notes(Obsidian)· Coding(Codex terminal)· Smart-table(飞书 Bitable)· 远程桌面(ToDesk) | **CTRL 自建** | master-plan §二·五 B |
| **② 内置工具 mcps** | 端侧原子工具(Top 15) | **固定 ~15 个**:Clipboard/OCR/Translate/Text/Chat(P0)· 窗口/PDF/LaTeX/智识/屏幕录(P1)· Snippet/Code/Email/会议/同步 | **CTRL 自建** | CLAUDE.md mcp-llm-reference |
| **③ 外部系统 connector** | 把外部业务系统(飞书/CRM/ERP/…)包成 MCP 接进来 | **故意无固定清单(长尾开放)** | **第三方造 + CTRL 种子几个** | 本文 + marketplace plan |

**架构铁律(CLAUDE.md「What CTRL is NOT」):CTRL 不建 ③ 的长尾。** 「100+ 长尾 platform adapter → 给创作者自己接」。CTRL 只做 **substrate(gate / projector / manifest / 4 块安全)+ 能力市场**,让第三方造、用户一键装。

→ 所以「CTRL 要实现哪些外部功能包」的正确答案是:**① ② 全自建(清单已定);③ 只官方种子 2-3 个把市场点着,其余市场来填。** 本文只对「③ 种子」拍优先级。

---

## 种子 connector — 为什么需要 + 判据

能力市场是双边网络,冷启动要**官方先种几个高价值 connector**:既证明「本地 AI 前端管业务系统」(OPC 护城河),又给市场切片(`mcp-capability-marketplace` 0-6)真实测试用例,还给第三方一个参照模板。

**种子判据(5 维,排序用)**:
1. **现成度** — 有没有成熟可挂的 MCP(零/低自建)。乘数项。
2. **数据主权契合** — 后端可自托管(开源)= 数据全本地 = 护城河最硬;SaaS 走「本地 vault 是 truth、SaaS 是 mirror」次之。
3. **OPC 痛感** — 一人公司日常是否高频依赖。
4. **获客滩头** — 是否拉来一个 CTRL 已锚定的用户段(放大现有楔子,而非开新战线)。
5. **命题示范度** — 是否漂亮地演示「AI 前端 + gate 写治理 over 业务系统」。

**反判据(降级)**:与原生模块重叠(Notion vs 原生 Notes)· 法务灰区(社媒多账号自动发)· 纯浏览器自动化无 API(脆、维护贵)。

---

## 种子优先级(claude 提案,bao 可否决)

### 🥇 Tier 1 — 现在种(2 个,一快一深)

| connector | 现成度 | 数据主权 | OPC 痛感 | 滩头 | 自建成本 | 拍它的理由 |
|---|---|---|---|---|---|---|
| **飞书 / Lark**(Bitable + IM + docs) | ✅ **官方 MCP 现成**(`@larksuiteoapi/lark-mcp`,Bitable 全读写) | ⚠️ SaaS(本地 vault=truth,飞书=mirror) | 高(国内 OPC 日用) | ✅ 放大 **Smart-table beachhead**(SC8) | **~0**(挂现成官方 MCP) | **最快**:零自建 + 直接喂智能表格 ↔ Bitable 双向 sync + 现成市场切片测试用例。已是参照样本 [[feishu-mcp-research]]。 |
| **开源 CRM**(Twenty 优先 / EspoCRM 备选) | ⚠️ REST/GraphQL API 成熟,MCP 需薄 wrapper 或 bless 社区 | ✅✅ **自托管,数据全本地** | 高(OPC 核心=管客户) | ✅ 拉 solopreneur/agency 段 | **小**(写薄 MCP wrapper) | **最深**:**护城河命题的正脸示范** —— 自托管 CRM + CTRL 当 AI 前端 + 写操作过 gate review = memory「local AI front-end over business systems」的活证。值得这点 build。 |

> Tier 1 选这两个的逻辑:**一快(飞书,零建、放大已有 beachhead)+ 一深(CRM,小建、证护城河)**。两个都精确放大 CTRL 已有楔子,不开新战线。

### 🥈 Tier 2 — 种子证明模式后再上(业务系统铺宽)

| connector | 为什么不是 T1 |
|---|---|
| **开源 ERP**(ERPNext / Odoo) | 自托管✅数据主权强,但 ERP 重、对纯 OPC 不如 CRM 高频日用 → CRM 之后 |
| **Stripe / 收款** | 官方 MCP 现成、OPC 收钱刚需,但偏单点交易非「系统」→ 紧跟业务系统 |
| **GitHub / Git** | 官方 MCP 最成熟、零建,但 **BYO-CLI(Claude Code)已自带 git 访问** → CTRL GitHub MCP 只对 Irisy/非开发者 + gate 治理有增量,非滩头放大器 → 缓 |
| **CalDAV / 日历** | 现成 MCP,OPC 高频,但偏工具非业务系统 → 跟 Top15「会议」mcp 一起考虑 |
| **Notion** | 现成 MCP 多,但 **与原生 Notes(Obsidian)重叠** → 降级 |

### 🥉 Tier 3 — 机会主义 / 灰区(不主动种)

- **社媒自动化(HubStudio 等)** — 多账号自动发是平台 ToS 灰区 + 主要靠浏览器自动化(无开放发帖 API)+ 维护脆。需求真但风险高,留给第三方在市场自担风险造。
- **Slack / Discord** — 现成 MCP,但对国内 OPC 痛感低于飞书。
- **海报 / 设计生成** — 等市场有第三方出 MCP 再 bless,不官方建。

---

## 非目标(守架构铁律)
- **不建 ③ 长尾**:种子封顶 2-3 个,不滚成「CTRL 建 20 个 connector」的 roadmap。长尾 = 市场 + 第三方。
- **不与原生模块抢**:① 已覆盖的(Notes/Coding)对应外部 connector(Notion/GitHub)自动降级。
- 不碰法务灰区做官方种子(社媒多账号自动发)。

## 待 bao 拍 / 否决
1. **Tier 1 = 飞书 + 开源 CRM** 这两个,认不认?(尤其值不值得为 CRM 写薄 MCP wrapper 当护城河示范)
2. CRM 选型:**Twenty**(现代 API、活跃、TS)vs **EspoCRM**(轻量稳、PHP、自托管成熟)—— 接前需核 MCP 成熟度(可能要自写 wrapper)。
3. 种子何时启动:marketplace 切片 0-2(发现 + 安全地基)就绪后种,还是拿飞书 MCP 先跑切片做真实测试用例?
4. GitHub 缓到 T2 认不认(理由:BYO-CLI 已覆盖 dev git)?

## 诚实缺口
- T2/T3 各 connector 的 MCP 成熟度未逐一核实(飞书已核 [[feishu-mcp-research]];CRM/ERP/Stripe 的现成 MCP 质量接前需各跑一轮像飞书那样的核实)。
- 「种子」启动排在 SC8/智能表格 + marketplace 切片之后(master-plan 分层),本文是**清单+优先级决策**,非当前活跃目标。
