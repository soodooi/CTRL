# hermes-agent integration spike — RESULT

- **Date**: 2026-05-22
- **Spiker**: zeus
- **Goal**: verify spec §3.3 (installer) + §3.4 (SSE event schema) assumptions
  for `.olym/specs/irisy/spec.md` (REVIEW Critical 3 + 4).
- **Verdict**: **Spec §3.3 + §3.4 are factually wrong**. The real integration
  point is MCP-bidirectional, not HTTP/SSE. **Architecture simplifies — no
  `bootstrap_hermes` Tauri command needed for an HTTP daemon spawn.**

---

## Reproducible steps

```bash
mkdir -p /tmp/hermes-spike && cd /tmp/hermes-spike
python3 -m venv venv
./venv/bin/pip install hermes-agent
./venv/bin/hermes --version
```

Output (verbatim, on Python 3.14.4, macOS 25.4.0):

```
Hermes Agent v0.14.0 (2026.5.16)
Project: /private/tmp/hermes-spike/venv/lib/python3.14/site-packages
Python: 3.14.4
OpenAI SDK: 2.24.0
Up to date
```

3 binaries installed:
- `hermes` — primary CLI
- `hermes-agent` — alias (same Python module entry)
- `hermes-acp` — ACP (Agent Client Protocol) variant for editor integration

---

## Findings vs. spec assumptions

### §3.3 — installer

| Spec assumption | Reality |
|---|---|
| Default path: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh \| sh` | **Not verified** — that URL was a guess. Spec author should not assume `install.sh` exists upstream. |
| Fallback: `pip install hermes-agent` (PyPI) | ✅ Confirmed works. PyPI `hermes-agent` v0.14.0 is the official package. |

**Recommendation**: spec §3.3 default = `pip install hermes-agent` into
`~/.ctrl/hermes-venv/`. Drop the `install.sh` mention entirely; one path,
no optional channels.

### §3.4 — runtime protocol

**Spec assumed**: hermes exposes `/v1/runs` + `/v1/runs/$id/events` SSE
with custom event types (`tool_call_start`, `tool_call_progress`,
`tool_call_error`, `run_failed`). PWA infers 8 lifecycle stages by
mapping these events.

**Reality**: hermes-agent has no such HTTP daemon. The subcommands are:

- `hermes chat` — interactive REPL (`-q QUERY` = non-interactive one-shot,
  `-Q` = quiet mode for programmatic use)
- `hermes gateway` — messaging-platform bridges (Telegram / Discord /
  WhatsApp / Weixin / Slack). **Spec §3.3 confused this with an HTTP API.**
- `hermes proxy` — OpenAI-compatible *credential forwarder* (forwards
  external requests to an upstream LLM with stored OAuth creds). Not the
  agent loop, just a relay.
- `hermes acp` — Agent Client Protocol mode for VS Code / Zed / JetBrains.
- **`hermes mcp serve`** — Run Hermes itself as an MCP server (exposes
  Hermes conversations to other agents via MCP).
- **`hermes mcp add`** — Connect Hermes to an external MCP server.

### §3.5 — tool exposure

Hermes uses **MCP `server:tool` notation** for external tools (e.g.
`github:create_issue`, `ctrl-kernel:vault.read`). Built-in toolsets use
plain names (`web`, `memory`). The CTRL keycap → tool wire works
naturally via this convention — once kernel's MCP server is registered
with `hermes mcp add`, every kernel tool becomes addressable as
`ctrl-kernel:<tool>`.

---

## Correct integration architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CTRL kernel (Rust)                                         │
│                                                             │
│   ┌────────────────────────────────────────────────────┐    │
│   │  kernel::mcp_server  (ADR-013, 127.0.0.1:17873)    │    │
│   │  • vault.* / kv.* / llm.chat / mcp.proxy_*         │    │
│   └────────────────────────────────────────────────────┘    │
│         ▲                                                   │
│         │ MCP wire (streamable-http)                        │
│         │                                                   │
└─────────┼───────────────────────────────────────────────────┘
          │
   ┌──────┴─────────────────┐
   │  hermes-agent (Python) │
   │                        │
   │  registered via:       │
   │  hermes mcp add        │
   │    ctrl-kernel         │
   │    http://127.0.0.1:   │
   │    17873/mcp           │
   │  -H "Authorization:    │
   │    Bearer <token>"     │
   └────────────────────────┘
          ▲
          │ MCP wire OR stdout (one-shot)
          │
   ┌──────┴─────────────────┐
   │  Irisy (PWA)           │
   │                        │
   │  Option A: spawn       │
   │    `hermes chat -q     │
   │    "..." -Q` via       │
   │    SubprocessActor     │
   │    (ADR-012); parse    │
   │    stdout for UI       │
   │                        │
   │  Option B (preferred): │
   │    spawn `hermes mcp   │
   │    serve` once, then   │
   │    invoke "chat" tool  │
   │    via kernel's MCP    │
   │    proxy. Structured.  │
   └────────────────────────┘
```

