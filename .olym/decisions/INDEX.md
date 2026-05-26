<!-- ADR Index — hand-maintained until scripts/adr-check.py lands from hello-olym. -->
<!-- Governance rules: see PROCESS.md (lifecycle SLA / status transitions / reserved registry). -->

# Decisions (ADR) — Index

## Active

| # | Title | Status | Date | Deciders | Scope | SLA |
|---|---|---|---|---|---|---|
| [001](./001-system-architecture.md) | Adopt 4-layer AI-native Agent OS kernel architecture (+ amendments 1-4) | accepted | 2026-05-11 | bao, zeus | framework | — |
| [002](./002-pwa-pivot.md) | Pivot UI to single PWA codebase under thin Tauri 2 native shell | accepted | 2026-05-13 | bao, zeus | framework | — |
| [003](./003-multi-device-mesh.md) | Mesh cross-device communication with E2E crypto + CRDT | accepted | 2026-05-14 | bao, zeus | framework | — |
| [004](./004-kernel-capability-surface.md) | Kernel capability surface — 10 namespaces / 28 methods (freq ≥3) | proposed | 2026-05-22 | bao, zeus | framework | 3/7 |
| [005](./005-no-claude-in-production-runtime.md) | No Claude / Anthropic SDK in CTRL production runtime | accepted | 2026-05-18 | bao, zeus | framework | — |
| [007](./007-encryption-library.md) | Adopt vodozemac (Matrix Olm) for E2E crypto on all platforms | accepted | 2026-05-16 | bao, zeus | framework | — |
| [010](./010-keycap-execution-model.md) | Keycap execution model — MCP outward, Actor inward | accepted | 2026-05-17 | bao, zeus, hephaestus | framework | — |
| [011](./011-update-channel-and-delivery.md) | Tauri 2 updater + three-mirror channel for global + CN delivery | accepted | 2026-05-17 | bao, zeus | framework | — |
| [012](./012-subprocess-actor-pty.md) | SubprocessActor + portable-pty for Code Space coding companion | accepted | 2026-05-19 | bao, zeus | framework | — |
| [013](./013-kernel-as-mcp-server.md) | Kernel as MCP server — single bus for hermes / Irisy / external agents | accepted | 2026-05-22 | bao, zeus | framework | — |
| [014](./014-ctrl-global-english-first.md) | CTRL = global English first — UX, marketing, keycap priority | accepted | 2026-05-22 | bao, zeus | framework | — |
| [015](./015-obsidian-philosophy.md) | Obsidian philosophy — CTRL is user-augmentation, not knowledge intermediary | accepted | 2026-05-22 | bao, zeus | framework | — |
| [016](./016-irisy-eight-stage-lifecycle.md) | Irisy 8-stage keycap lifecycle — companion across Discovery → Retire | accepted | 2026-05-22 | bao, zeus, hephaestus | framework | — |
| [017](./017-remote-coview-is-irisy.md) | Remote co-view = Irisy primitives (mesh = sync only, not viewer) | accepted | 2026-05-22 | bao, zeus | framework | — |
| [018](./018-auto-update-strategy.md) | Auto-update strategy — 4 layers (app / hermes / keycap / PWA) × 3 tiers | accepted | 2026-05-22 | bao, zeus | framework | — |

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

**Index version**: 0.7 (2026-05-25 — adr-architecture-debt-cleanup: +013/014/015/016/017/018 active, 019 superseded, reserved status annotated, ADR-004 SLA bumped to 3/7)
**Process**: see [PROCESS.md](./PROCESS.md)
**Template**: see [_template.md](./_template.md)
