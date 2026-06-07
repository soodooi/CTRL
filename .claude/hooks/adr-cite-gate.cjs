#!/usr/bin/env node
// adr-cite-gate.js — PreToolUse Edit/Write hook. ADR-002 substrate § provider
// v8 (2026-06-06) lock + memory `feedback_use_adr_acceptance_as_checklist.md`
// rule: any non-trivial edit on architecture-critical files must cite the
// governing ADR section in either the new code OR the surrounding session
// context (last ~30 transcript events). Edits without ADR citation are
// patch-style and get blocked.
//
// Architecture-critical paths (any of these substrings in file_path):
//   - kernel/provider/
//   - commands/provider
//   - commands/irisy
//   - commands/brain
//   - shell/brain_supervisor
//   - shell/kernel_supervisor
//   - ctrl-pi-plugin/src/
//   - ctrl-pi-bridge/src/
//   - ctrl-web/src/components/irisy/
//   - ctrl-web/src/lib/usePiRpc
//
// Exit codes:
//   0   = decision JSON written to stdout
//   ≠0  = hook failure (fail open)

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

const ARCH_PATHS = [
  'kernel/provider/',
  'commands/provider',
  'commands/irisy',
  'commands/brain',
  'shell/brain_supervisor',
  'shell/kernel_supervisor',
  'ctrl-pi-plugin/src/',
  'ctrl-pi-bridge/src/',
  'ctrl-web/src/components/irisy/',
  'ctrl-web/src/lib/usePiRpc',
];

const ADR_CITE_PATTERN = /ADR-\d{3}\s*(substrate|spine|frontend|cap|irisy|cross-cutting|workbench)?\s*§/i;

(async () => {
  let payload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw);
  } catch {
    approve('hook payload parse failed — fail open');
    return;
  }

  const filePath = (payload?.tool_input?.file_path ?? '').toString();
  if (!filePath) {
    approve('no file_path in tool_input');
    return;
  }
  const isArch = ARCH_PATHS.some((p) => filePath.includes(p));
  if (!isArch) {
    approve('non-architecture file');
    return;
  }

  // Inspect the new_string / content being written for inline ADR cite.
  const newContent =
    payload?.tool_input?.new_string ??
    payload?.tool_input?.content ??
    '';
  if (ADR_CITE_PATTERN.test(newContent)) {
    approve('ADR cite present in new content');
    return;
  }

  // Walk transcript backwards looking for ADR cite in recent assistant
  // messages (so spreading the cite across the conversation is OK — the
  // assistant cited it in the planning paragraph above this edit).
  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    block(
      `Edit on architecture file ${filePath} blocked: no ADR-NNN §section cite ` +
        'in new content and no transcript available to verify recent cite. ' +
        'Add cite (eg "ADR-002 § provider v8 §3.5") to the edit OR your ' +
        'planning message.',
    );
    return;
  }

  let lines;
  try {
    const all = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
    lines = all.slice(-30);
  } catch {
    approve('transcript read failed — fail open');
    return;
  }

  for (const line of lines) {
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    const tc = evt?.message?.content;
    if (typeof tc === 'string') {
      if (ADR_CITE_PATTERN.test(tc)) {
        approve('ADR cite found in recent assistant message');
        return;
      }
    } else if (Array.isArray(tc)) {
      for (const b of tc) {
        const text = b?.text ?? b?.input?.new_string ?? b?.input?.content ?? '';
        if (typeof text === 'string' && ADR_CITE_PATTERN.test(text)) {
          approve('ADR cite found in recent message content');
          return;
        }
      }
    }
  }

  block(
    [
      `Edit on architecture file ${filePath} blocked.`,
      '',
      'Per memory feedback_use_adr_acceptance_as_checklist.md:',
      '  "代码注释引 ADR §+日期; 注释没引 = 我没读过 ADR 的物证"',
      '',
      'No ADR cite (ADR-NNN § … vN) found in either:',
      '  (a) the new_string/content being written',
      '  (b) your last 30 transcript events',
      '',
      'Add a cite. Examples:',
      '  // ADR-002 substrate § provider v8 §3.5 (2026-06-06): ...',
      '  /* per ADR-005 irisy v4 §7.2 — ... */',
      '',
      'Then re-attempt the edit.',
    ].join('\n'),
  );
})();
