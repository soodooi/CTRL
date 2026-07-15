// Mcp manifest schema — single source of truth for the mcp manifest
// shape across PWA, builtin mcp files, Irisy mcp-creator output, and
// the kernel's run_mcp dispatch path.
//
// Per .kiro/steering/development-philosophy.md: mcp manifest is markdown +
// JSON frontmatter (or pure JSON for builtins). Schema is hand-versioned;
// breaking changes bump `manifest_version` so the kernel can detect +
// migrate old mcps.
//
// Schema covers two manifest generations:
//  - v1: legacy shape that the original 16 demo mcps used (deleted in
//    PR #62 "drop hermes, clear demo mcps"). v1 manifests now consist
//    of only the 2 builtins in packages/ctrl-mcps/builtin/ + any
//    user-installed mcps under ~/.ctrl/mcps/. Fields like the flat
//    `permissions: string[]` list survive for back-compat parsing.
//  - v2: ADR-002 substrate § composition v1 6-axis composition model (additive top-level fields:
//    builtin / pattern / brain_capabilities / ui_surface / skills /
//    cap_asset). v1 parsers still accept v2 manifests because all v2
//    fields are optional; v2 parsers respect the v1 shape.
//
// Plus fields explicitly reserved for OAuth (Pattern E) and MCP server
// (Pattern D) variants the kernel already routes.

import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────────────

export const McpColor = z.enum([
  'amber',     // writing / text / chat / language
  'jade',      // safe / done / success / status / read-only
  'cobalt',    // system default / built-in primary
  'platinum',  // neutral utility / converter / format
  'graphite',  // dev / advanced / power-user / debug
]);
export type McpColor = z.infer<typeof McpColor>;

const ActiveMcpVariant = z.enum([
  'builtin',         // ships with CTRL, runs in-process via step engine
  'mcp-server',      // third-party MCP server (Pattern D)
  'oauth',           // big-platform OAuth (Feishu / Notion / Linear / Slack)
  'cli-wrapper',     // wraps an external CLI binary (Pattern B)
  'local-agent',     // long-running local process (Pattern C)
  'skill',           // SKILL.md run by the active brain — the workbench's
                     // primary create path (source/SKILL.md → ctrl skill →
                     // mcp). (ADR-002 substrate § composition v65)
                     // ADR-002 substrate § brain v17 (2026-06-07): keycap
                     // concept retired; collapses into mcp + skill.
]);

/** @deprecated Parse-only compatibility for existing v1/v2 manifests.
 *  Pattern F/ST-SS execution is retired; installers must surface the warning
 *  from parseManifest and migrate or disable the pack, never dispatch it. */
const RetiredMcpVariant = z.literal('stss-publisher');

export const McpVariant = z.union([ActiveMcpVariant, RetiredMcpVariant]);
export type McpVariant = z.infer<typeof McpVariant>;

// Mcp target — legacy compatibility field retained for tolerant parsing.
// The former `brain` target was retired when Pi exited the hot path; current
// Irisy engines are configured through the ACP engine surface, while feature
// packs declare `brain_capabilities` requirements instead. New manifests must
// use `mcp-tool` or omit this field. (ADR-002 substrate § brain v19)
export const McpTarget = z
  .enum(['mcp-tool', 'brain'])
  .describe('Deprecated compatibility field; brain is retired for new manifests');
export type McpTarget = z.infer<typeof McpTarget>;

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

// ── v3 adaptive workspace declaration (ADR-003 frontend §7.3) ───────────────────
// A mcp may now declare a tabbed NSWindow workspace with optional L2
// sub-nav per tab. The NSWindow host (`WorkspaceShell`, post-collapse)
// reads `ui_surface.workspace.tabs[]` and renders adaptively — viewer
// per tab, L2 column populated per active tab.
//
// `viewer` is a free string at the schema layer (registry validates at
// runtime). Accepts: legacy WorkspaceUi values, viewer-registry content
// keys ('markdown' / 'code' / 'json' / 'mermaid' / 'pdf' / 'image' /
// 'svg' / 'yaml' / 'toml' / 'html' / 'smart-table' / 'fallback'), or
// 'custom' (mcp-provided React component).

export const L2NavItem = z.object({
  id: z.string(),
  label: z.string(),
  href: z.string(),
});
export type L2NavItem = z.infer<typeof L2NavItem>;

