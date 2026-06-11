---
id: 008-irisy-assistant
status: retired
retired_by: ADR-001 v4 + ADR-002 v19 (3-agent aggregator, H-2026-06-09-002, 2026-06-09)
retired_reason: |
  Irisy is no longer a brain / agent runtime. v19 reframes Irisy as **PWA persona shell**
  (avatar + sycophancy filter + system-prompt injection + drill-down). The assistant role
  belongs to **hermes** (external NousResearch agent, lazy-installed via npm).
  This ADR's content (Irisy reply specs, user intents, Irisy capabilities, Irisy pipeline)
  was authored when Irisy was the sole agent (v17). Most of it migrates to hermes (skills +
  prompt segments), with the persona-shell concerns moving to ADR-005 v4. No content carries
  forward unchanged.
created: 2026-06-04
owner: bao
supersedes: []
amends: []
related:
  - 001-spine (v4 supersedes Irisy-as-brain framing)
  - 002-substrate (v19 supersedes Pi/Irisy substrate)
  - 005-irisy (v4 reframes persona-shell role)
sources:
  - .olym/brainstorm/irisy-reply-specs-2026-06-04.md
  - .olym/brainstorm/user-intents-2026-06-04.md
  - .olym/brainstorm/irisy-capabilities-2026-06-04.md
  - .olym/brainstorm/irisy-pipeline-2026-06-04.md
---

> **RETIRED 2026-06-09** by ADR-001 v4 + ADR-002 v19 (3-agent aggregator). Irisy is now PWA persona shell, not agent runtime. See ADR-005 v4 + ADR-002 §1 v19 for the new model. Original content kept below for provenance only.

---

# ADR-008 Irisy assistant — identity, memory, skill/MCP routing

## §0 Decision (one paragraph)

CTRL v1 Irisy is a **personal AI assistant** with a single identity, persistent memory, and a 4-layer runtime (Context / Intent / Brain / Output). It does NOT invent a new tool framework — every external capability is either a **SKILL.md** (agentskills.io / OpenClaw / Claude Skills open standard, auto-discovered from `~/.claude/skills/` + `~/.ctrl/plugins/cache/`) or an **MCP server** (existing kernel `mcp.spawn`). Tool authoring, marketplace, autonomy escalation, multi-channel gateway, and aggregator UI are **out of v1 scope** — Irisy ships when the assistant identity + memory + 6 bundled MCPs work end-to-end with sub-second perceived latency.

This ADR locks the **Irisy product** so the team can stop reinventing surfaces (keycap-as-mode, planner overlays, multi-brain switching) and ship one coherent assistant.

## §1 Identity — who Irisy is

**Name**: Irisy (`decision_primary_companion_name_irisy`, 2026-05-22 bao locked). One companion, never split into Janus/Talos/Mnemosyne specialists in user view (`decision_one_persona_irisy`).

**Surface**: PWA-native first-class page, not a keycap (`decision_irisy_is_pwa_native_not_keycap`). Always-on, persists across keycap invocations. Entry = Ctrl-hotkey → Irisy main panel.

**Voice rules** (locked, drives `IRISY_BASE_PERSONA` in `lib/irisy-prompts.ts`):

| # | Rule | SOTA source (verbatim) |
|---|---|---|
| 1 | Concise response generally < 4 lines | Claude Code 2.0 leaked prompt |
| 2 | No preamble — never start with "Sure", "Certainly", "Okay", "Great", "I'd be happy to", "Let me check" | Cline `rules.ts` STRICTLY FORBIDDEN list |
| 3 | No restating user question, no "I" lead | Claude Code 2.0 |
| 4 | NEVER refer to tool/codename — Pi / claude-oauth / volc / ollama / vault_write / install_keycap / brain_status all rewritten to brand label or natural verb | Cursor 2.0 |
| 5 | No apologies — state what blocks + one next step | Cursor 2.0 |
| 6 | Match user language (CN in → CN out) | bao 2026-06-04 |
| 7 | NO planner blocks (Goal / Progress / Done / Next Steps / Critical Context) | bao 2026-06-04 user test + qwen2.5:7b 输出习惯 |
| 8 | Don't ask follow-up if intent is reasonable — assume + go | Cursor 2.0 "immediately follow plan" + Cline "NOT engage in back and forth" |

**Personality**: warm but terse. Pi by Inflection's "ask first, don't propose" opening line pattern adapted to creator workflow — but never sycophantic.

