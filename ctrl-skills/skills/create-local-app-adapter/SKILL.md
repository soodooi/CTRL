---
name: create-local-app-adapter
description: >
  Guide CTRL Coding through authoring a local application adapter: a focused MCP
  server pack that exposes one bounded capability of an application already
  installed on the user's machine. Covers backend discovery before bridging, the
  private-protocol boundary, the explicit-selection rule, the record_source
  contract that makes it queryable, and the six pieces of verification evidence
  an adapter needs before it may be called done.
version: 1.0.0
author: CTRL
metadata:
  hermes:
    tags: [ctrl, coding, local-app, adapter, mcp, connector, verification]
---

# Author a local application adapter

A local application adapter lets CTRL read from — and where explicitly accepted,
write to — an application the user already has installed. It is an ordinary
**MCP-server pack**, not a new runtime, Actor kind, or product surface. Every
public capability still enters through `MCPServerActor`/`McpHost`, the
authenticated `:17873` gate, intent visibility, permission, audit, and review.
(ADR-004 cap § execution v14)

Use this skill in CTRL Coding, where you have an isolated workspace and the
governed lifecycle tools. Load it with `skill_list` then `skill_read` before
planning or editing. Some lifecycle tools are outside the default tool list;
find them with `gate_tool_search` and invoke them through `gate_tool_call`.

Generated JSON or prose is not an adapter. An adapter exists when it is
installed and its public entrypoint has been exercised against the real
application.

## Hard boundaries

Read these before designing anything. Each one has cost a previous attempt real
rework.

1. **Discover before you bridge.** Inventory the application's existing native
   CLI, scripting or automation API, and any existing MCP implementation, in
   that order. Prefer a verified existing backend that satisfies the job. Writing
   a bridge for an application that already ships a CLI is wasted work and a
   second thing to maintain.
2. **The native protocol is private.** Raw commands, application protocols,
   credentials, and broad generated command catalogues are never projected to an
   agent. The agent sees your bounded tools, nothing else.
3. **One bounded job per pack.** A pack normally owns one focused MCP server
   which may expose several atomic tools. Do not build one adapter that claims
   an entire application.
4. **Operations are one-shot.** No REPL, no session, no workflow state inside the
   server. Durable multi-step composition belongs to a skill or Workbench.
5. **The application's files stay authoritative.** Adapter state can never
   become a second writable truth.
6. **Explicit selection only.** Read what the user deliberately selected — a
   selection, a range, a named document — never the whole workspace, and never
   by scraping. If there is no selection, that is a normal reportable state, not
   an error, and not a licence to widen the read.
7. **Degrade honestly.** When the application is closed, the extension is
   disabled, or the bridge is missing, fail closed and say which. Never return
   an empty result that reads like "nothing there".
8. **Writes are not free.** A write path needs its own accepted decision. Ship
   the read path first; do not add a write because it seemed easy.

## Lifecycle

### 1. Establish the job and the backend

State in one sentence what the user gets. Then research:

- `discover_packs` — does a pack or MCP server already do this? Prefer reuse.
- The application's own CLI / automation API / MCP server, in that order.
- Whether the application requires a user-installed extension. If it does, the
  extension is the user's boundary to install, not something CTRL silently
  places.

Record which backend you chose and why you rejected the others. That record is
part of the deliverable.

### 2. Author the pack

The pack is a directory with `manifest.json` plus your server implementation.
The server is a JavaScript/TypeScript stdio MCP child (the v1 runtime lock).

Minimum manifest shape for a queryable adapter:

```json
{
  "manifest_version": 2,
  "id": "ctrl-<app>",
  "name": "<App> Companion",
  "version": "0.1.0",
  "description": { "short": "Read the explicit <App> selection through CTRL's governed source interface." },
  "server": { "type": "local", "command": "node", "args": ["${PACK_DIR}/server.mjs"] },
  "capabilities": { "network": { "http": { "allowlist": ["http://127.0.0.1:*"], "methods": ["GET"] } } },
  "record_source": {
    "kind": "record",
    "query": { "mcp_tool": "read_selected_context", "array_at": "rows" },
    "operators": ["eq", "neq", "contains"],
    "unavailable_message": "Open <App>, make an explicit selection, then retry.",
    "fields": [
      { "key": "document_id", "label": "Document", "type": "text" },
      { "key": "selection_kind", "label": "Selection kind", "type": "text" },
      { "key": "target", "label": "Target", "type": "text" },
      { "key": "content", "label": "Selected content", "type": "text" },
      { "key": "revision", "label": "Revision", "type": "text" }
    ]
  }
}
```

Why `record_source` matters: it is what makes the adapter reachable through the
generic `source_describe` / `source_query` verbs. Without it you have a private
server nobody can query, and CTRL will not grow a bespoke surface for it.

Rules that bite:

- **Declare only loopback network** when your bridge talks to a local port. Any
  broader allowlist fails closed to no network at all.
- **`unavailable_message` is user-facing.** Write the sentence that tells the
  user what to do, not the one that describes your internals.
- **Identify what you read.** Return document identity and a revision or content
  hash with every row. Without them the user cannot tell whether an answer came
  from what they are looking at now.

### 3. Install and bring it up

Install through the governed lifecycle tool, not by copying files by hand. A
local-app adapter belongs in the bundled `optional/` set: it must never be
auto-seeded, because it bridges software the user may not have. It becomes live
only when the user explicitly connects it.

### 4. Verify — six pieces of evidence

An adapter is not accepted because a process exited zero. All six are required.
(ADR-004 cap § execution v14)

1. **The installed public entrypoint**, exercised as installed — not an internal
   import or a direct function call in your test file.
2. **A real-software end-to-end scenario**: the actual application open, an
   actual selection made, the actual bytes returned.
3. **An agent-only scenario** that uses nothing but the public skill and tool
   descriptions. If an agent cannot use it from the descriptions alone, the
   descriptions are wrong.
4. **Semantic verification of produced artifacts**, including reopen and
   read-back where the format permits. Comparing your own in-memory value proves
   nothing.
5. **A capability coverage inventory**, naming what is NOT implemented. An
   unlisted gap reads as a supported capability.
6. **Preview evidence labelled truthfully** as `none`, `structural`, `rendered`,
   or `live`. `live` is reserved for output demonstrably connected to current
   application state. Labelling structural output as live is a defect.

Also verify the honest-degradation paths, because they are what users actually
hit: application closed, extension disabled, nothing selected. Each must report
its own distinct state.

### 5. Report

Deliver: the chosen backend and the rejected alternatives, the pack, the six
evidence items, the coverage inventory with gaps, and the degradation results.
State plainly anything you could not verify. An unverified claim in this report
is worse than a missing feature, because it will be believed.
