# CTRL Product Thesis

> Distillation of bao's product / commercial / architecture reframes through the 2026-05-22 discussion. Living document — **discussion-stage, not locked**. Update as we keep talking.
>
> Companion to `.olym/steering/ctrl-strategy.md` (5-min navigator) and `.olym/decisions/001-system-architecture.md` (architecture lock).

---

## 1. One-line positioning

**CTRL is the desktop-native replacement for token-heavy AI web SaaS.**

Not a tool aggregator. Not a launcher of other apps. Not a wrapper around third-party AI websites. A platform where token flows through CTRL, data lives on the user's disk, and creators ship keycaps + skills instead of standalone SaaS sites.

---

## 2. The commercial flywheel

```
User pays CTRL subscription / metered usage
        ↓
CTRL consumes tokens (Volc Ark / OpenAI / Anthropic — wholesale)
        ↓
Margin between retail and wholesale = CTRL revenue
        ↓
Creators contribute keycaps + skills (prompts / templates / knowledge)
        ↓
Users adopt more → CTRL revenue share to creators → more creators → ecosystem moat
```

**Invariant**: token traffic **must** pass through CTRL. Any path that diverts tokens elsewhere (calling seede.ai's API, opening Midjourney in a browser, BYOK-only modes) breaks the flywheel and is the wrong product direction by default. BYOK is a fallback for power users, not the default path.

---

## 3. Four differentiators vs AI web SaaS

| Axis | AI web SaaS (Jasper / Canva AI / seede.ai / Otter / Perplexity / Lex …) | CTRL |
|---|---|---|
| **Entry** | Open browser → 5 tabs → sign in / out | `Ctrl` keypress → instant ephemeral workspace |
| **Data** | Server-side (the SaaS sees every prompt + output) | Local vault (markdown + frontmatter, Obsidian-compatible, user owns) |
| **Customization** | SaaS-locked templates, hard to fork | User one-click forks any keycap → private version, Irisy guides edit |
| **Ecosystem** | SaaS sets the template catalog | Creators contribute keycaps + skills, revenue share |

Same token-cost market. Different shape of customer relationship.

---

## 4. SaaS → keycap replacement map

Each high-token web SaaS = one CTRL keycap, native + private + creator-extensible:

| Web SaaS | CTRL keycap |
|---|---|
| Jasper / Copy.ai (marketing copy) | "marketing copy" keycap (skill = creator prompt + tone library) |
| Canva AI / seede.ai (poster / social post) | "poster / social-post" keycap (image.generate + creator template skill) |
| ChatPDF / Humata (PDF QA) | "PDF chat" keycap (file.read + text.chat + skill knowledge) |
| Otter / Riverside (audio transcribe) | "transcribe" keycap (audio.transcribe + skill post-processing) |
| Perplexity / Phind (AI search) | "research" keycap (multi-capability + skill orchestration) |
| Lex / Sudowrite (long-form writing) | "writing" keycap (text.chat + creator style skill) |
| Notion AI (in-doc AI) | inline text.chat capability via Irisy on any vault doc |

CTRL does **not** integrate these SaaS sites (would forfeit token margin). CTRL competes with them on UX + data ownership while running the same token-economy backend.

---

## 5. What CTRL *does* integrate (different goal)

Data sources and collaboration platforms where users already have data — integrate to **sync that data into the local vault**, not to push CTRL's primary scenarios through them:

- Feishu / Lark — IM history, doc sync
- Notion — page sync
- Slack — channel messages
- GitHub — code / issues
- Gmail — mail
- iMessage / WeChat / Telegram — chat history

These are **not** revenue paths for CTRL. They feed the local vault. The user's AI generation still happens inside CTRL.

---

## 6. Irisy — the AI companion architecture

```
Irisy (the user-facing AI companion)
├── runtime:   hermes-agent (NousResearch/hermes-agent, Python 3.11+)
│              reasoning loop / tool-call scheduling / skill consumption
├── knowledge: hermes skills (agentskills.io standard, markdown + assets)
│              source 1: agentskills.io community
│              source 2: CTRL-bundled (complex-behavior keycaps projected)
│              source 3: creator-contributed (expert packs, revenue-share)
└── actions:   MCP tools
                kernel capabilities (vault / clipboard / screen / oauth / messaging / process / …)
                most keycaps (single-action ones, manifest → MCP server)
```

The three layers are **not 1:1**. A skill can exist without a keycap. A keycap can exist without a skill. Hermes is *one of* several runtime options the user can swap (default for v1; other AI runtimes like Claude / GPT also consume CTRL's MCP server identically).

---

## 7. keycap × hermes-skill decision

| Keycap shape | Projection target | Examples |
|---|---|---|
| **Single-action tool** (input → output, atomic) | **MCP tool** (default; majority of keycaps) | clipboard-translate / base64-encode / OCR / "send Feishu message" |
| **Multi-step agent behavior** (reasoning, branching, tool composition) | **hermes skill** (+ calls to underlying MCP tools) | "research topic X" / "code review" / "write a PRD" / "data analysis" |
| **Knowledge-dense** (creator-packaged expert prompts + context + examples) | **hermes skill** (markdown knowledge, occasionally calls tools) | legal drafting / financial reports / TCM diagnosis |

The manifest declares its target. Decision rule: needs multi-step agent reasoning or rich knowledge context → skill; otherwise → MCP tool.

---

## 8. Keycap full lifecycle — Irisy presence at every stage

Irisy is not a popup mode invoked at install time. It is an always-on companion across the full keycap lifecycle:

| Stage | Irisy behaviour |
|---|---|
| 1. **Discovery** | Suggests keycaps based on local telemetry / context: "you've copy-translated-Feishu 3 times today; want me to install ai-translate?" |
| 2. **Creation** | Existing keycap-creator pane — natural-language description → manifest + projection target |
| 3. **Config** | Walks user through OAuth flow / CLI install / API key entry — visual, no command-line copy-paste |
| 4. **Invoke** | User doesn't memorise keycap names — Irisy routes natural-language intent to the right keycap or composes multiple |
| 5. **Collab** | Irisy stays in the workspace during execution: multi-turn dialogue, mid-execution decisions, transparent tool-call trace |
| 6. **Debug** | Subscribes to `KeycapFailed` ops; surfaces fix proposals ("claude CLI missing, want me to `npm i -g`?") |
| 7. **Improvement** | Usage-statistics driven: "you've used this 27 times in 7 days, bind a hotkey?" |
| 8. **Retire** | Proactive GC: "you installed X 3 months ago, never used, uninstall?" |

---

## 9. Kernel surface — dual transport, single backend

```
                  Capability Registry (single backend impl)
                  ├── kernel-native: vault / clipboard / screen / oauth /
                  │                   messaging / process / mcp.invoke / …
                  └── keycap-derived: each installed keycap is registered
                              ↑
        ┌─────────────────────┼─────────────────────┐
  Tauri commands                              MCP server (rmcp)
  (PWA UI in-process invoke)            stdio / streamable-http
        ↓                                            ↓
  ManifestRenderer / Workspace            Irisy LLM (tools/list + tools/call)
  / Code Space / Status bar               External AI agents (Claude / Cursor)
                                          User-installed hermes-agent runtime
```

The same backend serves both surfaces — no duplication. PWA UI takes the fast in-process Tauri path; AI agents take the discoverable MCP path.

---

## 10. User-fork model — keycap as user asset

Public keycaps (CTRL-bundled / creator-contributed) are starting points, not final products. Users can:

1. **Fork**: one-click `fork to my keycaps` → copy manifest + skill + assets into `~/.ctrl/keycaps/private/<id>/` with `forked_from: <original_id>` lineage
2. **Edit**: Irisy guides edits in natural language ("make the prompt more formal", "add my company tone")
3. **Test**: immediate try-out within the same keycap-creator UI
4. **Share back (optional)**: PR-style contribution to the public ecosystem

Forked private keycaps live in the user's vault, sync across the user's devices via mesh (when ADR-003 lands), and never get uploaded to CTRL servers. Public-version revenue share to the original creator continues; the user's fork doesn't change that contract.

---

## 11. What CTRL is NOT

| Don't | Why |
|---|---|
| Integrate AI web SaaS (seede / Midjourney / ChatGPT web) | Token traffic leaks → no margin → no flywheel |
| Workflow editor (Coze / n8n style) | That's a different product category, already saturated |
| Make users write JSON | UX premise: natural-language → Irisy generates / edits manifest |
| Ship a long-tail platform-adapter list (every SaaS) | Doesn't scale; integrations are creator contributions, not core scope |
| Lock data in proprietary format | Violates Obsidian philosophy; user must own the bytes |
| Require CTRL cloud for core functionality | End-side-first; cloud is augmentation, not dependency |
| Default to BYOK | Bypasses CTRL margin; only a fallback option |

---

## 12. Open questions (still under discussion)

- **Revenue share split** between original creator and fork-user when fork goes back into circulation
- **Default model selection** per capability domain (image / text / audio) — Volc Ark is current default but evaluation criteria for switching providers per-task
- **Skill discoverability ranking** — when Irisy has 100s of installed skills, what's the selection algorithm
- **Cross-device sync timing** — when does ADR-003 mesh layer go from spike to production
- **Public keycap registry shape** — npm-style? git-pull style? GitHub-monorepo style (Raycast)?

---

## 13. Document hygiene

- **Discussion-stage, not locked.** No memory pins until alignment is solid.
- Update via dialogue with bao; reflect each correction here, do not silently overwrite.
- Cross-references: `.olym/steering/ctrl-strategy.md` (operational navigator), `.olym/decisions/001-system-architecture.md` (kernel architecture lock), `CLAUDE.md` (rules + design philosophy).
- Sections 1-7 represent the most-tested layers (multiple bao corrections in 2026-05-22 session). Sections 8-12 are newer and more provisional.
