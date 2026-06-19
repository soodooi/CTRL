---
adr_id: 001
module: spine
title: CTRL spine — 4-layer kernel + 5 primitives + 5 mcp sources + BYO-CLI driver platform + 3-capability-face + 6 self-evolution loops
version: 8
status: accepted
last_updated: 2026-06-18
deciders: [bao, zeus]
sections:
  - { id: layers,         source: orig-001-§3 }
  - { id: primitives,     source: orig-001-§1.2 }
  - { id: sources,        source: orig-001-§1.3 }
  - { id: aggregator,     source: H-2026-06-09-002 conversation, retired-v7 (RETRACTED: superseded by BYO-CLI driver platform) }
  - { id: invariants,     source: orig-001-§4 }
  - { id: philosophy,     source: orig-001-§6 }
  - { id: self-evolution, source: brainstorm system-self-evolution-2026-06-04 }
changelog:
  - v8 2026-06-18: **§1 + §4 + §5 brain 层纠正 — Hermes 是 Irisy 的脑 (不退役); BYO-CLI driver 是「附加」并行路径, 不是替代 (bao 实查运行真相后钦定, pairs ADR-002 v28).** v7 把 brain 写成「hermes / opencode / Pi all retired, BYO-CLI driver only」——**就 hermes 而言写过头了**. 运行真相: **Irisy (CTRL app 内助手) 的 brain = Hermes Agent** (NousResearch) — CTRL 确实 **bundle + lazy-install + 启动** hermes (dashboard `:17890`, Irisy 嵌入), **hermes 不退役**. **BYO-CLI driver / projection (v7 §4 + ADR-002 § projection) 仍然成立, 但定位为「附加并行路径」**: 用户自带 CLI (Claude Code) 经投影的 `.mcp.json` 也能驱动 CTRL 工具 (已落地 `kernel/projector.rs` + 真机验证), 与 Hermes-Irisy 并存, 两条路都经 `:17873` gate. **Pi 仍退役** (v4/ADR-002 v19, 不变). opencode 未接线 (保留). ACP 仍降级为 future channel (不绑 hermes, v7 不变). Notes = Obsidian (v6, Local REST API MCP 已连 16 工具, 不变). Updates §1 layer diagram brain 行, §4 CLI driver block + §4.2, §5 invariant #11. 真相源 `vault/ctrl/architecture-byo-cli-driver.md` 顶部 2026-06-18 纠正块 governing. No primitive / face / self-evolution / plain-text change.
  - v7 2026-06-17: **§4 3-agent aggregator → BYO-CLI driver platform amendment (bao 2026-06-17 钦定换代).** RETRACTS the v4–v6 内置-brain aggregator: kernel no longer lazy-installs / launches / supervises any bundled brain — **hermes / opencode / Pi all retired** (Pi-centric was already retired pre-v4). New定位: **CTRL = BYO-CLI driver platform** — the user picks their own local strong CLI (Claude Code 等) as the resident general-purpose driver/engine; CTRL = a **projection** platform that materializes local tools / skills / memory / workflows into the CLI's native形态 (`.mcp.json` / skills dir / `CLAUDE.md` (AGENTS.md) / slash commands) + an **MCP gate** (kernel `:17873` = permission / audit / visibility) + (v1.1) a **share & be shared** network. Locks: (1) driver = user-chosen CLI; CTRL ships/supervises no brain. (2) Access = **projection** (materialize to native config), NOT supervise — manifest optional `target:` override, else auto-route by type. (3) Two triggers share one projection: passive (user runs `claude` → CLI auto-discovers, zero-intrusion, satisfies vim-test) + active (Ctrl-summoned ephemeral workspace launches the CLI). (4) Scheduling权 stays in the CLI model; CTRL only "makes the CLI see" + "routes calls back to `:17873` = kernel gate" (satisfies one-shot / AI-is-pipe). (5) Intent-scoped projection (don't blast full context), v1. (6) Multi-driver允许; v1 single resident + switchable (low priority). (7) Share network = killer / commercial core, v1.1; v1 = single-machine local arsenal + reserved share interface. **ACP NOT deleted — demoted to future "ACP-aware CLI enhancement channel".** Notes = Obsidian (§1.9, v6, unchanged). Updates §1 layer diagram, §4 5-block + bullets, §4.1 wiring clause, §4.2 friend-product table, §5 invariants #9/#11. No primitive / face / self-evolution / plain-text change.
  - v6 2026-06-17: **Notes/KB = Obsidian, kairo/SilverBullet retired (bao 2026-06-17 "用 obsidian 不要重复造轮子"; pairs ADR-002 v24).** CTRL bundles no notes editor — Obsidian (user's own) is the PKM editor over `~/Documents/CTRL/Notes/`; data access stays editor-independent on the kernel notes-MCP bus :17873 (+ optional Obsidian Local-REST-API MCP). Updates §1 layer diagram, §4 ui-ux 5-chip + kairo bullet, §5 invariants #2 + #12. Two locked-principle tensions reconciled in ADR-002 v24 (single-entry exception for notes-editing; Obsidian is preferred-editor + optional-connector, NOT a hard dependency — pull it and the plain-md + notes-MCP remain). No primitive/face change.
  - v5 2026-06-17: **§4.1 amendment — how agents reach the 3 faces (pairs ADR-002 §1.8 v23, zeus drill + bao Q&A).** Adds the wiring clause: all 3 capability faces converge on the MCP bus :17873 (API exposed as MCP tools; Skills as MCP tools / loadable dir); a `target:brain` agent (hermes / any ACP agent) consumes them via **ACP MCP passthrough** (CTRL = ACP client, agent MCP client points only at :17873 = kernel gate + visibility preserved); "apps"/OAuth = MCP sources, not a 4th face; user KB (kairo + Notes-MCP) is a face consumer, not the brain channel. No face/primitive change — clarifies the consumption path only.
  - v4 2026-06-09: **§4 dual-brain supervisor → 3-agent aggregator amendment (H-2026-06-09-002).** bao framing校准 (2026-06-09 conversation): "Irisy 是表象", "hermes opencode kairo 都是外部的", "现在重要的是前端". Dual-brain supervisor model (v3) RETRACTED — kernel no longer spawns/supervises brains. Replaced by **3-agent aggregator**: kernel lazy-installs + launches external agents (hermes / opencode / kairo), PWA consumes their native endpoints directly. Locks: (1) **CTRL = OS-level ambient aggregator** — not a single-purpose chat/coding/PKM app; the 4 friend products (Claude Desktop, Codex, WorkBuddy, CodeBuddy) are single-vertical, CTRL横切聚合. (2) **3-capability-face SSOT** — MCP (protocol), API (provider router, e.g. fal.ai 985 endpoints), Skills (markdown SKILL.md). 三面互补不塌缩, supersedes 2026-06-05 `decision_keycap_collapses_to_mcp_meta_ux_layer` over-simplification. (3) **3 external agents** — hermes (NousResearch, assistant) / opencode (coding) / kairo (notes/PKM, MIT). All lazy-installed to `~/.ctrl/agents/`. Kernel doesn't supervise — launch-on-demand, PWA owns retry. (4) **Irisy = PWA persona**, not brain. ADR-005 amend. (5) **No "vault" word inside CTRL** — call it "Notes". kairo owns the editor; CTRL exposes `~/Documents/CTRL/Notes/` as MCP server to hermes. (6) **fal.ai as flagship API provider** — Codex 接 gpt-image-2 锁单家; CTRL 接 fal.ai 拿 985 模型. Retired: ADR-002 §1 supervisor model (v18 → v19), ADR-002 §8 vault stack lock (Tiptap+CodeMirror+FTS5 → kairo). PR target: this branch.
  - v3 2026-06-09: **§4 Pi-centric → dual-brain architecture amendment (H-2026-06-09-001, PR #84).** RETRACTED by v4 (3-agent aggregator). Kept in changelog for provenance only.
  - v2 2026-06-04: add §8 self-evolution v1 — 6 parallel loops × 6 stages (Detect/Diagnose/Plan/Execute/Verify/Learn) governing how CTRL improves itself across Irisy chat, provider routing, cap curation, notes index, system self-healing, and cross-user MCP/SKILL recommendation. Locks Typed ISA + microkernel validation + audit ledger + policy envelope + vim-test as the 5 cross-loop invariants. Per bao "整个系统都要自我升级成长" + "经常整理 ADR".
  - v1 2026-05-31: module reorg — merged from numbered ADR-001 (4-layer + 5 primitives + 5 sources + Pi-centric reframe + 10 invariants + design philosophy locks). 21 numbered ADRs collapsed into 7 module ADRs; this is the spine.
related:
  - .olym/decisions/002-substrate.md
  - .olym/decisions/003-frontend.md
  - .olym/decisions/005-irisy.md
  - .olym/decisions/006-cross-cutting.md
  - .olym/brainstorm/system-self-evolution-2026-06-04.md
---

> **Spine — immutable**. New session reads §1. All module-specific detail in module ADR (see `.olym/decisions/INDEX.md`).

## §1 Layers — 4-layer stack (physical topology)

```
L3 Userland — subprocess-isolated mcps via MCP
              + user's own CLI driver (Claude Code 等) — CTRL projects assets to it,
                does NOT bundle / lazy-install / supervise any brain (v7; notes = user's Obsidian, v24)
       ↑↓
L2 SDK — @ctrl/{kernel-sdk, stss, memory, mcp-sdk}
       ↑↓
L1 CTRL Kernel — Rust microkernel (thin: project + gate, NOT supervise the driver)
                 5 primitives + mcp_host (out) + mcp_server :17873 (in = the gate)
                 + ST-SS WS :17872 + notes_index (SQLite FTS5, optional — Obsidian owns primary)
                 + provider sub-system (ADR-002 § provider — fal.ai + Anthropic + OpenAI + Hunyuan + DeepSeek BYOK)
                 + projector (materialize tools→mcp config / skills→SKILL.md / memory→CLAUDE.md / workflows→slash commands)
       ↑↓
L0 Tauri 2 Native Shell — ~500 LOC Rust
                          (hotkey / tray / window / keychain / kernel_supervisor)
       ↑↓ embeds WebView2 / WKWebView
PWA — single web codebase (Tauri WebView desktop + browser mobile)
       ↑↓ Ctrl-summoned ephemeral workspace launches the CLI driver; calls flow back to :17873 gate
CLI driver — user's own resident CLI (Claude Code 等) · auto-discovers projected assets on launch (BYO-CLI path)
brain — 2 parallel paths (v8): (1) Irisy brain = Hermes Agent (CTRL bundles + launches, dashboard :17890) (2) BYO-CLI driver above. Pi retired (v4). · Obsidian = notes/KB editor (user's own, v24)
```

## §2 Primitives — 5 (`src-tauri/src/kernel/`)

| Primitive | File | Role |
|---|---|---|
| Actor | `actor.rs` · `subprocess_actor.rs` | subprocess-isolated runtime unit |
| Capability | `capability.rs` · `capability_resolver.rs` | typed kernel↔userland surface |
| Channel | `channel.rs` | bidi message stream |
| Event | `event.rs` | pub/sub bus |
| Effect | `effect.rs` | controlled side-effect proxy |

## §3 Mcp sources — 5

1. **MCP servers** (10k+ Day-1, via `mcp_host.rs`)
2. **Big-platform OAuth** (Feishu / Notion / Linear / Slack / …)
3. **Local agents** (subprocess + portable-pty, ADR-002 § subprocess)
4. **ST-SS shared windows** (long-tail desktop + hardware, `stss_bridge.rs`)
5. **Builtin** (`packages/ctrl-mcps/` ships with app)

## §4 BYO-CLI driver 5-block view (logical, co-exists with §1)

> **Evolution**: Pi-centric (retired pre-v4) → 3-agent aggregator hermes/opencode/kairo (v4–v6, **RETRACTED**) → **BYO-CLI driver platform (v7)** → **v8 纠正: 2 parallel brain paths**. CTRL is a **projection + gate** layer. **(v8, governing)**: 两条 brain 路并存 — (1) **Irisy brain = Hermes Agent** (CTRL bundles + launches, dashboard `:17890`); (2) **BYO-CLI driver** (this §4, user's own CLI via projection). v7's "hermes retired" was an overstatement — hermes is NOT retired, it powers Irisy. Both paths gate at `:17873`.

```
              ┌──────────────────────────────────────────────────────┐
USER ↔ PWA ↔ │ KERNEL (thin: project · gate :17873 · keychain · MCP) │ ↔ { provider · MCP · skills · memory · workflows }
              └──────────────────────────────────────────────────────┘
                                        │ projection (materialize to native CLI config)
                                        ↓
                              ┌─────────────────────┐
                              │  user's CLI driver  │   ← Claude Code 等, user-chosen, resident
                              │  (general-purpose)  │      auto-discovers projected assets on launch
                              └─────────────────────┘
                                        │ every tool call flows back to :17873 = kernel gate
                                        ↓
                              { permission · audit · visibility }
```

- **ui-ux** — PWA, single React 18 + Vite 5 + TanStack codebase (ADR-003). 5 L1 chips: Irisy (persona shell) / Mcp pool / Notes (inline viewer + open-in-Obsidian, v24) / Skills / Driver (the CLI session surface, v7 — was Coding/Assistant chips for opencode/hermes).
- **KERNEL** — Rust microkernel, **极薄** (ADR-002 v19+, v7):
  - `projector` — materialize local assets to the CLI's native形态 on a per-intent subset (v7, §4.1): tools → MCP entry in the CLI's `.mcp.json` (mounted on bus `:17873`); skills → `SKILL.md` copied into the CLI's skills dir; memory → derived `CLAUDE.md` / `AGENTS.md`; user-triggered workflows → slash command. Manifest optional `target:` override; else auto-route by asset type.
  - `mcp_server :17873` (ADR-002 § mcp-bus) — **the gate**: exposes Notes folder + clipboard + OCR + provider router to the driver as MCP tools; every call routes back here for permission / audit / visibility. CTRL does **not** supervise the driver's decisions.
  - `provider/` — fal.ai + Anthropic + OpenAI + Hunyuan + DeepSeek + Volc (BYOK) adapters; routes `image.generate` / `video.generate` / `text.chat` (ADR-002 § provider), exposed to the driver as MCP tools.
  - `keychain` — unified credential vault; the driver reads via env-injected token at launch (no per-driver config proliferation).
- **CLI driver** ★ — the user's **own** resident strong CLI (Claude Code 等). For the BYO-CLI path CTRL ships / lazy-installs / supervises **no** brain — it only projects assets. (v8: the OTHER path, Irisy, IS powered by CTRL-bundled **Hermes Agent**; Pi remains retired (v4). hermes is not retired — see §4 header.) Two triggers share one projection: **passive** (user runs `claude` themselves → CLI auto-discovers projected assets, zero-intrusion, satisfies vim-test) + **active** (Ctrl-summoned ephemeral workspace launches the CLI). Scheduling/decision权 stays in the CLI model.
- **Notes/KB = Obsidian** (v24, ADR-002 — kairo/SilverBullet bundling retired) — the user's own Obsidian is the PKM editor over `~/Documents/CTRL/Notes/`; CTRL bundles NO editor (don't reinvent the wheel, bao 2026-06-17). Data access is editor-independent: the driver reads/writes via kernel notes-MCP `:17873` + optional Obsidian Local-REST-API MCP. PWA `/notes` = inline md viewer + "open in Obsidian".
- **provider** — LLM/image/video API adapters; **fal.ai is flagship** (985 endpoints, FLUX 2 / Seedream / Recraft / Nano Banana Pro / Kling 3.0 / Veo 3.1 / Hunyuan Video). Codex 锁单家 gpt-image-2, CTRL 拿 985 模型聚合.
- **MCP** — tools the driver invokes via MCP (ADR-004). CTRL kernel itself is an MCP server (in, the gate) AND host (out).
- **Skills** — markdown `SKILL.md` (Claude Code Skills schema). `~/.ctrl/skills/<id>/`. Projected into the driver's skills dir; portable across any BYO driver.

Two views are not mutually exclusive: §1 = process / binary boundary; §4 = projection role per ambient session. (v1.1 adds a **share & be shared** network over this arsenal — see v7 changelog item 8; v1 reserves the interface only.)

### §4.1 3-capability-face SSOT

CTRL has **three** capability faces,互补不塌缩:

| Face | Protocol | Wire-in | Wire-out | Example |
|---|---|---|---|---|
| **MCP** | Model Context Protocol stdio / Streamable HTTP | `mcp_server.rs :17873` | `mcp_host.rs` | clipboard / OCR / Notes.search / Figma MCP |
| **API** | REST / WebSocket / SDK | `provider/router.rs` | `provider/adapter/*.rs` | fal.ai (985 endpoints) / Anthropic / OpenAI / Hunyuan / DeepSeek |
| **Skills** | markdown `SKILL.md` + script | `~/.ctrl/skills/<id>/` | projected into driver's skills dir | `$imagegen` / `$refactor` / `$summarize` |

**Friend-product gap**: Claude Desktop + Codex + WorkBuddy + CodeBuddy all support MCP + Skills; API face is locked to their single brand (OpenAI / Anthropic / Tencent Yuanbao / Hunyuan). **CTRL's API face is the differentiator** — aggregator (fal.ai 985 image/video/audio models, plus任意 LLM BYOK).

**How the driver reaches the 3 faces** (v7 projection, supersedes v5 ACP passthrough): CTRL **materializes** each face into the CLI driver's **native config** so the driver self-discovers them on launch — no special protocol required:
- **MCP** → the projector writes an entry for the kernel gate `:17873` into the driver's `.mcp.json`. The driver's MCP client points **only** at `:17873`, never an external server directly; every tool call routes back through the gate (permission / audit / visibility).
- **API** → exposed AS MCP tools on `:17873` (`image.generate` etc.), so it rides the same `.mcp.json` entry.
- **Skills** → `SKILL.md` materialized into the driver's skills dir.
- **memory** → derived `CLAUDE.md` / `AGENTS.md`; **user-triggered workflows** → slash command in the driver's commands dir.

Projection is **intent-scoped** (project the relevant subset, don't blast full context — v1). "apps" (Feishu / Notion / OAuth / OPC connectors / ST-SS) are MCP **sources** (§3), not a 4th face. Notes (Obsidian + Notes-MCP) is a face consumer, not the driver itself. **ACP is not deleted — demoted to a future "ACP-aware CLI enhancement channel"**: an ACP-speaking driver may get richer live wiring, but the default + baseline is config projection (above), which works with any BYO CLI and satisfies the vim-test.

### §4.2 What CTRL is NOT vs friend products

| Friend product | What it is | What CTRL is NOT |
|---|---|---|
| Claude Desktop | Anthropic chat client | CTRL is not single-brand chat |
| Codex CLI / Desktop | OpenAI coding agent | CTRL is not a brain — it's the projection platform the user points their own CLI driver (Codex / Claude Code 等) at |
| WorkBuddy (Tencent) | Workplace automation agent | CTRL is not enterprise-IM glue |
| CodeBuddy (Tencent) | AI IDE for Yuanbao/DeepSeek | CTRL is not an IDE |
| Obsidian | Markdown PKM | CTRL doesn't ship its own editor — the user's Obsidian is it (v24); CTRL renders notes inline + opens Obsidian for editing |
| OpenRouter | LLM router | CTRL is not just routing — also ambient + workspace + skill substrate |

**CTRL = OS-level ambient BYO-CLI driver platform** (v7) — 4 friend products are single-vertical brains; CTRL横切, projecting the local arsenal (tools / skills / memory / workflows) into the user's **own** chosen CLI driver via `Ctrl` hotkey + ephemeral workspace, gated at `:17873`. (v1.1: + share & be shared network.)

## §5 Filesystem invariants (12 — ship-after immutable)

1. One mcp = one directory `~/.ctrl/mcps/<id>/`. `rm -rf` fully uninstalls.
2. Notes folder = `~/Documents/CTRL/Notes/` (the user's Obsidian vault target, v24; markdown + frontmatter; Obsidian / vim / VMark compatible). Was "vault" pre-v4 — renamed because bao "我没有 vault 这个概念" (2026-06-09).
3. `~/.ctrl/state/` is derivative (event-log / notes-index / cache). Out of backup scope.
4. Prompts are markdown (vim-editable, git-diffable, agentskills.io standard).
5. Secrets → macOS Keychain. `~/.ctrl/config.toml` non-sensitive only.
6. Manifest = YAML/TOML frontmatter. Zod-validated, plain text.
7. Mobile = IndexedDB queue + LRU evict + soft quota.
8. Backup source = `~/Documents/CTRL/Notes/` + `~/.ctrl/{mcps,agents,skills,config.toml,mesh/identity}`.
9. Skills truth model — `~/.ctrl/skills/<id>/SKILL.md` is SSOT (Claude Code Skills schema). Skills are **projected** into the user's CLI-driver skills dir (v7 — portable across any BYO driver; was "cross-agent invoke" pre-v7). Was "`~/.ctrl/mcps/<id>/skills/`" pre-v4 — uplifted to top-level because Skills is now a peer capability face (§4.1).
10. v1.0 mcp runtime = `.ts` / `.js` only. Python / Rust deferred.
11. **Brain = 2 parallel paths (v8 纠正; RETRACTS v7's blanket "no CTRL-bundled brain").** (a) **Irisy path** — CTRL **does** bundle + lazy-install + launch **Hermes Agent** as Irisy's brain (dashboard `:17890`); hermes is NOT retired. (b) **BYO-CLI path** — the driver is the user's **own** local CLI (Claude Code 等), which CTRL does NOT install or supervise; CTRL only **projects** assets into its native config (tools → `.mcp.json` pointing at gate `:17873`; skills → driver skills dir; memory → `CLAUDE.md`/`AGENTS.md`; workflows → slash command). Both paths gate at `:17873`. Projection targets are user-visible plain text (git-diffable, vim-editable). Pi remains retired (no `~/.ctrl/pi/`, v4). The v4 `~/.ctrl/agents/<name>/` 3-agent (opencode/kairo) lazy-install stays retired — only hermes-for-Irisy is bundled. ACP demoted to future enhancement channel (§4.1).
12. **No CTRL-owned vault editor / index** (v24: don't reinvent the wheel — bao 2026-06-17). The user's **Obsidian** owns notes editing + wiki-link + backlink + graph + plugins; CTRL bundles no editor (kairo/SilverBullet retired). CTRL kernel exposes `~/Documents/CTRL/Notes/` via MCP `:17873` for agent consumption (editor-independent) + keeps a LIGHT inline md viewer for read/preview. `notes_index.rs` is OPTIONAL (MCP-server convenience; an optional Obsidian Local-REST-API MCP adds richer graph ops).

## §6 Design philosophy locks

1. **Subprocess + Tauri ACL > WASM** — Tauri Capability + Isolation + CSP, no double-sandbox.
2. **Kernel atomic, composition in brain/skill** — one-shot per kernel call.
3. **MCP is the tool wire** — inbound (kernel-as-MCP-server) + outbound (kernel-as-MCP-host).
4. **Lean kernel** — only what v1 uses; v1.x WASM target = WasmEdge if ever needed.

## §7 Anti-list (what CTRL is NOT)

Workflow editor (Coze/n8n own that) · 自己造硬件 · 100+ 长尾 platform adapter · Quicker 8000 clone · ChatGPT GPTs 接入 · 多 tenant SaaS · AI chat app (workbench framing).

## §8 Self-evolution — 6 parallel loops × 6 stages v1

bao 2026-06-04: **整个 CTRL 系统都要自我升级成长**, 不仅是 Irisy LLM. CTRL self-evolution = **6 闭环并行**, 每个走相同 6 阶段管道. Detail brainstorm: `system-self-evolution-2026-06-04.md`.

### §8.1 The 6 loops

| # | Loop | Scope |
|---|---|---|
| 1 | **Irisy chat reflection** | LLM behavior tuning via failure-signal detect → sleep-time subagent reflect → playbook inject (Letta-code mode) |
| 2 | **Provider routing self-tuning** | per-provider trust score + per-action telemetry (extends v3 byok-first cooldown, Nova AI Ops) |
| 3 | **Cap curation** | usage telemetry → cap rating / recommend / uninstall proposal (Voyager skill library) |
| 4 | **Vault index optimization** | search query log + click-through → re-rank embeddings / auto-alias (Mem0 consolidate) |
| 5 | **System self-healing** | kernel/Pi error → Pi diagnostic agent → typed remediation + verify + rollback (ReCiSt 4-layer) |
| 6 | **Cross-user MCP/SKILL recommendation** | opt-in cross-user usage aggregation → recommendation (v1.x scope, privacy-preserving) |

### §8.2 The 6 stages (cross-loop invariant)

Every loop, regardless of scope, executes the same 6 stages:

```
1. Detect       0-cost rule-based signal recognition (no LLM, no latency)
2. Diagnose     LLM causal hypothesis (on-demand, NOT per-turn / per-event)
3. Plan         Typed ISA action (NOT raw commands; arxiv 2604.09963: -95% harm)
4. Execute      Microkernel-validated + policy-envelope-gated + transactional
5. Verify       Did the signal actually recover? (skip = "auto-fix loops forever")
6. Learn        Consolidate to markdown playbook + SQLite audit ledger + Pi prompt
```

### §8.3 5 cross-loop invariants (locked)

1. **Typed ISA** — every Plan output is a typed `SelfEvolutionAction` variant; agents cannot express raw shell / DB / fs writes. Naturally extends ADR-001 §2 primitives (Effect type) to self-improvement actions. arxiv 2604.09963 evidence: -95% agent-caused harm (77% → 4%).
2. **Microkernel validation** — the CTRL kernel itself validates every typed action against capability scope + blast-radius limit + autonomy level. Reuses `capability_resolver.rs` (ADR-002 § primitives).
3. **Audit ledger** — every self-evolution event (detect → learn) writes an immutable row in `persistence.rs` SQLite event store (ADR-002 § audit-ledger v1, ship 2026-06-04). Replay-able, queryable.
4. **Policy envelope + autonomy L3/L4/L5** — UUMit autonomy ladder (cap-design-v2 §14 #8) becomes the cross-loop default: L3 = suggest-only, L4 = low-risk auto + high-risk suggest, L5 = full auto within envelope. ADR-006 cross-cutting § policy-envelope v1.
5. **vim test守住** — every learnable artifact lands in `vault/.irisy-memory/*.md` + `vault/.ctrl/*.yaml`. Markdown + YAML, user-readable, user-editable. No black-box vector stores.

### §8.4 Rollout — Crawl / Walk / Run (risk-layered, not time-phased)

bao `feedback_no_planning_no_phasing` lock: this is **risk layering**, not v1 / v1.x phase delivery. Single branch, accumulating commits.

- **Crawl (suggest-only)**: All loops emit detect signals to audit ledger; no auto-act. Settings → 自我升级 tab surfaces "what CTRL would have done". Loops 1 (Irisy detect) + 5 (audit ledger schema) ship first — Loop 5 is the substrate every other Learn stage writes to.
- **Walk (low-risk auto)**: Loops 1 (reflect + improve) + 2 (provider trust score) + 3 (cap rating) + 4 (vault alias) auto-execute; verify mandatory; auto-rollback on verify-fail.
- **Run (full auto, deferred)**: Loops 5 (Pi restart, kernel recover) + 6 (cross-user telemetry, opt-in) ship after audit ledger has weeks of evidence and Memory-R1-style RL fine-tune signal.

### §8.5 Sequencing

```
Loop 5 audit ledger schema  ← substrate, ships first
        │
        ├── Loop 1 (Irisy reflect)        ← parallel
        ├── Loop 2 (provider trust)       ← parallel
        │
        ├── Loop 3 (cap curation)         ← depends on Loop 5 schema
        ├── Loop 4 (vault index)          ← depends on Loop 5 schema
        │
        └── Loop 6 (cross-user)           ← deferred, needs opt-in telemetry + ctrl-cloud aggregator
```

### §8.6 Acceptance

- [ ] 6-loop architecture documented in brainstorm `system-self-evolution-2026-06-04.md`.
- [ ] Typed ISA enum `SelfEvolutionAction` lands in `kernel/self_evolution/isa.rs` (ADR-002 § typed-isa v1 amend, P1).
- [ ] Audit ledger schema lands in `persistence.rs` (ADR-002 § audit-ledger v1 amend, P0).
- [ ] Policy envelope L3/L4/L5 lands cross-loop (ADR-006 § policy-envelope v1 amend, P0).
- [ ] Loop 1 detect + Loop 5 audit ledger ship as Crawl-phase MVP.
- [ ] Per-loop §3 detail amends arrive in their owning ADRs (1 → ADR-005 §5, 2 → ADR-002 § provider amend, 3 → ADR-007 § cap-curation, 4 → ADR-002 § vault amend, 5 → new section or ADR-002 § self-healing, 6 → ADR-006 § telemetry).

## Acceptance

- [x] 5 primitive Rust modules in `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs`. Verified.
- [x] 5 mcp source types documented. Verified.
- [x] Repo topology — single deliverable repo + ctrl-cloud separate. Verified.
- [~] **Dual-brain supervisor (v3) — RETIRED in v4.** `opencode_supervisor.rs` / `hermes_supervisor.rs` / `brain_supervisor.rs` deletion in flight (this branch). Replaced by `agent_installer.rs` + `agent_launcher.rs` (no supervise).
- [~] **Vault stack lock (Tiptap + CodeMirror 6 + mermaid.js + FTS5) — RETIRED in v4.** Replaced by kairo external dependency. `notes_index.rs` (FTS5) kept as optional MCP convenience.
- [~] **3-agent aggregator (v4–v6) — RETIRED in v7.** `agent_installer.rs` / `agent_launcher.rs` and `~/.ctrl/agents/{hermes,opencode,kairo}/` deletion in flight (this branch). Replaced by `projector` (materialize to BYO CLI driver native config) — no install / launch / supervise of any brain.
- [~] **BYO-CLI driver projection** — `projector` materializes tools → `.mcp.json` (gate `:17873`) / skills → driver skills dir / memory → `CLAUDE.md`+`AGENTS.md` / workflows → slash command, intent-scoped. **Slice 1 LANDED**: `kernel/projector.rs` writes a **project-scoped `.mcp.json`** (`~/Documents/CTRL/.mcp.json`) with the `ctrl-kernel` HTTP gate entry, wired at boot in `kernel_supervisor.rs` (fresh per-boot token, preserves user servers, idempotent, atomic; 5 unit tests green). **Path corrected (verified)**: `~/.claude/.mcp.json` is NOT read by Claude Code — project-scoped file or `claude mcp add --scope user`. Remaining: real-boot verification (file written + CLI discovers gate); skills/memory/workflow projection slices; user-scope passive path. PWA 5-chip L1 (Irisy / Mcp pool / Notes / Skills / Driver).
- [ ] **3-capability-face SSOT** — MCP face (already shipped) + API face (fal.ai adapter pending) + Skills face (`~/.ctrl/skills/<id>/SKILL.md` schema lift pending). Pending verification this branch.
- [ ] **fal.ai BYOK adapter** — `src-tauri/src/kernel/provider/adapter/api/fal_ai.rs` + provider-templates.json entry + `$imagegen` skill defaulting to FLUX 2 Pro. Pending this branch.
- [x] Lean kernel — wasmtime / cranelift / sandbox.rs / composition.rs removed. Verified.
- [x] Kernel-as-MCP-server @ :17873 (ADR-002 § mcp-bus). Verified.
- [x] Provider router shipped v0.1.126 (ADR-002 § provider v1). Verified 2026-05-31.

## Provenance

Original ADR-001 v1.x (2026-05-11 → 2026-05-30) — 4-layer architecture + 5 primitives + 5 sources + 6 校准 narrative. v3 (2026-06-09 morning, PR #84) shipped dual-brain supervisor model, **retracted same day** by v4 after bao framing校准. Full校准 history preserved in git log; this v4 keeps the load-bearing decisions only.
