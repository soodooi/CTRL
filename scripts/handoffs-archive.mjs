#!/usr/bin/env node
/**
 * Olym Pipeline · handoffs-archive
 *
 * Scan .olym/handoffs/H-*.md, archive closed handoffs to _archive/YYYY-MM/.
 *
 * Closed states: done | verified | superseded | cancelled | completed | closed
 * Open states:   open | in_progress
 *
 * Usage:
 *   node scripts/handoffs-archive.mjs              # dry run (default)
 *   node scripts/handoffs-archive.mjs --apply      # actually move files
 *   node scripts/handoffs-archive.mjs --verbose    # show all (incl. kept)
 */

import { readdir, readFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const HANDOFFS_DIR = join(REPO_ROOT, '.olym', 'handoffs');
const ARCHIVE_ROOT = join(HANDOFFS_DIR, '_archive');

const CLOSED_STATES = new Set([
  'done', 'verified', 'superseded', 'cancelled', 'canceled',
  'completed', 'closed', 'archived', 'wontfix',
]);
const OPEN_STATES = new Set(['open', 'in_progress', 'claimed', 'blocked']);

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose') || args.has('-v');

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(3, end).trim();
  const fm = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (m) fm[m[1].toLowerCase()] = m[2].trim();
  }
  return fm;
}

// G-026 (2026-05-06): 7-day grace period for closed states.
// Avoids archiving handoffs the same day they are verified — PR descriptions and
// dike audit window may still reference them within the first week.
// Spec: .olym/specs/olym-archive-stop-hook/spec.md
const GRACE_DAYS = 7;

function daysSinceUpdated(fm, name) {
  // Prefer `updated:` frontmatter; fall back to filename date pattern H-YYYY-MM-DD-...
  let date;
  if (fm?.updated) {
    const m = fm.updated.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) date = new Date(`${m[1]}-${m[2]}-${m[3]}`);
  }
  if (!date) {
    const m = name.match(/^H-(\d{4})-(\d{2})-(\d{2})-/);
    if (m) date = new Date(`${m[1]}-${m[2]}-${m[3]}`);
  }
  if (!date) return Infinity; // unknown age, treat as past grace
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function classify(name, fm) {
  const status = (fm?.status || '').toLowerCase().split(/[\s,→]/)[0].trim();
  if (CLOSED_STATES.has(status)) {
    const days = daysSinceUpdated(fm, name);
    if (days < GRACE_DAYS) {
      return { archive: false, reason: `status: ${status} but only ${days.toFixed(1)}d old (<${GRACE_DAYS}d grace)` };
    }
    return { archive: true, reason: `status: ${status}, age ${days.toFixed(1)}d` };
  }
  if (OPEN_STATES.has(status))   return { archive: false, reason: `status: ${status}` };

  const m = name.match(/^H-(\d{4})-(\d{2})-/);
  if (!m) return { archive: false, reason: 'no date in filename, keep for review' };
  const fileDate = new Date(`${m[1]}-${m[2]}-01`);
  const monthsAgo = (Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo > 1.5) return { archive: true, reason: `no clear status, age ${monthsAgo.toFixed(1)} months` };
  return { archive: false, reason: 'recent, no clear status' };
}

function targetMonthDir(name) {
  const m = name.match(/^H-(\d{4})-(\d{2})-/);
  return m ? `${m[1]}-${m[2]}` : 'undated';
}

async function main() {
  const entries = await readdir(HANDOFFS_DIR, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && /^H-.*\.md$/.test(e.name)).map(e => e.name);

  const toArchive = [];
  const kept = [];

  for (const name of files) {
    const path = join(HANDOFFS_DIR, name);
    const text = await readFile(path, 'utf8');
    const fm = parseFrontmatter(text);
    const verdict = classify(name, fm);
    if (verdict.archive) toArchive.push({ name, ...verdict });
    else kept.push({ name, ...verdict });
  }

  // ── output ──
  console.log('');
  console.log('═══ Handoffs Archive ═══');
  console.log(`Mode:         ${APPLY ? 'APPLY (will move files)' : 'DRY RUN (no changes)'}`);
  console.log(`Total:        ${files.length}`);
  console.log(`To archive:   ${toArchive.length}`);
  console.log(`To keep:      ${kept.length}`);
  console.log('');

  if (toArchive.length > 0) {
    console.log('── Archive candidates ──');
    const byMonth = new Map();
    for (const item of toArchive) {
      const m = targetMonthDir(item.name);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(item);
    }
    const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [month, items] of sorted) {
      console.log(`  → _archive/${month}/   (${items.length} files)`);
      if (VERBOSE || items.length <= 5) {
        for (const it of items.slice(0, 10)) console.log(`     · ${it.name}  [${it.reason}]`);
        if (items.length > 10) console.log(`     · ... and ${items.length - 10} more`);
      }
    }
    console.log('');
  }

  if (VERBOSE && kept.length > 0) {
    console.log('── Kept (active or recent) ──');
    for (const it of kept) console.log(`  · ${it.name}  [${it.reason}]`);
    console.log('');
  }

  if (!APPLY) {
    console.log('💡 Run with --apply to actually move files.');
    console.log('💡 Run with --verbose to see full breakdown.');
    return;
  }

  // ── apply ──
  let moved = 0, failed = 0;
  for (const item of toArchive) {
    const month = targetMonthDir(item.name);
    const targetDir = join(ARCHIVE_ROOT, month);
    await mkdir(targetDir, { recursive: true });
    const src = join(HANDOFFS_DIR, item.name);
    const dst = join(targetDir, item.name);
    try {
      await rename(src, dst);
      moved++;
    } catch (e) {
      console.error(`  ✗ ${item.name} → ${e.message}`);
      failed++;
    }
  }
  console.log('');
  console.log(`✓ Moved:  ${moved}`);
  if (failed > 0) console.log(`✗ Failed: ${failed}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
