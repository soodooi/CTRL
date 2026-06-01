#!/usr/bin/env node
/**
 * Pre-push dispatch check (G-014).
 *
 * Soft-warn (not block) when a new handoff is being pushed without
 * a pre-dispatch-review archive AND the handoff hits >=1 mandatory trigger
 * per .olym/steering/protocol/verification.md §2.1.
 *
 * Skip conditions (silent):
 *   - assigned_to: zeus
 *   - lane: zeus-stewardship
 *   - body contains "emergency:" in `## bao approval` section
 *
 * Spec: .olym/specs/olym-pre-pr-enforce-hook/spec.md
 *
 * Always exits 0 (never blocks push). Warning surfaces missing archive
 * for bao audit. Hard-block upgrade is P3 follow-up.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// Get list of new handoff files in this push
function getNewHandoffs() {
  // Try: files added in commits being pushed (vs upstream)
  // Fallback to recent commits if no upstream tracking yet
  let diff = run('git diff --name-only --diff-filter=A "@{push}..HEAD" -- .olym/handoffs/');
  if (!diff) {
    diff = run('git diff --name-only --diff-filter=A origin/main..HEAD -- .olym/handoffs/');
  }
  if (!diff) return [];
  return diff.split('\n').filter(f => /^\.olym\/handoffs\/H-\d{4}-\d{2}-\d{2}-\d{3}-.+\.md$/.test(f));
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  const arrays = {};
  let currentArray = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (kv) {
      currentArray = null;
      if (kv[2].trim() === '') {
        currentArray = kv[1];
        arrays[currentArray] = [];
      } else {
        fm[kv[1]] = kv[2].trim();
      }
      continue;
    }
    if (currentArray) {
      const item = line.match(/^\s+-\s+(.+?)(\s+#.*)?$/);
      if (item) arrays[currentArray].push(item[1].trim());
    }
  }
  fm._arrays = arrays;
  return fm;
}

function bodyHasEmergency(text) {
  // Look in `## bao approval` section for emergency:
  const sec = text.split('## bao approval')[1];
  if (!sec) return false;
  const upTo = sec.split('\n## ')[0];
  return /^\s*-\s*emergency:/m.test(upTo);
}

// Per verification.md §2.1 — 8 triggers
function countTriggers(fm) {
  const hits = [];
  const touches = (fm._arrays && fm._arrays.touches) || [];
  const severity = (fm.severity || '').toUpperCase();
  const downstreamOf = fm.downstream_of || '';

  // 1. touches .olym/steering/protocol/**
  if (touches.some(t => t.startsWith('.olym/steering/protocol/'))) hits.push('#1 protocol-touch');
  // 2. touches lane-ownership.yaml
  if (touches.some(t => t === '.olym/steering/lane-ownership.yaml')) hits.push('#2 lane-yaml-touch');
  // 3. touches olympus-roster.md
  if (touches.some(t => t === '.olym/steering/olympus-roster.md')) hits.push('#3 roster-touch');
  // 4. new spec dir — heuristic: touches contains .olym/specs/<dir>/spec.md (forward-going only, hard to detect at push without git diff state)
  if (touches.some(t => /^.olym\/specs\/[^/]+\/spec\.md$/.test(t))) hits.push('#4 spec-dir');
  // 5. cross-lane — heuristic: count distinct lane prefixes in touches paths.
  // Project-specific: list of top-level dirs that map to lanes (e.g., workers / apps /
  // packages / services / src). Customize for your repo layout.
  const LANE_ROOTS = (process.env.OLYM_LANE_ROOTS || 'workers|apps|packages|services|src').replace(/,/g, '|');
  const laneRootRe = new RegExp(`^(${LANE_ROOTS})/([^/]+)`);
  const laneSet = new Set();
  for (const t of touches) {
    const m = t.match(laneRootRe);
    if (m) laneSet.add(m[2]);
  }
  if (laneSet.size >= 2) hits.push(`#5 cross-lane (${laneSet.size} dirs)`);
  // 6. >=3 file globs in touches
  if (touches.length >= 3) hits.push(`#6 >=3-globs (${touches.length})`);
  // 7. severity P0 or P1
  if (severity === 'P0' || severity === 'P1') hits.push(`#7 severity-${severity}`);
  // 8. downstream_of present
  if (downstreamOf) hits.push('#8 downstream-of');

  return hits;
}

function tierFromHits(hits, fm) {
  // verification.md §2.1: highest-tier override rule
  const touches = (fm._arrays && fm._arrays.touches) || [];
  const severity = (fm.severity || '').toUpperCase();
  if (severity === 'P0') return 'large';
  if (touches.some(t => t.startsWith('.olym/steering/protocol/'))) return 'large';
  if (touches.some(t => t === '.olym/steering/lane-ownership.yaml' || t === '.olym/steering/olympus-roster.md')) return 'large';
  if (hits.length >= 4) return 'large';
  if (hits.length >= 2) return 'medium';
  if (hits.length === 1) return 'small';
  return null;
}

function defaultSpecialistCount(tier) {
  return tier === 'large' ? 3 : tier === 'medium' ? 2 : tier === 'small' ? 1 : 0;
}

function main() {
  const newHandoffs = getNewHandoffs();
  if (newHandoffs.length === 0) {
    process.exit(0);
  }

  const warnings = [];
  for (const path of newHandoffs) {
    const full = join(REPO, path);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;

    // Skip conditions
    const assignedTo = fm.assigned_to || '';
    const lane = fm.lane || '';
    if (assignedTo === 'zeus') continue;
    if (lane === 'zeus-stewardship') continue;
    if (bodyHasEmergency(text)) continue;

    const hits = countTriggers(fm);
    if (hits.length === 0) continue;

    // Check archive existence
    const fileBase = path.replace(/^.olym\/handoffs\//, '').replace(/\.md$/, '');
    const archivePath = `.olym/handoffs/${fileBase}-pre-dispatch-review.md`;
    if (existsSync(join(REPO, archivePath))) continue;

    const tier = tierFromHits(hits, fm);
    const count = defaultSpecialistCount(tier);
    warnings.push({ handoff: path, severity: fm.severity || '?', hits, tier, count, archivePath, assignedTo });
  }

  if (warnings.length === 0) {
    process.exit(0);
  }

  // Soft-warn output to stderr
  process.stderr.write('\n');
  process.stderr.write('================================================================\n');
  process.stderr.write('[pre-push-dispatch] WARN: missing pre-dispatch-review archive(s)\n');
  process.stderr.write('================================================================\n');
  for (const w of warnings) {
    process.stderr.write(`\n  Handoff:        ${w.handoff}\n`);
    process.stderr.write(`  Assigned to:    ${w.assignedTo}\n`);
    process.stderr.write(`  Severity:       ${w.severity}\n`);
    process.stderr.write(`  Triggers (${w.hits.length}): ${w.hits.join(' / ')}\n`);
    process.stderr.write(`  Tier:           ${w.tier} (default ${w.count} specialists)\n`);
    process.stderr.write(`  Missing:        ${w.archivePath}\n`);
  }
  process.stderr.write('\n  Per verification.md §2 — mandatory pre-dispatch review for trigger >=1.\n');
  process.stderr.write('  See spec: .olym/specs/olym-pre-pr-enforce-hook/spec.md\n');
  process.stderr.write('\n  Push continues (soft warn). Resolve before bao audit.\n');
  process.stderr.write('================================================================\n\n');

  // Always exit 0 (never block)
  process.exit(0);
}

main();
