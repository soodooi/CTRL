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

const ctx = [
  '## Active goal (vault/ctrl/GOAL.md)',
  '',
  goal,
  '',
  `## Git — branch \`${branch}\``,
  '',
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
