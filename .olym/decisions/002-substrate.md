---
adr_id: 002
module: substrate
title: CTRL substrate — Pi brain · capability surface · provider router · crypto · subprocess · MCP bus · composition
version: 5
status: accepted
last_updated: 2026-06-03
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
  - { id: smart-table-output,   source: new-2026-06-03, note: "keycap output unification — single SmartTable per keycap, schema in manifest output_capture" }
  - { id: embeddings,           source: new-2026-06-03, note: "local Ollama nomic-embed-text + SQLite vector blob + cosine flat search; hybrid mode on vault.search; 5 new MCP tools" }
changelog:
  - v1 2026-05-31: module reorg — merged orig-003 (Pi brain) + orig-004 (capability surface) + orig-007 (crypto) + orig-012 (SubprocessActor + portable-pty) + orig-013 (kernel-as-MCP-server) + orig-024 (6-axis composition). **NEW** § provider — role routing (irisy.primary/fallback, keycap.default) + VMark-style PATH detect + introspection (brain_status). Closes the "Irisy doesn't know its own stack" gap (bao 2026-05-31).
  - v2 2026-05-31: § provider amendments (bao 3-校准 in implementation discussion):
      (1) drop `keycap.default` role — keycap binds provider via manifest `brain_capabilities`, not via substrate-wide default (2-role model: irisy.primary + irisy.fallback only).
      (2) `irisy.primary` MUST be a detected user CLI (`claude > codex > gemini > aider`); removed "else volc" auto-fallback — primary path is augmentation, CTRL doesn't silently spend money there.
      (3) `irisy.fallback` is the CTRL-managed slot (CTRL pays Volc Doubao bill, future = ctrl-brand provider). Volc now has two manifest ids: `volc` (CTRL fallback, ctrl-managed creds) and `volc-byok` (user-elected, user keychain). brain_status() exposes `managed_by: "user" | "ctrl"`. Brand label "CTRL Cloud" hides codename from Irisy responses + failover messages.
  - v3 2026-06-01: **NEW** §8 Vault — kernel primitive endpoints (21 commands) + explicit feature-layer boundary: Daily Note + Sourcing inbox are **feature-layer** (Irisy + frontend wire them via `vault/.ctrl/*.yaml` + `vault/templates/*.md`), kernel does not know about either concept. Retires frontend O(N) backlink scan + 3-pane VaultBrowser shell. §6 MCP tools list extended from 11 to 28 (kernel exposes vault.{backlinks,tags,notes_by_tag,mentions,orphans,broken_links,graph_data,rename,move,create_folder,set_starred,aliases,watch} on top of existing 8). Wiki-link Tiptap extension cherry-picked from seahop/kairo (MIT, Sean Hopkins 2026) — see `THIRD_PARTY_LICENSES/kairo-MIT.txt`. Decision lock + sourcing workflow design: `.olym/brainstorm/vault-md-management-2026-06-01.md`.
  - v4 2026-06-02: §8.6 shell integration amended — bao realignment "Vault is substrate, Notes is the L1 app". L1 chip relabelled **Notes** (id `notes`, path `/notes`); chip click uses `openSystemTab({kind:'route', path:'/notes'})` matching Pool/Coding. New `routes/notes.tsx` renders `<NotesApp />` (3-pane: NotesActions top bar + NotesTree left + NotesEditor center + NotesBacklinks right). Components live in `packages/ctrl-web/src/components/notes/*` as standalone files for future Irisy-app-system reuse. L2 column reservation kept but **no longer flipped for Notes** — the app composes inside a workspace tab body, not across the shell grid. §8.7 retirements extended: `L2VaultPanel.{tsx,module.css}` deleted, `BacklinksDrawer.{tsx,module.css}` deleted (backlinks live inside NotesApp right column), `routes/vault.tsx` deleted (replaced by `routes/notes.tsx`), Rust `expand_workspace_window_if_collapsed` command deleted. Editor lib forward-compat invariant: `@tiptap/*` + `@uiw/react-codemirror` + `mermaid` + `gray-matter` consumed as npm packages — thin React wrappers, no fork, no vendor.
  - v5 2026-06-03: **NEW §9 smart-table-output** + **NEW §10 embeddings**. §9 unifies keycap output capture as one SmartTable per keycap (markdown table file at `notes/keycap-runs/<keycap_id>.table.md`, schema in keycap manifest `output_capture`); supersedes "1-run-1-file sidecar markdown" idea from `.olym/brainstorm/openclaw-compat-2026-06-03.md` — Notion-style table beats sidecar markdown for browsability and inline edit. P4 product-decision (`.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`) locks "default-on, settings-wide kill-switch, per-keycap manifest opt-out". §10 adds the embeddings substrate the product spec depends on (Layer 3 Connect + Layer 4 Synthesize): local Ollama default with transparent fallback prompt (per product P1), SQLite BLOB storage (no sqlite-vss dep — flat cosine is fine for vault-scale up to ~50K notes), 5 new vault.* MCP tools, hybrid `vault.search` mode. Eight new acceptance items; brainstorm: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`.
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
- **Tools (28, v3)**: `kernel.status` · `vault.{read,write,write_image,list,search,delete,root_path,rebuild_index,backlinks,tags,notes_by_tag,mentions,orphans,broken_links,graph_data,rename,move,create_folder,set_starred,aliases,watch}` (21) · `kv.{get,set}` · `llm.chat` · `mcp.{list_servers,proxy_list_tools,proxy_call_tool}`. Stream LLM stays on Tauri event channel (PWA only), not on MCP surface. Vault tool set expanded in v3 per §8.

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
    sourcing/                       ← user inbox (clipboard/OCR/link keycaps write here)
    templates/                      ← template files (user can fork; default 2 seeded)
        daily.md
        meeting.md
    skills/                         ← per-keycap skill override (ADR-002 §7)
    keycaps/<id>/                   ← per-keycap vault override (cap_asset.vault)
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

**Sourcing inbox + integration routine** — `vault/sourcing/` is just a folder; clipboard / OCR / link keycaps `vault.write` into it. `vault/.ctrl/sourcing.yaml` defines triggers (cron 9am + count threshold + manual command, all three concurrent), target root, review queue path. `vault/.ctrl/sourcing-prompt.md` is the user-editable prompt for Irisy's integration routine. Irisy runs the routine (composed from `vault.list(prefix='sourcing/')` + `vault.read` + `vault.tags` + `vault.search` + `vault.write` to `.ctrl/review-queue/<date>.md` + `platform.notify`). Kernel never touches the routine logic.

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

Vault is the substrate; the L1 chip surfaces the **Notes** app (the first vault-using app). Future apps that read vault data (e.g. Weekly Review, Meeting Notes) can also register as L1 chips or as Irisy-spawned keycaps without entering this section.

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

## §9 Smart table output — keycap output unification (NEW v5, 2026-06-03)

> Spec: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.6 + product decision P4
> Driver: bao 2026-06-03 "keycap 走简单一点, 用智能表格列表形式怎么样"

### §9.1 Lock

Every keycap's run output is captured into **one** SmartTable per keycap, not one-file-per-run. On-disk shape: `vault/notes/keycap-runs/<keycap_id>.table.md` (vim test passes — opens as a normal markdown file with a frontmatter `schema:` + a markdown table body). The SmartTable substrate (`packages/ctrl-web/src/lib/smart-table.ts` + `components/viewers/SmartTableViewer.tsx`) already exists; §9 only adds the wiring from `keycap_runner` to it.

### §9.2 Keycap manifest extension — `output_capture`

```yaml
# keycap manifest (per-keycap)
output_capture:
  enabled: true                                # default true; user can flip in Settings → Privacy
  table_path: notes/keycap-runs/{keycap_id}.table.md
  schema:
    - { key: ts,           label: When,        type: date }
    - { key: input_excerpt, label: Input,       type: text }
    - { key: output_excerpt, label: Output,     type: text }
    - { key: provider,     label: Provider,    type: text }
    - { key: model,        label: Model,       type: text }
    - { key: tokens,       label: Tokens,      type: number }
    - { key: accepted,     label: Accepted,    type: checkbox }
