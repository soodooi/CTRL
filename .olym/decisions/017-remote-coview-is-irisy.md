---
adr_id: 017
title: Remote co-view = Irisy primitives (mesh = sync only, not viewer)
status: accepted
date: 2026-05-22
deciders: [bao, zeus]
related:
  - .olym/decisions/004-kernel-capability-surface.md       # § 9.2 Mesh (former ADR-003)
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/decisions/016-irisy-eight-stage-lifecycle.md
scope: framework
module: irisy
supersedes: []
superseded_by: []
---

## Context

CTRL increasingly serves "ambient" scenarios across user's devices (e.g. PC + phone + tablet) — bao raised feature ideas like "see what's on my main PC from my phone", "let Irisy on phone observe + comment on what's happening on PC", "share a session with a remote friend". These get called variously "远程同屏 / mirror / 跨设备 viewer / 远端 ambient / session 接管".

Memory `project_remote_co_view_is_irisy` (2026-05-19): bao recalibrated — these are **not mesh features**. Mesh (ADR-003) is **state sync** (Automerge CRDT for vault / keycap state). Remote co-view = **live observability + interaction over a session**, which is Irisy's territory.

Without this ADR, fleet members repeatedly draft cross-device features as "extend mesh" — which mis-shapes ADR-003 and bloats the mesh's sync-CRDT design with view-streaming concerns it shouldn't carry.

## Decision

**Remote co-view = Irisy primitives, layered on top of (not inside) mesh + kernel MCP server.**

Four primitive capabilities (zeus owns the kernel substrate, lane-A daedalus owns the Irisy UI):

1. **session.observe** — a viewer-side Irisy subscribes to the host-side kernel's ST-SS workspace cell stream (filtered by allow-list of cell kinds). Host kernel sees `observe.subscribe` events from the viewer; viewer renders cells as they arrive. Read-only by default.

2. **session.share** — host-side Irisy generates an ephemeral share URL (`ctrl://session/<id>?token=<...>`) that's exchanged via mesh peer or QR scan. Token authenticates the viewer kernel to host kernel's MCP wire (ADR-013, port 17873 OR a relay-traversed equivalent for cross-device).

3. **session.takeover** — viewer can send Op events back to host kernel (clipboard write / keycap invoke / Irisy say). Requires explicit allow-list in `share` token (capability-scoped per ADR-010). Host kernel applies viewer's Ops as if from local user.

4. **session.narrate** — viewer's Irisy renders a narration overlay: "your phone Irisy is observing your PC; current keycap = X; recent action = Y". Narration is generated client-side from the cell stream, NOT pushed by host.

Wire:

- **Same-LAN** (mDNS-discovered peers, ADR-003 sub-system): direct WebRTC peer connection via vodozemac Olm; same Olm session that mesh uses for state sync
- **Cross-NAT**: `ctrl-relay` Worker (ADR-003) provides STUN/TURN-like NAT traversal; payload is end-to-end encrypted (relay sees only encrypted blobs)
- **Underlying protocol**: ST-SS cell stream (subset filtered by `session.observe` allow-list) over the WebRTC data channel
- **NOT a separate transport** — same vodozemac + WebRTC stack that mesh uses for sync; the difference is what flows through (sync = CRDT ops, co-view = workspace cells + Irisy events)

What this ADR does NOT promise:

- **Not** a remote desktop tool — CTRL doesn't pipe pixel buffers; it streams workspace cells (semantic events: "keycap X invoked", "tab Y opened", "clipboard wrote Z"). The viewer's Irisy renders a high-level summary, not the host's screen
- **Not** in v1 scope — these primitives are roadmapped; v1 ships single-device. Building this in v1.1 once mesh + Irisy 8-stage are stable

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Extend mesh (ADR-003) to handle session view-streaming | Mesh = CRDT sync (eventually-consistent state); view-streaming = real-time event ordering. Different consistency models; folding into mesh corrupts the CRDT semantics |
| A2 | Build "CTRL remote" as a separate desktop-remote app (Screens / Parsec style) | Pixel-streaming is a different product; CTRL's value is semantic (workspace cells), not visual fidelity |
| A3 | Use a SaaS provider (Zoom / Tuple / etc.) for co-view | Violates Obsidian philosophy (ADR-015): user content leaves device, third-party in the trust path; user-account dependency reintroduced |
| A4 | Build co-view in v1 ship | Scope creep; mesh + Irisy 8-stage are not yet stable. Co-view is v1.1 once those land |

## Consequences

**Positive**:
- Mesh (ADR-003) stays focused on CRDT state sync; doesn't get bloated with view-streaming concerns
- Irisy (ADR-016) gains a clear cross-device extension story; same 8-stage lifecycle works for "remote companion"
- Reuses the existing wire (vodozemac + WebRTC + Olm + ctrl-relay); no new infra
- Semantic (workspace cells) instead of pixel-streaming → tiny bandwidth + privacy-preserving by design

**Negative / cost**:
- Higher implementation complexity than "ship a generic remote-desktop tool" — the cell-stream model requires semantic parity between host kernel events and viewer renderer
- Capability allow-list for `session.takeover` adds significant security review surface
- "Not a remote desktop" is a marketing nuance some users will miss; expect "doesn't actually show my screen" complaints

**Reversal cost**:
- Medium-low. Reversing means "remote co-view is dropped as a feature" or "co-view goes to v2 with a different mechanism". The mesh + Irisy primitives ship independently; co-view is the composition layer.

## Acceptance (v1 scope)

- [x] ADR direction recorded; v1 ships none of the v1.1 list below. Closed 2026-05-31 (bao "全量开发" sweep): the ADR's own framing scopes all work below to v1.1, so v1 acceptance is just "decision recorded" — no v1 deliverables blocked.

## Future work (v1.1+ scope — not blocking current ship)

- `.olym/specs/remote-co-view/spec.md` (zeus lane, v1.1 design phase)
- `session.observe` Tauri command + Irisy UI for "subscribe to remote session"
- `session.share` token format defined (capability allow-list embedded in JWT-like envelope, Olm-signed)
- `session.takeover` capability gate enforced through `CapabilityBroker`
- `session.narrate` PWA component renders semantic summary in real-time
- LAN smoke (2 mac on same wifi) + relay smoke (mac on LAN A + iPhone on cellular) before declaring v1.1 ready
- Marketing copy explicitly: "remote co-view ≠ remote desktop" (apollo lane)

## Counter-evidence (would invalidate this ADR)

1. User research shows demand is for **pixel-streaming** (full desktop view), not semantic co-view → CTRL has to choose between pivot (build remote-desktop) or drop the feature
2. Mesh (ADR-003) operational reality: WebRTC + relay latency is too high (>500ms) for the "ambient companion" feel; semantic streaming requires sub-100ms — would invalidate the wire reuse
3. Capability allow-list for `session.takeover` proves operationally unwieldy (too many false-positives blocking legit takeover actions) — would force redesign of capability model for cross-device

## Changelog

| Date | Change |
|---|---|
| 2026-05-22 | Initial accept (zeus, bao 2026-05-19 prior session lock recorded in memory `project_remote_co_view_is_irisy`). v1.1+ implementation, not v1; v1 ships none of these. |
