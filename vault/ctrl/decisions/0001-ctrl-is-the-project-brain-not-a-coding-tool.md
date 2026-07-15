# 0001 — CTRL 是项目大脑 / context 层,不是 coding 工具

- 状态:Accepted
- 日期:2026-06-11
- 关联:`vault/ctrl/adrs/005-irisy.md`(Irisy = persona shell + context injection)、`vault/ctrl/adrs/008-irisy-assistant.md`(vault-is-ledger)

## Context
bao:「不需要写代码,Claude/Codex 已经做得很好了。」

调研证实:coding agent 强在**生成**、弱在**持久化项目知识**(业界叫 "AI amnesia")。缺的正是非代码知识 —— 决策理由、why、历史上下文。
- Gartner:**60% 的 AI agent 生产失败源于 context 质量问题**(missing/stale context)。
- Meta 专门建了一个**独立知识层**(50+ agent 产出 59 个 context 文件,编码工程师脑里的 tribal knowledge)—— 直接印证「写代码」和「管知识」该分开。
- 所有 coding 工具都读 context 文件(CLAUDE.md / AGENTS.md / .cursorrules / llms.txt),但**没人负责保持它 current**(HumanLayer 原话:"largely unaddressed gap")。

## Decision
**CTRL 不写代码。** CTRL = 本地、用户拥有的「项目大脑」:捕获决策 + 喂 context 给 coding agent(Claude Code / Codex / Cursor)。CTRL 写 spec / 决策 / context,coding agent 写代码。**互补,不抢。**

角色 = **capture → recall → supply** 循环:
- **capture**:Irisy in-line 把决策 + 理由 + 待办蒸馏进 vault(plain markdown)
- **recall**:本地 RAG(SQLite FTS5 + WASM embeddings)问答
- **supply**:派生 `AGENTS.md`(主,30+ agent 兼容)+ 薄 `CLAUDE.md`/`.cursorrules` 引用它;可选 vault-knowledge MCP server(CTRL 已有 mcp.spawn)

## Consequences
- **wedge**:vault 是真相 → 内容变化时**自动重新派生** context 文件 → 「CLAUDE.md 变陈旧」结构上不可能(这是没人解决的空位)。对齐「local is truth, derived is mirror」。
- **泛化**:同一循环跑客户笔记 / 会议决策 / 研究 = 一人公司的大脑;软件项目是 beachhead(最痛、context 目标最清晰)。
- **edge**:local + 你拥有知识(plain markdown,过 vim test,无导入导出)+ 跨工具中立(不是 agent 厂商,能平等喂所有 agent)。
- **架构已就位**:ADR-005(Irisy=context injection)、ADR-008(vault-is-ledger + curator loop)、ADR-002(FTS5+embeddings RAG)。新的只是**命名为产品** + ship「vault → AGENTS.md/MCP」供给步。

## Sources
见 [research/project-brain-positioning.md](../research/project-brain-positioning.md);memory `project-ctrl-is-project-brain-context-layer`。
