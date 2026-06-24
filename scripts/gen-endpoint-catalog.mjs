#!/usr/bin/env node
// Endpoint catalog generator — derives a module x endpoint inventory from the
// kernel source so the catalog never goes stale (vault-is-truth philosophy).
//
// Reads:
//   - vault/ctrl/mcp-schema.json           -> the authoritative endpoint spec
//       (the MCP tools/list JSON Schema, exported by `cargo run --bin
//        dump_mcp_schema`; ADR-010 section endpoint-spec v6). The catalog is
//        derived FROM the spec, NOT by scraping Rust source.
//   - src-tauri/src/commands/mod.rs        -> the Tauri command surface (dual-surface)
// Emits: vault/ctrl/endpoint-catalog.md
//   Regenerate: cargo run --manifest-path src-tauri/Cargo.toml --bin dump_mcp_schema
//               && node scripts/gen-endpoint-catalog.mjs
//
// Classification is heuristic + a curated set for the section-14 contract face.
// It is NOT a substitute for ADR-002 section 14 (the spec) — it is the inventory.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = join(ROOT, 'vault/ctrl/mcp-schema.json');
const CMDS = join(ROOT, 'src-tauri/src/commands/mod.rs');
const OUT = join(ROOT, 'vault/ctrl/endpoint-catalog.md');

// Module classification (mirrors kernel/visibility.rs tool_domain).
function moduleOf(tool) {
  if (tool === 'kernel_status' || tool === 'vault_root_path') return 'system';
  const table = [
    ['smart_table_', 'smart-table'],
    ['irisy_soul_', 'memory'],
    ['vault_', 'vault/notes'],
    ['notes_', 'notes(s14)'],
    ['providers_', 'providers(s14)'],
    ['registry_', 'registry(s14)'],
    ['kv_', 'kv'],
    ['llm_', 'llm'],
    ['http_', 'net'],
    ['mcp_', 'mcp-bus'],
  ];
  for (const [p, m] of table) if (tool.startsWith(p)) return m;
  return 'other';
}

// Read vs write (produce) by name heuristic.
const WRITE_RE = /(write|append|update|create|rename|move|delete|set|embed|reembed|rebuild|run|cancel|import|star|folder|patch|post|publish)/;
function rw(tool) {
  if (/^(.*_)?(describe|query|get|list|search|read|status|graph|tags|backlinks|orphans|mentions|aliases|broken|root|count|snapshot|suggest)/.test(tool))
    return 'read';
  return WRITE_RE.test(tool) ? 'WRITE' : 'read';
}

// Curated section-14 three-verb contract face (the rest are bespoke tools).
const SC14 = new Set([
  'smart_table_describe', 'smart_table_query', 'smart_table_append_row',
  'smart_table_update_cell', 'smart_table_add_view',
  'smart_table_run_ai_column', 'smart_table_run_ai_column_start',
  'smart_table_run_ai_column_status', 'smart_table_run_ai_column_cancel',
  'notes_describe', 'notes_query',
  'providers_describe', 'providers_query',
  'registry_describe', 'registry_query',
]);

// Load gate tools from the authoritative endpoint spec (mcp-schema.json).
// The spec is the rmcp-macro-generated tools/list shape; each entry already
// carries its JSON Schema, so the catalog reflects the protocol's own
// self-description rather than a scraped approximation.
function loadTools() {
  const spec = JSON.parse(readFileSync(SCHEMA, 'utf8'));
  return (spec.tools || []).map((t) => {
    const props = t.inputSchema && t.inputSchema.properties ? Object.keys(t.inputSchema.properties).length : 0;
    const desc = (t.description || '').replace(/\s+/g, ' ').trim();
    return { name: t.name, desc, params: props, module: moduleOf(t.name), rw: rw(t.name), sc14: SC14.has(t.name) };
  });
}

// Count Tauri commands per source module (crate::commands::<mod>::<cmd>).
// Grouping by real module path is robust and exposes the dual surface.
function extractCommandGroups(src) {
  const counts = {};
  const cmds = [];
  for (const m of src.matchAll(/::(\w+)::(\w+),/g)) {
    counts[m[1]] = (counts[m[1]] || 0) + 1;
    cmds.push(m[2]);
  }
  const groups = Object.entries(counts)
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n);
  return { groups, cmdNames: new Set(cmds) };
}

const tools = loadTools();
const { groups: cmdGroups, cmdNames } = extractCommandGroups(readFileSync(CMDS, 'utf8'));
const totalCmds = cmdNames.size;
const overlap = tools.filter((t) => cmdNames.has(t.name)).map((t) => t.name);

const byModule = {};
for (const t of tools) (byModule[t.module] ??= []).push(t);
const moduleOrder = ['smart-table', 'notes(s14)', 'providers(s14)', 'registry(s14)',
  'vault/notes', 'memory', 'kv', 'llm', 'net', 'mcp-bus', 'system', 'other'];
