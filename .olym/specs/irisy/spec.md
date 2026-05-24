---
type: spec
spec_id: irisy
status: alpha
version: 0.2.0
owner: hephaestus
created: 2026-05-22
updated: 2026-05-22
superseded_check: 2027-05-22
lifecycle: alpha
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/specs/tool-manifest/spec.md
  - .olym/specs/kernel/spec.md
  - .olym/specs/pwa-shell/spec.md
  - doc/keycap-integration-research/00-inventory-and-abstractions.md
  - doc/keycap-integration-research/06-jiazuo-result.md
audit_dimension: ssot
---

# Irisy — hermes-powered workbench companion

> **One-line**: Irisy is a hermes-agent runtime running on user's machine, fronted by the CTRL PWA workbench, that grows hands (keycaps) and feet (OS capability) and accompanies the user across an 8-stage keycap lifecycle.

---

## 1. Why

ADR-001 envisioned a Rust microkernel + 5 capability primitives + per-keycap WASM actors. ADR-010 then unified the outward keycap protocol as MCP. Athena's earlier work (memory `decision_drop_hermes_for_irisy_v1`) shipped a stop-gap PWA-side LLM transport that talks to Volc directly. The shortcut was right at the time — but it leaves several fundamental problems open:

1. **No real agent loop on the user's machine.** PWA-side `LLMTransport` is single-turn streaming; multi-step tool-use loops, error recovery, mid-stream observation, skill auto-improvement — all absent. Re-implementing an agent runtime in TypeScript was attempted (this spec's author burnt ~2k LOC writing `lifecycle-tokens.ts` / `lifecycle-store.ts` / `lifecycle-runner.ts` before scrapping them).
2. **No skill / memory persistence model.** Skills are how a creator's keycap "personality" survives across runs and across users. Without a runtime that hosts skills, every keycap is amnesiac.
3. **No remote / multi-channel reach.** Power users want to fire keycaps from their phone (Telegram / Discord / Slack / Matrix bot); CTRL's "PWA-only" stance left this on the floor.
4. **Workbench framing vs chat framing.** The PWA was drifting toward "chat app with keycap shortcuts". bao 2026-05-22 reframed: CTRL is **not** a chat app — it's an **AI-augmented workbench** (like Cursor for code, Figma for design, Notion for docs). The user works in the workbench; Irisy is a companion at the side, not a stage front and center.

This spec replaces the home-grown PWA agent loop with **hermes-agent (NousResearch, MIT, 163k★)** as Irisy's brain, and pins down the architecture, manifest schema v0.2, lifecycle, and owner-by-component contract so daedalus (PWA) and zeus (kernel) can implement against a fixed surface.

**What changes if we don't ship this spec**:
- PWA continues drifting toward chat-app shape, losing the workbench differentiation
- Keycap creators face two protocols (PWA-side LLM transport vs kernel MCP) — schema drift continues (currently 4 manifest schemas in tree, see §3.1)
- Skill / memory layer keeps being deferred
- Remote / multi-device entry stays handwaved
- Every "new keycap" needs ad-hoc PWA + kernel coordination — exactly the "1 keycap 1 管线" failure mode bao flagged

---

## 2. Scope

**In scope** (this spec is the contract for):

- CTRL ↔ hermes ↔ kernel ↔ PWA topology (process boundaries + protocols)
- 8-stage lifecycle Irisy walks with the user (Discovery → Creation → Config → Invoke → Collab → Debug → Improvement → Retire)
- Manifest schema v0.2 — full canonical Zod schema, deltas vs v0.1
- Keycap ↔ hermes skill 同构 (option B from prior discussion) — synchronous SKILL.md generation on install
- 3-tier user adjustment (Config / Patch / Fork) — semantics + lineage tracking
- 4-layer auto-update (CTRL.app / hermes / keycap / PWA) — strategies + Patch merge resolution
- Hermes installer flow (lazy, post-CTRL-install detect + curl bootstrap)
- Owner-by-component delineation (who builds what — hephaestus / daedalus / zeus)

**Out of scope** (this spec does not prescribe):

