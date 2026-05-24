# Manifest schema audit — research note 02

> Author: zeus · Status: open research, not a spec · Inputs: `packages/ctrl-keycap-sdk/src/manifest-schema.ts` v1 (just landed via keycap-dev merge), `00-framing-and-inventory.md` §9 M-seams, `01-workshop-ux.md` §11 Shape F material-supply needs.
> Goal: catalog what the current manifest schema ships, mark every Shape F material need as PRESENT / PARTIAL / MISSING, then propose the minimum-diff schema additions.

---

## 1. Schema overview (v1, 472 lines, single Zod source of truth)

What the schema currently models, in one paragraph each.

**Identity + branding** (top-level fields): `id`, `manifest_version=1`, `name`, `version` (semver), `author { name, github, url, email }`, `description { short, long }`, `icon` (Lucide name OR Unicode char), `keycap_color` (5 enum: amber/jade/cobalt/platinum/graphite), `category`, `tags`, `platforms`.

**Variant + source**: `variant` is one of 6 (`builtin` / `mcp-server` / `oauth` / `cli-wrapper` / `stss-publisher` / `local-agent`). `source` is a discriminated union mapped to 4 variants today (`mcp` carries `server_id + tool_name`; `oauth` carries provider + scopes; `cli-wrapper` carries command + args; `builtin` has no payload). `stss-publisher` + `local-agent` variants have no source payload yet.

**Permissions + capabilities**: `permissions` is a flat array of 11 enum tags (legacy; clipboard/network/screen/filesystem/audio/camera/notification/hotkey/mcp/vault/oauth). `capabilities` is the structured replacement — declared per-namespace with gate-enforceable shapes: `clipboard.{read,write}`, `text.{chat, transform.ops}`, `network.{http.allowlist + methods, open_url.allowlist}`, `keyring.{read[], write[]}`, `screen.{capture, list_displays}`, `file.{read_allowlist[], write_allowlist[]}`, `mcp.{spawn, invoke, notifications}`, `platform.{notify, hotkey}`.

**Workspace UI**: `workspace.ui` is a 9-enum (`none`/`notification`/`modal`/`clipboard`/`html-output`/`chat-stream`/`picker`/`form`/`canvas`). No custom HTML, no React component reference.

**Config schema**: `config_schema.fields[]` — each field has `key`/`kind`/`label`/`description`/`required`/`default`/`options`/`oauth`/`pattern`. ConfigFieldKind: string / url / secret / integer / boolean / enum / oauth. Secrets route to Keychain. OAuth fields trigger the kernel oauth.broker.

**Actions + steps**: `actions[]` (most keycaps have exactly one). Each action has `id`/`name`/`input`/`output`/`scenes`/`steps[]`. ActionInput = clipboard / selection / screen / none / prompt. ActionOutput = clipboard / modal / notification / workspace / silent. Scenes = any-app / browser / editor / terminal / office / chat-app.

**Steps** (9 types via discriminated union on `type`): `capture-clipboard`, `write-clipboard`, `llm` (system + prompt + model + max_tokens + temperature), `template`, `transform` (8 ops: base64/url/case/json/wordcount), `notify`, `open-url`, `mcp-invoke` (server + tool + args), `vault-write` (path + content + frontmatter). Each step can name its output via `as`, referenced in later steps via mustache `{{name}}` templates.

**Triggers**: `triggers[]` with kinds `hotkey` / `context-menu` / `spotlight`; engine TBD per schema comment.

**Validation**: `parseManifest(input)` returns `{ ok, manifest?, errors[] }` for shared use across kernel install, CLI lint, and Irisy creator live-validation.

The schema is **mature for v1 builtin keycaps** (the 16 starter set shipping from `share/modules/builtin/<id>/manifest.json`). It's **incomplete for Shape F creator flow** in 6 specific ways, mapped below.

---

## 2. Material-supply audit (§9 M-seams → schema fields)

For each M-seam from `00-framing-and-inventory.md` §9, the current schema status and the gap.

### M1 — Composes-this-keycap reference

**Today (PARTIAL)**: the `mcp-invoke` step type can call another keycap's MCP-server registration via `server + tool`. Since every installed keycap is also addressable via the kernel's MCP server (per memory `decision_keycap_is_mcp_server_only`), composition works — but you must know the target keycap's MCP `server_id` and `tool_name`, not its more natural `keycap.id`.

```ts
// Today, composing with Translate keycap requires:
{ type: 'mcp-invoke',
  server: 'ctrl.builtin.translate', // = the keycap id when self-hosted
  tool:   'invoke',                  // the default action's MCP tool name
  args:   { text: '{{clipboard}}' }
}
```

