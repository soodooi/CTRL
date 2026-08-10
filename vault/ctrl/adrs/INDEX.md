<!-- ADR Index — 8 module ADRs. Single source of truth. Code MUST reference `(ADR-NNN <module> § <section> v<N>)` in comments. Amendments bump `version:` in ADR frontmatter; new ADRs only created if a new **module** appears. -->

# CTRL ADRs — 8 module rows + 2 retired provenance rows

| # | Module | Title | Version | Status | Last updated |
|---|---|---|---|---|---|
| [001](./001-spine.md) | spine | 4-layer kernel + 5 primitives + 4 MCP sources + **one fixed Irisy identity; project coding is Project Resource + Skill/capability scope; BYO CLI is an external `:17873` client whose loop CTRL does not own** + 3 capability faces + plain-text invariants + self-evolution loops | v22 | accepted | 2026-08-05 |
| [002](./002-substrate.md) | substrate | Projection/gate substrate + five-primitives compatibility + 3 capability faces + provider/MCP/manifest runtime + **v90 §15.2 写契约从单篇笔记扩展到三个记录源：任务（按行）、单个日历事件（按笔记而非扫描位置）、智能表格单元格；过期前置与未验证回复只定义一次** + **v89 §17.5 per-source narrowing implemented: a bare `source` grant authorizes no connector; the addressed `source:<id>` must be named** + **v88 §15.4.1 capability availability is user-owned plain-text state; enable/disable are the catalogue Resource's bounded produce operations; disabled stays installed but unselectable and unprojectable** + **v87 §15.2 accepts the bounded Markdown note write contract (staged-before-approval, revision recheck, recovery point, atomic commit, post-write reread, rollback)** + **v86 §15.5 typed owner-produced Outcome (target/staged/precondition/provenance/effect/Feedback), boundary error-string flattening is a defect, ReviewGate requests derive from the prepared Outcome; §17.6 每个能力域需可执行管线才算 verified** + **v85 §17 sole enumerated capability-domain registry (`system` + 19 grants; code becomes its implementation; `net` never default)** + **v84 FCT is the sole user-facing reusable-capability noun and a live per-turn projection that preserves Work Resources, appends dependencies, optionally selects Skill, and enforces least-privilege gate scope; stable refs, explicit Auto recovery, one local registry; v83 sole permanent ResourceOwner path** | v90 | accepted | 2026-08-05 |
| [003](./003-frontend.md) | frontend | **v45 legacy shell surfaces deleted (workspace shell family, tab strip, route-tab map, in-house Notes app, /notes /workspace /irisy routes); hosted remote entry preserved as U25 deferred scope** + **One Ambient production shell; L1 exactly Work/Library/Settings; Library separates Find/Installed management from Create FCT authoring; composer owns per-session Use via compact FCT selector; creation never auto-activates; **v44 decision facts adapted from owner Outcomes; each surface names its intent IDs and carries runnable evidence** + descriptor/content-type viewer registry; **v43 one frontend-owned decision surface registry rendering kernel-typed facts by closed kind (approval/unavailable/conflict/progress/choice/capture), no hand-built or degraded decisions**; v42 every surface serves and cites a v1 ADR-005 §12 intent, no inventory-as-chrome, approval/provenance/failure surfaces required; role switcher retired-v40** | v45 | accepted | 2026-08-05 |
| [004](./004-cap.md) | cap | Mcp execution model + **§1 v14 native application harness = MCP-server pack authoring/verification pattern only (backend discovery, installed-entrypoint + real-software + agent-only E2E, semantic artifact verification, truthful preview); no new runtime/schema/primitive** + **§1 v13 managed local MCP-backed Source actor lifecycle (explicit enable, JS/TS stdio child, health/shutdown/bounded reconnect/fail-closed; LibreOffice first consumer)** + Tauri authenticated updater download + **CTRL-owned macOS atomic in-place transaction with durable health-gated rollback and compile-time-isolated signed localhost A/B fault harness (§2 v11)** + 4-layer × 3-tier auto-update + **§1 OS sandbox on pack shell DRIFT closed (v3)** + **§2 v12 release acceptance** | v14 | accepted | 2026-08-05 |
| [005](./005-irisy.md) | irisy | **v44 §11.2 transcript 真相是 kernel 拥有的纯文本 Resource（`ctrl://local/session/<id>`，一会话一 Markdown 文件，目录即列表），前端 store 降为投影，仅落已定稿的轮次** + **v43 §12.3 每条意图一条可执行管线，状态 verified/partial/declared 由证据生成** + **v42 §12 sole user-intent registry (U1–U25, domain-mapped, v1/later scope; §1 intent column retired)** + **One fixed Irisy identity; canonical six-fact context tuple; selected FCT resolves live per session before assembly, preserves Work Resources, appends dependencies, and supplies optional Skill plus enforced gate scope while owning none of them; stale selection reports and returns to Auto; kernel-owned plain-text transcript authority** + mission/knowledge + integration contract | v44 | accepted | 2026-08-05 |
| [006](./006-cross-cutting.md) | cross-cutting | BYOK aggregator-first + global English + plain text + policy envelope + **v14 FCT-only product vocabulary and normalized cloud FCT results with internal source kinds preserved; MIT `ctrl-<name>` package boundary unchanged; no content/storage/install execution; local registry/install work without cloud** | v14 | accepted | 2026-08-05 |
| [007](./007-workbench.md) | workbench | **Deprecated provenance only: canvas/orchestrator retired because CTRL is not a workflow editor; discovery authority migrated without orphaning to ADR-002 v81, ADR-003 v40, and ADR-006 v13** | v3 | **deprecated** | 2026-08-05 |
| [008](./008-irisy-assistant.md) | irisy-assistant | Irisy reply specs / user intents / Irisy capabilities / Irisy pipeline | — | **retired** by 001 v4 + 002 v19 | 2026-06-09 |
| [009](./009-pi-surface-integration.md) | pi-surface-integration | ctrl-pi-bridge full Pi extension wiring (12 hooks + 6 communication APIs) | — | **retired** by 001 v4 + 002 v19 | 2026-06-09 |
| [010](./010-communication.md) | communication | Narrow waist + multiple transports; **v14 typed `InternalMsg`/`EventBus` sole production event fact; Channels/authenticated WS authorized/redacted projections only; canonical cross-domain endpoints are the three verbs; generated artifacts from descriptor/operation/event owners; Tauri IPC shell/OS/UI-only with no business dual surface** | v14 | accepted | 2026-08-05 |

