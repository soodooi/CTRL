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

- **56** MCP tools on the :17873 gate (the endpoints AI actually sees)
- **17** are on the section-14 three-verb contract; the other **39** are bespoke tools (not section-14 shaped)
- **19** writes (produce, through the review gate) / **37** reads
- **135** Tauri commands (the frontend RPC surface); **31** share an exact name with an MCP tool = dual-surface drift risk (P1, SC5 not done)

Honest takeaway: **the section-14 spec exists, but only smart-table fully migrated;
vault/notes is mostly the old bespoke `vault_*` tools; html/pdf and other envisioned
sources are not built.**

## Endpoints x module (MCP gate tools)

Legend: **s14** = three-verb contract face · bespoke = ad-hoc tool · **WRITE** = produce (gated) · read

### smart-table (9 endpoints, 9 s14)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `smart_table_add_view` | 3 | read | s14 | Add a grid or kanban view to a smart table (persisted in frontmatter, not the table body). kanban requires group_by (a field key). |  |
| `smart_table_append_row` | 2 | **WRITE** | s14 | Append a row to a smart table (values keyed by field key). |  |
| `smart_table_describe` | 1 | read | s14 | Describe a smart table: its fields, types, and supported query operators. Call this before smart_table.query. | cmd too |
| `smart_table_query` | 6 | read | s14 | Query a smart table with a structured filter/sort/group request (not a query string). Call smart_table.describe first to learn valid fields. | cmd too |
| `smart_table_run_ai_column` | 6 | **WRITE** | s14 | Run an AI field shortcut down a column: per row, classify/extract/summarize/translate/generate using {field} tokens, then write results into target_field. Cost-gated at 100 rows (pass confirm_over_gate=true to exceed). Skips already-filled cells unless force=true. | cmd too |
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
| `vault_aliases` | 1 | read | bespoke | Read the frontmatter aliases list for a vault note | cmd too |
| `vault_backlinks` | 1 | read | bespoke | Backlinks for a vault note (paths + snippets) | cmd too |
| `vault_broken_links` | 0 | read | bespoke | List vault outgoing links that point at no existing note (broken links) | cmd too |
| `vault_create_folder` | 1 | **WRITE** | bespoke | Create a vault subdirectory (mkdir -p semantics) | cmd too |
| `vault_delete` | 1 | **WRITE** | bespoke | Delete a vault note (the file is removed; no soft-delete) | cmd too |
| `vault_embed_note` | 1 | **WRITE** | bespoke | Embed a single vault note into the local embeddings index | cmd too |
| `vault_embedding_status` | 0 | read | bespoke | Snapshot of the vault embedding index (available / total / embedded / stale) | cmd too |
| `vault_graph_data` | 0 | read | bespoke | Return the entire vault link graph (nodes + edges) | cmd too |
| `vault_list` | 1 | read | bespoke | List markdown files under a vault subdirectory (or vault root) | cmd too |
| `vault_mentions` | 1 | read | bespoke | Find unlinked mentions of text across the vault (excludes [[wikilinked]] hits) | cmd too |
| `vault_move` | 2 | **WRITE** | bespoke | Move a vault note to a new path (alias of vault.rename) | cmd too |
| `vault_notes_by_tag` | 1 | read | bespoke | List notes tagged with a specific tag | cmd too |
| `vault_orphans` | 0 | read | bespoke | List vault notes that no other note links to | cmd too |
| `vault_read` | 1 | read | bespoke | Read a markdown file from the user's vault | cmd too |
| `vault_rebuild_index` | 0 | **WRITE** | bespoke | Rebuild the FTS5 vault search index from disk (returns indexed file count) | cmd too |
| `vault_reembed_all` | 1 | **WRITE** | bespoke | Re-embed all vault notes (bulk; respects content_hash unless force=true) | cmd too |
| `vault_rename` | 2 | **WRITE** | bespoke | Rename a vault note to a new path (no inbound-link rewrite) | cmd too |
| `vault_search` | 2 | read | bespoke | Full-text search the vault (FTS5 when available, substring fallback) | cmd too |
| `vault_semantic_search` | 3 | read | bespoke | Semantic-similarity vault search (cosine over local embeddings) | cmd too |
| `vault_set_starred` | 2 | **WRITE** | bespoke | Toggle the starred flag on a vault note's frontmatter | cmd too |
| `vault_sourcing_pending` | 0 | read | bespoke | Count un-integrated items in the sourcing inbox | cmd too |
| `vault_sourcing_run` | 1 | **WRITE** | bespoke | Run the kernel sourcing routine for the given YYYY-MM-DD date and write the review-queue file | cmd too |
| `vault_suggest_links` | 2 | read | bespoke | Suggest related notes for a given path (embeddings-based autolink) | cmd too |
| `vault_tags` | 0 | read | bespoke | List every tag in the vault with usage count (descending) | cmd too |
| `vault_text_describe` | 0 | read | s14 | Describe the vault full-text source: source_kind=text; query content with a Contains filter whose value is the search needle. Call before vault_text_query. |  |
| `vault_text_query` | 2 | read | s14 | Full-text query the vault as a §14 source: pass a Contains filter (field 'content', value = search text); returns matching note paths. Call vault_text_describe first. |  |
| `vault_watch` | 2 | read | bespoke | Drain recent vault filesystem events since a millis cursor (lazy-starts watcher) |  |
| `vault_write` | 3 | **WRITE** | bespoke | Write a markdown file to the user's vault (creates parents) | cmd too |
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

