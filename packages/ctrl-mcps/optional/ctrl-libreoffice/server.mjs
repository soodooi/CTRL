import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const PROTOCOL_VERSION = '2025-03-26';
const TOOL_NAME = 'read_selected_context';
const MAX_BRIDGE_BYTES = 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 3_000;
const SOURCE_UNAVAILABLE = 'LibreOffice source is unavailable';

export class SourceUnavailableError extends Error {}

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SourceUnavailableError(`selection is missing ${field}`);
  }
  return value;
}

function serialized(value, field) {
  if (value === undefined || value === null) {
    throw new SourceUnavailableError(`selection is missing ${field}`);
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    throw new SourceUnavailableError(`selection has invalid ${field}`);
  }
}

/**
 * Reduce the extension response to the only fields allowed across the private
 * bridge. Unknown document data is deliberately discarded.
 * (ADR-002 substrate §14 v78; ADR-010 communication § transports v13)
 */
export function normalizeSelection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SourceUnavailableError('selection payload is invalid');
  }
  const source = input.selection && typeof input.selection === 'object'
    ? input.selection
    : input;
  const documentType = requiredText(source.document_type, 'document_type').toLowerCase();
  const selectionKind = requiredText(source.selection_kind, 'selection_kind').toLowerCase();
  const validPair = (documentType === 'writer' && selectionKind === 'writer_selection')
    || (documentType === 'calc' && selectionKind === 'calc_range');
  if (!validPair) {
    throw new SourceUnavailableError('no eligible Writer selection or Calc range');
  }

  return {
    document_id: requiredText(source.document_id, 'document_id'),
    document_type: documentType,
    revision: requiredText(String(source.revision ?? ''), 'revision'),
    selection_kind: selectionKind,
    target: requiredText(source.target, 'target'),
    content: serialized(source.content, 'content'),
    formulas: source.formulas === undefined || source.formulas === null
      ? ''
      : serialized(source.formulas, 'formulas'),
    content_hash: requiredText(source.content_hash, 'content_hash'),
  };
}

function privateBridgeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceUnavailableError('bridge URL is invalid');
  }
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (!['http:', 'https:'].includes(url.protocol) || !localHosts.has(url.hostname)) {
    throw new SourceUnavailableError('bridge must use an authenticated loopback endpoint');
  }
  return url;
}

/**
 * Read one explicit selection from the user-installed extension bridge. The
 * token and URL are resolved from the owner-only rendezvous and OS keychain,
 * then injected directly after McpHost clears the child environment. This
 * function never logs either value or selected content.
 * (ADR-004 cap §1 v13; ADR-010 communication § transports v13)
 */
export async function readSelectedContext({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const rawUrl = env.CTRL_LIBREOFFICE_BRIDGE_URL;
  const token = env.CTRL_LIBREOFFICE_BRIDGE_TOKEN;
  if (!rawUrl || !token) {
    throw new SourceUnavailableError('LibreOffice bridge is not configured');
  }
  if (typeof fetchImpl !== 'function') {
    throw new SourceUnavailableError('HTTP client is unavailable');
  }

  const url = privateBridgeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    throw new SourceUnavailableError('LibreOffice bridge is unavailable');
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    throw new SourceUnavailableError('LibreOffice bridge rejected the request');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BRIDGE_BYTES) {
    throw new SourceUnavailableError('LibreOffice selection payload is too large');
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new SourceUnavailableError('LibreOffice bridge returned invalid JSON');
  }
  return { rows: [normalizeSelection(payload)] };
}

function success(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function handleMessage(message, options = {}) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(message?.id ?? null, -32600, 'Invalid Request');
  }
  if (message.method === 'notifications/initialized') return null;
  if (message.method === 'initialize') {
    return success(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'ctrl-libreoffice', version: '0.1.0' },
    });
  }
  if (message.method === 'tools/list') {
    return success(message.id, {
      tools: [{
        name: TOOL_NAME,
        description: 'Read only the explicit non-empty Writer selection or multi-cell Calc range from LibreOffice Companion.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }],
    });
  }
  if (message.method === 'tools/call') {
    if (message.params?.name !== TOOL_NAME) {
      return failure(message.id, -32602, 'Unknown tool');
    }
    try {
      const payload = await readSelectedContext(options);
      return success(message.id, {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      });
    } catch {
      return success(message.id, {
        content: [{ type: 'text', text: SOURCE_UNAVAILABLE }],
        isError: true,
      });
    }
  }
  return failure(message.id ?? null, -32601, 'Method not found');
}

export function runStdioServer() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', async (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify(failure(null, -32700, 'Parse error'))}\n`);
      return;
    }
    const response = await handleMessage(request);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}

// Start only when run as a program, not when imported by a test.
// (ADR-010 communication § transports v13)
//
// Compared through realpath on BOTH sides. `import.meta.url` is always fully
// resolved, while argv[1] is whatever the parent passed, so any symlink in the
// path made these unequal and the server silently did nothing: it exited without
// writing a byte and without an error, and the caller saw the connection close
// during initialize. A CI runner whose workspace sits under a symlinked path hit
// exactly that, and so would any user whose vault or install root is a link.
const startedAsProgram = (() => {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    // The path may not exist to be resolved; fall back to the plain comparison
    // rather than refusing to start.
    return import.meta.url === pathToFileURL(invoked).href;
  }
})();
if (startedAsProgram) {
  runStdioServer();
}
