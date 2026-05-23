---
adr_id: 018
title: Auto-update strategy — 4 layers (app / hermes / keycap / PWA) × 3 tiers (Config / Patch / Fork)
status: accepted
date: 2026-05-22
deciders: [bao, zeus]
related:
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/011-update-channel-and-delivery.md
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/decisions/016-irisy-eight-stage-lifecycle.md
scope: framework
supersedes: []
superseded_by: []
---

## Context

CTRL is a fast-moving product with a creator economy: the app itself (CTRL.app binary), the agent runtime (hermes), every keycap (creator-supplied), and the PWA bundle all change at independent cadences. Users must NOT have to manually reinstall or rebuild anything as upstream evolves.

Memory `decision_auto_update_first_class` 🔒 (2026-05-22): bao 强约束 — auto-update is first-class. Without an ADR consolidating the 4 layers + 3 user-adjustment tiers, fleet members add ad-hoc update mechanisms per layer, ending up with 4 different UX patterns + 4 different conflict-resolution flows.

ADR-011 already covers Layer 1 (CTRL.app binary via Tauri 2 updater + three-mirror). This ADR governs Layers 2-4 and the cross-layer 3-tier user-adjustment model.

## Decision

### 4 update layers (each self-driving, no manual reinstall)

| # | Layer | Mechanism | Trigger | Cadence |
|---|---|---|---|---|
| 1 | **CTRL.app binary** | Tauri 2 updater + three-mirror (ADR-011) | App launch + opportunistic poll | weekly stable / nightly dev |
| 2 | **hermes runtime** | `~/.ctrl/hermes-venv/bin/hermes update` CLI driven by kernel scheduler | Daily background check | as hermes releases (PyPI) |
| 3 | **Keycap upstream** | Per-keycap manifest `upstream_url` + signature; kernel polls + applies according to user tier (see 3 tiers below) | Daily background check OR Irisy "improvements available" bubble | per-keycap |
| 4 | **PWA bundle** | `vite-plugin-pwa` Service Worker auto-update + reload prompt | App start + visibility-change | per CTRL.app deploy (Tauri release) — coupled with Layer 1 |

### 3 user-adjustment tiers (apply to Layer 3 — keycap)

A keycap can be in one of 3 states from the user's perspective. The tier governs how upstream updates merge with user-local changes:

| Tier | What user did | Update strategy | Conflict UX |
|---|---|---|---|
| **Config** | Filled fields in `manifest.config_schema` (API keys, default model, paths). Did NOT modify code/manifest body | Clean overwrite on update. User's `config` namespace migrates by `config_schema` version; field renames handled by `config_migration` declarations in manifest | None — config is forward-compatible by design |
| **Patch** | Overrode some manifest fields or added a per-keycap config override layer (via Irisy Improvement stage 7). Still tracks upstream | Smart 3-way merge: upstream change + user patch + base. Conflicts surface as Irisy bubble at stage 6 (Debug); user accepts upstream / keeps patch / merges manually | Irisy presents diff + suggests resolution |
| **Fork** | User chose Fork at install time OR explicitly disconnected from upstream. The keycap is now a personal branch | No auto-update applied. Irisy occasionally prompts "upstream has new features X, Y — want to cherry-pick?" (stage 7 Improvement) | User-driven, explicit cherry-pick |

User-tier picker UI lives in Settings → per-keycap "update behavior" + Irisy Config stage (stage 3, ADR-016) on first install.

### Hermes skill exception (ADR-010 `target: "hermes-skill"`)

For keycaps with `target: "hermes-skill"`:

- **Config tier**: SKILL.md absent from user space (config is the only state); behaves like other Config tier
- **Patch tier**: SKILL.md patches merged smart; per-keycap `~/.hermes/skills/<id>/` is the patch site
- **Fork tier**: SKILL.md forks; Irisy prompts cherry-pick on upstream changes

The skill itself can also be updated independently via Hermes' own skill update mechanism — CTRL's update layer wraps + drives it but doesn't replace it.

### Cross-layer coordination

