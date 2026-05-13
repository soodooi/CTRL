# ADR Index

Architecture Decision Records (ADR) — chronological, never deleted, supersede via new ADR.

> Lifecycle codified in [ADR-002 §12](./002-pwa-pivot.md#12-decision-amendment-process).

| # | Title | Status | Date | Supersedes |
|---|---|---|---|---|
| [001](./001-system-architecture.md) | CTRL System Architecture — AI-native Agent OS Kernel | **Accepted** | 2026-05-11 | (prior Tauri DDD framing in `src-tauri/`) |
| [002](./002-pwa-pivot.md) | PWA UI Pivot — Tauri 2 Native Shell + Shared Web Codebase | **Accepted** (2026-05-13) | 2026-05-13 | ADR-001 §3.1 (UI rendering layer), §6 items #1/#7-9/#13/#15 (delivery surface), §10 (15 keycap delivery shape) — partial only; ADR-001 spine preserved |

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

(none — ADR-002 accepted 2026-05-13)
