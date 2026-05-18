<!-- ADR Index — hand-maintained for now (no decisions-index script in olym 0.3.1; specs/handoffs have one). -->

# Decisions (ADR) — Index

| # | Title | Status | Date | Deciders | Scope |
|---|---|---|---|---|---|
| [001](./001-system-architecture.md) | Adopt 4-layer AI-native Agent OS kernel architecture | accepted | 2026-05-11 | bao, zeus | framework |
| [002](./002-pwa-pivot.md) | Pivot UI to single PWA codebase under thin Tauri 2 native shell | accepted | 2026-05-13 | bao, zeus | framework |
| [003](./003-multi-device-mesh.md) | Mesh cross-device communication with E2E crypto + CRDT | accepted | 2026-05-14 | bao, zeus | framework |
| [005](./005-no-claude-in-production-runtime.md) | No Claude / Anthropic SDK in CTRL production runtime | proposed | 2026-05-18 | bao, zeus | framework |
| [007](./007-encryption-library.md) | Adopt vodozemac (Matrix Olm) for E2E crypto on all platforms | proposed | 2026-05-16 | bao, zeus | framework |
| [010](./010-keycap-execution-model.md) | Keycap execution model — MCP outward, Actor inward | accepted | 2026-05-17 | bao, zeus, hephaestus | framework |
| [011](./011-update-channel-and-delivery.md) | Tauri 2 updater + three-mirror channel for global + CN delivery | proposed | 2026-05-17 | bao, zeus | framework |

> Numbering gaps (004 / 006 / 008 / 009) are open ADR slots reserved for upcoming decisions
> (004 = 底座 capability surface, awaiting lane-B hephaestus spike;
> 006 = AI provider gateway, candidate after 004;
> 008 = Tokyo VPS primary topology, awaiting deployment verification;
> 009 = multi-tenant baseline, future).

