# Tool Manifest — Keycap Declarative Specification

- **Status**: Draft v0.1
- **Date**: 2026-05-11
- **Parent**: `.claude/ADR/001-system-architecture.md` §4, §6 item 9
- **Audience**: AI 创作助手 (generates manifests), L1 Kernel (instantiates actors), ctrl-market (审核 + 分发)

---

## 1. Purpose

The Tool Manifest is the **single declarative format** describing a CTRL keycap. It serves three audiences simultaneously:

1. **L1 Kernel** — to instantiate a sandboxed actor with correct capability + state machine
2. **AI 创作助手** — to generate manifests from natural language via slot-filling chat
3. **ctrl-market** — to validate, review, score, and distribute keycaps

**Design constraint**: every field MUST have a `.describe()` so LLM can both generate AND consume manifests fluently. Zod schema (TypeScript) + JSON Schema (cross-language fallback).

---

## 2. Top-level manifest

```typescript
const KeycapManifest = z.object({
  // Identity
  id: z.string().regex(/^[a-z0-9-]+$/).describe('Unique keycap id, kebab-case'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).describe('SemVer'),
  name: z.string().describe('Display name'),
  description: z.string().describe('One-line user-facing summary'),
  author: z.object({
    handle: z.string().describe('Creator handle'),
    contact: z.string().email().optional(),
  }),
  
  // Visual
  icon: z.string().describe('Emoji, glyph, or url to SVG'),
  keycap_color: z.enum(['cobalt', 'amber', 'jade', 'platinum', 'graphite']).default('platinum'),
  
  // Source declaration (the 5 types from ADR-001 §4)
  source: z.discriminatedUnion('type', [
    BuiltinSource,
    McpSource,
    OAuthSource,
    LocalAgentSource,
    StssSource,
  ]).describe('Where this keycap functionality comes from'),
  
  // Behavior
  capabilities: z.array(CapabilityToken).describe('What this keycap may do'),
  triggers: z.array(Trigger).describe('How user invokes (hotkey / context menu / on_stss)'),
  flow: ActorFlow.describe('State machine of effects'),
  
  // UX
  workspace_layout: WorkspaceLayout.optional().describe('Custom workspace UI'),
  default_state: z.record(z.any()).optional(),
  
  // Distribution
  market: z.object({
    public: z.boolean().default(false),
    pricing: z.enum(['free', 'subscription_only', 'pay_per_install', 'pay_per_invoke']),
    tags: z.array(z.string()),
    screenshots: z.array(z.string().url()).optional(),
  }).optional(),
  
  // Compatibility
  min_ctrl_version: z.string().default('1.0.0'),
  platforms: z.array(z.enum(['macos', 'windows', 'linux'])).default(['macos']),
});
```

---

## 3. Five source types

### 3.1 Built-in

```typescript
const BuiltinSource = z.object({
  type: z.literal('builtin'),
  module: z.string().describe('First-party module name, e.g. "clipboard-enhance"'),
});
```

Only CTRL team can publish `builtin`. Used for v1 Top 15 keycaps.

### 3.2 MCP

```typescript
const McpSource = z.object({
  type: z.literal('mcp'),
  server: z.string().describe('MCP server identifier from registry'),
  tools: z.array(z.string()).describe('Which tools of that server this keycap uses'),
  auto_install: z.boolean().default(true).describe('Auto install MCP server on first use'),
});
```

AI 助手reads MCP registry metadata to fill `server` + `tools`. Capability check ensures only declared tools are invokable.

### 3.3 OAuth Big Platform

```typescript
const OAuthSource = z.object({
  type: z.literal('oauth'),
  vendor: z.enum(['feishu', 'coze', 'notion', 'linear', 'slack', 'github', 'custom']),
  oauth_config: z.object({
    auth_url: z.string().url(),
    token_url: z.string().url(),
    scopes: z.array(z.string()),
    client_id_env: z.string().describe('Env var name in user keychain'),
  }),
  api_calls: z.array(z.object({
    name: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
    path: z.string(),
    body_schema: z.any().optional(),
  })).describe('Allowed API calls; outside this list rejected'),
});
```

AI 助手 guides user through OAuth flow at install time. Tokens stored in Tauri Keychain, scoped per keycap.

### 3.4 Local Agent

```typescript
const LocalAgentSource = z.object({
  type: z.literal('local_agent'),
  spawn: z.object({
    command: z.string().describe('Process command, e.g. "openclaw"'),
    args: z.array(z.string()),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
  }),
  ipc: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('stdio'), framing: z.enum(['ndjson', 'msgpack']) }),
    z.object({ kind: z.literal('http'), port: z.number(), base_path: z.string() }),
    z.object({ kind: z.literal('socket'), path: z.string() }),
  ]),
  lifecycle: z.enum(['singleton', 'per_invoke', 'pool']).default('singleton'),
});
```

Used for OpenClaw / ClawX / user's own Python script. Process runs sandboxed per OS (bubblewrap / sandbox-exec).

### 3.5 ST-SS Stream

```typescript
const StssSource = z.object({
  type: z.literal('stss'),
  stream: z.object({
    publisher: z.string().describe('Stream publisher app/device identifier'),
    transport: z.enum(['local_ws', 'remote_tunnel', 'inproc']),
    endpoint: z.string().optional().describe('ws://localhost:N or wss://...'),
  }),
  subscribed_kinds: z.array(z.string()).describe('Cell/Op kinds this keycap consumes'),
  emit_kinds: z.array(z.string()).optional().describe('Cell/Op kinds this keycap emits back'),
});
```

