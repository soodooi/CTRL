---
title: CTRL endpoint catalog (auto-generated)
kind: generated-view
generated_by: scripts/gen-endpoint-catalog.mjs
regenerate: node scripts/gen-implementation-inventory.mjs --check && node scripts/gen-endpoint-catalog.mjs
note: Human-readable view only. Metrics and ceilings live in implementation-inventory.json; architecture authority remains the owning ADR.
related:
  - "[[002-substrate]]"
  - "[[010-communication]]"
  - "[[mcp-schema.json]]"
  - "[[generated/implementation-inventory.json]]"
---

# CTRL endpoint catalog (auto-generated)

This navigation view combines endpoint descriptions from `vault/ctrl/mcp-schema.json`
with identities and counts from `vault/ctrl/generated/implementation-inventory.json`.
It defines no metric, baseline, contract face, or architectural status
(ADR-010 communication § endpoint-spec v14).

## Overview

- **109** registered static MCP tools (ceiling 109, target null)
- **140** registered Tauri commands (ceiling 140)
- **2** exact-name MCP/Tauri overlaps (ceiling 2, target 0)
- **4** exact-or-explicit semantic MCP/Tauri overlaps (ceiling 4, target 0)

Semantic equivalents with different names enter the inventory only through explicit
`ctrl-inventory: semantic-dual=<gate-tool>` annotations; no name heuristic invents them.
The read/write labels below are navigation heuristics and are not governance decisions.

## calendar (3)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `calendar_describe` | 0 | probable read | Describe the calendar as a queryable RecordSource: fields (path/title/date/start/end/location/tags) and supported operators. Call before calendar_query. |  |
| `calendar_produce` | 1 | probable write | Write to the calendar with the unified produce verb. `op` (tagged by kind): {kind:"set_cell",row,field,value} edits one event field (title/date/start/end/location/tags) on the row-th event from calendar_query; {kind:"upsert_rows",rows:[{title,date,start?,end?,location?,tags?}]} creates event notes (date=YYYY-MM-DD); {kind:"delete_rows",indices:[..]} deletes event notes. Field ops are unsupported (fixed schema). |  |
| `calendar_query` | 5 | probable read | Query calendar events by date/title/location/tags with a structured filter/sort/group request (e.g. date within:today / this_week). Returns matching events. Call calendar_describe first. |  |

## discovery (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `discover_packs` | 2 | probable read | Search the MCP Registry + Smithery (2000+ servers) for feature packs / MCP servers to reuse — returns merged, source-tagged listings (id, name, description, url, source). Pass `query` to search by keyword (e.g. "stock price"). Use this when building a feature pack, to find an existing server before authoring one. |  |
| `discover_skills` | 1 | probable read | Search published skills (SKILL.md) on GitHub by keyword — returns repo / name / description / stars / url. Use this when building a feature pack, to find a reusable skill before writing one. Requires a GitHub token. |  |

## kv (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `kv_get` | 2 | probable read | Read a persistent key from per-mcp local storage |  |
| `kv_set` | 3 | probable write | Write a persistent key into per-mcp local storage |  |

## llm (1)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `llm_chat` | 4 | probable read | Run a non-streaming LLM chat completion via the kernel's LLM port |  |

## market (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `market_quote` | 1 | probable read | Live stock/index quotes for tickers (Yahoo Finance, no key). Returns price, currency, and percent change vs previous close. Use Yahoo suffixes: .SS Shanghai, .SZ Shenzhen, .HK Hong Kong; US tickers bare; indices start with ^ (e.g. ^GSPC, ^IXIC, ^HSI). |  |
| `market_screen` | 2 | probable read | Predefined stock screen (Yahoo Finance, no key). screen = day_gainers \| day_losers \| most_actives. Returns symbol, name, price, and percent change for the top movers. |  |

