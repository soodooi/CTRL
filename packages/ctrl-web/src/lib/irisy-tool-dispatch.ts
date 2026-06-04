// Irisy tool-dispatch — execute `<call name="X">{args}</call>` blocks Pi
// emits inside an assistant turn, then send the results back as a
// follow-up user turn so Pi can keep working.
//
// Background (bao 2026-06-04): Pi runs behind ctrl-pi-plugin's MCP
// server on 17874 with the `ctrl-pi-bridge` extension wired up for
// `text.chat` only. The kernel MCP server (17873) exposes vault/storage
// tools but NOT skills.* / keycap.* — so Pi cannot reach those via its
// own MCP client. Until Pi is taught about the kernel MCP server (a
// larger ctrl-pi-plugin amendment), the PWA acts as a stand-in tool
// dispatcher: it parses the prompt-taught XML protocol, invokes the
// matching Tauri command, and feeds the result back into the chat as a
// `<call-result for="X">…</call-result>` user message.
//
// This unblocks the Irisy first-cap flow Pi is already promtped for:
//   user: "Frontend-slide"
//   Pi  : <call name="list_local_skills">{"keywords": [...]}</call>
//   PWA : (invoke) → <call-result for="list_local_skills">[...]</call-result>
//   Pi  : <call name="install_keycap">{...manifest}</call>
//   PWA : (invoke) → <call-result for="install_keycap">{...}</call-result>
//   Pi  : "Made you a 'Slides' key — click it, type a topic …"

import { invoke } from './bridge';

/** Result of one tool execution, in the shape the chat loop needs. */
export interface DispatchResult {
  /** Tool name (mirrors `<call name="...">`). */
  tool: string;
  /** JSON-stringified result body Pi gets to read. Errors are passed
   *  through as `{"error": "…"}` so Pi can recover gracefully instead of
   *  the dispatcher throwing. */
  body: string;
}

/** One parsed call block as it appears in the assistant content. */
export interface ParsedCall {
  tool: string;
  /** Raw inner text — usually a JSON object, but we tolerate plain text
   *  so Pi can recover from its own malformed emission. */
  args: string;
}

/**
 * Extract every CLOSED `<call name="X">…</call>` block from an assistant
 * turn. Open / partial calls (during streaming) are ignored — they get
 * picked up on the next turn once Pi closes the tag.
 */
export function extractClosedCalls(content: string): ParsedCall[] {
  const re = /<call\s+name="([^"]+)"\s*>([\s\S]*?)<\/call>/g;
  const out: ParsedCall[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const tool = m[1] ?? '';
    const args = (m[2] ?? '').trim();
    if (tool) out.push({ tool, args });
  }
  return out;
}

/**
 * Parse the inner body of a `<call>` block into a JS value. Pi sometimes
 * emits a bare JSON literal, sometimes a wrapped object, sometimes plain
 * text. We try JSON first, then fall through to `{ text: raw }` so the
 * downstream normalizer always has *something* to work with.
 */
function parseArgsLoose(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: trimmed };
  }
}

/** Coerce any value into a normalized search-query string the kernel
 *  `list_local_skills` Tauri command (signature: `query: Option<String>`)
 *  understands. Pi has been observed to emit `{"keywords":["slide",
 *  "frontend"]}` and `{"query":"slide"}` — we accept both. */
function toSearchQuery(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const o = args as Record<string, unknown>;
  const q = o.query;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const k = o.keywords;
  if (Array.isArray(k)) {
    const joined = k
      .filter((x): x is string => typeof x === 'string')
      .join(' ')
      .trim();
    if (joined) return joined;
  }
  // `text` is the loose-parse fallback shape.
  const t = o.text;
  if (typeof t === 'string' && t.trim()) return t.trim();
  return null;
}

/**
 * Normalize + invoke ONE tool. Returns a stringified body suitable for
 * embedding inside `<call-result for="X">…</call-result>`. Never throws
 * — surface errors as `{"error": "…"}` strings so the chat loop can
 * forward them to Pi which can then recover or apologize.
 */
