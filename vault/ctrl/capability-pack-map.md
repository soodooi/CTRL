---
title: CTRL 功能包全景图 + 种子 connector 优先级
kind: plan
created_at: 2026-06-23
owner: bao
author: claude (优先级提案,bao 可否决)
purpose: 把「CTRL 要实现哪些功能包」从散在三处(master-plan §二·五 / `.kiro/steering/mcp-development.md` Top 15 / marketplace plan)收成一张统管全局的图,并对种子 connector 拍优先级。
serves: 能力市场冷启动 + OPC「本地 AI 前端管业务系统」护城河
related:
  - "[[master-plan]]"            # §二·五 模块版图
  - "[[mcp-capability-marketplace]]"  # 市场机制 7 切片
  - "[[feishu-mcp-research]]"    # Bitable parity 参照 (飞书非 connect 目标 — CTRL 替代它, 见纠正块)
  - 010-communication.md         # seam ④⑤ 能力插件/第三方 = MCP
---

# CTRL 功能包全景图

> 读法:本文回答「CTRL 要实现哪些功能包」。GOAL.md = 当前活跃目标;master-plan = 全局地图;**本文 = 功能包这一维的统一清单 + 种子优先级**。

## 三层功能包(别混为一谈)

CTRL 的三层能力是三种不同的东西,实现主体不同。**术语校准 (ADR-002 §7.5 v41, 读法 A, bao 2026-07-01)**:「**功能包**」专指**产品级单位** = **① + ③**(每个都是完整产品,是用户**创造 + 分享**的单位);**② 是原子工具 (ingredient/primitive),不是「功能包」**(没人「分享一个 Translate 原子」)—— ② 仍是 mcp manifest 但**不进 Discover 的产品级货架**。IA 收敛: **功能包 = 产品,工具 = 配料**。

| 层 | 是什么 | 是「功能包」吗 | 清单 | 谁实现 | 真相源 |
|---|---|---|---|---|---|
| **① 原生能力模块** | 按 Ctrl→intent 浮现的主能力,各对标一个成熟单点 | ✅ **产品级功能包** | **固定 4 个**:**Notes/PKM**(Obsidian,base 必含)· Coding(Codex terminal)· Smart-table(飞书 Bitable)· 远程桌面(ToDesk) | **CTRL 自建** | master-plan §二·五 B |
| **② 内置工具 mcps** | 端侧原子工具(Top 15) | ❌ **工具/配料,非功能包** | **固定 ~15 个**:Clipboard/OCR/Translate/Text/Chat(P0)· 窗口/PDF/LaTeX/智识/屏幕录(P1)· Snippet/Code/Email/会议/同步 | **CTRL 自建** | `.kiro/steering/mcp-development.md` |
| **③ 外部系统 connector** | 把 **OPC 自托管开源软件**(CRM/ERP/财务/…,用户自己跑的)包成能力接进来。**注:非飞书这类云 incumbent —— 那些 CTRL 原生替代(见 ① Smart-table=Bitable),不 connect**(纠正 2026-07-02) | ✅ **产品级功能包** | **故意无固定清单(长尾开放)** | **Irisy 创作流造 + 第三方造**(非 dev 手写) | 本文 + marketplace plan |

**架构铁律(`.kiro/steering/development-philosophy.md`「Product Boundaries」):CTRL 不建 ③ 的长尾。** 「100+ 长尾 platform adapter → 给创作者自己接」。CTRL 只做 **substrate(gate / projector / manifest / 4 块安全)+ 能力市场**,让第三方造、用户一键装。

**关键(bao 钦定 2026-06-23):③ 的 connector 不是 dev 手写 MCP wrapper —— 是 Irisy 来做。** CTRL 的命题就是「AI 创作助手从自然语言/API 生成能力,用户不写 JSON」。这个流**已存在**:`personas/irisy/mcp-creator.ts`(Irisy 访谈 → 填 manifest slot → emit 完整 manifest + `server.ts`,auto-infer「提到具体平台→oauth、提到 MCP server→mcp」)+ `feature-pack-create.ts`。**种子 connector = 用 Irisy 创作流造**,dev 的活是**确保/打磨这条流能造出能用的真实 connector**,不是亲手写 connector。**种子本身 = 这条创作流的活体测试 + 护城河示范**(「Irisy 把一个业务系统接进来」正是要证明的产品能力)。