```

Standard 7 columns are recommended (consistency across keycaps); keycap authors can extend with extra columns (e.g. OCR adds `confidence`, translate adds `lang_pair`). Schema additions must be backward-compatible with existing rows — when `keycap_runner` writes a row missing a new column, the column cell is empty.

### §9.3 keycap_runner wiring

After each `keycap.run` completes successfully:

1. Read manifest `output_capture` block. If absent or `enabled: false`, do nothing.
2. Read existing `<table_path>` via `vault.read`. If missing, create with the manifest schema as frontmatter + an empty table body.
3. Call `smart_table.appendRow({ ts: now_iso, input_excerpt: truncate(input, 80), output_excerpt: truncate(output, 80), provider, model, tokens, accepted: false, …extras })`.
4. Write back via `vault.write`. Index automatically picked up by FTS5 (`vault_index.upsert`).

Errors here are warn-logged but never block the keycap's own response — output capture is a side effect, never a gate.

### §9.4 Archival

When `<table_path>` exceeds **500 rows**, `keycap_runner` rotates it: rename to `archive/<keycap_id>-<YYYY>-Q<N>.md` (current ISO quarter), then create a fresh empty table. The archive is also a normal markdown file under `vault/notes/keycap-runs/archive/`, indexed normally.

### §9.5 User control

- Settings → Privacy → **"Capture keycap outputs into vault tables"** master toggle. Default on. When off, no keycap writes to its table (still computes the run, just doesn't persist the row).
- Per-keycap manifest can flip `enabled: false` for inherently private keycaps (e.g. an "auth" keycap that holds secrets).
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

- §9 smart-table-output — Keycap manifest `output_capture` field + JSONSchema validation in `packages/ctrl-keycap-sdk/src/manifest-schema.ts` (today the kernel falls back to defaults when manifest absent).
- §9 smart-table-output — Settings → Privacy master toggle ("Capture keycap outputs into vault tables", default on).
- §9 smart-table-output — Wire provider / model / tokens into `run_keycap` so the captured row carries real values instead of empty strings.
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
- [x] §9.1 strategic lock — single SmartTable per keycap at `notes/keycap-runs/<id>.table.md` (P4 product decision recorded in brainstorm).
- [x] `keycap_runner` post-run hook wires output to `notes/keycap-runs/<id>.table.md` via `kernel::keycap_capture::capture_row`. Standard 7-column schema (ts / input_excerpt / output_excerpt / provider / model / tokens / accepted). Provider/model/tokens default to empty until `run_keycap` exposes them; the row still lands. v0.1.158.
- [x] Rotation at 500 rows to `notes/keycap-runs/archive/<stem>-<YYYY>-Q<N>.md`. v0.1.158.
- [x] Vault seed creates `notes/keycap-runs/` + `notes/keycap-runs/archive/` directories (`kernel::vault::seed_vault_feature_layer`). v0.1.158.

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

## Provenance

- §1 Brain ← orig-003 (Brain Pi sole, 2026-05-30, status proposed → accepted here)
- §2 Capability ← orig-004 §Decision + §9 (10 namespaces / 28 methods, frequency ≥3 + category exception, 2026-05-22 → 2026-05-30)
- §3 Provider — NEW (2026-05-31). Synthesizes orig-004 §9.1 lock list + VMark `ai_provider/` literal port (sink/detection/path_resolver/REST adapters, ISC) + Continue `roles[]` routing primitive (Apache-2.0) + LiteLLM typed fallback chain (MIT). Replaces never-shipped orig-021 "Irisy brain switcher" (which was superseded by §1 Pi singleton).
- §4 Crypto ← orig-007 (vodozemac, 2026-05-16, accepted)
- §5 Subprocess ← orig-012 (portable-pty SubprocessActor, 2026-05-19, accepted)
- §6 MCP bus ← orig-013 (kernel as MCP server, 2026-05-22, accepted)
- §7 Composition ← orig-024 (6-axis manifest, 2026-05-30, status proposed → accepted-at-decision here, implementation deferred per "实施时决")
- §8 Vault — NEW v3 (2026-06-01). Driven by bao session "L1 vault button + vault MD management research + sourcing inbox workflow + 整体一次性 ship". Lock decisions in `.olym/brainstorm/vault-md-management-2026-06-01.md` §10. Feature-layer boundary (Daily Note + Sourcing) aligns with memory `feedback_build_system_not_business`; storage philosophy aligns with `decision_ctrl_obsidian_philosophy` (vim test) + `decision_vmark_not_substrate_use_open_stack` (no VMark sidecar). Wiki-link Tiptap extension ports from seahop/kairo (MIT) — see THIRD_PARTY_LICENSES/kairo-MIT.txt.