## §2 4-layer runtime architecture

```
┌─────────────────────────────────────────────────────┐
│ L1 Context layer (always-on, no LLM)                 │
│   • installed skills + MCP servers (list_local_skills, │
│     mcp.list_tools)                                   │
│   • vault recent changes (vault_watch_recent)         │
│   • session mode (personal / coding / cap)            │
│   • active brain (brain_status) — brand label only    │
│   • SOUL.md + playbook + last episodes                │
│   Injected as <context>…</context> block top of every │
│   Irisy turn. Never decided by LLM.                   │
├─────────────────────────────────────────────────────┤
│ L2 Intent router (PWA-side, no LLM where possible)   │
│   • keyword trigger table (CN + EN regex)             │
│   • URL / file-path / image detection                 │
│   • Hardcoded shortcuts ("什么模型" → render brand    │
│     label directly, bypass brain)                     │
│   • SKILL.md description-match for cap invocation     │
│   • Ambiguous → 1 short clarifying Q (Mem0 + v0       │
│     pattern); never assume install on ambiguous       │
├─────────────────────────────────────────────────────┤
│ L3 Brain layer (Pi sole brain, 3-tier runtime)       │
│   • frontier (claude-* / anthropic-* / openai-* /     │
│     gpt-*) → native function calling via              │
│     ctrl-pi-bridge.registerTool (ADR-005 §7)          │
│   • mid (volc / kimi / deepseek) → PWA XML <call>     │
│     loop (ADR-005 §7.6)                               │
│   • weak (ollama qwen-7B / llama-3B) → Goose          │
│     `$ cmd args` line-prefixed format                 │
│   • 1-reply = 1-thing rule (Cline). Either chat OR    │
│     one tool call. No mixing.                         │
├─────────────────────────────────────────────────────┤
│ L4 Output layer (content-type routes render)         │
│   • short text → chat bubble (post render-filter)     │
│   • artifact (md / html / pdf / image) → vault_write  │
│     + workspace tab auto-open (Notion pattern)        │
│   • tool progress → status bar (NOT chat bubble)      │
│   • failure → 1 sentence + 1 next step (no apology)   │
│   • render-filter strips planner blocks + thinking +  │
│     codenames as defence-in-depth (qwen守不住 prompt)  │
└─────────────────────────────────────────────────────┘
```

## §3 Memory model

**3-tier, all plain-text in vault** (vim test, `decision_ctrl_obsidian_philosophy`):

1. **SOUL.md** (`vault/irisy/SOUL.md`) — persona, beliefs, preferences. Frontmatter + body. Format compat with OpenClaw / Hermes / agentskills.io (`decision_openclaw_compat_layer`). CTRL extensions go under `x-ctrl:` namespace.

2. **playbook.md** (`vault/irisy/playbook.md`) — distilled rules ("when user says X, do Y"). Append-only. Read into every Irisy turn's system prompt.

3. **Episodes** (`vault/irisy/episodes/<date>-<trigger>-<slug>.md`) — per-turn raw evidence when a Detect rule fires (user-correction / tool-failure / novel-success). Written by sleep-time reflection subagent (ADR-005 §5, already shipped commit 18c7ad6).

**Curator loop** (NEW, Hermes-inspired): every N=5 turn or session end, Pi reads recent episodes + playbook + SOUL.md and **proposes 1-3 appends** as a structured `<curator-proposal>` block. User one-keystroke ack (Accept / Skip / Edit). Closes the "memory grows but never distilled" gap. Single new Tauri command `irisy_curator_tick(session_id)`.

**Visible memory ledger** (ChatGPT lesson): user can browse + edit + delete all Irisy-written memory entries via PWA `/notes?folder=irisy/` (already works — vault is the ledger).

## §4 Skill / MCP wiring (Irisy's tools)

Irisy uses **3 paths**, no CTRL-specific schema:

| Path | Format | Source | Status |
|---|---|---|---|
| **A. Existing MCP server** | MCP protocol (`@modelcontextprotocol/server-*`) | community / official | ✅ kernel `mcp.spawn` + `mcp.invoke_tool` shipped |
| **B. SKILL.md auto-discover** | agentskills.io spec | `~/.claude/skills/<n>/SKILL.md` + `~/.ctrl/plugins/cache/<mkt>/<plugin>/<v>/skills/` | 🟡 Pi extension `resources_discover` hook registered (commit 7994221) — needs E2E verify |
| **C. Pi-derived SKILL.md** | agentskills.io spec | Pi crystallizes post-trajectory + writes to `vault/irisy/skills/` | ❌ NEW (Hermes autonomous-skill-creation pattern) |

