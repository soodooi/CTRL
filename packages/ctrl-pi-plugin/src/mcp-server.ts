// mcp-server — minimal MCP server (HTTP/JSON-RPC) that exposes Pi as the
// CTRL `text.chat` capability for any MCP client.
//
// Protocol surface (MCP 2025-06-18 spec, streamable HTTP transport):
//   POST /mcp        — JSON-RPC 2.0 envelope. Methods: initialize, tools/list,
//                      tools/call (with streaming SSE response when the
//                      `Accept: text/event-stream` header is present).
//   GET  /healthz    — non-MCP liveness probe used by the kernel supervisor
//                      and `npm run test:health`.
//
// We deliberately ship a minimal hand-rolled MCP surface here rather than
// pulling in the official SDK: keeps the brain-keycap glue small enough to
// audit in one sitting, and matches the CTRL kernel's other MCP server (the
// kernel writes its own MCP server too — see ADR-002 substrate § mcp-bus v1 in CLAUDE.md).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PiBridge, type BridgeStatus, type ChatMessage } from './pi-bridge.ts';
import { PiNotFoundError } from './pi-detect.ts';

export interface ServerConfig {
  port: number;
  host: string;
  /** Required Bearer token (matches kernel daemon auth pattern). Set via
   *  CTRL_PI_TOKEN env. When unset, the server falls back to localhost-only
   *  binding with no auth — same posture as the kernel's loopback bridge
   *  pre-token-rotation. */
  token: string | null;
}

const DEFAULT_PORT = 17874; // 17872 = ST-SS, 17873 = kernel MCP, 17874 = pi-brain.
const DEFAULT_HOST = '127.0.0.1';
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = {
  name: 'ctrl-pi-brain',
  version: '0.1.0',
};

const TEXT_CHAT_TOOL = {
  name: 'text.chat',
  description:
    'Send a chat turn to Pi (badlogic/pi-mono coding agent). Streams ' +
    'assistant tokens back as MCP progress events; returns the final ' +
    'assembled message in the tools/call result. Pi handles its own ' +
    'provider configuration (Anthropic / OpenAI / Google / xAI / Groq / ' +
    'Cerebras / Mistral / OpenRouter) via ~/.pi/config — CTRL is provider-' +
    'passthrough for brain keycaps by design.',
  inputSchema: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        description: 'OpenAI-shape conversation history.',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['system', 'user', 'assistant'] },
            content: { type: 'string' },
          },
          required: ['role', 'content'],
        },
      },
      provider: {
        type: 'string',
        description: 'Optional Pi provider override (e.g. "anthropic").',
      },
      model: {
        type: 'string',
        description: 'Optional Pi model override.',
      },
      cwd: {
        type: 'string',
        description:
          'Working directory Pi sees through its read/write/edit/bash tools. ' +
          'Defaults to the MCP server\'s cwd.',
      },
    },
    required: ['messages'],
  },
};

export interface RunningServer {
  url: string;
  port: number;
  shutdown: () => Promise<void>;
}

