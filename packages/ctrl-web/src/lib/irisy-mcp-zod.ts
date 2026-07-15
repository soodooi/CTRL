// Legacy PWA subset of the MCP manifest contract, initially landed as the
// v0.1 handoff implementation. Executable schema SSOT:
// packages/ctrl-mcp-sdk/src/manifest-schema.ts.
//
// Permissive on capability tokens (string | object with single key) since
// the kernel-side enum is authoritative; we only enforce structural shape.
// Replace this duplicate with the shared SDK schema when all PWA consumers
// can adopt the current manifest version.

import { z } from 'zod';

const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const kebab = z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);

const mcpColor = z.enum(['cobalt', 'amber', 'jade', 'platinum', 'graphite']);

const builtinSource = z.object({
  type: z.literal('builtin'),
  module: kebab,
});

const mcpSource = z.object({
  type: z.literal('mcp'),
  server: z.string().min(1),
  tools: z.array(z.string().min(1)).min(1),
  auto_install: z.boolean().default(true),
});

const oauthSource = z.object({
  type: z.literal('oauth'),
  vendor: z.enum(['feishu', 'coze', 'notion', 'linear', 'slack', 'github', 'custom']),
  oauth_config: z.object({
    auth_url: z.string().url(),
    token_url: z.string().url(),
    scopes: z.array(z.string()),
    client_id_env: z.string().min(1),
  }),
  api_calls: z.array(z.object({
    name: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
    path: z.string().min(1),
    body_schema: z.unknown().optional(),
  })),
});

const localAgentSource = z.object({
  type: z.literal('local_agent'),
  spawn: z.object({
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
  }),
  ipc: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('stdio'), framing: z.enum(['ndjson', 'msgpack']) }),
    z.object({ kind: z.literal('http'), port: z.number().int().positive(), base_path: z.string().min(1) }),
    z.object({ kind: z.literal('socket'), path: z.string().min(1) }),
  ]),
  lifecycle: z.enum(['singleton', 'per_invoke', 'pool']).default('singleton'),
});

const source = z.discriminatedUnion('type', [
  builtinSource,
  mcpSource,
  oauthSource,
  localAgentSource,
]);

// Capability token — permissive: string (bare token like "ClipboardRead")
// or an object with a single key (parametrised token like LlmCall).
const capabilityToken = z.union([z.string().min(1), z.record(z.unknown())]);

const trigger = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hotkey'),
    combo: z.string().min(1),
    contexts: z.array(z.enum(['anywhere', 'editor', 'browser', 'workspace_open'])),
  }),
  z.object({
    kind: z.literal('pool_select'),
    section: z.enum(['top', 'middle', 'bottom', 'custom']).default('middle'),
    rank: z.number().int(),
  }),
  z.object({
    kind: z.literal('context_menu'),
    targets: z.array(z.enum(['text_selection', 'file', 'url'])),
  }),
  z.object({
    kind: z.literal('schedule'),
    cron: z.string().min(1),
  }),
]);

const stateDefinition = z.object({
  on_enter: z.array(z.unknown()).optional(),
  on_event: z.record(z.object({
    target: z.string().min(1),
    actions: z.array(z.unknown()).optional(),
    guard: z.unknown().optional(),
  })).optional(),
  on_exit: z.array(z.unknown()).optional(),
});

const actorFlow = z.object({
  initial: z.string().min(1),
  states: z.record(stateDefinition).refine((s) => Object.keys(s).length > 0, {
    message: 'flow.states must define at least one state',
  }),
});

export const McpManifest = z.object({
  id: kebab,
  version: semver,
  name: z.string().min(1),
  description: z.string().min(1),
  author: z.object({
    handle: z.string().min(1),
    contact: z.string().email().optional(),
  }),
  icon: z.string().min(1),
  mcp_color: mcpColor,
  source,
  capabilities: z.array(capabilityToken).min(1),
  triggers: z.array(trigger).min(1),
  flow: actorFlow,
});

export type McpManifest = z.infer<typeof McpManifest>;

// ── Error classification ───────────────────────────────────────────────
//
// `structural` = wrong type/shape — surface to LLM silently for auto-retry.
// `semantic`   = passes Zod but fails a contextual rule (e.g. id clashes
//                with an installed mcp) — surface to the user in chat.

export type IrisyZodErrorKind = 'structural' | 'semantic';

export interface IrisyZodError {
  kind: IrisyZodErrorKind;
  path: string;
  message: string;
}

export interface ValidateContext {
  installedIds: ReadonlySet<string>;
}

export function validateManifest(
  draft: unknown,
  ctx: ValidateContext,
): { ok: true; manifest: McpManifest } | { ok: false; errors: IrisyZodError[] } {
  const parsed = McpManifest.safeParse(draft);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      kind: 'structural' as const,
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { ok: false, errors };
  }

  const semanticErrors: IrisyZodError[] = [];
  if (ctx.installedIds.has(parsed.data.id)) {
    semanticErrors.push({
      kind: 'semantic',
      path: 'id',
      message: `mcp id "${parsed.data.id}" already exists — pick another name.`,
    });
  }

  if (semanticErrors.length > 0) {
    return { ok: false, errors: semanticErrors };
  }
  return { ok: true, manifest: parsed.data };
}