## Module map → code locations

| Module | Owns | Code locations |
|---|---|---|
| spine | overall architecture, 5 primitives, anti-list | `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs` |
| substrate | ResourceRef/ResourceDescriptor/OperationRef authority, canonical three verbs, normalized FCT projection, one local discovery registry, projection/gate, provider router, crypto, subprocess, MCP bus, manifest composition | `packages/ctrl-mcp-sdk/schema/manifest-v2.schema.json` + `src-tauri/src/kernel/` + `src-tauri/src/shell/acp_client.rs` |
| frontend | one Ambient shell, Work/Library/Settings L1, descriptor-driven viewer registry, sole FCT create/find/install/remove/select UI, macOS launcher lifecycle | `packages/ctrl-web/` + `src-tauri/src/shell/{lifecycle,tray,window}.rs` + `src-tauri/src/lib.rs` |
| cap | mcp execution (MCP outward / Actor inward), updater, auto-update tiers | `src-tauri/src/kernel/actor.rs` + `src-tauri/src/commands/updater.rs` + `src-tauri/src/{lib,main}.rs` + `scripts/{release.sh,build-local-updater-channel.sh}` + `scripts/debug/updater-fault.sh` + `packages/ctrl-mcps/` |
| irisy | fixed identity, canonical session/transcript/context, FCT-to-context resolution, mission/knowledge, integration forms | `packages/ctrl-web/src/routes/irisy.tsx` + `packages/ctrl-web/src/lib/irisy-prompts.ts` + Irisy session stores + `src-tauri/src/commands/irisy_chat.rs` |
| cross-cutting | BYOK, global English, FCT product vocabulary, plain text, policy envelope, optional cloud discovery policy | reviewer-policy + `ctrl-cloud` search adapter contract; no single owner |
| workbench | deprecated canvas/discovery provenance only; no live code ownership | none — migrated authority is owned by substrate/frontend/cross-cutting |
| communication | typed production event authority, narrow waist, generated endpoint artifacts, transport projections, shell-only IPC boundary | `src-tauri/src/kernel/{channel,event,mcp_server,diagnostics,event_ws}.rs` + generated endpoint artifacts + frontend transport bindings |

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
| 022 (orig) | Workbench composition canvas (React Flow + dnd-kit) | **ADR-007 canvas provenance, retired-v3** — no live workflow-editor authority |
| 023 (orig) | Skill discovery — kernel-local first, ctrl-cloud Worker for production | **ADR-007 discovery provenance, retired-v3**; live decisions migrated to **002 §16 v81 / 003 §8.5 v40 / 006 §7 v13** |
| 024 (orig) | Substrate composition model — 6-axis manifest | **002 substrate § composition** + persona rule lifted to **005 irisy § persona** |

## Versioning

Single source of truth. Each module ADR has `version:` in frontmatter. Amendments:

1. Edit the section in place
2. Bump `version:` (v1 → v2)
3. Prepend the newest row to `changelog:` listing the change + memory/decision link
4. Update `last_updated:` to today
5. Reference new behavior in code as `(ADR-NNN <module> § <section> v<N>)`

Never create a new numbered ADR for a section amendment. New ADR ↔ new module only.
