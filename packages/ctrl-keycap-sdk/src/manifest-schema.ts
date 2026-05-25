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

// Keycap target — orthogonal to `variant`. Declares the *role* a keycap
// plays in the CTRL surface so the kernel can route requests correctly.
// Introduced 2026-05-25 (H-2026-05-25-001) when bao approved Pi as default
// brain — brain runtimes are keycaps, not kernel-level primitives.
//
//   mcp-tool     — one-shot tool call. Default for ~90% of keycaps.
//   hermes-skill — rich SKILL.md-driven keycap (optional, advanced).
//   brain        — pluggable agent runtime that owns `text.chat` (or any
//                  capability the keycap declares via `capability`). The
//                  user's active brain keycap is the answer for any
//                  inbound capability call from Irisy. Examples: Pi
//                  (default), hermes (optional), claude-shim (dev-only).
//
// See .olym/specs/tool-manifest/spec.md §13.
export const KeycapTarget = z.enum(['mcp-tool', 'hermes-skill', 'brain']);
export type KeycapTarget = z.infer<typeof KeycapTarget>;

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
  /** Author/creator notes — why this step is here. Surfaces in Irisy's
   *  review pane + Patch tier diff. Pipedream-style annotation pattern. */
  notes: z.string().optional(),
  /** Optional example IO captured at design time. n8n-style: keeps a
   *  golden input/output sample so Patch tier can baseline upstream
   *  changes and Irisy can infer typing without running the step.
   *  Inputs are post-template-resolution; outputs are the raw step result. */
  recorded_io: z
    .object({
      input: z.unknown().optional(),
      output: z.unknown().optional(),
      recorded_at: z.string().optional(),
    })
    .optional(),
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
  /** Inline system prompt (mutually exclusive with `system_ref`). */
  system: z.string().optional(),
  /** Reference to a named prompt in the kernel prompt registry —
   *  resolved at dispatch time. Path: `~/.ctrl/.irisy-prompts/<name>.md`
   *  (or `<name>.v2.md` for a pinned version when `system_ref` ends in
   *  `@v<n>`). G10 substrate; loads body as the actual system prompt. */
  system_ref: z.string().optional(),
  /** Inline user prompt (mutually exclusive with `prompt_ref`). */
  prompt: z.string().optional(),
  /** Reference to a named user-prompt template. Same registry as
   *  system_ref. Use the same `@v<n>` pinning convention. */
  prompt_ref: z.string().optional(),
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

/** Composition step: invoke another callable thing by id. Abstracts
 *  over keycaps, external MCP tools, and hermes skills behind one
 *  step type so workshop canvas (drag base keycap onto graph) +
 *  Irisy compositions don't have to know transport details.
 *
 *  `target.kind` decides routing:
 *    keycap  → kernel run_keycap(id, action_id, inputs)
 *    mcp     → kernel mcp_proxy_call(server_id, tool_name, args)
 *    skill   → hermes runtime invocation (~/.hermes/skills/<id>/)
 *
 *  Matches the more abstract design favored after the 2026-05 workshop
 *  research pass (n8n / Pipedream show value in polymorphic step refs;
 *  Figma agents call into Figma via MCP tools — same shape). */