export const WorkspaceTab = z.object({
  id: z.string(),
  label: z.string(),
  viewer: z.string(),
  props: z.record(z.string(), z.unknown()).optional(),
  l2_subnav: z.array(L2NavItem).optional(),
});
export type WorkspaceTab = z.infer<typeof WorkspaceTab>;

export const WorkspaceDeclaration = z.object({
  tabs: z.array(WorkspaceTab).min(1),
});
export type WorkspaceDeclaration = z.infer<typeof WorkspaceDeclaration>;

// Unified `ui_surface` field: a string from the legacy single-renderer
// enum (v2) OR an adaptive declaration object (v3). Zod picks at parse
// time. v2 manifests using `ui_surface: "chat-stream"` continue to work.
export const UiSurface = z.union([
  WorkspaceUi,
  z.object({ workspace: WorkspaceDeclaration }),
]);
export type UiSurface = z.infer<typeof UiSurface>;

// ── Config schema (Irisy configurator mode walks these fields) ──────────
// A mcp declares the values it needs from the user post-install
// (Memos host / API base URL / OAuth scopes / Aria2 RPC port / ...).
// Irisy in configure-mcp mode asks one field at a time, validates,
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

// ── Steps (declarative manifest-driven mcp behavior) ─────────────────
// Each step is a single capability call. Step engine runs steps in order,
// passing named outputs (`as`) into subsequent steps via mustache-style
// templates (`{{name}}`). Mirrors the v1 builtin mcp shape.

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
 *  over mcps and external MCP tools behind one step type so workshop
 *  canvas (drag base mcp onto graph) + Irisy compositions don't have
 *  to know transport details.
 *
 *  `target.kind` decides routing:
 *    mcp  → kernel run_mcp(id, action_id, inputs)
 *    mcp     → kernel mcp_proxy_call(server_id, tool_name, args)
 *
 *  Matches the more abstract design favored after the 2026-05 workshop
 *  research pass (n8n / Pipedream show value in polymorphic step refs;
 *  Figma agents call into Figma via MCP tools — same shape). */
const InvokeStep = StepCommon.extend({
  type: z.literal('invoke'),
  target: z.object({
    kind: z.enum(['mcp', 'mcp']),
    /** Provider-specific id. mcp → mcp.id. mcp → "server_id/tool". */
    id: z.string().min(1),
    /** mcp.kind only: which action to invoke (default: mcp's first action). */
    action: z.string().optional(),
  }),
  /** Mustache-templated arg passing into the target. */
  inputs: z.record(z.string(), z.string()).optional(),
});

/** Shell step — run a command line with the pack's provisioned env (tool
 *  PATH + {{secret}}-resolved vars). stdout is the step output. The minimal
 *  executable step for cli-wrapper feature packs (ADR-002 substrate §
 *  composition v21 §7.2 — run_action executes these). */
