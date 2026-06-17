#!/usr/bin/env node
// hermes-acp-probe — minimal ACP client spike + upgrade contract probe
// (ADR-002 substrate §1.8.4). Drives hermes-acp over newline-delimited
// JSON-RPC on stdio: initialize -> session/new -> session/prompt, and
// prints streamed agent_message_chunk text. Exit 0 = ACP contract intact
// (handshake + streaming). Exit non-zero = broken/blocked (logged).
//
// Run: node scripts/probes/hermes-acp-probe.mjs ["your prompt"]
// This is a SPIKE: it validates the single riskiest unknown (hermes streams
// over ACP) before the kernel Rust client is built.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROMPT = process.argv[2] ?? 'Reply with exactly: ACP OK';
const COLD_START_MS = 180_000; // first uvx run resolves the PyPI spec
const TURN_MS = 120_000;

// Entry command from the installed manifest (single SSOT — same cmd the
// kernel launcher uses), fall back to the pinned spec.
function entryCmd() {
  try {
    const m = JSON.parse(
      readFileSync(join(homedir(), '.ctrl', 'agents', 'hermes', 'manifest.json'), 'utf8'),
    );
    if (Array.isArray(m.entry_cmd) && m.entry_cmd.length) return m.entry_cmd;
  } catch {}
  return [join(homedir(), '.ctrl', 'bin', 'uvx'), '--from', 'hermes-agent[acp]==0.16.0', 'hermes-acp'];
}

let [cmd, ...args] = entryCmd();
// hermes-agent[acp] needs Python >=3.11; pin it so uv fetches a managed
// CPython instead of falling back to the (too-old) system Python.
if (cmd.endsWith('uvx') && !args.includes('--python')) {
  args = ['--python', '3.12', ...args];
}
console.error(`[probe] spawning: ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

let nextId = 0;
const pending = new Map(); // id -> {resolve, reject}
function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
function reply(id, result) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

let answer = '';
let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line.startsWith('{')) {
      if (line) console.error(`[hermes] ${line}`);
      continue;
    }
    let m;
    try { m = JSON.parse(line); } catch { console.error(`[hermes raw] ${line}`); continue; }
    // Response to one of our requests
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      continue;
    }
    // Notification from agent
    if (m.method === 'session/update') {
      const u = m.params?.update ?? {};
      if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_message') {
        const t = u.content?.text ?? '';
        if (t) { answer += t; process.stdout.write(t); }
      } else {
        console.error(`[update] ${u.sessionUpdate ?? JSON.stringify(u).slice(0, 80)}`);
      }
      continue;
    }
    // Agent -> client REQUEST (has id + method). Answer minimally so the
    // turn never stalls (a trivial prompt shouldn't need tools/permission).
    if (m.id !== undefined && m.method) {
      console.error(`[agent-req] ${m.method} -> minimal reply`);
      if (m.method === 'session/request_permission') {
        reply(m.id, { outcome: { outcome: 'cancelled' } });
      } else if (m.method.startsWith('fs/')) {
        reply(m.id, m.method === 'fs/read_text_file' ? { content: '' } : null);
      } else {
        reply(m.id, null);
      }
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write(`[err] ${d}`));

const fail = (msg) => { console.error(`\n[PROBE FAIL] ${msg}`); child.kill('SIGKILL'); process.exit(1); };
child.on('error', (e) => fail(`spawn error: ${e.message}`));
const guard = setTimeout(() => fail(`no completion within ${COLD_START_MS}ms`), COLD_START_MS);

try {
  const init = await Promise.race([
    send('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } }),
    new Promise((_, r) => setTimeout(() => r(new Error('initialize timeout (cold uvx?)')), COLD_START_MS)),
  ]);
  console.error(`\n[probe] initialize OK — proto ${init.protocolVersion}, auth=${JSON.stringify(init.authMethods ?? [])}`);

  const ns = await send('session/new', { cwd: process.cwd(), mcpServers: [] });
  const sessionId = ns.sessionId ?? ns.session_id;
  console.error(`[probe] session/new OK — ${sessionId}`);

  console.error(`[probe] prompting: "${PROMPT}"\n---`);
  const turnGuard = setTimeout(() => fail(`prompt turn exceeded ${TURN_MS}ms`), TURN_MS);
  const stop = await send('session/prompt', { sessionId, prompt: [{ type: 'text', text: PROMPT }] });
  clearTimeout(turnGuard);
  clearTimeout(guard);
  console.error(`\n---\n[probe] turn done — stopReason=${stop.stopReason ?? JSON.stringify(stop)}`);
  console.error(answer.trim() ? '[PROBE PASS] ACP handshake + streaming OK' : '[PROBE WARN] handshake OK but no text streamed (model/key?)');
  child.kill('SIGTERM');
  process.exit(answer.trim() ? 0 : 2);
} catch (e) {
  fail(e.message);
}