**Why this is simpler than the spec**:

- No custom SSE event types to parse → no inference engine for §3.4
- No `bootstrap_hermes` Tauri command that spawns an HTTP daemon — just
  `pip install hermes-agent` + `hermes mcp add` on first run
- One protocol (MCP) end-to-end; CTRL kernel is the integration hub on
  both sides — keycaps register as kernel tools, hermes registers
  kernel as an MCP source, Irisy consumes via the same MCP wire

---

## Action items for hephaestus (spec v0.2.0)

1. **§3.3**: Rewrite installer flow. Single path: `python3 -m venv ~/.ctrl/hermes-venv` + `~/.ctrl/hermes-venv/bin/pip install hermes-agent`. Drop the `install.sh` mention. On first install, follow up with `hermes mcp add ctrl-kernel http://127.0.0.1:17873/mcp -H "Authorization: Bearer $(security find-generic-password ...)"`.
2. **§3.4**: Replace the SSE-event 8-stage inference engine with **MCP tool-call observability**. When hermes calls a kernel MCP tool, kernel logs the call (already does for ST-SS bridge cells); PWA subscribes to those cells via the existing ST-SS bridge. Lifecycle stages map naturally to MCP request/response pairs, not to invented event names.
3. **§3.3 / §3.4 / §3.5**: Replace "hermes gateway" mentions with the correct subcommand. `hermes gateway` = messaging bridges, do NOT spawn it for CTRL's internal API needs.
4. **C4 component (bootstrap_hermes Tauri command)**: scope shrinks dramatically. v0.2.0 should have it do just: (a) probe `python3 --version >= 3.11`, (b) create venv, (c) `pip install hermes-agent`, (d) call `hermes mcp add ctrl-kernel ...` with kernel's ephemeral URL + token. No HTTP daemon to start; hermes is a per-invocation subprocess via `hermes chat -q` OR a long-running `hermes mcp serve` we drive via MCP.

---

## What zeus delivers in this PR (ADR-013 branch)

- Kernel MCP server at `127.0.0.1:17873/mcp` with 10 tools (`kernel.status`, `vault.read/write/list/search`, `kv.get/set`, `llm.chat`, `mcp.list_servers`, `mcp.proxy_list_tools`, `mcp.proxy_call_tool`).
- Bearer-token auth (ephemeral per-boot, mirrors ST-SS bridge token model).
- `mcp_server_info` Tauri command returning `{ url, token }` so PWA and a future `bootstrap_hermes` command can hand the URL+token to `hermes mcp add`.
- ADR-013 doc — kernel-as-MCP-server design, with this spike's findings as the §Counter-evidence anchor.

`bootstrap_hermes` Tauri command itself is **deferred to a follow-up PR** (hephaestus owns). Reason: spec v0.2.0 hasn't landed yet, and the command surface depends on hephaestus's updated decisions (e.g. is hermes a per-invocation subprocess or a long-running `mcp serve`? choice affects command shape).

---

## Verification commands hephaestus can re-run

```bash
# Confirm pip install works.
python3 -m venv /tmp/h2 && /tmp/h2/bin/pip install hermes-agent

# Confirm no HTTP daemon on a "default" install.
/tmp/h2/bin/hermes status   # shows components; no listening port

# Confirm MCP server mode exists.
/tmp/h2/bin/hermes mcp --help

# Confirm one-shot programmatic mode (needs --model + --provider + creds).
/tmp/h2/bin/hermes chat --help    # see -q / -Q flags
```

---

## Sign-off

zeus, 2026-05-22. Spike took ~15 min of CLI inspection. No model
credentials were exercised (live API call deferred until hephaestus
picks Option A vs B in the architecture diagram).