const ShellStep = StepCommon.extend({
  type: z.literal('shell'),
  command: z.string().min(1),
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
  ShellStep,
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

// ── Source bindings (ADR-001 spine § sources v9: 4 current source types) ────────
// `mcp` carries structured server config. Builtin / cli-wrapper / oauth rely on
// the manifest's `variant` + step content; the retired ST-SS source is rejected.
// (ADR-001 spine § sources v9)

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

/** Skill source — the mcp is backed by a SKILL.md the active brain runs
 *  (ADR-007 workbench § canvas v1). `entry` is the markdown file inside the mcp dir
 *  (`~/.ctrl/mcps/<id>/SKILL.md`); `upstream` records where it came from
 *  (GitHub `owner/repo` or URL) for Pool discovery + Patch-tier sync. */
export const SkillSource = z.object({
  type: z.literal('skill'),
  entry: z.string().min(1).default('SKILL.md'),
  upstream: z.string().optional(),
  /** Local skill name — the active brain CLI (e.g. Claude Code) already has
   *  this skill in its skills dir (user/plugin skill), so the kernel runs it
   *  natively by name (no clone). When present this wins over `upstream`. The
   *  brain activates the skill from the run prompt; CTRL only routes + hands
   *  it the mcp's working folder to write artifacts into. */
  skill: z.string().optional(),
});

export const Source = z.discriminatedUnion('type', [
  McpSource,
  BuiltinSource,
  OAuthSource,
  CliWrapperSource,
  SkillSource,
]);
export type Source = z.infer<typeof Source>;

// ── I/O ports (workbench wiring — JSON Schema typed) ─────────────────────
// A mcp declares typed input/output ports so the workbench canvas can
// validate connections STRUCTURALLY (output schema ⊑ input schema) at
// connect-time, not at run-time (ADR-007 workbench § canvas v1 / brief §3). JSON Schema is the
// cross-language standard and matches MCP tool I/O (ADR-002 substrate § mcp-bus v1).

/** An embedded JSON Schema document. Permissive record — the workbench
 *  checks structural compatibility between ports, it does not validate the
 *  schema grammar itself. Binary/stream payloads pass by reference
 *  (handle/URI), never inlined (brief §8). */
export const JsonSchemaDoc = z.record(z.string(), z.unknown());
export type JsonSchemaDoc = z.infer<typeof JsonSchemaDoc>;

export const IoPort = z.object({
  /** Stable port id, referenced by workbench edges. */
  id: z.string().min(1).regex(/^[a-z0-9_]+$/, {
    message: 'port id must be lowercase + underscore',
  }),
  label: z.string().optional(),
  /** JSON Schema describing the value this port carries. */
  schema: JsonSchemaDoc,
  /** Inputs only: must be wired before the mcp can run. Ignored on outputs. */
  required: z.boolean().default(true),
});
export type IoPort = z.infer<typeof IoPort>;

export const McpIo = z.object({
  inputs: z.array(IoPort).default([]),
  outputs: z.array(IoPort).default([]),
});
export type McpIo = z.infer<typeof McpIo>;

// ── Icon (legacy string OR richer asset descriptor) ─────────────────────

/** Icon address. Two shapes coexist:
 *  - **Legacy string** — Lucide name OR single Unicode char (what the
 *    original demo builtins used; deleted PR #62, but shape preserved
 *    indefinitely for back-compat with user-installed mcps and the
 *    current builtin-irisy manifest).
 *  - **Object form** — for SVG / Lottie / dotLottie state machines
 *    routed through IconRenderer (28d6873). The workshop icon palette
 *    emits this form; legacy mcps emit strings.
 *
 *  Both are valid manifest input; downstream renderer disambiguates. */
export const McpIcon = z.union([
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
export type McpIcon = z.infer<typeof McpIcon>;

// ── Lineage (Patch/Fork tier upstream tracking) ─────────────────────────

/** Set on `mcp fork` / `mcp patch-init`. Records what the mcp
 *  derived from so the 3-tier adjustment model can offer cherry-pick
 *  hints (Patch tier) or just attribute upstream (Fork tier).
 *
 *  Matches the memory `decision_mcp_3_tier_adjustment` Config/Patch/Fork
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
 *  authoring flow sets this; `install_mcp` clears it. Kernel sandbox
 *  uses the presence of this block to gate `run_mcp_draft` and to
 *  show a "Draft" badge in PWA. */
export const DraftMeta = z.object({
  /** Stable draft id, separate from the mcp id (which may be empty
   *  during authoring). Matches the directory name under
   *  ~/.ctrl/mcps/.drafts/<draft-id>/. */
  id: z.string().min(1),
  created_at: z.string(),
  last_run_at: z.string().optional(),
});
export type DraftMeta = z.infer<typeof DraftMeta>;

// ── Top-level manifest ──────────────────────────────────────────────────

// ── ADR-002 substrate § composition v1 v2 axes (additive to v1; v1 manifests skip all of these) ────

/** ADR-002 substrate § composition v65 routing axis — current patterns are
 *  G=builtin/StepEngine, D=3rd-party MCP, B=CLI wrapper, C=daemon RPC,
 *  E=OAuth, A=HTTP sink. Pattern F/ST-SS is retired from execution but remains
 *  parseable solely to migrate existing v1/v2 manifests without silently
 *  invalidating their declared schema version.
 *  Optional on v1 manifests (`variant` carries the same information).
 *  (ADR-002 substrate § composition v65) */
const ActiveMcpPattern = z.enum(['A', 'B', 'C', 'D', 'E', 'G']);
/** @deprecated Parse-only compatibility; never a live executor route. */
const RetiredMcpPattern = z.literal('F');
export const McpPattern = z.union([ActiveMcpPattern, RetiredMcpPattern]);
export type McpPattern = z.infer<typeof McpPattern>;

/** ADR-002 substrate § composition v1 brain capability requirement — declared per-capability with
 *  optional provider lock. provider_pin = null → runtime walks the
 *  fallback chain (ADR-004 cap § updater v1). Explicit id (e.g. "volc", "claude-cli")
 *  pins this capability for this mcp. model_hint is advisory. */
export const BrainCapabilityRequirement = z.object({
  provider_pin: z.string().nullable().default(null),
  model_hint: z.string().optional(),
});
/** Map of capability id → requirement. Keys are well-known capability
 *  names: text.chat / text.embed / image.generate / image.edit /
 *  image.understand / audio.stt / audio.tts.
 *
 *  ECC review C3 (2026-05-30): Zod v4 `z.record` requires the two-arg
 *  form `(keySchema, valueSchema)` — the single-arg form errors at
 *  schema construction time and would throw when parsing any v2
 *  manifest with brain_capabilities. */
export const BrainCapabilities = z.record(z.string(), BrainCapabilityRequirement);
export type BrainCapabilities = z.infer<typeof BrainCapabilities>;

/** Single file-copy directive for cap_asset.files.items. */
const CapAssetFileItem = z.object({
  src: z.string(),
  dest: z.string(),
});

/** Single seed-file directive for cap_asset.vault.seed. Either inline
 *  string content OR a pointer to an already-bundled `cap_asset.files`
 *  dest path. Empty .gitkeep entries use neither (just create the file). */
const CapAssetSeedItem = z.object({
  dest: z.string(),
  content_inline: z.string().optional(),
  content_from: z.string().optional(),
});

/** ADR-002 substrate § composition v1 axis 6 — install-time provisioning bundle.
 *
 *  - cap_asset.files: static immutables copied to ~/.ctrl/mcps/<id>/assets/
 *    (replicated from the manifest at install + healed on every launch
 *    if user deletes them).
 *  - cap_asset.vault: user-facing folder reservation under the vault
 *    root. Path is vault-relative (e.g. "mcps/builtin-irisy/").
 *    Seed files populate first-run state (README, settings stubs, etc).
 */
export const CapAsset = z.object({
  files: z.object({
    items: z.array(CapAssetFileItem).default([]),
  }).optional(),
  vault: z.object({
    path: z.string(),
    seed: z.array(CapAssetSeedItem).default([]),
  }).optional(),
});
export type CapAsset = z.infer<typeof CapAsset>;

// ── Provision (axis 7 — install-time toolchain + env injection) ──────────
// ADR-002 substrate § composition v21. Installs external toolchains a
// feature pack needs (node / wrangler) — distinct from cap_asset (axis 6),
// which only copies static files. Per-tool resolution order: `check` →
// CTRL built-in downloader (`~/.ctrl/tools/<id>/`) → system pkg-mgr
// fallback → manual. `env` values resolve `{{secret:<key>}}` from keychain
// at inject time, never reaching the LLM (decision 0004).

const ToolInstallVia = z.object({
  via: z.enum(['brew', 'winget', 'npm', 'apt']),
  pkg: z.string().min(1),
  /** npm global (-g). Ignored by non-npm managers. */
  global: z.boolean().optional(),
});

const ProvisionTool = z.object({
  id: z.string().min(1).regex(/^[a-z0-9.\-_]+$/, {
    message: 'tool id must be lowercase alphanumeric + . - _',
  }),
  /** Shell probe detecting an existing install; non-zero exit = absent. */
  check: z.string().min(1),
  /** System-pkg-mgr fallback install hints, keyed by os ('macos' /
   *  'windows' / 'linux') or 'any'. The built-in downloader (tool registry
   *  by id) is tried FIRST; these apply only when it has no entry / fails. */
  install: z.record(z.string(), ToolInstallVia).optional(),
});

// A self-hosted service the pack provisions — the "one-click install" half of
// the provision+auth engine (design: feature-pack-provision-auth-engine.md).
// The manifest DECLARES a container stack; the generic kernel runtime brings it
// up (render generated secrets → compose up → poll ready), so any Docker
// self-hosted app (Ghostfolio / Memos / Twenty) is one-click with zero per-pack
// code. v1 = docker/podman compose only.
const ProvisionService = z.object({
  runtime: z.literal('compose').default('compose'),
  /** Inline compose YAML (mutually exclusive with compose_ref). */
  compose_inline: z.string().optional(),
  /** Path to a compose file bundled in the pack (relative to its dir). */
  compose_ref: z.string().optional(),
  /** Env keys the runtime fills with fresh random values on first provision
   *  (e.g. JWT_SECRET_KEY / DB password), injected into compose + stored in the
   *  credential store (idempotent — reused on re-provision). */
  generated_secrets: z.array(z.string()).default([]),
  /** Logical name → host port the runtime allocates/records; usable as
   *  `{port:<name>}` in ready.url / auth paths. */
  ports: z.record(z.string(), z.number()).default({}),
  /** Poll until the service is up before running auth / first use. */
  ready: z
    .object({ url: z.string().min(1), timeout_s: z.number().int().positive().default(180) })
    .optional(),
});

export const Provision = z.object({
  tools: z.array(ProvisionTool).default([]),
  /** Env vars injected into the pack's actions/subprocesses. A value may
   *  reference a keychain secret via `{{secret:<config_key>}}`, resolved
   *  kernel-side at inject time — never exposed to the LLM (decision 0004). */
  env: z.record(z.string(), z.string()).default({}),
  /** Optional self-hosted service to bring up (the one-click-install half). */
  service: ProvisionService.optional(),
});
export type Provision = z.infer<typeof Provision>;

// ── Auth (the "silent security" half of the provision+auth engine) ──────────
// The manifest DECLARES how a pack obtains credentials; the generic runtime
// executes it with no manual token entry. `manual` (config_schema wizard) is
// the last-resort fallback. Design: feature-pack-provision-auth-engine.md.

/** Where a captured value goes: a JSON pointer into the response → a pack
 *  secret (stored `mcp:<id>:<into_secret>`, never the LLM). */
const AuthCapture = z.object({
  pointer: z.string().min(1),
  into_secret: z.string().regex(/^[a-z0-9_]+$/),
});

/** Composable phases — a pack may need several (e.g. Ghostfolio: bootstrap once
 *  to mint the long-lived secret, THEN token-exchange per call). All optional;
 *  the runtime runs whichever are present. */
export const PackAuth = z
  .object({
    /** End-side loopback OAuth (big platforms) — zero manual token. */
    oauth: z
      .object({ provider: z.string().min(1), scopes: z.array(z.string()).default([]) })
      .optional(),
    /** Run once post-provision to mint the long-lived secret (e.g. Ghostfolio
     *  POST /api/v1/user → capture `/accessToken`). Fully automatic. */
    bootstrap: z
      .object({
        method: z.enum(['GET', 'POST']).default('POST'),
        path: z.string().min(1),
        body: z.record(z.string(), z.unknown()).optional(),
        capture: AuthCapture,
      })
      .optional(),
    /** Exchange a stored long-lived secret for a short-lived bearer on each call
     *  (e.g. Ghostfolio /api/v1/auth/anonymous {accessToken} → {authToken}). */
    token_exchange: z
      .object({
        path: z.string().min(1),
        send_secret: z.string().regex(/^[a-z0-9_]+$/),
        as_body_field: z.string().min(1),
        capture_bearer: z.string().min(1),
      })
      .optional(),
    /** After auth, capture a connector-side CONTEXT value a write needs but the
     *  bootstrap doesn't return (e.g. Ghostfolio's default account id, required
     *  to record a trade): token-exchange for a bearer, GET the endpoint, pull a
     *  value by JSON pointer, store it kernel-side as a secret the produce body
     *  references via `from_secret`. Idempotent. */
    capture_context: z
      .object({
        method: z.enum(['GET', 'POST']).default('GET'),
        path: z.string().min(1),
        pointer: z.string().min(1),
        into_secret: z.string().regex(/^[a-z0-9_]+$/),
      })
      .optional(),
    /** Last-resort: fall back to the config_schema wizard (manual entry). */
    manual: z.boolean().optional(),
  })
  .strict();
export type PackAuth = z.infer<typeof PackAuth>;

// ── §14 record source (ADR-002 §14.12) ─────────────────────────────────────
// Declare a REST connector's describe/query/produce shape as DATA, so ONE
// generic runtime source (kernel `manifest_source.rs`) makes it AI-native with
// zero per-connector code (§7.4 manifest=data / §7.5 product-grade zero-code).
// Auth is NOT re-declared here — the generic source reuses `auth.token_exchange`
// above. Enum values mirror the kernel's fixed serde variants exactly, so a
// bad operator/type in a manifest fails fast, not silently (§14.1).

const CellTypeEnum = z.enum(['text', 'number', 'date', 'checkbox', 'tags', 'select', 'url']);
const OperatorEnum = z.enum([
  'eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte', 'before', 'after', 'within', 'is', 'has_tag',
]);

/** One field of the source schema + how to read it from a response item. */
const RecordFieldMap = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: CellTypeEnum,
  /** JSON paths (dotted, nested-aware) tried in order; first present wins.
   *  Empty → `[key]`. */
  from: z.array(z.string()).default([]),
});

/** The read endpoint + where the row array lives in the response. */
const RecordQuery = z.object({
  endpoint: z.string().min(1),
  method: z.enum(['GET', 'POST']).default('GET'),
  /** Key or dotted path to the array; `""` = the response body IS the array. */
  array_at: z.string().default(''),
});

/** One produce body-map entry: input[`from`] (or a stored secret via
 *  `from_secret`) → request body[`field`]. */
const RecordProduceField = z.object({
  field: z.string().min(1),
  /** Source key in the caller's input. Absent when the value comes from a
   *  stored secret (`from_secret`) instead of caller input. */
  from: z.string().min(1).optional(),
  /** Take the value from a stored secret (`mcp:<id>:<from_secret>`) rather than
   *  caller input — e.g. a connector's default account id captured at provision
   *  (`_account_id`), which a write must carry as context. Kernel-side; never
   *  crosses the LLM boundary. */
  from_secret: z.string().min(1).optional(),
  /** `uppercase` (string) — extend as connectors need. */
  transform: z.enum(['uppercase']).optional(),
  /** `number` → coerce a string input to a JSON number before sending. */
  type: z.enum(['number']).optional(),
});

const RecordProduce = z.object({
  endpoint: z.string().min(1),
  method: z.enum(['GET', 'POST']).default('POST'),
  /** High-signal label for the write ("Record a trade") — §14 produce is an
   *  atom, not a raw endpoint mirror. */
  label: z.string().default(''),
  body: z.array(RecordProduceField).min(1),
});

export const RecordSource = z
  .object({
    kind: z.enum(['record', 'text', 'blob']).default('record'),
    query: RecordQuery,
    fields: z.array(RecordFieldMap).min(1),
    /** Absent → the default operator set for the kind. */
    operators: z.array(OperatorEnum).optional(),
    /** The write verb — absent for read-only sources. */
    produce: RecordProduce.optional(),
  })
  .strict();
export type RecordSource = z.infer<typeof RecordSource>;

// ── Top-level manifest ───────────────────────────────────────────────────

export const McpManifest = z.object({
  /** JSON schema URL — informational, not enforced. */
  $schema: z.string().url().optional(),

  /** Stable id, dot-namespaced. e.g. `ctrl.builtin.ai-summarize`. */
  id: z.string().min(1).regex(/^[a-z0-9.\-_]+$/, {
    message: 'id must be lowercase alphanumeric + . - _',
  }),

  /** Manifest format version. v1 = legacy; v2 = ADR-002 substrate § composition v1 6-axis composition
   *  model (adds cap_asset / brain_capabilities / ui_surface / pattern /
   *  builtin). Either is accepted by parseManifest; new manifests should
   *  use v2. The kernel loader reads v2-only fields when manifest_version=2. */
  manifest_version: z.union([z.literal(1), z.literal(2)]).default(1),

  /** Human-readable name (i18n-friendly; can be CJK). */
  name: z.string().min(1),

  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.\-]+)?$/, {
    message: 'version must be semver (x.y.z[-prerelease])',
  }),

  author: Author,

  description: Description,

  /** Icon — legacy string (Lucide name / Unicode char) OR richer object
   *  form for SVG / Lottie / dotLottie state-machine assets. */
  icon: McpIcon,

  mcp_color: McpColor.optional(),

  category: z.string().optional(),

  tags: z.array(z.string()).optional(),

  /**
   * Legacy flat permission list (the original demo builtins used this;
   * deleted PR #62. Kept for back-compat with any user mcp still on
   * the v1 shape). Prefer `capabilities` (structured, gate-enforceable)
   * for new manifests.
   */
  permissions: z.array(Permission).optional(),

  /** Structured capability declaration; kernel enforces at run_mcp dispatch. */
  capabilities: Capabilities.optional(),

  /** Workspace = this pack's operating surface. Two halves, both optional:
   *  `ui` (legacy) picks the output renderer for the mcp's result; `table_prefix`
   *  (§7.5 v48, bao 2026-07-03) declares the pack's smart-table WORKSPACE — the
   *  vault tables under `tables/<pack>-*` that ARE its UI. FeaturePackScene lists
   *  them and renders one tab per table (the generic smart-table viewer, full
   *  multi-view), so an Irisy-created table auto-joins with ZERO per-pack code.
   *  Convention-enforced: prefix must be `tables/<pack>-` (trailing dash). */
  workspace: z
    .object({
      ui: WorkspaceUi.default('none'),
      table_prefix: z
        .string()
        .regex(
          /^tables\/[a-z0-9._-]+-$/,
          'table_prefix must be "tables/<pack>-" (starts with tables/, trailing dash)',
        )
        .optional(),
    })
    .optional(),

  /**
   * Fields the user must fill post-install before this mcp can run.
   * Irisy in `configure-mcp` mode walks these one at a time.
   */
  config_schema: ConfigSchema.optional(),

  /** Optional platform restriction. */
  platforms: z.array(z.enum(['macos', 'windows', 'linux'])).optional(),

  /** Tells the kernel which dispatch path to use. */
  variant: McpVariant.default('builtin'),

  /** Source binding for non-builtin variants (mcp / oauth / cli-wrapper / skill). */
  source: Source.optional(),

  /** Typed I/O ports for workbench composition (ADR-007 workbench § canvas v1). Each port carries
   *  a JSON Schema; the canvas validates connections structurally at
   *  connect-time. Optional — one-shot mcps that are never composed omit it. */
  io: McpIo.optional(),

  /** @deprecated Legacy target is parsed only for old manifests. New manifests
   *  omit it (or use `mcp-tool`); `brain` no longer selects a runtime.
   *  (ADR-002 substrate § brain v19) */
  target: McpTarget.optional(),

  /** @deprecated Former brain-manifest capability; ignored by current routing.
   *  Use `brain_capabilities` for pack requirements. */
  capability: z.string().optional(),

  /** @deprecated Former Pi-era bridge package name; parsed for migration only
   *  and never spawned by the current kernel. */
  bridge: z.string().optional(),

  /** @deprecated Former brain-owned credential switch; current provider/engine
   *  credentials follow the provider registry and ACP engine policy. */
  provider_passthrough: z.boolean().optional(),

  /** Actions the user can invoke (step-engine mcps). `skill` / `mcp` /
   *  external-source mcps run via their `source` instead and may omit
   *  this entirely; when present it must list at least one action. */
  actions: z.array(Action).min(1).optional(),

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
   *  installed yet (it lives under ~/.ctrl/mcps/.drafts/<id>/). The
   *  install_mcp path strips this block on install. */
  draft: DraftMeta.optional(),

  /** Lineage — set when this mcp was derived from another via the
   *  Patch/Fork tiers of the 3-tier adjustment model. Absent on
   *  greenfield + Config-tier mcps. */
  lineage: Lineage.optional(),

  // ── ADR-002 substrate § composition v1 v2 axes ─────────────────────────────────────────────────

  /** True iff this is one of CTRL's built-in mcps (lives in
   *  packages/ctrl-mcps/builtin/, seeded into ~/.ctrl/mcps/ on
   *  every launch). The shell self-repairs deleted builtins. v2 only. */
  builtin: z.boolean().optional(),

  /** ADR-004 cap § execution v1 7-pattern routing axis. Orthogonal to `variant` (variant
   *  pre-dates ADR-004 cap § execution v1; pattern is the canonical successor). v2 only. */
  pattern: McpPattern.optional(),

  /** Per-capability brain provider requirements (ADR-002 substrate § composition v1 §3). v2 only.
   *  Replaces the singular `target=brain` model: a mcp can require
   *  multiple modalities simultaneously (poster needs text.chat +
   *  image.generate + image.edit) and lock provider per capability. */
  brain_capabilities: BrainCapabilities.optional(),

  /** Workspace UI surface (ADR-002 substrate § composition v1 §2 axis 5; ADR-003 frontend §7.3 extended to
   *  adaptive multi-tab in v3). Accepts:
   *    - legacy single string from WorkspaceUi (`"chat-stream"` etc.)
   *    - v3 object: `{ workspace: { tabs: [...] } }` for tabbed
   *      NSWindow workspaces with optional per-tab L2 sub-nav.
   *  When both `ui_surface` and `workspace.ui` are set, `ui_surface` wins.
   *  v2 manifests using `workspace.ui` continue to work unchanged. */
  ui_surface: UiSurface.optional(),

  /** Skill recipes the brain reads as context. Resolved via 3-tier lookup
   *  per ADR-002 substrate § composition v1 §3.5: vault/skills/<id>.md > ~/.claude/skills/<id>.md >
   *  ~/.ctrl/mcps/<id>/assets/skills/<id>.md. v2 only. */
  skills: z.array(z.string()).optional(),

  /** Install-time provisioning bundle (ADR-002 substrate § composition v1 axis 6). v2 only. The
   *  bundled `files.items[]` carry the mcp's icon / persona.md /
   *  templates; `vault.path` reserves the mcp's user-facing folder
   *  with optional seed structure. */
  cap_asset: CapAsset.optional(),

  /** Install-time toolchain + env injection (ADR-002 substrate § composition
   *  v21 axis 7). v2 only. `tools[]` resolved built-in-downloader-first
   *  (`~/.ctrl/tools/`) → system pkg-mgr fallback; `env` pulls
   *  `{{secret:<key>}}` from keychain at inject time (never the LLM —
   *  decision 0004). Distinct from cap_asset (copies files, not toolchains). */
  provision: Provision.optional(),

  /** How the pack obtains credentials — the "silent security" declaration the
   *  generic runtime executes (oauth / bootstrap / token-exchange), so a
   *  self-hosted connector needs no manual token. Absent or `manual` = fall
   *  back to the config_schema wizard. Design:
   *  feature-pack-provision-auth-engine.md. */
  auth: PackAuth.optional(),

  /** §14 record source (ADR-002 §14.12) — declares this connector's
   *  describe/query/produce shape as DATA so the generic kernel source
   *  (`manifest_source.rs`) makes it AI-native with zero per-connector code.
   *  Auth reuses `auth.token_exchange` above. v2 only. */
  record_source: RecordSource.optional(),

  /** Dedicated knowledge base = a vault subpath this pack's data lives in
   *  (ADR-002 substrate § composition §7.4 v34). Generic: ANY pack declares
   *  its own; the runtime scopes the assistant's retrieval here when the pack
   *  is open (inKbScope drops out-of-scope hits, so a pack's data view only
   *  ever sees its own data). Zero per-pack code — this is the systematic field
   *  that lets a creator-generated pack carry a dedicated KB. Absent = whole
   *  vault. e.g. a portfolio pack declares `"Stocks"`. v2 only. */
  knowledge_base: z.string().min(1).optional(),
});
export type McpManifest = z.infer<typeof McpManifest>;

