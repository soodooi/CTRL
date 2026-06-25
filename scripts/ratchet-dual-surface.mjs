#!/usr/bin/env node
// Ratchet lint — dual surface (SC5, ADR-010 § diagnosis P1).
//
// A "dual surface" capability is exposed as BOTH an MCP tool (on the :17873
// gate) AND a Tauri command — with TWO separate implementations that can (and
// do) drift. Concretely: the Tauri `vault_read` runs `check_cap()` (capability
// token), the MCP `vault_read` does not (it relies on the gate's bearer auth +
// SC3 visibility). Same operation, divergent governance = the P1 drift risk.
//
// SC5 collapses these onto one §14 source (describe/query/produce) so both
// transports derive from one implementation. This lint does NOT force that
// migration (GOAL non-goal: don't mass-migrate 136 commands). It is the
// RATCHET: it locks the dual-surface count so no NEW dual surface is added,
// and you LOWER the baseline as capabilities migrate — the count only goes down.
//
// Exits non-zero if the dual-surface count EXCEEDS the baseline.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Ratchet baseline. 2026-06-24: 31 → 2 after the full frontend→gate migration
// retired the 29 vault/smart-table/embeddings capability commands (PWA now calls
// them via gate_invoke). The 2 remaining (kernel_status, vault_write_image) have
// no migrated frontend caller yet. LOWER THIS (never raise) as more retire.
const BASELINE = 2;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP = join(ROOT, 'src-tauri/src/kernel/mcp_server.rs');
const CMDS = join(ROOT, 'src-tauri/src/commands/mod.rs');

// MCP tool names read straight from source (every `async fn` carrying a #[tool]
// attr) — NOT from the committed mcp-schema.json, so a newly-added tool can't
// slip past a stale artifact. The lint only needs names, not full schemas.
function mcpToolNames(src) {
  const lines = src.split('\n');
  const names = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*async fn (\w+)\s*\(/);
    if (!m) continue;
    for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
      if (/#\[tool\b/.test(lines[j])) { names.add(m[1]); break; }
      if (/async fn /.test(lines[j])) break;
    }
  }
  return names;
}
const mcpTools = mcpToolNames(readFileSync(MCP, 'utf8'));

// Tauri command names = the generate_handler! registration (crate::commands::<mod>::<cmd>).
const cmdNames = new Set(
  [...readFileSync(CMDS, 'utf8').matchAll(/::(\w+)::(\w+),/g)].map((m) => m[2]),
);

const dual = [...mcpTools].filter((n) => cmdNames.has(n)).sort();

console.log(`dual-surface: ${dual.length} (baseline ${BASELINE})`);
for (const n of dual) console.log(`  - ${n}`);

if (dual.length > BASELINE) {
  console.error(
    `\nFAIL: dual surface grew ${BASELINE} -> ${dual.length}. ` +
      `A new capability was added as BOTH an MCP tool and a Tauri command ` +
      `with separate impls. Implement it once as a §14 source (describe/query/` +
      `produce) so both transports derive from one impl, or justify + raise the ` +
      `baseline knowingly (don't — the ratchet only goes down).`,
  );
  process.exit(1);
}

if (dual.length < BASELINE) {
  console.log(
    `\nRatchet tightened: ${dual.length} < ${BASELINE}. ` +
      `Lower BASELINE to ${dual.length} in scripts/ratchet-dual-surface.mjs.`,
  );
}
console.log('\nOK: dual surface within ratchet.');