→ 所以「CTRL 要实现哪些外部功能包」的正确答案是:**① ② 全自建(清单已定);③ 长尾开放,只官方种子 2-3 个(由 Irisy 创作流造)把市场点着。** 本文只对「③ 种子」拍优先级。

---

## bao 集成清单(2026-06-24)+ 架构适配

> bao 钦定要集成的功能包。**关键发现:几乎全是「自托管业务系统 connector」= §14+MCP+gate 的甜区 + 数据主权护城河。** 这反过来验证了架构对 bao 真实需求适配极好。

| 功能包 | 层 | 架构路径 | 适配 | MCP 现成度(接前待核) |
|---|---|---|---|---|
| **PKM**(个人知识管理) | ① 原生 · **base 必含** | vault **§14 TextSource**(query{match/semantic}/produce)+ AI 检索(智识/hermes) | ✅ **一等公民**(数据型甜区) | Notes 模块在;§14 化待迁(Phase C) |
| **Ghostfolio**(财务/投资组合) | ③ connector | 自托管 REST → MCP(Irisy 生成)→ **§14 source**(query 持仓/交易,produce 加交易)+ gate | ✅ 干净 + **数据主权**(自托管) | 待核(大概率 Irisy 生成 wrapper) |
| **CRM**(Twenty) | ③ connector | 自托管 GraphQL → MCP → §14 | ✅ 干净 + 主权 | **Tier 1**(已定),待核 |
| **ERP**(ERPNext/Odoo) | ③ connector | 自托管 REST → MCP → §14 | ✅ 干净 + 主权 | Tier 2,待核 |
| **邮件**(IMAP/SMTP) | ②内置 + ③ connector | IMAP → MCP → **§14 source**(query 邮件)+ **Effect**(发信) | ✅ 干净 + 主权(IMAP 本地) | 通用 IMAP MCP 多,待核 |
| **HubStudio**(营销/多账号) | ③ connector · **strain** | 本地 API + **浏览器自动化** → local_agent mcp + Effect → gate | ⚠️ **strain**:无开放发帖 API,靠浏览器自动化;ToS 灰区 | 自建 local_agent,风险高 |

**架构适配结论**:
- **PKM + Ghostfolio + CRM + ERP + 邮件 = §14+MCP+gate 一等公民**(数据型 / connector 甜区,数据主权命题的活证)。架构对得很。
- **HubStudio = 唯一 strain**(灰区 + 浏览器自动化,无 §14 数据形状)→ 走 local_agent mcp + Effect,**风险高,建议第三方在市场自担风险造,不作官方种子**。
- **OPC 全栈成形**:PKM(知识)+ Ghostfolio(财务)+ CRM(客户)+ ERP(运营)+ 邮件(通讯)= 一人公司完整业务栈,全自托管/本地 = **CTRL 当 AI 前端、数据留本地 = 护城河**。这正是定位的活体清单。

**功能包边界 + 股票双形态(并入 `stock-and-installable-module-plan.md`,bao 2026-06-24):**
- **每个领域 = 独立 L1 功能包,各有自己的 workspace**(股票 / CRM / 记账平级);**知识库(PKM)= 通用兜底功能包**(没专门到独立成包的想法/笔记/资料待这里)。股票**不是** KB 的用例。
- **股票功能包国内外双形态**:**国外 = Ghostfolio**(AGPL 自托管,REST:order CRUD / portfolio·performance·positions / symbol lookup / import,CTRL 当其 AI 前端);**国内 A股 = AkShare(MIT 数据源,行情/财务)+ CTRL Smart Table(记持仓/复盘)** —— 因国内**无「开源+自托管+API」一体股票软件**(雪球/且慢皆封闭 SaaS,违数据主权),开源只剩数据层,**CTRL 自己即那个「软件」**。
- 形态差异 = connector 集成的真实光谱:**有自托管开源软件(Ghostfolio)→ connector 连它**;**无(国内 A股)→ CTRL Smart Table 当记录主体 + 开源数据源(AkShare)喂数据**。

