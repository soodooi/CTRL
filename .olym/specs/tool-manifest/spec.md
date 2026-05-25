# Tool Manifest — Keycap Declarative Specification

- **Status**: v0.3 (2026-05-22 amend: target field + custom renderer + upstream + i18n)
- **Date**: 2026-05-11 (initial v0.1) · 2026-05-22 (v0.3 amend)
- **Parents**: ADR-001 §4 + ADR-010 (amended) + ADR-013 + ADR-014 + ADR-018
- **Audience**: Hermes + AI 创作助手 (generate manifests), L1 Kernel (instantiate + register tools), ctrl-market (validate + distribute), kernel `update_scheduler` (Layer 3 updates)

---

## 0. v0.3 amendment summary (2026-05-22)

ADR-010 amendment + ADR-014/016/018 introduced fields not in v0.1. v0.3 adds them as **additive** changes; v0.1 manifests remain valid.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `target` | `"mcp-tool" \| "hermes-skill"` | `"mcp-tool"` | Loader: MCP server (≥90%) or Hermes skill — ADR-010 amend |
| `workspace.ui` | enum (10) | `"none"` | Renderer type — ADR-002 amend |
| `workspace.custom_component_path` | string | absent | Required when `ui = "custom"` |
| `upstream.url` | string (URL) | absent | Per-keycap update source — ADR-018 |
| `upstream.supported_tiers` | array | `["config","patch","fork"]` | Which tiers the keycap supports |
| `signing.pubkey` | string (base64 ed25519) | absent | Signature key — ADR-018 |
| `config_migration` | `Migration[]` | `[]` | Cross-version config field migrations — ADR-018 Config tier |
| `compatibility.min_ctrl_version` | semver | manifest's `min_ctrl_version` | Hard floor |
| `compatibility.kernel_manifest_schema` | semver range | `>=0.1 <0.4` | Schema versions targeted |
| `i18n.default_locale` | BCP-47 | `"en"` | Source-of-truth locale — ADR-014 |
| `i18n.supported_locales` | array of BCP-47 | `["en"]` | Localized variants |

### 0.1 New top-level fields

v0.3 extends `KeycapManifest` (Zod) with the additive fields summarized in the table above:

- `target` — `'mcp-tool'` (default) or `'hermes-skill'`
- `upstream` — `{ url, supported_tiers: ['config'|'patch'|'fork'][] }`, defaults to all three tiers (ADR-018 Layer 3)
- `signing` — `{ pubkey: <ed25519 base64> }`; absent = unsigned (dev-only)
- `config_migration` — array of `{ from_version, to_version, operations: [{op: 'rename'|'move'|'default'|'drop', path, to?, value?}] }` (ADR-018 Config tier)
- `compatibility` — `{ min_ctrl_version, kernel_manifest_schema }` (defaults `'1.0.0'` / `'>=0.1 <0.4'`)
- `i18n` — `{ default_locale, supported_locales }` (BCP-47; default `'en'` only)

*(Zod schema elided. Implementation: `packages/ctrl-tool-integration/src/manifest/schema.ts`.)*

### 0.2 Workspace renderer enum + custom_component_path

`WorkspaceLayout.ui` is a 10-value enum (default `'none'`): `'none'`, `'notification'` (toast / banner, no persistent tab), `'modal'`, `'clipboard'`, `'html-output'` (markdown / HTML render), `'chat-stream'` (live LLM streaming), `'picker'` (list/grid), `'form'` (auto-rendered from `config_schema`), `'canvas'` (free-draw / data viz), `'custom'` (keycap-supplied React component).

`workspace.custom_component_path` is required when `ui = 'custom'`; it's a path relative to `packages/ctrl-web/src/components/keycaps/` (e.g. `"CodeSpaceTab.tsx"`). PWA's keycap-tab-registry binds path → lazy import; LifecycleShell never hardcodes a specific keycap.

*(Zod enum elided. Implementation: `packages/ctrl-tool-integration/src/manifest/schema.ts` + `packages/ctrl-web/src/keycap-tab-registry.ts`.)*

### 0.3 hermes-skill exception (target = "hermes-skill")

When `target: "hermes-skill"` (knowledge-dense workflow keycap):

