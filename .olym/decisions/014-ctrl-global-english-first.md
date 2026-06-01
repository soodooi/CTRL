---
adr_id: 014
title: CTRL = global English first — UX, marketing, keycap priority by global creator+agent ecosystem
status: accepted
date: 2026-05-22
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/013-kernel-as-mcp-server.md
scope: framework
module: cross-cutting
supersedes: []
superseded_by: []
---

## Context

CLAUDE.md line 9 historically framed CTRL as "中文 OPC 桌面 AI 工具入口 + 创作者底座" (CN-OPC desktop AI tool entry + creator base). Through 2026-05-22 session bao explicitly recalibrated: the product is **global English first**, not CN-OPC-first; Chinese is an **i18n adaptation** that follows the global launch.

Memory `decision_ctrl_is_global_english_first` (2026-05-22) 🔒 fixes this — fleet was prioritizing keycaps by "CN user base size" (飞书 / Coze / Notion CN connectors), which is the wrong evaluation axis. The right axis is global creator + agent ecosystem (hermes-agent skills, agentskills.io, global MCP marketplace, Claude Code / Cursor users).

Triggering signal: zeus and hephaestus were ranking keycap creation priority by CN user adoption; bao halted this and locked the global-first stance. ADR-014 captures the lock so the next session doesn't re-debate.

## Decision

**CTRL is a global product launched in English**. Localization to Chinese (and other languages) is an i18n adaptation layer that follows v1.

Concrete rules:

1. **UX text** — every string in `packages/ctrl-web/` is English source-of-truth (already enforced by `feedback_code_strings_english` 🔒). Chinese strings are loaded through i18n (`react-i18next` or equivalent) from `locales/zh-CN.json` files; never inline in source.

2. **Marketing** — apollo's `ctrlapplab.com` already English (per `decision_marketing_slogan_share_be_shared`). All landing pages, app store listings, social copy = English first; CN copy is translation, not source.

3. **Keycap creation priority** — evaluated by:
   - Global creator+agent ecosystem reach (hermes-agent skills, MCP marketplace, Claude Code / Cursor MCP host adoption, agentskills.io)
   - NOT by CN user count for that integration

4. **Integration priority** (v1):
   - **Priority** = hermes skill ecosystem / global MCP marketplace / agentskills.io / GitHub / Linear / Notion (global)
   - **Lower priority** = 飞书 / Coze / Doubao / 微信 / 钉钉 (CN-only) — still supported as i18n / regional keycaps but not blocking v1 launch

5. **Strategic anti-list (clarifies ADR-001 anti-list)**:
   - CTRL is NOT 中文 OPC 工具 — it is a **global ambient AI workbench**
   - Don't ship CN-specific assumptions into kernel / Irisy / keycap manifest schema; CN OAuth providers (飞书 etc.) are regional adapter packages, not core

6. **CN delivery infra remains** — ADR-011 three-mirror channel (Tokyo / CF / GitHub) and the BYOK-leaning posture for CN users (since CF Workers AI can be unreliable in CN) stay intact. Global English first ≠ ignore CN; it means **product positioning + priority is global, infra still serves CN**.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Keep 中文 OPC first framing (original CLAUDE.md line 9) | Misallocates keycap priority to CN-only integrations; loses global creator economy where the actual MCP/skill ecosystem lives; bao explicitly recalibrated |
| A2 | Dual-priority (CN and global equal) | Forces 2x integration surface in v1; dilutes ship focus; bao "想清楚 CTRL 的定位" demands a single axis |
| A3 | CN-first then global (later pivot) | Doubao window pressure makes "later pivot" risky; global launch needs English source-of-truth from day 1 to avoid retrofit cost |

## Consequences

**Positive**:
- Fleet evaluation criteria for keycap priority + integration scope is unambiguous
- i18n architecture forced from day 1 (no Chinese strings in code → cheap to add new languages later)
- Marketing alignment with apollo's existing English-first artifact
- Aligned with where MCP / skill ecosystem actually lives (Anthropic / global creators)

**Negative / cost**:
- CN-only keycap creators feel deprioritized for v1; expect community pushback
- Some UX patterns (CN payment / WeChat share / 中式排版) need extra effort to retrofit in i18n phase
- 跟 CN OPC influencer marketing 错配 — apollo needs to acknowledge this in CN-channel social plan

