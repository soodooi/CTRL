#!/usr/bin/env node
/**
 * audit-olym-dogfood — meta-audit verifying olym follows its own protocols.
 *
 * Sister to audit-olym-ssot-drift.mjs (cross-file consistency, G-013) but
 * different axis: this script checks PROTOCOL COMPLIANCE — does olym actually
 * follow the rules it sets for itself?
 *
 * Usage:
 *   node scripts/audit-olym-dogfood.mjs              # default report
 *   node scripts/audit-olym-dogfood.mjs --check      # CI strict (exit 1 on FAIL only)
 *   node scripts/audit-olym-dogfood.mjs --json       # machine output
 *   node scripts/audit-olym-dogfood.mjs --dim=D2     # single dimension
 *
 * Spec: .olym/specs/olym-dogfood-audit/spec.md (G-036)
 * Cadence: zeus EOD (audit-all.sh stage 3) + ad-hoc
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const args = new Set(process.argv.slice(2));
const CHECK_MODE = args.has('--check');
const JSON_MODE = args.has('--json');
const dimArg = [...args].find(a => a.startsWith('--dim='));
const ONLY_DIM = dimArg ? dimArg.split('=')[1] : null;

// ── helpers ──────────────────────────────────────────────

function read(path) {
  try {
    return readFileSync(join(REPO, path), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function parseFm(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

function walkSpecMd(dir, baseDir = dir, depth = 0, out = []) {
  const full = join(REPO, dir);
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const sub = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSpecMd(sub, baseDir, depth + 1, out);
    } else if (entry.name.endsWith('.md')) {
      // Top-level .md or nested spec.md (matches scripts/specs-index.mjs convention)
      if (depth === 0 || entry.name === 'spec.md') {
        out.push(sub.split('\\').join('/'));
      }
    }
  }
  return out;
}

function listFiles(dir, regex) {
  const full = join(REPO, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter(f => regex.test(f)).map(f => `${dir}/${f}`);
}

// ── D1: spec frontmatter completeness ───────────────────

function d1SpecFrontmatter() {
  const REQUIRED = ['type', 'spec_id', 'version', 'status', 'created', 'updated', 'owner', 'audit_dimension'];
  const specs = walkSpecMd('.olym/specs');
  const violations = [];
  for (const path of specs) {
    const text = readFileSync(join(REPO, path), 'utf8');
    const fm = parseFm(text);
    if (!fm) {
      violations.push(`${path}: no frontmatter`);
      continue;
    }
    const missing = REQUIRED.filter(k => !fm[k]);
    if (missing.length > 0) {
      violations.push(`${path}: missing ${missing.join('/')}`);
    }
  }
  return violations.length === 0
    ? { dim: 'D1', name: 'Spec frontmatter completeness', status: 'PASS', msg: `${specs.length} specs, all 8 required fields present` }
    : { dim: 'D1', name: 'Spec frontmatter completeness', status: 'WARN', msg: `${violations.length} of ${specs.length} specs missing fields:\n  ${violations.slice(0, 8).join('\n  ')}${violations.length > 8 ? `\n  ... and ${violations.length - 8} more` : ''}` };
}

// ── D2: olym-* specs have lifecycle + category ──────────

function d2OlymSpecsLifecycleCategory() {
  const specs = walkSpecMd('.olym/specs').filter(p => /\/olym-[^/]+\//.test(p) || /\/olym-[^/]+\.md$/.test(p));
  const missing = [];
  for (const path of specs) {
    const fm = parseFm(readFileSync(join(REPO, path), 'utf8'));
    if (!fm) continue;
    const gaps = [];
    if (!fm.lifecycle) gaps.push('lifecycle');
    if (!fm.category) gaps.push('category');
    if (gaps.length > 0) missing.push(`${path}: ${gaps.join('/')}`);
  }
  return missing.length === 0
    ? { dim: 'D2', name: 'Olym-* specs lifecycle/category', status: 'PASS', msg: `${specs.length} olym-* specs, all have both fields (G-018/G-024 dogfood)` }
    : { dim: 'D2', name: 'Olym-* specs lifecycle/category', status: 'WARN', msg: `${missing.length} of ${specs.length} missing field:\n  ${missing.slice(0, 8).join('\n  ')}${missing.length > 8 ? `\n  ... and ${missing.length - 8} more` : ''}` };
}

// ── D3: recent handoffs have ## bao approval ────────────

function d3RecentHandoffsBaoApproval() {
  const G048_DATE = new Date('2026-05-05'); // G-048 introduction date
  const handoffs = listFiles('.olym/handoffs', /^H-\d{4}-\d{2}-\d{2}-\d{3}-.+\.md$/);
  const violations = [];
  let recentCount = 0;
  for (const path of handoffs) {
    const m = path.match(/H-(\d{4})-(\d{2})-(\d{2})-/);
    if (!m) continue;
    const date = new Date(`${m[1]}-${m[2]}-${m[3]}`);
    if (date < G048_DATE) continue;
    recentCount++;
    const text = readFileSync(join(REPO, path), 'utf8');
    if (!/^## bao approval/m.test(text)) {
      violations.push(path);
    }
  }
  return violations.length === 0
    ? { dim: 'D3', name: 'Recent handoff bao approval', status: 'PASS', msg: `${recentCount} handoffs since G-048 (2026-05-05), all have section` }
    : { dim: 'D3', name: 'Recent handoff bao approval', status: 'WARN', msg: `${violations.length} of ${recentCount} missing:\n  ${violations.slice(0, 8).join('\n  ')}${violations.length > 8 ? `\n  ... and ${violations.length - 8} more` : ''}` };
}

// ── D4: olympus-protocol.md table refs exist ────────────

function d4ProtocolTableRefs() {
  const text = read('.olym/steering/olympus-protocol.md');
  const refs = [...text.matchAll(/\[protocol\/([a-z-]+\.md)\]\(protocol\/[a-z-]+\.md\)/g)].map(m => m[1]);
  const unique = [...new Set(refs)];
  const missing = [];
  for (const f of unique) {
    if (!existsSync(join(REPO, '.olym/steering/protocol', f))) {
      missing.push(`protocol/${f}`);
    }
  }
  return missing.length === 0
    ? { dim: 'D4', name: 'Protocol table refs', status: 'PASS', msg: `${unique.length} declared = ${unique.length} exist` }
    : { dim: 'D4', name: 'Protocol table refs', status: 'FAIL', msg: `${missing.length} declared but missing: ${missing.join(', ')}` };
}

// ── D5: roadmap done entries link real specs ────────────

function d5RoadmapDoneRefs() {
  // Roadmap spec is project-specific. If absent (e.g., starter or pre-roadmap project),
  // skip dimension instead of crashing.
  const text = read('.olym/specs/olym-v3-roadmap/spec.md');
  if (text === null) {
    return { dim: 'D5', name: 'Roadmap done refs', status: 'SKIP', msg: 'no .olym/specs/olym-v3-roadmap/spec.md (project has no roadmap yet)' };
  }
  const lines = text.split(/\r?\n/);
  const violations = [];
  let doneCount = 0;
  for (const line of lines) {
    if (!/✅\s*done/.test(line)) continue;
    doneCount++;
    // Extract spec path references from the line
    const specRefs = [...line.matchAll(/`(\.olym\/specs\/[^/]+\/spec\.md)`/g)].map(m => m[1]);
    for (const ref of specRefs) {
      if (!existsSync(join(REPO, ref))) {
        violations.push(`${line.match(/G-\d+/)?.[0] || '?'}: ${ref}`);
      }
    }
  }
  return violations.length === 0
    ? { dim: 'D5', name: 'Roadmap done refs', status: 'PASS', msg: `${doneCount} done entries, all spec refs exist` }
    : { dim: 'D5', name: 'Roadmap done refs', status: 'FAIL', msg: `${violations.length} broken:\n  ${violations.join('\n  ')}` };
}

// ── runner ───────────────────────────────────────────────

const ALL = [d1SpecFrontmatter, d2OlymSpecsLifecycleCategory, d3RecentHandoffsBaoApproval, d4ProtocolTableRefs, d5RoadmapDoneRefs];

const results = [];
for (const fn of ALL) {
  const r = fn();
  if (ONLY_DIM && r.dim !== ONLY_DIM) continue;
  results.push(r);
}

if (JSON_MODE) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  process.exit(0);
}

process.stdout.write(`[olym-dogfood] ${results.length} dimension(s) checked\n\n`);
for (const r of results) {
  const tag = r.status === 'PASS' ? '[OK]' : r.status === 'WARN' ? '[WARN]' : r.status === 'SKIP' ? '[SKIP]' : '[FAIL]';
  process.stdout.write(`${tag} ${r.dim} ${r.name} - ${r.msg}\n`);
}
process.stdout.write('\n');

const pass = results.filter(r => r.status === 'PASS').length;
const warn = results.filter(r => r.status === 'WARN').length;
const fail = results.filter(r => r.status === 'FAIL').length;
process.stdout.write(`Verdict: ${pass} PASS / ${warn} WARN / ${fail} FAIL\n`);

if (CHECK_MODE && fail > 0) process.exit(1);
process.exit(0);