### mcp-bus (3 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `mcp_list_servers` | 0 | read | bespoke | List external MCP servers the kernel has registered (proxy view) |  |
| `mcp_proxy_call_tool` | 3 | read | bespoke | Invoke a tool on a downstream MCP server (kernel proxies the call) |  |
| `mcp_proxy_list_tools` | 1 | read | bespoke | List tools advertised by a downstream MCP server (kernel proxies the call) |  |

### system (2 endpoints, all bespoke)

| endpoint | params | r/w | face | description | dual? |
|---|---|---|---|---|---|
| `kernel_status` | 0 | read | bespoke | Report kernel health: uptime, registered LLM adapters, MCP server count | cmd too |
| `vault_root_path` | 0 | read | bespoke | Return the absolute vault root path on disk | cmd too |

## Dual-surface evidence — Tauri commands per module (135 total)

Many capabilities are BOTH an MCP tool and a Tauri command = the P1 drift risk ADR-010 diagnosed. SC5 (collapse the dual surface) is not done.

| commands module | count |
|---|---|
| `commands/vault.rs` | 28 |
| `commands/kernel.rs` | 12 |
| `commands/system.rs` | 10 |
| `commands/storage.rs` | 10 |
| `commands/agents.rs` | 7 |
| `commands/draft.rs` | 6 |
| `commands/code_space.rs` | 6 |
| `commands/provider.rs` | 5 |
| `commands/vault_embeddings.rs` | 5 |
| `commands/git.rs` | 5 |
| `commands/obsidian.rs` | 4 |
| `commands/stss.rs` | 4 |
| `commands/config.rs` | 4 |
| `commands/workshop.rs` | 4 |
| `commands/memory.rs` | 3 |
| `commands/keychain.rs` | 3 |
| `commands/irisy_synth.rs` | 3 |
| `commands/hermes_acp.rs` | 2 |
| `commands/provider_templates.rs` | 2 |
| `commands/provider_models.rs` | 2 |
| `commands/skills.rs` | 2 |
| `commands/gate.rs` | 1 |
| `commands/chat.rs` | 1 |
| `commands/irisy_chat.rs` | 1 |
| `commands/image.rs` | 1 |
| `commands/screenshot.rs` | 1 |
| `commands/irisy.rs` | 1 |
| `commands/updater.rs` | 1 |
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
2. **Dual surface not collapsed** (31 MCP tools share a name with a Tauri command) = SC5 not done.
3. **No versioned external endpoint contract** (section 14.10 version negotiation is spec'd, gate routing not implemented).

Convergence path = make section-14 cover everything (migrate `vault_*` etc. into
describe/query/produce) + SC5 collapse the dual surface. **Interface reaches
production grade when those two are done.**