## mcp-bus (12)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `mcp_list_servers` | 0 | probable read | List external MCP servers the kernel has registered (proxy view) |  |
| `mcp_pack_install` | 3 | probable write | Install a feature pack from its manifest (+ optional server code) |  |
| `mcp_pack_list` | 0 | probable read | List installed feature packs (the user's own mcps), with id/name/actions |  |
| `mcp_pack_provision` | 1 | probable write | Provision + auto-authenticate an installed feature pack from its manifest (one-click, silent): bring up its declared service and run bootstrap auth. Idempotent. Requires a container runtime for service packs. |  |
| `mcp_pack_publish` | 2 | probable write | Publish an installed feature pack to a registry/commons (share-and-be-shared). Evals the manifest first (never publishes a pack with errors — returns the issues to fix), then POSTs it. Returns the published reference {id,namespace,url}. |  |
| `mcp_pack_run` | 2 | probable write | Run a feature pack action (executes its shell steps, returns stdout) |  |
| `mcp_pack_scaffold` | 3 | probable read | Draft a §14 record_source from an OpenAPI operation (a GET path returning a list). Returns { record_source, notes } — a best-effort draft (endpoint + array location + fields from the response schema) plus repair notes (auth/missing fields). Refine it, then mcp_pack_validate before install. |  |
| `mcp_pack_uninstall` | 1 | probable write | Uninstall a feature pack by id (removes it from the user's installed packs) |  |
| `mcp_pack_validate` | 1 | probable read | Evaluate a candidate feature-pack manifest BEFORE install: checks id/version, that it declares a local server, actions[], or a §14 record_source, and that any record_source is coherent (parses, has fields + a read endpoint, describe resolves). Returns { ok, issues[{field,severity,fix}] } to self-correct. Call before mcp_pack_install. |  |
| `mcp_pack_write_file` | 3 | probable write | Write a skill or asset file (e.g. skills/<name>/SKILL.md) into an installed feature pack |  |
| `mcp_proxy_call_tool` | 3 | probable read | Invoke a tool on a downstream MCP server (kernel proxies the call) |  |
| `mcp_proxy_list_tools` | 1 | probable read | List tools advertised by a downstream MCP server (kernel proxies the call) |  |

## memory (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `irisy_soul_get` | 0 | probable read | Read the Irisy SOUL.md persistent memory (vault/irisy/SOUL.md) |  |
| `irisy_soul_set` | 2 | probable write | Write the Irisy SOUL.md persistent memory |  |

## network (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `http_get` | 3 | probable read | HTTP GET request — fetch a URL and return status + body + headers |  |
| `http_post` | 4 | probable write | HTTP POST request — send JSON or text body and return status + body + headers |  |

## notes (11)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `doc_produce` | 2 | probable write | Edit one markdown note surgically with the unified produce verb. `op` (tagged by kind): {kind:"append_section",heading?,content} appends under the named heading (or end of doc when heading omitted); {kind:"replace_section",heading,content} replaces the body under a heading (heading kept); {kind:"delete_section",heading} removes a heading + its body incl. nested subsections; {kind:"set_frontmatter_key",key,value} / {kind:"delete_frontmatter_key",key} edit ONE top-level frontmatter key in place (other keys/comments byte-identical; set creates the block on a plain note). Heading match is case-insensitive on the text after #s; with duplicate headings the FIRST match wins. Call note_map first to see the headings. Prefer this over vault_write — it never rewrites the whole file. |  |
| `note_active_get` | 0 | probable read | Which note the user is looking at RIGHT NOW in the CTRL workspace. Returns {path} or {path:null} when none is open. Follow with note_get(path) to read it or doc_produce(path,…) to edit it. |  |
| `note_diff` | 2 | probable read | The unified diff a commit (hex rev from note_history) made to a note. Use to inspect exactly what an AI edit changed. |  |
| `note_get` | 1 | probable read | Read a note with ALL its context in one call: content, frontmatter, tags, stat (mtime/size), outgoing links, and backlinks. Prefer this over vault_read when you also need the note's connections. |  |
| `note_history` | 2 | probable read | Per-note git history: [{rev, author, time, message}] newest first (follows renames). Author "user" = the human's edits; agent names (irisy/claude-code/…) = AI edits. Empty when the vault has no git repo. |  |
| `note_map` | 1 | probable read | Get a note's document map: headings (level/text/line, code fences excluded), ^block-id refs, and frontmatter keys. Call before doc_produce to pick a real heading anchor. |  |
| `note_open` | 2 | probable read | Open a note in the CTRL workspace for the user (optionally scrolled to a heading). Validates the path exists first. Returns whether a UI was listening. |  |
| `note_periodic` | 3 | probable read | Resolve the periodic note for a date: period=daily/weekly/monthly/quarterly/yearly, date=YYYY-MM-DD (default today). Returns {path, exists, content?, frontmatter?}; create=true seeds it (journal frontmatter) when missing. Use with doc_produce to append to today's daily note. |  |
| `note_recent_changes` | 2 | probable read | List the most recently modified notes: [{path, mtime_ms}] sorted newest first. Optional days cutoff. Answers "what did I work on recently". |  |
| `notes_describe` | 0 | probable read | Describe the knowledge base as a queryable RecordSource: fields (path/title/tags/created/modified) and supported operators. Call before notes.query. |  |
| `notes_query` | 6 | probable read | Query the knowledge base by tag/title/date with a structured filter/sort/group request (not a query string). Returns matching notes. Call notes.describe first. |  |

## other (9)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `describe` | 1 | probable read | Describe one canonical CTRL ResourceRef. Returns its content type, revision, presentation, and descriptor-owned query/produce schemas. |  |
| `diagnostics_smoke` | 1 | probable read | Run a non-mutating metadata-only smoke probe for Irisy, Coding, or Notes. Never sends a prompt, spawns a process, starts a watcher, or rebuilds an index. |  |
| `diagnostics_status` | 1 | probable read | Read metadata-only health for Irisy, Coding, or Notes. Does not start, stop, or rebuild any owner. |  |
| `diagnostics_trace` | 3 | probable read | Read a bounded metadata-only lifecycle timeline for Irisy, Coding, or Notes, optionally filtered by correlation_id. Raw prompts, tool data, PTY I/O, note bodies, secrets, and absolute paths are never returned. |  |
| `gate_tool_call` | 2 | probable read | Call ANY gate tool by name, including tools not in your visible list. `name` = the tool name (find it with gate_tool_search), `args` = its arguments object. Same permissions + audit as a direct call. |  |
| `gate_tool_search` | 2 | probable read | Search ALL gate tools (~100) by keyword — your default list is only a subset. Returns matching tools with name + description + input schema. Use when you need a capability that is not in your visible tools (editing a note surgically, AI columns, connectors, scaffolding/validating/publishing a feature pack, calling an installed MCP). Then invoke the match with gate_tool_call. |  |
| `produce` | 2 | probable write | Mutate or act on one canonical CTRL ResourceRef. Call describe first; operation must match an advertised schema. Every supported call passes through ReviewGate. |  |
| `query` | 2 | probable read | Read one canonical CTRL ResourceRef. Call describe first; request must match the descriptor-owned query schema. Query is always side-effect-free. |  |
| `web_search` | 2 | probable read | Search the web and return titles + URLs + snippets. Uses a BYOK keyed provider if one is configured (Tavily / Brave / Serper / Exa), else a keyless full-web fallback (DuckDuckGo, then Wikipedia). Use this for facts / news / research you don't already hold. |  |

## providers (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `providers_describe` | 0 | probable read | Describe the LLM provider catalogue as a queryable RecordSource (fields: id/label/kind/models/configured/runtime_status/verified/active_roles/capabilities). Call before providers.query. |  |
| `providers_query` | 5 | probable read | Query configured LLM providers by id/kind/configured/runtime_status/verified/active_roles/capabilities with a structured filter/sort/group request. Call providers.describe first. |  |

## registry (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `registry_describe` | 0 | probable read | Describe the installed-MCP registry as a queryable RecordSource (fields: id/name/version/description/tools). Call before registry.query. |  |
| `registry_query` | 5 | probable read | Query installed MCP servers by id/name/tool-count with a structured filter/sort/group request. Call registry.describe first. |  |

## skills (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `skill_list` | 1 | probable read | List the user's local installed skills (name + description + path), optional keyword filter |  |
| `skill_read` | 1 | probable read | Read a local skill's SKILL.md content by its path (from skill_list) |  |

## smart-table (17)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `smart_table_add_field` | 5 | probable read | Add a column to a smart table: key + label + type (text/number/date/checkbox/tags/select/url) + optional options for select/tags. Fails if the key already exists. |  |
| `smart_table_add_view` | 3 | probable read | Add a grid or kanban view to a smart table (persisted in frontmatter, not the table body). kanban requires group_by (a field key). |  |
| `smart_table_append_row` | 2 | probable write | Append a row to a smart table (values keyed by field key). |  |
| `smart_table_base_scaffold` | 2 | probable read | Build a whole multi-sheet BASE (Bitable) in one call from a spec: base_name + tables[{name, fields[{key,label,type,options?, link_to?, display?}]}]. A field with link_to=<another table's name> becomes a REFERENCE (link) column wiring that relation. Creates tables/<base>/<slug>.md per table + a _base.md manifest. Use this to build a whole related-table base from a user's description in one shot; then smart_table_append_row / batch_append_rows to seed data. |  |
| `smart_table_batch_append_rows` | 2 | probable write | Append multiple rows to a smart table in one call (each row = values keyed by field key). Bitable batch-create parity. |  |
| `smart_table_batch_delete_rows` | 2 | probable write | Delete multiple rows from a smart table by zero-based indices in one call (out-of-range + duplicate indices ignored). Bitable batch-delete parity. |  |
| `smart_table_create` | 2 | probable write | Create a new smart table from a name + fields (each key/label/type[/options]). Seeds an empty table at tables/<slug>.md and returns its path. Then use smart_table_append_row to add data. |  |
| `smart_table_delete_field` | 2 | probable write | Delete a column from a smart table by schema key (drops it from the schema + every row). |  |
| `smart_table_delete_row` | 2 | probable write | Delete a row from a smart table by zero-based row index, then write it back. |  |
| `smart_table_describe` | 1 | probable read | Describe a smart table: its fields, types, and supported query operators. Call this before smart_table.query. |  |
| `smart_table_produce` | 2 | probable write | Write to a smart table with ONE unified produce verb. `op` is a tagged union: {kind:"set_cell",row,field,value} / {kind:"upsert_rows",rows:[{field:value}]} / {kind:"delete_rows",indices:[..]} / {kind:"add_field",key,label,type,options?,relation?} / {kind:"update_field",key,label?,type?,options?} / {kind:"delete_field",key}. relation = {kind:"reference"\|"lookup"\|"rollup",..} for relational columns. |  |
| `smart_table_query` | 6 | probable read | Query a smart table with a structured filter/sort/group request (not a query string). Call smart_table.describe first to learn valid fields. |  |
| `smart_table_run_ai_column` | 6 | probable write | Run an AI field shortcut down a column: per row, classify/extract/summarize/translate/generate using {field} tokens, then write results into target_field. Cost-gated at 100 rows (pass confirm_over_gate=true to exceed). Skips already-filled cells unless force=true. |  |
| `smart_table_run_ai_column_cancel` | 1 | probable write | Cancel an in-flight AI-column job by id (already-written cells are kept). |  |
| `smart_table_run_ai_column_start` | 6 | probable write | Start an async AI field-shortcut job over a column (classify/extract/summarize/translate/generate, {field} tokens). Cost-gated at 100 rows. Returns a job_id; poll smart_table.run_ai_column_status. |  |
| `smart_table_run_ai_column_status` | 1 | probable write | Get the status of an AI-column job: phase, rows_done/total, rows_written, errors. |  |
| `smart_table_update_cell` | 4 | probable write | Set one cell of a smart table by row index + field key, then write it back. |  |

## sources (3)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `source_describe` | 1 | probable read | Describe an installed connector's queryable records by source_id: fields + operators, read from its manifest record_source. Works for any connector. Call before source_query. |  |
| `source_produce` | 2 | probable write | Record data into an installed connector by source_id (a write): pass an input object whose keys match the source's produce fields. POSTs to the manifest-declared endpoint and returns the created resource. |  |
| `source_query` | 6 | probable read | Query an installed connector's records by source_id with a structured filter/sort/group request (not a query string). Reads the source live through its declared HTTP or private local MCP transport. Call source_describe first. |  |

## system (2)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `kernel_status` | 0 | probable read | Report kernel health: uptime, registered LLM adapters, MCP server count | yes |
| `vault_root_path` | 0 | probable read | Return the absolute vault root path on disk |  |

## tasks (5)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `task_create` | 4 | probable write | Create a LifeOS task: append a `- [ ]` checkbox line with `title` (required), optional `due` (YYYY-MM-DD) and `tags`, to `note` (default: today's daily note). Returns the note path. |  |
| `task_describe` | 0 | probable read | Describe the LifeOS tasks source as a queryable RecordSource: fields (path/title/status/due/priority/tags/created/modified) and supported operators. Call before task_query. |  |
| `task_produce` | 1 | probable write | Write to LifeOS tasks with the unified produce verb. `op` (tagged by kind): {kind:"set_cell",row,field,value} sets status/due/title/tags on the row-th task from task_query; {kind:"upsert_rows",rows:[{title,path?,due?,tags?}]} creates tasks (path = target note, default today's daily); {kind:"delete_rows",indices:[..]} removes checkbox lines. add/update/delete_field are unsupported (fixed schema). |  |
| `task_query` | 6 | probable read | Query LifeOS tasks by status/due/priority/tags with a structured filter/sort/group request (not a query string). Returns matching tasks. Call task_describe first. |  |
| `task_update` | 4 | probable write | Update one field of a LifeOS task by note + line (from task_query): field='status' value='done' completes it; also due/title/tags. Rewrites the checkbox line in place. |  |

## vault (30)

| endpoint | params | access heuristic | description | exact dual? |
|---|---:|---|---|---|
| `vault_aliases` | 1 | probable read | Read the frontmatter aliases list for a vault note |  |
| `vault_backlinks` | 1 | probable read | Backlinks for a vault note (paths + snippets) |  |
| `vault_broken_links` | 0 | probable read | List vault outgoing links that point at no existing note (broken links) |  |
| `vault_create_folder` | 1 | probable write | Create a vault subdirectory (mkdir -p semantics) |  |
| `vault_delete` | 1 | probable write | Delete a vault note (the file is removed; no soft-delete) |  |
| `vault_embed_note` | 1 | probable write | Embed a single vault note into the local embeddings index |  |
| `vault_embedding_status` | 0 | probable write | Snapshot of the vault embedding index (available / total / embedded / stale) |  |
| `vault_graph_data` | 0 | probable read | Return the entire vault link graph (nodes + edges) |  |
| `vault_list` | 1 | probable read | List markdown files under a vault subdirectory (or vault root) |  |
| `vault_mentions` | 1 | probable read | Find unlinked mentions of text across the vault (excludes [[wikilinked]] hits) |  |
| `vault_move` | 2 | probable write | Move a vault note to a new path (alias of vault.rename) |  |
| `vault_notes_by_tag` | 1 | probable read | List notes tagged with a specific tag |  |
| `vault_orphans` | 0 | probable read | List vault notes that no other note links to |  |
| `vault_pulse` | 1 | probable read | Vault activity pulse: per-day commit counts for the last N days (default 14) split user vs agents, plus the 20 most recent commits. Answers "what happened in my vault this week". |  |
| `vault_read` | 1 | probable read | Read a markdown file from the user's vault |  |
| `vault_rebuild_index` | 0 | probable write | Rebuild the FTS5 vault search index from disk (returns indexed file count) |  |
| `vault_reembed_all` | 1 | probable write | Re-embed all vault notes (bulk; respects content_hash unless force=true) |  |
| `vault_rename` | 2 | probable write | Rename a vault note to a new path (no inbound-link rewrite) |  |
| `vault_search` | 4 | probable read | Full-text search the vault (FTS5 when available, substring fallback) |  |
| `vault_semantic_search` | 3 | probable read | Semantic-similarity vault search (cosine over local embeddings) |  |
| `vault_set_starred` | 2 | probable write | Toggle the starred flag on a vault note's frontmatter |  |
| `vault_sourcing_pending` | 0 | probable read | Count un-integrated items in the sourcing inbox |  |
| `vault_sourcing_run` | 1 | probable write | Run the kernel sourcing routine for the given YYYY-MM-DD date and write the review-queue file |  |
| `vault_suggest_links` | 2 | probable read | Suggest related notes for a given path (embeddings-based autolink) |  |
| `vault_tags` | 0 | probable read | List every tag in the vault with usage count (descending) |  |
| `vault_text_describe` | 0 | probable read | Describe the vault full-text source: source_kind=text; query content with a Contains filter whose value is the search needle. Call before vault_text_query. |  |
| `vault_text_query` | 2 | probable read | Full-text query the vault as a §14 source: pass a Contains filter (field 'content', value = search text); returns matching note paths. Call vault_text_describe first. |  |
| `vault_watch` | 2 | probable read | Drain recent vault filesystem events since a millis cursor (lazy-starts watcher) |  |
| `vault_write` | 3 | probable write | Write a markdown file to the user's vault (creates parents) |  |
| `vault_write_image` | 4 | probable write | Write a binary image asset to the vault (optionally with sidecar .md frontmatter) | yes |

## Tauri command registration by module (140)

| commands module | count |
|---|---:|
| `commands/notes_ui.rs` | 40 |
| `commands/kernel.rs` | 16 |
| `commands/system.rs` | 13 |
| `commands/storage.rs` | 10 |
| `commands/diagnostics.rs` | 6 |
| `commands/git.rs` | 6 |
| `commands/provider.rs` | 6 |
| `commands/vault.rs` | 6 |
| `commands/config.rs` | 4 |
| `commands/notes_ui_scan.rs` | 4 |
| `commands/coding_launcher.rs` | 3 |
| `commands/keychain.rs` | 3 |
| `commands/memory.rs` | 3 |
| `commands/irisy_chat.rs` | 2 |
| `commands/provider_models.rs` | 2 |
| `commands/provider_templates.rs` | 2 |
| `commands/review.rs` | 2 |
| `commands/skills.rs` | 2 |
| `commands/updater.rs` | 2 |
| `commands/chat.rs` | 1 |
| `commands/chat_attachment.rs` | 1 |
| `commands/event_stream.rs` | 1 |
| `commands/gate.rs` | 1 |
| `commands/image.rs` | 1 |
| `commands/irisy.rs` | 1 |
| `commands/pack_registry.rs` | 1 |
| `commands/screenshot.rs` | 1 |

## Generation boundaries

- Endpoint names, descriptions, and input schemas come from `vault/ctrl/mcp-schema.json`.
- Counts, registered command identities, exact overlaps, ceilings, and targets come only from `vault/ctrl/generated/implementation-inventory.json`.
- Module and probable-access labels are view-only heuristics.
- Accepted decisions and migration status live only in the owning ADRs.
