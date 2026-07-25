#!/usr/bin/env node
// hermes-acp-probe — minimal ACP client spike + upgrade contract probe
// (ADR-002 substrate § provider v68; ADR-004 cap § auto-update v10).
// JSON-RPC on stdio: initialize -> session/new -> session/prompt, and
// prints streamed agent_message_chunk text. Exit 0 = ACP contract intact
// (handshake + streaming). Exit non-zero = broken/blocked (logged).
//
// Run: node scripts/probes/hermes-acp-probe.mjs ["your prompt"]
// This is a SPIKE: it validates the single riskiest unknown (hermes streams
// over ACP) before the kernel Rust client is built.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROMPT = process.argv[2] ?? 'Reply with exactly: ACP OK';
const COLD_START_MS = 180_000; // first uvx run resolves the PyPI spec
const TURN_MS = 120_000;

// Read the build-owned Rust constants directly. The probe must validate the
// exact Hermes distribution that this source tree will install, never a mutable
// ~/.ctrl user manifest. (ADR-002 substrate §1.8.4 v62)
const installerSource = readFileSync(
  new URL('../../src-tauri/src/shell/agent_installer.rs', import.meta.url),
  'utf8',
);
function rustStringConst(name) {
  const match = installerSource.match(new RegExp(`pub const ${name}: &str = "([^"]+)";`));
  if (!match) throw new Error(`missing ${name} in agent_installer.rs`);
  return match[1];
}

const hermesVersion = rustStringConst('HERMES_VERSION');
const hermesSpec = rustStringConst('HERMES_ACP_SPEC');
const hermesPython = rustStringConst('HERMES_PYTHON');
if (!hermesSpec.endsWith(`==${hermesVersion}`)) {
  throw new Error(`Hermes source pins disagree: version=${hermesVersion}, spec=${hermesSpec}`);
}

function prepareNamedCustomProxyConfig(config, expectedEndpoint, modelId, proxyUrl) {
  const parts = modelId.split(':');
  if (parts.length < 3 || parts[0] !== 'custom') {
    throw new Error(`custom route attestation requires custom:name:model, received ${modelId}`);
  }
  const providerName = parts[1];
  const escapedName = providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEndpoint = expectedEndpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^\\s*provider:\\s*${escapedName}\\s*$`, 'm').test(config)) {
    throw new Error(`isolated config does not select named provider ${providerName}`);
  }
  if (!new RegExp(`^\\s*${escapedName}:\\s*$`, 'm').test(config)) {
    throw new Error(`isolated config has no descriptor for named provider ${providerName}`);
  }
  const endpointMatches = [...config.matchAll(/^\s*base_url:\s*(.+?)\s*$/gm)];
  if (endpointMatches.length !== 1 || endpointMatches[0][1] !== expectedEndpoint) {
    throw new Error(`isolated named provider endpoint does not match the active endpoint`);
  }
  if (!new RegExp(`^\\s*base_url:\\s*${escapedEndpoint}\\s*$`, 'm').test(config)) {
    throw new Error('isolated named provider endpoint substitution detected');
  }
  return config.replace(/^([ \t]*base_url:\s*).+$/m, `$1${proxyUrl}`);
}

function assertCustomRouteObserved(observation, expectedModel) {
  if (!observation) throw new Error('named custom route was not observed by the loopback proxy');
  if (observation.path !== '/chat/completions') {
    throw new Error(`named custom route used unexpected path ${observation.path}`);
  }
  if (observation.model !== expectedModel) {
    throw new Error(
      `named custom route used model ${JSON.stringify(observation.model)}, expected ${JSON.stringify(expectedModel)}`,
    );
  }
}

if (process.env.HERMES_PROBE_ATTESTATION_SELF_TEST === '1') {
  const sample = [
    'model:',
    '  default: glm-test',
    '  provider: ctrl-release-probe',
    'providers:',
    '  ctrl-release-probe:',
    '    base_url: https://api.example.test/v4',
  ].join('\n');
  prepareNamedCustomProxyConfig(
    sample,
    'https://api.example.test/v4',
    'custom:ctrl-release-probe:glm-test',
    'http://127.0.0.1:1234',
  );
  for (const substituted of [
    sample.replaceAll('ctrl-release-probe', 'other-provider'),
    sample.replace('https://api.example.test/v4', 'https://other.example.test/v4'),
  ]) {
    let rejected = false;
    try {
      prepareNamedCustomProxyConfig(
        substituted,
        'https://api.example.test/v4',
        'custom:ctrl-release-probe:glm-test',
        'http://127.0.0.1:1234',
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('route attestation accepted a substituted provider or endpoint');
  }
  for (const badObservation of [
    null,
    { path: '/v1/responses', model: 'glm-test' },
    { path: '/v1/chat/completions', model: 'glm-test' },
    { path: '/chat/completions', model: 'other' },
  ]) {
    let rejected = false;
    try { assertCustomRouteObserved(badObservation, 'glm-test'); } catch { rejected = true; }
    if (!rejected) throw new Error('route attestation accepted a substituted runtime route');
  }
  console.error('[SELF TEST PASS] named custom route attestation fails closed');
  process.exit(0);
}

let routeProxy;
let routeObservation;
const upstreamBaseUrl = process.env.HERMES_PROBE_UPSTREAM_BASE_URL;
const selectedModelId = process.env.HERMES_ACP_MODEL_ID;
if (upstreamBaseUrl || selectedModelId) {
  if (!upstreamBaseUrl || !selectedModelId) {
    throw new Error('incomplete named custom route-attestation configuration');
  }
  routeProxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const parsed = JSON.parse(body.toString('utf8'));
      routeObservation = { path: request.url ?? '', model: parsed.model };

      const target = `${upstreamBaseUrl.replace(/\/+$/, '')}${request.url ?? ''}`;
      const headers = { ...request.headers };
      for (const name of ['host', 'connection', 'content-length', 'transfer-encoding']) delete headers[name];
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body,
      });
      response.writeHead(upstream.status, Object.fromEntries(
        [...upstream.headers].filter(([name]) => !['content-length', 'transfer-encoding'].includes(name)),
      ));
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
      else response.end();
    } catch (error) {
      response.destroy(error);
    }
  });
  await new Promise((resolve, reject) => {
    routeProxy.once('error', reject);
    routeProxy.listen(0, '127.0.0.1', resolve);
  });
  const address = routeProxy.address();
  if (!address || typeof address === 'string') throw new Error('loopback route proxy has no TCP address');
  const configPath = join(process.env.HERMES_HOME, 'config.yaml');
  const config = readFileSync(configPath, 'utf8');
  const proxied = prepareNamedCustomProxyConfig(
    config,
    upstreamBaseUrl,
    selectedModelId,
    `http://127.0.0.1:${address.port}`,
  );
  writeFileSync(configPath, proxied);
}

