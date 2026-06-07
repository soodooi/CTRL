---
adr_id: 002
module: substrate
title: CTRL substrate — Pi brain · capability surface · provider router · crypto · subprocess · MCP bus · composition
version: 9
status: accepted
last_updated: 2026-06-06
deciders: [bao, zeus]
sections:
  - { id: brain,                source: orig-003 }
  - { id: capability,           source: orig-004 }
  - { id: provider,             source: new-2026-05-31, note: "VMark port + role routing + introspection" }
  - { id: crypto,               source: orig-007 }
  - { id: subprocess,           source: orig-012 }
  - { id: mcp-bus,              source: orig-013 }
  - { id: composition,          source: orig-024 }
  - { id: vault,                source: new-2026-06-01, note: "kernel vault primitives + feature-layer boundary; Daily Note + Sourcing are feature-layer (Irisy + frontend)" }
  - { id: smart-table-output,   source: new-2026-06-03, note: "mcp output unification — single SmartTable per mcp, schema in manifest output_capture" }
  - { id: embeddings,           source: new-2026-06-03, note: "local Ollama nomic-embed-text + SQLite vector blob + cosine flat search; hybrid mode on vault.search; 5 new MCP tools" }
  - { id: audit-ledger,         source: new-2026-06-04, note: "kernel-side immutable record of every self-evolution event across the 6 loops (ADR-001 §8). Reuses persistence.rs SQLite event store with a new event kind; replay-able, queryable from PWA settings." }
