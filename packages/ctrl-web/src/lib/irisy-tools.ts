// Irisy tool registry — frontend-driven ReAct agent loop.
//
// Each tool exposes a name + description + free-form args spec + async
// executor that goes through the Tauri bridge. The agent loop in
// IrisyChat parses `<call>` tags from LLM output, executes the tool, and
// feeds the result back via a `<call-result>` user turn until the LLM
// stops calling tools (or MAX_AGENT_ITERATIONS hits).
//
// Why a prompt-based ReAct loop (not OpenAI function-calling): kernel
// `chat_stream` + Volc adapter don't yet pass OpenAI tool-call frames
// through to the PWA. Once that lands, this file's parser is replaced by
// a structured tool_call event stream and the registry moves to Rust.

import { invoke } from './bridge';
import {
  listKeycaps,
  runKeycap,
  type KeycapSummary,
  type RunKeycapResult,
} from './kernel';

export interface IrisyToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

export interface IrisyTool {
  name: string;
  description: string;
  args: string;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export const IRISY_TOOLS: ReadonlyArray<IrisyTool> = [
  {
    name: 'list_keycaps',
    description: 'List every keycap installed on this device.',
    args: '(no arguments)',
    async execute(): Promise<KeycapSummary[]> {
      return await listKeycaps();
    },
  },
  {
    name: 'run_keycap',
    description:
      'Invoke a keycap. The keycap id MUST be one of those listed in "Installed keycaps".',
    args:
      'id: string (the keycap id), input: object (free-form — for text/translate/clipboard keycaps use {"text": "..."})',
    async execute(args): Promise<RunKeycapResult> {
      const id = String(args.id ?? args.keycap_id ?? '');
      if (!id) throw new Error('run_keycap requires "id"');
      const inputRaw = args.input ?? {};
      const input: Record<string, unknown> =
        typeof inputRaw === 'object' && inputRaw !== null
          ? (inputRaw as Record<string, unknown>)
          : { text: String(inputRaw) };
      return await runKeycap(id, input);
    },
  },
  {
    name: 'vault_search',
    description:
      "Full-text search the user's local markdown vault (FTS5 when available).",
    args: 'query: string, limit?: number',
    async execute(args): Promise<unknown> {
      const query = String(args.query ?? '');
      if (!query) throw new Error('vault_search requires "query"');
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const payload: Record<string, unknown> = { query };
      if (limit !== undefined) payload.limit = limit;
      return await invoke('vault_search', { args: payload });
    },
  },
  {
    name: 'vault_read',
    description: "Read a markdown file from the user's vault by path.",
    args: 'path: string',
    async execute(args): Promise<unknown> {
      const path = String(args.path ?? '');
      if (!path) throw new Error('vault_read requires "path"');
      return await invoke('vault_read', { args: { path } });
    },
  },
  {
    name: 'vault_list',
    description:
      'List markdown files under a vault subdirectory (omit subdir for the root).',
    args: 'subdir?: string',
    async execute(args): Promise<unknown> {
      const subdir = args.subdir == null ? undefined : String(args.subdir);
      const payload = subdir === undefined ? {} : { subdir };
      return await invoke('vault_list', { args: payload });
    },
  },
  {
    name: 'kernel_status',
    description:
      'Report kernel health: uptime, registered LLM adapters, MCP server count.',
    args: '(no arguments)',
    async execute(): Promise<unknown> {
      return await invoke('kernel_status');
    },
  },
  {
    name: 'update_memory',
    description:
      "Write to your long-term memory file (vault path 'irisy/SOUL.md'). Use this to remember facts about the user across sessions — preferences, goals, recurring tasks, important context. The body REPLACES the existing memory; preserve everything still relevant when rewriting. Keep it concise: a markdown summary, not raw chat logs.",
    args: 'body: string (markdown body for the new memory file)',
    async execute(args): Promise<unknown> {
      const body = String(args.body ?? '');
      if (!body) throw new Error('update_memory requires "body"');
      return await invoke('vault_write', {
        args: {
          path: 'irisy/SOUL.md',
          body,
          frontmatter: { updated_at: new Date().toISOString() },
        },
      });
    },
  },
  {
    name: 'read_keycap_manifest',
    description:
      'Read the full manifest.json of a keycap by id. Use when diagnosing why a keycap behaves a certain way, before suggesting a fork, or to inspect available config fields before calling set_keycap_config.',
    args: 'keycap_id: string',
    async execute(args): Promise<unknown> {
      const id = String(args.keycap_id ?? args.id ?? '');
      if (!id) throw new Error('read_keycap_manifest requires "keycap_id"');
      return await invoke('read_keycap_manifest', {
        args: { keycap_id: id },
      });
    },
  },
  {
    name: 'set_keycap_config',
    description:
      "Write the user's override config for a keycap. The config object REPLACES any previous override — call read_keycap_manifest first to learn what fields are valid. ALWAYS ask the user to confirm before writing.",
    args:
      'keycap_id: string, config: object (free-form JSON object of overrides; pass {} to clear)',
    async execute(args): Promise<unknown> {
      const id = String(args.keycap_id ?? args.id ?? '');
      if (!id) throw new Error('set_keycap_config requires "keycap_id"');
      const cfgRaw = args.config ?? {};
      if (
        typeof cfgRaw !== 'object' ||
        cfgRaw === null ||
        Array.isArray(cfgRaw)
      ) {
        throw new Error('set_keycap_config "config" must be a JSON object');
      }
      return await invoke('set_keycap_config', {
        args: {
          keycap_id: id,
          config: cfgRaw as Record<string, unknown>,
        },
      });
    },
  },
  {
    name: 'uninstall_keycap',
    description:
      'Remove an installed keycap. The on-disk directory at ~/.ctrl/keycaps/<id> is deleted. DESTRUCTIVE — ALWAYS ask the user to confirm before calling this tool.',
    args: 'keycap_id: string',
    async execute(args): Promise<unknown> {
      const id = String(args.keycap_id ?? args.id ?? '');
      if (!id) throw new Error('uninstall_keycap requires "keycap_id"');
      return await invoke('uninstall_keycap', {
        args: { keycap_id: id },
      });
    },
  },
  {
    name: 'open_workspace_tab',
    description:
      "Open the user's workspace pane focused on a specific keycap (its history, config, and last invocation results).",
    args: 'keycap_id: string',
    async execute(args): Promise<unknown> {
      const id = String(args.keycap_id ?? args.id ?? '');
      if (!id) throw new Error('open_workspace_tab requires "keycap_id"');
      return await invoke('open_workspace', { keycap_id: id });
    },
  },
  {
    name: 'read_hermes_status',
    description:
      'Re-probe hermes-agent + CTRL kernel status. Returns the same shape irisy_init returns: { kernel_llm, hermes: { binary_path, version, plugin_enabled, brain_configured }, mcp_bridge }. Use when the user asks about hermes / AI brain setup or when troubleshooting.',
    args: '(no arguments)',
    async execute(): Promise<unknown> {
      return await invoke('irisy_init');
    },
  },
];

const TOOL_BY_NAME = new Map(IRISY_TOOLS.map((t) => [t.name, t]));

// Matches:
//   <call name="foo"></call>
//   <call name="foo">{"a":1}</call>
// Stops at the FIRST closing tag — multiple sibling calls are parsed
// independently by matchAll().
const CALL_TAG_RE =
  /<call\s+name="([a-zA-Z_][a-zA-Z0-9_]*)"\s*>([\s\S]*?)<\/call>/g;

export function parseToolCalls(text: string): IrisyToolCall[] {
  const calls: IrisyToolCall[] = [];
  for (const match of text.matchAll(CALL_TAG_RE)) {
    const name = match[1] ?? '';
    if (!name) continue;
    const bodyStr = (match[2] ?? '').trim();
    let args: Record<string, unknown> = {};
    if (bodyStr.length > 0) {
      try {
        const parsed: unknown = JSON.parse(bodyStr);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          args = parsed as Record<string, unknown>;
        } else {
          args = { __parse_warning: 'tool args must be a JSON object' };
        }
      } catch {
        args = { __parse_error: bodyStr };
      }
    }
    calls.push({ name, args, raw: match[0] ?? '' });
  }
  return calls;
}