const cmd = process.env.CTRL_UVX_BIN ?? join(homedir(), '.ctrl', 'bin', 'uvx');
const args = [
  '--python', hermesPython,
  '--with', 'mcp>=1.24',
  '--from', hermesSpec,
  'hermes-acp',
];
console.error(`[probe] source pin: Hermes ${hermesVersion}`);
console.error(`[probe] spawning: ${cmd} ${args.join(' ')}`);
const childEnv = { ...process.env };
for (const [name, value] of Object.entries(childEnv)) {
  if (value === upstreamBaseUrl) delete childEnv[name];
}
delete childEnv.CUSTOM_BASE_URL;
delete childEnv.OPENAI_BASE_URL;
delete childEnv.HERMES_PROBE_UPSTREAM_BASE_URL;
const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });

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

  const provider = process.env.HERMES_INFERENCE_PROVIDER;
  const model = process.env.HERMES_MODEL;
  if (!provider || !model) throw new Error('launcher did not provide Hermes provider/model selection');
  const modelId = process.env.HERMES_ACP_MODEL_ID ?? `${provider}:${model}`;
  const setModelResult = await send('session/set_model', { sessionId, modelId });
  if (!setModelResult || typeof setModelResult !== 'object') {
    throw new Error(`session/set_model did not acknowledge ${modelId}`);
  }

  // Hermes' set-model response is intentionally empty, so read back its
  // authoritative per-session state through the server-local /model command.
  // This command does not call a provider and therefore cannot be satisfied by
  // a fallback model response. (ADR-004 cap § auto-update v10)
  answer = '';
  await send('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: '/model' }],
  });
  const selectedState = answer.trim();
  const expectedState = `Current model: ${model}\nProvider: ${provider}`;
  if (selectedState !== expectedState) {
    throw new Error(
      `Hermes retained the wrong session model; expected ${JSON.stringify(expectedState)}, ` +
      `received ${JSON.stringify(selectedState)}`,
    );
  }
  console.error(`[probe] authoritative model state verified — ${provider}:${model}`);

  answer = '';
  console.error(`[probe] prompting: "${PROMPT}"\n---`);
  const turnGuard = setTimeout(() => fail(`prompt turn exceeded ${TURN_MS}ms`), TURN_MS);
  const stop = await send('session/prompt', { sessionId, prompt: [{ type: 'text', text: PROMPT }] });
  clearTimeout(turnGuard);
  clearTimeout(guard);
  console.error(`\n---\n[probe] turn done — stopReason=${stop.stopReason ?? JSON.stringify(stop)}`);
  const normalizedAnswer = answer.trim();
  if (normalizedAnswer !== 'ACP OK') {
    fail(`expected streamed assistant text "ACP OK", received ${JSON.stringify(normalizedAnswer)}`);
  }
  if (upstreamBaseUrl) {
    assertCustomRouteObserved(routeObservation, model);
    console.error(`[probe] named custom route verified — ${model} via isolated loopback proxy`);
  }
  console.error('[PROBE PASS] ACP handshake + model state + route + streaming OK');
  child.kill('SIGTERM');
  if (routeProxy) await new Promise((resolve) => routeProxy.close(resolve));
  process.exit(0);
} catch (e) {
  fail(e.message);
}
