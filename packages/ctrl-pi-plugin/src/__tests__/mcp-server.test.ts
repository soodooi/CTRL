// mcp-server smoke tests — validate the MCP envelope and routing without
// requiring Pi. We point $CTRL_PI_BIN at a non-existent path so bridge
// creation fails; the server should still respond to /healthz and
// initialize / tools/list, and report PiNotFoundError on tools/call.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMcpServer, type RunningServer } from '../mcp-server.ts';

const ENV_BIN = 'CTRL_PI_BIN';
const ENV_PORT = 'CTRL_PI_PORT';
const ENV_PATH = 'PATH';

describe('mcp-server (no-pi env)', () => {
  let server: RunningServer | null = null;
  let priorBin: string | undefined;
  let priorPath: string | undefined;
  let priorPort: string | undefined;

  beforeEach(async () => {
    priorBin = process.env[ENV_BIN];
    priorPath = process.env[ENV_PATH];
    priorPort = process.env[ENV_PORT];
    process.env[ENV_BIN] = '/tmp/definitely-not-pi-mcp-server-test';
    process.env[ENV_PATH] = '/var/empty';
    process.env[ENV_PORT] = '0'; // ephemeral
    server = await startMcpServer({ port: 0 });
  });

  afterEach(async () => {
    await server?.shutdown();
    server = null;
    if (priorBin === undefined) delete process.env[ENV_BIN];
    else process.env[ENV_BIN] = priorBin;
    if (priorPath === undefined) delete process.env[ENV_PATH];
    else process.env[ENV_PATH] = priorPath;
    if (priorPort === undefined) delete process.env[ENV_PORT];
    else process.env[ENV_PORT] = priorPort;
  });

  it('serves /healthz with error hint when Pi is missing', async () => {
    if (!server) throw new Error('server not started');
    const res = await fetch(`${server.url}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('responds to initialize even without Pi', async () => {
    if (!server) throw new Error('server not started');
    const res = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe('ctrl-pi-brain');
  });

  it('lists text.chat tool', async () => {
    if (!server) throw new Error('server not started');
    const res = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const body = (await res.json()) as {
      result?: { tools?: Array<{ name?: string }> };
    };
    expect(body.result?.tools?.[0]?.name).toBe('text.chat');
  });

  it('returns error -32004 on tools/call when Pi binary missing', async () => {
    if (!server) throw new Error('server not started');
    const res = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'text.chat',
          arguments: { messages: [{ role: 'user', content: 'hi' }] },
        },
      }),
    });
    const body = (await res.json()) as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32004);
    expect(body.error?.message).toContain('pi binary not found');
  });
});
