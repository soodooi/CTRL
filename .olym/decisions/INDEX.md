<!-- ADR Index — 8 module ADRs. Single source of truth. Code MUST reference `(ADR-NNN <module> § <section> v<N>)` in comments. Amendments bump `version:` in ADR frontmatter; new ADRs only created if a new **module** appears. -->

# CTRL ADRs — module-organized, 8 active + 2 retired

| # | Module | Title | Version | Status | Last updated |
|---|---|---|---|---|---|
| [001](./001-spine.md) | spine | 4-layer kernel + 5 primitives + 4 mcp sources (ST-SS retired v9) + **2 parallel brain paths (Irisy=Hermes bundled + BYO-CLI driver projection, v9)** + Obsidian notes (v6) + **3-capability-face (MCP/API/Skills via :17873 bus)** + 6 self-evolution loops | v9 | accepted | 2026-06-25 |
| [002](./002-substrate.md) | substrate | **Hermes 是 Irisy 的脑 (§1, v28 纠正 — hermes 不退役) + BYO-CLI driver projection 附加 (§1B) + ACP future (§1.8)** · capability surface · 3-capability-face · provider router · crypto · subprocess · MCP bus (= projection gate) · composition · **§14 Unified Operation Interface (describe/query/produce; §14.13 v45 统一写侧 RecordSink + 类型化 ProduceOp — smart-table/task/calendar/docs 四源一套动词)** + **§brain v38 — Irisy 引擎泛化为可选 ACP engine (Hermes 默认 bundled / Codex / Claude Code)** + **§1.9 v46 Notes 全原生替代 — Obsidian connector 退役 (曾 16 工具, 已删), Tolaria-parity 功能面 + LRA 参考端点 E1-E13, governing `notes-module-replacement-plan.md`** | v46 | accepted | 2026-07-02 |
| [003](./003-frontend.md) | frontend | Single PWA + **Ambient morphing home (§8 SHIPPED)** + Sidebar L1; Notes = inline viewer + open-in-Obsidian (v9); **§6 smart-table → intelligent table (multi-view + AI field shortcuts + soft links, benchmarked vs Feishu Bitable, v10); §6.5 Irisy operation surface (`smart_table.*` gate tools, validated-string params + schema-resource semantic layer; AI column = async job triple + 100-row cost gate + merge-by-row write-back, benchmarked vs Dify/Coze/ChatBI/Airtable + MCP SEP-1686, v13); §6.5 reframed as first impl of ADR-002 §14 Unified Operation Interface (v14); §14 first vertical SHIPPED — kernel query engine + smart-table describe/query/produce gate tools, describe=tool not resource (v15); §14 FULL build shipped + reviewed PASS — 4 RecordSources (smart-table/KB/registry/providers) on one shared engine + AI-column async job, as-built reconcile of the §6.5.4 locks (v16); §6.5.4 closes bounded-concurrency + AuthFailed-stop (v17) + merge-by-snapshot row identity (v18); §6.2 view-state read/write loop closed + frontend views persistence (v19)**; **v21 Notes = 薄 KB 层(废 GraphView/CommandPalette 克隆,留树/搜索/反链 + auto-save + 文件夹管理 + 折叠树;修「每个笔记开成智能表格」)+ vault 根用户可配置(原生选择器指向自己的 Obsidian vault,默认仅 fallback)+ 同步=组合(git 助手 + Auto-sync;mesh 留 v1.1+ 仅 CTRL 自有态),事实源 `notes-module-plan.md`** | v22 | accepted | 2026-06-25 |
| [004](./004-cap.md) | cap | Mcp execution model + Tauri updater + 4-layer × 3-tier auto-update (**Layer 2 = external-agent tier, ACP probe + L3, §3 v2**) + **§1 OS sandbox on pack shell DRIFT closed (macOS sandbox-exec, v3)** | v3 | accepted | 2026-06-26 |
| [005](./005-irisy.md) | irisy | **PWA persona shell** + sycophancy filter + system-prompt injection + drill-down; **v11 数字员工 operator** (§8 terminal-essence dialog + §9 mission + knowledge system) | v11 | accepted | 2026-06-29 |
| [006](./006-cross-cutting.md) | cross-cutting | **BYOK aggregator-first** + global English first + plain-text philosophy + policy envelope | v9 | accepted | 2026-06-25 |
| [007](./007-workbench.md) | workbench | Mcp-composition canvas (React Flow + dnd-kit) + Irisy-led skill discovery | v1 | accepted | 2026-05-31 |
| [008](./008-irisy-assistant.md) | irisy-assistant | Irisy reply specs / user intents / Irisy capabilities / Irisy pipeline | — | **retired** by 001 v4 + 002 v19 | 2026-06-09 |
| [009](./009-pi-surface-integration.md) | pi-surface-integration | ctrl-pi-bridge full Pi extension wiring (12 hooks + 6 communication APIs) | — | **retired** by 001 v4 + 002 v19 | 2026-06-09 |
| [010](./010-communication.md) | communication | **统一窄腰 (§14 契约 + :17873 治理 + MCP 插件协议) over 多元传输** — 质疑「一个框架统吃」(narrow-waist / CORBA·SOAP·ESB 教训);8 条缝传输选型;subscribe = query{watch};内外协议哲学分离;coding 降为第⑦外部缝 (ACP)。**v3 两信任域** (内核域 vs 跨域,gate 仅守跨域)。**v4 批判四点 D/E/G/H**。**v5 实装对齐 + ST-SS 弃用**:两信任域重构 SC1-3 已落地 (audit ledger + caller 细分 + intent 可见性裁剪 + projector stamp);ST-SS 弃用→Tauri Channels+WS (SC6);远程桌面转独立能力模块 (对标 ToDesk/RustDesk);protobuf 仅 scope 跨设备腿。**v6 端点 spec 形式化**:wire 标准点名 (工具=MCP JSON Schema / 流=AsyncAPI / 跨设备=protobuf),权威端点 spec=MCP tools/list schema 导出 artifact (不爬源),不自造 IDL;标准~90%/自创~10% (只 §14 SSOT + gate 治理)。**v7 实装对齐**:两信任域重构 SC1/3/5/6 全量落地 — SC1 `InternalMsg` 正类型 + EventBus 类型化边界 (编译期两域隔离,不再仅运行时 tag);SC3 关「无 intent=全工具」默认敞口 (按 caller 默认 scope);SC5 SOUL/提示词收敛 gate + 修 vault_write content→body 写 bug;SC6 ST-SS 降 plain CBOR-over-WS + 退死命令。通讯总纲,实现真相引 001/002/003 | v9 | accepted | 2026-06-26 |

