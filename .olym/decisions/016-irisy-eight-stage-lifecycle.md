---
adr_id: 016
title: Irisy 8-stage keycap lifecycle — companion across Discovery → Retire
status: accepted
date: 2026-05-22
deciders: [bao, zeus, hephaestus]
related:
  - .olym/decisions/002-pwa-pivot.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/specs/irisy/spec.md
scope: framework
module: irisy
supersedes: []
superseded_by: []
---

## Context

Irisy was initially scoped as "keycap-creator companion" (H-2026-05-18-001 daedalus lane): an Irisy mode for **authoring** new keycaps. bao 2026-05-22 钉死 (memory `decision_irisy_keycap_lifecycle`): Irisy is not just a creator — it's a **companion across the entire keycap lifecycle**, 8 stages from Discovery to Retire. zeus prior REVIEW of `.olym/specs/irisy/spec.md` flagged this gap (every flagged "8-gap" was Creator-centric); the spec needs to widen.

Without this ADR locking the 8 stages explicitly, fleet design tends to collapse Irisy back into "AI helper widget at Creation step" — which understates the role and leaves 7 other touchpoints unowned.

## Decision

Irisy = a vertically-cross-cutting companion. **8 stages**, each with explicit Irisy role + UI surface:

| # | Stage | User intent | Irisy role | UI surface |
|---|---|---|---|---|
| 1 | **Discovery** | "what tools exist for X?" | Recommend keycaps by use-case query; surface MCP marketplace + agentskills.io results | Pool overlay, with Irisy as filtering/ranking layer |
| 2 | **Creation** | "I need a keycap that does X" | Co-author manifest + tool code; current H-2026-05-18-001 scope | Creator drawer (3-zone: chat / manifest / code preview) |
| 3 | **Config** | "set up this keycap for me" | Walk through `manifest.config_schema` fields; suggest defaults; explain trade-offs | Inline Irisy bubble on first invocation OR Settings page |
| 4 | **Invoke** | "do this with this keycap" | Disambiguate vague intent → keycap selection; pre-fill args from context; explain expected result before commit | Keyboard tile long-press / quick-action overlay |
| 5 | **Collab** | "explain what just happened" / "iterate on the output" | Annotate keycap output; chain to next keycap; co-edit | Workspace tab side-panel (drawer adjacent to active tab) |
| 6 | **Debug** | "this didn't work, why?" | Read stderr / ST-SS error cells; suggest fix; offer to amend manifest | Workspace tab inline error overlay |
| 7 | **Improvement** | "this could be better at X" | Capture feedback as a Patch-tier amendment (ADR-018 3-tier); offer pull-request-to-upstream when applicable | Bubble after repeat use; long-press → "improve this keycap" |
| 8 | **Retire** | "I don't use this anymore" | Help user uninstall / archive; preserve vault data; reset keychain tokens | Settings drawer when usage falls below threshold |

Companion ≠ in-your-face — Irisy is **auxiliary**:

- Default visibility = bubble (collapsed); user clicks → drawer
- Per `decision_one_persona_irisy` 🔒: single user-facing persona, never switches; internal sub-modes (Janus / Talos / Mnemosyne historical names) collapsed to invisible mode-routing
- Per `decision_irisy_is_pwa_native_not_keycap` 🔒: Irisy is a first-class PWA page, not a keycap; rendered in the workspace area when explicitly summoned, otherwise in the right-edge drawer
- Per `decision_pwa_two_panel_layout` 🔒: Irisy drawer slides up from bottom or right; never takes full-screen takeover

Internal handoff between stages:

