#!/usr/bin/env node
// audit-olym-ssot-drift — multi-dimension SSOT drift detection for olym
//
// Sister to audit-olympus-health.mjs (which checks per-layer file existence /
// structure). This script checks **cross-file consistency** (drift between
// CLAUDE.md / roster.md / yaml / etc declaring the same fact).
//
// Usage:
//   node scripts/audit-olym-ssot-drift.mjs              # default = report (human)
//   node scripts/audit-olym-ssot-drift.mjs --check      # CI mode, exit 1 on FAIL
//   node scripts/audit-olym-ssot-drift.mjs --json       # machine output
//   node scripts/audit-olym-ssot-drift.mjs --dimension=D1
//
// Spec: .olym/specs/olym-ssot-drift-audit/spec.md (G-013)
// Cadence: zeus EOD + weekly (conduct.md sec 14)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

// ── helpers ──────────────────────────────────────────────

function read(path) {
  return readFileSync(join(REPO, path), 'utf8');
}

function walkMd(dir, out = []) {
  if (!existsSync(join(REPO, dir))) return out;
  for (const e of readdirSync(join(REPO, dir))) {
    const p = join(dir, e);
    let s;
    try { s = statSync(join(REPO, p)); } catch { continue; }
    if (s.isDirectory()) walkMd(p, out);
    else if (e.endsWith('.md')) out.push(p);
  }
  return out;
}

