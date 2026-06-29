---
name: hermes
description: Living reference for Hermes Agent — the brain that powers CTRL's in-app assistant Irisy. Load this whenever working on Irisy's brain, the ACP embed, acp_client.rs / agent_installer.rs, the :17873 gate-to-brain connection, why Irisy can't see tools / "can't browse", hermes skills/memory, or routing. KEEP IT UPDATED: append every new fact we learn about how hermes actually behaves.
---

# Hermes Agent — CTRL's brain (living reference)

> **This is a living doc. Every session that learns something new about how hermes
> actually behaves MUST append it here** (with the date + how it was verified).
> hermes is third-party (NousResearch) and under-documented, so our hard-won
> operational knowledge lives here, not in its docs. Canonical architecture truth
> stays in `vault/ctrl/architecture-byo-cli-driver.md` + ADR-002 § brain; this
> skill is the OPERATIONAL / protocol / gotcha layer.

## What it is

- **Hermes Agent** (NousResearch, PyPI `hermes-agent`, MIT) is the brain behind
  **Irisy**, CTRL's in-app assistant (ADR-002 substrate § brain v28). CTRL bundles
  + launches it; Irisy is the embed. hermes does NOT retire (the Pi/opencode
  paths did; hermes stays).
- Pins (`src-tauri/src/shell/agent_installer.rs`): `HERMES_ACP_SPEC =
  "hermes-agent[acp]==0.16.0"` (ACP stdio embed), `HERMES_ONESHOT_SPEC =
  "hermes-agent==0.16.0"`, `HERMES_PYTHON = "3.12"` (requires Python >=3.11,<3.14).
