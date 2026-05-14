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

## Sub-PR map (H-2026-05-13-001 — Win PWA pivot, **merged 2026-05-14**)

| sub | Branch | Status |
|---|---|---|
| a | merged into main (c7cd54c) | ✅ ADR + phase + VI + INDEX |
| b | `feat/h-001-b-tauri2-shell` | ✅ Tauri 2 plugins + Rust shell + lone-Ctrl hotkey port — merged via e |
| c | `feat/h-001-c-pwa-scaffold` (stacked on b) | ✅ packages/ctrl-web + 3 routes + bridge + ClockStrip + KeycapCard — merged via e |
| d | `feat/h-001-d-e2e-integration` (stacked on c) | ✅ stss_bridge promoted + commands wired to KernelHandle + tauri.conf swap — merged via e |
| e | `feat/h-001-e-cleanup` (stacked on d) | ✅ merged 2026-05-14 — Win path now on main |

## Parallel lanes

| Lane | Owner | Branch / location | Handoff |
|---|---|---|---|
| Win11 backend (zeus) | zeus (Win) | `main` direct — Win UX bugs + P5/P6 backend + mesh foundation iteration | H-2026-05-13-001 (closed); P5/P6 specs WIP |
| PWA frontend polish | athena-frontend | `feat/h-001-pwa-polish` worktree `D:/code-space/ctrl-pwa-polish` | H-2026-05-14-003 |
| macOS migration | athena (MacBook physical) | `feat/h-001-mac-migration` (cloned on Mac) | H-2026-05-14-002 |
| Multi-device mesh foundation | done | merged into main (`32cef51`) — ctrl-mesh skeleton + 6 OpKind | H-2026-05-14-001 Sprint 1 done |
| Multi-device mesh implementation | athena (Sprint 2+, paused) | `feat/h-003-mesh-comm` worktree `D:/code-space/ctrl-h003-mesh` | H-2026-05-14-001 (resumes when bao starts mesh Sprint 2) |

## Related spike

- `feat/h-003-stss-spike` (H-2026-05-13-002) — ST-SS double-direction validation. Promoted into `kernel::stss_bridge` in sub-PR d (now on main); spike binary + viewer retained in `share/stss-spike/` as reference.