function parseFm(text) {
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

// ── D1 Fleet count ──────────────────────────────────────

function d1FleetCount() {
  const roster = read('.olym/steering/olympus-roster.md');
  const claudeMd = read('CLAUDE.md');
  const m1 = roster.match(/\*\*Total\*\*:\s*\*\*?(\d+)\s*lane/i);
  const m2 = claudeMd.match(/Fleet\s+(\d+)\s*\u4f4d/);
  if (!m1 || !m2) {
    return { dim: 'D1', name: 'Fleet count', status: 'WARN', msg: 'count regex no match in roster.md or CLAUDE.md' };
  }
  return m1[1] === m2[1]
    ? { dim: 'D1', name: 'Fleet count', status: 'PASS', msg: `roster=${m1[1]} CLAUDE.md=${m2[1]}` }
    : { dim: 'D1', name: 'Fleet count', status: 'FAIL', msg: `roster=${m1[1]} != CLAUDE.md=${m2[1]}` };
}

// ── D2 Retired persona in active handoff ─────────────────

function d2RetiredPersona() {
  const roster = read('.olym/steering/olympus-roster.md');
  const retiredSection = roster.split('## \u9000\u5f79\u5386\u53f2')[1] || '';
  const retiredEnd = retiredSection.split(/\n## /)[0];
  // Only first column of each table row (line-anchored). Skip "→ to" columns.
  const retired = [...retiredEnd.matchAll(/^\|\s*@(\w+(?:-\d+)?)\s*\|/gm)].map(m => m[1]);
  if (retired.length === 0) {
    return { dim: 'D2', name: 'Retired persona in active', status: 'WARN', msg: 'no retired list found in roster.md "\u9000\u5f79\u5386\u53f2"' };
  }

  const violations = [];
  for (const f of walkMd('.olym/handoffs').filter(p => !p.includes('_archive'))) {
    const text = readFileSync(join(REPO, f), 'utf8');
    const fm = parseFm(text);
    if (!fm) continue;
    if (['archived', 'verified'].includes(fm.status)) continue;
    if (retired.includes(fm.assigned_to)) {
      violations.push(`${f.replace(/\\/g, '/')} (assigned_to: ${fm.assigned_to})`);
    }
  }
  return violations.length === 0
    ? { dim: 'D2', name: 'Retired persona in active', status: 'PASS', msg: `0 active handoffs assigned to retired (${retired.length} retired total)` }
    : { dim: 'D2', name: 'Retired persona in active', status: 'FAIL', msg: `${violations.length} violations:\n  ${violations.join('\n  ')}` };
}

// ── D3 Dead link ─────────────────────────────────────────

function d3DeadLink() {
  // Scan only active (non-archive, non-deferred, non-obsidian) sources.
  // docs/research/* is allowed as referrer (research notes), but skip its dead-link
  // findings — historical references that are out of scope for olym SSOT.
  //
  // 2026-05-06 (G-013 v1.1.0): added '/audits/' + '/decisions/' to exclude
  // audit-trail subtrees. ADR + audit reports preserve historical narrative
  // about deleted/renamed concepts (e.g., zeus-discipline.md ref explaining
  // why it's broken). These are intentional audit trail, not active SSOT drift.
  // best-practice/ + proposals/ remain watched (live knowledge).
  const SKIP_SUBTREES = [
    '_archive', '_deferred',
    '/obsidian/', '/docs/research/', '/docs/analysis/',
    '/audits/', '/decisions/',
  ];
  // Skip placeholder paths in code blocks / templates (NNN, YYYY, foo, ...)
  const PLACEHOLDER_RE = /(NNN|YYYY|\.\.\.|<.*>|^foo$)/;

  const refs = new Map();
  for (const f of walkMd('.olym')) {
    // Normalize Windows backslash separators for SKIP_SUBTREES match.
    const fNorm = f.split('\\').join('/');
    if (SKIP_SUBTREES.some(s => fNorm.includes(s))) continue;
    const text = readFileSync(join(REPO, f), 'utf8');
    for (const m of text.matchAll(/\.olym\/[\w/.-]+\.(md|yaml|yml|json)/g)) {
      const path = m[0];
      if (PLACEHOLDER_RE.test(path)) continue;
      if (!refs.has(path)) refs.set(path, new Set());
      refs.get(path).add(f.replace(/\\/g, '/'));
    }
  }
  const broken = [];
  for (const [path, referrers] of refs) {
    if (!existsSync(join(REPO, path))) {
      broken.push({ path, referrers: [...referrers].slice(0, 3) });
    }
  }
  return broken.length === 0
    ? { dim: 'D3', name: 'Dead link', status: 'PASS', msg: `${refs.size} refs scanned (active subtrees only), 0 broken` }
    : { dim: 'D3', name: 'Dead link', status: 'WARN', msg: `${broken.length} broken (active subtrees):\n  ${broken.slice(0, 10).map(b => `${b.path} (in: ${b.referrers.join(', ')})`).join('\n  ')}${broken.length > 10 ? `\n  ... and ${broken.length - 10} more` : ''}` };
}

// ── D4 Conduct sec 8 vs yaml denylist ────────────────────

function d4ConductYaml() {
  const conduct = read('.olym/steering/protocol/conduct.md');
  const yaml = read('.olym/steering/lane-ownership.yaml');

  const sec8 = conduct.split('### 8.1')[1]?.split('### 8.2')[0] || '';
  const paths = new Set();
  for (const m of sec8.matchAll(/`([^`]+)`/g)) {
    const p = m[1].split(/\s+/)[0].replace(/[+()]/g, '');
    // Skip brace-expansion paths (e.g., `.github/workflows/{_reusable,ci-,...}*.yml`)
    // — these are human-readable summaries; yaml denylist uses individual entries.
    if (p.includes('{')) continue;
    if (p.startsWith('.olym/') || p.startsWith('.claude/') || p.startsWith('.husky/') || p.startsWith('.github/') || p === 'CLAUDE.md' || p === 'MEMORY.md') {
      paths.add(p);
    }
  }

  const denyMatch = yaml.split('denylist_explicit:')[1]?.split(/^[a-z_]+:/m)[0] || '';
  const denyPaths = [...denyMatch.matchAll(/^\s*-\s+([\w/.*-]+)/gm)].map(m => m[1]);

  const uncovered = [];
  for (const p of paths) {
    const covered = denyPaths.some(d => {
      if (d === p) return true;
      const dRoot = d.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      const pRoot = p.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      return dRoot === pRoot || pRoot.startsWith(dRoot + '/') || dRoot.startsWith(pRoot + '/');
    });
    if (!covered) uncovered.push(p);
  }
  return uncovered.length === 0
    ? { dim: 'D4', name: 'Conduct sec 8 vs yaml denylist', status: 'PASS', msg: `${paths.size} sec 8 paths all covered in denylist` }
    : { dim: 'D4', name: 'Conduct sec 8 vs yaml denylist', status: 'WARN', msg: `${uncovered.length} sec 8 paths uncovered: ${uncovered.join(', ')}` };
}

// ── D5 Protocol count ────────────────────────────────────

function d5ProtocolCount() {
  const protoMd = read('.olym/steering/olympus-protocol.md');
  const m = protoMd.match(/\*\*Total\*\*:\s*\*\*?(\d+)\s*\u7c7b/);
  if (!m) {
    return { dim: 'D5', name: 'Protocol count', status: 'WARN', msg: 'olympus-protocol.md Total regex no match' };
  }
  const declared = parseInt(m[1], 10);

  const protocolDir = '.olym/steering/protocol';
  const actual = readdirSync(join(REPO, protocolDir))
    .filter(f => f.endsWith('.md')).length;

  // Carve-out: platform-architecture.md is reference doc, not protocol-rule
  const carveOut = ['platform-architecture.md'].filter(f => existsSync(join(REPO, protocolDir, f))).length;
  const adjusted = actual - carveOut;

  return declared === adjusted
    ? { dim: 'D5', name: 'Protocol count', status: 'PASS', msg: `declared=${declared} = adjusted=${adjusted} (${actual} files - ${carveOut} carve-out)` }
    : { dim: 'D5', name: 'Protocol count', status: 'WARN', msg: `declared=${declared}, adjusted=${adjusted} (${actual} files - ${carveOut} carve-out: platform-architecture.md is reference)` };
}

// ── main ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const jsonMode = args.includes('--json');
const dimArg = args.find(a => a.startsWith('--dimension='))?.split('=')[1];

const allDims = [d1FleetCount, d2RetiredPersona, d3DeadLink, d4ConductYaml, d5ProtocolCount];
const dims = dimArg
  ? allDims.filter(d => d().dim.toLowerCase() === dimArg.toLowerCase())
  : allDims;

const results = dims.map(d => d());

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`[olym-ssot-drift] ${results.length} dimensions checked\n`);
  for (const r of results) {
    const icon = r.status === 'PASS' ? '[OK]' : r.status === 'WARN' ? '[WARN]' : '[FAIL]';
    console.log(`${icon} ${r.dim} ${r.name} - ${r.msg}`);
  }
  const fails = results.filter(r => r.status === 'FAIL').length;
  const warns = results.filter(r => r.status === 'WARN').length;
  const passes = results.filter(r => r.status === 'PASS').length;
  console.log(`\nVerdict: ${passes} PASS / ${warns} WARN / ${fails} FAIL`);
}

if (checkMode && results.some(r => r.status === 'FAIL')) {
  process.exit(1);
}