- Layers update INDEPENDENTLY by default (e.g. PWA can update without re-downloading CTRL.app binary if it's the same Tauri build)
- Compatibility checked via Schema/API version pinned in manifests:
  - CTRL.app declares supported keycap manifest schema range
  - Keycap declares required CTRL.app minimum version
  - Mismatch → keycap shown as "needs CTRL.app upgrade" in Pool; not invoked until resolved
- User-facing UX = "CTRL is up to date" / "1 keycap update available" / "tap to install" — never "rebuild from source"

### Signature + integrity for Layers 2-3

- Layer 2 (hermes): PyPI signature + `pip --require-hashes` verification (`hermes-agent` is `>=0.14.0` MIT)
- Layer 3 (keycap): per-keycap signing key (creator-supplied), public key in `manifest.signing.pubkey`; kernel rejects update if signature fails

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Single update layer (rebuild CTRL.app for any update) | Rejected by `decision_auto_update_first_class` 🔒; CTRL.app is too heavy to redeploy per keycap; ecosystem velocity demands per-layer cadence |
| A2 | All updates manual (user clicks "update" per layer) | Onboarding & retention killer; user shouldn't see "5 things need updating" |
| A3 | Cloud-side keycap state (auto-rolls forward, no patches) | Violates Obsidian philosophy (ADR-015); state must be local-first |
| A4 | Skip Patch tier (only Config + Fork) | Loses the creator-economy improvement loop (Irisy stage 7); Patch is the bridge between "use upstream as-is" and "fork forever" |
| A5 | Treat hermes as a CTRL-bundled binary (no separate update) | Violates `decision_hermes_mit_compliance` (lazy install); creates pip + system Python conflicts for users |

## Consequences

**Positive**:
- Users never see "reinstall CTRL", "rebuild your keycap", or "manual config migration"
- Creator economy flywheel: Patch tier creates upstream-facing improvement signal (Irisy stage 7 → 2 loopback, ADR-016)
- Hermes ecosystem velocity benefits without coupling CTRL.app release cadence
- Compatibility model is declarative (manifest schema version), not hand-coded

**Negative / cost**:
- 3-way merge for Patch tier is complex — Irisy stage 6 (Debug) must produce clear conflict UX or user trust degrades
- Per-keycap signing key adds creator onboarding friction (publish key needs distribution); mitigate via marketplace key-management service
- Layer 2 (hermes) updates can introduce skill / tool-call schema breakage; need version pinning between hermes ↔ kernel MCP server

**Reversal cost**:
- High. The 3-tier model is woven into manifest schema v0.3 + Irisy stage 6/7 UX + kernel update scheduler. Reverting to "single auto-overwrite" would lose creator economy improvement loop. Estimated 1+ month rework.

## Acceptance

- [ ] Manifest schema v0.3 adds `upstream_url`, `signing.pubkey`, `config_migration`, `compatibility.min_ctrl_version`
- [ ] Kernel scheduler module `kernel::update_scheduler` polls Layer 2 + 3 daily background
- [ ] Tauri command `keycap_update_check` + `keycap_update_apply` for Layer 3 user-driven
- [ ] Irisy stage 6 (Debug) UX renders 3-way merge conflict + per-conflict resolution buttons
- [ ] Irisy stage 7 (Improvement) UX surfaces "upstream has new features" notification
- [ ] PWA `registerSW` + auto-update with user-visible "reload to update" toast
- [ ] Per-tier behavior verified across 3 keycaps (1 Config, 1 Patch, 1 Fork)
- [ ] `.olym/specs/auto-update/spec.md` exists with detailed merge semantics + version compatibility matrix

## Counter-evidence (would invalidate this ADR)

1. 3-way merge for Patch tier proves too complex for Irisy to UX cleanly → fall back to "Patch = forks, no merge"
2. Creator signing-key infrastructure adds too much friction → drop signature for v1, accept higher integrity risk
3. Layer cadence conflicts (hermes ships breaking change between CTRL.app releases) prove unmanageable → bundle hermes into CTRL.app (reverses Alternative A5)

## Changelog

| Date | Change |
|---|---|
| 2026-05-22 | Initial accept (bao 2026-05-22 session). Locks 4 layers + 3 tiers; ADR-011 demoted to "Layer 1 of 4" with its own Acceptance unchanged. |
