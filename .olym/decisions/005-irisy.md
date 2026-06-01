---
adr_id: 005
module: irisy
title: CTRL Irisy — 8-stage keycap lifecycle + remote co-view primitives + persona rule
version: 1
status: accepted
last_updated: 2026-05-31
deciders: [bao, zeus, hephaestus]
sections:
  - { id: lifecycle,    source: orig-016 }
  - { id: remote-view,  source: orig-017 }
  - { id: persona,      source: orig-024-§7 + new-2026-05-31-prompt-v5 }
changelog:
  - v1 2026-05-31: module reorg — merged orig-016 (8-stage keycap lifecycle) + orig-017 (remote co-view = Irisy primitives) + lifted orig-024 §7 persona rule into this ADR + amended persona rule with prompt v5 (brain self-awareness with brand labels).
related:
  - .olym/decisions/002-substrate.md
  - .olym/decisions/003-frontend.md
---

## §1 8-stage keycap lifecycle

Irisy = vertically-cross-cutting companion. **8 stages**, each with explicit role + UI surface.

| # | Stage | User intent | Irisy role | UI surface |
|---|---|---|---|---|
| 1 | Discovery | "what tools exist for X?" | Recommend keycaps by use-case query; surface MCP marketplace + agentskills.io results | Pool overlay, Irisy as filter/rank layer |
| 2 | Creation | "I need a keycap that does X" | Co-author manifest + tool code | Creator drawer (chat / manifest / code preview) |
| 3 | Config | "set up this keycap for me" | Walk through `config_schema`; suggest defaults | Inline Irisy bubble on first invocation OR Settings |
| 4 | Invoke | "do this" | Disambiguate vague intent → keycap selection; pre-fill args; explain expected result | Keyboard tile long-press / quick-action overlay |
| 5 | Collab | "explain what just happened" / iterate | Annotate output; chain to next keycap; co-edit | Workspace tab side-panel (drawer adjacent to active tab) |
| 6 | Debug | "didn't work — why?" | Read stderr / ST-SS error cells; suggest fix; offer to amend manifest | Workspace tab inline error overlay |
| 7 | Improvement | "this could be better at X" | Capture as Patch-tier amendment (ADR-004 §4); offer upstream PR when applicable | Bubble after repeat use; long-press → "improve this keycap" |
| 8 | Retire | "I don't use this anymore" | Help uninstall / archive; preserve vault data; reset keychain tokens | Settings drawer when usage falls below threshold |

**Companion ≠ in-your-face**:
- Default visibility = bubble (collapsed); user click → drawer
- **Single user-facing persona** (memory `decision_one_persona_irisy` 🔒) — Irisy never switches; internal sub-modes invisible
- **First-class PWA page**, not a keycap (memory `decision_irisy_is_pwa_native_not_keycap` 🔒)
- Drawer slides from bottom or right; never full-screen takeover (ADR-003 § nav-keyboard)

Stage 7 → 2 loopback (Improvement feeds new Creation) is the creator-economy flywheel.

**v1 ship**: stage 1 (Chat / Assistant) only via `IrisyChat.tsx`. Stages 2-7 = v1.1+ per memory `feedback_no_planning_no_phasing`.

## §2 Remote co-view — Irisy primitives (NOT mesh)

Memory `project_remote_co_view_is_irisy` 🔒 — 远程同屏 / mirror / 跨设备 viewer / session 接管 are Irisy primitives layered ON mesh (ADR-002 § crypto), not mesh itself. Mesh = CRDT state sync; co-view = live observability + interaction over a session.

**4 primitives** (zeus owns kernel substrate, daedalus owns Irisy UI):

1. **`session.observe`** — viewer-side Irisy subscribes to host-side kernel's ST-SS workspace cell stream (filtered by allow-list of cell kinds). Read-only by default.
2. **`session.share`** — host-side Irisy generates ephemeral share URL (`ctrl://session/<id>?token=<...>`). Token authenticates viewer kernel to host kernel's MCP wire (ADR-002 § mcp-bus, port 17873 OR relay-traversed equivalent for cross-device).
3. **`session.takeover`** — viewer can send Op events back to host (clipboard write / keycap invoke / Irisy say). Requires explicit allow-list in `share` token (capability-scoped per ADR-004 §1).
4. **`session.narrate`** — viewer's Irisy renders narration overlay: "your phone Irisy is observing your PC; current keycap = X; recent action = Y". Generated client-side from cell stream.

