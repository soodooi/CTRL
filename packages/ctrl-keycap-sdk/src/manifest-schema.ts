// Keycap manifest schema — single source of truth for the keycap manifest
// shape across PWA, builtin keycap files, Irisy keycap-creator output, and
// the kernel's run_keycap dispatch path.
//
// Per CLAUDE.md design philosophy: keycap manifest is markdown + JSON
// frontmatter (or pure JSON for builtins). Schema is hand-versioned;
// breaking changes bump `manifest_version` so the kernel can detect +
// migrate old keycaps.
//
// Schema reflects what the 16 v1 builtin keycaps actually use:
//   share/modules/builtin/<id>/manifest.json
// plus fields explicitly reserved for OAuth (Pattern E) and MCP server
// (Pattern D) variants the kernel already routes.

import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────────────

export const KeycapColor = z.enum([
  'amber',     // writing / text / chat / language
  'jade',      // safe / done / success / status / read-only
  'cobalt',    // system default / built-in primary
  'platinum',  // neutral utility / converter / format
  'graphite',  // dev / advanced / power-user / debug
]);
export type KeycapColor = z.infer<typeof KeycapColor>;

export const KeycapVariant = z.enum([
  'builtin',         // ships with CTRL, runs in-process via step engine
  'mcp-server',      // third-party MCP server (Pattern D)
  'oauth',           // big-platform OAuth (Feishu / Notion / Linear / Slack)
  'cli-wrapper',     // wraps an external CLI binary (Pattern B)
  'stss-publisher',  // listens on ST-SS bridge for events (Pattern F)
  'local-agent',     // long-running local process (Pattern C)
]);
export type KeycapVariant = z.infer<typeof KeycapVariant>;

export const Permission = z.enum([
  'clipboard',
  'network',
  'screen',
  'filesystem',
  'audio',
  'camera',
  'notification',
  'hotkey',
  'mcp',
  'vault',
  'oauth',
]);
export type Permission = z.infer<typeof Permission>;

// ── Capability declaration (spike 06 §Q2 — structured, gate-enforceable) ─

const HttpMethod = z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

const ClipboardCap = z.object({
  read: z.boolean().default(false),
  write: z.boolean().default(false),
});

const TextTransformOps = z.array(
  z.enum([
    'base64encode', 'base64decode',
    'urlencode', 'urldecode',
    'lowercase', 'uppercase',
    'jsonpretty', 'jsonminify',
    'wordcount',
    'template',
    'tex2svg',
  ]),
);

const TextCap = z.object({
  chat: z.boolean().default(false),
  transform: z.object({ ops: TextTransformOps.optional() }).optional(),
});

const NetworkCap = z.object({
  http: z
    .object({
      allowlist: z.array(z.string().min(1)).min(1),
      methods: z.array(HttpMethod).default(['GET', 'POST']),
      max_request_size_kb: z.number().int().min(1).max(10240).optional(),
    })
    .optional(),
  open_url: z
    .object({
      allowlist: z.array(z.string().min(1)).min(1),
    })
    .optional(),
});

const KeyringCap = z.object({
  read: z.array(z.string().min(1)).default([]),
  write: z.array(z.string().min(1)).default([]),
});

const ScreenCap = z.object({
  capture: z.boolean().default(false),
  list_displays: z.boolean().default(false),
});

const FileCap = z.object({
  read_allowlist: z.array(z.string().min(1)).default([]),
  write_allowlist: z.array(z.string().min(1)).default([]),
});

const McpCap = z.object({
  spawn: z.boolean().default(false),
  invoke: z.boolean().default(false),
  notifications: z.boolean().default(false),
});

const PlatformCap = z.object({
  notify: z.boolean().default(false),
  hotkey: z.boolean().default(false),
});

