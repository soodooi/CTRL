# ADR Index

Architecture Decision Records (ADR) — chronological, never deleted, supersede via new ADR.

> Lifecycle codified in [ADR-002 §12](./002-pwa-pivot.md#12-decision-amendment-process).

| # | Title | Status | Date | Supersedes |
|---|---|---|---|---|
| [001](./001-system-architecture.md) | CTRL System Architecture — AI-native Agent OS Kernel | **Accepted** | 2026-05-11 | (prior Tauri DDD framing in `src-tauri/`) |
| [002](./002-pwa-pivot.md) | PWA UI Pivot — Tauri 2 Native Shell + Shared Web Codebase | **Accepted** (2026-05-13) | 2026-05-13 | ADR-001 §3.1 (UI rendering layer), §6 items #1/#7-9/#13/#15 (delivery surface), §10 (15 keycap delivery shape) — partial only; ADR-001 spine preserved |
| [003](./003-multi-device-mesh.md) | Multi-device Mesh Communication Architecture | **Accepted** (2026-05-14) | 2026-05-14 | ADR-002 §5/§10/§13/§16 (bundle/phase/SC/binary budgets revised), ADR-002 §8/§9 (mobile lane + ctrl-relay deferral superseded), ADR-001 §6 item #18 / §11 (CRDT promoted, lib chosen) — partial only; primitives + sources preserved |

---

## Status legend

- **Proposed** — written, awaiting bao Accept
- **Accepted** — bao confirmed, code may follow
- **Superseded** — later ADR amends/replaces (kept in tree, never deleted)
- **Rejected** — bao declined (kept in tree as history)

## Process (one-line summary of ADR-002 §12)

1. New ADR = monotonic id (`00N`), header lists `Supersedes` / `Preserves` from prior ADRs
2. Status starts `Proposed`; only bao moves to `Accepted` / `Rejected`
3. Steering doc (`.olym/steering/ctrl-strategy.md`) updates in **same PR** as Accept, never lags
4. Specs under `.olym/specs/` declare their parent ADR; spec lifecycle `Draft v0.x` → `Stable v1.0`
5. Handoffs (`.olym/handoffs/H-YYYY-MM-DD-NNN-*.md`) reference parent ADR + spec; one handoff per discrete deliverable

## Pending decisions

(none — ADR-003 accepted 2026-05-14, choice "A": full mesh + mobile lane in v1.0; phase plan P4.5/4.6/4.7/4.8 added to v1.0 mandatory; ADR-002 §5/§10/§13/§16 amended in-place)

## Parallel lanes

| Lane | Owner | Branch / location | Handoff |
|---|---|---|---|
| Win11 PWA pivot | zeus (Win) | `feat/h-001-e-cleanup` (in review/merge) | H-2026-05-13-001 |
| macOS migration | athena (MacBook physical) | `feat/h-001-mac-migration` (clone on Mac, ~1.5 day) | H-2026-05-14-002 |
| Multi-device mesh | paused | `feat/h-003-mesh-comm` worktree `D:/code-space/ctrl-h003-mesh` | H-2026-05-14-001 (on hold) |
