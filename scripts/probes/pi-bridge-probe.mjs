#!/usr/bin/env node
// Pi → wrapper → ctrl-bridge end-to-end probe.
//
// Tests the FULL production path: PiBridge wrapper (from
// @ctrl/pi-plugin) → Pi's official RpcClient → Pi `--mode rpc`
// subprocess → ctrl-bridge extension → stub kernel /text-chat.
//
// bao 2026-05-31 (122-trail): earlier versions probed Pi directly
// without going through the wrapper, missing wrapper-layer bugs. This
// version exercises the same code path Irisy uses in production.
//
// Exit codes:
//   0 = wrapper.chat() onFinal carried the expected token
//   1 = anything else

import http from 'node:http';
import { existsSync } from 'node:fs';
import { PiBridge } from '../../packages/ctrl-pi-plugin/src/pi-bridge.ts';

const BRIDGE_EXT =
  '/Users/mac/Documents/coding/CTRL/packages/ctrl-pi-bridge/src/index.ts';
const PORT = 18901;
const TIMEOUT_MS = 30_000;
const EXPECT_TOKEN = 'OK';

if (!existsSync(BRIDGE_EXT)) {
  console.error(`[probe] bridge extension not found at ${BRIDGE_EXT}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/text-chat') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    res.write(`event: delta\ndata: {"delta":"${EXPECT_TOKEN}"}\n\n`);
    res.write('event: done\ndata: {"stop_reason":"end_turn"}\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

process.env.CTRL_PROVIDER_PORT = String(PORT);
process.env.CTRL_PROVIDER_TOKEN = 'probe-token';
process.env.CTRL_PI_BRIDGE_EXTENSION = BRIDGE_EXT;
// brain_supervisor sets CTRL_PI_BIN at production spawn time so detectPi
// returns the lazy-installed Pi at `~/.ctrl/pi/...`. Mirror that here so
// `loadPiCodingAgent` walks the same node_modules tree (`pi.command/..`)
// the .app does. Without this the probe could resolve `pi` from PATH
// (e.g. `/opt/homebrew/bin/pi`) and silently hide the production-only
// `Cannot find package` failure mode. bao 2026-05-31 (122-trail diagnose).
const CTRL_PI_BIN = '/Users/mac/.ctrl/pi/node_modules/.bin/pi';
if (existsSync(CTRL_PI_BIN)) {
  process.env.CTRL_PI_BIN = CTRL_PI_BIN;
}

const bridge = await PiBridge.create();

const timeout = setTimeout(() => {
  console.error(`[probe] FAIL — ${TIMEOUT_MS}ms TIMEOUT`);
  bridge.shutdown();
  server.close();
  process.exit(1);
}, TIMEOUT_MS);

await new Promise((resolve) => {
  bridge.chat(
    {
      messages: [
        { role: 'user', content: `reply with just the two letters ${EXPECT_TOKEN}` },
      ],
    },
    {
      onChunk: () => {},
      onFinal: (f) => {
        clearTimeout(timeout);
        const pass = f.text.includes(EXPECT_TOKEN);
        if (pass) {
          console.log(
            `[probe] PASS — wrapper.chat() returned ${JSON.stringify(f.text)} via Pi RpcClient`,
          );
        } else {
          console.error(
            `[probe] FAIL — expected ${EXPECT_TOKEN}, got ${JSON.stringify(f.text)}`,
          );
        }
        bridge.shutdown();
        server.close();
        setTimeout(() => process.exit(pass ? 0 : 1), 100);
        resolve();
      },
      onError: (e) => {
        clearTimeout(timeout);
        console.error('[probe] FAIL — wrapper.chat() errored:', e.message);
        bridge.shutdown();
        server.close();
        setTimeout(() => process.exit(1), 100);
        resolve();
      },
    },
  );
});