**Wire**:
- Same-LAN (mDNS-discovered): direct WebRTC peer via vodozemac Olm (same Olm session that mesh uses)
- Cross-NAT: `ctrl-relay` Worker (STUN/TURN-like NAT traversal); payload E2E encrypted (relay sees only encrypted blobs)
- Underlying = ST-SS cell stream subset over WebRTC data channel
- NOT a separate transport — same stack as mesh; difference is what flows through

**NOT promised**:
- Not a remote desktop tool — CTRL streams workspace cells (semantic events), not pixel buffers
- Not in v1 scope — primitives roadmapped to v1.1 once mesh + Irisy 8-stage stable

## §3 Persona rule + prompt v5 (binding)

**Persona is per-keycap** — lives inside `cap_asset.files` as markdown (ADR-002 § composition axis 6). Vault override `vault/keycaps/<id>/persona.md` wins; no global persona library, no shared persona indirection.

**Irisy prompt v5** (`vault/.irisy-prompts/irisy-system.md`):

1. **Self-aware via `brain_status()`** — kernel injects `<brain_state>` block (engine label / providers / health / last_failover) from ADR-002 § provider §3.7. Irisy answers "你是什么 / 用什么模型" using this state.
2. **User-friendly labels only** — say "Claude 订阅" / "Volc Doubao" (brand label). Never expose RPC codenames: "Pi" / "claude-oauth" / "RpcClient" / "kernel" / "bridge" / "MCP".
3. **Singleton brain** — never suggest "切换 brain". User switches **provider** (Settings → Providers), not brain.
4. **Failover transition** — on `provider:failover` event ("Claude 暂时连不上, 我切到 Volc 了"). Use the typed event, not heuristics.
5. **Settings deflect** — provider/model change ask → "在 Settings → Providers 改" (one line, no inline provider explanation).
6. **Tool call hiding** — tool plumbing never streams to chat (binding per ADR-002 § composition §7).
7. **Reply style** — one short paragraph default; no "Sure!" / "Of course!" preamble; start at the answer.

**`PROMPT_VERSION` bump policy**: any change to system prompt body → bump `PROMPT_VERSION` in `packages/ctrl-web/src/lib/irisy-prompts.ts` so `ensurePromptsBootstrap` re-seeds vault snapshots. v4 → v5 is this ADR's deliverable.

## Acceptance

### Lifecycle (§1)
- [x] ADR locks 8-stage model + invisible internal mode routing. v1 ships stage-1 (Chat) via `IrisyChat.tsx`. Closed.
- [x] No mode-switcher UI in shipped code; `decision_one_persona_irisy` honored. Verified.

### Remote co-view (§2)
- [x] ADR direction recorded; v1 ships none of these (v1.1+ scope). Closed at "decision recorded".

### Persona + prompt v5 (§3)
- [x] Persona is per-keycap `cap_asset.files/persona.md`; vault override path declared. ADR-002 § composition axis 6 closes the schema side.
## Future work

- Irisy prompt v5 — bumps `PROMPT_VERSION` 4 → 5 in `packages/ctrl-web/src/lib/irisy-prompts.ts`; replaces v4 "no codenames" hard-ban with "brand labels only + self-aware via brain_status + failover transition + Settings deflect". Lands with ADR-002 § provider §3.7 introspection wiring.
- Stages 2-7 (Creation / Config / Invoke / Collab / Debug / Improvement) UI surfaces — v1.1+ scope (memory `feedback_no_planning_no_phasing`)
- Stage 8 (Retire) Settings drawer for low-usage keycaps
- Cross-stage conversation history via `LocalStorage` namespace `irisy:<stage>:<keycap_id>`
- Remote co-view § 4 primitives (session.observe / share / takeover / narrate) — v1.1+ scope

## Provenance

- §1 ← orig-016 (Irisy 8-stage keycap lifecycle, 2026-05-22, accepted)
- §2 ← orig-017 (Remote co-view = Irisy primitives, 2026-05-22, accepted, v1.1+ scope)
- §3 ← orig-024 §7 (Irisy persona rule, 2026-05-30) + amendment 2026-05-31 (prompt v5 replaces v4 "no codenames" with brand-label + self-aware policy; closes bao 2026-05-31 root issue "Irisy doesn't know its own stack")