export async function executeToolCall(call: IrisyToolCall): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(call.name);
  if (!tool) {
    return {
      error: `unknown tool: ${call.name}`,
      available: [...TOOL_BY_NAME.keys()],
    };
  }
  try {
    return await tool.execute(call.args);
  } catch (e: unknown) {
    return {
      error: e instanceof Error ? e.message : 'tool execute failed',
    };
  }
}

export function describeToolsForPrompt(): string {
  const lines: string[] = ['# Available tools', ''];
  for (const t of IRISY_TOOLS) {
    lines.push(`- **${t.name}** — ${t.description}`);
    lines.push(`  args: ${t.args}`);
  }
  lines.push('');
  lines.push('# How to call a tool');
  lines.push('');
  lines.push("When you need data or want to take an action, emit a `<call>`");
  lines.push('block inside your reply. The UI hides the tag and shows a');
  lines.push('"running X…" indicator while the tool runs. The next');
  lines.push('assistant turn sees a `<call-result name="X">…</call-result>`');
  lines.push('user message — keep going from there.');
  lines.push('');
  lines.push('Format:');
  lines.push('  <call name="TOOL_NAME">{"arg":"value"}</call>');
  lines.push('');
  lines.push('Examples:');
  lines.push('  <call name="list_keycaps"></call>');
  lines.push(
    '  <call name="run_keycap">{"id":"ai-translate","input":{"text":"hello"}}</call>',
  );
  lines.push('  <call name="vault_search">{"query":"meeting notes"}</call>');
  lines.push('');
  lines.push('Rules:');
  lines.push("- Only call a tool when you genuinely need data you don't have.");
  lines.push('- Never invent a keycap id that isn\'t in "Installed keycaps".');
  lines.push('- The body MUST be valid JSON (or empty for no-arg tools).');
  lines.push(
    '- After tool results come back, write a plain reply for the user — do not just repeat the JSON.',
  );
  return lines.join('\n');
}

export function formatToolResultForDisplay(result: unknown): string {
  if (result === null || result === undefined) return '(no result)';
  if (typeof result === 'string') return result;
  if (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as { error: unknown }).error === 'string'
  ) {
    return `error: ${(result as { error: string }).error}`;
  }
  const json = JSON.stringify(result, null, 2);
  return json.length > 600 ? `${json.slice(0, 600)}…` : json;
}
