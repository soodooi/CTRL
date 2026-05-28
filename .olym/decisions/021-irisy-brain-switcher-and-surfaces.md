---
adr_id: 021
title: Irisy is a personal assistant with a pluggable brain — cc-switch / VMark / opencode style
status: accepted
date: 2026-05-27
deciders: [bao, hephaestus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/005-no-claude-in-production-runtime.md
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/decisions/016-irisy-eight-stage-lifecycle.md
  - .olym/decisions/019-ctrl-hermes-plugin-primary.md
  - .olym/decisions/020-vmark-stack-adoption.md
  - doc/irisy.md
scope: framework
supersedes: []
superseded_by: []
amends:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/019-ctrl-hermes-plugin-primary.md
---

## Context

Three threads collided on 2026-05-26/27:

1. **Pi-as-sole-brain hardcoded (ADR-019 amendment 2026-05-25)** — left
   `brain_mcp_url` as `match brain_id { "pi" => "http://127.0.0.1:17874/mcp", _ => None }`
   in `src-tauri/src/commands/irisy_chat.rs`. Port hardcoded, brain id
   hardcoded, no user-facing way to choose anything else.

2. **Irisy chat doesn't work end-to-end** — bao reported "new chat 都没有功能".
   Code audit found three independent root causes:
   - `/` homepage `default.tsx::handleSend` was a stub (`// Phase 1D wires this`).
   - "New chat" rail button only cleared the textbox, never reset the session.
   - History sidebar showed `PLACEHOLDER_HISTORY` hardcoded fake entries.
   The `/irisy` route's chat path was wired (Volc default; Pi optional via
   `irisy_chat_stream`), but the homepage never reached it.

3. **bao's directive (2026-05-26)** — *"抄作业，VMark 怎么接的？opencode 如何处理的？给个图像化的接口页面就行了，还有 cc-switch."*

   The three references share one pattern: provider/brain is a list of
   candidates the user picks in a Settings UI, with a "Detect on PATH"
   button. The list is data (TOML / JSON), not code. The active selection
   persists to a single small file the daemon reads each turn.

## Decision

### 1. Irisy is a personal assistant, not a generic chatbot

Surface #1 (the `/irisy` route's default mode) is renamed **Personal
Assistant**. Product promise: the user tells Irisy what they want done;
if a suitable keycap isn't installed yet, Irisy installs it and operates
it on their behalf. The previously-listed "General Chat" framing is
retired.

The 5 surfaces of Irisy are (canonical list — see `doc/irisy.md` for
the implementation map):

| # | Surface | Entry |
|---|---|---|
| 1 | **Personal Assistant** | `/irisy` default mode |
| 2 | **Keycap Creator** | `/irisy?intent=create-keycap` |
| 3 | **Code Companion** | `/code-space/$envId` side-pane |
| 4 | **Memory Keeper** | cross-cutting; vault `.irisy-memory/` |
| 5 | **Keycap Installer** | extension of surface #1, not a separate page |

### 2. Brain is pluggable; the user picks one in Settings

Replaces ADR-001 amendment 2026-05-25 wording ("CTRL sole brain = Pi").
Pi remains the **default** and the **only adapter we ship in v1**, but
the architecture treats brain as a registry-driven choice:

- Registry lives in code (`src-tauri/src/kernel/brain_config.rs`) with
  user overrides at `~/.ctrl/brains.toml`.
- Default registry ships Pi (adapter present) plus scaffold entries for
  Claude Code, Codex, and Gemini CLI (no adapter yet — UI shows them as
  "adapter coming").
- Active selection lives in `~/.ctrl/active-brain` (single line of
  text). `irisy_chat_stream`'s `resolve_active_brain` reads this file.
- The Tauri command `brain_set_active { id }` writes the file.

### 3. cc-switch / VMark / opencode-style Settings page

`/settings/brain` (replaces `/settings/hermes`) hosts the switcher:

- A "Detect on `$PATH`" button runs `which <command>` for every entry
  and reports `binary_path` + `version` per brain.
- Each brain renders as a card with a radio. Only brains with both
  `adapter_available = true` AND a detected binary can be selected.
