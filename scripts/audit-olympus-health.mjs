#!/usr/bin/env node
/**
 * Olym Pipeline · audit-olympus-health
 *
 * Static health audit across the 5 Olym layers (Identity / Knowledge /
 * Protocol / Tooling / Pipeline). Each layer runs a set of file-existence,
 * structure, and SSOT checks. Outputs human-readable markdown by default,
 * JSON with --json (CI-friendly).
 *
 * Spec: .olym/specs/olympus/spec.md §10 (audit dimension olympus_layer_health)
 *
 * Usage:
 *   node scripts/audit-olympus-health.mjs              # human report
 *   node scripts/audit-olympus-health.mjs --json       # JSON report (CI)
 *   node scripts/audit-olympus-health.mjs --layer 2    # only Knowledge layer
 *   node scripts/audit-olympus-health.mjs --strict     # exit 1 if any layer < 100%
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const args = process.argv.slice(2);
const JSON_MODE = args.includes('--json');
const STRICT = args.includes('--strict');
const layerArg = args.find(a => a.startsWith('--layer='));
const LAYER_FILTER = layerArg ? parseInt(layerArg.split('=')[1], 10) : null;

// ── helpers ──

function rel(p) { return join(REPO_ROOT, p); }
function fileExists(p) { return existsSync(rel(p)); }
async function readText(p) { try { return await readFile(rel(p), 'utf8'); } catch { return null; } }
async function listDir(p) { try { return await readdir(rel(p)); } catch { return []; } }
async function dirStat(p) { try { return await stat(rel(p)); } catch { return null; } }

function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = {};
  for (const line of text.slice(3, end).trim().split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (m) fm[m[1].toLowerCase()] = m[2].trim();
  }
  return fm;
}

async function check(name, fn) {
  try {
    const r = await fn();
    if (typeof r === 'boolean') return { name, ok: r };
    return { name, ok: r.ok, detail: r.detail };
  } catch (e) {
    return { name, ok: false, detail: `error: ${e.message}` };
  }
}

// ── Layer 1 · Identity ──

async function identityChecks() {
  return [
    await check('olympus-roster.md present',
      () => fileExists('.olym/steering/olympus-roster.md')),
    await check('lane-ownership.yaml present',
      () => fileExists('.olym/steering/lane-ownership.yaml')),
    await check('.claude/agents/ dir present',
      () => fileExists('.claude/agents')),
    await check('roster lists at least 10 personas', async () => {
      const t = await readText('.olym/steering/olympus-roster.md');
      // Match @persona or **@persona** anywhere in roster lines (case-insensitive)
      const m = t ? (t.match(/@[a-z][a-z0-9_-]+/gi) || []) : [];
      const unique = new Set(m.map(s => s.toLowerCase()));
      return { ok: unique.size >= 10, detail: `${unique.size} unique @-mentions` };
    }),
    await check('memory convention documented in CLAUDE.md', async () => {
      // Memory itself lives at ~/.claude/projects/<project>/memory/ (per-user, not in repo).
      // Audit only verifies the convention is documented.
      const t = await readText('CLAUDE.md');
      if (!t) return { ok: false, detail: 'CLAUDE.md missing' };
      const ok = /memory|MEMORY\.md|olym|olympus/i.test(t);
      return { ok, detail: ok ? 'memory or olym referenced' : 'no memory/olym pointer' };
    }),
  ];
}

// ── Layer 2 · Knowledge ──

async function knowledgeChecks() {
  const checks = [];

  checks.push(await check('CLAUDE.md present',
    () => fileExists('CLAUDE.md')));

  checks.push(await check('docs/handbook/ source-of-truth present',
    () => fileExists('docs/handbook/.vitepress/config.ts')));

  // Specs archive in use
  checks.push(await check('specs use _archive/ pattern', async () => {
    const archived = await listDir('.olym/specs/_archive');
    return { ok: archived.length > 0, detail: `${archived.length} year buckets` };
  }));

  // Handoffs archive in use
  checks.push(await check('handoffs use _archive/ pattern', async () => {
    const archived = await listDir('.olym/handoffs/_archive');
    return { ok: archived.length > 0, detail: `${archived.length} month buckets` };
  }));

  // Active spec count cap
  checks.push(await check('active spec count <= 40', async () => {
    const all = await listDir('.olym/specs');
    const active = all.filter(n => !n.startsWith('_') && !n.startsWith('.'));
    return { ok: active.length <= 40, detail: `${active.length} active` };
  }));

  // Active handoff count cap
  checks.push(await check('active handoff count <= 50', async () => {
    const all = await listDir('.olym/handoffs');
    const active = all.filter(n => /^H-.*\.md$/.test(n));
    return { ok: active.length <= 50, detail: `${active.length} active` };
  }));

  // SSOT: db-schema. Three legitimate locations:
  //   - CLAUDE.md (developer-onboarding quickref table)
  //   - database-naming.md (naming convention authority)
  //   - db-schema-snapshot.md (actual schema DDL with binding section headers)
  // project-rules.md must NOT duplicate (refer to canonical instead).
  checks.push(await check('SSOT: db-schema mentioned in <= 3 canonical places', async () => {
    const candidates = [
      'CLAUDE.md',
      '.olym/steering/database-naming.md',
      '.olym/steering/db-schema-snapshot.md',
      '.olym/steering/project-rules.md',
    ];
    let hits = 0;
    const hitFiles = [];
    for (const p of candidates) {
      const t = await readText(p);
      if (t && /PRODUCTS_DB|BUSINESS_DB|SYSTEM_DB/.test(t)) {
        hits++;
        hitFiles.push(p.split('/').pop());
      }
    }
    return { ok: hits <= 3, detail: `${hits} files: ${hitFiles.join(', ')} (target ≤ 3)` };
  }));

  // SSOT: git-workflow
  checks.push(await check('SSOT: git-workflow not redundantly defined', async () => {
    const candidates = [
      '.olym/steering/protocol/git.md',
      '.olym/steering/project-rules.md',
      'CLAUDE.md',
    ];
    let hits = 0;
    for (const p of candidates) {
      const t = await readText(p);
      if (t && /\[H-YYYY-MM-DD-NNN\]|squash-verify/.test(t)) hits++;
    }
    return { ok: hits <= 2, detail: `${hits} files defining git workflow (target ≤ 2: protocol/git.md + CLAUDE.md quickref)` };
  }));

  // Olym self-aware
  checks.push(await check('Olym self-aware spec exists',
    () => fileExists('.olym/specs/olympus/spec.md')));

  return checks;
}

// ── Layer 3 · Protocol ──

async function protocolChecks() {
  // Olym Protocol layer 6 canonical files (matches actual filenames in repo)
  const six = ['spec-discipline', 'conduct', 'git', 'handoff', 'review', 'knowledge'];
  const checks = [];
  for (const name of six) {
    checks.push(await check(`protocol/${name}.md present`,
      () => fileExists(`.olym/steering/protocol/${name}.md`)));
  }
  return checks;
}

// ── Layer 4 · Tooling ──

async function toolingChecks() {
  return [
    await check('.claude/settings.json valid JSON', async () => {
      const t = await readText('.claude/settings.json');
      if (!t) return { ok: false, detail: 'missing' };
      try { JSON.parse(t); return { ok: true, detail: 'parseable' }; }
      catch (e) { return { ok: false, detail: `parse error: ${e.message}` }; }
    }),
    await check('.claude/skills/ runtime install present', async () => {
      const items = await listDir('.claude/skills');
      return { ok: items.length > 0, detail: `${items.length} skills` };
    }),
    await check('.husky/ hooks present', async () => {
      const items = await listDir('.husky');
      return { ok: items.length > 0, detail: `${items.length} hook files` };
    }),
    await check('.claude/agents/ subagents present', async () => {
      const items = await listDir('.claude/agents');
      return { ok: items.length > 0, detail: `${items.length} agents` };
    }),
    await check('vendor/ dir convention (when present)', async () => {
      // Tracks Tooling-layer convention only when vendor/ is in tree.
      // Use git ls-files to ignore working-tree leftovers from prior branches.
      if (!fileExists('vendor')) return { ok: true, detail: 'no vendor dir (acceptable)' };
      const t = await readText('.gitattributes');
      const ok = !!(t && /vendor\/\*\*\s+linguist-vendored/.test(t));
      return { ok, detail: ok ? 'linguist-vendored declared' : '.gitattributes missing vendor/** linguist-vendored' };
    }),
  ];
}

// ── Layer 5 · Pipeline ──

async function pipelineChecks() {
  return [
    await check('.github/workflows/ dir present', async () => {
      const items = await listDir('.github/workflows');
      const ymls = items.filter(n => n.endsWith('.yml') || n.endsWith('.yaml'));
      return { ok: ymls.length > 0, detail: `${ymls.length} workflows` };
    }),
    await check('handbook-deploy.yml present',
      () => fileExists('.github/workflows/handbook-deploy.yml')),
    await check('legacy-terms-guard.yml present',
      () => fileExists('.github/workflows/legacy-terms-guard.yml')),
    await check('pre-push hook present',
      () => fileExists('scripts/pre-push-check.js')),
    await check('archive scripts present', async () => {
      const a = fileExists('scripts/handoffs-archive.mjs');
      const b = fileExists('scripts/specs-archive.mjs');
      return { ok: a && b, detail: `handoffs:${a?'✓':'✗'} specs:${b?'✓':'✗'}` };
    }),
    await check('cross-cutting audit script present',
      () => fileExists('scripts/audit-cross-cutting.mjs')),
    await check('handbook broken-link CI gate (lychee)', async () => {
      // Acceptable in either handbook-deploy.yml (inline step) or its own
      // workflow handbook-link-check.yml (separated for PR-time enforcement).
      const candidates = [
        '.github/workflows/handbook-deploy.yml',
        '.github/workflows/handbook-link-check.yml',
      ];
      for (const p of candidates) {
        const t = await readText(p);
        if (t && /lychee|broken[\s-]?link/i.test(t)) {
          return { ok: true, detail: `present in ${p.split('/').pop()}` };
        }
      }
      return { ok: false, detail: 'missing — see .olym/specs/olympus/spec.md §6 B-5' };
    }),
  ];
}

// ── orchestration ──

const LAYERS = [
  { num: 1, name: 'Identity',  fn: identityChecks },
  { num: 2, name: 'Knowledge', fn: knowledgeChecks },
  { num: 3, name: 'Protocol',  fn: protocolChecks },
  { num: 4, name: 'Tooling',   fn: toolingChecks },
  { num: 5, name: 'Pipeline',  fn: pipelineChecks },
];

function badge(pct) {
  if (pct >= 100) return '🟢';
  if (pct >= 75)  return '🟡';
  return '🔴';
}

async function main() {
  const layers = [];
  for (const L of LAYERS) {
    if (LAYER_FILTER && L.num !== LAYER_FILTER) continue;
    const checks = await L.fn();
    const passed = checks.filter(c => c.ok).length;
    const total = checks.length;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 100;
    layers.push({ num: L.num, name: L.name, checks, passed, total, pct, badge: badge(pct) });
  }

  const grandPassed = layers.reduce((a, l) => a + l.passed, 0);
  const grandTotal = layers.reduce((a, l) => a + l.total, 0);
  const grandPct = grandTotal > 0 ? Math.round((grandPassed / grandTotal) * 100) : 100;
  const score = grandTotal > 0 ? (10 * grandPassed / grandTotal).toFixed(1) : '10.0';

  if (JSON_MODE) {
    console.log(JSON.stringify({
      generated: new Date().toISOString(),
      score: parseFloat(score),
      pct: grandPct,
      passed: grandPassed,
      total: grandTotal,
      layers: layers.map(l => ({
        layer: l.num,
        name: l.name,
        pct: l.pct,
        badge: l.badge,
        passed: l.passed,
        total: l.total,
        checks: l.checks,
      })),
    }, null, 2));
  } else {
    console.log('');
    console.log('═══ Olym Health Audit ═══');
    console.log('');
    for (const l of layers) {
      const header = `Layer ${l.num} · ${l.name.padEnd(10)} ${l.badge}  ${String(l.pct).padStart(3)}%  (${l.passed}/${l.total} checks)`;
      console.log(header);
      for (const c of l.checks) {
        const mark = c.ok ? '  ✓' : '  ✗';
        const detail = c.detail ? `  — ${c.detail}` : '';
        console.log(`${mark} ${c.name}${detail}`);
      }
      console.log('');
    }
    const summaryBadge = badge(grandPct);
    console.log('═══ Summary ═══');
    console.log(`Overall:  ${score} / 10  ${summaryBadge}  (${grandPct}%, ${grandPassed}/${grandTotal} checks)`);
    const greens = layers.filter(l => l.pct >= 100).length;
    const yellows = layers.filter(l => l.pct >= 75 && l.pct < 100).length;
    const reds = layers.filter(l => l.pct < 75).length;
    console.log(`Layers:   ${greens} 🟢  ${yellows} 🟡  ${reds} 🔴`);
    console.log('');

    const failed = layers.flatMap(l => l.checks.filter(c => !c.ok).map(c => ({ layer: l.num, ...c })));
    if (failed.length > 0) {
      console.log('Pending fixes:');
      for (const f of failed) console.log(`  · Layer ${f.layer}: ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
      console.log('');
    }
  }

  if (STRICT && grandPct < 100) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
