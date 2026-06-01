---
adr_id: 002
module: substrate
title: CTRL substrate — Pi brain · capability surface · provider router · crypto · subprocess · MCP bus · composition
version: 2
status: accepted
last_updated: 2026-05-31
deciders: [bao, zeus]
sections:
  - { id: brain,        source: orig-003 }
  - { id: capability,   source: orig-004 }
  - { id: provider,     source: new-2026-05-31, note: "VMark port + role routing + introspection" }
  - { id: crypto,       source: orig-007 }
  - { id: subprocess,   source: orig-012 }
  - { id: mcp-bus,      source: orig-013 }
  - { id: composition,  source: orig-024 }
changelog:
  - v1 2026-05-31: module reorg — merged orig-003 (Pi brain) + orig-004 (capability surface) + orig-007 (crypto) + orig-012 (SubprocessActor + portable-pty) + orig-013 (kernel-as-MCP-server) + orig-024 (6-axis composition). **NEW** § provider — role routing (irisy.primary/fallback, keycap.default) + VMark-style PATH detect + introspection (brain_status). Closes the "Irisy doesn't know its own stack" gap (bao 2026-05-31).
  - v2 2026-05-31: § provider amendments (bao 3-校准 in implementation discussion):
      (1) drop `keycap.default` role — keycap binds provider via manifest `brain_capabilities`, not via substrate-wide default (2-role model: irisy.primary + irisy.fallback only).
      (2) `irisy.primary` MUST be a detected user CLI (`claude > codex > gemini > aider`); removed "else volc" auto-fallback — primary path is augmentation, CTRL doesn't silently spend money there.
      (3) `irisy.fallback` is the CTRL-managed slot (CTRL pays Volc Doubao bill, future = ctrl-brand provider). Volc now has two manifest ids: `volc` (CTRL fallback, ctrl-managed creds) and `volc-byok` (user-elected, user keychain). brain_status() exposes `managed_by: "user" | "ctrl"`. Brand label "CTRL Cloud" hides codename from Irisy responses + failover messages.
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

## §2 Capability surface — 10 namespaces / 28 methods (frequency ≥3 rule + category exception)

Methods enter the kernel surface iff consumed by ≥3 keycaps across the v1 corpus, **OR** they are `mcp.*` / `platform.notify` (infrastructure), **OR** they belong to a brain-capability category (text / image / audio / embed) — category exception so multi-modal brain ships coherently (§7 amends frequency ≥3).

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

v1.1 promotion candidates (keycap-local until 2nd consumer): `process.spawn`, `network.local_rpc`, `oauth.broker`, `stss.{publish,subscribe}`.

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

### §3.5 Role routing — consumer-aware (NEW, replaces single `text.chat` bucket) — v2 2-role model

**v2 amendment (bao 2026-05-31)**: dropped `keycap.default` role (keycap binds provider via manifest `brain_capabilities`, not via substrate-wide default). `irisy.primary` MUST be a detected user CLI — no auto-fallback to a paid provider. `irisy.fallback` is the CTRL-managed slot (paid by CTRL).

