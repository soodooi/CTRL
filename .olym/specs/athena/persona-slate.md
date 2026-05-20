# Athena Persona Slate (v1.1 — one persona only)

**Date:** 2026-05-17
**Owner:** Athena
**Status:** ✅ collapsed. Only Irisy. Specialist names retired.

---

## The slate

| | Persona | Job | UI display |
|---|---|---|---|
| 1 | **Irisy** | All of it (chat, integration, code, recall, multimodal, coding-companion) | Single name; depth shown as 4-tier level pip |

That's the slate. No Janus, no Talos, no Mnemosyne. No "specialist summoned" handoff prose. Internal routing is invisible.

---

## Irisy display — effort level (option A, accepted 2026-05-17)

User sees a passive 4-pip level indicator next to Irisy's name, ramping with the current turn's depth of effort:

| Lv | Trigger | Label |
|---|---|---|
| 1 | <2 s elapsed | quick |
| 2 | <5 s | thinking |
| 3 | <15 s | going deep |
| 4 | ≥15 s | heavy lift |

User never picks a level. Other display schemes considered but rejected: model tier (B), capability roadmap (C), intimacy / gamification (D). A wins because it works without subscription/catalog infra and matches the existing patience-text stages.

Implemented in `packages/ctrl-web/src/routes/irisy.tsx` (`effortLevel`, `LevelPips`).

---

## v1.1 scope (current build target)

Multi-persona shipping schedule is retired. The new scope is "Irisy full":

- ✅ PWA route with sidebar history + tabs (Chat / Code Space) — shipped
- ✅ Streaming + patience UI — shipped
- ✅ Multimodal input (attach / paste / drop) — shipped UI; image delivery to model lands with LLM provider catalog
- ✅ 4-tier effort level pips — shipped
- ⏳ Code Space real wiring → subscribe to subprocess actor / PTY stream (waits on Zeus base layer)
- ⏳ Interjection chips (1 line + button + tied to local skill) — wait on skill registry surface
- ⏳ Tauri `irisy:prompt-prefill` incoming-prompt handler — Athena builds (no backend dep)
- ⏳ `@ctrl/keycap-sdk` integration — Athena swaps (SDK exists, just adopt)
- ⏳ `@ctrl/memory` SDK → Caddy → ctrl-mcp → Mem0 — needs Zeus dev JWT
- ⏳ LLM provider catalog (Minimax / Anthropic / Claude CLI optional) — needs Zeus `kernel::llm::send`

Anything beyond this list is post-v1.1.

---

## Anti-references (carried across all Irisy work)

- ChatGPT-灰 / purple-gradient SaaS template — visual identity
- Material Design — visual identity
- Clippy / Cortana / Bing chat — interrupt-driven
- Microsoft Copilot Studio — enterprise low-code, too heavy
- CopilotKit — devs-only framework, not end-user product
- Microsoft Recall — surveillance dressed as memory
- GPT Store — closed ecosystem we can't reach into

---

## Architecture-level benchmarks (for the team, not user-visible)

- **sipeed/picoclaw** — resource discipline ($10 hardware / <10 MB RAM), channel adapter pattern. Top candidate to revisit as substrate when (if) we ever need a multi-channel runtime.
- **danielwpz/pokoclaw** — "feed README to Claude Code, it installs itself" pattern. If we ever need a self-installing integration capability, this is the closest worked example.
- **poco-claw** (poco-ai/poco-claw) — Claude-Code-powered OpenClaw alt, sandboxed runtime.
- **slock.ai** — daemon-as-substrate.
- **Hermes Agent** (Nous) — already evaluated and dropped; see `memory/decision_drop_hermes_for_irisy_v1.md`. Smoke data retained in `hermes-smoke-d1-report.md` for future reference if a similar substrate is reconsidered.

These shape architecture, not naming or persona count.

---

## Historical: the discarded multi-persona slate

Pre-2026-05-17 slate proposed Irisy + Janus (integration) + Talos (dev) + Mnemosyne (recall), with Pattern C "specialists summoned" UX. Bao rejected: every named persona is one more entity the user has to learn and address. "不需要用户切换 减少用户操作". Collapsed to Irisy-only with internal routing invisible. See `memory/decision_one_persona_irisy.md`.

The discarded slate's reference projects per-persona (danielwpz/pokoclaw for integration, Cursor/Aider for dev, Rize/Reflect for recall) are preserved above in §Architecture benchmarks since their lessons still apply to Irisy's internal capability work.
