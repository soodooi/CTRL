#!/usr/bin/env node
/**
 * Olym Pipeline · specs-archive
 *
 * Scan .olym/specs/ for spec.md (in subdirs) or top-level .md files,
 * archive shipped/done specs to _archive/YYYY/.
 *
 * Closed statuses: shipped | done | completed | archived | superseded
 * Active statuses: active | draft | in_progress | proposal
 *
 * Usage:
 *   node scripts/specs-archive.mjs              # dry run (default)
 *   node scripts/specs-archive.mjs --apply      # actually move
 *   node scripts/specs-archive.mjs --verbose    # show all
 *   node scripts/specs-archive.mjs --review     # show "needs manual review"
 */

import { readdir, readFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SPECS_DIR = join(REPO_ROOT, '.olym', 'specs');
const ARCHIVE_ROOT = join(SPECS_DIR, '_archive');

const CLOSED_STATES = new Set(['shipped', 'done', 'completed', 'archived', 'superseded', 'cancelled']);
const ACTIVE_STATES = new Set(['active', 'draft', 'in_progress', 'proposal']);

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose') || args.has('-v');
const REVIEW = args.has('--review');

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

function classify(fm, mtime) {
  const status = (fm?.status || '').toLowerCase().split(/[\s,]/)[0].trim();
  if (CLOSED_STATES.has(status)) return { kind: 'archive', reason: `status: ${status}` };
  if (ACTIVE_STATES.has(status))  return { kind: 'keep', reason: `status: ${status}` };
  const monthsOld = (Date.now() - mtime) / (1000 * 60 * 60 * 24 * 30);
  if (monthsOld > 6) return { kind: 'review', reason: `no status, ${monthsOld.toFixed(1)} months old — manual review` };
  return { kind: 'keep', reason: status ? `status: ${status} (unknown)` : 'no status, recent' };
}

function archiveYear(fm, mtime) {
  if (fm?.created) {
    const m = fm.created.match(/^(\d{4})/);
    if (m) return m[1];
  }
  return new Date(mtime).getUTCFullYear().toString();
}

async function newestMtime(dir) {
  let latest = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isFile()) {
      const st = await stat(p);
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } else if (e.isDirectory()) {
      const sub = await newestMtime(p);
      if (sub > latest) latest = sub;
    }
  }
  return latest;
}

async function discoverSpecs() {
  const entries = await readdir(SPECS_DIR, { withFileTypes: true });
  const specs = [];
  for (const e of entries) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;

    if (e.isDirectory()) {
      const dirPath = join(SPECS_DIR, e.name);
      const specPath = join(dirPath, 'spec.md');
      try {
        const text = await readFile(specPath, 'utf8');
        const st = await stat(specPath);
        specs.push({ kind: 'dir', format: 'unified', id: e.name, path: dirPath, specFile: specPath, text, mtime: st.mtimeMs });
      } catch {
        // legacy 3-file format: requirements.md + design.md + tasks.md
        const mtime = await newestMtime(dirPath);
        specs.push({ kind: 'dir', format: 'legacy', id: e.name, path: dirPath, specFile: null, text: '', mtime });
      }
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== '_index.md') {
      const path = join(SPECS_DIR, e.name);
      const text = await readFile(path, 'utf8');
      const st = await stat(path);
      specs.push({ kind: 'file', format: 'unified', id: e.name.replace(/\.md$/, ''), path, specFile: path, text, mtime: st.mtimeMs });
    }
  }
  return specs;
}

async function main() {
  const specs = await discoverSpecs();

  const toArchive = [];
  const toKeep = [];
  const toReview = [];

  for (const s of specs) {
    let v;
    let fm = null;
    if (s.format === 'unified') {
      fm = parseFrontmatter(s.text);
      v = classify(fm, s.mtime);
    } else {
      const monthsOld = (Date.now() - s.mtime) / (1000 * 60 * 60 * 24 * 30);
      v = { kind: 'review', reason: `legacy 3-file format, last touched ${monthsOld.toFixed(1)} months ago` };
    }
    const item = { ...s, ...v, year: archiveYear(fm, s.mtime), status: fm?.status || '(none)' };
    if (v.kind === 'archive') toArchive.push(item);
    else if (v.kind === 'review') toReview.push(item);
    else toKeep.push(item);
  }

  console.log('');
  console.log('═══ Specs Archive ═══');
  console.log(`Mode:               ${APPLY ? 'APPLY (will move dirs/files)' : 'DRY RUN (no changes)'}`);
  console.log(`Total specs:        ${specs.length}`);
  console.log(`To archive (✓):     ${toArchive.length}`);
  console.log(`To keep (active):   ${toKeep.length}`);
  console.log(`Manual review (?):  ${toReview.length}`);
  console.log('');

  if (toArchive.length > 0) {
    console.log('── Archive candidates ──');
    const byYear = new Map();
    for (const it of toArchive) {
      if (!byYear.has(it.year)) byYear.set(it.year, []);
      byYear.get(it.year).push(it);
    }
    for (const [year, items] of [...byYear.entries()].sort()) {
      console.log(`  → _archive/${year}/   (${items.length})`);
      for (const it of items) console.log(`     · ${it.id}  [${it.reason}]`);
    }
    console.log('');
  }

  if (toReview.length > 0) {
    console.log('── Need manual review (no status, > 6 months) ──');
    for (const it of toReview) console.log(`  ? ${it.id}  [${it.reason}]`);
    console.log('  (these are NOT auto-archived. Run with --review to focus on these.)');
    console.log('');
  }

  if (VERBOSE && toKeep.length > 0) {
    console.log('── Active (kept) ──');
    for (const it of toKeep) console.log(`  · ${it.id}  [${it.reason}]`);
    console.log('');
  }

  if (REVIEW) {
    console.log('💡 To archive a manually-reviewed spec, add `status: shipped` (or done/superseded) to its frontmatter, then re-run.');
    return;
  }

  if (!APPLY) {
    console.log('💡 Run with --apply to actually move dirs/files.');
    console.log('💡 Run with --review to focus on items needing manual judgment.');
    console.log('💡 Run with --verbose to see active specs too.');
    return;
  }

  let moved = 0, failed = 0;
  for (const item of toArchive) {
    const targetDir = join(ARCHIVE_ROOT, item.year);
    await mkdir(targetDir, { recursive: true });
    const dst = join(targetDir, item.kind === 'dir' ? item.id : `${item.id}.md`);
    try {
      await rename(item.path, dst);
      moved++;
    } catch (e) {
      console.error(`  ✗ ${item.id} → ${e.message}`);
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
