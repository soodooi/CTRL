---
title: CTRL endpoint catalog (auto-generated)
kind: reference
generated_by: scripts/gen-endpoint-catalog.mjs
regenerate: node scripts/gen-endpoint-catalog.mjs
note: DO NOT hand-edit the tables — regenerate. Spec = ADR-002 section 14; this is the inventory.
related:
  - 002-substrate.md
  - "[[comms-interface-spec]]"
  - "[[capability-pack-map]]"
---

# CTRL endpoint catalog (auto-generated)

Derived **from the authoritative endpoint spec** `vault/ctrl/mcp-schema.json` (the
MCP `tools/list` JSON Schema, exported by `cargo run --bin dump_mcp_schema`) — NOT
by scraping source (ADR-010 section endpoint-spec v6). Contract spec = **ADR-002
section 14** (describe/query/produce). This file is the human-readable **inventory**;
the machine-readable spec is `mcp-schema.json`.

## Overview

- **97** MCP tools on the :17873 gate (the endpoints AI actually sees)
- **17** are on the section-14 three-verb contract; the other **80** are bespoke tools (not section-14 shaped)
- **34** writes (produce, through the review gate) / **63** reads
- **108** Tauri commands (the frontend RPC surface); **2** share an exact name with an MCP tool = dual-surface drift risk (P1, SC5 not done)

Honest takeaway: **the section-14 spec exists, but only smart-table fully migrated;
vault/notes is mostly the old bespoke `vault_*` tools; html/pdf and other envisioned
sources are not built.**

## Endpoints x module (MCP gate tools)

Legend: **s14** = three-verb contract face · bespoke = ad-hoc tool · **WRITE** = produce (gated) · read

### smart-table (16 endpoints, 9 s14)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `smart_table_add_field` | 5 | read | bespoke | Add a column to a smart table: key + label + type (text/number/date/checkbox/tags/select/url) + optional options for select/tags. Fails if the key already exists. |  |
| `smart_table_add_view` | 3 | read | s14 | Add a grid or kanban view to a smart table (persisted in frontmatter, not the table body). kanban requires group_by (a field key). |  |
| `smart_table_append_row` | 2 | **WRITE** | s14 | Append a row to a smart table (values keyed by field key). |  |
| `smart_table_batch_append_rows` | 2 | **WRITE** | bespoke | Append multiple rows to a smart table in one call (each row = values keyed by field key). Bitable batch-create parity. |  |
| `smart_table_batch_delete_rows` | 2 | **WRITE** | bespoke | Delete multiple rows from a smart table by zero-based indices in one call (out-of-range + duplicate indices ignored). Bitable batch-delete parity. |  |
| `smart_table_create` | 2 | **WRITE** | bespoke | Create a new smart table from a name + fields (each key/label/type[/options]). Seeds an empty table at tables/<slug>.md and returns its path. Then use smart_table_append_row to add data. |  |
| `smart_table_delete_field` | 2 | **WRITE** | bespoke | Delete a column from a smart table by schema key (drops it from the schema + every row). |  |
| `smart_table_delete_row` | 2 | **WRITE** | bespoke | Delete a row from a smart table by zero-based row index, then write it back. |  |
| `smart_table_describe` | 1 | read | s14 | Describe a smart table: its fields, types, and supported query operators. Call this before smart_table.query. |  |
| `smart_table_produce` | 2 | **WRITE** | bespoke | Write to a smart table with ONE unified produce verb. `op` is a tagged union: {kind:"set_cell",row,field,value} / {kind:"upsert_rows",rows:[{field:value}]} / {kind:"delete_rows",indices:[..]} / {kind:"add_field",key,label,type,options?,relation?} / {kind:"update_field",key,label?,type?,options?} / {kind:"delete_field",key}. relation = {kind:"reference"|"lookup"|"rollup",..} for relational columns. |  |
| `smart_table_query` | 6 | read | s14 | Query a smart table with a structured filter/sort/group request (not a query string). Call smart_table.describe first to learn valid fields. |  |
| `smart_table_run_ai_column` | 6 | **WRITE** | s14 | Run an AI field shortcut down a column: per row, classify/extract/summarize/translate/generate using {field} tokens, then write results into target_field. Cost-gated at 100 rows (pass confirm_over_gate=true to exceed). Skips already-filled cells unless force=true. |  |
| `smart_table_run_ai_column_cancel` | 1 | **WRITE** | s14 | Cancel an in-flight AI-column job by id (already-written cells are kept). |  |
| `smart_table_run_ai_column_start` | 6 | **WRITE** | s14 | Start an async AI field-shortcut job over a column (classify/extract/summarize/translate/generate, {field} tokens). Cost-gated at 100 rows. Returns a job_id; poll smart_table.run_ai_column_status. |  |
| `smart_table_run_ai_column_status` | 1 | read | s14 | Get the status of an AI-column job: phase, rows_done/total, rows_written, errors. |  |
| `smart_table_update_cell` | 4 | **WRITE** | s14 | Set one cell of a smart table by row index + field key, then write it back. |  |