**6 bundled MCPs** (first-run installer wires these; user can disable):

| # | MCP | Stars | Why |
|---|---|---|---|
| 1 | `microsoft/playwright-mcp` | 33.5k | browser automation — covers most "do thing on web" intents |
| 2 | `exa-labs/exa-mcp-server` | 4.5k | semantic web search (BYOK) |
| 3 | `@modelcontextprotocol/server-filesystem` | 86.7k (parent) | scoped fs ops for `~/Downloads` etc. |
| 4 | `peakmojo/applescript-mcp` | 459 | one package = Calendar / Mail / Reminders / Music / AirDrop |
| 5 | `cyanheads/obsidian-mcp-server` | 575 | for users who already have an Obsidian vault separate from CTRL vault |
| 6 | `xpzouying/xiaohongshu-mcp` | 14k | China creator wedge — publish + search RedNote |

(Source: brainstorm `irisy-pipeline-2026-06-04.md` + agent 4 MCP scan 2026-06-04.)

**Discover page** (out of v1, deferred): one-tap install from `awesome-mcp-servers` curated list + trust score. v1 ships 6 bundle only.

## §5 Anti-features (what CTRL v1 will NOT ship)

OpenClaw VISION.md model — naming what we reject holds the line:

1. **NO CTRL-specific cap manifest schema** — cap = SKILL.md OR MCP server, period. ADR-004 (cap-spec) superseded by this rule.
2. **NO multi-channel gateway** — Ctrl-hotkey is the only entry. No WhatsApp / Telegram / Slack as user-facing surfaces (they can be MCP tools, but not Irisy entry points).
3. **NO TUI primary** — PWA-first. CLI is dev tooling, not product.
4. **NO agent hierarchy** (manager-of-managers / nested planners) — Pi is sole brain; sub-tasks are tool calls, not sub-agents.
5. **NO action-on-behalf-of-user without explicit confirmation** — Rabbit/Humane lesson: 60% reliable = worse than 0%. Irisy proposes, user acks (Accept/Skip/Edit).
6. **NO aggregator-MCP integration** — CTRL itself is the aggregator; bundling another aggregator MCP creates two routing layers.
7. **NO multi-brain switching surface** — Pi singleton (`decision_pi_is_sole_brain_hermes_is_keycap`). Provider switching is config, not UX feature.
8. **NO mandatory cloud account** — local-first; CTRL Cloud is fallback substrate, not gated content (`decision_ctrl_obsidian_philosophy`).
9. **NO custom personality marketplace** — one Irisy, customisable via SOUL.md, not a roster of pre-made personas.
10. **NO planner block / thinking block in user view** — defence-in-depth render filter strips these (commit pending: `irisy-render-filter.ts`).
11. **NO autonomous web action** — every Pi `network.http` call shows in status bar + log; no silent crawling/posting.
12. **NO billing / telemetry / usage UI in v1** — defer to v1.1 when there's actual paid layer.

## §6 First-5-minute UX (acceptance bar)

User installs CTRL fresh, presses Ctrl. Within 5 minutes they must:

1. **First paint < 200ms** (PWA prewarmed off-screen, hotkey teleport)
2. **See Irisy ready** with a personalised opener (Pi by Inflection pattern: open question, not "How can I help?")
3. **Type "你好"** → get a natural reply in < 1s perceived (Ollama qwen2.5:7b 本地)
4. **Type "做个 PPT 关于 AI 训练"** → Irisy uses bundled `playwright` + skills to produce a vault artifact + workspace tab in < 30s, NOT install a cap
5. **Type "把上面那段存到笔记"** → vault note appears, chat shows 1-line ack + link
6. **Type "你用什么模型"** → "Ollama (本地)" (hardcoded PWA shortcut, bypasses brain entirely)
7. **Type "不对, 我要的是中文"** → triggers `user-correction` reflection (silent), next turn matches preference

If any of these 7 are broken or slow, v1 is not shippable.

## §7 Implementation phases (Irisy-only focus)