async function dispatchOne(call: ParsedCall): Promise<DispatchResult> {
  const args = parseArgsLoose(call.args);
  try {
    switch (call.tool) {
      case 'list_local_skills': {
        const query = toSearchQuery(args);
        const items = await invoke<
          Array<{ name: string; description?: string | null; path: string }>
        >('list_local_skills', { query });
        return { tool: call.tool, body: JSON.stringify(items ?? [], null, 2) };
      }
      case 'install_keycap': {
        // Accept either:
        //   { manifest: {...}, server_code?: "", server_code_filename?: "" }
        //   { ...manifest fields }     ← Pi sometimes flattens
        const o = (args ?? {}) as Record<string, unknown>;
        const hasManifestKey =
          typeof o.manifest === 'object' && o.manifest !== null;
        const payload = hasManifestKey
          ? {
              manifest: o.manifest,
              server_code:
                typeof o.server_code === 'string' ? o.server_code : '',
              server_code_filename:
                typeof o.server_code_filename === 'string'
                  ? o.server_code_filename
                  : '',
            }
          : {
              manifest: o,
              server_code: '',
              server_code_filename: '',
            };
        const summary = await invoke<unknown>('install_keycap', {
          args: payload,
        });
        return { tool: call.tool, body: JSON.stringify(summary, null, 2) };
      }
      case 'list_keycaps': {
        const items = await invoke<unknown>('list_keycaps');
        return { tool: call.tool, body: JSON.stringify(items ?? [], null, 2) };
      }
      case 'vault_write': {
        // Inline write to the user's vault. Lets Irisy fulfil one-shot
        // requests ("write me a markdown about X", "save this as a note")
        // WITHOUT installing a keycap. The Tauri command's `keycap_id` is
        // omitted so the call runs in "ctrl-system" full-access mode —
        // appropriate for the user's own AI companion writing on their
        // behalf. Strict input: path + content required, frontmatter
        // optional (default `{}`).
        const o = (args ?? {}) as Record<string, unknown>;
        const path = typeof o.path === 'string' ? o.path : '';
        const content = typeof o.content === 'string' ? o.content : '';
        if (!path) {
          return {
            tool: call.tool,
            body: JSON.stringify(
              { error: 'vault_write: missing "path"' },
              null,
              2,
            ),
          };
        }
        const frontmatter =
          typeof o.frontmatter === 'object' && o.frontmatter !== null
            ? o.frontmatter
            : {};
        const reply = await invoke<unknown>('vault_write', {
          args: { path, content, frontmatter },
        });
        return { tool: call.tool, body: JSON.stringify(reply, null, 2) };
      }
      case 'vault_read': {
        const o = (args ?? {}) as Record<string, unknown>;
        const path = typeof o.path === 'string' ? o.path : '';
        if (!path) {
          return {
            tool: call.tool,
            body: JSON.stringify(
              { error: 'vault_read: missing "path"' },
              null,
              2,
            ),
          };
        }
        const entry = await invoke<unknown>('vault_read', {
          args: { path },
        });
        return { tool: call.tool, body: JSON.stringify(entry, null, 2) };
      }
      default: {
        return {
          tool: call.tool,
          body: JSON.stringify(
            { error: `unknown tool "${call.tool}" — not in PWA dispatch whitelist` },
            null,
            2,
          ),
        };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      tool: call.tool,
      body: JSON.stringify({ error: message }, null, 2),
    };
  }
}

/** Dispatch every closed `<call>` in `assistantContent`. Empty list when
 *  Pi did not emit any tool calls — caller should stop the loop. */
export async function dispatchAllCalls(
  assistantContent: string,
): Promise<DispatchResult[]> {
  const calls = extractClosedCalls(assistantContent);
  if (calls.length === 0) return [];
  const out: DispatchResult[] = [];
  for (const c of calls) {
    out.push(await dispatchOne(c));
  }
  return out;
}

/** Format dispatch results as the chat-side user turn that Pi will read
 *  next. Pi's prompt expects `<call-result for="X">…</call-result>`
 *  blocks — one per call, in the order they were issued. */
export function formatResultsAsUserTurn(results: DispatchResult[]): string {
  return results
    .map((r) => `<call-result for="${r.tool}">\n${r.body}\n</call-result>`)
    .join('\n\n');
}

// ADR-002 substrate § brain v7 §1.1 + ADR-005 irisy v4 §7.6 (2026-06-04):
// Provider-aware tool path. Frontier providers (Claude, GPT) speak
// native function calling — ctrl-pi-bridge's `registerTool()` makes the
// 10 kernel tools first-class to Pi, so the model never has to emit
// `<call>` XML; calls execute via the bridge and the model sees the
// result inline. Non-frontier providers (Volc / Qwen / Llama / Kimi /
// DeepSeek / Google) lack interoperable native function-calling, so the
// PWA's XML protocol stays in the system prompt and this dispatcher
// runs the loop.
//
// Active provider id comes from BrainState.providers['irisy.primary'].id
// (commands/provider.rs::brain_status). Match by prefix because user-
// installed manifests may carry suffixed ids (`anthropic-api-claude-3-5`).
const FRONTIER_PROVIDER_PREFIXES = [
  'claude-oauth',
  'anthropic-api',
  'anthropic-',
  'claude-',
  'openai-api',
  'openai-',
  'gpt-',
];

/** Return true when the provider id designates a frontier model that
 *  supports native function calling. Frontier path skips the XML loop. */
export function isFrontierNativeProvider(activeProviderId: string | undefined | null): boolean {
  if (!activeProviderId) return false;
  const id = activeProviderId.toLowerCase();
  return FRONTIER_PROVIDER_PREFIXES.some((p) => id.startsWith(p));
}