- `source.type = "mcp"` forbidden (skills don't expose MCP); other source types valid
- Install path: kernel `skill_generator` module writes `~/.hermes/skills/<id>/SKILL.md` (from `description + config_schema.documentation + flow` summarization) + copies declared assets
- `capabilities[]` still applies — skills declare needs (web / vault.read / etc.), kernel grants via `CapabilityBroker`
- Update: same 3-tier (Config / Patch / Fork) applied to SKILL.md file
- Detailed generator spec: `.olym/specs/skill-generator/spec.md` (follow-up)

### 0.4 Backwards compatibility

- v0.1 manifests remain valid (all new fields optional, defaults backwards-compatible)
- ctrl-market: WARN on missing v0.3 fields, ALLOW upload; required for "verified creator" badge

---

## 1. Purpose

The Tool Manifest is the **single declarative format** describing a CTRL keycap. It serves three audiences simultaneously:

1. **L1 Kernel** — to instantiate a sandboxed actor with correct capability + state machine
2. **AI 创作助手** — to generate manifests from natural language via slot-filling chat
3. **ctrl-market** — to validate, review, score, and distribute keycaps

**Design constraint**: every field MUST have a `.describe()` so LLM can both generate AND consume manifests fluently. Zod schema (TypeScript) + JSON Schema (cross-language fallback).

---

## 2. Top-level manifest

The `KeycapManifest` Zod object groups fields into five buckets:

- **Identity** — `id` (kebab-case unique), `version` (SemVer), `name`, `description`, `author: { handle, contact? }`
- **Visual** — `icon` (emoji / glyph / SVG url), `keycap_color` (`'cobalt'|'amber'|'jade'|'platinum'|'graphite'`, default `'platinum'`)
- **Source declaration** — `source: BuiltinSource | McpSource | OAuthSource | LocalAgentSource | StssSource` (5 source types per ADR-001 §4, discriminated by `type`)
- **Behavior** — `capabilities[]` (kernel tokens the keycap may use), `triggers[]` (hotkey / context menu / on_stss / etc.), `flow` (actor state machine)
- **UX** — `workspace_layout?` (custom workspace UI), `default_state?`
- **Distribution** — optional `market: { public, pricing, tags, screenshots? }`
- **Compatibility** — `min_ctrl_version` (default `'1.0.0'`), `platforms[]` (default `['macos']`)

*(Zod schema elided. Implementation: `packages/ctrl-tool-integration/src/manifest/schema.ts`.)*

---

## 3. Five source types

### 3.1 Built-in

`BuiltinSource = { type: 'builtin', module }`. Only CTRL team can publish `builtin`. Used for v1 Top 15 keycaps.

### 3.2 MCP

`McpSource = { type: 'mcp', server, tools[], auto_install }`. `server` is an identifier from the MCP registry, `tools[]` is the subset of that server's tools this keycap uses, `auto_install` (default `true`) auto-installs the MCP server on first use. AI 助手 reads MCP registry metadata to fill `server` + `tools`. Capability check ensures only declared tools are invokable.

### 3.3 OAuth Big Platform

`OAuthSource = { type: 'oauth', vendor, oauth_config, api_calls }`. `vendor` is one of `'feishu' | 'coze' | 'notion' | 'linear' | 'slack' | 'github' | 'custom'`. `oauth_config` carries `auth_url`, `token_url`, `scopes[]`, `client_id_env` (env-var name in user keychain). `api_calls[]` is the whitelist of allowed `{ name, method, path, body_schema? }` calls — anything outside is rejected. AI 助手 guides user through OAuth at install time. Tokens stored in Tauri Keychain, scoped per keycap.

### 3.4 Local Agent

`LocalAgentSource = { type: 'local_agent', spawn, ipc, lifecycle }`. `spawn = { command, args[], env?, cwd? }` is the OS process spec. `ipc` is a discriminated union: `{ kind: 'stdio', framing: 'ndjson'|'msgpack' }` | `{ kind: 'http', port, base_path }` | `{ kind: 'socket', path }`. `lifecycle` is `'singleton'` (default), `'per_invoke'`, or `'pool'`. Used for OpenClaw / ClawX / user's own Python scripts. Process runs sandboxed per OS (bubblewrap / sandbox-exec).

### 3.5 ST-SS Stream

`StssSource = { type: 'stss', stream: { publisher, transport, endpoint? }, subscribed_kinds[], emit_kinds[]? }`. `transport` is `'local_ws' | 'remote_tunnel' | 'inproc'`. `subscribed_kinds[]` lists Cell/Op kinds this keycap consumes; `emit_kinds[]` (optional) is what it emits back. The long-tail integration path: independent dev integrates `@ctrl/stss-sdk`, publishes stream, declares manifest.

*(Source variant schemas elided. Implementation: `packages/ctrl-tool-integration/src/manifest/sources/*.ts`.)*

---

## 4. Capability tokens

(See `.olym/specs/kernel/spec.md` §2.2 for full enum)

Manifest declares capability inline as a YAML array of tokens — each token is a bare string (e.g. `ClipboardRead`) or a single-key map (e.g. `LlmCall: { model: 'workers-ai/qwen-3-32b-instruct', max_tokens: 4096 }`, `McpInvoke: { server: 'postgres', tool_glob: 'query_*' }`).

*(Capability inline shape elided — full token enum lives in `.olym/specs/kernel/spec.md` §2.2.)*

L1 Kernel rejects any effect not covered by declared capability.

---

## 5. Triggers

`Trigger` is a discriminated union over `kind`:

- `'hotkey'` — `{ combo, contexts: ('anywhere'|'editor'|'browser'|'workspace_open')[] }`
- `'pool_select'` — `{ section: 'top'|'middle'|'bottom'|'custom' (default 'middle'), rank }`
- `'context_menu'` — `{ targets: ('text_selection'|'file'|'url')[] }`
- `'on_stss'` — `{ filter }` (ST-SS event filter expression)
- `'schedule'` — `{ cron }`

A keycap MAY have multiple triggers. Most have at least `pool_select` so they show in the `Ctrl` pool.

*(Zod trigger union elided. Implementation: `packages/ctrl-tool-integration/src/manifest/trigger.ts`.)*

---

## 6. Flow — actor state machine

`ActorFlow = { initial: <state-name>, states: { <state-name>: StateDefinition } }`. Each `StateDefinition` carries `on_enter?: Effect[]`, `on_event?: { <event-name>: { target: <state-name>, actions?: Effect[], guard? } }`, and `on_exit?: Effect[]`.

A translation keycap's flow: `idle` (on `invoked` → `collecting_input`) → `collecting_input` (on_enter `ClipboardRead`; on `clipboard_read` → `calling_llm`) → `calling_llm` (on_enter `LlmCall { model, prompt_template, deadline_ms }`; on `llm_response` → `writing_output`) → `writing_output` (on_enter `ClipboardWrite`; on `clipboard_written` → `done`).

*(Flow schema + example YAML elided. Implementation: `packages/ctrl-tool-integration/src/manifest/flow.ts`; reference flows under `share/manifests/`.)*

AI 创作助手 generates this from NL: "I want a keycap that takes clipboard text and translates to formal English email."

---

## 7. Workspace layout

`WorkspaceLayout = { panels: [{ id, kind, layout, size }], default_panel }`. `kind` is `'input'|'output'|'log'|'diff'|'preview'`; `layout` is `'column'|'row'|'stack'`; `size` is `number | string`.

If absent, kernel uses default workspace (single output text area + close button).

*(Layout schema elided. Implementation: `packages/ctrl-tool-integration/src/manifest/workspace.ts`.)*

---

## 8. Validation pipeline

When a manifest enters CTRL system (via AI 创作 / ctrl-market install / dev local file):

1. **Schema validation** — Zod parses, type errors rejected
2. **Capability sanity** — declared caps not exceed `source.type` permissions
   - e.g., `source.type=builtin` can declare full capability, `source.type=stss` cannot declare `Spawn`
3. **Sandbox dry-run** — execute on synthetic input, check no escape
4. **AI moderation pass** (for market submissions) — Claude reads manifest + flow + asks "could this harm user?"
5. **Manual review** (for popularity > threshold) — CTRL team eyeball, sign

Failed at any step → reject with structured error to creator.

---

## 9. Version + migration

Manifest schema versioned. Backward-compat: older manifest auto-migrated by `migrations/` chain. New required fields ship with default.

---

## 10. Examples

### 10.1 Built-in clipboard enhance (P0 keycap)

`clipboard-ai-rewrite` v1.0.0 — built-in source `module: clipboard-enhance`. Declares `ClipboardRead`, `ClipboardWrite`, and `LlmCall { model: workers-ai/qwen-3, max_tokens: 2048 }` capabilities. Two triggers: hotkey `Ctrl+Shift+V` (context `anywhere`) + pool top section rank 1. Flow: `collecting_tone` (spawn workspace-tone-picker) → `rewriting` (clipboard read + LLM call with `clipboard-rewrite-{tone}` prompt, 4s deadline) → `pasting` (clipboard write + emit `keycap_completed`).

*(Full manifest elided. Reference manifest: `share/manifests/clipboard-ai-rewrite.yaml`.)*

### 10.2 MCP-sourced postgres query keycap (creator example)

`pg-query-explain` v0.1.0 — MCP source `anthropic/postgres`, tools `[query, explain]`, `auto_install: true`. Declares `McpInvoke { server: anthropic/postgres, tool_glob: '*' }`, `LlmCall { model: workers-ai/qwen-3 }`, `ClipboardRead`. Hotkey `Ctrl+Alt+P`. Public market entry, free, tags `[database, sql, developer]`.

*(Full manifest elided — see `doc/keycap-integration-research/` for creator examples.)*

---

## 11. AI 创作助手 — generation API

L2 SDK exposes `generateManifest` from `@ctrl/creator-sdk`. Inputs: `user_intent` (natural-language intent), `user_context` (`has_anthropic_key`, `installed_keycaps[]`), `model` (BYOK or quota, e.g. `'anthropic/claude-sonnet-4'`). Returns `{ manifest, dry_run_log, questions_remaining }` — a Zod-valid manifest, sandbox dry-run trace, and any clarifying questions still needed.

*(API signature elided. Implementation: `packages/ctrl-creator-sdk/src/generate-manifest.ts`.)*

Internal flow:
1. Claude reads ADR-001 + manifest schema as context
2. Slot-filling: 5-7 multi-turn questions
3. Generate draft manifest
4. Run sandbox dry-run with synthetic input
5. If errors, AI fixes (1-2 iterations)
6. Present preview to user
7. User accepts → save to local + optional market submission

Target: 5 minutes from intent → installed keycap.

---

## 12. References

- `.olym/specs/kernel/spec.md` §2 — primitives used by manifest
- `.olym/specs/stss-protocol/spec.md` §3.1 — stream capability declaration
- `.olym/specs/creator-economy/spec.md` — market submission flow + revenue share
