<!-- ADR Index — 8 module ADRs. Single source of truth. Code MUST reference `(ADR-NNN <module> § <section> v<N>)` in comments. Amendments bump `version:` in ADR frontmatter; new ADRs only created if a new **module** appears. -->

# CTRL ADRs — module-organized, 8 active + 2 retired

| # | Module | Title | Version | Status | Last updated |
|---|---|---|---|---|---|
| [001](./001-spine.md) | spine | 4-layer kernel + 5 primitives + 4 mcp sources + **one user-visible Irisy with Assistant/Coding identities; identity, resource, and pinned-skill projection change real scope while the two ACP owners, cancellation, transcript/session, credentials, capabilities, and approvals remain isolated (§4 v21); runtime names are implementation detail** + 3-capability-face (MCP/API/Skills via :17873) + versioned JSON Schema manifest contract + 6 self-evolution loops | v21 | accepted | 2026-08-03 |
| [002](./002-substrate.md) | substrate | **Hermes 是 Irisy 的脑 (§1, v28 纠正 — hermes 不退役) + BYO-CLI driver projection 附加 (§1B, §1B.8 v79 per-pack Coding workspace requires explicit `projection.coding_workspace: true`; `record_source` never implies actor scope) + ACP future (§1.8) + §1.8.6 v75 capability-negotiated multi-modal ContentBlock attachments (Image/EmbeddedResource), shared by Irisy and opencode through one AcpClient** · capability surface · 3-capability-face · provider router · crypto · subprocess · MCP bus (= projection gate) · composition · **§7 v73 versioned draft-2020-12 JSON Schema is the sole cross-language manifest authority; Ajv/Rust validators are consumers** · **§12 diagnostics projection (v72: existing ACP/PTY/vault owners publish content-free lifecycle metadata, no ownership transfer)** · **§14 Unified Operation Interface (describe/query/produce; §14.13 v45 统一写侧 RecordSink + 类型化 ProduceOp; §14.14 v77 source-owned analytical caches; §14.15 v78 generic local MCP-backed source, LibreOffice read-only first consumer)** + **§brain v38 — Irisy 引擎泛化为可选 ACP engine** + **§1.9 v46 Notes 全原生替代** + **§3 v71 provider verification/router** + **§7 v76 durable pack research** | v79 | accepted | 2026-08-02 |
| [003](./003-frontend.md) | frontend | Single PWA + fixed macOS launcher shell + **one mounted Irisy dialog; bottom controls expose Identity = Assistant/Coding, real Resource, and Auto or explicitly pinned Skill; engine names and Workspace terminology are hidden from ordinary chrome; single-project Coding auto-binds its project; runtime/session isolation remains strict (§8.5/§8.6 v39)** + Ambient morphing home + Sidebar L1 + intelligent tables + diagnostics surface | v39 | accepted | 2026-08-03 |
| [004](./004-cap.md) | cap | Mcp execution model + **§1 v14 native application harness = MCP-server pack authoring/verification pattern only (backend discovery, installed-entrypoint + real-software + agent-only E2E, semantic artifact verification, truthful preview); no new runtime/schema/primitive** + **§1 v13 managed local MCP-backed Source actor lifecycle (explicit enable, JS/TS stdio child, health/shutdown/bounded reconnect/fail-closed; LibreOffice first consumer)** + Tauri authenticated updater download + **CTRL-owned macOS atomic in-place transaction with durable health-gated rollback and compile-time-isolated signed localhost A/B fault harness (§2 v11)** + 4-layer × 3-tier auto-update + **§1 OS sandbox on pack shell DRIFT closed (v3)** + **§2 v12 release acceptance** | v14 | accepted | 2026-08-05 |
| [005](./005-irisy.md) | irisy | PWA persona shell + operator mission/knowledge + terminal-essence dialog + **§8.7/§11 v38 one user-visible Irisy with Assistant/Coding identities and real Resource/Skill projection; installed-but-unused skills are not shown active; identity/resource/skill changes reset only the affected ACP owner; underlying runtime, cancellation/drain, transcript/session, scope, capabilities, credentials, and approvals stay isolated** + selectable internal ACP engine + Companion/Workspace/Artifact integration contract + semantic remote window | v38 | accepted | 2026-08-03 |
| [006](./006-cross-cutting.md) | cross-cutting | **BYOK aggregator-first** + global English first + plain-text philosophy + policy envelope + **v12 no automatic provider/fallback binding; local runtimes are probed system facts** | v12 | accepted | 2026-07-25 |
| [007](./007-workbench.md) | workbench | Mcp-composition canvas (React Flow + dnd-kit) + Irisy-led skill discovery through the selected current engine and gate | v2 | accepted | 2026-07-13 |
| [008](./008-irisy-assistant.md) | irisy-assistant | Irisy reply specs / user intents / Irisy capabilities / Irisy pipeline | — | **retired** by 001 v4 + 002 v19 | 2026-06-09 |
| [009](./009-pi-surface-integration.md) | pi-surface-integration | ctrl-pi-bridge full Pi extension wiring (12 hooks + 6 communication APIs) | — | **retired** by 001 v4 + 002 v19 | 2026-06-09 |
| [010](./010-communication.md) | communication | **统一窄腰 (§14 契约 + :17873 治理 + MCP 插件协议) over 多元传输** — 8 条缝传输选型；subscribe = query{watch}；**v13 LibreOffice application-owned Python UNO extension + OS-keychain credential + secret-free owner-only rendezvous; managed JS stdio child 后仅 generic §14 跨 gate**；v10 endpoint spec；v11 diagnostics。通讯总纲，实现真相引用 001/002/003 | v13 | accepted | 2026-08-02 |

