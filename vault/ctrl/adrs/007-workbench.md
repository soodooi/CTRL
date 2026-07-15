---
adr_id: 007
module: workbench
title: CTRL workbench — mcp-composition canvas (React Flow + dnd-kit) + Irisy-led skill discovery (kernel-local first, ctrl-cloud Worker for production)
version: 2
status: accepted
last_updated: 2026-07-13
deciders: [bao, zeus]
sections:
  - { id: canvas,     source: orig-022 }
  - { id: discovery,  source: orig-023 }
changelog:
  - v2 2026-07-13: **Skill discovery reconciled with the current runtime and source model.** §5 removes retired ST-SS from live source types; Phase 1 and future-work execution now dispatch SKILL.md through the selected current engine and `:17873` gate rather than Pi. Historical provenance remains in retired ADR-008/009.
  - v1 2026-05-31: module reorg — merged orig-022 (workbench = sanctioned mcp-composition canvas) + orig-023 (skill discovery — kernel-local first 走通, ctrl-cloud Worker for production).
related:
  - vault/ctrl/adrs/002-substrate.md
  - vault/ctrl/adrs/004-cap.md
  - vault/ctrl/adrs/005-irisy.md
---

## §1 Mcp = one-shot. Workbench = composition canvas (they coexist)

ADR-001 §6 anti-list says "Workflow editor (Coze / n8n 已经做了)". This ADR carves out: CTRL is not a **generic** workflow editor (we don't compete with Coze/n8n on arbitrary API orchestration); CTRL **does** have a **mcp-composition canvas** that wires *mcps* (themselves MCP tools / skills) into a standing workspace.

| Surface | Nature |
|---|---|
| **Mcp** (unchanged) | One-shot. A single mcp pressed from the keyboard = one atomic action. No mcp becomes a multi-step wizard. |
| **Workbench** (new, `/workbench`) | Composition canvas. Power-user level-1 route. A place to assemble mcps into a durable workspace / mini-app, not a per-invocation flow rebuilt each time. |

bao 2026-05-29: "连线这种 workflow, 目前看是需要的; 现成的, 我们做集成." — wiring IS needed; use ready-made libraries, do not build a node editor from scratch.

## §2 Stack — reuse, don't build

Per § canvas decision below (researched + locked):

- **React Flow** (`@xyflow/react`, MIT) — wiring canvas, integrated as library, lazy-loaded into `/workbench` only. Custom nodes render the real mcp card. We do NOT write our own node editor.
- **dnd-kit** (MIT) — Pool → Keyboard palette drag + reorder (also used by ADR-003 § nav-keyboard).
- **JSON Schema** — I/O port types (aligns with MCP tool I/O, ADR-002 § mcp-bus).
- **Forbidden**: any built-in dataflow *engine* from another lib (Flowise / Langflow / n8n / ComfyUI / Dify); any GPL / fair-code dep. React Flow is canvas-only.

## §3 Thin orchestrator (CTRL-owned, not borrowed engine)

React Flow is design-time only. The graph compiles to a clean execution IR. **Thin CTRL-owned orchestrator** topologically walks it: read graph → topo → call each mcp through the existing executor (subprocess + mcp_host + sandbox) → route I/O edge-by-edge with JSON Schema check per hop. Not an n8n-class engine — read graph, run, done.

## §4 Two legs of composition

| Leg | Mechanism |
|---|---|
| **In-app** | Workbench orchestrator (§3) wires mcps on the canvas |
| **Outsourced** | External workflow engine (n8n / Zapier / Make) the user already runs is wrapped as a **single mcp** via MCP Server Trigger (`install_mcp_from_mcp`) or webhook. Whole flow collapses to one one-shot mcp; execution stays on the external instance |

This is how CTRL gets "flows" without embedding a workflow engine.

## §5 Mcp object — standardized + incremental

`create mcp` produces standardized declarative mcp object (Zod manifest, ADR-002 § composition / `@ctrl/mcp-sdk`). Gains:
- `source: "skill"` source type (alongside builtin / mcp / oauth / local_agent)
- `io` block (JSON Schema input/output ports)

Re-added to SDK (these were removed to keep PR #62 a clean slate). Full "all components of a mcp" list + I/O schema vocabulary built **incrementally** per mcp.

## §6 Hard rules (this ADR holds)

- React Flow is canvas-only; execution NEVER leaves CTRL executor
- No GPL / fair-code deps; no borrowed dataflow engine
- Ports are JSON Schema, validated structurally at connect-time (NOT string type names)
- A single mcp stays one-shot; composition is an additive layer
- The canvas only composes **mcps** (MCP tools/skills), never raw API nodes; if a need looks like "arbitrary API orchestration", the answer is "wrap it as an external-engine mcp" (§4), not "add a node type"

## §7 Skill discovery — kernel-local first (走通), ctrl-cloud Worker for production

bao 2026-05-29: "本地先走通" + "不是每个用户都有 github repo 的". Two facts drive phasing:
- Skills live in their **authors'** public GitHub repos (e.g. `zarazhangrui/frontend-slides`) — never per-user repos
- Installing public skill needs **no token** (anonymous clone / raw fetch). Only **searching** (GitHub code search API) needs one — general user has no GitHub account/token

### Phase 1 — kernel-local (走通, zero cloud)

Kernel runs whole first-mcp pipeline locally:
- **Search** = GitHub code search using dev/BYOK PAT in macOS Keychain (bao's token for walk-through; advanced user's own later)
- **Install** = anonymous public clone/fetch → `~/.ctrl/mcps/<id>/`
- **Run** = selected current engine dispatches the installed SKILL.md through the `:17873` gate

Proves frontend-slides end-to-end. Does NOT violate "no local `wrangler dev`" — that bans running the Worker locally; kernel making HTTPS call is not that.

### Phase 2 — ctrl-cloud Worker `ctrl-skills` (production, deferred)

Most users have no GitHub token → production search MUST go through shared Worker carrying **our** token on user's behalf. One shared Worker for all users (NOT per-user, NOT skill storage). Install stays token-free + local for everyone. Stand up `soodooi/ctrl-cloud` only after Phase 1 走通.

### Worker substrate (Phase 2)

Single Cloudflare Worker → `*.workers.dev` staging (CLAUDE.md: no local `wrangler dev`). Two source legs behind one API:

| Leg | Source | Why |
|---|---|---|
| **A — MCP registries** | Official MCP Registry (`registry.modelcontextprotocol.io`) + Glama (~27k) + PulseMCP (~11k) | The "10k+ Day-1" MCP-server population. API-native, no GitHub rate-limit exposure |
| **B — GitHub `SKILL.md` code search** | `/search/code?q=filename:SKILL.md ...` with server-side token, **heavily edge-cached** | For agent-skills registries don't index. Edge cache = the rate-limit mitigation (load-bearing, not optional — gh `cli/cli#13293` "rate limiting makes skill discovery unusable") |

Endpoint: `GET /skills/search?q=<query>&source=<registry|skill|all>&page=<n>` → CTRL envelope, never raw upstream. Normalized result item: `{ kind: "mcp"|"skill", id, name, description, source, install_ref, stars?, url }`.

### §8 Irisy is the ONLY discovery surface

bao 2026-05-29: "保留一个 Irisy 搜索就行". One surface — Irisy. Discovery is conversational, never a search box.

- Irisy gains `search_skills` (Phase 1: kernel command; Phase 2: `ctrl-skills` Worker) and `install_skill_as_mcp` (clone/fetch → write `skill`-variant manifest) in its tool registry
- User says "I want HTML slide decks" → Irisy turns into keywords → searches → reasons over results → recommends frontend-slides → installs → lands on Keyboard
- **No manual search box**. Pool stays browse view of *installed* mcps; does NOT get GitHub-skill search box. Finding new skills is Irisy's job (memory `feedback_no_redundancy_one_ssot`)

### §9 Hard rules (this ADR holds, Phase 2)

- Tokens NEVER leave Worker
- No local `wrangler dev`; staging on `*.workers.dev`
- Desktop must still create mcp from `owner/repo` without ctrl-cloud
- Worker returns normalized CTRL envelope, not raw upstream JSON
- Edge caching on Leg B mandatory, not optional
- CORS allows CTRL app origins (PWA dev origin, Tauri scheme, deployed PWA), not wildcard
- Light per-IP token-bucket on Worker to protect GitHub budget from abuse

## Acceptance

- [x] ADR direction recorded — composition canvas surface + skill discovery 2-phase phasing locked. All implementation items in § Future work below. Closed at "decision recorded" 2026-05-31.

## Future work

### Canvas (§1-§6, v1.1+ scope)

- Re-add `skill` source + `io` (JSON Schema ports) to `@ctrl/mcp-sdk` — foundation step
- `/workbench` route scaffold (lazy React Flow + dnd-kit + Irisy side-pane)
- Thin orchestrator (graph IR → topo walk → executor → I/O routing) + JSON Schema `isValidConnection`
- Mcp "all components" list + I/O schema vocabulary filled incrementally per mcp

### Discovery Phase 1 (kernel-local 走通)

- Kernel `search_skills { query }` via GitHub code search + PAT-in-Keychain (document setup, don't make bao guess service name)
- Kernel install-from-skill — anonymous public clone/fetch → `~/.ctrl/mcps/<id>/` + write `skill`-variant manifest
- Irisy tools `search_skills` + `install_skill_as_mcp` wired
- Kernel `run_mcp` skill dispatch through the selected current engine and `:17873` gate + viewer render → frontend-slides end-to-end

### Discovery Phase 2 (ctrl-cloud production, deferred)

- Deep-dive registry APIs (official MCP Registry / Glama / PulseMCP)
- Create `soodooi/ctrl-cloud` + `ctrl-skills` Worker per §7 Phase 2; `GITHUB_TOKEN` secret; staging deploy
- Switch production search from kernel-local PAT path to Worker (install stays token-free + local)

## Provenance

- §1-§6 ← orig-022 (Workbench composition canvas, 2026-05-29, accepted)
- §7-§9 ← orig-023 (Skill discovery kernel-local first / ctrl-cloud Worker for production, 2026-05-29, accepted)
