<!-- ADR Index — hand-maintained until scripts/adr-check.py lands from hello-olym. -->
<!-- Governance rules: see PROCESS.md (lifecycle SLA / status transitions / reserved registry). -->

# Decisions (ADR) — Index

## Active

| # | Title | Status | Date | Deciders | Scope | SLA |
|---|---|---|---|---|---|---|
| [001](./001-system-architecture.md) | Adopt 4-layer AI-native Agent OS kernel architecture | accepted | 2026-05-11 | bao, zeus | framework | — |
| [002](./002-pwa-pivot.md) | Pivot UI to single PWA codebase under thin Tauri 2 native shell | accepted | 2026-05-13 | bao, zeus | framework | — |
| [003](./003-multi-device-mesh.md) | Mesh cross-device communication with E2E crypto + CRDT | accepted | 2026-05-14 | bao, zeus | framework | — |
| [005](./005-no-claude-in-production-runtime.md) | No Claude / Anthropic SDK in CTRL production runtime | accepted | 2026-05-18 | bao, zeus | framework | — |
| [007](./007-encryption-library.md) | Adopt vodozemac (Matrix Olm) for E2E crypto on all platforms | accepted | 2026-05-16 | bao, zeus | framework | — |
| [010](./010-keycap-execution-model.md) | Keycap execution model — MCP outward, Actor inward | accepted | 2026-05-17 | bao, zeus, hephaestus | framework | — |
| [011](./011-update-channel-and-delivery.md) | Tauri 2 updater + three-mirror channel for global + CN delivery | accepted | 2026-05-17 | bao, zeus | framework | — |
| [012](./012-subprocess-actor-pty.md) | SubprocessActor + portable-pty execution model for Code Space coding companion | accepted | 2026-05-19 | bao, zeus | framework | — |

> SLA 列 = "已挂天数 / SLA 上限"。P0 超时 → bao 决策顶；详见 PROCESS.md §1。

## Reserved (号码登记)

每个保留号必有 owner + trigger，否则 6 个月后 release。

| # | 主题 | Owner | Trigger 条件 | 占号自 |
|---|---|---|---|---|
| 004 | 底座 capability surface | zeus | lane-B hephaestus spike RESULT.md merged | 2026-05-17 |
| 006 | AI provider gateway | zeus | ADR-004 accepted | 2026-05-17 |
| 008 | Tokyo VPS primary topology | hephaestus | VPS deploy verification 完成 | 2026-05-17 |
| 009 | Multi-tenant baseline | zeus | 第 2 个商业项目签约 | 2026-05-17 |

## Superseded / Deprecated

> 空。状态翻牌时按 PROCESS.md §6 加行。

---

**Index version**: 0.5 (2026-05-19, ADR-012 → accepted)
**Process**: see [PROCESS.md](./PROCESS.md)
**Template**: see [_template.md](./_template.md)
