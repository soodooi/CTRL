---
adr_id: 005
module: irisy
title: CTRL Irisy — 8-stage keycap lifecycle + remote co-view primitives + persona rule
version: 2
status: accepted
last_updated: 2026-06-03
deciders: [bao, zeus, hephaestus]
sections:
  - { id: lifecycle,        source: orig-016 }
  - { id: remote-view,      source: orig-017 }
  - { id: persona,          source: orig-024-§7 + new-2026-05-31-prompt-v5 }
  - { id: soul-md-compat,   source: new-2026-06-03, note: "OpenClaw/SOUL.md ecosystem alignment per bao competitive research" }
changelog:
  - v1 2026-05-31: module reorg — merged orig-016 (8-stage keycap lifecycle) + orig-017 (remote co-view = Irisy primitives) + lifted orig-024 §7 persona rule into this ADR + amended persona rule with prompt v5 (brain self-awareness with brand labels).
  - v2 2026-06-03: NEW §4 soul-md-compat — Irisy persistent memory adopts the SOUL.md spec (github.com/aaronjmars/soul.md) verbatim, ecosystem-aligned with OpenClaw (350k stars, 2,999+ ClawHub skills, WorkBuddy compat) and Claude Code. CTRL-only extensions land in an `x-ctrl:` frontmatter namespace so vanilla SOUL.md readers stay forward-compatible. Driven by bao 2026-06-03 competitive research summarised in `.olym/brainstorm/openclaw-compat-2026-06-03.md`.
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

## §4 SOUL.md compat — Irisy persistent memory is the SOUL.md spec (NEW v2, 2026-06-03)

**Why this section exists**: bao 2026-06-03 competitive research locked
the ecosystem-alignment call. OpenClaw passed 350k GitHub stars in 60
days, ClawHub holds 2,999+ community-built skills, Tencent WorkBuddy
already ships OpenClaw compat. **SOUL.md**
(github.com/aaronjmars/soul.md) is the persona/memory config file
recognised by *both* OpenClaw and Claude Code — crossed from "single
project" to "protocol standard", the same way MCP did for tool
calling. CTRL standing outside this standard while building a
parallel manifest = creators have to pick one to invest in, and they
already picked SOUL.md.

Full strategic analysis: `.olym/brainstorm/openclaw-compat-2026-06-03.md`.

### §4.1 Lock — SOUL.md is the canonical Irisy memory format

Irisy persistent memory at `vault/irisy/SOUL.md` (single file) plus
`vault/irisy/.irisy-memory/` (sub-files referenced from SOUL.md) **MUST**
conform to the SOUL.md spec at github.com/aaronjmars/soul.md. Spec
version pinned per the latest reviewed upstream commit; pin recorded
in `vault/irisy/.soul-md-version` so a future spec churn is auditable.

memory `decision_pi_is_sole_brain_hermes_is_keycap` already mentioned
the file by name but the *format* was unlocked; this section closes
that gap.

### §4.2 CTRL extensions — the `x-ctrl:` frontmatter namespace

CTRL-only fields (Pi provider routing hints, keycap activation rules,
vault layout overrides, etc.) live under an `x-ctrl:` frontmatter
key. Vanilla SOUL.md readers (OpenClaw, Claude Code, future
implementations) ignore unknown keys, so the file stays
forward-compatible.

Example shape:

```markdown
---
# Standard SOUL.md fields — read by OpenClaw, Claude Code, CTRL.
name: bao
voice:
  tone: direct
tools:
  - id: clipboard
    surface: keycap
memory:
  long_term: ".irisy-memory/long-term.md"
  episodes:  ".irisy-memory/episodes/"

# CTRL-only — never required by upstream readers.
x-ctrl:
  provider_routing:
    primary: claude-oauth
    fallback: volc
  keycap_activation:
    auto_invoke_on_paste: false
  vault_layout:
    review_queue: ".ctrl/review-queue/"
---

# About me

I am bao. I build CTRL — an ambient Ctrl-hotkey workbench …
```

The body (after frontmatter) is free-form markdown per the SOUL.md
spec — Irisy reads it verbatim, additional structure (Headings as
section pointers) is documented at the spec, not in this ADR.

### §4.3 Read / write surface

Three call surfaces, all SOUL.md-aware:

| Surface | Read | Write |
|---|---|---|
| **Pi brain** (Irisy agent loop) | At every turn via kernel-injected `<soul>` block | Asks user before mutating frontmatter; episodic notes append to `.irisy-memory/episodes/<date>.md` directly |
| **Settings → Irisy panel** (PWA) | Structured form over the frontmatter + body sections | Direct edit; saves through `vault_write` with frontmatter preserved |
| **MCP** (`irisy.soul_get` / `irisy.soul_set`) | Available to external agents (Cursor, Claude Code itself) so they can read CTRL's soul | Auth-gated; mutations emit an event so the user sees a notification |

Implementation deferred to the next code session (next chunk after
the kairo parity Notes app).

### §4.4 Bridge to OpenClaw skills (forward reference)

CTRL keycap manifests and OpenClaw skill manifests are bidirectionally
convertible per the "marketplace bridge" move recorded in the
brainstorm doc. The schema bridge will land in **ADR-002 substrate
§7 composition v1 amendment** in a follow-up session (paired with the
`packages/ctrl-keycap-sdk/src/openclaw-bridge.ts` transformer). This
section asserts the intent; the schema lock lives in ADR-002.