**Reversal cost**:
- Low — i18n architecture works both ways; reverse pivot to "CN first" needs marketing/positioning reversal but no code rewrite. Risk of needing reversal: low (the decision is about priority, not exclusion).

## Acceptance

- [x] CLAUDE.md line 9 amended 2026-05-31: "global ambient AI workbench + creator substrate" + ADR-014 ref. Closed.
- [x] Ongoing-lock: keycap manifest `i18n` field deferred to v1.1 (per "spec 细则暂搁" — CLAUDE.md 灵活开发 mode). Default behavior: ALL manifest strings English; per-locale extension happens when first CN-only keycap demand surfaces. Closed as deferred-with-rationale.
- [x] Ongoing-lock: `packages/ctrl-web/locales/` dir deferred to first i18n-bearing PR (灵活开发 + YAGNI). PWA currently English-only in user-facing strings (verified: `grep '>[一-龥]<' src/*.tsx` 0 hits 2026-05-31). Closed as deferred-with-evidence.
- [x] `packages/ctrl-web/` strings — verified 2026-05-31: zero Chinese in JSX user-visible content; remaining `[一-龥]` matches are quoted-bao-directive code comments (allowed per memory `feedback_code_strings_english`). Closed.
- [x] Ongoing-lock: apollo marketing copy review is a separate-repo / lane responsibility; ADR-014 sets the rule, lane owners enforce per-PR. Closed as policy-active.
- [x] Ongoing-lock: keycap-priority list spec deferred (灵活开发 spec 暂搁); priority lives in this ADR + memory `decision_ctrl_is_global_english_first` until ship pressure demands a doc. Closed as deferred.
- [x] Ongoing-lock: `doc/keycap-integration-research/` priority refresh tracked in that doc tree itself (research deliverable, not ADR acceptance). Closed as out-of-scope.

## Counter-evidence (would invalidate this ADR)

1. Global launch traction proves dramatically lower than CN — would force pivot back to CN-first prioritization (revisit by Q4 2026 if global MAU < 20% of CN MAU after 6 months)
2. Anthropic MCP ecosystem stagnates / forks — global MCP marketplace fragments → reconsider whether "global ecosystem reach" is still a meaningful priority axis
3. Doubao / Coze launch global English versions that capture creator economy faster than CTRL — direct competitive pressure forces re-evaluation

## Changelog

| Date | Change |
|---|---|
| 2026-05-22 | Initial accept (bao verbal-go 2026-05-22 session) — locks the global-first stance against the original CN-OPC-first framing in CLAUDE.md |

---

## 2026-05-25 amendment — reconcile with ADR-001 third 校准 (Pi-as-sole-brain)

This ADR predates 2026-05-25 brain-as-keycap reframing. Read in conjunction with:

- `.olym/decisions/001-system-architecture.md` 2026-05-25 amendments (first/second/third 校准 — authoritative)
- memory `decision_pi_is_sole_brain_hermes_is_keycap` — Pi is Irisy's sole brain; hermes is an optional personal-assistant keycap (target=brain, opt-in install via Pool), not the primary integration
- memory `decision_vmark_not_substrate_use_open_stack` — VMark is a compatibility commitment, not a substrate; CTRL uses the same open-source stack (Tiptap + CodeMirror 6 + mermaid.js + SQLite FTS5) directly

Where this ADR's body says "hermes" as the canonical brain / primary client / single integration point, **substitute "the active brain keycap (default = Pi, `@earendil-works/pi-coding-agent` lazy npm install; optional = hermes via `pip install hermes-agent` from Pool)"**. The substantive design (kernel-as-MCP-server / auto-update strategy / etc.) remains valid; only the brain identity / framing is updated.

Where this ADR uses "Obsidian philosophy" wording, the philosophy is unchanged but **the section is renamed "Plain-text philosophy"** (substance: local-is-truth, vim-readable markdown, no proprietary binary, no CTRL account, end-side OAuth/LLM/RAG/sync). The vim test remains the design gate.

Body not rewritten to keep diff small + preserve historical reasoning. This amendment header is the canonical pointer.
