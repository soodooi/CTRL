#!/usr/bin/env node
// verification-gate.js — PreToolUse Bash hook. ADR-002 substrate § provider
// v8 (2026-06-06) lock + memory `feedback_patch_quilt_vs_system_thinking.md`
// rule #2: don't ship before fresh verification evidence exists in the
// session.
//
// Triggers on Bash commands that ship or commit (tauri:build, cp -R CTRL.app
// into /Applications, git commit). Walks the session transcript backwards
// looking for fresh verification commands. Block if absent.
//
// Verification evidence = any of these tool calls within the recent
// transcript window:
//   - `npm run typecheck`        (TS green)
//   - `cargo check` / `cargo test` / `cargo build`  (Rust green)
//   - any `curl` against 127.0.0.1:17873 (kernel gate smoke test)
//   - any `playwright` run        (UI rendered + visually verified)
//
// Exit codes:
//   0   = decision JSON written to stdout
//   ≠0  = hook failure (don't block — fail open so we don't lock the user out)

const fs = require('node:fs');

function approve(reason) {
  process.stdout.write(JSON.stringify({ decision: 'approve', reason }) + '\n');
  process.exit(0);
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
  });
}

(async () => {
  let payload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw);
  } catch {
    approve('hook payload parse failed — fail open');
    return;
  }

  const cmd = (payload?.tool_input?.command ?? '').toString();
  // Only gate ship/commit-style commands. Everything else passes through.
  const SHIP_PATTERNS = [
    /tauri:?build/,
    /tauri\s+build/,
    /cp\s+-[Rr]\s+.+CTRL\.app\s+\/Applications\b/,
    /rm\s+-rf\s+\/Applications\/CTRL\.app/,
    /git\s+commit/,
    /git\s+push/,
  ];
  const isShipCmd = SHIP_PATTERNS.some((re) => re.test(cmd));
  if (!isShipCmd) {
    approve('non-ship command, gate not applicable');
    return;
  }

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    approve('transcript unavailable — fail open');
    return;
  }

  // Walk the FULL transcript backwards collecting the last N Bash
  // tool_use commands. jsonl lines include user msgs / system reminders /
  // assistant text that dominate the count, so a line-window misses Bash
  // calls (e.g. 200 lines = ~6 Bash). Walking by tool_use count gives a
  // reliable verify→ship window regardless of how chatty the surrounding
  // turns are. N=25 covers realistic verify→fix→verify→ship cycles.
  // ADR-002 § provider v8 + ADR-001 spine § byo-cli-driver (gate :17873).
  const VERIFY_PATTERNS = [
    /npm\s+run\s+typecheck/,
    /npx\s+tsc\b/,
    /cargo\s+(check|test|build|clippy)/,
    /curl\s+.*(127\.0\.0\.1|localhost):17873/,
    /playwright/i,
  ];
  const BASH_WINDOW = 25;

  let allLines;
  try {
    allLines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
  } catch {
    approve('transcript read failed — fail open');
    return;
  }

  let foundVerify = false;
  let bashSeen = 0;
  for (let i = allLines.length - 1; i >= 0 && bashSeen < BASH_WINDOW; i--) {
    let evt;
    try { evt = JSON.parse(allLines[i]); } catch { continue; }
    const tc = evt?.message?.content;
    if (!Array.isArray(tc)) continue;
    for (const block of tc) {
      if (block?.type !== 'tool_use') continue;
      if (block?.name !== 'Bash') continue;
      bashSeen++;
      const cmd2 = block?.input?.command ?? '';
      if (VERIFY_PATTERNS.some((re) => re.test(cmd2))) {
        foundVerify = true;
        break;
      }
    }
    if (foundVerify) break;
  }

  if (foundVerify) {
    approve('verification evidence found in recent transcript');
    return;
  }

  block(
    [
      `ship command "${cmd.slice(0, 80)}" blocked — no verification evidence in last 25 Bash calls.`,
      '',
      'Per memory feedback_patch_quilt_vs_system_thinking.md rule #2 + skill',
      'verification-before-completion: run one of these BEFORE shipping:',
      '  • npm run typecheck                  (TS compile clean)',
      '  • cargo check                        (Rust compile clean)',
      '  • curl http://127.0.0.1:17873/...    (kernel gate smoke)',
      '  • npx playwright ...                 (UI rendered + visually checked)',
      '',
      'Then re-attempt the ship command.',
    ].join('\n'),
  );
})();