**Shape F need**: drag-from-keyboard or drag-from-palette of a base keycap onto the canvas should produce a step that references the keycap directly, not by MCP coordinates.

**Proposed addition**:
```ts
const KeycapInvokeStep = StepCommon.extend({
  type: z.literal('keycap-invoke'),
  keycap_id: z.string().min(1),
  action_id: z.string().optional(),  // omit → invoke default action
  inputs: z.record(z.string(), z.string()).optional(),  // mustache-templated arg passing
});
```

Cost: small. The kernel's `run_keycap` dispatch already exists; this step type makes it manifest-addressable. Backwards-compatible (additive to the discriminated union). The `mcp-invoke` step stays for external MCP servers.

### M2 — Manifest's UI primitive picker

**Today (PARTIAL — enum, no custom)**: `workspace.ui` is the 9-enum (`none`/`notification`/`modal`/`clipboard`/`html-output`/`chat-stream`/`picker`/`form`/`canvas`). Each enum value maps to a fixed primitive in the PWA. Good enough for 80% of v1 keycaps.

**Shape F need**: power creators want a custom React component OR a custom-HTML escape hatch when none of the 9 primitives fit.

**Proposed addition** (escape hatch, not replacing the enum):
```ts
workspace: z.object({
  ui: WorkspaceUi.default('none'),
  /** Optional: full path to a sandboxed HTML file bundled with the keycap.
   *  When set, kernel renders it in an iframe instead of the named primitive.
   *  Keycap manifest dir lives at ~/.ctrl/keycaps/<id>/; this path is relative. */
  custom_html: z.string().optional(),
  /** Optional: parameters passed to the primitive (e.g., picker.option_source). */
  config: z.record(z.string(), z.unknown()).optional(),
}).optional()
```

Cost: medium. The `custom_html` path requires kernel + PWA to load + sandbox the HTML; CSP / origin / capability gating need thought. Defer or ship with restrictions (no script eval in v1.1).

### M3 — Prompt registry → Irisy's pen

**Today (MISSING — inline only)**: `LlmStep` has `system: z.string()` and `prompt: z.string()`. Both inline. No way to reference a fragment from a registry (the G10 substrate I floated in REVIEW).

**Shape F need**: when Irisy authors a keycap, it should reuse vetted system-prompt fragments (e.g., a "translate to English idiomatic" fragment that lives once and is used by Translate keycap, Quick Ask in translate mode, Feishu-translate functional keycap, etc.). Without a registry, every authoring run reinvents the prompt and quality drifts.

**Proposed addition**:
```ts
const LlmStep = StepCommon.extend({
  type: z.literal('llm'),
  /** Inline prompt OR a registry reference (mutually exclusive with system_ref). */
  system: z.string().optional(),
  /** Reference to a registry entry. Resolved at run time:
   *  ~/.ctrl/prompts/<system_ref>.md (frontmatter + body). */
  system_ref: z.string().optional(),
  prompt: z.string().optional(),
  prompt_ref: z.string().optional(),
  // ... existing fields
}).refine(
  (s) => (s.system || s.system_ref) && (s.prompt || s.prompt_ref),
  { message: 'each LlmStep needs either inline or _ref for system + prompt' }
);
```

Cost: small in schema, medium in runtime (the kernel must read `~/.ctrl/prompts/` at dispatch time + cache + invalidate on edit). Coupled with G10 prompt substrate; can ship together.

### M4 — Icon picker

**Today (PARTIAL — Lucide-or-Unicode string)**: `icon: z.string().min(1)` with a comment "Lucide icon name OR single Unicode char". The PWA's `IconRenderer` (commit 28d6873) handles svg / lottie / dotlottie but the manifest can't address those richer assets — it just gets a string.

**Shape F need**: icon palette with a catalog of (Lucide / Unicode / curated SVG / curated lottie / dotlottie state machines). User picks; manifest records the choice.

**Proposed addition**:
```ts
export const KeycapIcon = z.union([
  z.string().min(1),  // legacy: Lucide name or single Unicode char
  z.object({
    kind: z.enum(['lucide', 'unicode', 'svg', 'lottie', 'dotlottie']),
    src: z.string().min(1),
    /** Theme injection for dotlottie state machines (per IconRenderer §3.3). */
    theme: z.object({
      colorRefs: z.record(z.string(), z.string()).optional(),
    }).optional(),
    /** Initial mood for state-machine icons (e.g., IrisyMascot 6-state). */
    initial_state: z.string().optional(),
  }),
]);

icon: KeycapIcon,
```

Cost: small (schema), medium (UI catalog). The IconRenderer already supports the underlying renderers; what's missing is the **catalog browser** in the workshop's icon palette.

### M5 — Creator workspace render

