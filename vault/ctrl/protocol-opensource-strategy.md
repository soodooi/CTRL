---
title: §14 协议开源战略 — 竞品打法 · 成败规律 · 开源路径(探索,未拍板)
kind: strategy
status: exploration
created_at: 2026-06-22
owner: bao
author: zeus (通讯协议)
method: deep-research workflow (竞品「内部协议→开源标准」打法) + 多源对抗验证
question: 「CTRL 自研的 §14 统一操作接口,能否独立开源成框架/协议、卡位标准、放大影响力?怎么做?」
related:
  - "[[research-protocol-2026]]"
  - 010-communication.md   # §14 = 通讯窄腰的契约面
  - 002-substrate.md       # §14 实现真相源
---

# §14 协议开源战略(探索)

> bao 2026-06-22:「整个协议框架,哪些是我们特有的、哪些是公有的?我们自有的部分能不能独立成开源框架给别人用,影响力比较大?」
> zeus:自有且有开源价值的只有 **§14 统一操作接口**(其余要么是公有标准直接用,要么是该向公有标准收敛的自研如 ST-SS→AG-UI)。本文调研竞品「内部协议→开源标准」打法,给 §14 的开源路径判断。**未拍板** —— 影响开源决策的是 license 战略(现 All Rights Reserved),需 bao 定。

## 一、竞品打法:内部协议→开源标准(经验证的真实案例)

| 案例 | 开源粒度 | 治理 | 变现/回报 | 关键数据 |
|---|---|---|---|---|
| **MCP / Anthropic** | spec + 参考 SDK(Py/TS),**非全产品**(2024-11) | 单厂主导 → **2025-12 捐 Linux Foundation(AAIF)** 中立化,维护者延续 | 不卖协议;卡"agent↔工具"标准制定权 + Claude 生态 | 97M 月下载、10,000+ servers、registry;OpenAI(2025-03)/Google(2025-04)数月内采用 |
| **AG-UI / CopilotKit** | 协议 + 一方参考实现(React/Angular)+ 社区 client(Go/Rust/Java) | **单厂治理(未捐基金会)** | **open-core**:协议免费,卖 self-host enterprise(支持/合规/可观测);**融资 $27M(2026-05)** | 占住 agent↔UI 语义层(streaming/生成式UI/共享状态) |
| **A2A / Google** | spec + 扩展(AP2 支付不改核心) | **2025-06 捐 Linux Foundation**,7 创始厂 | 横向 agent↔agent 标准;整合对手(IBM ACP 并入) | 50+ → 150+ 组织、22k stars/年 |
| **ACP / Zed** | spec + **ACP Registry**(GitHub PR 提交,轻量社区治理) | 单厂发起,registry 开放 | "implement once, work everywhere";registry = 把 spec 变网络效应 | Claude Code/Codex/Copilot/Gemini + JetBrains 采用 |
| **OSI / 多厂联盟** ⚠️ | spec only(Apache 2.0,YAML) | **60+ 厂工作组**(Snowflake/Databricks/dbt/Salesforce/Oracle/Mistral) | 防御性中立标准(无单一发起者独占) | **2026 春成熟;明确理由=防 AI 幻觉(语义冲突)** |
| LSP / Microsoft · GraphQL / Meta · gRPC / Google | spec + 参考实现 | 单厂→开放 | 标准制定权 + 开发者心智 + 招聘 | 经典「内部协议外放」成功先例 |

## 二、成功公式 vs 失败教训(高度一致)

**成功公式**:① 占**没人占的语义层**(MCP=工具/AG-UI=UI/ACP=editor↔agent/A2A=agent↔agent)② 开源 **spec + 杀手级参考实现** + 真开放 license ③ **治理中立或轻量**(竞品敢用→网络效应)④ **registry/marketplace 生态绑定** = 把 spec 变网络效应 ⑤ 变现**不在协议**,在生态/enterprise/估值。

**失败教训**:
- **HashiCorp Terraform → OpenTofu 分叉**(2023 改 MPL→BSL):"靠 license 限制竞争而非产品执行" → 社区 fork 抛弃(CNCF 要 100% 开源,转 OpenTofu)。**铁律:要么一开始真开放且不反悔,要么别开源。**
- **CORBA / SOAP / WS-\***:过度复杂 → 死。**§14 必须保持极简(4 动词)。**
- **撞已有标准重复造轮子** → 被忽视。

## 三、关键发现:OSI 撞上 §14 的语义层(定位必须校准)