### §4.5 First-boot seed

`src-tauri/src/kernel/vault.rs::seed_vault_feature_layer` extends to
write a starter `vault/irisy/SOUL.md` on first launch when the file is
absent — same idempotent policy as the existing sourcing.yaml /
daily-notes.yaml seeds (§8 vault feature-layer). The seed template
ships SOUL.md-compliant scaffolding plus a commented `x-ctrl:` block
the user can uncomment to opt into the extensions.

### §4.6 Spec churn policy

SOUL.md is young. Each upstream tag we pin to gets recorded in
`vault/irisy/.soul-md-version`; bumping the pin requires:

1. Review of upstream changes for compatibility with the `x-ctrl:`
   namespace (no key collisions).
2. Update of the seeded template in `vault_seed/`.
3. Migration note in this section's changelog if existing user soul
   files need transformation.

The spec is maintained by aaronjmars (separate project), not
Steinberger, so even if OpenClaw the runtime forks / vendor-pivots,
SOUL.md as a format has independent governance.

## Acceptance

### Lifecycle (§1)
- [x] ADR locks 8-stage model + invisible internal mode routing. v1 ships stage-1 (Chat) via `IrisyChat.tsx`. Closed.
- [x] No mode-switcher UI in shipped code; `decision_one_persona_irisy` honored. Verified.

### Remote co-view (§2)
- [x] ADR direction recorded; v1 ships none of these (v1.1+ scope). Closed at "decision recorded".

### Persona + prompt v5 (§3)
- [x] Persona is per-keycap `cap_asset.files/persona.md`; vault override path declared. ADR-002 § composition axis 6 closes the schema side.

### SOUL.md compat (§4 — NEW v2)
- [ ] `vault/irisy/SOUL.md` first-boot seed wired in `src-tauri/src/kernel/vault.rs::seed_vault_feature_layer` (template at `vault_seed/irisy-soul.md`, idempotent like the other §8.4 seeds).
- [ ] `vault/irisy/.soul-md-version` records the pinned upstream commit / tag; reviewed when bumped.
- [ ] Kernel commands `irisy_soul_read` / `irisy_soul_write` surface the file as structured `{frontmatter, body}` so the PWA Settings → Irisy panel can edit it without forcing the user into vim. Registered in `commands/mod.rs`.
- [ ] MCP tools `irisy.soul_get` / `irisy.soul_set` on :17873 — external agents (Cursor, Claude Code) can read+write CTRL's soul; write emits a `platform.notify` event so the user sees mutations.
- [ ] `vault/irisy/SOUL.md` template demonstrates the `x-ctrl:` extension namespace with provider routing + keycap activation example; comments call out which keys are vanilla SOUL.md vs CTRL-only.
- [ ] Pi brain prompt v5 (or v6) includes the SOUL.md body verbatim in its system context per turn, so Irisy actually behaves like the soul it reads.
- [ ] Documentation cross-link from CLAUDE.md "Design Philosophy" pointing at this section, so new sessions inherit the ecosystem stance without re-deriving it.
## Future work

- Irisy prompt v5 — bumps `PROMPT_VERSION` 4 → 5 in `packages/ctrl-web/src/lib/irisy-prompts.ts`; replaces v4 "no codenames" hard-ban with "brand labels only + self-aware via brain_status + failover transition + Settings deflect". Lands with ADR-002 § provider §3.7 introspection wiring.
- Stages 2-7 (Creation / Config / Invoke / Collab / Debug / Improvement) UI surfaces — v1.1+ scope (memory `feedback_no_planning_no_phasing`)
- Stage 8 (Retire) Settings drawer for low-usage keycaps
- Cross-stage conversation history via `LocalStorage` namespace `irisy:<stage>:<keycap_id>`
- Remote co-view § 4 primitives (session.observe / share / takeover / narrate) — v1.1+ scope
- §4.4 keycap manifest ↔ OpenClaw skill bridge — schema lock lands in **ADR-002 § composition v1 amendment** (next session, paired with `packages/ctrl-keycap-sdk/src/openclaw-bridge.ts` transformer and Pool import flow). Independent of the §4 SOUL.md compat acceptance items — those ship first.

## Provenance

- §1 ← orig-016 (Irisy 8-stage keycap lifecycle, 2026-05-22, accepted)
- §2 ← orig-017 (Remote co-view = Irisy primitives, 2026-05-22, accepted, v1.1+ scope)
- §3 ← orig-024 §7 (Irisy persona rule, 2026-05-30) + amendment 2026-05-31 (prompt v5 replaces v4 "no codenames" with brand-label + self-aware policy; closes bao 2026-05-31 root issue "Irisy doesn't know its own stack")
- §4 ← NEW 2026-06-03. Driven by bao competitive research dump (OpenClaw 350k stars / WorkBuddy compat / SOUL.md cross-tool recognition); locks ecosystem alignment that memory `decision_pi_is_sole_brain_hermes_is_keycap` half-committed to. Full strategic analysis at `.olym/brainstorm/openclaw-compat-2026-06-03.md`.