const modules = Object.keys(byModule).sort(
  (a, b) => (moduleOrder.indexOf(a) + 1 || 99) - (moduleOrder.indexOf(b) + 1 || 99));

const sc14Count = tools.filter((t) => t.sc14).length;
const writeCount = tools.filter((t) => t.rw === 'WRITE').length;

let md = `---
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

Derived **from the authoritative endpoint spec** \`vault/ctrl/mcp-schema.json\` (the
MCP \`tools/list\` JSON Schema, exported by \`cargo run --bin dump_mcp_schema\`) — NOT
by scraping source (ADR-010 section endpoint-spec v6). Contract spec = **ADR-002
section 14** (describe/query/produce). This file is the human-readable **inventory**;
the machine-readable spec is \`mcp-schema.json\`.

## Overview

- **${tools.length}** MCP tools on the :17873 gate (the endpoints AI actually sees)
- **${sc14Count}** are on the section-14 three-verb contract; the other **${tools.length - sc14Count}** are bespoke tools (not section-14 shaped)
- **${writeCount}** writes (produce, through the review gate) / **${tools.length - writeCount}** reads
- **${totalCmds}** Tauri commands (the frontend RPC surface); **${overlap.length}** share an exact name with an MCP tool = dual-surface drift risk (P1, SC5 not done)

Honest takeaway: **the section-14 spec exists, but only smart-table fully migrated;
vault/notes is mostly the old bespoke \`vault_*\` tools; html/pdf and other envisioned
sources are not built.**

## Endpoints x module (MCP gate tools)

Legend: **s14** = three-verb contract face · bespoke = ad-hoc tool · **WRITE** = produce (gated) · read
`;

for (const mod of modules) {
  const ts = byModule[mod].sort((a, b) => a.name.localeCompare(b.name));
  const sc14n = ts.filter((t) => t.sc14).length;
  md += `\n### ${mod} (${ts.length} endpoints${sc14n ? `, ${sc14n} s14` : ', all bespoke'})\n\n`;
  md += `| endpoint | params | r/w | face | description | dual? |\n|---|---|---|---|---|---|\n`;
  for (const t of ts) {
    const dual = cmdNames.has(t.name) ? 'cmd too' : '';
    md += `| \`${t.name}\` | ${t.params} | ${t.rw === 'WRITE' ? '**WRITE**' : 'read'} | ${t.sc14 ? 's14' : 'bespoke'} | ${t.desc || '—'} | ${dual} |\n`;
  }
}

md += `\n## Dual-surface evidence — Tauri commands per module (${totalCmds} total)\n\n`;
md += `Many capabilities are BOTH an MCP tool and a Tauri command = the P1 drift risk ADR-010 diagnosed. SC5 (collapse the dual surface) is not done.\n\n`;
md += `| commands module | count |\n|---|---|\n`;
for (const g of cmdGroups) md += `| \`commands/${g.label}.rs\` | ${g.n} |\n`;

md += `\n## Section-14 contract coverage (spec vs built)\n
| module | s14 describe | s14 query | s14 produce | note |
|---|---|---|---|---|
| **smart-table** | yes | yes | yes (append_row/update_cell) | only full section-14 impl |
| **notes** | yes | yes | no | read contract; writes still go through bespoke \`vault_*\` |
| **providers** | yes | yes | — | read-only runtime registry |
| **registry** (installed mcp) | yes | yes | — | read-only runtime registry |
| **vault/Obsidian** | no | no | no | ~27 bespoke \`vault_*\` (read/write/search…); Obsidian REST MCP endpoints spec'd in ADR-002 section 1.9.1, connector not fully built |
| **hermes** | — | — | — | a brain, not a data source; its interface is the ACP single door — it *consumes* endpoints, it is not queried |
| **html / pdf / blob** | no | no | no | envisioned section-14 sources, NOT built |

## Gaps this catalog exposes
1. **Section-14 is one module deep** (smart-table); notes is half (no produce), vault/Obsidian/html/pdf not migrated or not built.
2. **Dual surface not collapsed** (${overlap.length} MCP tools share a name with a Tauri command) = SC5 not done.
3. **No versioned external endpoint contract** (section 14.10 version negotiation is spec'd, gate routing not implemented).

Convergence path = make section-14 cover everything (migrate \`vault_*\` etc. into
describe/query/produce) + SC5 collapse the dual surface. **Interface reaches
production grade when those two are done.**
`;

writeFileSync(OUT, md);
console.log(`endpoint-catalog: ${tools.length} tools, ${sc14Count} s14, ${totalCmds} cmds, ${overlap.length} dual -> ${OUT}`);