### notes(s14) (2 endpoints, 2 s14)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `notes_describe` | 0 | read | s14 | Describe the knowledge base as a queryable RecordSource: fields (path/title/tags/created/modified) and supported operators. Call before notes.query. |  |
| `notes_query` | 6 | read | s14 | Query the knowledge base by tag/title/date with a structured filter/sort/group request (not a query string). Returns matching notes. Call notes.describe first. |  |

### providers(s14) (2 endpoints, 2 s14)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `providers_describe` | 0 | read | s14 | Describe the LLM provider catalogue as a queryable RecordSource (fields: id/label/kind/models/ready/capabilities). Call before providers.query. |  |
| `providers_query` | 5 | read | s14 | Query configured LLM providers by id/kind/ready/capabilities with a structured filter/sort/group request. Call providers.describe first. |  |

### registry(s14) (2 endpoints, 2 s14)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `registry_describe` | 0 | read | s14 | Describe the installed-MCP registry as a queryable RecordSource (fields: id/name/version/description/tools). Call before registry.query. |  |
| `registry_query` | 5 | read | s14 | Query installed MCP servers by id/name/tool-count with a structured filter/sort/group request. Call registry.describe first. |  |

### vault/notes (29 endpoints, 2 s14)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `vault_aliases` | 1 | read | bespoke | Read the frontmatter aliases list for a vault note |  |
| `vault_backlinks` | 1 | read | bespoke | Backlinks for a vault note (paths + snippets) |  |
| `vault_broken_links` | 0 | read | bespoke | List vault outgoing links that point at no existing note (broken links) |  |
| `vault_create_folder` | 1 | **WRITE** | bespoke | Create a vault subdirectory (mkdir -p semantics) |  |
| `vault_delete` | 1 | **WRITE** | bespoke | Delete a vault note (the file is removed; no soft-delete) |  |
| `vault_embed_note` | 1 | **WRITE** | bespoke | Embed a single vault note into the local embeddings index |  |
| `vault_embedding_status` | 0 | read | bespoke | Snapshot of the vault embedding index (available / total / embedded / stale) |  |
| `vault_graph_data` | 0 | read | bespoke | Return the entire vault link graph (nodes + edges) |  |
| `vault_list` | 1 | read | bespoke | List markdown files under a vault subdirectory (or vault root) |  |
| `vault_mentions` | 1 | read | bespoke | Find unlinked mentions of text across the vault (excludes [[wikilinked]] hits) |  |
| `vault_move` | 2 | **WRITE** | bespoke | Move a vault note to a new path (alias of vault.rename) |  |
| `vault_notes_by_tag` | 1 | read | bespoke | List notes tagged with a specific tag |  |
| `vault_orphans` | 0 | read | bespoke | List vault notes that no other note links to |  |
| `vault_read` | 1 | read | bespoke | Read a markdown file from the user's vault |  |
| `vault_rebuild_index` | 0 | **WRITE** | bespoke | Rebuild the FTS5 vault search index from disk (returns indexed file count) |  |
| `vault_reembed_all` | 1 | **WRITE** | bespoke | Re-embed all vault notes (bulk; respects content_hash unless force=true) |  |
| `vault_rename` | 2 | **WRITE** | bespoke | Rename a vault note to a new path (no inbound-link rewrite) |  |
| `vault_search` | 4 | read | bespoke | Full-text search the vault (FTS5 when available, substring fallback) |  |
| `vault_semantic_search` | 3 | read | bespoke | Semantic-similarity vault search (cosine over local embeddings) |  |
| `vault_set_starred` | 2 | **WRITE** | bespoke | Toggle the starred flag on a vault note's frontmatter |  |
| `vault_sourcing_pending` | 0 | read | bespoke | Count un-integrated items in the sourcing inbox |  |
| `vault_sourcing_run` | 1 | **WRITE** | bespoke | Run the kernel sourcing routine for the given YYYY-MM-DD date and write the review-queue file |  |
| `vault_suggest_links` | 2 | read | bespoke | Suggest related notes for a given path (embeddings-based autolink) |  |
| `vault_tags` | 0 | read | bespoke | List every tag in the vault with usage count (descending) |  |
| `vault_text_describe` | 0 | read | s14 | Describe the vault full-text source: source_kind=text; query content with a Contains filter whose value is the search needle. Call before vault_text_query. |  |
| `vault_text_query` | 2 | read | s14 | Full-text query the vault as a §14 source: pass a Contains filter (field 'content', value = search text); returns matching note paths. Call vault_text_describe first. |  |
| `vault_watch` | 2 | read | bespoke | Drain recent vault filesystem events since a millis cursor (lazy-starts watcher) |  |
| `vault_write` | 3 | **WRITE** | bespoke | Write a markdown file to the user's vault (creates parents) |  |
| `vault_write_image` | 4 | **WRITE** | bespoke | Write a binary image asset to the vault (optionally with sidecar .md frontmatter) | cmd too |