| Phase | Scope | Estimate |
|---|---|---|
| **P1** | L4 render filter (commit shipped, validate E2E) + L4 artifact handoff + L4 status bar | 2-3 days |
| **P2** | L2 intent router (PWA-side keyword + URL detect + brand-label shortcut for G1) | 2-3 days |
| **P3** | L1 context bundle injection + curator loop (Tauri cmd + UI ack) + 6 bundle MCP first-run installer | 4-5 days |
| **P4** | L3 3-tier brain runtime (frontier native / mid XML / weak Goose `$`) + 1-reply=1-thing prompt rule | 3-4 days |
| **P5** | First-5-min UX 7-step E2E test + playwright e2e for each | 2 days |
| **Total** | ~14 days serial, can parallelise to ~7 days with 2 lanes | |

Deferred to v1.1+: Discover marketplace, autonomous skill crystallization (Path C in §4), live canvas, mesh sync, billing, advanced telemetry.

## §8 Acceptance (lock conditions before §0 ship)

- [ ] §1 voice rules — 8 rules wired into `IRISY_BASE_PERSONA`; manual test: ask Irisy "你好" + "你是谁" + "你能做什么" + "你用什么模型", each reply ≤ 4 lines, no preamble, no codename leak
- [ ] §2 4-layer architecture — L1/L2/L3/L4 each have its own file (`irisy-context-bundle.ts` / `irisy-intent-router.ts` / `irisy-tool-dispatch.ts` exists / `irisy-render-filter.ts` exists)
- [ ] §3 memory — SOUL.md + playbook.md seeded (✅ commit 18c7ad6), curator loop fires on turn ≥ 5
- [ ] §4 skill/MCP — `resources_discover` test passes (Pi loads `~/.claude/skills/<n>/SKILL.md`); 6 bundle MCPs installed cleanly on fresh install
- [ ] §5 anti-features — every item has at least 1 code-side or doc-side enforcement (e.g. `mcp.spawn` rejects aggregator-class servers by regex match on description)
- [ ] §6 5-min UX — all 7 steps run end-to-end on a fresh install, recorded screencast attached to PR

## §9 Anti-pattern catalogue (do not regress)

From this session's user testing (`decision_irisy_session_2026_06_04_notes`):

- ❌ Pi loops "Calling list_local_skills..." without emitting a tool call (Phase 3 frontier overlay caused this — disabled until Pi extension API contract is verified)
- ❌ qwen2.5:7b outputs "Goal / Progress / Done / Next Steps" planner blocks → user sees task-tracker instead of reply (fixed by `irisy-render-filter.ts`)
- ❌ Irisy answers with internal codenames ("running on Pi via ctrl-pi-bridge") → trust break (fixed by §1 rule 4 + render filter codename rewrite)
- ❌ Settings → Providers tab click did nothing (workspace store didn't update `tab.path` on idempotent re-pick — fixed commit 6aed9d6)
- ❌ Ollama 5-min cooldown stuck after first 404 → fallback to Claude indefinitely (fixed commit 4d171bc — `set_active` clears cooldown after trial success)

## §10 References

- ADR-001 spine (Pi-centric 5 块图, primitives v1)
- ADR-002 substrate § provider v2 + § brain v1 + § vault v1 + § brain v7
- ADR-004 cap-spec (superseded by §5 #1)
- ADR-005 irisy v4 (kept; §6 capability decomposition + §7 Pi extension contract still hold)
- ADR-006 cross-cutting (policy envelope L3/L4/L5 autonomy → deferred to v1.1)
- Brainstorm: `.olym/brainstorm/irisy-reply-specs-2026-06-04.md` (this ADR's design rationale + SOTA verbatim quotes)
- Brainstorm: `.olym/brainstorm/user-intents-2026-06-04.md` (68 intent inventory)
- SOTA agent reports: Personal AI assistant (Apple App Intents + Notion + Granola + Pi + Rabbit/Humane failures), agent IDE (Claude Code / Cursor / Cline / Goose / Aider), OpenClaw + Hermes, MCP top-10 scan — 4 agents, 2026-06-04
- Memory: `decision_irisy_is_pwa_native_not_keycap`, `decision_one_persona_irisy`, `decision_pi_is_sole_brain_hermes_is_keycap`, `decision_openclaw_compat_layer`, `decision_ctrl_obsidian_philosophy`, `decision_ctrl_repositioned_as_aggregator`