export async function startMcpServer(
  override: Partial<ServerConfig> = {},
): Promise<RunningServer> {
  const config: ServerConfig = {
    port: override.port ?? Number(process.env.CTRL_PI_PORT ?? DEFAULT_PORT),
    host: override.host ?? process.env.CTRL_PI_HOST ?? DEFAULT_HOST,
    token: override.token ?? process.env.CTRL_PI_TOKEN ?? null,
  };

  let bridge: PiBridge | null = null;
  let bridgeError: Error | null = null;
  try {
    bridge = await PiBridge.create();
  } catch (e) {
    // Defer the error to the first tools/call — health endpoint should
    // still respond so PWA can detect "Pi missing" and prompt the user.
    bridgeError = e instanceof Error ? e : new Error(String(e));
  }

  const server = createServer((req, res) => {
    handleRequest(req, res, config, bridge, bridgeError).catch((e) => {
      writeJsonRpcError(res, null, -32000, e instanceof Error ? e.message : String(e));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  // Resolve the actual bound port — when caller passes `port: 0` (ephemeral),
  // the OS picks one and we must report the real value.
  const address = server.address();
  const boundPort =
    address && typeof address === 'object' ? address.port : config.port;
  const url = `http://${config.host}:${boundPort}`;

  return {
    url,
    port: boundPort,
    shutdown: async () => {
      bridge?.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ── Request routing ─────────────────────────────────────────────────────

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  bridge: PiBridge | null,
  bridgeError: Error | null,
): Promise<void> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildHealth(bridge, bridgeError)));
    return;
  }

  if (!authorised(req, config)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorised' }));
    return;
  }

  if (method !== 'POST' || url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const body = await readBody(req);
  let envelope: JsonRpcEnvelope;
  try {
    envelope = JSON.parse(body) as JsonRpcEnvelope;
  } catch {
    writeJsonRpcError(res, null, -32700, 'parse error');
    return;
  }

  const wantsStream = (req.headers['accept'] ?? '').includes('text/event-stream');

  switch (envelope.method) {
    case 'initialize':
      writeJsonRpcOk(res, envelope.id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: { listChanged: false } },
      });
      return;
    case 'tools/list':
      writeJsonRpcOk(res, envelope.id, { tools: [TEXT_CHAT_TOOL] });
      return;
    case 'tools/call':
      if (!bridge) {
        const msg = bridgeError?.message ?? 'pi bridge unavailable';
        const code = bridgeError instanceof PiNotFoundError ? -32004 : -32001;
        writeJsonRpcError(res, envelope.id, code, msg);
        return;
      }
      await handleToolsCall(res, envelope, bridge, wantsStream);
      return;
    default:
      writeJsonRpcError(res, envelope.id, -32601, `method not found: ${envelope.method}`);
  }
}

async function handleToolsCall(
  res: ServerResponse,
  env: JsonRpcEnvelope,
  bridge: PiBridge,
  wantsStream: boolean,
): Promise<void> {
  const params = env.params as ToolCallParams | undefined;
  if (!params || params.name !== TEXT_CHAT_TOOL.name) {
    writeJsonRpcError(res, env.id, -32602, `unknown tool: ${params?.name ?? '<none>'}`);
    return;
  }

  const args = params.arguments ?? {};
  const messages = Array.isArray(args.messages) ? (args.messages as ChatMessage[]) : null;
  if (!messages) {
    writeJsonRpcError(res, env.id, -32602, '`messages` must be an array');
    return;
  }

  if (wantsStream) {
    // SSE response — emit `delta` events as progress notifications, then
    // a `done` event carrying the final tools/call result envelope. The
    // kernel's MCP host knows how to consume both shapes.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    await bridge.chat(
      {
        messages,
        provider: args.provider,
        model: args.model,
        cwd: args.cwd,
      },
      {
        onChunk: (c) => writeSse(res, 'delta', { delta: c.delta }),
        onFinal: (f) =>
          writeSse(res, 'done', {
            jsonrpc: '2.0',
            id: env.id ?? null,
            result: {
              content: [{ type: 'text', text: f.text }],
              isError: false,
              _meta: {
                duration_ms: f.duration_ms,
                transport: f.transport,
                usage: f.usage,
              },
            },
          }),
        onError: (e) => writeSse(res, 'error', { message: e.message }),
      },
    );
    res.end();
    return;
  }

  // Non-streaming: accumulate then return a single JSON-RPC response.
  let acc = '';
  await new Promise<void>((resolve) => {
    bridge
      .chat(
        {
          messages,
          provider: args.provider,
          model: args.model,
          cwd: args.cwd,
        },
        {
          onChunk: (c) => {
            acc += c.delta;
          },
          onFinal: (f) => {
            writeJsonRpcOk(res, env.id, {
              content: [{ type: 'text', text: f.text || acc }],
              isError: false,
              _meta: {
                duration_ms: f.duration_ms,
                transport: f.transport,
                usage: f.usage,
              },
            });
            resolve();
          },
          onError: (e) => {
            writeJsonRpcError(res, env.id, -32002, e.message);
            resolve();
          },
        },
      )
      .catch((e: unknown) => {
        writeJsonRpcError(res, env.id, -32002, e instanceof Error ? e.message : String(e));
        resolve();
      });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function authorised(req: IncomingMessage, config: ServerConfig): boolean {
  if (!config.token) return true; // localhost-only no-auth mode
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return false;
  const expected = `Bearer ${config.token}`;
  // Length-safe compare — Buffer.compare avoids early-exit timing leak.
  if (header.length !== expected.length) return false;
  return Buffer.compare(Buffer.from(header), Buffer.from(expected)) === 0;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > 4 * 1024 * 1024) {
      throw new Error('request body too large');
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJsonRpcOk(res: ServerResponse, id: unknown, result: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }));
}

function writeJsonRpcError(
  res: ServerResponse,
  id: unknown,
  code: number,
  message: string,
): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }));
}

function writeSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildHealth(bridge: PiBridge | null, bridgeError: Error | null) {
  if (bridge) {
    const status: BridgeStatus = bridge.status();
    return {
      ok: true,
      service: SERVER_INFO,
      protocolVersion: PROTOCOL_VERSION,
      pi: {
        command: status.pi.command,
        via: status.pi.via,
        version: status.pi.version,
      },
      transport: status.transport,
      warm: status.warm,
    };
  }
  return {
    ok: false,
    service: SERVER_INFO,
    error: bridgeError?.message ?? 'pi binary unavailable',
    hint:
      bridgeError instanceof PiNotFoundError
        ? 'Install with `npm i -g @earendil-works/pi-coding-agent` or run via `npx pi`.'
        : undefined,
  };
}

interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: unknown;
  method: string;
  params?: unknown;
}

interface ToolCallParams {
  name: string;
  arguments?: {
    messages?: ChatMessage[];
    provider?: string;
    model?: string;
    cwd?: string;
  };
}