> **PKM 是 base(必含),不是可选**:它 = vault(Notes 人编辑视图 + 智识 AI 检索视图,同一份 plain-text)。已是原生模块,但 **§14 化(read=query / write=produce)待 Phase C** —— PKM 要成「一等数据型功能包」,得跟 vault §14 盖全一起做。

---

## 集成模型:组合,不打补丁(bao 钦定 2026-06-24)

> connector 集成开源项目(Ghostfolio/Twenty/ERPNext/…)**绝不 fork、绝不改源码**。原样连,旁边加,持续跟升级。

**黄金线 —— 唯一判据:你有没有动上游的源文件?**

| | 碰上游源码吗 | 跟得上升级吗 | 判定 |
|---|---|---|---|
| **组合**:项目**外面/旁边**加(connector / sidecar / 官方插件机制) | ❌ 不碰 | ✅ 上游变,你的层不动 | ✅ **正路** |
| **打补丁**:改项目源文件(哪怕「增量」) | ✅ 碰了 | ❌ 每次升级 merge 冲突 = fork = 维护地狱 | ❌ 禁 |

**「增量改成 CTRL 版」精确成两件、都不碰上游源码:**
1. **加 API ✅ = connector(项目外)** —— 缺 API/端点 → 伴生层调它现有 API/官方插件机制(ERPNext app / Odoo module),Irisy 生成。上游一行不改 → 跟升级。
2. **加 UI ⚠️ = CTRL 自己的 workspace 渲染** —— 架构铁律「Ctrl 唯一入口 + viewer registry 渲染数据,不嵌第三方 UI」。CTRL 版的「皮」= **CTRL 侧的 workspace 视图**(本就 CTRL-native),**不是塞进项目**。往项目塞 UI = 违铁律 + 成 fork = 双输。

**命名警告**:别叫「**CTRL 版 Ghostfolio**」(暗示用户装的**分叉发行物** → 触发 copyleft + 维护一辈子)。正确 = **「vanilla Ghostfolio + CTRL 伴生层(connector)」**,用户装的还是官方版。

**为什么「不改」是对的(也是唯一干净的路)**:
- **搭便车** —— vanilla = 上游更新/安全补丁白拿(同「CTRL 不 fork Claude Code、只 BYO-drive」)。
- **数据主权 + 无 lock-in** —— 用户跑官方版,离开 CTRL 照跑(vim-test)。
- **License 干净** —— Ghostfolio/Twenty=**AGPL**,ERPNext/EspoCRM=**GPL**:**fork+分发「CTRL 版」= 触发 copyleft**;而**连接自托管 vanilla 实例的 API = 不算修改/分发 = 完全干净**。
- **跟升级的关键** —— 走**官方扩展点(API/插件)**,**别碰源码或 DB 内部**(内部一变就崩)。

**上游缺东西怎么办**:**PR 给上游**(改 vanilla,所有人受益),**不 fork CTRL 版**。PR 永远朝上游走。

> 例外:**没 API 的纯 UI 项目**(如 HubStudio)才需要浏览器自动化/上游加 API —— 那是 strain 特例,不适用有 API 的业务系统。

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

> **⚠️ 纠正 2026-07-02(bao「我们是飞书而非集成飞书吧?」):飞书从 Tier-1 connector 移除。** CTRL **是**本地 / AI-native / 数据主权版的飞书(原生 Smart-table = Bitable,Notes = docs)—— 飞书是 CTRL 要**替代其角色**的云端 incumbent,**不是要 connect 的目标**;你不去集成你要替代的东西(违 Ctrl-唯一入口 + 不嵌第三方 app + 数据主权)。**连接目标 = OPC 自己自托管的产品**(Ghostfolio/Twenty/ERPNext,用户自己跑的开源软件)。飞书唯一残留角色 = **可选单向 sync-out mirror**(本地 Smart-table = truth → 飞书 = mirror,给同事还在飞书上的人互通),次要、晚做、不是种子。根因 + 详见 memory `feedback-ctrl-is-feishu-not-integrate-feishu`。**下方原飞书行 = 错框,留删除线作 provenance。**

### 🥇 Tier 1 — 现在种 — **纠正后(2026-07-02):Ghostfolio(已落地种子)+ Twenty(下一个)**