## Module map → code locations

| Module | Owns | Code locations |
|---|---|---|
| spine | overall architecture, 5 primitives, anti-list | `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs` |
| substrate | agent installer + launcher, capability surface, provider router (including fal.ai API face), crypto, subprocess, MCP bus, manifest composition, Notes folder MCP exposure | `packages/ctrl-mcp-sdk/schema/manifest-v2.schema.json` + `src-tauri/src/kernel/` (provider/, diagnostics.rs, mcp_server.rs, mcp_host.rs, pack_validate.rs, subprocess_actor.rs, subprocess_channel_adapter.rs, vault.rs, vault_watch.rs, vault_index.rs, vault_doc.rs, vault_notes_source.rs) + `src-tauri/src/commands/{vault,agents,image,diagnostics}.rs` + `src-tauri/src/shell/{agent_installer,agent_launcher,acp_client}.rs` |
| frontend | PWA shell, L1 nav, Keyboard, vault browser, viewers, macOS fixed Accessory launcher/NSPanel/tray lifecycle | `packages/ctrl-web/` + `src-tauri/src/shell/{lifecycle,tray,window}.rs` + `src-tauri/src/lib.rs` + `scripts/debug/diagnostics_smoke.py` |
| cap | mcp execution (MCP outward / Actor inward), updater, auto-update tiers | `src-tauri/src/kernel/actor.rs` + `src-tauri/src/commands/updater.rs` + `src-tauri/src/{lib,main}.rs` + `scripts/{release.sh,build-local-updater-channel.sh}` + `scripts/debug/updater-fault.sh` + `packages/ctrl-mcps/` |
| irisy | 8-stage UX, remote co-view primitives, persona prompts | `packages/ctrl-web/src/routes/irisy.tsx` + `packages/ctrl-web/src/lib/irisy-prompts.ts` + `packages/ctrl-mesh/` + `worker/ctrl-relay/src/` |
| cross-cutting | BYOK, global English, plain-text philosophy (vim-test gate) | reviewer-policy, no single owner |
| workbench | composition canvas, skill discovery | `packages/ctrl-web/src/routes/workbench.tsx` (Phase 1) + `src-tauri/src/commands/skills.rs` (Phase 1) + future `soodooi/ctrl-cloud` Worker (Phase 2) |
| communication | 通讯总纲:窄腰(契约/治理/插件)+ 8 缝传输选型 + 内外哲学(cross-cutting,实现真相引用 001 §primitives / 002 §14·§mcp-bus·§crypto / 003 §6.5) | cross-cutting (no single owner; spans `src-tauri/src/kernel/{channel,event,mcp_server,diagnostics}.rs` + `kernel/query*.rs` + `packages/ctrl-web/src/lib/kernel.ts` + `kernel/event_ws.rs` (Tauri Channels + CBOR-over-WS event transport)) |

