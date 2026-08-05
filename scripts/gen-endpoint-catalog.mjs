#!/usr/bin/env node
// Endpoint catalog generator — derives a module x endpoint inventory from the
// kernel source so the catalog never goes stale (vault-is-truth philosophy).
//
// Reads:
//   - vault/ctrl/mcp-schema.json           -> the authoritative endpoint spec
//       (the MCP tools/list JSON Schema, exported by `cargo run --bin
//        dump_mcp_schema`; ADR-010 communication § endpoint-spec v11). The catalog is
//        derived FROM the spec, NOT by scraping Rust source.
//   - src-tauri/src/commands/mod.rs        -> the Tauri command surface (dual-surface)
// Emits: vault/ctrl/generated/endpoint-catalog.md
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
const OUT = join(ROOT, 'vault/ctrl/generated/endpoint-catalog.md');

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
const WRITE_RE = /(write|append|update|create|rename|move|delete|set|embed|reembed|rebuild|run|cancel|import|star|folder|patch|post|publish|produce)/;
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
  'vault_text_describe', 'vault_text_query',
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
kind: generated-inventory
generated_by: scripts/gen-endpoint-catalog.mjs
regenerate: node scripts/gen-endpoint-catalog.mjs
note: DO NOT hand-edit the tables. Architecture authority remains the owning module ADR.
related:
  - "[[002-substrate]]"
  - "[[010-communication]]"
  - "[[mcp-schema.json]]"
---

# CTRL endpoint catalog (auto-generated)

Generated from the machine-readable MCP schema at \`vault/ctrl/mcp-schema.json\`
and the registered Tauri command surface. The schema is exported by
\`cargo run --bin dump_mcp_schema\`; this catalog is a human-readable inventory,
not a second endpoint or architecture specification (ADR-010 communication § endpoint-spec v11).

## Overview

- **${tools.length}** MCP tools registered on the \`:17873\` gate
- **${sc14Count}** tools recognized by this generator's curated §14 face list
- **${writeCount}** probable writes / **${tools.length - writeCount}** probable reads, classified by endpoint-name heuristic
- **${totalCmds}** registered Tauri commands
- **${overlap.length}** exact-name overlaps between MCP tools and Tauri commands

These counts describe the generated surfaces only. The owning module ADR defines
whether a surface is intended, migrated, retired, or governed correctly.

## Endpoints by module (MCP gate tools)

Legend: **s14** = member of the generator's curated §14 face list · bespoke = other registered tool · **WRITE** = name-classified probable write · read = name-classified probable read
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

md += `\n## Tauri command registration by module (${totalCmds} total)\n\n`;
md += `This table is generated from \`src-tauri/src/commands/mod.rs\`. Exact-name overlap with an MCP tool is an inventory signal only; architectural interpretation belongs to the owning ADR.\n\n`;
md += `| commands module | count |\n|---|---|\n`;
for (const g of cmdGroups) md += `| \`commands/${g.label}.rs\` | ${g.n} |\n`;

md += `\n## Generation boundaries\n
- MCP names, descriptions, and input schemas come from \`vault/ctrl/mcp-schema.json\`.
- Tauri command counts come from the registration list in \`src-tauri/src/commands/mod.rs\`.
- Module, read/write, and §14-face labels are generator heuristics for navigation; they are not contracts.
- Accepted decisions and migration status live only in ADR-002, ADR-010, and the relevant owning module ADR.
`;

writeFileSync(OUT, md);
console.log(`endpoint-catalog: ${tools.length} tools, ${sc14Count} s14, ${totalCmds} cmds, ${overlap.length} dual -> ${OUT}`);