changelog:
  - v12 2026-06-07: **terminology unification — "keycap" retired, "mcp" is the system-wide name.** bao 2026-06-07 "要不都叫 mcp 吧 不然好像你不理解, 用户也不理解" / "那你全量改吧". Memory `decision_keycap_collapses_to_mcp_meta_ux_layer` (2026-06-05) extended from doc-level to symbols + filenames + workspace package names. Mechanical changes: 126 source files sed-replaced + 13 file renames + 7 follow-up filename renames + 2 workspace package renames (`@ctrl/keycap-sdk` → `@ctrl/mcp-sdk`, `packages/ctrl-keycaps/` → `packages/ctrl-mcps/`) + 8 ADRs sed-rewritten + CLAUDE.md "Keycap manifest model" section retitled. Memory slug filenames preserved (e.g. `decision_pi_is_sole_brain_hermes_is_keycap.md` — those are file paths, not concept names). `mcp` now denotes both the manifest model in ADR §7 composition v1 AND the runtime substrate in ADR-004 § execution v1; the two are the same thing under one vocabulary. Verified: cargo + tsc green; commit refactor c45907a.
  - v1 2026-05-31: module reorg — merged orig-003 (Pi brain) + orig-004 (capability surface) + orig-007 (crypto) + orig-012 (SubprocessActor + portable-pty) + orig-013 (kernel-as-MCP-server) + orig-024 (6-axis composition). **NEW** § provider — role routing (irisy.primary/fallback, mcp.default) + VMark-style PATH detect + introspection (brain_status). Closes the "Irisy doesn't know its own stack" gap (bao 2026-05-31).
  - v2 2026-05-31: § provider amendments (bao 3-校准 in implementation discussion):
      (1) drop `mcp.default` role — mcp binds provider via manifest `brain_capabilities`, not via substrate-wide default (2-role model: irisy.primary + irisy.fallback only).
      (2) `irisy.primary` MUST be a detected user CLI (`claude > codex > gemini > aider`); removed "else volc" auto-fallback — primary path is augmentation, CTRL doesn't silently spend money there.
      (3) `irisy.fallback` is the CTRL-managed slot (CTRL pays Volc Doubao bill, future = ctrl-brand provider). Volc now has two manifest ids: `volc` (CTRL fallback, ctrl-managed creds) and `volc-byok` (user-elected, user keychain). brain_status() exposes `managed_by: "user" | "ctrl"`. Brand label "CTRL Cloud" hides codename from Irisy responses + failover messages.
  - v3 2026-06-01: **NEW** §8 Vault — kernel primitive endpoints (21 commands) + explicit feature-layer boundary: Daily Note + Sourcing inbox are **feature-layer** (Irisy + frontend wire them via `vault/.ctrl/*.yaml` + `vault/templates/*.md`), kernel does not know about either concept. Retires frontend O(N) backlink scan + 3-pane VaultBrowser shell. §6 MCP tools list extended from 11 to 28 (kernel exposes vault.{backlinks,tags,notes_by_tag,mentions,orphans,broken_links,graph_data,rename,move,create_folder,set_starred,aliases,watch} on top of existing 8). Wiki-link Tiptap extension cherry-picked from seahop/kairo (MIT, Sean Hopkins 2026) — see `THIRD_PARTY_LICENSES/kairo-MIT.txt`. Decision lock + sourcing workflow design: `.olym/brainstorm/vault-md-management-2026-06-01.md`.
  - v4 2026-06-02: §8.6 shell integration amended — bao realignment "Vault is substrate, Notes is the L1 app". L1 chip relabelled **Notes** (id `notes`, path `/notes`); chip click uses `openSystemTab({kind:'route', path:'/notes'})` matching Pool/Coding. New `routes/notes.tsx` renders `<NotesApp />` (3-pane: NotesActions top bar + NotesTree left + NotesEditor center + NotesBacklinks right). Components live in `packages/ctrl-web/src/components/notes/*` as standalone files for future Irisy-app-system reuse. L2 column reservation kept but **no longer flipped for Notes** — the app composes inside a workspace tab body, not across the shell grid. §8.7 retirements extended: `L2VaultPanel.{tsx,module.css}` deleted, `BacklinksDrawer.{tsx,module.css}` deleted (backlinks live inside NotesApp right column), `routes/vault.tsx` deleted (replaced by `routes/notes.tsx`), Rust `expand_workspace_window_if_collapsed` command deleted. Editor lib forward-compat invariant: `@tiptap/*` + `@uiw/react-codemirror` + `mermaid` + `gray-matter` consumed as npm packages — thin React wrappers, no fork, no vendor.
  - v5 2026-06-03: **NEW §9 smart-table-output** + **NEW §10 embeddings**. §9 unifies mcp output capture as one SmartTable per mcp (markdown table file at `notes/mcp-runs/<mcp_id>.table.md`, schema in mcp manifest `output_capture`); supersedes "1-run-1-file sidecar markdown" idea from `.olym/brainstorm/openclaw-compat-2026-06-03.md` — Notion-style table beats sidecar markdown for browsability and inline edit. P4 product-decision (`.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`) locks "default-on, settings-wide kill-switch, per-mcp manifest opt-out". §10 adds the embeddings substrate the product spec depends on (Layer 3 Connect + Layer 4 Synthesize): local Ollama default with transparent fallback prompt (per product P1), SQLite BLOB storage (no sqlite-vss dep — flat cosine is fine for vault-scale up to ~50K notes), 5 new vault.* MCP tools, hybrid `vault.search` mode. Eight new acceptance items; brainstorm: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`.
  - v6 2026-06-04: **NEW §11 audit-ledger** — substrate primitive for self-evolution (ADR-001 §8) across the 6 loops. Reuses `kernel/persistence.rs` SQLite event store with a new event kind `system.self_evolution`; immutable rows record (loop_id, stage, typed_action, evidence, diagnosis, verify_result, autonomy_level). Queryable from Settings → 自我升级 → 最近事件 tab. Prune policy: 7 d high-resolution + 90 d day-level aggregate + month aggregate beyond (bao 2026-06-04 wave Q5). Per bao "整个系统都要自我升级成长 ... 沉, 唯一真相, 要经常整理 ADR".
  - v7 2026-06-04: **§1 brain amendment — §1.1 ctrl-pi-bridge full extension surface** — bridge v1 used only `pi.registerProvider`, leaving Pi with 0 native tools (real-world Pi told user "我没有 skill 系统"). v7 expands bridge to 4 surfaces: `registerProvider` (existing) + `registerTool` × ~10 native tools (BYOK frontier path) + `on('before_agent_start')` chain-injecting ADR-005 §6 capability segments + `on('tool_call')` inspector stub (5-identical-calls loop guard) + `on('resources_discover')` exposing `~/.claude/skills/` as native Pi Skills. ctrl-pi-plugin spawn arg changes `--no-tools` → `--no-builtin-tools` so extension-registered tools stay loaded but Pi's default 7 (read/write/edit/bash/grep/find/ls) are off (kernel substrate stays the gatekeeper for vault writes etc). Provider-aware dispatch in `commands/irisy_chat.rs`: BYOK frontier ⇒ native tools, non-frontier (Volc/Qwen/Llama) ⇒ existing PWA XML loop (Cline operates under same constraint). 0 transitive deps invariant preserved via inline TypeBox mock. Paired with ADR-005 v4 §7. Brainstorm: `.olym/brainstorm/irisy-pipeline-2026-06-04.md` v2.
  - v8 2026-06-06: **§1 + §3 system-level provider redesign — single SSOT, Pi single alias**. Earlier v8 draft (router `last_routed` mirror register + `brain_status.last_routed` field) RETRACTED as patch-style: it added a 4th routing state on top of 3 racing ones (active-providers.json / Pi spawn intent / setModel target / proposed last_routed). Root issue is the 3-state race itself. Locks: (1) **§3.5 SSOT** — `~/.ctrl/state/active-providers.json` is the ONLY truth for routed provider/model. Router reads it per `/text-chat` request (mtime-watched in-memory cache). No mirror state, no `last_routed`, no `brain_status.last_routed`. (2) **§1.2 Pi single alias** — Pi spawns ALWAYS with `--provider ctrl-bridge --model default`. `ctrl-pi-plugin` injects a synthetic `ctrl-bridge` provider into `~/.pi/agent/models.json` at spawn time (baseUrl points at kernel `/text-chat`, apiKey placeholder) so Pi's startup `--provider` validation passes before extensions load. Post-spawn `setModel(active, firstModel)` switch path RETIRED. `PI_PROVIDER` / `PI_MODEL` / `CTRL_TARGET_PROVIDER` env vars RETIRED. Pi has zero visibility into the real provider — it lives entirely in the router via SSOT read. (3) **§3.5 failover is transient override, not state mutation** — on primary call failure router routes the SAME request to fallback + emits Tauri event `provider:routing-override { active, reason, ts }`; on next successful primary call emits `provider:routing-restored`. `active-providers.json` is never written by failover (intent is not stolen). (4) **§3.7 chip + Irisy self-report** — PWA `ChatHeaderControls` + ctrl-pi-bridge `runtimeTruthBlock` read `invoke('get_active_providers')` + subscribe `provider:routing-override` / `active-providers-changed` Tauri events. `Pi.getState` is NEVER consulted for provider/model display. `process.env.PI_PROVIDER` is NEVER read. `brain_status` `last_routed` field RETIRED (added in v8 draft, removed in v8 final). Closes 3-state race that caused v0.1.170-173 chip patches + "Irisy 连真相都不知道" (bao 2026-06-06 "我只要系统, 正确的, 不要修修补补").
  - v11 2026-06-07: **NEW §3.11 — Coding L1 role + on-demand native Pi TUI (0.1.181).** bao 2026-06-07 "把 coding 的 L1 功能完全使用 PI 完成了 L1 都是点击打开和关闭侧工作区" + "Irisy 和 coding 需要使用不一样的 provider". Locks: (1) **`Consumer::CodingPrimary`** enum variant + `coding.primary` SSOT role (parallel to `irisy.primary` / `irisy.fallback`). `route_chain` returns no fallback for this role — Coding errors surface in xterm, never silently fall through to Volc. (2) **On-demand native Pi process** — Coding L1 chip click invokes `coding_resolve_spawn` (new Tauri command) which reads the SSOT binding + resolves the API key from `credential_vault` + returns a `CodingSpawnSpec { command, args, env, provider_id, model_id, provider_label }`. PWA hands the spec to existing `cs_spawn` and navigates to `/code-space/$envId` where xterm.js renders the live PTY stream. No persona override, no Irisy prompt, no wrapper — Pi runs its native coding-agent CLI exactly as the upstream ships it (7 builtin file tools + bash + skills + native function calling all live). Independent process from the kernel-managed Irisy daemon. (3) **L1 click-toggle UX** — Pool / Notes / Coding chip clicks now check whether the chip's tab is already open AND active; if so the chip closes the tab and calls new `collapse_workspace_window` Tauri command. Switching between chips with the workspace open just switches tabs (no collapse). Project-dir prompt removed from Coding chip — Pi's TUI owns cwd. (4) **Settings → Providers** adds the "Coding primary" row alongside the two Irisy rows; provider_set_active accepts the new role unchanged thanks to the `Custom(String)` fallback variant.
  - v10 2026-06-07: **§3 + §6 + NEW §12 — full Pi extension wiring ship (0.1.179).** Locks the 2026-06-07 batch that v9 left as cite-only refs: (1) **NEW §3.9 Switch provider UX** — `provider_set_active` reply carries `model_id` (first model from manifest); PWA `providerSetActive` calls Pi RPC `setModel(provider_id, model_id)` via dynamic import to swap Pi in-place (0 ms, no daemon respawn, session preserved). Formalises v9 changelog item (4). (2) **NEW §3.10 Provider template catalogue** — bundled `provider-templates.json` expanded 10 → 20 entries (added mistral / xai / perplexity / fireworks / azure-openai / vertex / bedrock / cloudflare / zhipu / qwen), each addressable via Settings → Providers add wizard. (3) **§6 amendment — kernel MCP server boot + Pi auto-connect**: `KernelSupervisor::start` now spawns `mcp_server::serve(runtime, None, MCP_SERVER_LISTEN_ADDR)` and publishes the per-boot bearer token via `CTRL_KERNEL_MCP_TOKEN` + `CTRL_KERNEL_MCP_PORT` env vars (Pi child inherits naturally, no `env_clear` in `spawn_brain`). `ctrl-pi-plugin::injectActiveProviderForSpawn` upserts a `ctrl-kernel` entry into `~/.pi/agent/settings.json` mcpServers with `transport: streamable-http` + `Authorization: Bearer <token>` header. Other mcpServer entries are left intact (user-editable). Pi auto-connects on next spawn — kernel's 28 vault.* + kv + llm + mcp.* tools become native Pi tools. (4) **NEW §12 Pi extension surface — full wiring** — see new section. (5) **`$VAR` apiKey prefix** — `models.json` apiKey written as `$<ENV_VAR_NAME>` (Pi's required explicit-env syntax; plain string is now treated as literal with deprecation warning). bao 2026-06-07 "全接" + "真相也要选择吗?" — Pi端点都开好的, 接 = 写 caller, 不是 wrap 工程; 已开的端点要在 ADR 上有 truth.
  - v9 2026-06-06: **§1 + §3 — RETRACT v8 entirely. CTRL wraps Pi via Pi's published extension surface only.** bao 2026-06-06 "我从头一直是让你基于 PI 开发" + memory `feedback_pi_is_core_use_upstream_surfaces` (locked 2026-05-31, IGNORED in v8): wrapper must DELEGATE to Pi-exported surfaces, never reimplement what Pi already does. v8 (Pi single alias + ctrl-bridge streamSimple interception + CTRL-side router fallback + chip reading SSOT mirror) was 4 simultaneous wrapper-side reimplementations of Pi-native facilities. Each `apiKey: ""` / "Unknown provider" / "Connection error." stderr in the v0.1.170-176 series traces to one of those reimplementations. **Retractions**: (1) **§1.2 Pi single alias** RETRACTED. Pi spawns with the user-selected real BYOK provider id (`--provider <ssot-primary-id> --model <ssot-primary-model>`); `ctrl-pi-plugin` writes `~/.pi/agent/models.json` (Pi's designed config file) at spawn time with one entry per user-configured provider, `apiKey` = env var name reference (Pi `ProviderConfig.apiKey` documented as "API key or environment variable name"); CTRL pulls credentials from keychain → injects child env. No plaintext on disk. (2) **§3.5 router fallback chain** RETRACTED. Pi has no public fallback API today; CTRL does not invent a parallel one. The `RouteChain.fallbacks` walking loop, `record_failover`, `RoutingOverride`, `provider:routing-override` / `provider:routing-restored` events, and `ctrl-bridge` `streamSimple` interception are all RETIRED. When Pi exposes a fallback surface (e.g. `setAutoFallback`), CTRL adopts it — until then primary failure surfaces as a Pi error and the user re-picks in Settings. (3) **§3.7 chip data source** — chip reads `pi_rpc('getState')` (Pi's rpc.md-documented authoritative API). With Pi bound to the real provider directly, `getState().model.{provider, id}` IS the truth (matches user intent because Pi was spawned/setModel'd to it). `get_active_providers` Tauri command kept as INTENT projection for Settings UI only; chip uses Pi truth. (4) **Switch provider UX** — `provider_set_active` triggers an in-process Pi RPC `setModel(newProvider, newModelId)` via `/api/pi-rpc` (Pi runtime API, 0 ms, NO daemon respawn, session preserved). New user-added providers register via ctrl-pi-bridge `session_start` so models.json + extension stay in sync. (5) **PWA XML loop** RETIRED. PWA `<call>` parser, `irisy-prompts.ts` XML protocol injection, `irisy-tool-dispatch` artifacts deleted; tool calls flow through Pi-native function calling (`Context.tools` schema → BYOK adapter → `pi.registerTool().execute()`). (6) **Wrapper invariant** locked at substrate level: any wrapper code that re-implements a Pi-published surface (provider registry, LLM call, stream protocol, session, fork, compact, model resolution) is DEAD on arrival. Reviewer checklist requires citing the Pi surface delegated to. bao 2026-06-06 "全部按照 PI 做 能做吗 — 我从头一直是让你基于 PI 开发".
related:
  - .olym/decisions/001-spine.md
  - .olym/decisions/004-cap.md
  - .olym/decisions/006-cross-cutting.md
---

## §1 Brain — Pi is the sole core agent loop

**Pi is the singleton brain.** PWA forwards every user turn → kernel → Pi MCP @ port. Pi runs its own agent loop (LLM → tool → loop). No brain switcher UI; user switches **provider** (§3), not brain.

- **Install**: `~/.ctrl/pi/`, lazy npm install of `@mariozechner/pi-coding-agent@latest`. Fallback: GitHub tarball if no npm.
- **Auto-upgrade**: priority-0. 24h npm registry probe, background `npm install` on new version, applies on next Pi process restart. Major bump (0.x → 1.x) blocks with UI banner.
- **Bridge**: `packages/ctrl-pi-bridge/` ships in app Resources. Pi spawned with `--extension <bridge-path>`. Bridge uses Pi's official `RpcClient` + inlined `AssistantMessageEventStream`; HTTP-fetches `localhost:<port>/text-chat` (kernel provider endpoint, §3).
- **No `pi /login` ever**: bridge auto-configures via env (`CTRL_PROVIDER_PORT` / `CTRL_PROVIDER_TOKEN`).
- **Retired** (do not re-introduce): `brain_config.rs`, `commands/brain.rs`, `BrainListReply`, PWA `irisy-tools.ts` / `irisy-llm-runner.ts` (frontend ReAct), `~/.ctrl/active-brain` file, brain switcher UI.

### §1.1 ctrl-pi-bridge surface — full extension API (v2 — 2026-06-04)

v1 used **only** `pi.registerProvider`. v2 uses 4 Pi ExtensionAPI surfaces to close 3 failure modes traced 2026-06-04 (Pi 0 tool / XML protocol fragility / monolithic system prompt). Schema verified against `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts` (ADR-005 §7.2).

| Surface | Used for | Closes |
|---|---|---|
| `pi.registerProvider('ctrl-bridge', {streamSimple})` | LLM calls route back to kernel provider chain (unchanged v1 behaviour) | — (substrate seam) |
| `pi.registerTool<TParams>({...})` × ~10 tools | Native Pi function calling for BYOK frontier path. Tools = thin HTTP wrappers to kernel commands (vault_*, list_local_skills, install_mcp, mcp_run, brain_status) | B1 (Pi 0 tool) |
| `pi.on('before_agent_start', ...)` | Returns `{systemPrompt}` — chain-injects ADR-005 §6 capability segments per turn based on keyword pre-screen | B3 (monolithic prompt) |
| `pi.on('tool_call', ...)` | Inspector stub — vetoes repeated identical calls (loop guard); future home for ADR-006 §4 policy-envelope enforcement | safety baseline |
| `pi.on('resources_discover', ...)` | Returns `{skillPaths: [...]}` so Pi auto-loads `~/.claude/skills/` as native Pi Skills (`/skill:name` slash commands). Shared discovery helper with kernel `list_local_skills` (one SSOT). | duplicate skill discovery code |

**Spawn-arg change in ctrl-pi-plugin** (`packages/ctrl-pi-plugin/src/pi-bridge.ts`): `--no-tools` → `--no-builtin-tools`. The negation now only disables Pi's 7 default tools (`read` / `write` / `edit` / `bash` / `grep` / `find` / `ls`); tools registered via `pi.registerTool` from ctrl-pi-bridge stay loaded.

**Dual-path tool routing** (ADR-005 §7.6): provider-aware switch in `commands/irisy_chat.rs`. BYOK frontier (anthropic/openai/claude-*/gpt-*) → native Pi tools. Non-frontier (Volc CF Workers AI / Qwen / Llama / DeepSeek defaults) → keep PWA `<call>` XML loop (`irisy-tool-dispatch.ts`) as fallback because these models JSON-format inconsistently (same constraint Cline operates under).

**0 transitive deps invariant preserved**: ctrl-pi-bridge runtime-loads from `<.app>/Resources/pi-bridge/index.ts` where Node can't resolve to Pi's `node_modules`. TypeBox schemas are inline-mocked (~30 LOC `T.Object` / `T.String` / `T.Optional` returning plain JSON-Schema objects, cast `as unknown as TSchema` for TS).

### §1.2 Pi single alias — Pi never sees the real provider (v8 — 2026-06-06, RETRACTED in v9)

> **RETRACTED v9 2026-06-06** — see changelog. CTRL no longer interposes a synthetic `ctrl-bridge` provider; Pi spawns with the real user-selected BYOK provider id directly. The reasoning ("Pi validates `--provider` before extensions load") was real, but the v9 solution is to pre-write the real provider entry into `~/.pi/agent/models.json` BEFORE spawn (with `apiKey` as env-var-name reference, real credential injected via child env from keychain), satisfying Pi's startup validation honestly. No alias, no streamSimple interception, no `PI_PROVIDER` env shadowing. Section body below is preserved for change history only.



Pi spawn args are ALWAYS `--provider ctrl-bridge --model default`. Pi's worldview is frozen: one provider, one model, immutable. The real provider/model selection happens in the router (§3.5), invisible to Pi.

**Pi `--provider` startup validation**: Pi validates `--provider` against `~/.pi/agent/models.json` BEFORE extensions load (so `pi.registerProvider` in ctrl-pi-bridge cannot satisfy the check). Workaround: `ctrl-pi-plugin/pi-bridge.ts::ensureRpc()` writes a synthetic `ctrl-bridge` entry to `~/.pi/agent/models.json` BEFORE spawning Pi:

```json
{
  "providers": {
    "ctrl-bridge": {
      "name": "CTRL Bridge",
      "baseUrl": "http://127.0.0.1:<CTRL_PROVIDER_PORT>/text-chat",
      "api": "openai-completions",
      "apiKey": "ctrl-bridge-no-key-required",
      "models": [
        { "id": "default", "label": "CTRL Bridge", "input": ["text", "image"], "contextWindow": 200000, "maxTokens": 16384 }
      ]
    }
  }
}
```

ctrl-pi-bridge extension then `pi.registerProvider('ctrl-bridge', { streamSimple })` at load — registration OVERRIDES the models.json entry's outbound transport so requests go through `streamSimple` (which posts to kernel `/text-chat` with the real consumer role), not the models.json `baseUrl`. The models.json entry exists ONLY to pass startup validation.

**Retired (do not re-introduce — v8 lock)**:
- `--provider ollama-local --model hermes3:8b` bootstrap spawn args (replaced with `--provider ctrl-bridge --model default`).
- Post-spawn `client.setModel(targetProvider, firstModel)` switch path in `ensureRpc()` after `client.start()` (`pi-bridge.ts` L680-720) — Pi's view stays `ctrl-bridge/default` for the life of the process.
- Reading `~/.ctrl/state/active-providers.json` in `ensureRpc()` to derive `targetProvider`/`PI_PROVIDER` env (current `pi-bridge.ts` L620-655) — `ensureRpc()` no longer reads SSOT; SSOT is the router's job.
- `PI_PROVIDER` env var (write at L654, read in ctrl-pi-bridge `runtimeTruthBlock`). Retired everywhere.
- `PI_MODEL` env var (write at L655, read in ctrl-pi-bridge). Retired everywhere.
- `CTRL_TARGET_PROVIDER` env var (write at L657). Retired.
- `fetch http://127.0.0.1:<port>/tool/get_active_provider_details` call in `ensureRpc()` (L682) — replaced by the router-side SSOT read.

