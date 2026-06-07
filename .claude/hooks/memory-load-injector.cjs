#!/usr/bin/env node
// memory-load-injector.js — UserPromptSubmit hook. Injects "required reading"
// list as a systemMessage when the user prompt touches topics where I have
// historically patched instead of doing systems thinking.
//
// Triggers on keywords in the user prompt. Inject memory file paths +
// optional skill names so the assistant MUST Read them before acting.
//
// ADR-002 substrate § provider v8 (2026-06-06) + bao 2026-06-06
// "你一直存在问题" — automated reflex that compensates for my failure to
// recall memory voluntarily.
//
// Exit code 0 always (this hook never blocks — only injects context).

const fs = require('node:fs');
const path = require('node:path');

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
  });
}

const MEMORY_BASE =
  '/Users/mac/.claude/projects/-Users-mac-Documents-coding-CTRL/memory';

// Topic → required reading. Each entry is an array of {path, why}.
// Add new topics as they emerge from feedback patterns.
const TOPIC_RULES = [
  {
    name: 'provider-or-brain-or-build',
    keywords: [
      /provider/i,
      /brain/i,
      /irisy/i,
      /\bship\b/i,
      /\bbuild\b/i,
      /\binstall\b/i,
      /\bdebug\b/i,
      /\bfix\b/i,
      /test/i,
      /verify/i,
      /pi[- ]bridge/i,
      /ctrl-bridge/i,
    ],
    required: [
      {
        file: 'feedback_patch_quilt_vs_system_thinking.md',
        why: 'stop patching symptoms; look at stderr / logs / source first',
      },
      {
        file: 'feedback_verify_runtime_not_design.md',
        why: 'verify the actual running state before claiming anything',
      },
      {
        file: 'feedback_use_adr_acceptance_as_checklist.md',
        why: 'ADR § acceptance is the checklist; cite section in new code',
      },
    ],
    skills: [
      'verification-before-completion',
      'systematic-debugging',
    ],
  },
  {
    name: 'arch-or-refactor',
    keywords: [
      /refactor/i,
      /架构|重构|系统级/,
      /SSOT/i,
      /redesign/i,
      /\bADR\b/,
    ],
    required: [
      {
        file: 'feedback_no_redundancy_one_ssot.md',
        why: 'one SSOT; replacements must retire predecessors not coexist',
      },
      {
        file: 'feedback_no_unilateral_downgrade.md',
        why: 'do not downgrade hard option to easier one without ask',
      },
    ],
    skills: ['systematic-debugging'],
  },
];

(async () => {
  let payload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw);
  } catch {
    // Silent: hook should never crash the session.
    process.exit(0);
  }

  const prompt = (payload?.user_prompt ?? '').toString();
  if (!prompt) process.exit(0);

  const hits = TOPIC_RULES.filter((rule) =>
    rule.keywords.some((re) => re.test(prompt)),
  );
  if (hits.length === 0) process.exit(0);

  // Collect unique required files + skills across all matched topics.
  const filesMap = new Map();
  const skills = new Set();
  for (const hit of hits) {
    for (const r of hit.required) {
      const full = path.join(MEMORY_BASE, r.file);
      if (fs.existsSync(full) && !filesMap.has(full)) {
        filesMap.set(full, r.why);
      }
    }
    for (const s of hit.skills ?? []) skills.add(s);
  }

  if (filesMap.size === 0 && skills.size === 0) process.exit(0);

  const lines = [
    'Required reading for this task (do BEFORE proposing any action):',
    '',
  ];
  for (const [filePath, why] of filesMap.entries()) {
    lines.push(`  • Read ${filePath}`);
    lines.push(`      reason: ${why}`);
  }
  if (skills.size > 0) {
    lines.push('');
    lines.push('Active skill protocols (cite when you apply):');
    for (const s of skills) {
      lines.push(`  • /${s}`);
    }
  }
  lines.push('');
  lines.push(
    'Per bao 2026-06-06 "你一直存在问题": cite at least one of the above ' +
      "in your next response. No-cite = patch-mode, will be called out.",
  );

  const out = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') } };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})();