- Installed via **uvx** (no npm; end-user machines have no Node). State lives in
  **`~/.hermes/`** (NOT `~/.ctrl/agents/hermes`, which only holds CTRL's manifest).

## How CTRL runs it

Two surfaces, both fed CTRL's composed system prompt:
1. **ACP stdio subprocess** `hermes-acp` — spawned per chat by
   `src-tauri/src/shell/acp_client.rs`. This is the tool-using agent path.
2. **Dashboard** on `127.0.0.1:17890` (Settings → Irisy embed), launched by
   `kernel_supervisor`.

Spawn command (`agent_installer.rs::install_via_uvx` entry_cmd, re-injected by
`acp_client.rs` for stale manifests):
```
uvx --python 3.12 --with mcp>=1.24 --from hermes-agent[acp]==0.16.0 hermes-acp
```
- `--python 3.12`: without it uvx falls back to system Python (3.9 on macOS) and
  fails to resolve.
- `--with mcp>=1.24`: **CRITICAL — see the _MCP_AVAILABLE gotcha below.**

## ACP protocol (how CTRL talks to hermes-acp)

Newline-delimited JSON-RPC over stdio:
1. `initialize`
2. `session/new { cwd, mcpServers: [...] }`
3. `session/prompt { sessionId, prompt: [{ type: "text", text }] }`

`mcpServers` schema = `List[Union[HttpMcpServer, SseMcpServer, McpServerStdio]]`.
CTRL passes the **gate** as an `HttpMcpServer` (requires `type: "http"`, `name`,
`url`, `headers: [{ name, value }]`) pointing at `http://127.0.0.1:17873/mcp` with
the gate token + caller/intent headers, so hermes loads the 24 brain tools.

## How gate tools reach the brain

- The gate (`:17873`, `kernel/mcp_server.rs`) exposes tools; hermes namespaces
  them to the model as **`mcp_ctrl_*`** (e.g. `mcp_ctrl_web_search`,
  `mcp_ctrl_mcp_pack_install`). The gate's audit ledger logs the BARE name
  (`web_search`, `mcp_pack_install`) — hermes adds the `mcp_ctrl_` prefix.
- The brain is **capped** to a curated **`BRAIN_TOOLSET`** (24 tools,
  `kernel/visibility.rs`), projected FIRST in `list_tools` so the creation +
  research suite is never truncated by hermes's ~25-tool listing cap.
- **hermes NATIVE tools do NOT cross the gate**: `skills_list`, `skill_view`,
  `skill_manage`, and the soul/memory tools are hermes-internal. So they NEVER
  appear in the audit ledger — you CANNOT confirm from the ledger whether Irisy
  read a SKILL.md. Guidance the brain MUST see therefore belongs in
  `CTRL_CAPABILITY_BRIEF` (acp_client.rs, injected every session), not only in a
  skill it may never `skill_view`.

## THE big gotcha — _MCP_AVAILABLE (2026-06-28, verified end-to-end)

`hermes-agent[acp]==0.16.0` does **NOT** declare the `mcp` Python client SDK as a
dependency. Without it, the spawned env has `_MCP_AVAILABLE=False`, so hermes's
`register_mcp_servers()` silently `return []` (its DEBUG log is suppressed because
hermes's `entry.py` forces INFO level) — and the brain sees **ZERO** CTRL tools
even though `session/new.mcpServers` carried the gate. **Fix: `--with mcp>=1.24`**
in BOTH the manifest entry_cmd and acp_client's re-injection. Verified: `uv run
--with hermes-agent[acp]==0.16.0` → False; adding `--with mcp` → True.

## Skills hub

- `~/.hermes/skills/<category>/<name>/SKILL.md`, YAML frontmatter
  (name / description / category) + markdown body. `skills_list` / `skill_view`
  surface them to the model.
- CTRL vendors skills here (e.g. `development/create-feature-pack`,
  `output/render-html`, `output/frontend-slides-editable`). There is no boot-time
  re-seeder, so a file removed here is NOT restored — a leftover stale skill
  (e.g. the retired `productivity/clipboard-keycap`) can mis-teach the model; just
  delete it + clear `~/.hermes/skills/.hub/index-cache/`.

## Memory / SOUL

- hermes long-term memory = the user's **SOUL.md** (ADR-005 irisy v5 §6.3).
  Persist durable facts via the soul/memory tools so the chat path and the agent
  path share ONE memory and never drift. Locations seen: `~/.hermes/SOUL.md` +
  vault copies (`~/Documents/CTRL/irisy/SOUL.md`, etc.).

## Routing (CTRL side — who runs a turn)

`src-tauri/src/commands/irisy_chat.rs`:
- `turn_needs_agent(messages)` keyword-matches the LAST user message → tool/action
  turns go to the **hermes agent path** (has the gate tools); pure-language turns
  go to **provider-direct** (NO tools).
- Consequence: a capability/identity question ("can you go online?") routes
  direct → the tool-less base model wrongly denies web access. Mitigated by a
  capability-truth header in `build_mode_system_header` (every mode) + online/
  research routing needles. CJK needles are built from code points
  (`cjk_query_needles`) to keep the source all-English.

## Diagnostics (ground truth, not the user's pasted Irisy narration)

- **Audit ledger** = the real record of what the brain called at the gate:
  ```
  sqlite3 "$HOME/Library/Application Support/ai.ctrl.ctrl/event-store.db" \
    "SELECT datetime(ts_ms/1000,'unixepoch','localtime'),caller,tool,outcome,substr(detail,1,60) \
     FROM audit_calls WHERE caller='hermes' ORDER BY ts_ms DESC LIMIT 50;"
  ```
  `caller='hermes'` = Irisy's brain; `caller='pwa'` = the UI. See
  [[feedback-read-audit-ledger-not-guess-irisy]]. Remember native tools are absent
  here.
- `~/.ctrl/ctrl.log` — boot lines + gate session creation (`client_info name:"mcp"`
  = the hermes mcp client really connected → _MCP_AVAILABLE worked).

## Conversation continuity (FRAGILE — 2026-06-28, code-verified)

Irisy's chat memory on the agent path is brittle, by construction:
- `irisy_chat.rs` sends hermes **only the latest user message** (`last_user`),
  never the prior turns. Continuity depends 100% on the hermes ACP **session**
  surviving (the `session_id` held in the `acp_client::singleton()`).
- The system **brief/persona is injected only on a session's FIRST turn**
  (`acp_client.rs` `self.primed`).
- On **ANY** hermes prompt error, `irisy_chat.rs` sets the singleton to `None`
  → the next turn calls `start()` → a brand-new `session/new` → hermes loses the
  entire conversation AND re-primes from scratch. Since only `last_user` is ever
  sent, a fresh session = zero history = amnesia.
- Routing also **splits turns** between hermes (agent) and the bare provider
  (direct); the two backends don't share memory — direct turns never enter the
  hermes session.
- Net: any error / Stop / app restart / path switch makes Irisy forget.
- **Fix direction**: on priming (fresh/reset session, `!primed`) replay the full
  prior conversation history + brief into the first prompt, so a reset
  re-hydrates context; only send `last_user` while the SAME session continues.

## Behavior: researches but doesn't act (2026-06-28, ledger-verified)

The brain reliably calls READ/research tools (`web_search`, `discover_packs`)
but routinely **fails to call the follow-through WRITE tool** — verified: across
a whole session `caller='hermes'` never once called `vault_write` or
`mcp_pack_install`, so it never wrote an HTML artifact and never installed a
pack. It narrates the action instead of emitting the tool call. Counter with an
unmissable "describing ≠ calling" contract in the brief; consider making the
write step deterministic rather than model-driven.

## Known quirks

- The gate token must be **stable** (persisted `~/.ctrl/state/gate-token`); a
  per-boot token rotated hermes's cache and broke tool loading.
- Gemini backend returns empty content when many tools are present (retries 3x);
  re-sending works.
- Behavioral: the model **narrates** building instead of CALLING build tools
  (e.g. hallucinates an `add a key` function instead of `mcp_pack_install`).
  Counter it with an unmissable "describing ≠ calling" contract in the brief.

## Upstream to watch: native switchable agent modes (2026-06-28, web-verified)

NousResearch/hermes-agent **issue #482** — "Switchable Agent Modes — Named
Profiles with Tool Restrictions, Personas & Per-Project Config (inspired by Roo
Code)". hermes upstream is being asked to add Roo-Code-style modes (a named
profile bundling persona + tool restrictions + per-project config). This is the
SAME shape as CTRL's Irisy axes (persona + toolset/feature-packs + agent). If it
lands natively we can RIDE it instead of composing modes ourselves CTRL-side
(memory `decision-irisy-is-hermes-plus-kairo-integrate-hermes`: ride hermes's
upgrades). Watch the issue; re-check before building a CTRL-side "profile bundle"
on top of the three orthogonal selectors.

Industry context (for the selector UX): Roo Code is the gold reference (modes =
persona+tools+model, switched from a composer dropdown, with an Orchestrator that
delegates). Cline (`.role` profiles), LibreChat (Agents+Presets), OpenWebUI
(characters/Assistant Builder), Cherry Studio / Lobe Chat all ship variants. ALL
of them treat "agent" as "which model in MY loop" — none have CTRL's embedded
(hermes) vs BYO-CLI-driver (Codex/Claude Code, projected not supervised)
distinction. Keep that distinction explicit in the UI; it's the differentiator.

## How to update this skill

When you learn a new hermes fact (a protocol detail, a version quirk, a flag, a
failure mode, a config path), append it to the right section above with the date
and how you verified it (ledger / real run / source). Prefer verified facts over
guesses; mark anything unverified as such.
