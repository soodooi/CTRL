# 调研:CTRL = 项目大脑 / context 层 (2026-06-11)

问题:CTRL 不写代码,那它做什么? 答:**项目大脑 —— 捕获决策 + 喂 context 给 coding agent。**

## 为什么是真空位
- **coding agent 健忘**("AI amnesia"):强生成、弱持久化项目知识(决策理由、why、历史)。Gartner:60% AI agent 生产失败源于 context 质量。Meta 建独立知识层(59 个 context 文件编码 tribal knowledge)印证 role-split。
- 所有 coding 工具读 context 文件(CLAUDE.md/AGENTS.md/llms.txt),但**没人保持它 current**(HumanLayer:"largely unaddressed gap")。Claude memory 部分解决但只 Claude、工具锁定、不透明、非用户拥有。
- **capture→recall→supply 循环没人端到端拥有 + 让用户拥有**:Pieces 有 capture 但专有 store;Obsidian 本地但被动;Claude-Mem 生成 context 但只 Claude;agentmemory 跨 agent 但 dev backend。**交集是空的。**

## 对标产品(学什么)
| 产品 | 学 | 短板 |
|---|---|---|
| Obsidian + Smart Connections | 本地 plain-markdown + 本地 embedding RAG(零云/零 key/离线) | 被动 PKM,不自动 capture |
| Pieces (devs) | capture→recall(本地、加密、PII-stripped、跨工具) | 专有 store;偏人看不喂 agent |
| Claude-Mem | 自动生成/维护 context 文件 | 只 Claude、锁定、会陈旧 |
| Logseq | capture-first daily journal(低摩擦) | AI 弱 |
| Tana | AI 自动 capture(会议 bot)+ supertags | 云、专有数据模型(导出失真) |
| work-buddy.ai | 理念同盟:local-first + approval-gated + 数据不离机 | 要 Python service + Claude Code 订阅 |

## CTRL 的 wedge
vault 是真相 → 变化时**自动重新派生** AGENTS.md/MCP → agent 读到永远最新。「CLAUDE.md 变陈旧」结构上不可能。

## 最佳实践(context 供给层)
- **AGENTS.md 是收敛点**(30+ agent 读),单一真相源,简短(<60-300 行),progressive disclosure 链向 decisions。
- 可选 **MCP 知识 endpoint**(agent 实时查 vault,绕开 staleness)。

## 落地(映射现有零件)
- capture:Irisy in-line → vault(扩展 ADR-008 curator loop)
- recall:FTS5 + embeddings 本地 RAG
- supply:派生 AGENTS.md + vault-knowledge MCP(CTRL 有 mcp.spawn)

> 详见 [decisions/0001](../decisions/0001-ctrl-is-the-project-brain-not-a-coding-tool.md);memory `project-ctrl-is-project-brain-context-layer`。完整调研报告(含 Meta/Gartner/HumanLayer sources)在那条 memory。
