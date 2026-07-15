#!/usr/bin/env node
// Minimal Kiro session context: active goal plus Git truth.

const fs = require('node:fs');
const { execSync } = require('node:child_process');

const root = process.env.KIRO_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT || process.cwd();

function safe(command, fallback) {
  try {
    return execSync(command, { cwd: root, encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const goalPath = `${root}/vault/ctrl/GOAL.md`;
const goal = fs.existsSync(goalPath)
  ? fs.readFileSync(goalPath, 'utf8').trim()
  : '(no active GOAL.md; ask bao before inventing one)';

const branch = safe('git rev-parse --abbrev-ref HEAD', '(unknown)');
const recent = safe('git log --oneline -12', '(no commits)');
const status = safe('git status --short', '(clean)');

process.stdout.write([
  '## Active goal',
  '',
  goal,
  '',
  `## Git branch: ${branch}`,
  '',
  '### Recent commits (implementation truth)',
  recent,
  '',
  '### Working tree',
  status,
  '',
  'Cross-check goal progress against Git before acting or reporting completion.',
].join('\n'));
