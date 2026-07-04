---
name: create-feature-pack
description: >
  Build a CTRL feature pack — a tool the user triggers in their workbench that
  connects an app / API / MCP server or runs custom logic, governed by the
  :17873 gate. Use when the user asks to "connect X", "build a tool for Y", "make
  an integration", "track Z from <service>", or add a capability CTRL does not
  have yet. Research-first: understand the need, find the REAL source, then build.
version: 1.0.0
author: CTRL
metadata:
  hermes:
    tags: [ctrl, feature-pack, integration, connector, mcp, research]
---

# Create a CTRL feature pack

A feature pack turns an external capability (an app, an API, an MCP server, or
custom logic) into a tool in the user's CTRL workbench. **The most important part
is the RESEARCH — a pack is only as good as understanding the need and finding
the real source. Do NOT jump to a manifest.**

Some tools below are not in your default list; find them with
`gate_tool_search("keywords")` and run them with `gate_tool_call(name, args)`.

## The flow — research-first, not build-first

### A. Understand the need — propose, don't demand
The user asks vaguely ("connect my Ghostfolio", "track A-share sentiment"). Pin
down: who uses it, the ONE real job, their ability. Propose what the pack would
do and confirm; ask only the 1-2 genuinely ambiguous bits. Never a questionnaire,
never demand a spec.

### B. Research the real source — NEVER invent
Find the real thing that will power the pack:
- `discover_packs("<domain>")` — search the MCP Registry + Smithery (2000+) for an
  existing MCP / pack that already does it. Prefer reusing over rebuilding.
- `web_search("<service> API docs")` and read the real endpoints, auth, and data
  shape — never guess an API. To read a page deeply, `gate_tool_search` for a
  browser / extract tool.
- Cross-verify: a real endpoint + a real auth model + a real data shape before
  you design anything.

### C. Pick the form — from what you researched
- **app** — a self-hosted product with a REST API (Ghostfolio, Twenty). Declare a
  `record_source` / `actions[]` in the manifest that call its endpoints; no code.
  Connector tools (via gate_tool_search): `source_describe/query/produce`,
  `http_get/post`.
- **MCP** — an existing MCP server: a manifest `server` block; the gate connects
  it. Install-and-wire: `discover_packs` → `mcp_pack_install`.
- **API / no server** — raw data or custom logic (akshare, any REST). You WRITE a
  small local service (fastmcp + the data lib) and declare it as the manifest
  `server`; its source lives in `projects/<pack>/service/` (vim-readable,
  git-attributed, user-editable). **The pack shell sandbox is network-denied — an
  API integration is a SERVICE you write, not a fetch script.**

### D. Build
- `mcp_pack_scaffold` (gate_tool_search) scaffolds the pack skeleton, or
  `mcp_pack_write_file` writes the manifest + assets.
- Secrets (API keys / private URLs) go in `config_schema` as `kind: secret` →
  they land in the keychain, NEVER in a command, a manifest, or the chat.
- A data-backed pack gets a workspace of smart-tables (see the
  `vault-smart-tables` skill; build its base with `smart_table_base_scaffold`).

### E. Validate → smoke → distribute
- `mcp_pack_validate` (gate_tool_search) — EVALS FIRST; never ship a pack with
  errors (it returns the issues to fix).
- `mcp_pack_install` + `mcp_pack_run` — smoke a REAL call; copy its actual output
  into the pack's intro page (never invent output).
- `mcp_pack_publish` (gate_tool_search) — publish to the commons (optional,
  share-and-be-shared).

## Red lines
- **Research before manifest.** Never invent an API / endpoint — find the real one.
- Secrets only via `config_schema` (keychain); never inline, never to the LLM.
- Propose + confirm; never demand a spec or dump a questionnaire.
- The pack front end = CTRL endpoints (smart-tables / notes / html); zero bespoke
  UI code.