const InvokeStep = StepCommon.extend({
  type: z.literal('invoke'),
  target: z.object({
    kind: z.enum(['keycap', 'mcp', 'skill']),
    /** Provider-specific id. keycap → keycap.id. mcp → "server_id/tool".
     *  skill → hermes skill id (folder name under ~/.hermes/skills/). */
    id: z.string().min(1),
    /** keycap.kind only: which action to invoke (default: keycap's first action). */
    action: z.string().optional(),
  }),
  /** Mustache-templated arg passing into the target. */
  inputs: z.record(z.string(), z.string()).optional(),
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
  InvokeStep,
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

// ── Icon (legacy string OR richer asset descriptor) ─────────────────────

/** Icon address. Two shapes coexist:
 *  - **Legacy string** — Lucide name OR single Unicode char (what the
 *    16 v0.1 builtins use). Preserved indefinitely for back-compat.
 *  - **Object form** — for SVG / Lottie / dotLottie state machines
 *    routed through IconRenderer (28d6873). The workshop icon palette
 *    emits this form; legacy keycaps emit strings.
 *
 *  Both are valid manifest input; downstream renderer disambiguates. */
export const KeycapIcon = z.union([
  z.string().min(1),
  z.object({
    kind: z.enum(['lucide', 'unicode', 'svg', 'lottie', 'dotlottie']),
    /** Lucide name / Unicode char / vault- or app-relative asset path. */
    src: z.string().min(1),
    /** Color overrides for dotLottie state machines. */
    theme: z
      .object({
        colorRefs: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    /** Initial state for state-machine icons (e.g. IrisyMascot 6-state). */
    initial_state: z.string().optional(),
  }),
]);
export type KeycapIcon = z.infer<typeof KeycapIcon>;

// ── Lineage (Patch/Fork tier upstream tracking) ─────────────────────────

/** Set on `keycap fork` / `keycap patch-init`. Records what the keycap
 *  derived from so the 3-tier adjustment model can offer cherry-pick
 *  hints (Patch tier) or just attribute upstream (Fork tier).
 *
 *  Matches the memory `decision_keycap_3_tier_adjustment` Config/Patch/Fork
 *  model. Config tier doesn't fork the manifest at all, so it carries no
 *  lineage. Patch + Fork tiers do. */
export const Lineage = z.object({
  upstream_id: z.string().min(1),
  upstream_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[a-z0-9.\-]+)?$/, {
      message: 'upstream_version must be semver',
    }),
  tier: z.enum(['patch', 'fork']),
  /** ISO timestamp of the fork moment. */
  forked_at: z.string().optional(),
  /** Patch tier — captured upstream baseline for the fields the patch
   *  overrides. Dotted JSON pointers → original values. Lets Irisy say
   *  "upstream changed X; do you want to cherry-pick or stay on baseline?". */
  patch_baseline: z.record(z.string(), z.unknown()).optional(),
  /** Optional cached diff snapshot (small JSON-patch-shape array). */
  diff_snapshot: z.unknown().optional(),
});
export type Lineage = z.infer<typeof Lineage>;

// ── Draft metadata (workshop in-flight authoring) ───────────────────────

/** Marks the manifest as a draft (not yet installed). Workshop / Irisy
 *  authoring flow sets this; `install_keycap` clears it. Kernel sandbox
 *  uses the presence of this block to gate `run_keycap_draft` and to
 *  show a "Draft" badge in PWA. */
export const DraftMeta = z.object({
  /** Stable draft id, separate from the keycap id (which may be empty
   *  during authoring). Matches the directory name under
   *  ~/.ctrl/keycaps/.drafts/<draft-id>/. */
  id: z.string().min(1),
  created_at: z.string(),
  last_run_at: z.string().optional(),
});
export type DraftMeta = z.infer<typeof DraftMeta>;

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

  /** Icon — legacy string (Lucide name / Unicode char) OR richer object
   *  form for SVG / Lottie / dotLottie state-machine assets. */
  icon: KeycapIcon,

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

  /** Role of this keycap in the CTRL surface. Orthogonal to `variant`:
   *  variant says *how* it runs, target says *what role* it plays.
   *  Absent → `mcp-tool` (the default). `brain` is special — kernel's
   *  brain router selects exactly one active brain keycap per user. */
  target: KeycapTarget.optional(),

  /** Brain-keycap only: the kernel capability this brain answers
   *  (`text.chat`, `text.embed`, `image.generate`, …). Read by the
   *  kernel brain router to dispatch the right capability to the right
   *  brain. Ignored for non-brain targets. */
  capability: z.string().optional(),

  /** Brain-keycap only: name of the npm bridge package the kernel
   *  supervisor spawns to talk to this brain (e.g. `@ctrl/pi-plugin`).
   *  Ignored for non-brain targets. */
  bridge: z.string().optional(),

  /** Brain-keycap only: when true, CTRL does NOT proxy LLM credentials
   *  — the brain runtime owns its own provider config (e.g. ~/.pi/config).
   *  Default true for `target: brain` to preserve the Obsidian "no
   *  second copy of user state" philosophy. */
  provider_passthrough: z.boolean().optional(),

  /** Actions the user can invoke. Most keycaps have exactly one. */
  actions: z.array(Action).min(1),

  /** Trigger hints (hotkey / context-menu / spotlight); engine TBD. */
  triggers: z.array(z.object({
    kind: z.enum(['hotkey', 'context-menu', 'spotlight']),
    binding: z.string().optional(),
  })).optional(),

  /** SPDX license identifier (e.g., "MIT", "Apache-2.0", "ISC",
   *  "AGPL-3.0-or-later"). Optional. Drives the marketplace listing's
   *  license badge + the kernel's THIRD_PARTY_LICENSES.md generator. */
  license: z.string().optional(),

  /** Authoring-time draft metadata. Present = the manifest hasn't been
   *  installed yet (it lives under ~/.ctrl/keycaps/.drafts/<id>/). The
   *  install_keycap path strips this block on install. */
  draft: DraftMeta.optional(),

  /** Lineage — set when this keycap was derived from another via the
   *  Patch/Fork tiers of the 3-tier adjustment model. Absent on
   *  greenfield + Config-tier keycaps. */
  lineage: Lineage.optional(),
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