- The active brain's card highlights with a coloured border.
- Stale Hermes UI (`/settings/hermes`, `IrisyStatus.hermes`,
  `irisy_chat_hermes`, `irisy_upgrade_hermes`) is **demoted, not deleted**
  yet — the route now redirects to `/settings/brain`. Full removal
  follows once any in-flight hermes branches land or are cancelled.

### 4. Three new Tauri commands

```
brain_list       — return BrainView[] + active_id
brain_detect     — re-probe $PATH + healthz; same return shape
brain_set_active { id } — persist active brain
```

All three return the same `BrainListReply` shape so the Settings page
can reuse one renderer for load / detect / set.

### 5. Keycap Installer ⊂ Personal Assistant

Per bao 2026-05-26 ("Irisy 要能安装键帽"), the Personal Assistant must
be able to install a keycap during a conversation. Tools added to the
frontend ReAct registry (`packages/ctrl-web/src/lib/irisy-tools.ts`):

- `list_brains` / `set_active_brain` (this ADR)
- TODO `search_pool` / `install_keycap_from_pool` — block on Pool
  backend (`/pool` route uses placeholder data today; the Pool registry
  is the next gap).

Existing `install_keycap` / `install_keycap_from_mcp` Tauri commands
are already wired for the Keycap Creator; the gap is making them
available to chat-mode Irisy and adding a `search_pool` source.

### 6. Homepage chat wiring

`/` (`routes/default.tsx`) hands the user's first message off to
`/irisy?text=<encoded>` (and `?fresh=1` for "New chat"). All transport,
persistence, brain-routing, and tool-execution logic stays in one
component (`IrisyChat.tsx`). The homepage is a thin landing surface;
the actual chat lives at `/irisy`.

The rail's history sidebar reads the persisted conversation from
`localStorage.irisy:chat:v1` and surfaces a "Current" entry when one
exists. Multi-session history is a follow-up.

## Consequences

**Good**

- Irisy chat works end-to-end with the existing Volc adapter via
  `chat_stream` the moment this PR ships — no Pi MCP server needed.
- Switching to Pi (or, later, Claude Code / Codex / Gemini) is a UI
  toggle, not a recompile.
- Drift cleanup queue: ADR-019 wording, `IrisyStatus.hermes`,
  `irisy_chat_hermes`, `/settings/hermes`, `read_hermes_status` tool
  are all marked deprecated and have a single replacement target.

**Cost**

- The kernel does not yet auto-spawn `ctrl-pi-mcp.ts` — selecting Pi
  as active brain doesn't start its MCP server. v1 expectation: user
  starts it manually (`npm start` in `packages/ctrl-pi-plugin/`). Auto-
  spawn is a follow-up handoff because of bundling concerns (node
  binary location, `--experimental-strip-types` flag, port allocation).
- Hermes vestigial code stays in tree for one release cycle. Tracked
  in the drift inventory of `doc/irisy.md` §5.

**Hard rules (this ADR holds)**

- `brain_mcp_url` MUST read from `kernel::brain_config`. No `match`
  on brain id allowed in the routing path.
- New brain candidates added to the default list MUST either ship an
  adapter (`adapter = Some(_)` in `default_brains()`) or be explicitly
  marked "coming" (`adapter = None`) — the Settings UI uses this flag
  to gate activation.
- Changes to `IrisyStatus` MUST go through the brain registry, not by
  adding brain-specific fields like `IrisyStatus.hermes`.

## Open follow-ups (not blocking this ADR)

1. Pi MCP server auto-spawn from `KernelSupervisor::start` when active
   brain has `adapter = "pi"`. Needs binary discovery + port reservation.
2. Pool registry backend → `search_pool` / `install_keycap_from_pool`
   tools (currently TODO; `/pool` route is placeholder data).
3. Multi-session chat history. Today there is one rolling
   `localStorage.irisy:chat:v1` conversation; the rail's "Current"
   group reflects that. Sessions persisted in the kernel event store is
   the next iteration.
4. Drop `irisy_chat_hermes` + `irisy_upgrade_hermes` + the Hermes
   upgrade button in IrisyChat header once any in-flight hermes branch
   work has landed or been cancelled.