| connector | 现成度 | 数据主权 | OPC 痛感 | 滩头 | Irisy 创作流怎么造 | 拍它的理由 |
|---|---|---|---|---|---|---|
| **Ghostfolio(开源自托管财务)** ← **已端到端落地**(本 session) | ✅ REST 成熟,§14 record_source 纯 manifest 数据(零 Rust) | ✅✅ **自托管,数据全本地** | 中-高(OPC 财务/投资) | ✅ 数据主权护城河正脸 | **source.type=§14 record_source**:纯 manifest 声明,通用引擎读 | **已证命题**:自托管开源软件 + CTRL 当 AI 前端 + 写过 gate review + 可分享 MIT commons。加 connector = 纯数据零代码。 |
| **Twenty(开源 CRM)** ← 下一个 | ⚠️ GraphQL API 成熟(注:§14 v1 是 REST 形状,GraphQL 需先扩引擎支持 POST-body 查询) | ✅✅ **自托管,数据全本地** | 高(OPC 核心=管客户) | ✅ 拉 solopreneur/agency 段 | Irisy 从 Twenty API 生成 / 或 §14 引擎扩 GraphQL 后声明 | **最深**:护城河命题正脸 + 最能压测创作流(真实复杂业务 API)。 |
| ~~**飞书 / Lark**~~ | ~~官方 MCP 挂载~~ | — | — | — | ~~source.type=mcp~~ | **❌ 移除(2026-07-02)**:CTRL 原生替代它(Smart-table=Bitable),非 connect 目标;至多单向 sync-out mirror。见上方纠正块。 |

> **Tier-1 逻辑(纠正后)**:连接目标是**OPC 自托管开源产品** —— Ghostfolio(已落,财务)一深已证 + Twenty(CRM)下一个压测创作流。**飞书不在此列**(CTRL 就是它)。都精确放大 CTRL 已有楔子,不开新战线。

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

## 已拍(bao 钦定 2026-06-23,§1 纠正 2026-07-02)
1. ~~Tier 1 = 飞书 + 开源 CRM~~ → **纠正 2026-07-02:Tier 1 = Ghostfolio(已落地)+ Twenty(下一个)。飞书移除**(CTRL 原生替代它,非 connect 目标 —— 见上方纠正块 + memory `feedback-ctrl-is-feishu-not-integrate-feishu`)。
2. ✅ **CRM = Twenty**(现代 API、活跃、自托管)。
3. ✅ **由 Irisy 创作流(`mcp-creator`)做,不是 dev 手写 MCP wrapper** —— 种子 connector = Irisy 命题的活体测试 + 护城河示范。
4. ✅ GitHub 缓到 T2(BYO-CLI 已覆盖 dev git)。

## 真正的下一步开放问题(决策已拍,剩工程前置)
1. **Irisy `mcp-creator` 流的产出质量** —— 它现在能生成接真实复杂业务 API(Twenty GraphQL)的**能用** connector 吗,还是只能生成玩具 server.ts?接 Twenty 前要先验证/打磨这条流(auth / 分页 / 错误处理 / 写操作过 gate)。**这是种子 connector 的真前置,不是 connector 本身。**
2. ~~飞书走 source.type=mcp 挂现成官方 MCP~~ → **删除(2026-07-02):飞书不 connect(CTRL 就是它)。**「挂现成 npm MCP server」这条 source.type=mcp 最轻路径仍要验证,但用一个**真该 connect 的目标**(有官方 MCP 的 OPC 自托管产品),不是飞书。
3. **Twenty MCP 成熟度** —— 社区有没有现成 Twenty MCP(则 Irisy bless 即可),还是必须 Irisy 生成(则压测创作流)。接前各核一轮(像 [[feishu-mcp-research]] 那样)。

## 诚实缺口
- Irisy `mcp-creator` 流存在(`personas/irisy/mcp-creator.ts`),但**生成真实业务 connector 的质量未验证** —— 这是种子启动前的硬前置。
- T2/T3 各 connector 的 MCP 成熟度未逐一核实(飞书已核;Twenty/ERP/Stripe 接前需各跑核实)。
- 「种子」排在 SC8/智能表格 + marketplace 切片之后(master-plan 分层),本文是**清单+优先级决策**,非当前活跃目标。
