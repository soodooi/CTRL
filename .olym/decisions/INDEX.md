<!-- ADR Index — 7 module ADRs. Single source of truth. Code MUST reference `(ADR-NNN <module> § <section> v<N>)` in comments. Amendments bump `version:` in ADR frontmatter; new ADRs only created if a new **module** appears. -->

# CTRL ADRs — module-organized, 7 total

| # | Module | Title | Sections | Version | Status | Last updated |
|---|---|---|---|---|---|---|
| [001](./001-spine.md) | spine | 4-layer kernel + 5 primitives + 5 keycap sources + Pi-centric reframe | layers · primitives · sources · pi-centric · invariants · philosophy | v1 | accepted | 2026-05-31 |
| [002](./002-substrate.md) | substrate | Pi brain · capability surface · provider router · crypto · subprocess · MCP bus · composition · **vault** | brain · capability · provider · crypto · subprocess · mcp-bus · composition · vault | v4 | accepted | 2026-06-02 |
| [003](./003-frontend.md) | frontend | Single PWA + Irisy-as-sole-entry + Keyboard drag-install + vault viewer stack + 4-col shell | pwa · nav-keyboard · vault-stack · shell-4col | v3 | accepted | 2026-06-01 |
| [004](./004-cap.md) | cap | Keycap execution model + Tauri updater + 4-layer × 3-tier auto-update | execution · updater · auto-update | v1 | accepted | 2026-05-31 |
| [005](./005-irisy.md) | irisy | 8-stage keycap lifecycle + remote co-view primitives + persona rule | lifecycle · remote-view · persona | v1 | accepted | 2026-05-31 |
| [006](./006-cross-cutting.md) | cross-cutting | BYOK no-Claude in production + global English first + plain-text philosophy | byok-no-claude · global-english · plain-text | v1 | accepted | 2026-05-31 |
| [007](./007-workbench.md) | workbench | Keycap-composition canvas (React Flow + dnd-kit) + Irisy-led skill discovery | canvas · discovery | v1 | accepted | 2026-05-31 |

## Module map → code locations

| Module | Owns | Code locations |
|---|---|---|
| spine | overall architecture, 5 primitives, anti-list | `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs` |
| substrate | brain spawn, capability surface, provider router, crypto, subprocess, MCP bus, manifest composition, **vault primitives + index** | `src-tauri/src/kernel/` (provider/, mcp_server.rs, mcp_host.rs, subprocess_actor.rs, vault.rs, vault_index.rs) + `src-tauri/src/commands/vault.rs` + `packages/ctrl-pi-bridge/` + `packages/ctrl-pi-plugin/` |
| frontend | PWA shell, L1 nav, Keyboard, vault browser, viewers | `packages/ctrl-web/` |
| cap | keycap execution (MCP outward / Actor inward), updater, auto-update tiers | `src-tauri/src/kernel/actor.rs` + `scripts/release.sh` + `packages/ctrl-keycaps/` |
| irisy | 8-stage UX, remote co-view primitives, persona prompts | `packages/ctrl-web/src/routes/irisy.tsx` + `packages/ctrl-web/src/lib/irisy-prompts.ts` |
| cross-cutting | BYOK, global English, plain-text philosophy (vim-test gate) | reviewer-policy, no single owner |
| workbench | composition canvas, skill discovery | `packages/ctrl-web/src/routes/workbench.tsx` (Phase 1) + `src-tauri/src/commands/skills.rs` (Phase 1) + future `soodooi/ctrl-cloud` Worker (Phase 2) |

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
| 010 (orig) | Keycap execution model — MCP outward, Actor inward | **004 cap § execution** |
| 011 (orig) | Tauri 2 updater + three-mirror channel | **004 cap § updater** |
| 012 (orig) | SubprocessActor + portable-pty | **002 substrate § subprocess** |
| 013 (orig) | Kernel as MCP server (single bus :17873) | **002 substrate § mcp-bus** |
| 014 (orig) | CTRL = global English first | **006 cross-cutting § global-english** |
| 015 (orig) | Plain-text philosophy (formerly "Obsidian") | **006 cross-cutting § plain-text** |
| 016 (orig) | Irisy 8-stage keycap lifecycle | **005 irisy § lifecycle** |
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
3. Append a row to `changelog:` listing the change + memory/decision link
4. Update `last_updated:` to today
5. Reference new behavior in code as `(ADR-NNN <module> § <section> v<N>)`

Never create a new numbered ADR for a section amendment. New ADR ↔ new module only.
