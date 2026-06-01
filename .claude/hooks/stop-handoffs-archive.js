#!/usr/bin/env node
/**
 * Stop hook — auto-archive verified/done handoffs on session end.
 *
 * Defensive: only runs when:
 *   - on main branch (not feature branch)
 *   - tree clean (no uncommitted changes)
 *
 * Lane workers (with .lane file) are bypassed entirely — they don't archive.
 *
 * Calls scripts/handoffs-archive.mjs --apply silently. 7-day grace baked into script.
 *
 * Spec: .olym/specs/olym-archive-stop-hook/spec.md (G-026)
 *
 * Always exits 0 (never blocks session end).
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function main() {
  const repo = process.cwd();

  // Lane worker bypass: if .lane file exists in cwd, skip (workers don't archive).
  if (existsSync(join(repo, '.lane'))) {
    process.exit(0);
  }

  // Only run on main branch.
  const branch = run('git symbolic-ref --short HEAD');
  if (branch !== 'main') {
    process.exit(0);
  }

  // Only run when tree clean.
  const status = run('git status --porcelain');
  if (status && status.length > 0) {
    process.exit(0);
  }

  // Run archive with --apply, capture stdout count.
  // Don't block on failure — exit 0 always.
  try {
    const output = execSync('node scripts/handoffs-archive.mjs --apply', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: repo,
    });
    // Surface count if non-zero archive happened.
    // Script --apply output contains "✓ Moved:  N" line; match that.
    const movedMatch = output.match(/Moved:\s+(\d+)/);
    if (movedMatch && parseInt(movedMatch[1], 10) > 0) {
      process.stderr.write(`[stop-archive] ${movedMatch[1]} verified handoff(s) archived to _archive/\n`);
    }
  } catch (e) {
    // Silent — never block session end.
  }

  process.exit(0);
}

main();
