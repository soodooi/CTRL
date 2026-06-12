# CTRL — 项目大脑 (Project Brain)

> CTRL 自己的「项目大脑」—— 用 CTRL 该有的方式(本地 markdown vault)记录 CTRL 的开发。
> **dogfood**:CTRL = 本地项目大脑,捕获决策 + 喂 context 给 coding agent(不写代码)。
> 通过 vim test:每个文件都是 plain markdown,任何工具能开,你永远拥有。

## 现状 (2026-06-11)
- 版本:0.1.219
- **CTRL 的产品定位**:模块化、意图驱动、用户拥有的本地 AI 工作台 —— 每个能力(coding/CRM/notes)都是**可安装模块**,不内置;一个 primitive(mcp manifest)+ 意图浮现 + store。「Raycast meets local-first」→ [decisions/0003](decisions/0003-ctrl-is-modular-intent-platform.md)
- **这个 vault 的角色**:CTRL 自己的项目大脑 —— 本地 AI 项目大脑 / context 层,互补 coding agent → [decisions/0001](decisions/0001-ctrl-is-the-project-brain-not-a-coding-tool.md)
- 待落地:把 Coding/Notes 从固定 face 改成可装模块 + 意图浮现 + Discover=模块 store → [open-questions](open-questions.md)

## 入口 (Map of Content)
- **日志** [`log/`](log/) — 每天的开发进展(append-only)
- **决策** [`decisions/`](decisions/) — 关键决策记录(轻量;架构锁点见 `.olym/decisions/` 的 7 个 ADR)
- **调研** [`research/`](research/) — 竞品 + 定位调研(带 sources)
- **待解决** [`open-questions.md`](open-questions.md) — 唯一可变的「未解决」清单

## 这是什么角色:capture → recall → supply
1. **capture** — 工作/对话中把决策、理由、待办蒸馏进 vault(Irisy in-line,plain markdown)
2. **recall** — 本地 RAG(FTS5 + embeddings)问答「我们关于 X 决定了啥 / 在哪 / 为什么」
3. **supply** — 派生 `AGENTS.md` / MCP endpoint 喂给 coding agent(Claude Code/Codex/Cursor),vault 是真相所以**永远最新、不陈旧**

软件项目是 beachhead;同一个循环也跑客户笔记 / 会议决策 / 研究 = 一人公司的大脑。