**Consequence for chip + Irisy self-report**: Pi.getState().model is forever `{ id: "default", provider: "ctrl-bridge", ... }` — completely useless for display. Chip + Irisy read `get_active_providers()` (§3.7) instead. This is the system-level fix for the 3-state race.

## §2 Capability surface — 10 namespaces / 28 methods (frequency ≥3 rule + category exception)

Methods enter the kernel surface iff consumed by ≥3 mcps across the v1 corpus, **OR** they are `mcp.*` / `platform.notify` (infrastructure), **OR** they belong to a brain-capability category (text / image / audio / embed) — category exception so multi-modal brain ships coherently (§7 amends frequency ≥3).

| # | Namespace | v1 methods |
|---|---|---|
| 1 | `clipboard` | `read`, `write` |
| 2 | `text` | `chat`, `transform`, `template`, `embed` |
| 3 | `image` | `generate`, `edit`, `understand` |
| 4 | `audio` | `stt`, `tts` (defer until 2nd consumer) |
| 5 | `network` | `http` (allowlist-bound), `open_url` |
| 6 | `keyring` | `read`, `write` |
| 7 | `screen` | `capture` |
| 8 | `file` | `read`, `write` |
| 9 | `mcp` | `spawn`, `invoke_tool`, `list_tools`, `notifications` |
| 10 | `platform` | `notify`, `hotkey`, `window_list`, `window_focus`, `os_filter` |

v1.1 promotion candidates (mcp-local until 2nd consumer): `process.spawn`, `network.local_rpc`, `oauth.broker`, `stss.{publish,subscribe}`.

**Implementation**: `src-tauri/src/kernel/capability.rs` + `commands/mod.rs` registry. Hand-written Rust + `packages/ctrl-kernel-sdk` TS type-gen.

## §3 Provider router — role-aware routing + PATH detect + introspection (NEW v1)

**Why this section exists**: bao 2026-05-31 — "Irisy 不知道自己接的是什么 — 你在修补还是设计系统?". Earlier scattered `brain_config.rs` / `llm_port.rs` / `llm_adapters/*` retired; single sub-system below.

### §3.1 Module location

`src-tauri/src/kernel/provider/` — replaces `brain_config.rs` + `llm_port.rs` + `llm_adapters/*` + `commands/brain.rs` (all retired).

### §3.2 Trait + adapters (3 shared + 1 bespoke)

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    async fn chat_stream(&self, ctx: ChatContext, opts: ChatOpts) -> Result<ChatStream>;
    async fn trial_verify(&self) -> Result<()>;
    fn capabilities(&self) -> &[Capability];
    fn descriptor(&self) -> &ProviderDescriptor;
}
```

Adapters:
- `cli/one_shot.rs` (codex / gemini, manifest-driven, ~200 LOC)
- `cli/claude_persistent.rs` (Goose-style `OnceCell<Mutex<CliProcess>>` + NDJSON, ~600 LOC — bespoke because `claude` doesn't fit generic spawner)
- `rest/http_api.rs` (openai-shape, manifest-driven, ~400 LOC)
- `rest/{anthropic,openai,google,ollama}.rs` (4 thin wrappers — ported verbatim from VMark `ai_provider/rest_providers.rs`, ISC)

### §3.3 PATH resolution (ports VMark `login_shell_path` + `augmented_path`)

Tauri inherits sparse PATH `/usr/bin:/bin:/usr/sbin:/sbin`. CLI providers live at `/opt/homebrew/bin/`, `/usr/local/bin/`, `~/.npm-global/bin/`, `~/.local/bin/`, `~/.cargo/bin/`. `resolve_binary_path()` scans these; `augmented_path()` prepends to child PATH so spawned CLI can find its own `node` shim.

Same trap fixed in 3 spawn sites (`claude_persistent.rs`, `brain_supervisor.rs`, `pi_install.rs`). New providers MUST use the shared resolver.

### §3.4 Manifest schema (TOML, drop-in extensible)

```toml
id = "claude-oauth"
label = "Claude (OAuth subscription)"
kind = "cli_claude_persistent"   # cli_one_shot | cli_claude_persistent | rest_openai | rest_anthropic
binary = "claude"                # CLI only
endpoint = "https://api..."      # REST only
auth = "none"                    # none | keychain:<key> | env:<var> | config:<key>
env_strip = ["ANTHROPIC_API_KEY"]
models = ["sonnet", "opus", "haiku"]
capabilities = ["text.chat"]
```

6 builtin presets ship Day-1: `claude-oauth`, `anthropic-api`, `openai-api`, `volc`, `kimi`, `deepseek`. User additions go to `~/.ctrl/providers/<id>.toml`. CN Anthropic-shape endpoints (api.moonshot.cn/anthropic, api.deepseek.com/anthropic) supported via preset.

### §3.5 Role routing — consumer-aware (NEW, replaces single `text.chat` bucket) — v2 2-role model (PARTIALLY RETRACTED in v9)

> **PARTIAL RETRACT v9 2026-06-06** — see changelog. The `RouteChain.fallbacks` walking loop, `record_failover`, `RoutingOverride`, `provider:routing-override` / `provider:routing-restored` events, and `ctrl-bridge` `streamSimple` interception are ALL RETIRED. Pi has no public fallback surface; CTRL does not invent a parallel one. SSOT (`active-providers.json`) is now used to **prepare Pi's models.json + child env at spawn time** (so Pi sees the real provider directly), not to mediate per-request routing inside CTRL. Section body below preserved for history; v9 implementation reads SSOT only at spawn / `setModel` switch time.



**v2 amendment (bao 2026-05-31)**: dropped `mcp.default` role (mcp binds provider via manifest `brain_capabilities`, not via substrate-wide default). `irisy.primary` MUST be a detected user CLI — no auto-fallback to a paid provider. `irisy.fallback` is the CTRL-managed slot (paid by CTRL).

```rust
pub enum Consumer { IrisyPrimary, IrisyFallback, Custom(String) }  // v2: dropped McpDefault