export const Capabilities = z.object({
  clipboard: ClipboardCap.optional(),
  text: TextCap.optional(),
  network: NetworkCap.optional(),
  keyring: KeyringCap.optional(),
  screen: ScreenCap.optional(),
  file: FileCap.optional(),
  mcp: McpCap.optional(),
  platform: PlatformCap.optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;

// ── Workspace UI dispatch (front-end registry — 9 fixed renderers) ──────

export const WorkspaceUi = z.enum([
  'none',           // no workspace pane
  'notification',   // toast/system notification only
  'modal',          // ephemeral modal with stringified result
  'clipboard',      // clipboard write + confirmation pip
  'html-output',    // MCP content array / CLI stdout — generic structured render
  'chat-stream',    // LLM streaming (ctrl-chat / translate / rewrite)
  'picker',         // option list (snippets / RAG hits)
  'form',           // configure / OAuth / drafted message
  'canvas',         // screen capture region / OCR overlay
]);
export type WorkspaceUi = z.infer<typeof WorkspaceUi>;

// ── Config schema (Irisy configurator mode walks these fields) ──────────
// A keycap declares the values it needs from the user post-install
// (Memos host / API base URL / OAuth scopes / Aria2 RPC port / ...).
// Irisy in configure-keycap mode asks one field at a time, validates,
// then writes config.json + secrets to keychain.

export const ConfigFieldKind = z.enum([
  'string',
  'url',
  'secret',         // routed to macOS Keychain, not config.json
  'integer',
  'boolean',
  'enum',
  'oauth',          // triggers loopback OAuth flow via kernel
]);

export const ConfigField = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/, {
    message: 'config key must be lowercase + underscore',
  }),
  kind: ConfigFieldKind,
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(true),
  default: z.unknown().optional(),
  /** For `enum` kind. */
  options: z.array(z.string()).optional(),
  /** For `oauth` kind: provider + scopes. Kernel oauth.broker resolves. */
  oauth: z
    .object({
      provider: z.string().min(1),
      scopes: z.array(z.string()).default([]),
    })
    .optional(),
  /** Free-form regex validation for `string` / `url` kinds. */
  pattern: z.string().optional(),
});
export type ConfigField = z.infer<typeof ConfigField>;

export const ConfigSchema = z.object({
  fields: z.array(ConfigField).min(1),
});
export type ConfigSchema = z.infer<typeof ConfigSchema>;

// ── Steps (declarative manifest-driven keycap behavior) ─────────────────
// Each step is a single capability call. Step engine runs steps in order,
// passing named outputs (`as`) into subsequent steps via mustache-style
// templates (`{{name}}`). Mirrors the v1 builtin keycap shape.

const StepCommon = z.object({
  /** Optional name to bind this step's output to for later steps. */
  as: z.string().optional(),
});

const CaptureClipboardStep = StepCommon.extend({
  type: z.literal('capture-clipboard'),
});

const WriteClipboardStep = StepCommon.extend({
  type: z.literal('write-clipboard'),
  /** Value to write — mustache template referring to prior step bindings. */
  value: z.string(),
});

const LlmStep = StepCommon.extend({
  type: z.literal('llm'),
  system: z.string().optional(),
  prompt: z.string(),
  model: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const TemplateStep = StepCommon.extend({
  type: z.literal('template'),
  template: z.string(),
});

const TransformStep = StepCommon.extend({
  type: z.literal('transform'),
  op: z.enum([
    'base64encode',
    'base64decode',
    'urlencode',
    'urldecode',
    'uppercase',
    'lowercase',
    'jsonpretty',
    'wordcount',
  ]),
  input: z.string().optional(), // mustache template; defaults to previous output
});

const NotifyStep = StepCommon.extend({
  type: z.literal('notify'),
  title: z.string().optional(),
  message: z.string(),
});

const OpenUrlStep = StepCommon.extend({
  type: z.literal('open-url'),
  url: z.string(),
});

const McpInvokeStep = StepCommon.extend({
  type: z.literal('mcp-invoke'),
  server: z.string(),
  tool: z.string(),
  args: z.unknown().optional(),
});

const VaultWriteStep = StepCommon.extend({
  type: z.literal('vault-write'),
  /** Vault-relative path; supports mustache templates. */
  path: z.string(),
  /** Markdown body content (template). */
  content: z.string(),
  /** Optional frontmatter (template-evaluated object). */
  frontmatter: z.record(z.string(), z.unknown()).optional(),
});

export const Step = z.discriminatedUnion('type', [
  CaptureClipboardStep,
  WriteClipboardStep,
  LlmStep,
  TemplateStep,
  TransformStep,
  NotifyStep,
  OpenUrlStep,
  McpInvokeStep,
  VaultWriteStep,
]);
export type Step = z.infer<typeof Step>;

// ── Actions ──────────────────────────────────────────────────────────────

export const ActionInput = z.enum([
  'clipboard',
  'selection',
  'screen',
  'none',
  'prompt',  // ask user for text input via popup
]);

export const ActionOutput = z.enum([
  'clipboard',
  'modal',
  'notification',
  'workspace',  // render in PWA workspace pane
  'silent',
]);

export const Scene = z.enum([
  'any-app',
  'browser',
  'editor',
  'terminal',
  'office',
  'chat-app',
]);

export const Action = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  input: ActionInput,
  output: ActionOutput,
  scenes: z.array(Scene).optional(),
  steps: z.array(Step).min(1),
});
export type Action = z.infer<typeof Action>;