```rust
pub enum Consumer { IrisyPrimary, IrisyFallback, Custom(String) }  // v2: dropped KeycapDefault

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

v1 → v2 migration: if file has the old single bucket `{"text.chat": "<id>"}`, the loader writes `roles.irisy.primary = <id>` and `roles.irisy.fallback = "volc"`. If file has v1 `roles.keycap.default`, the loader drops that key.

`/text-chat` SSE endpoint (port 17878) accepts `?consumer=<role>` query param. Pi bridge sets `consumer=irisy.primary`; on stream error/timeout, kernel auto-falls-back through `RouteChain.fallbacks` (default: `["volc"]`) + emits `provider:failover { from, to, reason }` event.

### §3.6 Detect + auto-adopt UX (mirrors VMark detect + role assignment is CTRL-new) — v2

**v2 amendment**: page renders **2 role sections** (not 3); `irisy.fallback` defaults `volc` at first boot without user action (CTRL-managed).

- Tauri command `provider_detect()` → `Vec<ProviderEntry { id, label, kind, binary_path, version, available }>`. Scans PATH for `claude` / `codex` / `gemini` / `aider` / `ollama`; pings REST endpoints for configured keys. Cached in `OnceLock<Mutex<...>>` (ported from VMark `detection.rs`).
- First boot + no `active-providers.json`:
  - `irisy.primary` = highest-priority detected CLI (`claude > codex > gemini > aider`), silent — Irisy one-line toast "Using <label> — change in Settings". **No CLI detected → primary stays unset**, Irisy toasts "Tip: install Claude CLI for free use, or your Volc fallback is already active" (still functional via fallback).
  - `irisy.fallback` = `volc` always — CTRL-managed credential, no user action needed.
- Tauri command `provider_set_active(role, provider_id)` runs `trial_verify()` (1-token "hi", 5s deadline) before committing. Failure → keep previous, surface specific error.
- `/settings/providers` page — **2 role sections** (Irisy primary / Irisy fallback) × radio rows with Available/Not-found badges. CLI providers listed first within each section, then `volc` (the CTRL fallback option, always shown as Available with "[CTRL-managed]" badge in fallback section). REST API (BYOK) section below — Anthropic / OpenAI / Google / Volc-BYOK / Kimi / DeepSeek / Ollama with Configure→ buttons. BYOK Volc is a separate row from CTRL-managed volc (different manifest id `volc-byok`).

### §3.7 Introspection — Irisy self-awareness (closes bao 2026-05-31 root issue) — v2

**v2 amendment**: dropped `keycap.default` from the providers map. Fallback `volc` label = `"CTRL Cloud"` (brand-facing), not `"Volc Doubao"` (codename) — keeps user-facing layer abstracted so the future ctrl-brand swap is invisible.

Tauri command `brain_status()`:
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

`managed_by` field (v2): `"user"` = user-owned CLI or user BYOK key; `"ctrl"` = CTRL-paid fallback. Settings UI surfaces this so the user understands who pays for each path.

Irisy system prompt v5 (ADR-005 § persona) injects `<brain_state>` block built from this. Irisy answers "你用什么模型" with **brand label** ("Claude 订阅" / "CTRL Cloud") — never RPC codename ("Pi" / "claude-oauth" / "volc" / "RpcClient"). On failover Irisy says "Claude 暂时连不上, 我切到 CTRL Cloud 了" — uses the typed event + brand label, not heuristics, not the `volc` codename.

### §3.8 Retirements

Removed by this section (do not re-introduce): `brain_config.rs`, `commands/brain.rs`, `~/.ctrl/active-brain` file, `BrainListReply / BrainView`, single-`text.chat`-bucket assumption, hand-rolled RPC wire format in `ctrl-pi-bridge` (use Pi's `RpcClient`).

## §4 Crypto — vodozemac (Matrix Olm) on all platforms

Adopt **vodozemac** (Matrix.org Olm Rust fork). Olm 1:1 sessions only (point-to-point double-ratchet); Megolm disabled (CTRL = single-user multi-device). All platforms — Tauri 2 desktop (crate), PWA mobile (WASM via `wasm-bindgen`), future hardware peers. libsignal-* explicitly rejected (Signal upstream policy + C++ WASM complexity + audit duplication). Defense-in-depth: DH public-key non-contributory check (vodozemac 0.10+ ships natively; keep wrapper-layer check as belt-and-braces).

v1 ships no mesh layer (memory `feedback_reuse_existing_capability_first` 2026-05-22 — 新功能先用现有 capability). vodozemac unlocked for v1.1+ mesh sprint.

## §5 Subprocess — SubprocessActor + portable-pty

**SubprocessActor** = concrete `Actor` trait impl in `src-tauri/src/kernel/subprocess_actor.rs`. Holds `Box<dyn portable_pty::Child>` + `MasterPty` + capability + tile metadata. Lifecycle: `on_spawn` → `handle(Event)` (stdin / resize / signal) → `on_shutdown` (kill + close PTY).

- **portable-pty 0.9** — Unix forkpty + Windows ConPTY auto-adapted. Mozilla/wezterm production use.
- **Events** in: `Subprocess.{Stdin, Resize, Signal}`. Events out: `Subprocess.{Stdout, Exit, Spawned}`.
- **Manifest** `ActorManifest.prototype = "subprocess"` carries `{ command, args, env, cwd, pty: {cols,rows} }`.
- **Supervisor**: single SubprocessActor crash never crashes kernel (panic catch + Error Event). 256 MB RAM cap per actor (OS rlimit / Job Object).
- **Used by**: Code Space tile keycaps (claude-code / cursor / aider / bash), CLI providers (§3 adapters).

## §6 MCP bus — kernel as MCP server :17873

Kernel runs MCP **server** parallel to its `mcp_host` (client) — same `rmcp 1.7` crate, different features. Single bus for hermes/Irisy/external agents to consume kernel capabilities via MCP wire.

- **Bind**: `127.0.0.1:17873` (one above ST-SS bridge 17872). Never `0.0.0.0` — cross-device goes through mesh (§4), not MCP.
- **Transport**: streamable-http (MCP 2025-03-26 spec). rmcp 1.7 + `server` + `transport-streamable-http-server` + `macros` + `schemars`. axum 0.8 hosts.
- **Auth**: ephemeral Bearer token. Fresh UUID v4 on every kernel boot, never persisted. `Authorization: Bearer <token>` header; axum middleware checks before `/mcp`.
- **Discovery**: Tauri command `mcp_server_info` returns `{ url, token }`.
- **Tools (11)**: `kernel.status` · `vault.{read,write,list,search}` · `kv.{get,set}` · `llm.chat` · `mcp.{list_servers,proxy_list_tools,proxy_call_tool}`. Stream LLM stays on Tauri event channel (PWA only), not on MCP surface.

## §7 Composition — 6-axis manifest (single substrate law)

Keycap manifest declares 6 axes; runtime atomically provisions all declared resources at install (no first-run wizard). Single law replaces 4-way schema drift.

| # | Axis | What |
|---|---|---|
| meta | `pattern` | A/B/C/D/E/F/G (ADR-004) → routes to executor |
| 1 | `capabilities` | subset of §2 namespaces + `file.{read,write}_allowlist` |
| 2 | `brain_capabilities` | typed multi-provider (text.chat / image.generate / audio.stt …) with optional `provider_pin` |
| 3 | `mcp_servers` | Pattern D bindings (spawn + tool allowlist) |
| 4 | `skills` | SKILL.md refs resolved via 3-tier chain (`vault/skills/` > `~/.claude/skills/` > keycap bundle) — first hit wins, no merge |
| 5 | `ui_surface` | 9-enum (none/notification/modal/clipboard/html-output/chat-stream/picker/form/canvas) |
| 6 | `cap_asset` | install-time provisioning: `cap_asset.files` (immutable bundle) + `cap_asset.vault` (user-facing folder + seed) |

**Persona lives inside `cap_asset.files`** as per-keycap markdown — not a separate axis. Vault override `vault/keycaps/<id>/persona.md` wins; single lookup, no global persona library.

**SSOT**: `packages/ctrl-keycap-sdk/src/manifest-schema.ts`. Other representations are derivatives (PWA Zod re-exports; Rust serde mirrors with golden file test).

**Builtin vs user keycap** = one metadata flag. `manifest.builtin = true` → ships from `packages/ctrl-keycaps/builtin/<id>/`, re-seeds on every launch (self-repairs deletion). `builtin = false` → `~/.ctrl/keycaps/<id>/`, uninstallable.

**Multi-modal category exception** to §2 frequency ≥3 rule: image.generate / image.edit / image.understand / audio.stt enter v1 even with 1 consumer each — "做海报得有 image 大模型, 我们是双重 brain" (bao 2026-05-30). Frequency rule still governs non-brain namespaces.

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
- [x] Builtin manifest validation in `shell/builtin_keycaps.rs` boot. Verified.

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

## Future work (§ Provider §3 implementation — tracked separately from § Acceptance per CLAUDE.md 灵活开发)

- `kernel/provider/{trait.rs, registry.rs, detect.rs, path_resolver.rs}` exist with **2-role** table (irisy.primary + irisy.fallback) + RouteChain + auto-fallback (v2)
- 4 REST adapters ported from VMark (`rest/{anthropic,openai,google,ollama}.rs`), ISC attribution
- **7 builtin manifests** (v2): `claude-oauth`, `anthropic-api`, `openai-api`, `volc` (CTRL-managed fallback), `volc-byok` (user-elected), `kimi`, `deepseek` (+ implicit `ollama` if detected)
- Tauri commands: `provider_detect` / `provider_set_active(role, id)` / `provider_active(role)` / `brain_status` (returns `managed_by` field per role, v2)
- `/text-chat?consumer=<role>` honors 2-role routing; auto-fallback chains on error, emits `provider:failover { from, to, reason }` event
- First-boot: irisy.primary = highest-priority detected CLI silently + Irisy toast; irisy.fallback = `volc` (CTRL-managed) always active without user action
- Irisy prompt v5 wired (depends on ADR-005 § persona implementation) — brand labels only ("Claude 订阅" / "CTRL Cloud"), never codenames
- `/settings/providers` page rendered inside Settings workspace route (ADR-003 § nav-keyboard v2) — **2 role sections** × radio with Available/Not-found + [CTRL-managed] badges + REST API (BYOK) config below

## Provenance

- §1 Brain ← orig-003 (Brain Pi sole, 2026-05-30, status proposed → accepted here)
- §2 Capability ← orig-004 §Decision + §9 (10 namespaces / 28 methods, frequency ≥3 + category exception, 2026-05-22 → 2026-05-30)
- §3 Provider — NEW (2026-05-31). Synthesizes orig-004 §9.1 lock list + VMark `ai_provider/` literal port (sink/detection/path_resolver/REST adapters, ISC) + Continue `roles[]` routing primitive (Apache-2.0) + LiteLLM typed fallback chain (MIT). Replaces never-shipped orig-021 "Irisy brain switcher" (which was superseded by §1 Pi singleton).
- §4 Crypto ← orig-007 (vodozemac, 2026-05-16, accepted)
- §5 Subprocess ← orig-012 (portable-pty SubprocessActor, 2026-05-19, accepted)
- §6 MCP bus ← orig-013 (kernel as MCP server, 2026-05-22, accepted)
- §7 Composition ← orig-024 (6-axis manifest, 2026-05-30, status proposed → accepted-at-decision here, implementation deferred per "实施时决")