**Today (PRESENT for runtime, MISSING for creator-time)**: workspace.ui = 9 enum is fine for runtime rendering. But the **creator's workspace** (where the keycap is BEING BUILT) is a different surface that doesn't exist yet — that's Shape F's `/forge` route, not a manifest concern.

No schema gap here.

### M6 — Live test harness

**Today (PARTIAL)**: `parseManifest` validates statically; kernel's `run_keycap` invokes a fully-installed manifest. Running a **draft** manifest (not yet installed) is not supported.

**Shape F need**: edit-run-see loop on canvas. Run draft without `install_keycap`. Sandbox so a buggy step doesn't trash state.

**Proposed addition** (schema-side is small; kernel-side is the bigger lift):
```ts
/** Top-level optional. Marks this manifest as a draft, signaling to the
 *  kernel that it should be run sandboxed (in-memory state, no vault writes
 *  unless explicit `--commit` is passed). PWA shows a "Draft" badge.
 *  Once the creator commits, kernel installs it normally and the flag flips. */
draft: z.boolean().default(false).optional()
```

And a new Tauri command: `run_keycap_draft(manifest: KeycapManifest, action_id?: string)`.

Cost: schema is trivial. Kernel needs a sandbox mode for vault.write + side-effecting steps (e.g., open-url) — material to think about. MVP: only allow LlmStep + TemplateStep + TransformStep in draft mode; side-effecting steps no-op or simulate.

### M7 — Forks lineage

**Today (MISSING)**: no `derived_from` / `forked_from` / `upstream` field. Per memory `decision_keycap_3_tier_adjustment` Config / Patch / Fork, the Patch + Fork tiers need to know the upstream parent and current diff. The schema has nothing for it.

**Proposed addition**:
```ts
/** Optional lineage. Set on `keycap fork` / `keycap patch-init`. */
lineage: z.object({
  upstream_id: z.string().min(1),
  upstream_version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.\-]+)?$/),
  tier: z.enum(['config', 'patch', 'fork']),
  /** Patch tier only: per-field upstream-baseline so Irisy can offer
   *  "upstream changed X, cherry-pick?". Record of dotted-path → original value. */
  patch_baseline: z.record(z.string(), z.unknown()).optional(),
}).optional(),
```

Cost: small. Patch tooling (the diff resolver + Irisy hand-off) is bigger; schema just records the relationship.

### M8 — Marketplace browse

**Today (PARTIAL)**: `author`, `category`, `tags`, `version`, `description.short/long` cover the listing surface. What's missing:
- **stars / install count / freshness** (metadata derived at marketplace, not in manifest — OK)
- **screenshots / video preview** (`description.long` could embed markdown img refs; works)
- **license** (`License: All Rights Reserved` per CLAUDE.md is the project default; per-keycap license needed for 3rd-party):
  ```ts
  license: z.string().optional()  // SPDX identifier
  ```
- **discovery hints**: `tags` is free-form; a curated taxonomy would help filtering.

Cost: small (license field). Marketplace UI is downstream of this audit.

---

## 3. Consolidated Shape F additions

To support Shape F's full creator flow, the manifest schema needs these additions (minimum diff, additive):

```ts
// 1. New step type for composing with installed keycaps by id
const KeycapInvokeStep = StepCommon.extend({
  type: z.literal('keycap-invoke'),
  keycap_id: z.string().min(1),
  action_id: z.string().optional(),
  inputs: z.record(z.string(), z.string()).optional(),
});

// 2. LlmStep extended with prompt-registry refs (G10 hand-off)
// (See §M3 above — system_ref / prompt_ref fields)

// 3. Icon as object form (in addition to legacy string)
// (See §M4 above — KeycapIcon union)

// 4. workspace.custom_html escape hatch
// (See §M2 above — optional sandboxed HTML)

// 5. draft flag (M6) + run_keycap_draft Tauri command
draft: z.boolean().default(false).optional()

// 6. lineage block (M7)
// (See §M7 above)

// 7. license field for marketplace clarity (M8)
license: z.string().optional()  // SPDX identifier
```

Net schema delta:
- 1 new step type added to the discriminated union (`keycap-invoke`)
- 2 LlmStep optional fields (`system_ref`, `prompt_ref`)
- 1 icon shape extension (preserved as a union — old strings still valid)
- 1 workspace.custom_html optional field
- 3 new top-level optionals (`draft`, `lineage`, `license`)

**Manifest version**: this is fully additive. **No bump** of `manifest_version` required — v1 keycaps remain valid; new fields are optional. Bump to v2 only when something is *removed* or *renamed*.

---

## 4. Other schema observations (not Shape-F-specific)

While reading, two things stood out worth flagging separately.

### 4.1 `WorkspaceUi` enum overlaps with `ActionOutput` enum