## Provenance — original 22 numbered ADRs (collapsed 2026-05-31)

Original files removed from working tree; full history reachable via `git log` (predecessor commit `31f47de` shipped v0.1.126; reorg commit `8749bdf` collapsed 22 → 7).

| Original ADR | Title (verbatim) | Merged into |
|---|---|---|
| 001 (orig) | 4-layer AI-native Agent OS kernel architecture | **001 spine** |
| 002 (orig) | Pivot UI to single PWA codebase | **003 frontend § pwa** |
| 003 (orig) | Brain — Pi is the sole core agent loop | **002 substrate § brain** |
| 003 (orig pre-rewrite) | Multi-device mesh | **002 substrate § crypto** (mesh deferred to v1.1) |
| 004 (orig) | Kernel capability surface (10 ns / 28 methods) + §9 sub-systems | **002 substrate § capability + § provider + § mcp-bus** |
| 005 (orig) | No Claude / Anthropic SDK in CTRL production runtime | **006 cross-cutting § byok-no-claude** |
| 006 / 008 / 009 | (never written — reserved slots) | (deleted from registry — no longer reserve) |
| 007 (orig) | vodozemac (Matrix Olm) for E2E crypto | **002 substrate § crypto** |
| 010 (orig) | Mcp execution model — MCP outward, Actor inward | **004 cap § execution** |
| 011 (orig) | Tauri 2 updater + three-mirror channel | **004 cap § updater** |
| 012 (orig) | SubprocessActor + portable-pty | **002 substrate § subprocess** |
| 013 (orig) | Kernel as MCP server (single bus :17873) | **002 substrate § mcp-bus** |
| 014 (orig) | CTRL = global English first | **006 cross-cutting § global-english** |
| 015 (orig) | Plain-text philosophy (formerly "Obsidian") | **006 cross-cutting § plain-text** |
| 016 (orig) | Irisy 8-stage mcp lifecycle | **005 irisy § lifecycle** |
| 017 (orig) | Remote co-view = Irisy primitives | **005 irisy § remote-view** |
| 018 (orig) | Auto-update 4 layers × 3 tiers | **004 cap § auto-update** |
| 019 (orig) | CTRL = hermes plugin (primary) | (deleted — hermes fully removed 2026-05-28, PR #62) |
| 020 (orig) | VMark stack adoption | **003 frontend § vault-stack** (stack adopted, VMark NOT a dependency) |
| 021 (orig) | Irisy brain switcher (cc-switch / VMark / opencode style) | (deleted — superseded by 002 substrate § brain Pi singleton; provider switcher UX lives in 002 substrate § provider §3.6) |
| 022 (orig) | Workbench composition canvas (React Flow + dnd-kit) | **007 workbench § canvas** |
| 023 (orig) | Skill discovery — kernel-local first, ctrl-cloud Worker for production | **007 workbench § discovery** |
| 024 (orig) | Substrate composition model — 6-axis manifest | **002 substrate § composition** + persona rule lifted to **005 irisy § persona** |

## Versioning

Single source of truth. Each module ADR has `version:` in frontmatter. Amendments:

1. Edit the section in place
2. Bump `version:` (v1 → v2)
3. Prepend the newest row to `changelog:` listing the change + memory/decision link
4. Update `last_updated:` to today
5. Reference new behavior in code as `(ADR-NNN <module> § <section> v<N>)`

Never create a new numbered ADR for a section amendment. New ADR ↔ new module only.