The long-tail integration path. Independent dev integrates `@ctrl/stss-sdk`, publishes stream, declares manifest.

---

## 4. Capability tokens

(See `.olym/specs/kernel/spec.md` §2.2 for full enum)

Manifest declares capability inline:

```yaml
capabilities:
  - LlmCall:
      model: "workers-ai/qwen-3-32b-instruct"
      max_tokens: 4096
  - ClipboardRead
  - ClipboardWrite
  - McpInvoke:
      server: "postgres"
      tool_glob: "query_*"
```

L1 Kernel rejects any effect not covered by declared capability.

---

## 5. Triggers

```typescript
const Trigger = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hotkey'),
    combo: z.string().describe('Cross-platform combo, e.g. "Ctrl+Alt+T"'),
    contexts: z.array(z.enum(['anywhere', 'editor', 'browser', 'workspace_open'])),
  }),
  z.object({
    kind: z.literal('pool_select'),
    section: z.enum(['top', 'middle', 'bottom', 'custom']).default('middle'),
    rank: z.number().describe('Sort order within section'),
  }),
  z.object({
    kind: z.literal('context_menu'),
    targets: z.array(z.enum(['text_selection', 'file', 'url'])),
  }),
  z.object({
    kind: z.literal('on_stss'),
    filter: z.any().describe('ST-SS event filter expression'),
  }),
  z.object({
    kind: z.literal('schedule'),
    cron: z.string(),
  }),
]);
```

A keycap MAY have multiple triggers. Most have at least `pool_select` so they show in the `Ctrl` pool.

---

## 6. Flow — actor state machine

```typescript
const ActorFlow = z.object({
  initial: z.string().describe('Initial state name'),
  states: z.record(z.string(), StateDefinition),
});

const StateDefinition = z.object({
  on_enter: z.array(Effect).optional(),
  on_event: z.record(z.string(), z.object({
    target: z.string().describe('Next state name'),
    actions: z.array(Effect).optional(),
    guard: z.any().optional(),
  })).optional(),
  on_exit: z.array(Effect).optional(),
});
```

Example (translation keycap):

```yaml
flow:
  initial: idle
  states:
    idle:
      on_event:
        invoked:
          target: collecting_input
    collecting_input:
      on_enter:
        - ClipboardRead
      on_event:
        clipboard_read:
          target: calling_llm
    calling_llm:
      on_enter:
        - LlmCall:
            model: workers-ai/qwen-3
            prompt_template: "translate-zh-en-formal"
            deadline_ms: 3000
      on_event:
        llm_response:
          target: writing_output
    writing_output:
      on_enter:
        - ClipboardWrite
      on_event:
        clipboard_written:
          target: done
```

AI 创作助手generates this from NL: "I want a keycap that takes clipboard text and translates to formal English email."

---

## 7. Workspace layout

```typescript
const WorkspaceLayout = z.object({
  panels: z.array(z.object({
    id: z.string(),
    kind: z.enum(['input', 'output', 'log', 'diff', 'preview']),
    layout: z.enum(['column', 'row', 'stack']),
    size: z.union([z.number(), z.string()]),
  })),
  default_panel: z.string(),
});
```

If absent, kernel uses default workspace (single output text area + close button).

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

```yaml
id: clipboard-ai-rewrite
version: 1.0.0
name: 智能粘贴
description: 粘贴时让 AI 改写为指定语气
author: { handle: ctrl-team }
icon: 📋
source:
  type: builtin
  module: clipboard-enhance
capabilities:
  - ClipboardRead
  - ClipboardWrite
  - LlmCall: { model: workers-ai/qwen-3, max_tokens: 2048 }
triggers:
  - kind: hotkey
    combo: Ctrl+Shift+V
    contexts: [anywhere]
  - kind: pool_select
    section: top
    rank: 1
flow:
  initial: collecting_tone
  states:
    collecting_tone:
      on_enter:
        - SpawnActor:
            prototype: workspace-tone-picker
      on_event:
        tone_selected: { target: rewriting }
    rewriting:
      on_enter:
        - ClipboardRead
        - LlmCall:
            prompt_template: clipboard-rewrite-{tone}
            deadline_ms: 4000
      on_event:
        llm_response: { target: pasting }
    pasting:
      on_enter:
        - ClipboardWrite
        - EmitEvent: { kind: keycap_completed }
```

### 10.2 MCP-sourced postgres query keycap (creator example)

```yaml
id: pg-query-explain
version: 0.1.0
name: PG 查询解释
author: { handle: some-creator }
icon: 🐘
source:
  type: mcp
  server: anthropic/postgres
  tools: [query, explain]
  auto_install: true
capabilities:
  - McpInvoke: { server: anthropic/postgres, tool_glob: "*" }
  - LlmCall: { model: workers-ai/qwen-3 }
  - ClipboardRead
triggers:
  - kind: hotkey
    combo: Ctrl+Alt+P
flow: ...
market:
  public: true
  pricing: free
  tags: [database, sql, developer]
```

---

## 11. AI 创作助手 — generation API

```typescript
// L2 SDK exposes
import { generateManifest } from '@ctrl/creator-sdk';

const result = await generateManifest({
  user_intent: "我想要一个键帽, 把客户消息翻译成正式邮件",
  user_context: {
    has_anthropic_key: true,
    installed_keycaps: [...],
  },
  model: 'anthropic/claude-sonnet-4',  // BYOK or quota
});

// result.manifest is filled-in Zod-valid manifest
// result.dry_run_log contains sandbox test trace
// result.questions_remaining if AI needs more clarification
```

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
