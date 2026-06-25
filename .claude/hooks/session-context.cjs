#!/usr/bin/env node
// session-context.js — SessionStart hook. Minimal single-dev context: inject
// the active goal (vault/ctrl/GOAL.md) + current git state. No fleet, no
// handoffs — the multi-agent layer was stripped 2026-06-19
// (see vault/ctrl/harness-minimal.md).

const fs = require('node:fs');
const { execSync } = require('node:child_process');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function safe(fn, fallback = '') {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const goalPath = `${root}/vault/ctrl/GOAL.md`;
const goal = fs.existsSync(goalPath)
  ? fs.readFileSync(goalPath, 'utf-8').trim()
  : '(no GOAL.md — run /goal set <goal> to anchor this session)';

const branch = safe(() =>
  execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).toString().trim(),
);
const status =
  safe(() => execSync('git status --short', { cwd: root }).toString().trim()) ||
  '(clean)';
// Recent commits — the truth GOAL.md cannot stale. 2026-06-22: a whole session
// drifted because GOAL listed SC8 as "todo" while `9016c05 feat(sc8)` was
// already committed. status alone hid it (committed work shows nothing); the
// log surfaces it. Always cross-check GOAL progress against this.
const recentLog =
  safe(() => execSync('git log --oneline -12', { cwd: root }).toString().trim()) ||
  '(no commits)';

const ctx = [
  '## Active goal (vault/ctrl/GOAL.md)',
  '',
  goal,
  '',
  `## Git — branch \`${branch}\` (⚠ verify GOAL progress against real commits — docs can go stale)`,
  '',
  '### Recent commits (what actually shipped)',
  recentLog,
  '',
  '### Working tree (uncommitted)',
  status,
].join('\n');

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: ctx,
    },
  }),
);
process.exit(0);