// ── Parse + validate ─────────────────────────────────────────────────────

// Compatibility warnings are part of the migration contract for retired values.
// (ADR-002 substrate § composition v65)
export interface ValidationResult {
  ok: boolean;
  manifest?: McpManifest;
  errors: Array<{ path: string; message: string }>;
  warnings: Array<{ path: string; message: string }>;
}

/**
 * Parse a manifest object (already JSON-parsed) and return either the
 * typed manifest or a list of validation errors with paths. Designed
 * for use by:
 *  - kernel's install_mcp (reject malformed at install time)
 *  - mcp CLI lint (developer feedback)
 *  - Irisy mcp-creator (live validation while user fills fields)
 */
export function parseManifest(input: unknown): ValidationResult {
  // Retired values remain observable for migration but never regain an executor.
  // (ADR-002 substrate § composition v65)
  const result = McpManifest.safeParse(input);
  if (result.success) {
    const warnings: ValidationResult['warnings'] = [];
    if (result.data.variant === 'stss-publisher') {
      warnings.push({
        path: 'variant',
        message: 'stss-publisher is retired compatibility data; migrate or disable this manifest before execution',
      });
    }
    if (result.data.pattern === 'F') {
      warnings.push({
        path: 'pattern',
        message: 'Pattern F/ST-SS is retired compatibility data and has no live executor route',
      });
    }
    return { ok: true, manifest: result.data, errors: [], warnings };
  }
  // Invalid manifests carry no compatibility warnings because no typed legacy
  // value was recovered. (ADR-002 substrate § composition v65)
  return {
    ok: false,
    errors: result.error.issues.map((iss) => ({
      path: iss.path.join('.'),
      message: iss.message,
    })),
    warnings: [],
  };
}