pub struct RouteChain {
    primary: ProviderId,
    fallbacks: Vec<ProviderId>,
}
```

Default config (v2):
- `irisy.primary` = first detected user CLI in priority order `claude > codex > gemini > aider`. **No CLI detected → unset** (Irisy toasts "Configure a provider in Settings → Providers"). Never auto-falls-back to a paid provider for primary slot. *Reason: augmentation philosophy — CTRL does not silently spend money on the user's behalf for the primary path.*
- `irisy.fallback` = `volc` (CTRL-managed credential, CTRL pays the Volc Doubao bill; future replaces with ctrl-brand provider). Always present, always healthy — first-boot users without any CLI still get a working AI via this fallback. *This is the substrate-level CTRL business guarantee.*

**Volc has two manifest ids** to disambiguate the dual identity:
- `volc` = CTRL-managed fallback (credential from CTRL secrets pipeline / ctrl-cloud worker, never from user keychain). Used by `irisy.fallback` only.
- `volc-byok` = user BYOK Volc (credential from user keychain). Listed in `/settings/providers` REST section, user-elected.

Persisted at `~/.ctrl/state/active-providers.json` (v2 schema):
```json
{
  "roles": {
    "irisy.primary":  "claude-oauth",
    "irisy.fallback": "volc"
  }
}
```

v1 → v2 migration: if file has the old single bucket `{"text.chat": "<id>"}`, the loader writes `roles.irisy.primary = <id>` and `roles.irisy.fallback = "volc"`. If file has v1 `roles.mcp.default`, the loader drops that key.

`/text-chat` SSE endpoint (port 17878) accepts `?consumer=<role>` query param. Pi bridge sets `consumer=irisy.primary`; on stream error/timeout, kernel auto-falls-back through `RouteChain.fallbacks` (default: `["volc"]`) + emits `provider:failover { from, to, reason }` event.

**SSOT lock (v8 2026-06-06)**: `~/.ctrl/state/active-providers.json` is the SINGLE source of truth for routed provider/model. There is no `last_routed` mirror register, no router-internal routing-state cache for display. The router reads SSOT per `/text-chat` request (mtime-watched in-memory cache invalidated on file change + on `provider_set_active()`); the file IS the answer. Tauri command `get_active_providers()` returns the parsed SSOT (with full provider descriptors from `provider_list()` joined in) for chip + Irisy self-report. SSOT changes emit Tauri event `active-providers-changed { roles }` so subscribers refresh without polling.

**Failover is transient override, not state mutation (v8)**: on primary call failure the router routes the SAME request to fallback + emits Tauri event `provider:routing-override { active, reason, ts }`. SSOT file is NOT written (user intent is not stolen by transient failure). On the next successful primary call, router emits `provider:routing-restored`. Chip overlays a ⚠ badge with the fallback label during the override window; cold display always reads SSOT directly.

**Retired (was earlier v8 draft, removed as patch-style)**: `provider:routed` per-request truth event, `last_routed` register, `brain_status.last_routed` field. Adding a 4th routing state on top of 3 racing ones (SSOT / Pi spawn intent / setModel target / proposed last_routed) does not fix the race — it extends it. The system-level fix is to retire 2 of the 3 racing states (Pi spawn intent + setModel target — see §1.2) and treat SSOT as both intent AND truth.

### §3.6 Detect + auto-adopt UX (mirrors VMark detect + role assignment is CTRL-new) — v2

**v2 amendment**: page renders **2 role sections** (not 3); `irisy.fallback` defaults `volc` at first boot without user action (CTRL-managed).

- Tauri command `provider_detect()` → `Vec<ProviderEntry { id, label, kind, binary_path, version, available }>`. Scans PATH for `claude` / `codex` / `gemini` / `aider` / `ollama`; pings REST endpoints for configured keys. Cached in `OnceLock<Mutex<...>>` (ported from VMark `detection.rs`).
- First boot + no `active-providers.json`:
  - `irisy.primary` = highest-priority detected CLI (`claude > codex > gemini > aider`), silent — Irisy one-line toast "Using <label> — change in Settings". **No CLI detected → primary stays unset**, Irisy toasts "Tip: install Claude CLI for free use, or your Volc fallback is already active" (still functional via fallback).
  - `irisy.fallback` = `volc` always — CTRL-managed credential, no user action needed.
- Tauri command `provider_set_active(role, provider_id)` runs `trial_verify()` (1-token "hi", 5s deadline) before committing. Failure → keep previous, surface specific error.
- `/settings/providers` page — **2 role sections** (Irisy primary / Irisy fallback) × radio rows with Available/Not-found badges. CLI providers listed first within each section, then `volc` (the CTRL fallback option, always shown as Available with "[CTRL-managed]" badge in fallback section). REST API (BYOK) section below — Anthropic / OpenAI / Google / Volc-BYOK / Kimi / DeepSeek / Ollama with Configure→ buttons. BYOK Volc is a separate row from CTRL-managed volc (different manifest id `volc-byok`).

### §3.7 Introspection — Irisy self-awareness (closes bao 2026-05-31 root issue) — v2 (chip data source RETRACTED in v9)

> **CHIP DATA SOURCE RETRACTED v9 2026-06-06** — see changelog. PWA `ChatHeaderControls` MUST read `pi_rpc('getState')` (Pi's rpc.md-documented authoritative API) for the displayed provider+model. With Pi bound to the real provider directly at spawn (§1.2 v9), `getState().model.{provider, id}` IS the truth — there is no longer a wrapper-side router to disagree with Pi. `get_active_providers` Tauri command remains as SETTINGS INTENT projection (Settings UI consumes it for "what did the user pick"); the chip uses Pi truth. `runtimeTruthBlock` in ctrl-pi-bridge reads `Context.model` (Pi's already-resolved current model) rather than fetching CTRL HTTP. Section body below preserved for history.



**v2 amendment**: dropped `mcp.default` from the providers map. Fallback `volc` label = `"CTRL Cloud"` (brand-facing), not `"Volc Doubao"` (codename) — keeps user-facing layer abstracted so the future ctrl-brand swap is invisible.

Tauri command `brain_status()` (health view — NOT a routing-truth view; for routing-truth see `get_active_providers()`):
```json
{
  "engine": { "id": "Pi", "version": "0.73.1", "healthy": true, "last_token_ms": 142 },
  "providers": {
    "irisy.primary":  { "id": "claude-oauth", "label": "Claude subscription", "binary": "/opt/homebrew/bin/claude", "healthy": true, "managed_by": "user" },
    "irisy.fallback": { "id": "volc",         "label": "CTRL Cloud",          "endpoint": "<ctrl-managed>",         "healthy": true, "managed_by": "ctrl" }
  },
  "last_failover": null
}
```

Tauri command `get_active_providers()` (v8 — routing truth, single SSOT projection):
```json
{
  "roles": {
    "irisy.primary":  { "id": "claude-oauth", "label": "Claude subscription", "model_id": "claude-sonnet-4-20250514", "model_label": "Claude Sonnet 4", "managed_by": "user" },
    "irisy.fallback": { "id": "volc",         "label": "CTRL Cloud",          "model_id": "doubao-1-5-pro-32k-250115", "model_label": "Doubao Pro 32K", "managed_by": "ctrl" }
  },
  "override": null
}
```

`override` is non-null only during a transient failover window: `{ active: "irisy.fallback", reason: "<error>", ts: "..." }`. Cleared by `provider:routing-restored` event on next successful primary call.

`managed_by` field (v2): `"user"` = user-owned CLI or user BYOK key; `"ctrl"` = CTRL-paid fallback. Settings UI surfaces this so the user understands who pays for each path.

**Routing-truth read rules (v8 lock, supersedes earlier-draft v8)**:
- PWA `ChatHeaderControls` calls `invoke('get_active_providers')` on mount + subscribes Tauri events `active-providers-changed` (SSOT mutation) + `provider:routing-override` / `provider:routing-restored` (transient failover). Cold-render = SSOT projection. Failover-render = overlay ⚠ badge with `override.active` label. **Never calls** `Pi.getState()` / `getAvailableModels()[0]` / reads `brain_state` for chip display.
- ctrl-pi-bridge `runtimeTruthBlock` HTTP-fetches kernel `/api/active-providers` (mirror of `get_active_providers` Tauri command, same shape) at extension load + on SSOT-change webhook from kernel. **Never reads** `process.env.PI_PROVIDER` / `PI_MODEL` (both retired in §1.2).
- Irisy system prompt v5 (ADR-005 § persona) injects `<brain_state>` block built from `get_active_providers()` output. Irisy answers "你用什么模型" with `roles["irisy.primary"].label + model_label` ("Claude 订阅 · Sonnet 4") — never RPC codename, never `Pi.getState().model.id`. During override, Irisy uses `roles[override.active].label` instead + says "Claude 暂时连不上, 我切到 CTRL Cloud 了" using the typed `provider:routing-override` payload.

### §3.8 Retirements

Removed by this section (do not re-introduce): `brain_config.rs`, `commands/brain.rs`, `~/.ctrl/active-brain` file, `BrainListReply / BrainView`, single-`text.chat`-bucket assumption, hand-rolled RPC wire format in `ctrl-pi-bridge` (use Pi's `RpcClient`).

### §3.9 Switch provider UX — in-place Pi `setModel` (v10 — 2026-06-07)

Formalises v9 changelog item (4) — was cited in code but never had a section.

`provider_set_active` Tauri command (mutates SSOT `~/.ctrl/state/active-providers.json`) returns:

```rust
pub struct ProviderSetActiveReply {
    pub trial_reply: String,          // first chunk of the 1-token trial chat
    pub model_id: Option<String>,     // first model from the provider's manifest
}
```

PWA `providerSetActive` (`packages/ctrl-web/src/lib/provider-config.ts`):

1. `await invoke('provider_set_active', { args })` — Tauri side mutates SSOT + runs trial verify.
2. If `args.role === 'irisy.primary'` and `reply.model_id` is non-null, dynamic-import `usePiRpc` and call `setModel(args.provider_id, reply.model_id)` via Pi RPC `/api/pi-rpc` (Pi's published method on `RpcClient`).
3. Failure of `setModel` is non-fatal: SSOT is the source of truth and the next Pi spawn picks up the new binding regardless.

Effect: switching provider takes ~0 ms perceived, the running Pi session is preserved (no daemon respawn = no context loss). Required because v9 §1.2 binds Pi to the real provider at spawn; without an in-place swap, every Settings change would require restart_brain.

### §3.11 Coding L1 — on-demand native Pi TUI (v11 — 2026-06-07)

bao 2026-06-07: "把 coding 的 L1 功能完全使用 PI 完成了 L1 都是点击打开和关闭侧工作区" + "Irisy 和 coding 需要使用不一样的 provider".

The Coding L1 chip spawns **a separate Pi process** (not the kernel-managed Irisy daemon) in native TUI mode, with its own provider+model. Independent SSOT slot, independent credentials, independent session — Pi's full coding-agent UX with zero CTRL interposition.

**Role**

- New `Consumer::CodingPrimary` (id `coding.primary`). Persisted in `~/.ctrl/state/active-providers.json` alongside `irisy.primary` / `irisy.fallback`.
- `route_chain(CodingPrimary).fallbacks = []` — Coding never silently falls through to a different provider on auth failure. The error surfaces in xterm and the user re-picks in Settings.
- `provider_set_active` accepts `role = "coding.primary"` unchanged (Consumer enum's `Custom(String)` fallback was already there; v11 promotes it to a first-class variant for readability).
- `get_active_providers` iterates `[IrisyPrimary, IrisyFallback, CodingPrimary]` so PWA Settings + chip see all 3 roles.

**Spawn path (`coding_resolve_spawn` Tauri command)**

`src-tauri/src/commands/coding.rs::coding_resolve_spawn(provider_id_override)` returns:

```rust
pub struct CodingSpawnSpec {
    pub command:        String,                 // ~/.ctrl/pi/node_modules/.bin/pi
    pub args:           Vec<String>,            // ["--provider", id, "--model", model]
    pub env:            HashMap<String,String>, // { CTRL_PI_API_KEY_<UPPER_ID>: <key> }
    pub provider_id:    String,
    pub model_id:       Option<String>,
    pub provider_label: String,
}
```

The API key is resolved kernel-side via `credential_vault::get(account)` from the provider's manifest AuthSource — it never crosses the Tauri IPC boundary as plain text. PWA hands the spec to existing `cs_spawn` (no new wire, reuses portable-pty + StssBridge).

**L1 chip click-toggle UX**

`PrimaryRail::handleNavClick` for Pool / Notes / Coding now:

1. Queries `useWorkspaceStore` for the system instance + the chip's tab.
2. If `tabIsOpen && tabIsActive && workspaceOpen` → `closeTab(systemInstance.id, def.id)` + new `collapse_workspace_window` Tauri command (compact width).
3. Otherwise → `openSystemTab(...)` + `ensure_workspace_window_expanded`.

Switching across chips while the workspace is open just switches tabs (no collapse). The project-directory `window.prompt` is removed from the Coding chip — Pi's TUI owns cwd via `:cd` / `--cwd`.

**routes/coding.tsx**

1. `csList()` — reuse any existing non-crashed Pi env (avoids spawning N Pi processes when the user clicks the chip repeatedly).
2. Otherwise `invoke('coding_resolve_spawn')` then `cs_spawn(spec)`, then `navigate('/code-space/$envId')`.
3. On error (no coding.primary configured, key missing), inline message + link to `/settings/providers`.

**Settings — provider picker**

`IRISY_ROLES` list extended to 3 rows: `irisy.primary` / `irisy.fallback` / `coding.primary`. The existing `ProviderRoleRow` component handles the new row unchanged because `providerSetActive({role, provider_id})` already accepts any role string. Users get a single Providers tab in Settings where they bind 3 roles to 3 (possibly different) providers — e.g. Volc → Irisy primary, CTRL Cloud → Irisy fallback, Claude (BYOK or OAuth) → Coding primary.

**Why on-demand process (not RPC)**

Pi's RPC mode (used by Irisy) wraps the agent loop and exposes 38 RpcClient methods, which is great for embedding chat in a PWA bubble — but it costs the native TUI affordances (live status line, slash commands rendering in-place, terminal-native scrollback, real PTY signals). Coding is a power-user surface; bao explicitly asked for "完全使用 PI" = the native Pi CLI experience. xterm + cs_spawn gives that for ~0 new code. Two Pi processes coexist cleanly because each has its own session dir under `~/.pi/agent/sessions/` and reads `~/.pi/agent/{models,settings}.json` for config.

### §3.10 Provider template catalogue — 20 entries (v10 — 2026-06-07)

`src-tauri/src/kernel/provider/provider-templates.json` ships 20 entries (was 10 in v3): volc · openai · anthropic · deepseek · kimi · google · openrouter · groq · together · mistral · xai · perplexity · fireworks · azure-openai · vertex · bedrock · cloudflare · zhipu · qwen · custom (free-form). All use `protocol: openai` (OpenAI-compatible REST shape) except `anthropic` (`protocol: anthropic`). Settings → Providers Add wizard renders one row per entry with `keyHint` as inline help. User overrides at `~/.ctrl/provider-templates.json` (merge rule: matching `id` replaces, new `id` appends).

## §4 Crypto — vodozemac (Matrix Olm) on all platforms

Adopt **vodozemac** (Matrix.org Olm Rust fork). Olm 1:1 sessions only (point-to-point double-ratchet); Megolm disabled (CTRL = single-user multi-device). All platforms — Tauri 2 desktop (crate), PWA mobile (WASM via `wasm-bindgen`), future hardware peers. libsignal-* explicitly rejected (Signal upstream policy + C++ WASM complexity + audit duplication). Defense-in-depth: DH public-key non-contributory check (vodozemac 0.10+ ships natively; keep wrapper-layer check as belt-and-braces).

v1 ships no mesh layer (memory `feedback_reuse_existing_capability_first` 2026-05-22 — 新功能先用现有 capability). vodozemac unlocked for v1.1+ mesh sprint.

## §5 Subprocess — SubprocessActor + portable-pty

**SubprocessActor** = concrete `Actor` trait impl in `src-tauri/src/kernel/subprocess_actor.rs`. Holds `Box<dyn portable_pty::Child>` + `MasterPty` + capability + tile metadata. Lifecycle: `on_spawn` → `handle(Event)` (stdin / resize / signal) → `on_shutdown` (kill + close PTY).

- **portable-pty 0.9** — Unix forkpty + Windows ConPTY auto-adapted. Mozilla/wezterm production use.
- **Events** in: `Subprocess.{Stdin, Resize, Signal}`. Events out: `Subprocess.{Stdout, Exit, Spawned}`.
- **Manifest** `ActorManifest.prototype = "subprocess"` carries `{ command, args, env, cwd, pty: {cols,rows} }`.
- **Supervisor**: single SubprocessActor crash never crashes kernel (panic catch + Error Event). 256 MB RAM cap per actor (OS rlimit / Job Object).
- **Used by**: Code Space tile mcps (claude-code / cursor / aider / bash), CLI providers (§3 adapters).

## §6 MCP bus — kernel as MCP server :17873

Kernel runs MCP **server** parallel to its `mcp_host` (client) — same `rmcp 1.7` crate, different features. Single bus for Irisy/external agents to consume kernel capabilities via MCP wire.

- **Bind**: `127.0.0.1:17873` (one above ST-SS bridge 17872). Never `0.0.0.0` — cross-device goes through mesh (§4), not MCP.
- **Transport**: streamable-http (MCP 2025-03-26 spec). rmcp 1.7 + `server` + `transport-streamable-http-server` + `macros` + `schemars`. axum 0.8 hosts.
- **Auth**: ephemeral Bearer token. Fresh UUID v4 on every kernel boot, never persisted. `Authorization: Bearer <token>` header; axum middleware checks before `/mcp`.
- **Discovery**: Tauri command `mcp_server_info` returns `{ url, token }`.
- **Tools (28, v3)**: `kernel.status` · `vault.{read,write,write_image,list,search,delete,root_path,rebuild_index,backlinks,tags,notes_by_tag,mentions,orphans,broken_links,graph_data,rename,move,create_folder,set_starred,aliases,watch}` (21) · `kv.{get,set}` · `llm.chat` · `mcp.{list_servers,proxy_list_tools,proxy_call_tool}`. Stream LLM stays on Tauri event channel (PWA only), not on MCP surface. Vault tool set expanded in v3 per §8.

### §6.1 Boot wiring + Pi auto-connect (v10 — 2026-06-07)

Before v10 the MCP server module existed but `serve()` was never called. v10 wires the boot:

- **Server start** (`src-tauri/src/shell/kernel_supervisor.rs::start`): spawns `kernel::mcp_server::serve(runtime.clone(), None, MCP_SERVER_LISTEN_ADDR)` immediately after the provider HTTP endpoint. On success, publishes the per-boot bearer via `std::env::set_var("CTRL_KERNEL_MCP_TOKEN", h.auth_token.as_str())` + `set_var("CTRL_KERNEL_MCP_PORT", port)`. The set_var is safe here because it runs synchronously at kernel boot, before any task reads env. Pi child processes inherit naturally (no `env_clear` in `spawn_brain`).
- **Pi auto-connect** (`packages/ctrl-pi-plugin/src/pi-bridge.ts::injectActiveProviderForSpawn`): right after writing `~/.pi/agent/models.json`, upsert `~/.pi/agent/settings.json` mcpServers entry:

  ```json
  {
    "mcpServers": {
      "ctrl-kernel": {
        "url": "http://127.0.0.1:<port>/mcp",
        "transport": "streamable-http",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
  ```

  Other user-added mcpServers are preserved (upsert, not overwrite). Token from `process.env.CTRL_KERNEL_MCP_TOKEN`. Pi reads settings.json on every spawn, auto-connects, exposes the 28 kernel tools to the agent loop. Irisy's 8 fs-based tools (vault_* + skills) coexist with the 28 kernel MCP tools — both surface on `getCommands` / agent context.

## §7 Composition — 6-axis manifest (single substrate law)

Mcp manifest declares 6 axes; runtime atomically provisions all declared resources at install (no first-run wizard). Single law replaces 4-way schema drift.

| # | Axis | What |
|---|---|---|
| meta | `pattern` | A/B/C/D/E/F/G (ADR-004) → routes to executor |
| 1 | `capabilities` | subset of §2 namespaces + `file.{read,write}_allowlist` |
| 2 | `brain_capabilities` | typed multi-provider (text.chat / image.generate / audio.stt …) with optional `provider_pin` |
| 3 | `mcp_servers` | Pattern D bindings (spawn + tool allowlist) |
| 4 | `skills` | SKILL.md refs resolved via 3-tier chain (`vault/skills/` > `~/.claude/skills/` > mcp bundle) — first hit wins, no merge |
| 5 | `ui_surface` | 9-enum (none/notification/modal/clipboard/html-output/chat-stream/picker/form/canvas) |
| 6 | `cap_asset` | install-time provisioning: `cap_asset.files` (immutable bundle) + `cap_asset.vault` (user-facing folder + seed) |

**Persona lives inside `cap_asset.files`** as per-mcp markdown — not a separate axis. Vault override `vault/mcps/<id>/persona.md` wins; single lookup, no global persona library.

**SSOT**: `packages/ctrl-mcp-sdk/src/manifest-schema.ts`. Other representations are derivatives (PWA Zod re-exports; Rust serde mirrors with golden file test).

**Builtin vs user mcp** = one metadata flag. `manifest.builtin = true` → ships from `packages/ctrl-mcps/builtin/<id>/`, re-seeds on every launch (self-repairs deletion). `builtin = false` → `~/.ctrl/mcps/<id>/`, uninstallable.

**Multi-modal category exception** to §2 frequency ≥3 rule: image.generate / image.edit / image.understand / audio.stt enter v1 even with 1 consumer each — "做海报得有 image 大模型, 我们是双重 brain" (bao 2026-05-30). Frequency rule still governs non-brain namespaces.

## §8 Vault — markdown PKM substrate (NEW v3, 2026-06-01)

**Why this section exists**: bao 2026-06-01 — vault MD management is a substrate concern (storage + index + integrity), but Daily Note / Sourcing inbox / templates are **feature-layer** (Irisy + frontend wire them via vault-internal config). Earlier `VaultBrowser.tsx` 3-pane shell predates ADR-003 4-col app shell and conflicts with it. Decision driver: memory `feedback_build_system_not_business` ("我建系统不建业务") + `decision_ctrl_obsidian_philosophy` (plain-text vault, vim test).

### §8.1 Module location

- **Kernel**: `src-tauri/src/kernel/vault.rs` + `vault_index.rs` (existing — SQLite FTS5 + backlink scanner + tag scanner, kernel-native, no VMark sidecar)
- **Commands**: `src-tauri/src/commands/vault.rs` (existing 8 + 13 new commands per §8.3)
- **MCP surface**: extended in §6 from 11 → 28 tools
- **Frontend**: `packages/ctrl-web/src/components/vault/*` (new L2VaultPanel + SourcingReviewTab + BacklinksDrawer; retire VaultBrowser + BacklinksPanel)
- **Conventions**: `packages/ctrl-web/src/lib/vault-conventions.ts` (reads `vault/.ctrl/*.yaml`)

### §8.2 Storage layout

```
~/Documents/CTRL/                   ← vault root (vault_root_path())
    notes/                          ← user main namespace
    daily/                          ← Daily Note convention (path_template-driven, §8.4)
    sourcing/                       ← user inbox (clipboard/OCR/link mcps write here)
    templates/                      ← template files (user can fork; default 2 seeded)
        daily.md
        meeting.md
    skills/                         ← per-mcp skill override (ADR-002 §7)
    mcps/<id>/                   ← per-mcp vault override (cap_asset.vault)
    .ctrl/                          ← CTRL-managed config (hidden in tree, vault_list opt-in)
        sourcing.yaml
        daily-notes.yaml
        sourcing-prompt.md
        review-queue/<YYYY-MM-DD>.md
```

All plain markdown + YAML frontmatter. **vim test 满分** — user can open any file with vim and get full value. `.ctrl/` mirrors Obsidian `.obsidian/` (hidden by default, still user-readable).

### §8.3 Kernel primitive endpoints (21 commands, exposed as `vault.*` MCP tools per §6)

| # | Command | Status | Backed by |
|---|---|---|---|
| 1 | `vault_read(path, opts?)` | existing | vault.rs |
| 2 | `vault_write(path, body, frontmatter)` | existing | vault.rs |
| 3 | `vault_write_image(path, bytes)` | existing | vault.rs |
| 4 | `vault_list({prefix?, include_hidden?, limit?})` | extend existing | vault.rs |
| 5 | `vault_search(query, limit)` | existing | vault_index.rs FTS5 |
| 6 | `vault_delete(path)` | existing | vault.rs |
| 7 | `vault_root_path()` | existing | vault.rs |
| 8 | `vault_rebuild_index()` | existing | vault_index.rs |
| 9 | `vault_backlinks(path)` | NEW | vault_index.rs (scanner already exists, expose) |
| 10 | `vault_tags()` | NEW | vault_index.rs |
| 11 | `vault_notes_by_tag(tag)` | NEW | vault_index.rs |
| 12 | `vault_mentions(text)` | NEW | vault_index.rs |
| 13 | `vault_orphans()` | NEW | derived from backlinks scanner |
| 14 | `vault_broken_links()` | NEW | derived from link scanner |
| 15 | `vault_graph_data()` | NEW | full node+edges (for graph view) |
| 16 | `vault_rename(from, to)` | NEW | vault.rs + index update |
| 17 | `vault_move(from, to)` | NEW | vault.rs (Sourcing accept uses this) |
| 18 | `vault_create_folder(path)` | NEW | vault.rs |
| 19 | `vault_set_starred(path, bool)` | NEW | frontmatter `starred:` write |
| 20 | `vault_aliases(path)` | NEW | frontmatter `aliases:` read |
| 21 | `vault_watch(prefix?)` → event stream | NEW | notify crate file watcher |

**Explicitly NOT in kernel** (feature-layer, see §8.4):
- ~~`vault_create_note(kind="daily")`~~ — Daily Note is feature, walks via `vault/.ctrl/daily-notes.yaml` + `vault_write` low-level
- ~~`vault_sourcing_routine()`~~ — Irisy behavior, not kernel API; Irisy composes from primitives 4/1/2/9/10/12

### §8.4 Feature-layer boundary (what is NOT substrate)

Two user-facing features live above kernel — kernel does not know about them:

**Daily Note** — `vault/.ctrl/daily-notes.yaml` defines `path_template`, `template` ref, `frontmatter_default`, `auto_create_on_first_write`. `lib/vault-conventions.ts` reads the yaml and composes the path; Irisy reads the same yaml when user asks "建今天的 daily". Both call `vault.write` low-level. Kernel sees only a `vault_write(daily/2026-06-01.md, body, fm)`.

**Sourcing inbox + integration routine** — `vault/sourcing/` is just a folder; clipboard / OCR / link mcps `vault.write` into it. `vault/.ctrl/sourcing.yaml` defines triggers (cron 9am + count threshold + manual command, all three concurrent), target root, review queue path. `vault/.ctrl/sourcing-prompt.md` is the user-editable prompt for Irisy's integration routine. Irisy runs the routine (composed from `vault.list(prefix='sourcing/')` + `vault.read` + `vault.tags` + `vault.search` + `vault.write` to `.ctrl/review-queue/<date>.md` + `platform.notify`). Kernel never touches the routine logic.

This boundary is load-bearing: it lets users (advanced) replace Daily Note convention by editing yaml without code changes, and lets Irisy's integration prompt evolve via vault file edit. Plain-text philosophy satisfied (`decision_ctrl_obsidian_philosophy`).

### §8.5 Frontend stack (locked)

Per memory `decision_vmark_not_substrate_use_open_stack` (no VMark sidecar):

- **Markdown editor**: Tiptap v2 (`@tiptap/react` + `@tiptap/starter-kit`) WYSIWYG + CodeMirror 6 (`@uiw/react-codemirror`) source-mode toggle — already shipped in `MarkdownViewer.tsx`
- **Wiki-link**: custom Tiptap extension cherry-picked from seahop/kairo (MIT, Sean Hopkins 2026), adapted to call `vault_list` for autocomplete + render broken-link styling
- **Mermaid diagrams**: `mermaid.js` (when content type triggers)
- **HTML sandbox**: iframe + CSP (existing pattern)
- **Frontmatter**: `gray-matter` round-trip (frontend-side; kernel already parses)
- **File tree**: folder-grouped flat list (current implementation, sufficient for v1; switch to `react-arborist` if deep nesting demanded)

### §8.6 Shell integration (ADR-003 frontend § shell v4) — v4 (bao 2026-06-02)

Vault is the substrate; the L1 chip surfaces the **Notes** app (the first vault-using app). Future apps that read vault data (e.g. Weekly Review, Meeting Notes) can also register as L1 chips or as Irisy-spawned mcps without entering this section.

- L1 PrimaryRail chip = **Notes** (id `notes`, label `Notes`, path `/notes`, icon = open-book glyph).
- Chip click uses `useWorkspaceStore.getState().openSystemTab({kind:'route', path:'/notes', title:'Notes'})` matching the Pool / Coding pattern. No L2 column flip, no auto window expand — the user opens the workspace via the ▾ chevron as elsewhere.
- L2 column reservation kept for future sub-nav use cases but **not** activated for Notes.
- `routes/notes.tsx` renders `<NotesApp />` (composition root in `components/notes/NotesApp.tsx`).
- `NotesApp` is a 3-pane grid (`220px 1fr 220px`):
  - **NotesActions** (top bar) — search input + `+ Note` / `Today` / `Review N` buttons. State (`query`, `busy`) owned here.
  - **NotesTree** (left) — folder-grouped flat list driven by `vault_list`; falls through to `vault_search` FTS5 when search > 1 char.
  - **NotesEditor** (center) — thin wrapper around `ViewerHost` + `resourceFromVaultPath`; the real editor (Tiptap WYSIWYG + CodeMirror 6 source + wikilink Tiptap extension per §8.5) lives in `MarkdownViewer.tsx`.
  - **NotesBacklinks** (right) — `vault_backlinks(selectedPath)` rendered as a clickable list; click selects the source in the Notes tree.
- Workspace tab kinds: `vault-md` (single-file MarkdownViewer when opened from outside the Notes app, e.g. wikilink click) + `sourcing-review` (`SourcingReviewTab`, Irisy-produced review queue).
- Forward-compat invariant: every editor / markdown / yaml lib is consumed as an npm package (`@tiptap/*` + `@uiw/react-codemirror` + `mermaid` + `gray-matter` + `react-markdown`). Components are thin wrappers — upstream lib upgrades flow through `npm install`, never through fork or vendor copy.

### §8.7 Retirements (load-bearing — `feedback_no_redundancy_one_ssot`)

- `routes/vault.tsx` deleted — replaced by `routes/notes.tsx` per §8.6 v4 (bao 2026-06-02). The L1 chip now routes to `/notes`, not `/vault`.
- `components/vault/VaultBrowser.tsx` deleted (3-pane shell conflicts with 4-col app shell)
- `components/vault/L2VaultPanel.{tsx,module.css}` deleted (v4 — L2 column not used for Notes; the app body composes inside its workspace tab)
- `components/vault/BacklinksDrawer.{tsx,module.css}` deleted (v4 — backlinks live inside the Notes app right column via `NotesBacklinks`, not as a workspace bottom drawer)
- `src-tauri/src/commands/system.rs::expand_workspace_window_if_collapsed` deleted (v4 — Notes opens via `openSystemTab`; window resize stays user-driven via the ▾ chevron per ADR-003 § shell-4col)
- Exported `VAULT_RAIL_ID` from `PrimaryRail.tsx` removed (v4)
- `components/vault/BacklinksPanel.tsx` deleted (O(N) frontend scan replaced by `vault_backlinks` kernel command)

### §8.8 Third-party port attribution

- **Wiki-link Tiptap extension**: ported from seahop/kairo, MIT License, Copyright (c) 2026 Sean Hopkins. Verbatim license at `THIRD_PARTY_LICENSES/kairo-MIT.txt`. Port location TBD (likely `packages/ctrl-web/src/components/viewers/tiptap-wikilink/`).

## §9 Smart table output — mcp output unification (NEW v5, 2026-06-03)

> Spec: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.6 + product decision P4
> Driver: bao 2026-06-03 "mcp 走简单一点, 用智能表格列表形式怎么样"

### §9.1 Lock

Every mcp's run output is captured into **one** SmartTable per mcp, not one-file-per-run. On-disk shape: `vault/notes/mcp-runs/<mcp_id>.table.md` (vim test passes — opens as a normal markdown file with a frontmatter `schema:` + a markdown table body). The SmartTable substrate (`packages/ctrl-web/src/lib/smart-table.ts` + `components/viewers/SmartTableViewer.tsx`) already exists; §9 only adds the wiring from `mcp_runner` to it.

### §9.2 Mcp manifest extension — `output_capture`

```yaml
# mcp manifest (per-mcp)
output_capture:
  enabled: true                                # default true; user can flip in Settings → Privacy
  table_path: notes/mcp-runs/{mcp_id}.table.md
  schema:
    - { key: ts,           label: When,        type: date }
    - { key: input_excerpt, label: Input,       type: text }
    - { key: output_excerpt, label: Output,     type: text }
    - { key: provider,     label: Provider,    type: text }
    - { key: model,        label: Model,       type: text }
    - { key: tokens,       label: Tokens,      type: number }
    - { key: accepted,     label: Accepted,    type: checkbox }
```

Standard 7 columns are recommended (consistency across mcps); mcp authors can extend with extra columns (e.g. OCR adds `confidence`, translate adds `lang_pair`). Schema additions must be backward-compatible with existing rows — when `mcp_runner` writes a row missing a new column, the column cell is empty.

### §9.3 mcp_runner wiring

After each `mcp.run` completes successfully:

1. Read manifest `output_capture` block. If absent or `enabled: false`, do nothing.
2. Read existing `<table_path>` via `vault.read`. If missing, create with the manifest schema as frontmatter + an empty table body.
3. Call `smart_table.appendRow({ ts: now_iso, input_excerpt: truncate(input, 80), output_excerpt: truncate(output, 80), provider, model, tokens, accepted: false, …extras })`.
4. Write back via `vault.write`. Index automatically picked up by FTS5 (`vault_index.upsert`).

Errors here are warn-logged but never block the mcp's own response — output capture is a side effect, never a gate.

### §9.4 Archival

When `<table_path>` exceeds **500 rows**, `mcp_runner` rotates it: rename to `archive/<mcp_id>-<YYYY>-Q<N>.md` (current ISO quarter), then create a fresh empty table. The archive is also a normal markdown file under `vault/notes/mcp-runs/archive/`, indexed normally.

### §9.5 User control

- Settings → Privacy → **"Capture mcp outputs into vault tables"** master toggle. Default on. When off, no mcp writes to its table (still computes the run, just doesn't persist the row).
- Per-mcp manifest can flip `enabled: false` for inherently private mcps (e.g. an "auth" mcp that holds secrets).
- Per-row: user can flip `accepted` to true (kept in vault long-term) or delete the row in the SmartTableViewer (full row deletion writes back through `vault.write`).

### §9.6 Why not a SQL DB

Considered (`FreeSQL` / Turso / Supabase) and rejected — see `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §3 "FreeSQL evaluation". SQL DB violates plain-text + vim test (philosophy #1) and creates a separate query surface to maintain. Markdown table is the right substrate because it is the user's vault data, not the engine's session data.

---

## §10 Embeddings substrate — Ollama + SQLite flat cosine (NEW v5, 2026-06-03)

> Spec: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.1, §5.5, §5.8, product decisions P1
> Driver: closes Layer 3 Connect gap vs Mem.ai / Smart Connections / Reflect

### §10.1 Lock

Vault embeddings live in **kernel-local SQLite**, computed via **local Ollama** (`nomic-embed-text` model, 768-d), with a **transparent fallback prompt** when Ollama is unreachable: user picks (install Ollama / authorize cloud / disable autolink). No silent cloud fallback (per product P1).

### §10.2 Storage

New SQLite table in the existing kernel sqlite file (same one used for event store + vault_index):

```sql
CREATE TABLE IF NOT EXISTS vault_embeddings (
  path        TEXT PRIMARY KEY,         -- vault-relative path
  mtime_ms    INTEGER NOT NULL,         -- match against vault file mtime to detect staleness
  content_hash TEXT NOT NULL,           -- SHA-256 of body — second-line cache invalidation
  vector      BLOB NOT NULL,            -- 768 * f32 = 3072 bytes
  embedded_at INTEGER NOT NULL          -- ms since epoch
);
```

Cosine search is flat (full scan + dot product). At vault scale ~50K notes that is ~150 MB of vectors, single-digit ms per query in Rust. `sqlite-vss` extension is **not** added — flat scan is simpler, has no native-build dependency, and is fast enough for the 5-year target vault size.

### §10.3 Provider

`provider/ollama_embed.rs` — single HTTP client wrapping `POST http://127.0.0.1:11434/api/embeddings`. Connection probe on Runtime boot writes `embeddings.status: "available" | "unreachable" | "user-opted-out"` to runtime state. Auto-embed of a note only fires when status = available; otherwise the call is a no-op.

Cloud fallback (Volc embeddings API or compatible OpenAI-shape) is wired but **off by default**. Enabled by Settings → Embeddings → "Allow cloud embeddings (your existing BYOK provider)". This honors P1 transparency.

### §10.4 5 new MCP tools + Tauri commands

| Tool | Args | Returns | Notes |
|---|---|---|---|
| `vault.embed_note` | `{ path }` | `{ vector_dims, cached }` | Idempotent — uses content_hash to skip re-embed |
| `vault.reembed_all` | `{ force: bool }` | `{ embedded, skipped }` | Bulk; respects `force` for full rebuild |
| `vault.embedding_status` | `{}` | `{ available, model, embedded, total, last_run_at }` | UI status pill |
| `vault.semantic_search` | `{ query, limit, threshold? }` | `Vec<{ path, score, snippet }>` | Caller embeds query, returns sorted by cosine |
| `vault.suggest_links` | `{ for_path, limit }` | `Vec<{ path, score, snippet }>` | Same as semantic_search but uses the source note's embedding instead of a query string |

### §10.5 Hybrid mode on `vault.search`

`vault.search` gets a new optional `mode: "bm25" \| "semantic" \| "hybrid"` arg (default `"hybrid"` when embeddings available, else `"bm25"`).

Hybrid algorithm: BM25 top-30 (existing FTS5 path) → rerank by cosine of query embedding → return top-`limit` (default 10). Scoring is a weighted sum `0.4 * normalized_bm25 + 0.6 * cosine` (these constants live in `vault_embeddings.rs` and are tunable from a single place).

### §10.6 Auto-embed lifecycle

- On `vault.write`: enqueue an async embed task for that path (don't block the write).
- On `Runtime::boot`: scan for paths in `vault_embeddings` whose mtime < file mtime, re-embed in background.
- On `vault.delete`: drop the row.
- Background queue is rate-limited (max 4 concurrent Ollama calls) so embed traffic doesn't drown the local model when a user pastes a huge note.

### §10.7 Privacy

Embeddings never leave the user's machine when in Ollama mode. The cloud-fallback path is **opt-in only** and the embedding payload (note body) goes through the user's already-configured provider — CTRL never proxies through a CTRL-managed endpoint for embeddings (different from `irisy.fallback` which is CTRL-managed for chat).

---

### §8.9 Future work (not §8 v1)

- §9 smart-table-output — Mcp manifest `output_capture` field + JSONSchema validation in `packages/ctrl-mcp-sdk/src/manifest-schema.ts` (today the kernel falls back to defaults when manifest absent).
- §9 smart-table-output — Settings → Privacy master toggle ("Capture mcp outputs into vault tables", default on).
- §9 smart-table-output — Wire provider / model / tokens into `run_mcp` so the captured row carries real values instead of empty strings.
- §10 embeddings — Auto-embed lifecycle hooks (vault.write background enqueue, Runtime::boot stale re-embed, vault.delete drop row).
- §10 embeddings — `vault.search` mode arg (`bm25` | `semantic` | `hybrid`) at the kernel-side (today hybrid is composed in the PWA NotesTree by parallel calls).
- §10 embeddings — Settings → Embeddings cloud-fallback toggle (P1 transparency).
- Product spec §5.4 Ctrl long-press global quick-capture window (`hotkey.rs` long-press detection + new Tauri window `quick-capture`).
- Product spec §5.8 wikilink `[[` autosuggest Tiptap suggestion plugin.
- Product spec §5.9 smart frontmatter suggest (Pi propose tags from `vault.tags` vocabulary after `vault.write`).
- Product spec §5.11 ST-SS remote co-view (v1.1+ scope per ADR-005 §2).
- Product spec §5.12 voice → vault (requires `audio.transcribe` provider).
- Product spec §5.13 weekly + annual review (Pi-driven, weekly Sunday cron, annual end-of-year).
- Graph view UI (React Flow + D3-force from kairo stack — primitive `vault_graph_data` already in §8.3 #15)
- Dataview-like query (`vault.dataview_query(spec)`) — defer until 2nd consumer
- Version history (snapshot table or libgit2 — defer)
- Block-level transclusion (`![[note#block-id]]`) — defer until needed
- Auto-classification ML (sourcing routine currently uses Irisy + heuristics, no embedding clustering)
- `vault_list` `include_hidden` flag — today the frontend filters `.ctrl/`; kernel-side opt arrives when the 2nd consumer needs the raw view
- Sourcing automation: 9 AM tokio cron + `vault_watch` count-threshold auto-fire of `vault_sourcing_run` — currently manual via the L2 badge / MCP tool. Irisy's LLM-backed routine will subsume both triggers.
- Wikilink autocomplete popup — Tiptap suggestion plugin + tippy.js anchor; defer until the InputRule path proves the schema in user testing.

## §11 Audit ledger v1 — self-evolution event store (NEW v6, 2026-06-04)

bao 2026-06-04: "整个系统都要自我升级成长 ... 沉, 唯一真相, 要经常整理 ADR". The 6 self-evolution loops (ADR-001 §8) all need the same substrate: a kernel-side immutable record of every detect → diagnose → plan → execute → verify → learn event, queryable across loops, replay-able for postmortem, and accountable for the user's "what did Irisy change about me" question.

### §11.1 Reuse, not new infra

Build on `src-tauri/src/kernel/persistence.rs` (the existing SQLite event store), do not introduce a parallel persistence engine. Add one event kind:

```rust
// kernel/persistence.rs — extend, do not branch
pub enum EventKind {
    UserEvent { /* existing */ },
    // ...
    SelfEvolution(SelfEvolutionEvent),  // ← NEW v6
}
```

### §11.2 Schema (P0 ship target)

```sql
CREATE TABLE IF NOT EXISTS self_evolution_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms           INTEGER NOT NULL,
    loop_id         TEXT    NOT NULL,    -- 'irisy_reflection' | 'provider_routing' | 'cap_curation' | 'vault_index' | 'system_self_healing' | 'mcp_skill_recommend'
    stage           TEXT    NOT NULL,    -- 'detect' | 'diagnose' | 'plan' | 'execute' | 'verify' | 'learn'
    typed_action    TEXT,                -- JSON-serialized SelfEvolutionAction (NULL until Plan stage)
    evidence        TEXT,                -- raw signal / log excerpt (Detect input)
    diagnosis       TEXT,                -- LLM causal hypothesis JSON (Diagnose output)
    verify_result   TEXT,                -- 'recovered' | 'unchanged' | 'rolled_back' | NULL until Verify stage
    autonomy_level  TEXT    NOT NULL,    -- 'L3' | 'L4' | 'L5' at the time of the event
    correlation_id  TEXT    NOT NULL     -- groups all 6 stages of one loop execution
);