- Irisy persona-runtime carries session continuity (Hermes Agent runtime, ADR-013 wire to kernel)
- Stage transitions are tracked via workspace cells (ST-SS bridge) — kernel knows which keycap + which stage Irisy is currently companioning
- Stage 7 → 2 loopback (Improvement feeds a new Creation) is the creator-economy flywheel

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Irisy = Creation only (original H-18-001 scope) | bao 2026-05-22 explicitly widened; collapsing to single stage understates the integration framing CTRL ships against |
| A2 | Multi-persona (1 persona per stage — Janus for Config, Talos for Debug, Mnemosyne for Discovery) | Locked rejected by `decision_one_persona_irisy` 🔒; user confusion + persona-switching UX > complexity than single Irisy with mode-routing |
| A3 | Irisy as full Workspace owner (chat-app style, Irisy always-on-center) | Violates ADR-002 amendment "non-chat-app, Irisy is drawer/auxiliary"; CTRL is workbench, not chat shell |
| A4 | Stage 8 (Retire) handled by manual Settings UI, Irisy absent | Loses retention signal (Irisy noticing low-usage IS feedback for Improvement / next Discovery); also misses the "preserve user data" reassurance moment |

## Consequences

**Positive**:
- Clear mental model for hephaestus (Irisy ownership) and daedalus (Irisy UI implementation): 8 stages, each has a defined surface
- Discovery + Improvement stages drive marketplace velocity (keycap creators get usage signals)
- Single persona keeps UX simple; mode routing is internal implementation detail
- Companion framing (not assistant / not chat) aligns with workbench framing (ADR-002 amendment)

**Negative / cost**:
- 8 distinct UI surfaces is a lot for v1; some stages will ship in a stub state
- Cross-stage state (Irisy "remembering" what happened in Config when companioning Invoke) requires per-keycap conversation history → `LocalStorage` or vault-stored markdown
- Discoverability of stage 6 (Debug) and stage 7 (Improvement) is hard — users don't think to invoke Irisy for these without affordances

**Reversal cost**:
- Medium. Reversing to "Irisy = Creation only" requires removing the 7 other surfaces but doesn't break kernel/manifest. Estimated ~2 weeks of UI rework. Reversal risk low because each stage has independent value.

## Acceptance

## Acceptance — v1 scope

- [x] ADR locks 8-stage model + invisible internal mode routing (never exposed in UI per memory `decision_one_persona_irisy`). v1 ships stage-1 (Chat / Assistant) only via `IrisyChat.tsx`. Closed 2026-05-31.
- [x] Per memory `feedback_no_planning_no_phasing` + CLAUDE.md "灵活开发" (spec 暂搁): standalone `.olym/specs/irisy/spec.md` not written; ADR + code = SSOT. Closed.
- [x] Mode routing implemented internally; never exposed in UI ("Irisy is one persona"). Current `IrisyChat.tsx` exposes only Chat surface; no mode-switcher UI in shipped code. Closed.

## Future work (stages 2-7 — v1.1+ scope)

- H-2026-05-18-001 handoff (Irisy keycap-creator companion) amended: scope widens from Creation-only to full 8-stage; daedalus lane stays implementation owner, hephaestus persona-design owner
- `packages/ctrl-web/src/routes/irisy.tsx` (or replacement) holds the multi-stage drawer; stage routing happens inside (no separate routes per stage)
- Per-stage conversation history persisted via `LocalStorage` namespace `irisy:<stage>:<keycap_id>`
- Discovery (stage 1) integrates Pool overlay's existing keycap search; Improvement (stage 7) integrates ADR-018 3-tier Patch flow
- Stage 7 → 2 loopback wired (Improvement output can seed a new Creation manifest)

## Counter-evidence (would invalidate this ADR)

1. Usage analytics show users invoke Irisy at <2 of the 8 stages — collapse the framing to focus on the actually-used stages
2. Creator economy flywheel doesn't materialize (Improvement signals don't translate to manifest updates) — stage 7 becomes vestigial
3. User research shows preference for distinct personas (Janus / Talos / Mnemosyne) for distinct stages — revisit `decision_one_persona_irisy`

## Changelog

| Date | Change |
|---|---|
| 2026-05-22 | Initial accept (bao verbal-go 2026-05-22 session). zeus's prior `.olym/specs/irisy/spec.md` REVIEW flagged the Creation-only scope gap; this ADR + hephaestus's spec v0.2.0 resolve it together. |
