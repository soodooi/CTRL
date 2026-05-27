---
module: irisy
purpose: Irisy = CTRL's user-facing AI companion. Chat + 8-stage keycap lifecycle + remote co-view primitives.
lane_owner: hephaestus (persona + integration design); daedalus implements UI
status: module-entry  # replaces 2026-05-22 spec — old framing in git history
last_refresh: 2026-05-26
---

# irisy — module SPEC

> Entry page for the irisy module. The Irisy persona, chat companion, 8-stage lifecycle, remote co-view. Drilldown to sub-specs / ADRs / code paths below.

---

## What this module is

Irisy is the **single user-facing AI persona** for CTRL. Backed by Pi (sole brain via keycap, see ADR-001 §1.4). Two main surfaces:

1. **Chat companion** — right-rail ChatPane / IrisyChat (always-on conversation with current context).
2. **8-stage keycap lifecycle** — Irisy walks user through Discovery → Creation → Config → Invoke → Collab → Debug → Improvement → Retire across the keycap journey (ADR-016).

Plus 1 future surface:

3. **Remote co-view** — cross-device viewer of in-flight Irisy sessions (ADR-017, depends on mesh ADR-003).

## Code paths

- `packages/ctrl-web/src/routes/irisy.tsx` — route
- `packages/ctrl-web/src/components/irisy/` — ChatPane / IrisyChat / CreatorShell / ManifestPreview / CodePreview / InstallBar / DiscardConfirm / PatiencePip
- `packages/ctrl-web/src/lib/irisy-*` — 7 lib files (keycap-slots, store, zod, llm-runner, tools, prompts, memory)
- `src-tauri/src/commands/irisy.rs` — kernel: Irisy bootstrap + active-brain resolution
- `src-tauri/src/commands/irisy_chat.rs` — kernel: chat_stream route → brain keycap

## Owned ADRs

| ADR | Title | Status |
|---|---|---|
| [016](../../decisions/016-irisy-eight-stage-lifecycle.md) | Irisy 8-stage keycap lifecycle | accepted |
| [017](../../decisions/017-remote-coview-is-irisy.md) | Remote co-view = Irisy (mesh = sync only) | accepted |
| ~~[019](../../decisions/019-ctrl-hermes-plugin-primary.md)~~ | hermes-primary integration | **superseded** by ADR-001#1st-校准 (2026-05-25) |

Cross-references: ADR-001 §1.4 (Pi sole brain via keycap), §1.5 (vault stack for content rendering).

## Current state (2026-05-26)

✅ shipped:
- Single Irisy persona (no specialist sub-personas exposed to user)
- ChatPane + IrisyChat components
- Pi brain wired via inline brain router (`~/.ctrl/active-brain`)
- 7 irisy-* lib files (slots / store / zod / llm-runner / tools / prompts / memory)
- chat_stream Tauri command (kernel side)
- CreatorShell + ManifestPreview + InstallBar (single components)

⚠️ open:
- **Irisy creator end-to-end**: 单件 UI exist, end-to-end flow (user request → generate manifest → install to `~/.ctrl/keycaps/` → appear in Keyboard) not wired. (Tracked in `doc/brainstorm-workbench-flexibility-2026-05-26.md`, lane = irisy.)
- 8-stage lifecycle surfaces: Discovery + Invoke partial; Config / Collab / Debug / Improvement / Retire missing
- Remote co-view (ADR-017): blocked on mesh thin-wire (substrate ADR-003)

## Known drift / history

- **2026-05-22 spec (hermes-as-brain framing) was replaced by this entry on 2026-05-26**. The original 700-line spec referenced hermes-agent (NousResearch, 163k★) as Irisy's brain. ADR-001's 1st 校准 (2026-05-25) superseded that with Pi-sole-brain.
- Historical content preserved at `spec-historical-2026-05-22-hermes-framing.md` (sibling file). Read it for design-thinking context (8-stage lifecycle / surface decomposition / persona principles partially still relevant); **do not** treat its hermes-as-brain framing as authoritative — use ADR-001 §1.4 + ADR-016/017 instead.
- `REVIEW-zeus-2026-05-22.md` in this dir is the historical zeus review of the 2026-05-22 spec — preserved for context, not authoritative.
- Memory `decision_irisy_architecture` superseded 2026-05-25 by `decision_pi_is_sole_brain_hermes_is_keycap`.