`workspace.ui` and `actions[].output` both have `clipboard`, `modal`, `notification`. Not a bug — the action's output declares where the *primary result* goes (notification vs modal vs clipboard) while workspace.ui declares which renderer takes over the right pane. But the overlap suggests an opportunity to unify or at least cross-validate.

Example: `action.output = 'workspace'` + `workspace.ui = 'none'` is a paradox. Schema doesn't catch this. Consider:
```ts
.refine(
  (m) => m.actions.every((a) =>
    a.output !== 'workspace' || (m.workspace?.ui ?? 'none') !== 'none'
  ),
  { message: 'action.output=workspace requires workspace.ui != none' }
)
```

Minor. Not Shape-F-blocking.

### 4.2 `permissions` (flat) vs `capabilities` (structured) — drift risk

Schema comment says "Legacy flat permission list; prefer `capabilities` for new manifests". Both fields coexist; nothing enforces that `permissions` reflects `capabilities`. A keycap could declare `permissions: ['clipboard']` but `capabilities.clipboard` undefined, or vice versa.

Either:
- Make `permissions` optional + computed from `capabilities` at install (recommended).
- Run a refine() at parse time: if both present, intersect; if only `capabilities`, derive `permissions` automatically; if only `permissions`, accept as-is for back-compat.

This isn't Shape F's problem — it's a schema-hygiene cleanup. Flag for hephaestus's keycap-dev lane.

---

## 5. Open questions

1. **Should `keycap-invoke` step have circular-call protection at schema or runtime?** A draft keycap could declare it invokes itself or a cycle (A→B→A). Probably runtime: kernel maintains a per-invocation call stack with depth limit. Schema can't easily prove acyclicity.

2. **For `custom_html` escape hatch — what's the security model?** Bundled keycap = trusted (signed by author, capability-gated). Random user-supplied HTML = sandboxed iframe with strict CSP, no parent-origin access. Per kernel `mcp_server.rs` (already does Bearer auth + loopback only), we can extend.

3. **For prompt registry (G10) — file format?** Markdown with YAML frontmatter (`name`, `tags`, `version`, `variables_required`) + body = the prompt text? Or pure JSON? Markdown wins on vim test (philosophy gate).

4. **For draft keycaps — where do they live?** Vault is user-truth, but draft keycaps aren't user content per se — they're tooling. `~/.ctrl/keycaps/.drafts/<draft-id>/manifest.json`? Or a vault subdir the user can choose? Probably the former, with a per-draft `created_at` for cleanup.

5. **For Patch tier — what's "diff" mean for a manifest?** Field-level diff is the natural unit. Schema must support JSON-pointer addressing for `patch_baseline`. Or: store the upstream manifest verbatim alongside, compute diff on read. Trade memory for simpler schema.

6. **`stss-publisher` + `local-agent` variant `source` payloads are empty** — what should they carry? `stss-publisher` probably needs `stream_id` + `op_filter`. `local-agent` needs `socket_path` / `port` + auth method. Flag for future schema work, not Shape F blocker.

7. **Action `scenes`** (any-app / browser / editor / terminal / office / chat-app) — what's the runtime mechanism? Detection is OS-specific (window-class on Windows, app bundle id on macOS). Schema records intent; runtime detection isn't wired.

---

## 6. Recommended schema work order

To support the Shape F staged path from `01-workshop-ux.md` §11:

**Block this on nothing — ship these together as a v1.0.1 schema bump (no `manifest_version` change)**:
- `keycap-invoke` step type (additive; enables composition)
- `icon` as `KeycapIcon` union (additive)
- `lineage` top-level optional (additive)
- `license` top-level optional (additive)
- `draft` top-level optional (additive; coupled with new `run_keycap_draft` kernel command)

**Pair with G10 prompt substrate work**:
- `LlmStep.system_ref` + `LlmStep.prompt_ref`

**Pair with custom-HTML sandbox design**:
- `workspace.custom_html`

This way the first 5 items unblock Shape F's drag-and-drop step graph immediately, while the more-research items (G10 + sandbox) come later without re-bumping schema.

---

## 7. Next research move

After this: `03-irisy-emits-manifest-protocol.md` — the LLM contract for Irisy emitting (or proposing) a manifest. Tool-call shape vs free-form JSON vs hybrid; parse-and-validate handoff; iterative refinement via further turns. The schema audit done here is its input — Irisy can only emit what the schema accepts.

---

## Changelog

| Date | Author | What |
|---|---|---|
| 2026-05-23 | zeus | First pass — current schema overview, 8 M-seam coverage audit, 7-field consolidated diff for Shape F, 7 open Qs. Recommends additive 5-field schema bump unblocked, 2 fields paired with later work. |
