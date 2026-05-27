---
adr_id: 007
title: Adopt vodozemac (Matrix Olm) for E2E crypto on all platforms
status: accepted
date: 2026-05-16
deciders: [bao, zeus]
related:
  - .olym/decisions/003-multi-device-mesh.md
  - .olym/handoffs/H-2026-05-14-001-mesh-comm.md
scope: framework
module: substrate
supersedes: []
superseded_by: []
---

## Context

ADR-003 had an internal inconsistency: §3.1 text said vodozemac; §7 platform table listed `libsignal-wasm` for iOS / Android. Sprint 1 evidence (H-2026-05-14-001) confirmed vodozemac was the actual selection — §7 was a copy-paste leftover. `packages/ctrl-mesh/` is still skeleton with no crypto dep introduced, so decision cost is zero now and rises sharply once Sprint 2 wires actual mesh.

## Decision

Adopt **vodozemac** (Matrix.org's Rust Olm fork) on all platforms — Tauri 2 desktop (Rust crate), PWA mobile (WASM via `wasm-bindgen`), future hardware peers (Rust or minimal C FFI). **Olm 1:1 sessions only** (point-to-point double-ratchet); Megolm disabled (CTRL = single-user multi-device, no group scenarios). libsignal-* explicitly rejected. Defense-in-depth: DH public-key validity / non-contributory check at wrapper layer.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | libsignal-wasm (Signal's official WASM) | Signal upstream policy: "use outside Signal is not yet recommended"; C++ source → complex WASM toolchain; libsignal-rust (desktop counterpart) carries same upstream warning |
| A2 | Mixed vodozemac (PWA) + libsignal-rust (desktop) | 2 codebases, 2 protocol implementations, audit cost doubles, behavior drift inevitable |
| A3 | Raw NaCl / libsodium | Primitives, not protocol — hand-roll X3DH + Double Ratchet = footgun beyond solo capacity |
| A4 | Plain TLS (no app-layer crypto) | Relay sees plaintext → breaks ADR-003 §4.2 zero-knowledge promise |

## Consequences

**Positive**:
- Single crypto stack across all platforms; Rust + WASM same source
- Active Matrix-team maintenance + 10-year battle-tested Olm protocol
- Resolves ADR-003 §3.1 vs §7 conflict
- Bundle ~150 KB (≈ libsignal); iOS PWA WASM compile ~80ms first load (acceptable)

**Negative / cost**:
- vodozemac is less name-known than libsignal in audit literature
- Audit literature volume favors libsignal — CTRL bears education cost when third parties audit

**Reversal cost**:
- Medium — ~2 weeks once `packages/ctrl-mesh/` is wired. Swap crate + redo WASM bindings + retest pairing flow. Cleaner if done before Sprint 2 mesh-baseline merge.

## Acceptance

- [ ] `packages/ctrl-mesh/` Cargo.toml has only `vodozemac`, no `libsignal-*`
- [ ] PWA bundle imports vodozemac-wasm; no `@signalapp/libsignal-client`
- [ ] vodozemac pinned to ≥ 2026-02 (post-Soatok DH disclosure fix), exact commit/tag noted in Cargo.toml comment
- [ ] DH public-key validity / non-contributory check added in wrapper layer (defense-in-depth, not relying on lib internal check)
- [ ] Pairing-flow smoke test passes on macOS desktop + iOS Safari + Android Chrome

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 | Initial proposed (zeus); awaiting bao Accept for mesh sprint kickoff |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format |
| 2026-05-19 | **Accepted** (bao verbal-go + zeus). CLAUDE.md stack table already locked vodozemac; lane-E mesh impl unblocked. |
| 2026-05-20 | **Amend (no status flip)**: lane-D mesh spike (PR #8) confirms vodozemac 0.10 ships NonContributoryKey DH-validity check natively (Soatok disclosure fix). Original §Defense-in-depth wrapper-layer check downgrades from "primary" to "belt-and-braces" — keep code but acknowledge upstream covers the case. No re-acceptance needed (clarification of implementation reality, not decision change). |