### memory (2 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `irisy_soul_get` | 0 | read | bespoke | Read the Irisy SOUL.md persistent memory (vault/irisy/SOUL.md) |  |
| `irisy_soul_set` | 2 | **WRITE** | bespoke | Write the Irisy SOUL.md persistent memory |  |

### kv (2 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `kv_get` | 2 | read | bespoke | Read a persistent key from per-mcp local storage |  |
| `kv_set` | 3 | **WRITE** | bespoke | Write a persistent key into per-mcp local storage |  |

### llm (1 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `llm_chat` | 4 | read | bespoke | Run a non-streaming LLM chat completion via the kernel's LLM port |  |

### net (2 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `http_get` | 3 | read | bespoke | HTTP GET request — fetch a URL and return status + body + headers |  |
| `http_post` | 4 | **WRITE** | bespoke | HTTP POST request — send JSON or text body and return status + body + headers |  |

### mcp-bus (12 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `mcp_list_servers` | 0 | read | bespoke | List external MCP servers the kernel has registered (proxy view) |  |
| `mcp_pack_install` | 3 | read | bespoke | Install a feature pack from its manifest (+ optional server code) |  |
| `mcp_pack_list` | 0 | read | bespoke | List installed feature packs (the user's own mcps), with id/name/actions |  |
| `mcp_pack_provision` | 1 | read | bespoke | Provision + auto-authenticate an installed feature pack from its manifest (one-click, silent): bring up its declared service and run bootstrap auth. Idempotent. Requires a container runtime for service packs. |  |
| `mcp_pack_publish` | 2 | **WRITE** | bespoke | Publish an installed feature pack to a registry/commons (share-and-be-shared). Evals the manifest first (never publishes a pack with errors — returns the issues to fix), then POSTs it. Returns the published reference {id,namespace,url}. |  |
| `mcp_pack_run` | 2 | **WRITE** | bespoke | Run a feature pack action (executes its shell steps, returns stdout) |  |
| `mcp_pack_scaffold` | 3 | read | bespoke | Draft a §14 record_source from an OpenAPI operation (a GET path returning a list). Returns { record_source, notes } — a best-effort draft (endpoint + array location + fields from the response schema) plus repair notes (auth/missing fields). Refine it, then mcp_pack_validate before install. |  |
| `mcp_pack_uninstall` | 1 | read | bespoke | Uninstall a feature pack by id (removes it from the user's installed packs) |  |
| `mcp_pack_validate` | 1 | read | bespoke | Evaluate a candidate feature-pack manifest BEFORE install: checks id/version, that it declares actions[] or a §14 record_source, and that any record_source is coherent (parses, has fields + a read endpoint, describe resolves). Returns { ok, issues[{field,severity,fix}] } to self-correct. Call before mcp_pack_install. |  |
| `mcp_pack_write_file` | 3 | **WRITE** | bespoke | Write a skill or asset file (e.g. skills/<name>/SKILL.md) into an installed feature pack |  |
| `mcp_proxy_call_tool` | 3 | read | bespoke | Invoke a tool on a downstream MCP server (kernel proxies the call) |  |
| `mcp_proxy_list_tools` | 1 | read | bespoke | List tools advertised by a downstream MCP server (kernel proxies the call) |  |

### system (2 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `kernel_status` | 0 | read | bespoke | Report kernel health: uptime, registered LLM adapters, MCP server count | cmd too |
| `vault_root_path` | 0 | read | bespoke | Return the absolute vault root path on disk |  |

### other (25 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `calendar_describe` | 0 | read | bespoke | Describe the calendar as a queryable RecordSource: fields (path/title/date/start/end/location/tags) and supported operators. Call before calendar_query. |  |
| `calendar_produce` | 1 | **WRITE** | bespoke | Write to the calendar with the unified produce verb. `op` (tagged by kind): {kind:"set_cell",row,field,value} edits one event field (title/date/start/end/location/tags) on the row-th event from calendar_query; {kind:"upsert_rows",rows:[{title,date,start?,end?,location?,tags?}]} creates event notes (date=YYYY-MM-DD); {kind:"delete_rows",indices:[..]} deletes event notes. Field ops are unsupported (fixed schema). |  |
| `calendar_query` | 5 | read | bespoke | Query calendar events by date/title/location/tags with a structured filter/sort/group request (e.g. date within:today / this_week). Returns matching events. Call calendar_describe first. |  |
| `discover_packs` | 2 | read | bespoke | Search the MCP Registry + Smithery (2000+ servers) for feature packs / MCP servers to reuse — returns merged, source-tagged listings (id, name, description, url, source). Pass `query` to search by keyword (e.g. "stock price"). Use this when building a feature pack, to find an existing server before authoring one. |  |
| `discover_skills` | 1 | read | bespoke | Search published skills (SKILL.md) on GitHub by keyword — returns repo / name / description / stars / url. Use this when building a feature pack, to find a reusable skill before writing one. Requires a GitHub token. |  |
| `doc_produce` | 2 | **WRITE** | bespoke | Edit one markdown note surgically with the unified produce verb. `op` (tagged by kind): {kind:"append_section",heading?,content} appends under the named heading (or end of doc when heading omitted); {kind:"replace_section",heading,content} replaces the body under a heading (heading kept); {kind:"delete_section",heading} removes a heading + its body incl. nested subsections; {kind:"set_frontmatter_key",key,value} / {kind:"delete_frontmatter_key",key} edit ONE top-level frontmatter key in place (other keys/comments byte-identical; set creates the block on a plain note). Heading match is case-insensitive on the text after #s; with duplicate headings the FIRST match wins. Call note_map first to see the headings. Prefer this over vault_write — it never rewrites the whole file. |  |
| `market_quote` | 1 | read | bespoke | Live stock/index quotes for tickers (Yahoo Finance, no key). Returns price, currency, and percent change vs previous close. Use Yahoo suffixes: .SS Shanghai, .SZ Shenzhen, .HK Hong Kong; US tickers bare; indices start with ^ (e.g. ^GSPC, ^IXIC, ^HSI). |  |
| `market_screen` | 2 | read | bespoke | Predefined stock screen (Yahoo Finance, no key). screen = day_gainers | day_losers | most_actives. Returns symbol, name, price, and percent change for the top movers. |  |
| `note_active_get` | 0 | read | bespoke | Which note the user is looking at RIGHT NOW in the CTRL workspace. Returns {path} or {path:null} when none is open. Follow with note_get(path) to read it or doc_produce(path,…) to edit it. |  |
| `note_get` | 1 | read | bespoke | Read a note with ALL its context in one call: content, frontmatter, tags, stat (mtime/size), outgoing links, and backlinks. Prefer this over vault_read when you also need the note's connections. |  |
| `note_map` | 1 | read | bespoke | Get a note's document map: headings (level/text/line, code fences excluded), ^block-id refs, and frontmatter keys. Call before doc_produce to pick a real heading anchor. |  |
| `note_open` | 2 | read | bespoke | Open a note in the CTRL workspace for the user (optionally scrolled to a heading). Validates the path exists first. Returns whether a UI was listening. |  |
| `note_periodic` | 3 | read | bespoke | Resolve the periodic note for a date: period=daily/weekly/monthly/quarterly/yearly, date=YYYY-MM-DD (default today). Returns {path, exists, content?, frontmatter?}; create=true seeds it (journal frontmatter) when missing. Use with doc_produce to append to today's daily note. |  |
| `note_recent_changes` | 2 | read | bespoke | List the most recently modified notes: [{path, mtime_ms}] sorted newest first. Optional days cutoff. Answers "what did I work on recently". |  |
| `skill_list` | 1 | read | bespoke | List the user's local installed skills (name + description + path), optional keyword filter |  |
| `skill_read` | 1 | read | bespoke | Read a local skill's SKILL.md content by its path (from skill_list) |  |
| `source_describe` | 1 | read | bespoke | Describe an installed connector's queryable records by source_id: fields + operators, read from its manifest record_source. Works for any connector. Call before source_query. |  |
| `source_produce` | 2 | **WRITE** | bespoke | Record data into an installed connector by source_id (a write): pass an input object whose keys match the source's produce fields. POSTs to the manifest-declared endpoint and returns the created resource. |  |
| `source_query` | 6 | read | bespoke | Query an installed connector's records by source_id with a structured filter/sort/group request (not a query string). Fetches the self-hosted instance live from its manifest. Call source_describe first. |  |
| `task_create` | 4 | **WRITE** | bespoke | Create a LifeOS task: append a `- [ ]` checkbox line with `title` (required), optional `due` (YYYY-MM-DD) and `tags`, to `note` (default: today's daily note). Returns the note path. |  |
| `task_describe` | 0 | read | bespoke | Describe the LifeOS tasks source as a queryable RecordSource: fields (path/title/status/due/priority/tags/created/modified) and supported operators. Call before task_query. |  |
| `task_produce` | 1 | **WRITE** | bespoke | Write to LifeOS tasks with the unified produce verb. `op` (tagged by kind): {kind:"set_cell",row,field,value} sets status/due/title/tags on the row-th task from task_query; {kind:"upsert_rows",rows:[{title,path?,due?,tags?}]} creates tasks (path = target note, default today's daily); {kind:"delete_rows",indices:[..]} removes checkbox lines. add/update/delete_field are unsupported (fixed schema). |  |
| `task_query` | 6 | read | bespoke | Query LifeOS tasks by status/due/priority/tags with a structured filter/sort/group request (not a query string). Returns matching tasks. Call task_describe first. |  |
| `task_update` | 4 | **WRITE** | bespoke | Update one field of a LifeOS task by note + line (from task_query): field='status' value='done' completes it; also due/title/tags. Rewrites the checkbox line in place. |  |
| `web_search` | 2 | read | bespoke | Search the web and return titles + URLs + snippets. Uses a BYOK keyed provider if one is configured (Tavily / Brave / Serper / Exa), else a keyless full-web fallback (DuckDuckGo, then Wikipedia). Use this for facts / news / research you don't already hold. |  |

## Dual-surface evidence — Tauri commands per module (108 total)

Many capabilities are BOTH an MCP tool and a Tauri command = the P1 drift risk ADR-010 diagnosed. SC5 (collapse the dual surface) is not done.

| commands module | count |
|---|---|
| `commands/kernel.rs` | 13 |
| `commands/system.rs` | 10 |
| `commands/storage.rs` | 10 |
| `commands/agents.rs` | 9 |
| `commands/draft.rs` | 6 |
| `commands/code_space.rs` | 6 |
| `commands/vault.rs` | 6 |
| `commands/git.rs` | 6 |
| `commands/provider.rs` | 5 |
| `commands/config.rs` | 4 |
| `commands/workshop.rs` | 4 |
| `commands/memory.rs` | 3 |
| `commands/keychain.rs` | 3 |
| `commands/irisy_synth.rs` | 3 |
| `commands/hermes_acp.rs` | 2 |
| `commands/review.rs` | 2 |
| `commands/provider_templates.rs` | 2 |
| `commands/provider_models.rs` | 2 |
| `commands/skills.rs` | 2 |
| `commands/gate.rs` | 1 |
| `commands/pack_registry.rs` | 1 |
| `commands/chat.rs` | 1 |
| `commands/irisy_chat.rs` | 1 |
| `commands/image.rs` | 1 |
| `commands/screenshot.rs` | 1 |
| `commands/irisy.rs` | 1 |
| `commands/updater.rs` | 1 |
| `commands/event_stream.rs` | 1 |
| `commands/draft_run.rs` | 1 |

## Section-14 contract coverage (spec vs built)

| module | s14 describe | s14 query | s14 produce | note |
|---|---|---|---|---|
| **smart-table** | yes | yes | yes (append_row/update_cell) | only full section-14 impl |
| **notes** | yes | yes | no | read contract; writes still go through bespoke `vault_*` |
| **providers** | yes | yes | — | read-only runtime registry |
| **registry** (installed mcp) | yes | yes | — | read-only runtime registry |
| **vault/Obsidian** | no | no | no | ~27 bespoke `vault_*` (read/write/search…); Obsidian REST MCP endpoints spec'd in ADR-002 section 1.9.1, connector not fully built |
| **hermes** | — | — | — | a brain, not a data source; its interface is the ACP single door — it *consumes* endpoints, it is not queried |
| **html / pdf / blob** | no | no | no | envisioned section-14 sources, NOT built |

## Gaps this catalog exposes
1. **Section-14 is one module deep** (smart-table); notes is half (no produce), vault/Obsidian/html/pdf not migrated or not built.
2. **Dual surface not collapsed** (2 MCP tools share a name with a Tauri command) = SC5 not done.
3. **No versioned external endpoint contract** (section 14.10 version negotiation is spec'd, gate routing not implemented).

Convergence path = make section-14 cover everything (migrate `vault_*` etc. into
describe/query/produce) + SC5 collapse the dual surface. **Interface reaches
production grade when those two are done.**