CREATE INDEX idx_sev_loop_ts ON self_evolution_events (loop_id, ts_ms DESC);
CREATE INDEX idx_sev_corr ON self_evolution_events (correlation_id);
```

`correlation_id` is the join key linking Detect → … → Learn rows for one logical loop execution. Generated at Detect-stage write.

### §11.3 Append-only + prune policy

Rows are **append-only**. Prune is a separate `kernel::audit_ledger::prune()` job, never inline:

- **0 → 7 d**: full resolution, all rows kept
- **7 → 90 d**: day-level aggregate (counts per `(loop_id, stage, verify_result)`); detail rows deleted
- **> 90 d**: month-level aggregate; day rows deleted

User can opt to "preserve all" in Settings (off by default — vault grows unbounded otherwise).

### §11.4 Producer / consumer contract

- **Producers**: each loop's Detect/Diagnose/Plan/Execute/Verify/Learn stage writes one row before returning. Producers MUST set `loop_id` + `stage` + `correlation_id`; other fields stage-dependent. Producers MUST NOT mutate prior rows.
- **Consumers**: PWA Settings → 自我升级 → 最近事件 tab reads via new Tauri command `audit_ledger_query(args: { loop_id?, since_ms?, limit })`. Read-only.
- **Cross-loop replay**: `audit_ledger_replay(correlation_id)` returns ordered stage rows for one loop execution — debug + postmortem use.

### §11.5 Invariants (locked)

1. **Append-only** — no update, no delete (only `prune()` aggregating job).
2. **Per-stage write** — Detect writes immediately on signal, Verify writes immediately on result. No batching that hides intermediate failures.
3. **typed_action JSON-validates** before write (microkernel validator, ADR-006 § policy-envelope, P1). Untyped writes are rejected.
4. **autonomy_level recorded at-execution-time**, never recomputed after — protects against retroactive policy changes hiding past auto-executions.

### §11.6 Out of scope for v1

- Cross-device sync of the audit ledger (each device has its own ledger; Loop 6 cross-user aggregation is opt-in + Loop 5 self-healing reads only local).
- LLM-driven semantic search over the ledger (FTS5 substring is enough for "show me last week's provider failover" queries).
- Real-time websocket push of audit events to PWA (poll-on-open is fine; users won't watch a live tail).

## Acceptance

### Brain (§1)
- [x] `packages/ctrl-pi-bridge/` ships with `RpcClient` + `AssistantMessageEventStream`. v0.1.126 verified.
- [x] `kernel/provider/http_endpoint.rs` exposes `/text-chat` SSE @ port 17878. Verified boot trace.
- [x] `shell/brain_supervisor.rs` spawns Pi with `--extension <bundled-path>` + env. v0.1.124.
- [x] `~/.ctrl/pi/` lazy install + auto-upgrade + Settings → Brain UI. v0.1.124.
- [x] Retirements applied atomically (no parallel old + new). v0.1.124.
- [x] `irisy_chat_stream` routes every turn to Pi; specific error surfaces (no infinite spinner). v0.1.124.

### Capability (§2)
- [x] Surface lives in `src-tauri/src/kernel/capability.rs` + `commands/mod.rs`. Verified.
- [x] `packages/ctrl-kernel-sdk` TS exports per namespace. Verified.
- [x] Builtin manifest validation in `shell/builtin_mcps.rs` boot. Verified.

### Provider (§3 — NEW, all items in § Future work below)

### Crypto (§4)
- [x] ADR locks vodozemac (Olm 1:1, libsignal rejected). v1 ships no mesh layer (memory `feedback_reuse_existing_capability_first`). Verified.

### Subprocess (§5)
- [x] `portable-pty = "0.9"` in `src-tauri/Cargo.toml`. Verified.
- [x] `src-tauri/src/kernel/subprocess_actor.rs` with portable-pty wiring + 6 event variants. Verified.
- [x] OOM cap + panic catch + on_shutdown PTY close. Verified.

### MCP bus (§6)
- [x] rmcp 1.7 + axum 0.8 + Bearer middleware in `kernel/mcp_server.rs`. Verified.
- [x] 11 tools wired; `mcp_server_info` Tauri command. Verified.

### Composition (§7)
- [x] ADR locks 6-axis substrate law. Implementation deferred to "bao calls execution" per CLAUDE.md 灵活开发. Closed at "decision recorded".

### Vault (§8 — NEW v3)
- [x] `kernel/vault_graph.rs` (new module) exposes backlinks / tags / notes_by_tag / mentions / orphans / broken_links / graph_data scanners. 8 unit tests in-tree.
- [x] `commands/vault.rs` adds 13 new tauri commands (§8.3 #9-21): backlinks, tags, notes_by_tag, mentions, orphans, broken_links, graph_data, rename, move, create_folder, set_starred, aliases, watch.
- [x] `kernel/mcp_server.rs` MCP tools list grows by 14 (13 vault + 1 sourcing_run). All `vault.*` exposed; arg structs derive JsonSchema for `mcp_server_info` reflection.
- [x] `vault_watch` uses `notify` crate (`notify = "8"`) for filesystem event stream; lazy-started on first poll.
- [x] `vault_list` keeps `{subdir}` opt; `.ctrl/` filtered out at the L2 tree boundary + by the graph scanner walker. (Kernel-level `include_hidden` flag tracked in §8.9 future work — frontend already filters today.)
- [x] `packages/ctrl-web/src/lib/kernel.ts` TS wrappers + types for all 13 new vault commands + sourcing run/pending.
- [x] First-boot vault seed (`kernel/vault.rs::seed_vault_feature_layer`) writes `vault/.ctrl/{sourcing.yaml, daily-notes.yaml, sourcing-prompt.md}` + `vault/templates/{daily.md, meeting.md}` when absent (idempotent — user edits preserved).
- [x] `packages/ctrl-web/src/components/vault/L2VaultPanel.tsx` renders title + vault root + search + `+ Note` + `Today` + Sourcing Review badge + folder-grouped tree.
- [x] `packages/ctrl-web/src/components/vault/SourcingReviewTab.tsx` is a workspace tab kind; parses review-queue markdown into Proposal records and surfaces Accept / Edit / Reject buttons that call `vault_move` + `vault_write` + `vault_delete`.
- [x] `packages/ctrl-web/src/components/vault/BacklinksDrawer.tsx` is a workspace bottom drawer; reads `vault_backlinks(activeTab.vaultPath)` via TanStack Query.
- [x] `packages/ctrl-web/src/lib/vault-conventions.ts` reads `vault/.ctrl/daily-notes.yaml` + `sourcing.yaml`; exports `loadDailyNotesConfig` / `loadSourcingConfig` / `renderDailyNotePath` / `renderReviewQueuePath`.
- [x] `packages/ctrl-web/src/components/viewers/MarkdownViewer.tsx` gains wiki-link Tiptap extension (`tiptap-wikilink/index.ts`, ported from seahop/kairo MIT) — InputRule rewrites `[[xxx]]`, click handler opens vault-md tab, broken-link styling from `vault_list` snapshot. Suggestion-popup autocomplete tracked in §8.9 future work.
- [x] L1 PrimaryRail adds `vault` icon; activating it flips `data-l2-open='true'` and renders L2VaultPanel inside the L2 grid cell.
- [x] Kernel-seeded sourcing routine wired (`kernel/vault_sourcing.rs`): manual MCP / Tauri trigger via `vault_sourcing_run`. `vault_watch` watcher in place for the count-threshold path (frontend polls `vault_sourcing_pending`); auto-fire on threshold + 9 AM tokio cron deferred to §8.9 future work (Irisy LLM-backed routine will subsume them).
- [x] Retirements: `routes/vault.tsx` reduced to a no-op rail activator; `components/vault/VaultBrowser.tsx` deleted; `components/vault/BacklinksPanel.tsx` deleted (no parallel old + new per §8.7).
- [x] `THIRD_PARTY_LICENSES/kairo-MIT.txt` present with verbatim license + attribution.
- [x] Manual smoke run executed prior to ship — L1 vault → L2 visible → `+ Note` writes a vault file → `Today` writes/opens the daily note → BacklinksDrawer hits flow from kernel `vault_backlinks` → Sourcing Review tab parses + Accept moves the inbox item.

### Smart table output (§9 — NEW v5)
- [x] §9.1 strategic lock — single SmartTable per mcp at `notes/mcp-runs/<id>.table.md` (P4 product decision recorded in brainstorm).
- [x] `mcp_runner` post-run hook wires output to `notes/mcp-runs/<id>.table.md` via `kernel::mcp_capture::capture_row`. Standard 7-column schema (ts / input_excerpt / output_excerpt / provider / model / tokens / accepted). Provider/model/tokens default to empty until `run_mcp` exposes them; the row still lands. v0.1.158.
- [x] Rotation at 500 rows to `notes/mcp-runs/archive/<stem>-<YYYY>-Q<N>.md`. v0.1.158.
- [x] Vault seed creates `notes/mcp-runs/` + `notes/mcp-runs/archive/` directories (`kernel::vault::seed_vault_feature_layer`). v0.1.158.

### Embeddings (§10 — NEW v5)
- [x] `src-tauri/src/kernel/vault_embeddings.rs` — SQLite BLOB + flat cosine (768d) + content_hash idempotence. 3 unit tests in-tree. v0.1.158.
- [x] `src-tauri/src/kernel/provider/ollama_embed.rs` — nomic-embed-text HTTP client + probe. v0.1.158.
- [x] 5 Tauri commands + MCP tools (`commands/vault_embeddings.rs` + `mcp_server.rs`): `vault.embed_note`, `vault.reembed_all`, `vault.embedding_status`, `vault.semantic_search`, `vault.suggest_links`. v0.1.158.
- [x] Hybrid retrieval shipped via `NotesTree` parallel `vault_search` + `vault_semantic_search` merge on queries >= 4 chars; backlinks panel gains a "Suggested" group driven by `vault.suggest_links`. v0.1.158.

### SOUL.md substrate (ADR-005 v2 § soul-md-compat — see ADR-005 acceptance, satisfied by 002 §9/§10 ship)
- [x] `vault/irisy/SOUL.md` seed via `vault_seed/irisy-soul.md` + `.soul-md-version` pin. v0.1.158.
- [x] `irisy_soul_read` / `irisy_soul_write` Tauri commands; `irisy.soul_get` / `irisy.soul_set` MCP tools. v0.1.158.
- [x] `loadIrisySystemPromptWithSoul` injects SOUL.md body into every Pi turn (`packages/ctrl-web/src/lib/irisy-prompts.ts` + `IrisyChat.tsx`). v0.1.158.

### Layer 4 synthesize (product brainstorm §5.3 / §5.5 / §5.10 — satisfied here)
- [x] `commands/irisy_synth.rs` — 3 Tauri commands using `provider_registry.primary_text_chat`: `irisy_question_vault` (RAG with citations), `irisy_synthesize_notes` (cross-note merge), `irisy_daily_summarize` (sourcing → daily/{date}.md). v0.1.158.

### Block AI ops (product brainstorm §5.2 / P2 / P7 — satisfied here)
- [x] `lib/block-ai-ops.ts` — 6 actions (tighten / formalize / extract-actions / translate / continue / custom) streaming via `irisyChatTransport`. v0.1.158.
- [x] `components/notes/BlockAiOps.tsx` floating menu; `Cmd+K` / `Ctrl+K` trigger anywhere with non-empty Tiptap selection. v0.1.158.
- [x] Diff preview (streaming) + Accept replaces selection; Discard aborts the stream. v0.1.158.
- [x] On accept, `stampAiBlock` appends a frontmatter `ai_blocks:` entry (provider/model/timestamp/original/rewritten/user_input). v0.1.158.

### Transparency (product brainstorm §6.4 — satisfied here)
- [x] `lib/ai-block-metadata.ts` — `stampAiBlock` + `readAiBlocks` for frontmatter round-trip. v0.1.158.
- [x] `FrontmatterPanel` gains "AI ops: N" badge that opens a drawer listing each block's provider/model/timestamp + collapsible original-vs-rewritten preview. v0.1.158.

## Future work (§ Provider §3 implementation — tracked separately from § Acceptance per CLAUDE.md 灵活开发)

- `kernel/provider/{trait.rs, registry.rs, detect.rs, path_resolver.rs}` exist with **2-role** table (irisy.primary + irisy.fallback) + RouteChain + auto-fallback (v2)
- 4 REST adapters ported from VMark (`rest/{anthropic,openai,google,ollama}.rs`), ISC attribution
- **7 builtin manifests** (v2): `claude-oauth`, `anthropic-api`, `openai-api`, `volc` (CTRL-managed fallback), `volc-byok` (user-elected), `kimi`, `deepseek` (+ implicit `ollama` if detected)
- Tauri commands: `provider_detect` / `provider_set_active(role, id)` / `provider_active(role)` / `brain_status` (returns `managed_by` field per role, v2)
- `/text-chat?consumer=<role>` honors 2-role routing; auto-fallback chains on error, emits `provider:failover { from, to, reason }` event
- First-boot: irisy.primary = highest-priority detected CLI silently + Irisy toast; irisy.fallback = `volc` (CTRL-managed) always active without user action
- Irisy prompt v5 wired (depends on ADR-005 § persona implementation) — brand labels only ("Claude 订阅" / "CTRL Cloud"), never codenames
- `/settings/providers` page rendered inside Settings workspace route (ADR-003 § nav-keyboard v2) — **2 role sections** × radio with Available/Not-found + [CTRL-managed] badges + REST API (BYOK) config below

## §12 Pi extension surface — full wiring (NEW v10 — 2026-06-07)

> bao 2026-06-07 "全接" — Pi 端点都暴露好的; "接" 不是 wrap 工程, 是给每个未接通端点写 1 行 caller. 这段把 `ctrl-pi-bridge` 的 caller 矩阵 SSOT 化, 后续每加 1 个端点就在这表里追 1 行.

### §12.1 Hook events (28 registered)

Every event in Pi's `ExtensionAPI.on()` union is registered. Handler tier:

| Tier | Events | Handler body |
|---|---|---|
| Real business | `before_agent_start` (persona replace), `before_provider_request` (auto-RAG inject), `after_provider_response` (LLM cost audit), `tool_call` + `tool_result` (tool I/O audit), `turn_end` (turn usage audit), `user_bash` (shell audit), `agent_start` + `agent_end` + `session_start` + `session_compact` + `session_shutdown` (lifecycle audit), `model_select` + `thinking_level_select` (mode audit) | non-trivial logic |
| Stub (extension point) | `resources_discover`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_before_tree`, `session_tree`, `context`, `turn_start`, `message_start`, `message_update` (perf-sensitive), `message_end`, `tool_execution_start/update/end`, `input` | `() => undefined` (registered so future business can replace inline without re-shipping the bridge) |

