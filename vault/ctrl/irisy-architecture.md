---
title: Irisy five-capability planning lens
kind: planning-lens
status: living
last_updated: 2026-08-02
owner: bao
architecture_authority: adrs/INDEX.md
verify_against: GOAL.md and owning module ADRs
---

# Irisy 五能力规划镜头

> 本文只承担 [`GOAL.md`](GOAL.md) Track 0 要求的跨模块规划镜头。它不是架构、角色、运行时或产品需求真相；所有决定必须回到 [`adrs/INDEX.md`](adrs/INDEX.md) 指向的 owning module ADR。

## 能力域

| 能力域 | Irisy 操作什么 | 主要能力边界 | 用户 surface | owning ADR |
|---|---|---|---|---|
| **Markdown 文档管理** | 笔记、知识库、功能包文档 | §14 `text` / `record` 的 `describe/query/produce` | Notes / KB workspace | ADR-002、ADR-003 |
| **HTML** | 生成并呈现可检查的 HTML artifact | §14 produce + viewer registry | Morphing output / workspace | ADR-002、ADR-003 |
| **Coding** | 请求代码或功能包结果 | 左区 OpenCode projection + governed pack lifecycle | Coding workspace | ADR-001、ADR-002、ADR-003 |
| **通讯** | 通过已声明端点调用内部和外部能力 | `:17873` gate + MCP + typed transports | Irisy / connections | ADR-010、ADR-002 |
| **L1/L2** | 导航能力并选择工作上下文 | module navigation + role configuration | L1 rail / L2 navigation | ADR-003、ADR-005 |

这些能力是异构的：Markdown 和 Coding 可形成独立 workspace；HTML 和通讯是横切能力；L1/L2 是导航层。不得为了表格对称而把每个能力都做成 L1 模块。

## 使用规则

1. 每项工作先在 [`adrs/INDEX.md`](adrs/INDEX.md) 找到 owner，再读取对应 ADR。
2. 本镜头只能发现跨模块缺口，不能创造、覆盖或降级架构决定。
3. Irisy 的 App AI 助手角色与开发代理边界只见 [`ADR-005 §11`](adrs/005-irisy.md#11-app-ai-assistant-role-boundary-v36)。
4. 外部应用与能力接入只见 [`ADR-005 §10`](adrs/005-irisy.md#10-irisy-capability-integration-contract-v35)。
5. 进度与完成度以代码、Git 和 fresh validation 为准，不写入本文。