## Module map → code locations

| Module | Owns | Code locations |
|---|---|---|
| spine | overall architecture, 5 primitives, anti-list | `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs` |
| substrate | agent installer + launcher, capability surface, provider router (including fal.ai API face), crypto, subprocess, MCP bus, manifest composition, Notes folder MCP exposure | `src-tauri/src/kernel/` (provider/, mcp_server.rs, mcp_host.rs, subprocess_actor.rs, notes.rs, notes_index.rs) + `src-tauri/src/commands/{vault,agents,image}.rs` + `src-tauri/src/shell/{agent_installer,agent_launcher}.rs` |
| frontend | PWA shell, L1 nav, Keyboard, vault browser, viewers | `packages/ctrl-web/` |
| cap | mcp execution (MCP outward / Actor inward), updater, auto-update tiers | `src-tauri/src/kernel/actor.rs` + `scripts/release.sh` + `packages/ctrl-mcps/` |
| irisy | 8-stage UX, remote co-view primitives, persona prompts | `packages/ctrl-web/src/routes/irisy.tsx` + `packages/ctrl-web/src/lib/irisy-prompts.ts` |
| cross-cutting | BYOK, global English, plain-text philosophy (vim-test gate) | reviewer-policy, no single owner |
| workbench | composition canvas, skill discovery | `packages/ctrl-web/src/routes/workbench.tsx` (Phase 1) + `src-tauri/src/commands/skills.rs` (Phase 1) + future `soodooi/ctrl-cloud` Worker (Phase 2) |
| communication | 通讯总纲:窄腰(契约/治理/插件)+ 8 缝传输选型 + 内外哲学(cross-cutting,实现真相引用 001 §primitives / 002 §14·§mcp-bus·§crypto / 003 §6.5) | cross-cutting (no single owner; spans `src-tauri/src/kernel/{channel,event,mcp_server}.rs` + `kernel/query*.rs` + `packages/ctrl-web/src/lib/kernel.ts` + ST-SS) |

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
3. Append a row to `changelog:` listing the change + memory/decision link
4. Update `last_updated:` to today
5. Reference new behavior in code as `(ADR-NNN <module> § <section> v<N>)`

Never create a new numbered ADR for a section amendment. New ADR ↔ new module only.