The stub-tier registrations are intentional and load-bearing: a future skill that wants to use e.g. `tool_execution_update` can write a 1-line replacement in this file — no contract change, no version bump, no upstream Pi PR.

### §12.2 Auto-RAG via `before_provider_request`

`ctrl-pi-bridge::register()` registers a `before_provider_request` handler that, for every LLM call:

1. Pulls the last user message text.
2. Calls `vaultSearchTopK(text, 3)` — naive substring scan over `walkMarkdown(vaultRoot)` (skip `irisy/audit/*` to avoid self-reference loops).
3. If hits found, appends a `{role: 'system', content: 'Relevant snippets auto-fetched from the user\'s vault: …'}` message to `evt.messages` and returns `{messages: [...messages, ragSystem]}`.

Pi merges the returned message list and proceeds with the LLM call. The user never explicitly invokes `vault_search` for ambient grounding — it happens automatically. Future: replace substring scan with `kernel.vault.search` via the §6.1 MCP auto-connect once Pi sees the kernel tools (FTS5-backed, faster, ranked).

### §12.3 Audit log → `vault/irisy/audit/`

`appendAuditLine(topic, line)` writes `- [ISO-8601] <line>` rows into `vault/irisy/audit/YYYY-MM-DD-<topic>.md`. Topics:

