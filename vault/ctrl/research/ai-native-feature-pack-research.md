---
title: 把开源软件/MCP 变 AI-native —— 功能包方向调研 (2026)
kind: research
created_at: 2026-07-01
owner: bao
author: claude (deep-research, 105 agent / 23 源 / 113 主张 / 25 过对抗验证 25/25 confirmed)
purpose: bao「你是不是不知道做功能包的意义 —— 把大量开源软件/MCP 编程成 AI-native 的,这方向你不懂,要调研」
serves: 校准 CTRL 产品命题 = substrate + 能力市场 (让 Irisy 把任意开源工具/MCP 变 AI-native 功能包)
related:
  - "[[capability-pack-map]]"
  - "[[mcp-capability-marketplace]]"
  - 002-substrate.md    # §7 composition + §7.4 系统化 + §14
---

# 结论:砖都有了,CTRL 该拼装不该重造;护城河在「raw-wrap → AI-native 提升层」+「端到端无人做」

## 现成可复用的砖 (别重造)

1. **打包格式 = Anthropic Agent Skills**(`SKILL.md` 文件夹 + progressive disclosure:name/description 先加载 → 需要时读全文 → 按需读 bundled 文件)。**跟 MCP 互补**:MCP = 连通外部软件,Skills = 教 agent 用它的工作流。→ CTRL 功能包 = Skills + MCP,不自造格式。来源:anthropic.com/engineering/equipping-agents-...-agent-skills。
2. **API→MCP 流水线 = Anthropic 官方 `mcp-builder` skill**:四阶段(① 深研+规划 ② 实现 ③ review+测试用 MCP Inspector ④ **写 evals**)。「comprehensive endpoint 覆盖 vs 专用 workflow tool 权衡,拿不准就全覆盖」。→ Irisy 的 mcp-creator 直接采纳这条(尤其 **Phase 4 evals 是家酿流水线都跳过的一步**)。来源:github.com/anthropics/skills/.../mcp-builder/SKILL.md。
3. **OpenAPI→MCP 自动编译 = AutoMCP**:50 API / 5066 endpoint,开箱 **76.5%** → 修 spec 后 **99.9%**。**瓶颈是 spec 质量不是 codegen**(5 类反复出现的 OpenAPI 缺陷,174 行/文件补丁修好 239/240)。→ **自动生成基本已解决;CTRL 该投的是 spec-lint/repair,不是写 codegen**。来源:arxiv 2507.16044v2。
4. **分发层 = 官方 MCP Registry(meta-registry,`mcp-publisher` CLI + namespace 所有权证明)+ Smithery(实测 6639 servers,托管 auth/credential/session)**。→ CTRL 的 Discover 应**拉这些 registry**(§7.4 已说),可发 `ctrl-*` 包 / 自建 sub-registry。来源:blog.modelcontextprotocol.io、smithery.ai。
5. **Generative UI = OpenAI Apps SDK**:tool 响应三件套 `structuredContent`(widget+模型都读)/ `content`(叙述)/ `_meta`(只给 widget,**永不进模型**)。→ 对上 CTRL「功能包声明 UI + transparency-by-drill-down」;`_meta` 分离 = 敏感数据不喂模型。来源:developers.openai.com/apps-sdk。
6. **真实自托管全链路案例已存在**:Ghostfolio MCP(读+写 + `READ_ONLY_MODE` 治理开关)、Twenty CRM MCP(全 CRUD + 动态 schema)。→ CTRL 的 `ctrl-ghostfolio`/CRM 有现成前身可复用。**但他们的治理粗**(二元 env 开关)—— CTRL 的 per-call 审计+可见性 gate 更细。来源:github.com/mhajder/ghostfolio-mcp、mhenry3164/twenty-crm-mcp-server。
7. **治理网关 = AWS MCP Gateway**:一个网关收口 + **discovery 和 invocation 双点 scope 授权**(看不到就调不到)+ 每调用审计(who/what/when/where)。**= CTRL `:17873` gate 的形状,证明 gate 是行业标准。**来源:aws.amazon.com/blogs/opensource/governing-ai-assets-...。

## 护城河 / 差异化空隙 (研究直接点出)

- **Anthropic 明说**:「**把 API endpoint 简单包成 tool 是常见错误,不能让软件变 agent-native**。tool 是『确定性系统 ↔ 非确定性 agent』的契约,必须为 agent 的**有限上下文**设计(高信号返回、合并操作、agent affordance),不是一 endpoint 一 tool 镜像。」来源:anthropic.com/engineering/writing-tools-for-agents。
- → **AutoMCP 式自动包装是必要但不充分**。真正让工具 AI-native 的是上面那层 **curation / workflow-tool / one-shot 原子 / in-line 处理** —— 研究说**这层「行业普遍欠缺,无人给出可复用配方」= 正是 CTRL 的空隙**。CTRL 的 one-shot 哲学 + §14 + Irisy 正好长在这。
- → **端到端无统一玩家**:discovery → scaffold → govern → distribute → generative-UI 整条链**目前是拼装的砖,没有一个平台统一做**(研究判「疑似白地」)。**CTRL local-first 做这条整链 = 潜在白地。**

## 对 CTRL 的校准 (该干什么)

CTRL ≠ 克隆某 app 前端。CTRL = **substrate(gate + projector + manifest + 安全)+ 能力市场**,让 **Irisy 把任意开源工具/MCP 变成「经 gate 治理的 AI-native 功能包」**。研究**确认并锐化了 ADR-002 §7.4 + capability-pack-map 的既定方向**,给出具体砖:
1. 功能包 = **Skills(SKILL.md）+ MCP** 双件(采纳官方格式)。
2. Irisy 的 mcp-creator = 采纳 **mcp-builder 四阶段**(含 evals)+ **AutoMCP 式 OpenAPI→MCP** + **spec-repair**(真瓶颈)。
3. Discover = **拉官方 MCP Registry + Smithery**,不硬编码 pack 列表。
4. **护城河层**:在 raw-wrap 之上做 **one-shot 原子 / workflow-tool / in-line / §14 统一契约 / per-call gate 治理**(比 Ghostfolio/Twenty 的粗 env 开关细)。
5. Generative UI 采 **Apps SDK 三件套**(structuredContent/content/_meta)。
6. **种子验证**:拿现成 Ghostfolio/Twenty MCP,经 gate + §14 + AI-native 提升层跑通一个端到端功能包,当活体证明。

**我之前的 Task Source + gate + §14 是这条路上的对活**(把能力变 agent-可操作);**克隆 LifeOS 前端是跑偏**。