**OSI(Open Semantic Interchange)** 是 2026 多厂联盟(Snowflake/Databricks/Salesforce…)的开放语义规范,**明确理由 = 防 AI 幻觉(语义冲突)+ plain-text YAML + "Write Once, Query Anywhere"** —— 跟 §14 `describe` 强类型语义层 + plain-text 哲学**正面重叠**。

- ✅ **机会**:§14 方向被大联盟验证(开放语义层防幻觉是真趋势)。
- ⚠️ **警钟**:CTRL 单人/小团队**正面打「通用语义层标准」赢不了** OSI 这种 60+ 厂联盟。

**∴ §14 定位必须避开 OSI 正面**:
- OSI = 云 BI/analytics 的**只读语义交换**。§14 真正的空位 = **local-first + AI agent 操作异构数据源(表格/笔记/连接器/终端)+ 读写分离 + produce 过 gate 治理**。OSI 不做 local-first、不做写治理、不做 agent 操作面。
- 更聪明:§14 `describe` **对齐/兼容 OSI 语义 schema**(蹭势),在其上叠 CTRL 独有的"**操作 + 治理层**"(query/subscribe/produce/gate)。**不争语义层,做它上面的操作层。**

## 四、§14 开源路径建议

1. **定位**:不做"通用语义层"(撞 OSI),做"**local-first + AI agent 操作异构数据源的统一操作 + 治理层**";`describe` 对齐 OSI。一句话口号(学 ACP「LSP for coding agents」):待定,如「**the operation layer for AI over local data**」。
2. **形态**:坐在 **MCP 之上的开放 profile/extension**(MCP 官方有 extensions 机制;A2A 的 AP2 印证"稳定核心 + 扩展"),不另起炉灶。
3. **粒度(open-core,学 CopilotKit 而非 Anthropic)**:**开源** = 协议 spec + 轻量参考 SDK(让别人实现 Source);**闭源** = CTRL 内核 / gate 实现 / UI / **能力市场**(护城河)。
4. **license**:这**一个**协议包用 **Apache 2.0**(干净、不反悔,记住 OpenTofu);其余仍 All Rights Reserved。
5. **治理**:初期 **CTRL 单厂自持 + open-core**(像 CopilotKit,保商业控制 + 可融资);起势后再考虑捐基金会中立化(像 MCP/A2A)。
6. **生态绑定**:配一个 **registry**(实现 §14 Source 的能力/连接器目录)= 把 spec 变网络效应(学 ACP/MCP registry)。

## 五、风险(敢质疑,务必正视)

1. **影响力需第二、三方采用才成立** —— §14 现在只有 CTRL 一个实现(4 source)。开源是**长期社区投入**(维护 spec/拉采用/答 issue),单人/小团队要掂量持续成本。
2. **独特性待验证** —— 可能被说"就是 MCP resources + 命名约定"或"OSI 的子集"。开源前必须把 §14 vs MCP vs OSI 的**真实差异度**讲清(local-first + 写治理 + agent 操作面是关键差异)。
3. **时机** —— agent 协议战 2026 正热,window 还在;但 MCP/A2A/AG-UI/OSI 已占大位,§14 必须精准卡"local-first agent 数据操作治理"这个还没被占的缝,晚了被 MCP extension 或 OSI 吃掉。
4. **license 战略冲突** —— 开源 §14 = 主动为一个包解开 All Rights Reserved 锁,需 bao 战略拍板。

## 六、待 bao 决策

1. 要不要走这条(§14 开源卡位)?还是先记为"未来战略选项"留着,专注产品?
2. 若走:认可"open-core(像 CopilotKit)+ MCP profile + Apache 2.0 单包 + 对齐 OSI 避正面"这条路径吗?
3. license:为 §14 协议包开 Apache 2.0 口子,其余维持闭源 —— 可接受吗?

## 来源(deep-research,primary/secondary 标注)

- Anthropic「Donating MCP / establishing AAIF」(primary, 2025-12-09)· GitHub Blog「MCP joins Linux Foundation」· The New Stack「Why MCP Won」
- AI2Work「CopilotKit Raises $27M to make AG-UI the standard」(2026-05)
- A2A → Linux Foundation(primary, 2025-06-23)· Zylos「Agent Interop 2026 convergence」
- Zed「ACP Registry」(primary, 2026-01-28)·「ACP: LSP for AI Coding Agents」
- OSI / Open Semantic Interchange(primary, Apache 2.0, 2026-06-04)· Salesforce「Agentic Future Demands an Open Semantic Layer」
- OpenTofu「Fork of Terraform」(HashiCorp BSL 教训, 2024-04)
