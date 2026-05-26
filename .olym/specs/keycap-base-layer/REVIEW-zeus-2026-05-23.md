---
review-target: .olym/specs/keycap-base-layer/spec.md @ v0.1.0 (878ba66 on keycap-dev)
reviewer: zeus
date: 2026-05-23
tier: B (cross-cutting — touches 4 lanes; auto-amends ADR-004)
verdict: APPROVE (spec is the latest agreement; the 4 ADR-004 mismatches below are zeus-owned amendment work, not hephaestus blockers)
correction: 2026-05-23 — initial draft framed this as CHANGE_REQUEST asking the spec to conform to ADR-004. bao corrected: spec captures the *latest* bao+hephaestus discussion this session; ADR-004 from 2026-05-22 is the stale doc. Verdict flipped to APPROVE; the 4 items became zeus-owned ADR-004 amendments.
related:
  - .olym/specs/keycap-base-layer/spec.md @ v0.1.0
  - .olym/decisions/004-kernel-capability-surface.md (squash-merged via PR #25, currently only on origin/main)
  - .olym/decisions/001-system-architecture.md (5 primitives lock)
  - .olym/decisions/013-kernel-as-mcp-server.md (already shipped; spec frontmatter "if pending" is stale)
  - .olym/decisions/015-obsidian-philosophy.md (vim test gate)
---

# REVIEW — keycap base layer substrate roadmap v0.1.0

## Verdict

**APPROVE** — spec is the current agreement between bao + hephaestus (this session). ADR-004 from 2026-05-22 is the stale document; the four "mismatches" below are zeus-owned amendment work, NOT hephaestus blockers. All 20 components in §6 may proceed in parallel under their listed lane owners.

## Strengths (kept short — spec stands well)

- 11 sections mirror Irisy spec v0.2.0 template — house style preserved.
- §3 inventory is verifiable (each ✅ row carries a PR reference; grep confirms `vault.*`, `mcp_host`, `irisy_*`, `keychain.*`, `stss.*` already in `src-tauri/src/commands/`).
- §4 dependency map → 7 ship-ready / 10 blocked is concrete, not speculative.
- §5 designs include Rust API surface + acceptance per gap — implementation-ready, not pseudocode.
- §6 ownership 20-component × 4-lane table has zero overlap. C5–C7 (MCP client) correctly lands in zeus; C14 (macOS Vision) correctly lands in athena.
- §7 four Open Questions are real bao-only decisions, not pseudo-questions zeus could answer.
- §8 counter-evidence covers VMark abandonment, Volc pricing, sidecar lifecycle, broker over-block, lane drift — failure modes that would actually matter.
- §9 acceptance criteria per substrate, testable in isolation. §10 explicit no-phasing per memory `feedback_no_planning_no_phasing`.
- Obsidian philosophy (ADR-015 / CLAUDE.md): vim test passes — VMark = markdown files, no private binary, ctrl-cloud not in critical path.
- Goal alignment (元规则 #0): spec's why = "unblock 10 functional keycaps". Concrete, < 1 week to first ship value.

## Zeus-owned ADR-004 amendment items (do NOT block spec execution)

These are doc-hygiene items zeus opens against ADR-004 to make the capability-surface contract match the latest bao+hephaestus agreement. Each is mechanical text editing, no design re-litigation, no hephaestus dependency.

### 🟢 AM-1 — ADR-004 add audio.* + image.* namespaces to v1

ADR-004 locked 10 namespaces / 28 methods at frequency-≥3. Spec §5 introduces new namespaces that aren't in ADR-004's v1 surface:

| Spec gap | Method | ADR-004 v1 status | ADR-004 v1.1 status |
|---|---|---|---|
| G3 | `image.ocr` | not in v1 | **v1.1 forward-declared (#9)** |
| G4 | `audio.tts` | not in v1 | not listed (no second consumer yet) |
| G5 | `audio.stt` | not in v1 | not listed |
| G6 | `image.edit` | not in v1 | not listed |
| — | `image.generate` | not in v1 | not listed (yet `Poster` keycap consumes it; already ships per §3) |

Per ADR-004's frequency rule a method enters surface iff ≥3 keycaps consume it. Spec needs to either:

- **(a)** Land an ADR-004 amendment that adds `audio.{tts, stt}` + `image.{generate, edit, ocr}` to the v1 surface (rationale: Speak / Transcribe / Generate Image / Poster / OCR = 5 keycaps, clears the ≥3 bar across the audio + image namespaces if grouped at namespace level), **OR**
- **(b)** Keep the audio + image work as **keycap-local actors** (per ADR-004's keycap-local fallback rule) and remove G3–G6 from "base substrate". Functional keycaps for Speak / Transcribe / OCR / image.edit would each ship their own Volc adapter binding.

Resolution recommendation: option (a). The keycap-local path duplicates Volc adapter code 4× and fragments BYOK key handling. Open a one-page ADR-004 amendment (zeus owns; ~30-min effort) before C9–C12 commit.

### 🟢 AM-2 (MEDIUM) — `vault.*` vs ADR-004's `file.{read, write}`

Spec §3 + §4 use `vault.*` (matches shipped Tauri command names per `src-tauri/src/commands/vault.rs`). ADR-004 §Decision table lists the namespace as `file.{read, write}`.

Two possibilities:
- ADR-004's `file.*` was a placeholder before vault FTS5 landed; spec's `vault.*` is the operational truth → ADR-004 should rename `file` → `vault`.
- Or `vault.*` is a sub-bucket; ADR-004's `file.*` is the kernel surface and `vault.*` is the keycap-facing convenience wrapper.

Either is defensible. Pick one + write into the ADR-004 amendment from CR-1. Code change is cosmetic (rename or alias).

### 🟢 AM-3 (MEDIUM) — ST-SS surface drift

Spec §3 lists ST-SS bridge as ✅ ready substrate (correct — `stss.subscribe / publish / list_streams / get_bridge_token` ship in `src-tauri/src/commands/stss.rs`). ADR-004 §promotion-candidates says `stss.{publish, subscribe}` is v1.1 (Pattern F).

ADR-004 is stale. ST-SS is v1 surface today; promote in the same ADR-004 amendment.

### 🟢 AM-4 (MEDIUM) — MCP client extension to ADR-004 namespace

Spec §10 already flags "MCP client capability broker entry must be added to ADR-004". Good. But the design in §5.2 introduces three new methods (`mcp_client_call`, `mcp_client_list_servers`, `mcp_client_register_server`) under what's effectively a new sub-namespace `mcp.client.*`.

ADR-004 §Decision row 7 lists `mcp.{spawn, invoke_tool, list_tools, notifications}` — these are mcp **server** semantics (CTRL hosting keycaps as MCP servers). MCP **client** semantics (CTRL calling out to external MCP servers like VMark) is a different surface.

Recommend: ADR-004 amendment splits row 7 into two:
- `mcp.host.{spawn, invoke_tool, list_tools, notifications}` (existing kernel as server)
- `mcp.client.{call, list_servers, register_server}` (new, this spec's G2)

This makes the surface explicit and prevents future confusion when a keycap declares `capabilities: ['mcp']`.

## Suggested (non-blocking) refinements

### 🟢 SR-1 — Q3 (Windows shell.capture ownership) should not block PR-D

Spec §7 Q3 flags Windows `shell.capture` ownership as bao-decision. Don't gate the macOS slice on Win answer. Ship PR-D = macOS-only first; Win impl as a follow-up handoff after bao picks (athena scope extension / zeus / new lane).

### 🟢 SR-2 — C20 acceptance harness shape

Spec §6 C20 says "Acceptance test harness (each substrate testable in isolation)". Pin the boundary:
- Rust: `cargo test` per crate, integration tests in `src-tauri/tests/`.
- TS: Vitest for unit; Playwright for e2e if a substrate has a PWA-touching path (G1 VMark install flow does).
- Smoke per gap: a single named test asserting the acceptance criterion from §9.

Same memory `feedback_no_planning_no_phasing` — these are testing primitives, not phases. Hephaestus's C20 scaffolding can land before CR-1 amendment.

### 🟢 SR-3 — Frontmatter cleanup

`related-adr` entry: `013-kernel-mcp-server (if pending — base layer touches MCP host + client both)`. ADR-013 is already accepted (file `.olym/decisions/013-kernel-as-mcp-server.md` exists on this branch). Drop "if pending".

### 🟢 SR-4 — Q1 (sidecar vs WebSocket) — zeus weighs in

Spec §5.2 + §7 Q1 ask bao to pick. Both options are defensible; zeus's design opinion (advisory):

- **Sidecar** wins for VMark today: VMark's `@vmark/mcp-server` is a documented npm package, stable contract, MCP stdio is the upstream-sanctioned wire. Subprocess lifecycle already proven in CTRL (hermes_chat).
- **Direct WebSocket** to VMark's internal `:63702` bridge: undocumented, can drift per VMark release. Avoid.

Recommend bao pick **A (sidecar)** without further discussion — zeus, hephaestus, and the §5.2 analysis converge.

## Parallel-track approval

**All 20 components in §6 may proceed in parallel under their listed lane owners.** No component is blocked by the AM-1…AM-4 amendments — those are zeus's doc-hygiene work and run in the background.

Specifically:
- **hephaestus** lanes immediately: C1–C4 (VMark install + state + URL keycap), C8 (Insert at VMark cursor keycap), C9–C12 (audio + image.edit + image.ocr Volc adapters), C13 (clipboard wrap), C16 (shell.open_path wrap), C17 (THIRD_PARTY_LICENSES VMark/MIT), C20 (acceptance test harness).
- **zeus**: C5–C7 (MCP client module + Tauri commands + state file).
- **athena**: C14 (macOS shell.capture). C15 (Windows) waits on Q3 only.
- **daedalus**: C18 (game-style first-run prompt), C19 (PWA VMark status row).

The ADR-004 amendments (AM-1…AM-4) catch up the capability-surface contract to match this spec; they don't gate any code commit. If a component lands before the amendment merges, the namespace name in code is what's right — the ADR will be edited to match.

## Path forward (all parallel — nothing gates anything)

- **bao** decides Q1 / Q3 / Q4 when convenient. Zeus recommends **Q1 = sidecar** (no further discussion needed).
- **hephaestus** starts on all his C# rows in keycap-dev immediately.
- **zeus** runs in parallel:
  - Lands C5–C7 (MCP client module) in main.
  - Opens ADR-004 amendment doc (AM-1…AM-4 above) as background hygiene — does NOT gate any code.
- **daedalus** picks up C18, C19 from pwa-dev when frontend bandwidth allows.
- **athena** picks up C14 in mac shell lane.

PR-A through PR-F coherent slices (spec §10) ship in any order as each is ready.

## Supplementary gaps surfaced post-review (hephaestus 2026-05-23)

After the initial APPROVE, hephaestus flagged two additional substrate gaps that v0.1.0 did not cover. Both are accepted as **spec amendment** items (hephaestus updates `spec.md` to v0.1.1 in keycap-dev — no zeus REVIEW round-trip needed for these additions; this section is the standing ack).

### 🟢 G10 — Prompt substrate (medium priority, doesn't block v1 ship)

Scope: prompt registry + template engine + persona externalization + few-shot store + hermes skill bridge.

Why it matters: every LLM-consuming keycap currently inlines its system prompt in Rust or TSX. Without G10, prompt iteration requires a code change + release rebuild — Irisy persona edits become a developer task, not a content task. Long-term maintainability of all `text.chat` / `text.transform` / `text.template` keycaps depends on this.

Connection to ADR-004: maps cleanly onto existing `text.{template, embed}` namespaces from the v1 surface. No new namespace required. Hermes skill bridge is the v1.1 surface (per ADR-019).

Suggested split (for hephaestus when writing §5.7):
- **G10.a** — prompt registry table (`~/.ctrl/prompts/` directory + YAML frontmatter) + Tauri command `prompt_list` / `prompt_read` / `prompt_render` (template + variables).
- **G10.b** — persona externalization: extract Irisy's system prompt from Rust into `~/.ctrl/prompts/irisy.md`.
- **G10.c** — few-shot store: keyed by keycap id, optional `examples` table.
- **G10.d** — hermes skill bridge: when a keycap manifest declares `target: 'hermes-skill'`, the prompt entry maps to a `SKILL.md` + `assets/` directory under `~/.hermes/skills/<keycap-id>/`. Already partially wired by `irisy_init`.

Owner: hephaestus (keycap-dev), all sub-components. Existing infra in `src-tauri/src/commands/irisy.rs` covers G10.d's hermes side already; G10.a–c are net-new.

No ADR-004 amendment dependency. Doesn't block v1 ship — keycaps can inline prompts in v1 and migrate to registry post-launch.

### 🟢 G11 — Image library substrate (high priority, unblocks 4 keycaps' user-facing value)

Scope: PWA-side image gallery view + lightbox component + vault-backed image index.

Why it matters: Generate Image / Poster (already ship) + Screen Capture (G8) + OCR (G3 input image) all produce image files into vault. Without G11, users open Finder to view them — breaks the CTRL workshop framing per memory `decision_ctrl_is_ai_workshop_not_chat` (PWA is the persistent surface, not a chat shell).

Suggested split (for hephaestus when writing §5.8):
- **G11.a** — PWA route `/library/images` (or workspace tab) — grid view of vault image files, sorted by mtime, filterable by keycap-source.
- **G11.b** — Lightbox primitive — keyboard-navigable (← → esc), zoomable, copyable, "open in default viewer" fallback (uses G9 shell.open_path).
- **G11.c** — Vault image index: kernel-side metadata (sidecar `.imagemeta.json` or vault entry) tracking which keycap produced each image + source (clipboard / capture / generate / edit) for the filter UI.

Owners (proposed, hephaestus confirm in v0.1.1 §6):
- C21 — PWA `/library/images` route + grid component → **daedalus** (frontend lane)
- C22 — Lightbox primitive → **daedalus**
- C23 — Vault image index (kernel-side `.imagemeta.json` write on keycap output) → **hephaestus** (keycap-dev; wraps existing vault.write path)

ADR-004 surface: no new namespace; reads via `vault.list` (filter by extension) + writes via `vault.write` (sidecar metadata as separate file).

This one I'd push to ship alongside Generate Image / Poster keycaps — they already produce images and users will notice the gap immediately. Higher user-visible impact than G10.

### Spec amendment process

These two gaps land in `spec.md` v0.1.1 as a hephaestus self-amend (no separate REVIEW round). Tag the bump in §11 changelog. If §6 ownership for G11.a–b crosses into daedalus or zeus territory beyond what I've sketched, raise it in the next REVIEW (zeus or themis).

## Closing

Solid work. APPROVE — spec is the contract. ADR-004 will follow.

— zeus, 2026-05-23
