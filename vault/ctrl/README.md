# CTRL 文档地图

> 本目录存放 CTRL 的本地 Markdown 项目知识。它是可读、可搜索的开发上下文，不是第二套架构权威。

## 权威顺序

1. [`GOAL.md`](GOAL.md)：唯一活跃开发目标，由 bao 拥有。
2. [`adrs/INDEX.md`](adrs/INDEX.md)：8 个 active module ADR 的唯一索引。
3. [`adrs/001-spine.md`](adrs/001-spine.md)：不可变脊柱。
4. owning module ADR：该模块架构决定的唯一真相。
5. 代码、构建和测试：当前运行事实。

产品说明、规划、研究、历史和日志不能覆盖 accepted ADR。发现冲突时，应修正或归档非权威文档；若 accepted ADR 与实现冲突，停止并由 bao 裁决。

## 目录职责

- [`adrs/`](adrs/) — 唯一 active architecture decision corpus；只在这里维护 accepted module decisions
- [`plans/`](plans/) — 当前或候选实施计划；不能覆盖 ADR，完成或失效后移入 `history/`
- [`research/`](research/) — 非权威证据、竞品研究与技术调查
- [`development/`](development/) — CTRL 仓库开发方法、harness 和团队流程
- [`specs/`](specs/) — 非 ADR 的实施规格；架构决定仍须回到 owning ADR
- [`generated/`](generated/) — 由脚本生成的人类可读清单；不得手工维护为权威
- [`inventories/`](inventories/) — 当前盘点和审计输入；不作架构决定
- [`history/`](history/) — superseded、retired 或完成材料；仅保留 provenance，不是 live authority
- [`strategy/`](strategy/) — 带时间边界的非权威战略快照
- [`log/`](log/) — append-only 过程记录

顶层只保留固定权威入口、当前规划镜头和机器依赖的 endpoint schema。`irisy-roles.md` 与 `irisy-coding-companion.md` 是为 ADR-005 §11 路径兼容而保留的 retired pointers，不是第二份角色设计。

## 入口

- [`GOAL.md`](GOAL.md) — 当前范围与可验证成功标准
- [`adrs/INDEX.md`](adrs/INDEX.md) — 模块 owner、版本与代码位置
- [`adrs/PROCESS.md`](adrs/PROCESS.md) — ADR 修订与验收流程
- [`irisy-architecture.md`](irisy-architecture.md) — 仅保留当前 GOAL 使用的五能力规划镜头
- [`mcp-schema.json`](mcp-schema.json) — 代码依赖的机器可读 endpoint schema
- [`generated/endpoint-catalog.md`](generated/endpoint-catalog.md) — 从 schema 生成的非权威人类可读清单

## Irisy 与开发代理

Irisy、Coding agent 和 CTRL development agent 的角色边界只由 [`ADR-005 §11`](adrs/005-irisy.md#11-app-ai-assistant-role-boundary-v36) 定义。本目录不再维护第二份角色或 Coding Companion 设计。