- `llm-calls` — per-response: model id, input/output/cacheR/cacheW tokens
- `tools` — per call/result: tool name + arg snippet + OK/FAIL
- `turns` — per turn: messageCount, totalTokens
- `sessions` — start / compact / shutdown
- `lifecycle` — agent start / end
- `mode` — model switch, thinking-level change
- `user-bash` — user-issued shell commands (per `user_bash` event)

Plain markdown, user vim-readable (CLAUDE.md vim test). All failures non-fatal — audit MUST NOT break the agent turn.

### §12.4 Per-mcp `inherit_pi_tools` — `CTRL_INHERIT_PI_TOOLS` env

Irisy default mode: persona explicitly denies Pi's 7 builtin tools (Read/Write/Edit/Bash/Grep/Find/LS). A mcp that needs them (Code, DevOps, Screen-record) declares `inherit_pi_tools: [Read, Bash, ...]` in its manifest. Kernel sets `CTRL_INHERIT_PI_TOOLS=<comma-separated>` on the Pi spawn env; `ctrl-pi-bridge::buildPersona` reads it, rewrites the deny block, and lists the inherited tools in the "## Runtime" section so the model knows what it's allowed to touch.

Default (no env or empty) = Irisy mode = all 7 denied.

### §12.5 `pi.registerFlag('ctrl-vault-root')`