// ── Author / branding ──────────────────────────────────────────────────

export const Author = z.object({
  name: z.string().min(1),
  github: z.string().optional(),
  url: z.string().url().optional(),
  email: z.string().email().optional(),
});

export const Description = z.object({
  short: z.string().min(1),
  long: z.string().optional(),
});

// ── Source bindings (per ADR-010 5 source types) ─────────────────────────
// Currently only `mcp` carries structured config (server_id + tool_name).
// Builtin / cli-wrapper / oauth / stss leave `source` empty and rely on
// the manifest's `variant` + step content.

export const McpSource = z.object({
  type: z.literal('mcp'),
  server_id: z.string().min(1),
  tool_name: z.string().min(1),
});

export const BuiltinSource = z.object({
  type: z.literal('builtin'),
});

export const OAuthSource = z.object({
  type: z.literal('oauth'),
  provider: z.enum(['feishu', 'notion', 'linear', 'slack', 'github']),
  scopes: z.array(z.string()).optional(),
});

export const CliWrapperSource = z.object({
  type: z.literal('cli-wrapper'),
  command: z.string(),
  args: z.array(z.string()).optional(),
});

export const Source = z.discriminatedUnion('type', [
  McpSource,
  BuiltinSource,
  OAuthSource,
  CliWrapperSource,
]);
export type Source = z.infer<typeof Source>;

// ── Top-level manifest ──────────────────────────────────────────────────

export const KeycapManifest = z.object({
  /** JSON schema URL — informational, not enforced. */
  $schema: z.string().url().optional(),

  /** Stable id, dot-namespaced. e.g. `ctrl.builtin.ai-summarize`. */
  id: z.string().min(1).regex(/^[a-z0-9.\-_]+$/, {
    message: 'id must be lowercase alphanumeric + . - _',
  }),

  /** Manifest format version. v1 = current; bump on breaking schema changes. */
  manifest_version: z.literal(1).default(1),

  /** Human-readable name (i18n-friendly; can be CJK). */
  name: z.string().min(1),

  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.\-]+)?$/, {
    message: 'version must be semver (x.y.z[-prerelease])',
  }),

  author: Author,

  description: Description,

  /** Lucide icon name OR single Unicode char. */
  icon: z.string().min(1),

  keycap_color: KeycapColor.optional(),

  category: z.string().optional(),

  tags: z.array(z.string()).optional(),

  /**
   * Legacy flat permission list (16 v0.1 builtins still use this).
   * Prefer `capabilities` (structured, gate-enforceable) for new manifests.
   */
  permissions: z.array(Permission).optional(),

  /** Structured capability declaration; kernel enforces at run_keycap dispatch. */
  capabilities: Capabilities.optional(),

  /** Workspace UI renderer for this keycap's output. */
  workspace: z
    .object({
      ui: WorkspaceUi.default('none'),
    })
    .optional(),

  /**
   * Fields the user must fill post-install before this keycap can run.
   * Irisy in `configure-keycap` mode walks these one at a time.
   */
  config_schema: ConfigSchema.optional(),

  /** Optional platform restriction. */
  platforms: z.array(z.enum(['macos', 'windows', 'linux'])).optional(),

  /** Tells the kernel which dispatch path to use. */
  variant: KeycapVariant.default('builtin'),

  /** Source binding for non-builtin variants (mcp / oauth / cli-wrapper). */
  source: Source.optional(),

  /** Actions the user can invoke. Most keycaps have exactly one. */
  actions: z.array(Action).min(1),

  /** Trigger hints (hotkey / context-menu / spotlight); engine TBD. */
  triggers: z.array(z.object({
    kind: z.enum(['hotkey', 'context-menu', 'spotlight']),
    binding: z.string().optional(),
  })).optional(),
});
export type KeycapManifest = z.infer<typeof KeycapManifest>;

// ── Parse + validate ─────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  manifest?: KeycapManifest;
  errors: Array<{ path: string; message: string }>;
}

/**
 * Parse a manifest object (already JSON-parsed) and return either the
 * typed manifest or a list of validation errors with paths. Designed
 * for use by:
 *  - kernel's install_keycap (reject malformed at install time)
 *  - keycap CLI lint (developer feedback)
 *  - Irisy keycap-creator (live validation while user fills fields)
 */
export function parseManifest(input: unknown): ValidationResult {
  const result = KeycapManifest.safeParse(input);
  if (result.success) {
    return { ok: true, manifest: result.data, errors: [] };
  }
  return {
    ok: false,
    errors: result.error.issues.map((iss) => ({
      path: iss.path.join('.'),
      message: iss.message,
    })),
  };
}
