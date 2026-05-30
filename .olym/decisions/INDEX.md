<!-- ADR Index — hand-maintained until scripts/adr-check.py lands from hello-olym. -->
<!-- Governance rules: see PROCESS.md (lifecycle SLA / status transitions / reserved registry). -->

# Decisions (ADR) — Index

## Active

| # | Title | Module | Status | Date | Deciders | SLA |
|---|---|---|---|---|---|---|
| [001](./001-system-architecture.md) | 4-layer AI-native Agent OS kernel architecture (project doc + module index) | spine | accepted | 2026-05-11 | bao, zeus | — |
| [002](./002-pwa-pivot.md) | Pivot UI to single PWA codebase under thin Tauri 2 native shell | frontend | accepted | 2026-05-13 | bao, zeus | — |
| [003](./003-multi-device-mesh.md) | Mesh cross-device communication with E2E crypto + CRDT | substrate | accepted | 2026-05-14 | bao, zeus | — |
| [004](./004-kernel-capability-surface.md) | Kernel capability surface — 10 namespaces / 28 methods (freq ≥3) | substrate | **proposed** | 2026-05-22 | bao, zeus | 3/7 |
| [005](./005-no-claude-in-production-runtime.md) | No Claude / Anthropic SDK in CTRL production runtime | cross-cutting | accepted | 2026-05-18 | bao, zeus | — |
| [007](./007-encryption-library.md) | Adopt vodozemac (Matrix Olm) for E2E crypto on all platforms | substrate | accepted | 2026-05-16 | bao, zeus | — |
| [010](./010-keycap-execution-model.md) | Keycap execution model — MCP outward, Actor inward | cap | accepted | 2026-05-17 | bao, zeus, hephaestus | — |
| [011](./011-update-channel-and-delivery.md) | Tauri 2 updater + three-mirror channel for global + CN delivery | cap | accepted | 2026-05-17 | bao, zeus | — |
| [012](./012-subprocess-actor-pty.md) | SubprocessActor + portable-pty for Code Space coding companion | substrate | accepted | 2026-05-19 | bao, zeus | — |
| [013](./013-kernel-as-mcp-server.md) | Kernel as MCP server — single bus for hermes / Irisy / external agents | substrate | accepted | 2026-05-22 | bao, zeus | — |
| [014](./014-ctrl-global-english-first.md) | CTRL = global English first — UX, marketing, keycap priority | cross-cutting | accepted | 2026-05-22 | bao, zeus | — |
| [015](./015-obsidian-philosophy.md) | Plain-text philosophy — CTRL is user-augmentation, not knowledge intermediary | cross-cutting | accepted | 2026-05-22 | bao, zeus | — |
| [016](./016-irisy-eight-stage-lifecycle.md) | Irisy 8-stage keycap lifecycle — companion across Discovery → Retire | irisy | accepted | 2026-05-22 | bao, zeus, hephaestus | — |
| [017](./017-remote-coview-is-irisy.md) | Remote co-view = Irisy primitives (mesh = sync only, not viewer) | irisy | accepted | 2026-05-22 | bao, zeus | — |
| [018](./018-auto-update-strategy.md) | Auto-update strategy — 4 layers (app / hermes / keycap / PWA) × 3 tiers | cap | accepted | 2026-05-22 | bao, zeus | — |
| [020](./020-vmark-stack-adoption.md) | VMark stack adoption — viewer registry + vault browser + smart table | frontend | accepted | 2026-05-25 | bao, daedalus | — |
| [024](./024-substrate-composition-model.md) | Substrate composition model — keycap = 6-axis manifest binding (incl. cap-asset; persona folded in); multi-modal brain (text+image+audio); schema convergence + dispatch unification | substrate | **proposed** | 2026-05-30 | bao, zeus | 0/7 |

### Module index (jump to entry SPEC)

| Module | SPEC entry | ADRs |
|---|---|---|
| **spine** | (ADR-001 itself) | 001 |
| **substrate** | [`.olym/specs/substrate/SPEC.md`](../specs/substrate/SPEC.md) | 003 · 004 · 007 · 012 · 013 · 024 |
| **cap** | [`.olym/specs/cap/SPEC.md`](../specs/cap/SPEC.md) | 010 · 011 · 018 |
| **irisy** | [`.olym/specs/irisy/spec.md`](../specs/irisy/spec.md) | 016 · 017 |
| **frontend** | [`.olym/specs/frontend/SPEC.md`](../specs/frontend/SPEC.md) | 002 · 020 |
| **cross-cutting** | (no module SPEC) | 005 · 014 · 015 |

> SLA 列 = "已挂天数 / SLA 上限"。P0 超时 → bao 决策顶；详见 PROCESS.md §1。

## Reserved (号码登记)

每个保留号必有 owner + trigger，否则 6 个月后 release。

| # | 主题 | Owner | Trigger 条件 | 占号自 | 现状 |
|---|---|---|---|---|---|
| 006 | AI provider gateway | zeus | ADR-004 accepted | 2026-05-17 | 等 ADR-004 翻 accepted；ADR-004 现 proposed 3/7 |
| 008 | Tokyo VPS primary topology | hephaestus | VPS deploy verification 完成 | 2026-05-17 | 实装已部分完成 (hermes/Caddy/Postgres on 52.196.27.37, hermes.ctrlapplab.com)；待 hephaestus 整理成 ADR |
| 009 | Multi-tenant baseline | zeus | 第 2 个商业项目签约 | 2026-05-17 | 6 月 release 倒计时 → **2026-11-17 前未触发自动 release** |

## Superseded / Deprecated

| # | Title | Superseded by | Date | Why |
|---|---|---|---|---|
| [019](./019-ctrl-hermes-plugin-primary.md) | CTRL = hermes plugin (primary integration); kernel MCP server demoted to IPC + secondary surface | [001 amendment 2026-05-25](./001-system-architecture.md#amendment-2026-05-25--pi-as-sole-brain--hermes-as-keycap--vmark-not-substrate) | 2026-05-25 | Brain reframe: Pi = sole brain (lazy npm install); hermes 降为可选 personal-assistant keycap |

---

**Index version**: 0.9 (2026-05-26 — ADR-001 restructured as project doc; Module column + Module index added; all ADRs got `module:` frontmatter)
**Process**: see [PROCESS.md](./PROCESS.md)
**Template**: see [_template.md](./_template.md)