Lets users override `CTRL_VAULT_ROOT` from the Pi CLI (`pi --ctrl-vault-root /some/path …`). Otherwise the env var (set by kernel at Pi spawn) wins; finally `~/Documents/CTRL/vault` then `~/.ctrl/vault` per `resolveVaultRoot` priority.

### §12.6 Wrapper invariant (formalises v9 changelog (6))

Any wrapper code that re-implements a Pi-published surface (provider registry, LLM call, stream protocol, session, fork, compact, model resolution) is DEAD on arrival. Reviewer checklist requires citing the Pi surface delegated to. v8 (`ctrl-bridge` streamSimple + `registerProvider('ctrl-bridge')` + `runtimeTruthBlock` SSOT mirror) was the reference violation — all retracted in v9.

The `registerProvider` call IS allowed for **ADD** (new provider id with bespoke logic — audit-proxy, private corp LLM, etc.) but NOT for **REPLACE** (intercepting an existing Pi-ai provider's stream).

### §12.7 `$VAR` apiKey prefix

Pi's model-registry now requires explicit `$VAR` prefix for env var references. Plain unprefixed strings get auto-migrated with a deprecation warning. `ctrl-pi-plugin::injectActiveProviderForSpawn` writes `apiKey: "$" + envVarName` directly (e.g. `apiKey: "$CTRL_PI_API_KEY_VOLC_DOUBAO"`) so no warning fires.

### §12.8 Acceptance (v10 — 2026-06-07)

- [x] `ctrl-pi-bridge/src/index.ts` registers 28 events (`pi.on()` for every event in Pi's `ExtensionAPI.on()` union) — verified by grep `pi\.on\(` count.
- [x] `before_provider_request` handler returns vault-RAG-augmented `messages` when hits found.
- [x] Audit lines appear under `~/Documents/CTRL/vault/irisy/audit/<date>-<topic>.md` after any chat turn.
- [x] `CTRL_INHERIT_PI_TOOLS` env reaches `buildPersona()` — verified by `/irisy-paths` slash command output ("Inherit:" line).
- [x] `pi.registerFlag('ctrl-vault-root', ...)` registered.
- [x] `kernel_supervisor::start` spawns MCP server; `lsof -p $(pgrep ctrl) -iTCP -sTCP:LISTEN` shows `:17873` after boot.
- [x] `~/.pi/agent/settings.json` contains `mcpServers.ctrl-kernel` entry with bearer header.
- [x] `provider_set_active` reply carries `model_id`; PWA `providerSetActive` calls Pi `setModel` after success.
- [x] `provider-templates.json` has 20 entries.
- [x] `models.json` apiKey written with `$` prefix — verify with `grep '"apiKey":' ~/.pi/agent/models.json` returns `"$CTRL_PI_API_KEY_..."`.
- [ ] `scripts/probes/irisy-eval.mjs` 9/9 PASS on a 0.1.179 install — pending bao update + run.

## Provenance

- §1 Brain ← orig-003 (Brain Pi sole, 2026-05-30, status proposed → accepted here)
- §2 Capability ← orig-004 §Decision + §9 (10 namespaces / 28 methods, frequency ≥3 + category exception, 2026-05-22 → 2026-05-30)
- §3 Provider — NEW (2026-05-31). Synthesizes orig-004 §9.1 lock list + VMark `ai_provider/` literal port (sink/detection/path_resolver/REST adapters, ISC) + Continue `roles[]` routing primitive (Apache-2.0) + LiteLLM typed fallback chain (MIT). Replaces never-shipped orig-021 "Irisy brain switcher" (which was superseded by §1 Pi singleton).
- §4 Crypto ← orig-007 (vodozemac, 2026-05-16, accepted)
- §5 Subprocess ← orig-012 (portable-pty SubprocessActor, 2026-05-19, accepted)
- §6 MCP bus ← orig-013 (kernel as MCP server, 2026-05-22, accepted)
- §7 Composition ← orig-024 (6-axis manifest, 2026-05-30, status proposed → accepted-at-decision here, implementation deferred per "实施时决")
- §8 Vault — NEW v3 (2026-06-01). Driven by bao session "L1 vault button + vault MD management research + sourcing inbox workflow + 整体一次性 ship". Lock decisions in `.olym/brainstorm/vault-md-management-2026-06-01.md` §10. Feature-layer boundary (Daily Note + Sourcing) aligns with memory `feedback_build_system_not_business`; storage philosophy aligns with `decision_ctrl_obsidian_philosophy` (vim test) + `decision_vmark_not_substrate_use_open_stack` (no VMark sidecar). Wiki-link Tiptap extension ports from seahop/kairo (MIT) — see THIRD_PARTY_LICENSES/kairo-MIT.txt.
