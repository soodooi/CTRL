#!/usr/bin/env node
// Human-readable endpoint view derived from the protocol schema and the single
// executable implementation inventory. This file owns no counts or ceilings.
// (ADR-010 communication § endpoint-spec v14)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SCHEMA = join(ROOT, 'vault/ctrl/mcp-schema.json');
const INVENTORY = join(ROOT, 'vault/ctrl/generated/implementation-inventory.json');
const OUT = join(ROOT, 'vault/ctrl/generated/endpoint-catalog.md');

const spec = JSON.parse(readFileSync(SCHEMA, 'utf8'));
const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8'));
const metrics = inventory.metrics;
const gateMetric = metrics.registeredGateTools;
const commandMetric = metrics.productTauriCommands;
const dualMetric = metrics.exactMcpTauriDualSurfaces;
const semanticDualMetric = metrics.semanticMcpTauriDualSurfaces;
if (!Array.isArray(spec.tools) || spec.tools.length !== gateMetric.count) {
  throw new Error('MCP schema and implementation inventory disagree; regenerate the inventory first');
}
const schemaNames = spec.tools.map((tool) => tool.name).sort();
if (JSON.stringify(schemaNames) !== JSON.stringify(gateMetric.identities)) {
  throw new Error('MCP schema identities and implementation inventory disagree');
}

function moduleOf(tool) {
  if (tool === 'kernel_status' || tool === 'vault_root_path') return 'system';
  const prefixes = [
    ['smart_table_', 'smart-table'],
    ['calendar_', 'calendar'],
    ['source_', 'sources'],
    ['task_', 'tasks'],
    ['doc_', 'notes'],
    ['note_', 'notes'],
    ['notes_', 'notes'],
    ['irisy_soul_', 'memory'],
    ['vault_', 'vault'],
    ['providers_', 'providers'],
    ['registry_', 'registry'],
    ['discover_', 'discovery'],
    ['skill_', 'skills'],
    ['market_', 'market'],
    ['http_', 'network'],
    ['mcp_', 'mcp-bus'],
    ['kv_', 'kv'],
    ['llm_', 'llm'],
  ];
  return prefixes.find(([prefix]) => tool.startsWith(prefix))?.[1] ?? 'other';
}

const WRITE_RE = /(write|append|update|create|rename|move|delete|set|embed|reembed|rebuild|run|cancel|install|uninstall|provision|produce|post|publish)/;
function probableAccess(tool) {
  return WRITE_RE.test(tool) ? 'probable write' : 'probable read';
}
function cell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

const dual = new Set(dualMetric.identities);
const tools = spec.tools.map((tool) => ({
  name: tool.name,
  description: cell(tool.description),
  params: Object.keys(tool.inputSchema?.properties ?? {}).length,
  module: moduleOf(tool.name),
  access: probableAccess(tool.name),
}));
const byModule = new Map();
for (const tool of tools) {
  if (!byModule.has(tool.module)) byModule.set(tool.module, []);
  byModule.get(tool.module).push(tool);
}

const commandGroups = new Map();
for (const identity of commandMetric.identities) {
  const [module] = identity.split('::');
  commandGroups.set(module, (commandGroups.get(module) ?? 0) + 1);
}

let markdown = `---
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

This navigation view combines endpoint descriptions from \`vault/ctrl/mcp-schema.json\`
with identities and counts from \`vault/ctrl/generated/implementation-inventory.json\`.
It defines no metric, baseline, contract face, or architectural status
(ADR-010 communication § endpoint-spec v14).

## Overview

- **${gateMetric.count}** registered static MCP tools (ceiling ${gateMetric.ceiling}, target ${gateMetric.target})
- **${commandMetric.count}** registered Tauri commands (ceiling ${commandMetric.ceiling})
- **${dualMetric.count}** exact-name MCP/Tauri overlaps (ceiling ${dualMetric.ceiling}, target ${dualMetric.target})
- **${semanticDualMetric.count}** exact-or-explicit semantic MCP/Tauri overlaps (ceiling ${semanticDualMetric.ceiling}, target ${semanticDualMetric.target})

Semantic equivalents with different names enter the inventory only through explicit
\`ctrl-inventory: semantic-dual=<gate-tool>\` annotations; no name heuristic invents them.
The read/write labels below are navigation heuristics and are not governance decisions.
`;

for (const moduleName of [...byModule.keys()].sort()) {
  const moduleTools = byModule.get(moduleName).sort((a, b) => a.name.localeCompare(b.name));
  markdown += `\n## ${moduleName} (${moduleTools.length})\n\n`;
  markdown += '| endpoint | params | access heuristic | description | exact dual? |\n|---|---:|---|---|---|\n';
  for (const tool of moduleTools) {
    markdown += `| \`${tool.name}\` | ${tool.params} | ${tool.access} | ${tool.description || '—'} | ${dual.has(tool.name) ? 'yes' : ''} |\n`;
  }
}

markdown += `\n## Tauri command registration by module (${commandMetric.count})\n\n`;
markdown += '| commands module | count |\n|---|---:|\n';
for (const [moduleName, count] of [...commandGroups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  markdown += `| \`commands/${moduleName}.rs\` | ${count} |\n`;
}

markdown += `\n## Generation boundaries\n
- Endpoint names, descriptions, and input schemas come from \`vault/ctrl/mcp-schema.json\`.
- Counts, registered command identities, exact overlaps, ceilings, and targets come only from \`vault/ctrl/generated/implementation-inventory.json\`.
- Module and probable-access labels are view-only heuristics.
- Accepted decisions and migration status live only in the owning ADRs.
`;

if (CHECK) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== markdown) {
    throw new Error('endpoint-catalog.md is stale; run node scripts/gen-endpoint-catalog.mjs');
  }
  console.log(`endpoint-catalog: PASS (${gateMetric.count} tools, ${commandMetric.count} commands)`);
} else {
  writeFileSync(OUT, markdown);
  console.log(`endpoint-catalog: wrote ${gateMetric.count} tools, ${commandMetric.count} commands, ${dualMetric.count} exact / ${semanticDualMetric.count} semantic dual`);
}
