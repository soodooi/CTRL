# ADR Index

Architecture Decision Records — never deleted, supersede via new ADR.

> **找现行架构** → [EFFECTIVE.md](./EFFECTIVE.md)
> **写新 ADR** → [TEMPLATE.md](./TEMPLATE.md) + [PROCESS.md](./PROCESS.md)
> **谁能提哪类** → [ROLES.md](./ROLES.md)

---

## Accepted ADRs

| # | Title | Status | Date | Notes |
|---|-------|--------|------|-------|
| [001](./001-system-architecture.md) | System Architecture — AI-native Agent OS Kernel | **Accepted (partial supersedes)** | 2026-05-11 | Spine 保留；§3.1/§6/§9/§10/§11 已部分被 002/003 替换；§9/§10/§6 内容已抽到 specs / steering / roadmap |
| [002](./002-pwa-pivot.md) | PWA UI Pivot — Tauri 2 Native Shell + Shared Web Codebase | **Accepted (partial supersedes)** | 2026-05-13 | §8/§9/§10/§13/§16 已部分被 003 修订或替换 |
| [003](./003-multi-device-mesh.md) | Multi-device Mesh Communication Architecture | **Accepted (current)** | 2026-05-14 | 现行；但 §3.1 vs §7 加密库矛盾未解，待 ADR-007 决议；§5 配对协议已抽到 specs |

---

## Proposed / Pending

| # | Title | Owner | Status | 触发 |
|---|-------|-------|--------|------|
| ADR-004 | v1.0 键帽 scope 砍量（15 → 8）补登 | hephaestus | TODO | EFFECTIVE.md §3 警告 |
| ADR-005 | LLM provider 终选（Minimax / Claude CLI / Hermes） | zeus | TODO | EFFECTIVE.md §6 警告 |
| ADR-006 | OPC 平台 vs 工具集合定位 | bao | TODO | README-OPC-PLATFORM 与 ADR-001 §2 并存 |
| [ADR-007](./007-encryption-library.md) | 加密库 vodozemac vs libsignal-wasm 二选一 | zeus | **Proposed** (2026-05-16) | ADR-003 §3.1 vs §7 内部矛盾 |
| ADR-008 | Cloudflare + Aliyun 部署策略 | zeus | TODO | DEPLOYMENT_DECISION.md 未走 ADR |
| ADR-009 | Hermes Agent 框架最终采纳 | athena | TODO | doc/ctrl-agent-selection-summary.md 未走 ADR |

---

## Rejected

（暂无）

> **Note**: 历史上拒绝的方案（如 swift-bridge / SwiftUI 一度被探索后放弃），应有 Rejected ADR 记录，**目前补登优先级低，待精力允许**。

---

## Lifecycle

- **Proposed** —— 写了，等 bao Accept
- **Accepted** —— bao confirmed，可写代码
- **Accepted (partial supersedes)** —— 部分内容已失效，spine 仍有效，看 EFFECTIVE.md
- **Superseded** —— 整体被替代（保留作历史）
- **Rejected** —— bao 拒绝（保留作历史）

完整流程见 [PROCESS.md](./PROCESS.md)。

---

## 治理文档

| 文件 | 用途 |
|------|------|
| [EFFECTIVE.md](./EFFECTIVE.md) | 当前真理 / 现行有效架构合成视图 |
| [PROCESS.md](./PROCESS.md) | ADR 编写规则、生命周期、反 bloat 检查 |
| [TEMPLATE.md](./TEMPLATE.md) | 新 ADR 模板（MADR 3.0 风格 + 单决策约束） |
| [ROLES.md](./ROLES.md) | zeus / athena / hephaestus / bao 角色映射 |

---

## 子 PR / 工作流

历史 sub-PR map 与 parallel lanes 已搬到 `.olym/steering/ctrl-strategy.md` 与 `.olym/handoffs/`。本 INDEX 只保留 ADR 列表。