- Concrete PWA component code (daedalus's call within workbench framing)
- Concrete kernel Rust code (zeus's call within MCP server framing)
- Hermes itself (upstream MIT project; CTRL depends on, does not fork)
- ctrl-market public registry (defers to a future market spec once content + revenue model stabilises)
- Mesh layer cross-device sync (ADR-003 — separate spec)
- Approval gating for destructive operations beyond what hermes already offers via `/v1/runs/{id}/approval`
- Localisation / i18n (per `decision_ctrl_is_global_english_first` — global English-first; i18n deferred)

---

## 3. Design

### 3.1 Architecture — hermes 大脑 + CTRL 手脚 + 工作台

Per memory `decision_ctrl_is_hermes_workbench`. Maps directly to component implementation:

| Body part | Component | Owner |
|---|---|---|
| **Brain** | hermes-agent Python runtime (agent loop / skills / memory / cron / multi-LLM provider) | upstream NousResearch (MIT); CTRL depends, never forks |
| **Hands** | Keycaps — atomic one-shot actions surfaced as MCP tools | hephaestus (contract); zeus (kernel-side dispatch) |
| **Feet** | OS capabilities — clipboard / screen / window / file / hotkey / vault — exposed as MCP tools by kernel MCP server | zeus (kernel MCP server) |
| **Eyes** | Workspace cell/op stream — hermes observes its own execution; PWA renders for user | zeus (kernel publishes); daedalus (PWA renders) |
| **Mouth** | Irisy — hermes-driven companion chat surfaced as a Workspace tab in PWA | daedalus (UI); hephaestus (persona content) |
| **Workbench** | PWA 2-zone layout: Keyboard (left toolbar) + Workspace (right work area, IDE multi-tab) + vault (markdown output) | daedalus |

**Anti-framing** (CTRL is NOT):
- A chat app (ChatGPT / Claude.ai style)
- A launcher (Raycast / Alfred)
- A workflow editor (Coze / n8n / Zapier)
- A tool aggregator that pipes 3rd-party SaaS

### 3.2 Topology — three processes, two protocols

```
┌─────────────────────────────────────┐
│  Tauri shell (Rust, ~25 MB)         │
│  ┌───────────────────────────────┐  │
│  │  L1 Kernel (Rust)             │  │
│  │  - capability backend (8 ns)  │  │
│  │  - run_keycap dispatch        │  │
│  │  - vault.* / clipboard.* etc. │  │
│  │  - hermes_supervisor          │  │
│  │  - MCP server (streamable-http│  │
│  │    on 127.0.0.1:17873)        │  │
│  └────────┬──────────────────────┘  │
│           │ in-process              │
│  ┌────────▼──────────────────────┐  │
│  │  WebView (PWA)                │  │
│  │  - Keyboard + Workspace UI    │  │
│  │  - hermes API client          │  │
│  │  - cell/op stream renderer    │  │
│  └────────────┬──────────────────┘  │
└───────────────┼─────────────────────┘
                │ HTTP / SSE
                │ 127.0.0.1:8642
                ▼
┌─────────────────────────────────────┐
│  Hermes (Python, ~100 MB venv)      │
│  - agent loop                       │
│  - skills (~/.hermes/skills/)       │
│  - memory (~/.hermes/MEMORY.md +    │
│    sessions SQLite)                 │
│  - OpenAI-compatible API on :8642   │
│  - MCP client → kernel MCP server   │
│    on 127.0.0.1:17873               │
└─────────────────────────────────────┘
```

**Protocols**:

| Edge | Protocol | Auth |
|---|---|---|
| PWA ↔ kernel (Tauri shell) | Tauri `invoke` (in-process IPC) | Tauri origin check |
| PWA ↔ hermes API | HTTP + SSE via `localhost:8642/v1/...` (OpenAI-compatible: `/chat/completions`, `/runs`, `/runs/{id}/events`) | `X-Hermes-Session-Token` (rotated per hermes start) |
| Hermes ↔ kernel MCP server | MCP streamable-http on `localhost:17873` | per-process bearer token (kernel issues, supervisor injects to hermes env) |
| Kernel ↔ external MCP servers (Pattern D keycaps) | MCP stdio | per-keycap sandbox profile (sandbox-exec / landlock+seccomp / AppContainer) |

**Port allocation note**: `17872` (ST-SS bridge — kernel cell/op stream WebSocket for PWA workspace) and `17873` (kernel MCP server for hermes function-calling) are deliberately differentiated, not a typo. ST-SS is a CTRL-internal stream protocol (CBOR Cell/Op); MCP is the standard tool-RPC surface for hermes + external AI clients.

**Why this topology**:
- PWA gets the workbench experience without rolling its own agent loop
- Kernel keeps the fast in-process Tauri invoke path for PWA UI (no MCP overhead)
- Hermes uses the same kernel MCP server external 3rd-party agents would use → "kernel as MCP server" is one surface, not two
- All cross-process traffic stays on `127.0.0.1` (Obsidian "local is truth" philosophy)

### 3.3 Hermes installer flow (lazy)

Per `decision_auto_update_first_class` + bao 2026-05-22 拍 (b) lazy installer.

CTRL Tauri installer remains ≤ 25 MB (ADR-003 budget preserved). On first launch:

1. Kernel `hermes_supervisor` checks `which hermes` + `hermes --version`
2. If absent or below `min_hermes_version` → kernel raises a structured event to PWA
3. PWA renders an onboarding pane (daedalus owns) showing:
   - "CTRL needs hermes (Python agent runtime, ~100 MB). Install now?"
   - One-click button that invokes kernel command `bootstrap_hermes`
4. Kernel `bootstrap_hermes` — **default path = PyPI pip install** (zeus 2026-05-22 verified `hermes-agent==0.14.0` on PyPI):
   ```
   1. Check `python3 --version` >= 3.11 (else prompt user to install Python or auto-fetch via uv)
   2. Create venv: `python3 -m venv ~/.ctrl/hermes-venv`
   3. pip install: `~/.ctrl/hermes-venv/bin/pip install 'hermes-agent[mcp,web]'`
   4. Verify: `~/.ctrl/hermes-venv/bin/hermes --version`
   5. Start: `~/.ctrl/hermes-venv/bin/hermes gateway --port 8642`
   ```
   **Optional quick path** = upstream `install.sh` (verified HTTP 200 at https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh as of 2026-05-22). Exposed as a `--quick-install` flag on `bootstrap_hermes` for users who already have `curl` + accept the upstream installer's uv-driven Python provisioning. Default stays pip — fewer moving parts, fewer failure modes, easier to reason about.

   Sets `~/.ctrl/hermes-venv/` (CTRL-scoped); hermes-side data lives at `~/.hermes/` (hermes's own default).
   Windows path: `~/.ctrl/hermes-venv/Scripts/...` + auto-fetched Python via uv if absent.
5. Kernel verifies install succeeded; starts `hermes gateway` + `hermes web` (FastAPI on :8642) as supervised subprocesses
6. PWA flips off the onboarding pane, lands the user on Workspace

**Failure modes** (counter-evidence § 7):
- No network → onboarding shows offline retry + manual install instructions
- Python install fails → fallback to user-provided Python (kernel detects existing Python ≥ 3.11)
- Behind corporate proxy → installer respects `HTTPS_PROXY` env

### 3.4 8-stage lifecycle (PWA-inferred)

Hermes runs its own native plan-execute-observe agent loop. CTRL **does not** train hermes to emit stage tokens — stages are an **inference** done by the PWA from hermes's structured SSE event stream.

**Verified SSE event types** (hephaestus 2026-05-22 grep'd `gateway/platforms/api_server.py` in NousResearch/hermes-agent main branch). Hermes follows **OpenAI Responses API** event naming + custom `hermes.tool.*` events:

| Event type | Meaning |
|---|---|
| `response.created` | Run started; hermes accepted the user turn |
| `response.output_item.added` | A new output item (message / function call / etc.) appended to the run |
| `response.output_text.delta` | Streaming text chunk for an output_text item |
| `response.output_text.done` | An output_text item finished |
| `response.output_item.done` | Any output item (text / function call / tool result) finished |
| `response.failed` | Run failed mid-way |
| `response.completed` | Run finished successfully |
| `hermes.tool.progress` | Custom: mid-run tool-call progress (the "Collab" signal) |
| (approval events — to spike-verify) | Approval gating via `/v1/runs/{id}/approval` — payload schema needs runtime spike |

**Stage inference rules** (PWA listens, never emits to hermes):

| Stage | Trigger pattern | PWA UI response |
|---|---|---|
| **Discovery** | New run starting (`response.created`) on an empty conversation, OR user intent matches "find/use a tool" | Show Keyboard + recently-used keycaps; Irisy reads inventory |
| **Creation** | `response.output_item.added` for a function call to `keycap.install_proposed` (kernel MCP tool, see §C15), OR explicit user intent "create a new keycap" | Switch Workspace tab to Creator pane (manifest preview + code preview) |
| **Config** | A keycap MCP tool returns an error payload starting with `CAPABILITY_VIOLATION: config missing` (kernel-side error code), OR fresh install with non-empty `config_schema` | Switch Workspace tab to Configurator pane (field-by-field form) |
| **Invoke** | `response.output_item.added` for a function call where the function name matches an installed keycap MCP tool | Switch Workspace tab to that keycap's workspace pane; subscribe to `keycap-<id>` cell stream |
| **Collab** | `hermes.tool.progress` mid-stream OR an approval-gating event from `/v1/runs/{id}/approval` | Stay on keycap workspace; surface progress chunks; show approval modal if needed |
| **Debug** | `response.failed` OR `response.output_item.done` for a function call output where the result indicates error | Highlight failed step in Workspace; Irisy suggests fix in chat tab |
| **Improvement** | User-initiated "tweak this keycap" intent OR a function call to `patch_keycap_manifest` (kernel MCP tool, see §C6) | Switch to Patch editor (override diff visualisation) |
| **Retire** | User-initiated "uninstall X" intent OR a function call to `uninstall_keycap` (kernel MCP tool) | Show retire confirmation + cleanup preview |

**Verification spike required before C9 implementation**:

```bash
# Run after C4 (bootstrap_hermes) lands in alpha, before C9 (PWA inference)
~/.ctrl/hermes-venv/bin/hermes gateway --port 8642 &
TOKEN=$(~/.ctrl/hermes-venv/bin/hermes token)
curl -X POST http://localhost:8642/v1/runs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"call any tool"}]}'
# Capture run_id, then:
curl -N "http://localhost:8642/v1/runs/$RUN_ID/events" \
  -H "Authorization: Bearer $TOKEN" > sse-trace.log
```

Verify each row above against the captured `sse-trace.log` payloads. Any mismatch → update the inference rule table here and bump the spec version. **Unknown event types fall back to a generic "agent activity" notification** (failure mode B in §8).

**Inference is best-effort** — wrong inference is recoverable (user can manually switch tab). Hermes stays general; PWA stays simple; CTRL stays workbench-shaped.

### 3.5 Keycap dispatch by `target` — default MCP server, opt-in hermes skill

**Correction from spec v0.1**: v0.1 prescribed every keycap synchronously generate a SKILL.md (option B 同构). bao 2026-05-22 corrected: keycap ≠ hermes skill, **not 1:1**.

- bao: "我们为什么既要 keycap mcp tool 又要 hermes skill?"
- bao: "每个 keycap 都有 hermes skill 吗?"
- bao: "skill 该用就用, skill 也需要手脚"

**Revised model** — manifest declares its `target`:

| `target` | Surface to hermes | Storage | Use case |
|---|---|---|---|
| `mcp-tool` (default, ~90% of keycaps) | Kernel MCP server exposes the keycap as MCP tools (+ optionally MCP resources + prompts derived from manifest) — hermes calls via function calling | `~/.ctrl/keycaps/<id>/manifest.json` only — **no SKILL.md** | Atomic actions: clipboard transforms, HTTP sinks, search, image gen, file ops, 16 G builtins, Patterns A-G |
| `hermes-skill` (minority, complex reasoning / knowledge-intensive) | Hermes loads as a skill; agent reads SKILL.md + assets as instructional / procedural context | `~/.ctrl/keycaps/<id>/manifest.json` + `~/.hermes/skills/<id>/SKILL.md` + assets | Multi-step workflows that need the agent to read playbook-style instructions: code review, complex research, lengthy creative briefs, knowledge bases |

**Skills can also be installed independently of any keycap** (e.g. from agentskills.io upstream). Those are not under this spec's manifest schema — they are pure hermes skills.

**`target=mcp-tool` flow** (default):

```
~/.ctrl/keycaps/<id>/manifest.json         # CTRL canonical (target=mcp-tool)
~/.ctrl/keycaps/<id>/config.json           # User Config tier values
~/.ctrl/keycaps/<id>/patch.json            # User Patch tier overrides (if any)
# NO SKILL.md generated.
# Kernel MCP server registers a tool per `actions[]` entry and answers tools/list
# for hermes function-calling discovery. Optionally registers MCP `resources`
# (the manifest's description + capabilities listing) and `prompts` (a template
# pre-filling the action). hermes invokes via tools/call.
```

**`target=hermes-skill` flow** (opt-in):

```
~/.ctrl/keycaps/<id>/manifest.json         # CTRL canonical (target=hermes-skill)
~/.ctrl/keycaps/<id>/config.json           # User Config tier values
~/.ctrl/keycaps/<id>/patch.json            # User Patch tier overrides (if any)
~/.hermes/skills/<id>/SKILL.md             # hermes-side procedural mirror
~/.hermes/skills/<id>/manifest.json        # symlink → ~/.ctrl/keycaps/<id>/manifest.json
~/.hermes/skills/<id>/assets/              # optional templates, examples, knowledge files
```

**SKILL.md format** (agentskills.io-compatible, only emitted when `target=hermes-skill`):

```markdown
---
name: <id>
version: <semver>
description: <keycap description>
tools:
  - kernel.<capability_method_1>
  - kernel.<capability_method_2>
inputs:
  - clipboard | selection | screen | none | prompt
output:
  - clipboard | modal | notification | workspace | silent
---

# <name>

<description>

## When to invoke
<plain-language hint for hermes function-calling decision>

## How
1. <step 1, references kernel MCP tool>
2. <step 2>
3. <step N>

## Capabilities required
- <capability namespace + methods + allowlists>

## Configuration
<rendered from config_schema; values come from config.json at invoke time>
```

The SKILL.md is **generated** from the manifest by a deterministic function (no LLM call). hephaestus owns the TS reference; zeus owns the in-kernel Rust mirror.

**Fork tier behaviour** (per `target`):
- `target=mcp-tool` fork: copy manifest only to `~/.ctrl/keycaps/private/<new-id>/`. No SKILL.md to fork.
- `target=hermes-skill` fork: copy manifest + SKILL.md + assets to `~/.ctrl/keycaps/private/<new-id>/` + `~/.hermes/skills/<new-id>-mine/`. The new id gets a `forked_from: <original_id>` field.
- Config / Patch tiers (both targets) never fork — kernel composes overrides at dispatch time.

### 3.6 3-tier user adjustment

Per `decision_keycap_3_tier_adjustment`.

| Tier | What changes | Where stored | Auto-update behaviour |
|---|---|---|---|
| **Config** (light) | Fields declared in `manifest.config_schema` (host, secret, personalise) | `~/.ctrl/keycaps/<id>/config.json` + macOS Keychain (for secrets) | Manifest auto-updates over the user's config (config.json untouched). Clean path. |
| **Patch** (medium) | Override layer over manifest fields (system prompt, model, step inputs) | `~/.ctrl/keycaps/<id>/patch.json` (JSON Pointer paths → new values) | Smart merge on auto-update. Conflict → Irisy raises in chat: (a) keep my patch / (b) accept upstream / (c) Irisy-assisted merge. |
| **Fork** (heavy) | Full divergence; user owns a copy that no longer tracks upstream | `~/.ctrl/keycaps/private/<new-id>/manifest.json` + SKILL.md fork | Not auto-updated. Irisy may prompt "upstream has v0.2, cherry-pick X?" but never overwrites. |

**Composition order at dispatch** (kernel's `run_keycap`):

```
base manifest (upstream)
  + patch_overrides (deep-merge via JSON Pointer)
  + config_schema values (template expand: ${config.host} etc.)
  → effective manifest
  → execute steps
```

### 3.7 4-layer auto-update

Per `decision_auto_update_first_class`.

| Layer | Mechanism | Owner |
|---|---|---|
| CTRL.app (Tauri shell + kernel) | tauri-plugin-updater — background check + download + apply on user restart | zeus |
| Hermes runtime | hermes built-in `hermes update` CLI invoked by `hermes_supervisor` on schedule + on PWA-initiated manual check | zeus (supervisor); hermes upstream (update logic) |
| Keycap | manifest's `upstream.source_url` polled per `upstream.channel` (stable / beta); kernel applies new manifest, regenerates SKILL.md | zeus (kernel update worker); hephaestus (upstream protocol spec) |
| PWA bundle | vite-plugin-pwa service worker (already in place) | daedalus (existing) |

Auto-update defaults **on** (Apple App Store model). Users can per-keycap or globally opt out via Workspace `Updates` pane (daedalus).

**Patch conflict resolution** (the only non-trivial case):

When auto-updating a Patched keycap and a patch path conflicts with new upstream:
1. Kernel pauses the update for that keycap, snapshots old manifest to `~/.ctrl/keycaps/<id>/.history/v<old>.json`
2. Kernel emits `keycap.update_conflict` event with `{ keycap_id, conflicting_paths, old, new }`
3. PWA shows a conflict modal in the Updates pane (daedalus)
4. Irisy is invoked with the conflict context; offers user the 3 options (keep patch / accept upstream / Irisy-assist merge)
5. On Irisy-assist merge, hermes runs a small one-shot using the patch + new manifest to produce a re-targeted patch

---

## 4. Manifest schema v0.2 (canonical)

Schema lives at `packages/ctrl-keycap-sdk/src/manifest-schema.ts` (TypeScript Zod, SSOT). Rust serde struct in `src-tauri/src/kernel/keycap_manifest.rs` mirrors field-for-field (manual + golden-file test enforced).

Delta vs v0.1 (`.olym/specs/tool-manifest/spec.md`):

### 4.1 Top-level fields (added or changed)

| Field | Status | Description |
|---|---|---|
| `target` | **new** (default `mcp-tool`) | Dispatch routing — `mcp-tool` (default, kernel MCP server registers tools+resources+prompts) or `hermes-skill` (SKILL.md generated, hermes loads as procedural skill). See §3.5. |
| `variant` | **new** (default `builtin`) | Dispatch sub-type within `target=mcp-tool`: `builtin` / `mcp-server` / `oauth` / `cli-wrapper` / `stss-publisher` / `local-agent` |
| `capabilities` | **new** | Structured per-namespace declaration (see 4.2). Supersedes flat `permissions[]` in v0.1 (kept optional for legacy 16 G builtins). |
| `workspace` | **new** | `{ ui: WorkspaceUi, custom_component_path?: string }` — which PWA renderer this keycap's output flows into (9 enum + `custom`, see 4.3) |
| `config_schema` | **new** | Fields the user fills via Config tier (4.4) |
| `forked_from` | **new** (optional) | Lineage — original keycap id if this is a Fork |
| `patch_overrides` | **new** (optional) | JSON-Pointer-keyed override layer for Patch tier (4.5) |
| `upstream` | **new** (optional) | `{ source_url, channel, auto_update }` for auto-update wiring (4.6) |
| `min_ctrl_version` | **new** (optional) | semver constraint — installer/runtime rejects if host below this |
| `min_hermes_version` | **new** (optional) | semver constraint — keycaps that need newer hermes features |
| `manifest_version` | kept | Literal `1` for now; bump on schema-breaking change |

### 4.2 `capabilities` object (8 v1 namespaces)

Lifted from spike 06 §Q2.13. The 5 v1.1 namespaces (`process` / `network.local_rpc` / `oauth.broker` / `stss` / `image`) have **reserved** sub-schemas in the same TS module but kernel does not expose them until the bucket-promotion trigger fires (see `decision_keycap_3_tier_adjustment` and spike 06 §Q2.11).

```typescript
const Capabilities = z.object({
  clipboard: z.object({ read: z.boolean(), write: z.boolean() }).optional(),
  text: z.object({
    chat: z.boolean(),
    transform: z.object({ ops: z.array(TextTransformOp) }).optional(),
  }).optional(),
  network: z.object({
    http: z.object({
      allowlist: z.array(z.string()).min(1),
      methods: z.array(HttpMethod),
      max_request_size_kb: z.number().int().optional(),
    }).optional(),
    open_url: z.object({ allowlist: z.array(z.string()).min(1) }).optional(),
  }).optional(),
  keyring: z.object({
    read: z.array(z.string()),    // each entry namespaced by manifest.id
    write: z.array(z.string()),
  }).optional(),
  screen: z.object({ capture: z.boolean(), list_displays: z.boolean() }).optional(),
  file: z.object({
    read_allowlist: z.array(z.string()),
    write_allowlist: z.array(z.string()),
  }).optional(),
  mcp: z.object({
    spawn: z.boolean(),
    invoke: z.boolean(),
    notifications: z.boolean(),
  }).optional(),
  platform: z.object({ notify: z.boolean(), hotkey: z.boolean() }).optional(),
});
```

**Enforcement**: kernel `run_keycap` reads effective `capabilities` (after Patch merge) before invoking any step; missing capability → `CAPABILITY_VIOLATION` error returned to hermes which surfaces it to Irisy debug stage.

**Namespacing rule**: `keyring.read` / `keyring.write` paths are forced-prefixed by `${manifest.id}.*` — one keycap cannot read another keycap's secret.

### 4.3 `workspace.ui` (9 generic renderers + 1 escape hatch)

Frontend has a single dispatch registry; **adding a new keycap should not add a new PWA component except for explicitly UI-novel keycaps** (Code Space being the canonical example).

| Value | Renderer description |
|---|---|
| `none` | No workspace pane — output is silent or notification-only |
| `notification` | Toast + system notification |
| `modal` | Ephemeral modal showing stringified result |
| `clipboard` | Clipboard write + small confirmation pip |
| `html-output` | Generic structured renderer for MCP content arrays + CLI stdout (covers ~70% of long-tail keycaps) |
| `chat-stream` | LLM streaming view (translate / rewrite / chat-style outputs) |
| `picker` | Option list (snippet / RAG hits / preset) |
| `form` | Schema-driven form (config / OAuth scope / drafted message) |
| `canvas` | Image / region overlay (screenshot / OCR / poster) |
| `custom` | **Escape hatch** — keycap supplies its own React component path via `workspace.custom_component_path`. Required for genuinely novel UIs (Code Space PTY + file tree + diff view; future video editor; future shader playground). PWA `keycap-tab-registry.ts` (daedalus) maps `custom_component_path` → mounted component. |

```typescript
const Workspace = z.object({
  ui: WorkspaceUi,  // includes 'custom'
  /** Required when ui = 'custom'. Path relative to packages/ctrl-web/src/. */
  custom_component_path: z.string().optional(),
}).refine(
  (w) => w.ui !== 'custom' || !!w.custom_component_path,
  { message: 'custom_component_path required when ui = "custom"' },
);
```

**Creator-economy implication**: third-party creators contributing keycaps with `ui: 'custom'` ship their React component as part of the keycap bundle; daedalus's registry loads from `~/.ctrl/keycaps/<id>/component/` at runtime. CTRL's first-party `custom` keycap is Code Space (lane H-19-001, in_progress — owner zeus path C).

### 4.4 `config_schema`

```typescript
const ConfigField = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  kind: z.enum(['string', 'url', 'secret', 'integer', 'boolean', 'enum', 'oauth']),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean(),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),  // for kind=enum
  oauth: z.object({                          // for kind=oauth
    provider: z.string(),
    scopes: z.array(z.string()),
  }).optional(),
  pattern: z.string().optional(),
});
const ConfigSchema = z.object({ fields: z.array(ConfigField).min(1) });
```

`secret`-kind fields are routed to macOS Keychain (or Windows Credential Manager / Linux Secret Service); never written to `config.json`. `oauth`-kind triggers hermes-native OAuth loopback flow (when `oauth.broker` v1.1 ships).

### 4.5 `patch_overrides`

JSON-Pointer-keyed deep-merge target.

```typescript
const PatchOverrides = z.record(
  z.string().regex(/^\/[a-zA-Z0-9_.\-/]+$/),  // JSON Pointer
  z.unknown(),
);
```

Example:

```json
{
  "patch_overrides": {
    "/actions/0/steps/1/system": "You translate in a casual, conversational tone.",
    "/actions/0/steps/1/model": "claude-3-5-sonnet"
  }
}
```

At dispatch, kernel applies these against base manifest before resolving `config_schema` template expansions.

### 4.6 `upstream`

```typescript
const Upstream = z.object({
  // GitHub release URL / ctrl-market URL / git+https://... — Zod's stock
  // `.url()` does not accept `git+https://` scheme; use a regex that admits
  // both standard http(s) and git+https.
  source_url: z.string().regex(
    /^(https?|git\+https?):\/\/[^\s]+$/,
    { message: 'source_url must be http(s) or git+https URL' },
  ),
  channel: z.enum(['stable', 'beta']).default('stable'),
  auto_update: z.boolean().default(true),
});
```

Kernel update worker polls source_url per channel + per global update preferences; on new-version detection runs the auto-update flow (3.7).

---

## 5. Keycap → SKILL.md generator

Deterministic function (no LLM). Lives in `packages/ctrl-keycap-sdk` as TS reference; mirror in kernel Rust for install-time generation.

```typescript
function generateSkillMd(manifest: KeycapManifest, config: ConfigValues): string
```

**Frontmatter fields**:
- `name`: `manifest.id`
- `version`: `manifest.version`
- `description`: `manifest.description.short`
- `tools`: list of kernel MCP tool names this keycap calls (derived from `actions[*].steps[*].type` or from `mcp.invoke` step targets)
- `inputs`: array of `action.input` types used
- `output`: most-common `action.output` (workspace UI hint)

**Body**:
- `## When to invoke` — phrased for hermes's function-calling decision; if absent, generated from `description.long` + step types
- `## How` — numbered list of step types as plain-language instructions
- `## Capabilities required` — flatten `capabilities` into a readable bullet list with allowlists
- `## Configuration` — render `config_schema` fields as a description; placeholder syntax `${config.<key>}` shown so hermes knows what values get injected at invoke time

**Re-generation triggers**:
- On install / Fork
- On Patch save (regenerate to reflect new prompt / model)
- On Config save (regenerate to reflect new descriptions, but secrets never appear)
- On auto-update apply

Re-generation is idempotent; the function never reads `~/.hermes/skills/<id>/SKILL.md` to merge — it always re-emits from manifest + config truth.

---

## 5.5 License & attribution (hermes-agent MIT compliance)

Hermes-agent is MIT-licensed (NousResearch / Nous Research). CTRL stays "All Rights Reserved" — MIT does not infect.

**Required by MIT**:

| Obligation | How CTRL satisfies it |
|---|---|
| Preserve copyright + MIT full text | Add `THIRD_PARTY_LICENSES.md` at repo root containing the verbatim hermes-agent LICENSE text + Nous Research copyright line |
| Acknowledge usage in distributed product | PWA Settings → About → "Acknowledgements" section lists `hermes-agent` (MIT, by Nous Research, link to https://github.com/NousResearch/hermes-agent) |
| Don't misrepresent authorship | Marketing / docs / UI text uses "Powered by Hermes Agent" or "Integrates with hermes-agent (MIT)" — never imply CTRL authored the agent runtime |

**NOT required by MIT** (CTRL does NOT need to):
- Open-source CTRL itself (CTRL stays All Rights Reserved + private repos)
- Mirror / re-publish hermes source (hermes is upstream open on GitHub)
- Contribute modifications back (voluntary)
- Add marketing-page footnotes (license obligation does not extend to marketing surfaces)

**Distribution mode → lazy install (already locked in `decision_auto_update_first_class`)**:

- CTRL Tauri installer does NOT bundle the hermes wheel. First-launch onboarding (§3.3) curls hermes's own installer.
- This keeps CTRL out of the "distributor" role for hermes binaries → minimum MIT responsibility (pip carries hermes LICENSE automatically into the user's venv).
- If a future packaging decision bundles hermes (e.g. air-gapped enterprise installer), CTRL becomes a distributor and `THIRD_PARTY_LICENSES.md` must additionally enumerate all 30-50 transitive deps' licenses. Stay lazy unless explicitly required.

**Explicitly disallowed by this spec** (decision-level, not legal):

- **Do NOT fork or modify hermes source.** Behavior changes go through CTRL-owned skills (`~/.hermes/skills/...`) or hermes plugins (NousResearch/hermes-example-plugins as reference) — never by patching upstream. Fork would create a derivative-work obligation (still MIT but maintenance-heavy), make upstream sync painful, and contradicts the project-wide "Config/Patch over Fork" preference encoded in `decision_keycap_3_tier_adjustment`.

**Companion hermes-* repos** (audited; only `hermes-agent` is used by CTRL v1):

| Repo | Used by CTRL? | License | Note |
|---|---|---|---|
| `NousResearch/hermes-agent` | ✅ yes | MIT | The runtime. |
| `NousResearch/hermes-example-plugins` | Reference only | MIT (verified 2026-05-22 via `gh api repos/NousResearch/hermes-example-plugins`) | Pattern source for SKILL.md plugins if needed. |
| `NousResearch/hermes-paperclip-adapter` | ❌ no | — | Tied to Paperclip product, not relevant. |
| `NousResearch/autonovel` | ❌ no | — | Unrelated product. |
| `NousResearch/hermes-agent-self-evolution` | ❌ no | — | Research project. |
| `NousResearch/Hermes-Function-Calling` | ❌ no | — | LLM fine-tuning project, not the runtime. |
| `NousResearch/hermes-compression-eval` | ❌ no | — | Eval harness. |

Any future integration of a non-`hermes-agent` repo from this org requires a separate license audit and an addition to `THIRD_PARTY_LICENSES.md`.

---

## 6. Components & Owners

Not a phase list. Each row is a deliverable owned by exactly one persona; persona ships when ready.

| # | Deliverable | Owner |
|---|---|---|
| C1 | manifest schema v0.2 (TS Zod, this spec's §4) — at `packages/ctrl-keycap-sdk/src/manifest-schema.ts` | hephaestus (done partially, finishing `upstream` / `forked_from` / `patch_overrides` / `min_*_version` fields) |
| C2 | Rust serde mirror of v0.2 in `src-tauri/src/kernel/keycap_manifest.rs` + golden-file test parity | zeus |
| C3 | Keycap → SKILL.md generator TS reference + kernel Rust mirror — **conditional**: only fires when `manifest.target === 'hermes-skill'`; `target=mcp-tool` keycaps skip skill emit and instead register MCP tools+resources+prompts via kernel MCP server (C5) | hephaestus (TS reference); zeus (Rust mirror + MCP tool registration) |
| C4 | `hermes_supervisor` Rust component (detect / bootstrap / start / stop / restart / version-check hermes Python process) | zeus |
| C5 | Kernel MCP server (rmcp 1.6 reverse-mode) exposing 8 capability namespaces as MCP tools, streamable-http on 127.0.0.1:17873, bearer-token auth | zeus |
| C6 | New Tauri commands: `bootstrap_hermes`, `check_keycap_updates`, `apply_keycap_update`, `resolve_update_conflict`, `write_keycap_config`, `patch_keycap_manifest`, `fork_keycap`, `uninstall_keycap` | zeus |
| C7 | PWA workbench shell — 2-zone layout (Keyboard left, Workspace right, Workspace as multi-tab IDE-like); Irisy lives as a permanent Workspace tab; routes/irisy.tsx becomes routes/workbench.tsx; `packages/ctrl-web/src/lib/keycap-tab-registry.ts` maps `workspace.ui=custom` `custom_component_path` → React component | daedalus |
| C8 | PWA hermes client — wraps `/v1/chat/completions` + `/v1/runs` + SSE event consumer; replaces existing `lib/llm-transport.ts` Volc-direct path with hermes-routed | daedalus |
| C9 | PWA 8-stage inference engine — derives stage from hermes SSE event types, switches Workspace pane | daedalus |
| C10 | PWA Configurator / Patch editor / Fork dialog UI for 3-tier adjustment | daedalus |
| C11 | PWA auto-update preferences pane + conflict resolution modal | daedalus |
| C12 | 16 G builtin manifest migration to v0.2 (add `variant: builtin` + `capabilities` + `workspace.ui` per spike 06 §Q1.1 table) | zeus (writes manifest files); hephaestus (reviews capability mappings) |
| C13 | First reference SKILL.md generation for each of the 16 G builtins (smoke test) | zeus (kernel emits); hephaestus (validates) |
| C14 | Onboarding pane for hermes bootstrap (first-launch detect → install prompt → install progress → land on Workspace) | daedalus |
| C15 | `keycap.search` / `keycap.recommend` / `keycap.install_proposed` MCP tools so hermes can drive Discovery / Creation lifecycle stages | zeus |
| C16 | Persona content — Irisy lifecycle skill SKILL.md authoring (the markdown content that teaches hermes how Irisy behaves in each stage) | hephaestus |
| C17 | Inventory document (`doc/keycap-integration-research/00-inventory-and-abstractions.md`) refresh per global English + hermes framing (drop "中文 OPC", drop v1/v1.1 phasing) | hephaestus |
| C18 | `THIRD_PARTY_LICENSES.md` at repo root with verbatim hermes-agent MIT text + Nous Research copyright (§5.5) | zeus (repo housekeeping) |
| C19 | PWA Settings → About → Acknowledgements section listing hermes-agent (MIT) with link to upstream (§5.5) | daedalus |
| C20 | Marketing / docs text audit ensuring "Powered by Hermes Agent" framing, never implying CTRL-authored agent runtime (§5.5) | apollo (marketing copy); hephaestus (in-product strings) |

**Cross-component dependency map**:

```
C1 → C2, C3, C12  (schema must land first)
C4 → C5, C8       (hermes runs before kernel MCP server is useful)
C5 → C8, C15      (hermes can't function-call kernel tools without server)
C7 → C8, C9, C10  (shell must exist before its panes plug in)
C12 → C13         (manifests need v0.2 fields before SKILL.md gen tests pass)
```

---

## 7. Open Questions

| Q# | Question | Owner | Resolution |
|---|---|---|---|
| Q1 | Does CTRL ship the hermes wheel alongside the Tauri installer (~150 MB installer) or stay lazy-bootstrap (~25 MB installer + first-launch pip install)? | bao | **Resolved 2026-05-22**: lazy (b) — installer ≤ 25 MB; first-launch onboarding pip-installs hermes (default) or curl-installs (opt-in `--quick-install`) |
| Q2 | Are external messaging gateways (Telegram / Discord / Slack / Matrix / 飞书 — hermes built-in) exposed in the CTRL UX or kept off-by-default with users configuring on their own via hermes CLI? | bao | _(pending)_ — Hephaestus recommends off-by-default. Critical alignment with "本机部署 = full deployment model" (`decision_ctrl_is_hermes_workbench`): when a user wires their own Telegram bot, the bot's webhook target is the **local hermes** on their laptop (via hermes's built-in webhook mechanism + a user-supplied tunnel like ngrok / Cloudflare Tunnel if they need public reachability). CTRL does NOT proxy through ctrl-cloud, does NOT operate a CTRL-owned bot, does NOT require a VPS. Surface as an advanced "Remote access" Settings pane linking to hermes upstream messaging docs. |
| Q3 | When hermes auto-update bumps a major version (breaking), what's the rollback flow? `hermes` itself supports `hermes update --version <v>`; should the kernel expose a Tauri command for it? | zeus | _(pending)_ |
| Q4 | Should kernel MCP server require per-call origin attestation beyond bearer token (e.g. PID match for the hermes process)? | zeus | _(pending — security review needed)_ |
| Q5 | When user clicks "Fork" on a keycap that's mid-Patch, does the Fork inherit the Patch or start from upstream base? | bao | _(pending — hephaestus recommends Fork inherits Patch; user can clear post-fork)_ |
| Q6 | 3rd-party MCP servers (Pattern D, e.g. bazi-mcp) — does hermes spawn them directly using its own MCP client, or does kernel proxy them so the kernel sandbox profile applies? | zeus | _(pending — hephaestus recommends kernel proxies; security gate centralised)_ |
| Q7 | When Irisy is invoked from a remote messaging entry (user's own Telegram bot connecting to their hermes), and Irisy needs a local capability (clipboard / screen), how does CTRL handle the "feet not on this device" case? | bao | _(pending — needs cross-device story; defer to mesh layer ADR-003 once it ships)_ |

---

## 8. Counter-evidence (此 spec 可能输的方式)

**Failure mode A — hermes runtime install fails on a meaningful % of target machines.**
- Detection: telemetry on `bootstrap_hermes` outcomes (opt-in)
- Recovery: provide pre-built Docker image option; provide "use existing Python" path; degrade gracefully to PWA-only (chat-stream Volc-direct fallback) when hermes absent — but UX explicitly second-class

**Failure mode B — hermes SSE event schema changes break PWA 8-stage inference.**
- Detection: PWA logs unknown event types; CI smoke test replays a recorded SSE trace
- Recovery: `min_hermes_version` field on the inference layer; degrade unknown events to a generic "agent activity" notification

**Failure mode C — kernel MCP server bearer token leaks (any process on localhost can talk to it).**
- Detection: kernel logs origin PID on each MCP connection; warns on PID mismatch
- Recovery: per-call PID attestation (Q4) — defer until threat model demands

**Failure mode D — Patch conflict resolution UI is too complex; users always pick "keep my patch" and drift.**
- Detection: telemetry on conflict resolution choices
- Recovery: Irisy-assist merge gets a smarter prompt; offer "preview after upgrade" so user sees consequences

**Failure mode E — Hermes upstream pivots away from agentskills.io / OpenAI-compatible API (lock-in risk).**
- Detection: track upstream release notes / breaking changes
- Recovery: SKILL.md / MCP tool layer is owned by CTRL; if hermes pivots we can swap runtime (the agent runtime is the easiest layer to swap because the contract is small)

**Failure mode F — Users want CTRL to be a chat app, not a workbench.**
- Detection: usability tests; user feedback "where's the chat?"
- Recovery: Irisy is already accessible as a Workspace tab — surface it more prominently in Keyboard; do NOT collapse into a chat-app shape (that's the differentiation moat)

---

## 9. Acceptance

- [ ] manifest schema v0.2 lands in `packages/ctrl-keycap-sdk/src/manifest-schema.ts` with all §4 fields; `parseManifest` validates 16 G builtins after migration (C12)
- [ ] Rust serde mirror lands; golden-file parity test passes (C2)
- [ ] `hermes_supervisor` detects + bootstraps + starts + stops hermes process; manual kill recovery works (C4)
- [ ] Kernel MCP server registers ≥ 14 v1 methods across 8 namespaces and answers `tools/list` correctly to a stock hermes client (C5)
- [ ] PWA workbench shell renders Keyboard + Workspace tabs; Irisy tab connects to hermes `/v1/runs` and streams SSE events; 8-stage inference switches Workspace pane on at least 3 stage transitions (Discovery → Invoke → Debug) (C7-C9)
- [ ] Install a fresh keycap via Irisy creator flow → SKILL.md appears in `~/.hermes/skills/` → hermes function-calling can invoke that keycap end-to-end (C3, C13, C15)
- [ ] Config tier: user fills a `config_schema` field; secret routes to Keychain; manifest auto-update over the same keycap doesn't touch config.json (C10, C11)
- [ ] Patch tier: user changes a system prompt via Irisy chat; patch.json reflects; SKILL.md regenerates; conflict modal works on a forced upstream conflict (C10, C11)
- [ ] Fork tier: user clicks Fork; private copy lands in `~/.ctrl/keycaps/private/<id>/`; upstream updates don't touch the fork (C10)
- [ ] Onboarding from first launch: install CTRL on a clean machine → first launch detects no hermes → bootstrap → Workspace lands with default keycap inventory (C14)

---

## 10. Implementation notes

- This spec **replaces** the home-grown PWA agent loop attempt (`lib/irisy-lifecycle-*.ts` + `components/irisy/LifecycleShell.tsx` + companion-mode persona) that was scaffolded earlier in the keycap-dev branch and reverted before this spec was written. The reasoning is documented in §1 motivation.
- Inventory document `doc/keycap-integration-research/00-inventory-and-abstractions.md` was authored before this spec and uses some older framings ("v1 / v1.1 promote" phasing; "中文 OPC" framing) that are explicitly superseded by `decision_keycap_3_tier_adjustment` + `decision_ctrl_is_global_english_first`. C17 refreshes it.
- The `decision_*` memory entries authored during the 2026-05-22 discussion (`decision_keycap_3_tier_adjustment`, `decision_auto_update_first_class`, `decision_ctrl_is_hermes_workbench`, `decision_ctrl_is_global_english_first`, `agent_hephaestus_owns_irisy`) are the foundational decisions this spec builds on. Reading those first will save context.

---

## 11. Changelog

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-05-22 | Initial draft — hephaestus authored; submitted to zeus |
| 0.2.0 | 2026-05-22 | zeus REVIEW-2026-05-22 CHANGE_REQUEST addressed: (Critical 1) §3.5 / §4.1 added `target: mcp-tool \| hermes-skill` — 90% keycaps default to MCP server, no SKILL.md; only `target=hermes-skill` triggers SKILL.md gen. (Critical 2) §4.3 added `custom` workspace.ui escape hatch + `custom_component_path` field — Code Space etc. ship own React component via daedalus's keycap-tab-registry. (Critical 3) §3.3 installer default = `pip install hermes-agent` (PyPI verified); upstream `install.sh` (HTTP 200 verified) becomes opt-in `--quick-install`. (Critical 4) §3.4 SSE event names replaced with verified OpenAI Responses API events (`response.created` / `response.output_*.added/delta/done` / `response.failed` / `response.completed` / `hermes.tool.progress`) — grep'd from hermes-agent main; added pre-C9 spike verification step. (Medium 1) §7 Q2 reconciled with 本机 hermes 部署 = full model: user's own Telegram bot points at local hermes, no ctrl-cloud proxy, no VPS. (Medium 2) §3.2 added port-allocation footnote distinguishing 17872 ST-SS vs 17873 MCP. (Medium 3) §4.6 `source_url` regex accepts `git+https://`. (Nit) §5.5 hermes-example-plugins MIT verified. C3 marked conditional. |
