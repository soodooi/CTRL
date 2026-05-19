// claude-cli-shim — OpenAI-compatible /v1/chat/completions shim
// Translates OpenAI requests to `claude -p ... --output-format stream-json`
// subprocess calls, streams events back as OpenAI SSE.
//
// Designed to plug into Hermes Agent's custom_providers list.

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ---- config ----

const PORT = Number(process.env.PORT ?? 8787);
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const DEFAULT_MODEL = process.env.CLAUDE_DEFAULT_MODEL ?? 'claude-haiku-4-5';
const SPAWN_CWD = process.env.CLAUDE_SPAWN_CWD ?? '/tmp';
const MAX_BUDGET_USD = process.env.CLAUDE_MAX_BUDGET_USD ?? '0.50';

// ---- types ----

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model?: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

// ---- prompt assembly ----

function splitSystemAndConversation(messages: OpenAIMessage[]): {
  system: string;
  prompt: string;
} {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const conversation = messages.filter((m) => m.role !== 'system');
  const system = systemMessages.map((m) => m.content).join('\n\n');
  const prompt = conversation
    .map((m) => {
      const tag = m.role === 'user' ? 'User' : 'Assistant';
      return `${tag}: ${m.content}`;
    })
    .join('\n\n');
  return { system, prompt };
}

// ---- response framing ----

function makeChunk(id: string, model: string, delta: string | null, finishReason: string | null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: delta != null ? { content: delta } : {},
        finish_reason: finishReason,
      },
    ],
  };
}

function makeFinal(id: string, model: string, content: string, usage: any) {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage,
  };
}

// ---- core: spawn claude + stream events ----

interface StreamCallbacks {
  onDelta: (text: string) => void;
  onResult: (final: { text: string; usage: any; cost_usd: number; duration_ms: number }) => void;
  onError: (e: Error) => void;
  onClose: () => void;
}

function spawnClaude(model: string, system: string, prompt: string, cb: StreamCallbacks) {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--tools',
    '',
    '--max-budget-usd',
    MAX_BUDGET_USD,
    '--model',
    model,
  ];
  if (system.length > 0) {
    args.push('--append-system-prompt', system);
  }

  const child = spawn(CLAUDE_BIN, args, {
    cwd: SPAWN_CWD,
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let textAcc = '';
  let usage: any = null;
  let cost_usd = 0;
  let duration_ms = 0;

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      handleEvent(event);
    }
  });

  function handleEvent(event: any) {
    const t = event.type;
    if (t === 'stream_event') {
      const delta = event?.event?.delta?.text;
      if (typeof delta === 'string' && delta.length > 0) {
        textAcc += delta;
        cb.onDelta(delta);
      }
    } else if (t === 'result') {
      usage = event.usage ?? null;
      cost_usd = event.total_cost_usd ?? 0;
      duration_ms = event.duration_ms ?? 0;
      // text from result is the recap; we already streamed it
      cb.onResult({ text: textAcc, usage, cost_usd, duration_ms });
    }
    // ignore: system, assistant (final block — duplicate of stream_event), rate_limit_event
  }

  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    process.stderr.write(`[claude stderr] ${chunk}`);
  });

  child.on('error', cb.onError);
  child.on('close', cb.onClose);

  return child;
}

// ---- HTTP handlers ----

function sendJSON(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  let body: ChatCompletionRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch (e: any) {
    return sendJSON(res, 400, { error: { message: `invalid JSON: ${e.message}` } });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return sendJSON(res, 400, { error: { message: 'messages required' } });
  }

  const model = body.model ?? DEFAULT_MODEL;
  const id = `chatcmpl-${randomUUID().slice(0, 12)}`;
  const stream = body.stream === true;
  const { system, prompt } = splitSystemAndConversation(body.messages);

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let abortedByClient = false;
    req.on('close', () => {
      abortedByClient = true;
      child?.kill('SIGTERM');
    });
    const child = spawnClaude(model, system, prompt, {
      onDelta: (text) => {
        if (abortedByClient) return;
        res.write(`data: ${JSON.stringify(makeChunk(id, model, text, null))}\n\n`);
      },
      onResult: () => {
        if (abortedByClient) return;
        res.write(`data: ${JSON.stringify(makeChunk(id, model, null, 'stop'))}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
      },
      onError: (e) => {
        if (abortedByClient) return;
        res.write(`data: ${JSON.stringify({ error: { message: e.message } })}\n\n`);
        res.end();
      },
      onClose: () => {
        if (!res.writableEnded) res.end();
      },
    });
  } else {
    let finalText = '';
    let finalUsage: any = null;
    const child = spawnClaude(model, system, prompt, {
      onDelta: (text) => {
        finalText += text;
      },
      onResult: ({ text, usage }) => {
        finalText = text;
        finalUsage = usage;
      },
      onError: (e) => {
        sendJSON(res, 500, { error: { message: e.message } });
      },
      onClose: () => {
        if (res.writableEnded) return;
        sendJSON(res, 200, makeFinal(id, model, finalText, finalUsage));
      },
    });
  }
}

function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  sendJSON(res, 200, { status: 'ok', service: 'claude-cli-shim', model: DEFAULT_MODEL });
}

// ---- server ----

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/healthz') return handleHealth(req, res);
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') return handleChat(req, res);
  sendJSON(res, 404, { error: { message: 'not found' } });
});

server.listen(PORT, () => {
  console.log(`[claude-cli-shim] listening on http://localhost:${PORT}`);
  console.log(`[claude-cli-shim] CLAUDE_BIN=${CLAUDE_BIN} model=${DEFAULT_MODEL} budget=$${MAX_BUDGET_USD}`);
});
