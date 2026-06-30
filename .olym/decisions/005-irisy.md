---
adr_id: 005
module: irisy
title: CTRL Irisy — PWA persona shell + sycophancy filter + system-prompt injection + drill-down + §8 terminal-essence dialog (engine owns loop+context) + §9 mission + knowledge system (数字员工 operator)
version: 11
status: accepted
last_updated: 2026-06-29
deciders: [bao, zeus, hephaestus]
sections:
  - { id: lifecycle,                  source: orig-016 — RETIRED in v5 (mcp lifecycle moves to ADR-004) }
  - { id: remote-view,                source: orig-017 — preserved (still Irisy's UX surface) }
  - { id: persona-shell,              source: H-2026-06-09-002 校准 (replaces persona v4 brain-self-awareness lock) }
  - { id: soul-md-compat,             source: new-2026-06-03 — RETIRED in v5 (SOUL.md spec applies to hermes agent memory, not Irisy) }
  - { id: self-reflection-loop,       source: new-2026-06-04 — MIGRATED to hermes via SKILL.md (Irisy is no longer an agent) }
  - { id: capability-decomposition,   source: new-2026-06-04 — RETIRED in v5 (no Irisy system prompt — agents own their prompts) }
  - { id: pi-extension-integration,   source: new-2026-06-04 — RETIRED in v5 (Pi exited CTRL hot path, ctrl-pi-bridge deleted) }
changelog:
  - v11 2026-06-29: **NEW §9 mission + knowledge system (root-fix for "Irisy isn't smart").** bao 2026-06-29 钦定: 「Irisy 要做什么他不清楚 → 得有一个整体架构和 Irisy 的整体知识体系」+「你还是做个调研吧」→ 3 路调研 (knowledge/context-engineering · proactive-operator · China-OPC) 合成。**魂 LOCKED** = Irisy = 一人公司的数字员工/运营官 (按角色把整件事做完 / 本地记住你的生意 / 缺工具就造 / 经 gate)。病根 = ①没使命 ②知识散 5 摊无 SSOT。§9.2 = 8 层知识栈 (每层一 SSOT, 注入 vs 召回, **能力意识从 gate 注册表派生不手写**, 记忆存 vault markdown 写时对账)。§9.3 = 操作循环 Sense→Anticipate→Plan→Act(经gate)→Produce→Persist + 4 条主动性护栏 (可逆性=ask 边界)。定位红线: 不抢免费超级框 / 不做陪伴 / 隐私=商业数据主权。Governing SSOT = `vault/ctrl/irisy-architecture.md` v2 + [[irisy-roles.md]]。配 §3 persona-shell (§9 在 persona 之上 = Irisy 是为了什么)。实施走 dev-loop 分步。**+ §9.5 实施路径校准 (bao「hermes 已做了一些, 你要综合考虑」)= 驯化非造**: hermes 已是完整 agent 引擎 (记忆/循环/技能/cron/kanban), Irisy 三件 = 给魂 + 把记忆引流回 vault + 藏黑话 (减法非加法)。审计: CTRL 早把三件设计在 `vault_seed/irisy-soul.md` (记忆体系 episodes/playbook/curator + privacy + 藏黑话规则) + `CTRL_CAPABILITY_BRIEF` (已命令 hermes 把记忆写 vault SOUL 不写私有库) 里, 只是魂旧 (co-pilot/passenger/Pi/keycap) + 散两处会漂 + 引流没收口 (hermes 双写) + `vault/irisy/SOUL.md` 从未 seed。本刀已: 换魂 (seed about/identity → operator/back-office-of-one-person-company, 擦 Pi/keycap/co-pilot) + PWA spine 注入使命 (irisy-prompts v13→v14)。待做: 收口引流 (hermes 启动同步 vault SOUL + 停私有 MEMORY 双写) + 合并两源成单 spine。
  - v1 2026-05-31: module reorg — merged orig-016 (8-stage mcp lifecycle) + orig-017 (remote co-view = Irisy primitives) + lifted orig-024 §7 persona rule into this ADR + amended persona rule with prompt v5 (brain self-awareness with brand labels).
  - v2 2026-06-03: NEW §4 soul-md-compat — Irisy persistent memory adopts the SOUL.md spec (github.com/aaronjmars/soul.md) verbatim, ecosystem-aligned with OpenClaw (350k stars, 2,999+ ClawHub skills, WorkBuddy compat) and Claude Code. CTRL-only extensions land in an `x-ctrl:` frontmatter namespace so vanilla SOUL.md readers stay forward-compatible. Driven by bao 2026-06-03 competitive research summarised in `.olym/brainstorm/openclaw-compat-2026-06-03.md`.
  - v3 2026-06-04: **NEW §5 self-reflection-loop** — Irisy implements Loop 1 of ADR-001 §8 self-evolution. Three layers: client-side rule-based **Detect** (failure signals → episodes), Pi background subagent **Reflect** (Letta-code stateless mode, idle-30min trigger), playbook **Improve** (injected into next IrisyChat system prompt). Reuses ADR-002 §11 audit-ledger for cross-loop accountability. Per bao "不仅仅 Irisy LLM, 整个系统都要自我升级成长 — Irisy 自己有自我成长的能力". Brainstorm: `.olym/brainstorm/irisy-self-reflection-loop-2026-06-04.md` + `.olym/brainstorm/system-self-evolution-2026-06-04.md` §3.1.
  - v4 2026-06-04: **NEW §6 capability-decomposition + §7 pi-extension-integration** — root-cause fix for "Pi 一切动词都 install_mcp" + "Pi 说我没 skill 系统" 实测 fail. ctrl-pi-bridge 升级从 provider-only → registerTool + 3 hook (before_agent_start chain / tool_call inspector / resources_discover skills 贡献), Pi `--no-tools` → `--no-builtin-tools` (撤 7 个 built-in 但保 extension 注册的). System prompt 从 monolithic 200 行 → thin base (~30 行) + 8 capability segment, 通过 `before_agent_start` hook 按关键词动态注入 (token cache 友好). PWA `<call>` XML loop 保留作 Volc Qwen/Llama 弱模型 fallback. 调研: `.olym/brainstorm/irisy-pipeline-2026-06-04.md` v2 §3 (Pi/Letta/Cline/Goose/Cursor 对标) + §8 (background agent 深拉源码).
  - v5 2026-06-09: **Irisy reframed as PWA persona shell (H-2026-06-09-002).** bao 2026-06-09 校准: "Irisy 是表象". Irisy is **no longer a brain / agent runtime** — the brain role belongs to 3 external agents (hermes / opencode / kairo per ADR-002 §1 v19). Irisy is now the PWA UX persona layer: (1) **Avatar + branding** — Irisy character, voice, blink animation (Lottie). (2) **System-prompt injection** — wraps user message with CTRL substrate context (active provider info, Notes folder path, OS hint) before routing to whichever agent matches active L1 chip (default `/assistant` → hermes). (3) **Sycophancy filter** — `packages/ctrl-web/src/lib/persona-filter/patterns.md` (relocated from retired `packages/ctrl-pi-bridge/data/persona-patterns.md`). (4) **Drill-down** — long-press / Alt-click reveals raw agent output before filter. RETIRED sections: lifecycle (moves to ADR-004 § mcp execution), soul-md-compat (applies to hermes memory, not Irisy), self-reflection-loop (migrates to hermes as `~/.ctrl/skills/auto-reflect/SKILL.md`), capability-decomposition (no Irisy system prompt — agents own theirs), pi-extension-integration (Pi exited, ctrl-pi-bridge deleted). Per memory `feedback_no_redundancy_one_ssot` 🔒: hermes is the sole substrate-level agent memory primitive — Irisy doesn't duplicate.
  - v7 2026-06-28: **NEW §8 terminal-essence dialog — the engine owns the loop + context (continuity root-fix).** bao 2026-06-28 钦定: Irisy 的对话「**对话框形态, terminal 本质**」—— 友好对话 UI 罩在一个**持久 REPL 引擎**上, 引擎自持 agent loop + 对话上下文 (Claude Code / Codex 同模型), 正是 ADR-001 spine §byo-cli-driver + ADR-002 §brain 早已钦定的「调度权在 CLI/引擎手里, CTRL 不 supervise/编排 loop」。根治 §8.2 三条失忆 (每轮只发 last_user / 一出错就 nuke session / 路径切换两后端不共享记忆) —— 把实装拉回架构本位: CTRL 停止「半管」一个它不该拥有的 loop+context, 回到 projection+gate。「先不用管 provider」(bao): 引擎单元就用现有 hermes, 暂不动 provider/模型层; provider-direct 降为「引擎缺席/离线」纯 fallback, 不再参与正常对话记忆。Supersedes §1「对话持续」intent 的脆弱实装。
  - v9 2026-06-28: **§8 amend — NEW §8.7 consolidation: left/right regions + the right-region pluggable ACP engine.** bao design pass 2026-06-28 (「你分开一下,左边区域和右边区域」+「Irisy 不是可以选择是 Hermes 或者 Codex 么」). **左区** = workspace/输出 (per-L1; coding 模块的工作区是真终端 PTY, 跑用户**自驱**的 coding agent — Claude/Codex/shell, CTRL 只投影不 supervise)。**右区** = Irisy (单一品牌 persona), **引擎可选 Hermes/Codex/Claude**, CTRL **经 ACP 驱动**之。机制 = ACP (JSON-RPC over stdio): `hermes-acp` (已驱动) / `@zed-industries/codex-acp` / `claude-code-acp` 同协议, `acp_client.rs` 参数化 spawn 即可。**driven(右) vs projected(左)** 区分: 同一 Codex 两区不同角色 (右=被 CTRL 当脑驱动, 左=被用户当 driver), 「不 supervise BYO」只管左区。纠正 §8.6 两处过度声明 (并非所有 surface 同引擎 — 左区 coding 终端不是 Irisy 引擎, `coding_mode` 绕开引擎是对的; BYO 选中不是「死路 handoff」而是 ACP 真驱动流式作答)。坐实 §8.4 真修法 (transcript 回灌 fresh session, 否则只是 UI 记得引擎忘了)。配对 **ADR-002 §brain amend** (hermes→「CTRL 驱动的可选 ACP 引擎」, hermes 仍默认不退役)。§8.7 与 §8.6 冲突时以 §8.7 为准。
  - v10 2026-06-29: **§8 amend — NEW §8.8 one-click managed install for right-region BYO engines (replaces the copy-command-into-terminal hand-off).** bao 2026-06-29 钦定: 「你希望普通用户这么安装配置吗?普通用户只会一键安装」。§8.7 把 Codex/Claude 当右区引擎驱动了, 但 InstallAgentModal 还在让用户「复制 `npm i -g` 进终端」—— 那是开发者工具的默认装法, 不是 CTRL 模型。**校准**: ① 普通用户**零安装**停在 hermes (CTRL bundle + uvx 自启, 默认引擎, 用户啥都不用动)。② 真要用 Codex/Claude 的人走 **CTRL 一键托管安装** —— 装进 CTRL 自管的 `~/.ctrl/agents/<id>/` (本地 npm `--prefix`, **不全局、不 sudo、不开终端**), 运行时 (Node) 像 `ensure_uvx` 一样**自举** (`ensure_node`, 零前置依赖, 沿用 ADR-002 §1.2 v20「kernel bootstraps what it needs」)。③ 装完只剩一次性 provider 认证 —— 尽量复用用户已在 CTRL 配的 BYOK key (Keychain, 注入 adapter 子进程 env), 否则引导式登录; key 永不入 Irisy/LLM。**driven(右)= CTRL 装+驱动** 与 §8.7「不 supervise BYO」(只管左区 projection) 不冲突 —— 右区引擎本就是 CTRL 拥有的。InstallAgentModal 从「复制命令」改成**一键 Install 按钮 + 进度 + ready**。开放点 (codex-acp↔托管 codex 的 PATH 接线 / Node·codex release asset 名 / claude-code-acp 包名) 真机验证, ADR 内诚实标注 pending。
  - v8 2026-06-28: **§8 amend — NEW §8.6 unified terminal-essence frontend + selectable agent on every surface.** bao 2026-06-28 钦定: 「前端都是 terminal 实质的, 统一, 可选 agent」。§8.1 的「对话框形态, terminal 本质」**不局限于 Irisy ambient chat —— 它是整个前端的统一交互模型**: 每个 surface (ambient chat / coding L1 / per-L1 workspace / 任何 agent 面) 底下是同一个东西 = §8.3 terminal-essence session (引擎自持 loop+上下文) + **可换的 agent = "shell"** (hermes 内嵌 / Codex / Claude Code BYO, `list_byo_drivers` agent 轴)。统一 = 一套模型 + 一个共享 `active-agent` 选择器贯穿所有 surface (不是 N 个各自为政的 chat/terminal 部件); 切 agent = 换 shell, 不重置 persona/功能包 (正交轴)。embedded vs BYO 诚实性逐 surface 成立。配对 ADR-003 § frontend。
  - v6 2026-06-25: **§persona-shell + §3 amend — 单一品牌声音 → 可灵活配置的功能角色 (bao 理念「每个功能配 persona + 功能包,灵活配置不焊死」).** Amends `decision_one_persona_irisy`: Irisy 仍是**单一品牌/声音/形象** (绝不分裂成 Janus/Talos 多重人格),但新增**可切换的功能角色** = 每个 L1 一份 `(persona, 功能包[])` 的**灵活配置**。persona 池与功能包池**解耦**、可组合、可跨 L1 复用 —— 换 persona / 加功能包 = 改配置,不动代码 (✗ 不是焊成一个不可分单元)。当前角色显示 + 切换在**对话框上方**;切角色时对话流持续 (不重置)。Supersedes §3「no global persona library」:现在有一个小的策展角色池 + 每-L1 配置,但仍是**扁平配置**不是 brain-self-aware indirection mesh。**L1 ≠ 角色** (L1 = 功能模块含数据/workspace;角色 = 其 persona 配置面)。设计 SSOT = `vault/ctrl/irisy-roles.md`。开放点 (L1↔角色联动 / 初始角色集 / 用户自建角色 v1) 在该文档跟踪。配对 ADR-003 § home (角色切换器 UI)。不动 sycophancy filter / drill-down / 单一品牌声音锁。
related:
  - .olym/decisions/002-substrate.md
  - .olym/decisions/003-frontend.md
---

## §1 8-stage mcp lifecycle

Irisy = vertically-cross-cutting companion. **8 stages**, each with explicit role + UI surface.

| # | Stage | User intent | Irisy role | UI surface |
|---|---|---|---|---|
| 1 | Discovery | "what tools exist for X?" | Recommend mcps by use-case query; surface MCP marketplace + agentskills.io results | Pool overlay, Irisy as filter/rank layer |
| 2 | Creation | "I need a mcp that does X" | Co-author manifest + tool code | Creator drawer (chat / manifest / code preview) |
| 3 | Config | "set up this mcp for me" | Walk through `config_schema`; suggest defaults | Inline Irisy bubble on first invocation OR Settings |
| 4 | Invoke | "do this" | Disambiguate vague intent → mcp selection; pre-fill args; explain expected result | Keyboard tile long-press / quick-action overlay |
| 5 | Collab | "explain what just happened" / iterate | Annotate output; chain to next mcp; co-edit | Workspace tab side-panel (drawer adjacent to active tab) |
| 6 | Debug | "didn't work — why?" | Read stderr / ST-SS error cells; suggest fix; offer to amend manifest | Workspace tab inline error overlay |
| 7 | Improvement | "this could be better at X" | Capture as Patch-tier amendment (ADR-004 §4); offer upstream PR when applicable | Bubble after repeat use; long-press → "improve this mcp" |
| 8 | Retire | "I don't use this anymore" | Help uninstall / archive; preserve vault data; reset keychain tokens | Settings drawer when usage falls below threshold |

**Companion ≠ in-your-face**:
- Default visibility = bubble (collapsed); user click → drawer
- **Single brand voice, switchable functional roles** (amends `decision_one_persona_irisy` 🔒, v6 2026-06-25) — Irisy stays ONE character / voice / brand (never splits into Janus/Talos multi-personalities), but exposes **switchable functional roles** = a flexibly-configured `(persona + toolset)` per L1, shown + switched **above the chat box**, conversation persisting across switches. Switching a role ≠ splitting the persona. Persona pool ⊥ toolset pool (decoupled, composable, cross-L1 reusable; swap/add = config not code). **L1 ≠ role** (L1 = module incl. data/workspace; role = its persona facet). Design SSOT `vault/ctrl/irisy-roles.md`
- **First-class PWA page**, not a mcp (memory `decision_irisy_is_pwa_native_not_keycap` 🔒)
- Drawer slides from bottom or right; never full-screen takeover (ADR-003 § nav-keyboard)

Stage 7 → 2 loopback (Improvement feeds new Creation) is the creator-economy flywheel.

**v1 ship**: stage 1 (Chat / Assistant) only via `IrisyChat.tsx`. Stages 2-7 = v1.1+ per memory `feedback_no_planning_no_phasing`.

## §2 Remote co-view — Irisy primitives (NOT mesh)

Memory `project_remote_co_view_is_irisy` 🔒 — 远程同屏 / mirror / 跨设备 viewer / session 接管 are Irisy primitives layered ON mesh (ADR-002 § crypto), not mesh itself. Mesh = CRDT state sync; co-view = live observability + interaction over a session.

**4 primitives** (zeus owns kernel substrate, daedalus owns Irisy UI):

1. **`session.observe`** — viewer-side Irisy subscribes to host-side kernel's ST-SS workspace cell stream (filtered by allow-list of cell kinds). Read-only by default.
2. **`session.share`** — host-side Irisy generates ephemeral share URL (`ctrl://session/<id>?token=<...>`). Token authenticates viewer kernel to host kernel's MCP wire (ADR-002 § mcp-bus, port 17873 OR relay-traversed equivalent for cross-device).
3. **`session.takeover`** — viewer can send Op events back to host (clipboard write / mcp invoke / Irisy say). Requires explicit allow-list in `share` token (capability-scoped per ADR-004 §1).
4. **`session.narrate`** — viewer's Irisy renders narration overlay: "your phone Irisy is observing your PC; current mcp = X; recent action = Y". Generated client-side from cell stream.

**Wire**:
- Same-LAN (mDNS-discovered): direct WebRTC peer via vodozemac Olm (same Olm session that mesh uses)
- Cross-NAT: `ctrl-relay` Worker (STUN/TURN-like NAT traversal); payload E2E encrypted (relay sees only encrypted blobs)
- Underlying = ST-SS cell stream subset over WebRTC data channel
- NOT a separate transport — same stack as mesh; difference is what flows through

**NOT promised**:
- Not a remote desktop tool — CTRL streams workspace cells (semantic events), not pixel buffers
- Not in v1 scope — primitives roadmapped to v1.1 once mesh + Irisy 8-stage stable

## §3 Persona rule + prompt v5 (binding)

**Persona sources** (amended v6 2026-06-25 — flexible config, not per-mcp-only):
- **Per-mcp persona** (original) — lives inside `cap_asset.files` as markdown (ADR-002 § composition axis 6); vault override `vault/mcps/<id>/persona.md` wins.
- **Role persona pool** (NEW v6) — Irisy's switchable functional roles draw from a small curated persona pool (`lib/irisy-prompts.ts` + `personas/irisy/*`); a persona is **decoupled from any single mcp** and composable into a role. This **supersedes the old "no global persona library" lock** — there IS now a flat curated pool, but it stays a flat pool + per-L1 `(persona, toolset[])` config, NOT a brain-self-aware indirection mesh. Roles switch above the chat box; conversation persists. Design SSOT `vault/ctrl/irisy-roles.md`.

**Irisy prompt v5** (`vault/.irisy-prompts/irisy-system.md`):

1. **Self-aware via `brain_status()`** — kernel injects `<brain_state>` block (engine label / providers / health / last_failover) from ADR-002 § provider §3.7. Irisy answers "你是什么 / 用什么模型" using this state.
2. **User-friendly labels only** — say "Claude 订阅" / "Volc Doubao" (brand label). Never expose RPC codenames: "Pi" / "claude-oauth" / "RpcClient" / "kernel" / "bridge" / "MCP".
3. **Singleton brain** — never suggest "切换 brain". User switches **provider** (Settings → Providers), not brain.
4. **Failover transition** — on `provider:failover` event ("Claude 暂时连不上, 我切到 Volc 了"). Use the typed event, not heuristics.
5. **Settings deflect** — provider/model change ask → "在 Settings → Providers 改" (one line, no inline provider explanation).
6. **Tool call hiding** — tool plumbing never streams to chat (binding per ADR-002 § composition §7).
7. **Reply style** — one short paragraph default; no "Sure!" / "Of course!" preamble; start at the answer.

**`PROMPT_VERSION` bump policy**: any change to system prompt body → bump `PROMPT_VERSION` in `packages/ctrl-web/src/lib/irisy-prompts.ts` so `ensurePromptsBootstrap` re-seeds vault snapshots. v4 → v5 is this ADR's deliverable.

## §4 SOUL.md compat — Irisy persistent memory is the SOUL.md spec (NEW v2, 2026-06-03)

**Why this section exists**: bao 2026-06-03 competitive research locked
the ecosystem-alignment call. OpenClaw passed 350k GitHub stars in 60
days, ClawHub holds 2,999+ community-built skills, Tencent WorkBuddy
already ships OpenClaw compat. **SOUL.md**
(github.com/aaronjmars/soul.md) is the persona/memory config file
recognised by *both* OpenClaw and Claude Code — crossed from "single
project" to "protocol standard", the same way MCP did for tool
calling. CTRL standing outside this standard while building a
parallel manifest = creators have to pick one to invest in, and they
already picked SOUL.md.

Full strategic analysis: `.olym/brainstorm/openclaw-compat-2026-06-03.md`.

### §4.1 Lock — SOUL.md is the canonical Irisy memory format

Irisy persistent memory at `vault/irisy/SOUL.md` (single file) plus
`vault/irisy/.irisy-memory/` (sub-files referenced from SOUL.md) **MUST**
conform to the SOUL.md spec at github.com/aaronjmars/soul.md. Spec
version pinned per the latest reviewed upstream commit; pin recorded
in `vault/irisy/.soul-md-version` so a future spec churn is auditable.

memory `decision_pi_is_sole_brain_hermes_is_keycap` already mentioned
the file by name but the *format* was unlocked; this section closes
that gap.

### §4.2 CTRL extensions — the `x-ctrl:` frontmatter namespace

CTRL-only fields (Pi provider routing hints, mcp activation rules,
vault layout overrides, etc.) live under an `x-ctrl:` frontmatter
key. Vanilla SOUL.md readers (OpenClaw, Claude Code, future
implementations) ignore unknown keys, so the file stays
forward-compatible.

Example shape:

```markdown
---
# Standard SOUL.md fields — read by OpenClaw, Claude Code, CTRL.
name: bao
voice:
  tone: direct
tools:
  - id: clipboard
    surface: mcp
memory:
  long_term: ".irisy-memory/long-term.md"
  episodes:  ".irisy-memory/episodes/"

# CTRL-only — never required by upstream readers.
x-ctrl:
  provider_routing:
    primary: claude-oauth
    fallback: volc
  mcp_activation:
    auto_invoke_on_paste: false
  vault_layout:
    review_queue: ".ctrl/review-queue/"
---

# About me

I am bao. I build CTRL — an ambient Ctrl-hotkey workbench …
```

The body (after frontmatter) is free-form markdown per the SOUL.md
spec — Irisy reads it verbatim, additional structure (Headings as
section pointers) is documented at the spec, not in this ADR.

### §4.3 Read / write surface

Three call surfaces, all SOUL.md-aware:

| Surface | Read | Write |
|---|---|---|
| **Pi brain** (Irisy agent loop) | At every turn via kernel-injected `<soul>` block | Asks user before mutating frontmatter; episodic notes append to `.irisy-memory/episodes/<date>.md` directly |
| **Settings → Irisy panel** (PWA) | Structured form over the frontmatter + body sections | Direct edit; saves through `vault_write` with frontmatter preserved |
| **MCP** (`irisy.soul_get` / `irisy.soul_set`) | Available to external agents (Cursor, Claude Code itself) so they can read CTRL's soul | Auth-gated; mutations emit an event so the user sees a notification |

Implementation deferred to the next code session (next chunk after
the kairo parity Notes app).

### §4.4 Bridge to OpenClaw skills (forward reference)

CTRL mcp manifests and OpenClaw skill manifests are bidirectionally
convertible per the "marketplace bridge" move recorded in the
brainstorm doc. The schema bridge will land in **ADR-002 substrate
§7 composition v1 amendment** in a follow-up session (paired with the
`packages/ctrl-mcp-sdk/src/openclaw-bridge.ts` transformer). This
section asserts the intent; the schema lock lives in ADR-002.

### §4.5 First-boot seed

`src-tauri/src/kernel/vault.rs::seed_vault_feature_layer` extends to
write a starter `vault/irisy/SOUL.md` on first launch when the file is
absent — same idempotent policy as the existing sourcing.yaml /
daily-notes.yaml seeds (§8 vault feature-layer). The seed template
ships SOUL.md-compliant scaffolding plus a commented `x-ctrl:` block
the user can uncomment to opt into the extensions.

### §4.6 Spec churn policy

SOUL.md is young. Each upstream tag we pin to gets recorded in
`vault/irisy/.soul-md-version`; bumping the pin requires:

1. Review of upstream changes for compatibility with the `x-ctrl:`
   namespace (no key collisions).
2. Update of the seeded template in `vault_seed/`.
3. Migration note in this section's changelog if existing user soul
   files need transformation.

The spec is maintained by aaronjmars (separate project), not
Steinberger, so even if OpenClaw the runtime forks / vendor-pivots,
SOUL.md as a format has independent governance.

## §5 Self-reflection loop v1 — Irisy grows itself (NEW v3, 2026-06-04)

bao 2026-06-04: "Irisy 应该有自我反思 / 自己提升的过程; 整个系统都要自我升级成长 — Irisy 自己有自我成长的能力". This section is Irisy's slice of ADR-001 §8 self-evolution (Loop 1).

### §5.1 Three-layer architecture (Detect / Reflect / Improve)

bao chose **in-session granularity** but per-turn LLM reflection is not viable (Reflexion / Self-Refine warn "over-reflection degrades agents"). Resolution: **detect every turn (zero LLM cost), reflect on-demand (one LLM call), improve via next-turn prompt injection**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Detect (per turn, 0 LLM)                                               │
│    • client-side rule scanner in IrisyChat.tsx after stream completes   │
│    • signals: user_rephrase / negative_feedback / banned_preamble /     │
│      tool_call_fail                                                     │
│    • hit → append vault/.irisy-memory/episodes/<date>.md                │
│                                                                         │
│  Reflect (on-demand, 1 LLM call via Pi background subagent)             │
│    • trigger: idle 30 min OR ≥5 negative episodes OR user-asked         │
│    • subagent mode: stateless, mode=stateless (Letta-code pattern)      │
│    • reads recent episodes → emits do-list / don't-list /               │
│      SOUL.md `x-ctrl:lessons` updates                                   │
│    • writes vault/.irisy-memory/reflections/<date>-<HHmm>.md            │
│                                                                         │
│  Improve (next turn, prompt injection)                                  │
│    • buildSystemPrompt appends playbook ## Do + ## Don't sections       │
│    • cap at 1500 chars; LLM consolidates when exceeded (Mem0 pattern)   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### §5.2 Detect rules (client-side, no LLM)

| Signal | Rule | Severity |
|---|---|---|
| `user_rephrase` | Levenshtein(prev_user, cur_user) > 0.6 AND contains rephrase hint (`重新` / `不是` / `重来` / `我意思`) | high |
| `negative_feedback` | cur_user contains negative word (`错了` / `不对` / `wrong` / `nope`) | high |
| `banned_preamble` | assistant message starts with banned phrase (`Sure!` / `我来分析` — prompt v5 already forbids these but they leak) | low |
| `tool_call_fail` | any tool call in turn returns success=false | high |

Implementation: `packages/ctrl-web/src/lib/irisy-reflection.ts` (new file). Pure function, no Tauri call needed for detect itself.

### §5.3 Reflect — Pi sleep-time subagent

Pattern: **Letta-code reflection subagent** (`letta-ai/letta-code/src/agent/subagents/builtin/reflection.md`).

- **Stateless** — receives full context as input, returns single report, no persistent memory between runs
- **Background** — runs while main IrisyChat is idle; does not block user
- **Sleep-time consolidation** — analogy to human sleep; main agent unaffected during processing
- **Read-write to vault only** — uses Pi's built-in Read / Write / Edit tools; no other tool surface

Trigger conditions (OR, any one fires):
1. App idle ≥ 30 min AND there are unprocessed episodes
2. ≥ 5 negative episodes accumulated since last reflection
3. User explicitly asks ("复盘一下" / "what should I change" / "你最近怎么样")

Reflection prompt template lives at `vault/.irisy-prompts/irisy-reflect.md` (managed alongside system prompt, not hard-coded — user can read & override).

After reflection completes, episodes are moved to `.irisy-memory/episodes/_archived/<date>/` so the next reflection trigger does not redundantly process them.

### §5.4 Improve — playbook injection

After every reflection, write the do/don't rules to `vault/.irisy-memory/playbook.md`:

```markdown
# Irisy Playbook — auto-curated from reflections

> Auto-maintained by Irisy. Edit / delete freely. Mark "keep" to lock against auto-removal.

## Do
- Give the conclusion in the first sentence on technical questions (2026-06-04 reflection)
- Match the user's language: Chinese in, Chinese out (2026-06-03 reflection)

## Don't
- Do not narrate the tool-call process to the user (prompt v5 lock, leaked 2 times)
- Do not fabricate code when uncertain; grep first (2026-06-04 reflection)

## Keep (user-pinned — Irisy must not auto-remove)
- User prefers YAML over JSON for cap manifests
```

`buildSystemPrompt()` in `IrisyChat.tsx` adds a §5 segment after the existing §1 brain state / §2 core memory / §3 SOUL.md long-term / §4 memory index segments. Only `## Do` + `## Don't` reach the prompt; `## Keep` is for user reference and prevents auto-deletion by future consolidations.

### §5.5 SOUL.md `x-ctrl:lessons` field

High-priority cross-session lessons (≤3 per reflection) escalate from playbook into SOUL.md `x-ctrl:lessons` array. The `x-ctrl:` namespace is CTRL-only (§4.3) so this auto-write does not need to ask the user (unlike standard SOUL.md frontmatter mutations, which do). UI signals the write with a non-blocking red dot in Settings → Irisy that links to the diff.

### §5.6 Audit ledger integration

Every Detect / Reflect / Improve event writes a row to the audit ledger (ADR-002 §11) with:
- `loop_id` = `irisy_reflection`
- `stage` = one of `detect` / `diagnose` / `plan` / `execute` / `verify` / `learn`
- `evidence` = the offending turn snippet (Detect) or reflection report path (Reflect/Improve)
- `correlation_id` = ties all 6 stages of one reflection cycle together

Users can query "show me last week's Irisy self-corrections" via Settings → 自我升级 → Loop 1 filter.

### §5.7 Verification — did reflection actually help?

Three objective signals:
1. **negative_episode_rate / 100 turns** must trend down month-over-month
2. **same-rule re-hit rate** (hash of rule signature) must trend → 0
3. **user-initiated 复盘 frequency** should drop (user not having to ask = Irisy is fixing itself)

If signal 1 or 2 trends *up* over a 14-day window, audit ledger fires a meta-signal that triggers Loop 5 (system self-healing) — the reflection mechanism itself is broken.

### §5.8 Pi upstream tracking

Pi 0.73.1 declares `./hooks` package.json export but the dist directory is empty — upstream hooks aren't shipped. CTRL implements §5 by intercepting `transport.stream()` completion in IrisyChat.tsx (PWA-side, no Pi mod). When Pi ships `on('turn-end')` hooks upstream, the detect code moves into a Pi extension (`@ctrl/pi-bridge`); the detect functions themselves are reusable since they're pure data → signal mappings. Per memory `feedback_pi_is_core_use_upstream_surfaces`: use upstream surface when available, this is the temporary path.

### §5.9 Acceptance

- [ ] `packages/ctrl-web/src/lib/irisy-reflection.ts` — Detect rules + episode writer.
- [ ] `packages/ctrl-web/src/lib/irisy-playbook.ts` — Playbook read/append + consolidation when > 1500 chars.
- [ ] `src-tauri/src/commands/irisy_reflect.rs` — `trigger_reflection(reason)` Tauri command spawning Pi background subagent.
- [ ] `vault_seed/irisy-reflect-prompt.md` + `vault_seed/irisy-playbook.md` — seeded on first run.
- [ ] `IrisyChat.tsx` `buildSystemPrompt()` extended with §5 playbook segment.
- [ ] Audit ledger writes per stage (ADR-002 §11) with correct `correlation_id`.
- [ ] Settings → 自我升级 → Loop 1 panel shows recent reflections + verification metrics (signals 1-3).

## §6 Capability decomposition (NEW v4 — 2026-06-04)

### §6.1 Why decompose

Pre-v4 Irisy ran one monolithic `IRISY_SYSTEM_DEFAULT` block (~200 行, 8 topics interleaved). Real-world failure mode: Pi anchored on the most repeated rule ("install_mcp for any wish") and ignored the antecedent ("only when user said 键帽/key/shortcut"). bao 2026-06-04 实测: "创建一个 md" → Pi went straight to install_mcp with frontend-slide skill instead of vault_write. **Root cause** = no decomposition: Pi can't down-weight the wrong path because every rule is in scope every turn.

Industry consensus (`.olym/brainstorm/irisy-pipeline-2026-06-04.md` §3): Letta uses per-agent-type prompt templates (`letta/prompts/system_prompts/*.py`); Cline uses `TemplateEngine.resolve(template, context, vars)` with `components/` + `variants/`. Both decompose by **task context**, not by topic.

### §6.2 8 capabilities

Each capability has: trigger words / scenes, owned kernel tools (Tauri command names), output format, and a dedicated prompt segment (15-25 行 each). The base persona segment (~30 行) is always injected; capability segments are picked by keyword pre-screen in `before_agent_start` hook (§7.2).

| # | Capability | Triggers (CN / EN) | Tools | Output |
|---|---|---|---|---|
| **C1** | **Note Writer** | "写笔记 / 草稿 X / 帮我写 md / draft a note / save this" | `vault_write` | one-line ack + path link |
| **C2** | **Cap Builder** | "做个键帽 / 键 / 按钮 / 一键 X / 我经常 X / a key for / a shortcut" | `list_local_skills` + `install_mcp` | one-line confirm new cap |
| **C3** | **Cap Invoker** | "用 frontend-slide / 跑那个键 / run X cap / 触发 X" | `mcp_run` (new Tauri command) | streamed cap output + status |
| **C4** | **Knowledge Retriever** | "我前几天写啥 / 关于 X 的笔记 / 搜下 vault / find my notes on X" | `vault_search` + `vault_read` + `vault_tags` + `vault_backlinks` | cited extracts with `path:line` |
| **C5** | **Memory Curator** | bg trigger (every N=5 turn OR idle 30min OR user-asked) | `vault.read SOUL.md` + `vault.write` (x-ctrl:lessons frontmatter) | silent — sleep-time subagent (§5) |
| **C6** | **System Doctor** | "切 provider / 我用什么 model / Irisy 慢 / 怎么登录 / where's my key" | `brain_status` (read-only) | one-line指引 to Settings → Providers |
| **C7** | **Coding Companion** | session.mode == 'coding' OR project_dir set OR "code this / fix bug / 改下代码" | Pi 自带 read/write/edit/bash/grep/find/ls + `vault_write` | unified-diff style change report |
| **C8** | **Conversation** | "你是谁 / 哈喽 / Irisy 怎么样 / 你能做什么" | none | natural language, 1-2 sentences |

**Trigger discipline** (the lock that fixes the install_mcp bug):
- C2 fires ONLY when user used 键帽/键/按钮/一键/key/shortcut/button/tool I can reuse. **Default = C1 (one-shot write) or C8 (chat)**, NEVER C2.
- When user's intent is ambiguous, the assistant asks ONE short question: "做完这一次就行,还是想以后一键再来?" Then routes accordingly.
- C3 fires when user names a known mcp by id or display name; routes to `mcp_run` (Tauri command, ADR-007 § cap-run v1 referenced below).

### §6.3 Segment storage

Capability segments live in `packages/ctrl-web/src/lib/irisy-prompts.ts` as named exports:
- `IRISY_BASE_PERSONA` — always injected (~30 行: persona, brand-label, reply style, identity lock)
- `IRISY_CAPABILITY_SEGMENTS: Record<CapabilityId, string>` — 8 segments per §6.2
- `pickCapabilitySegments(userText: string, mode: SessionMode): CapabilityId[]` — keyword pre-screen returning 1-3 most relevant segments

The vault override path (`vault/.irisy-prompts/<segment>.md`) is preserved per §3 — users can override individual segments without forking the whole persona.

### §6.4 Acceptance

- [ ] `IRISY_BASE_PERSONA` extracted; old `IRISY_SYSTEM_DEFAULT` constant removed (single SSOT, per `feedback_no_redundancy_one_ssot`).
- [ ] 8 capability segments in `IRISY_CAPABILITY_SEGMENTS`; each ≤ 25 lines, no redundant rules across segments.
- [ ] `pickCapabilitySegments()` keyword table covers CN + EN trigger variants from §6.2.
- [ ] `buildSystemPrompt()` order: base persona → `<brain_state>` → core memory → SOUL.md → selected capability segments → installed mcps list.
- [ ] Manual test 5 case: "创建一个 md" → only C1 segment loaded → vault_write fires, no install_mcp.
- [ ] Manual test: "做个 PPT 键帽" → C2 segment loaded → install_mcp fires.
- [ ] Manual test: "用 frontend-slide" → C3 segment loaded → mcp_run fires (assumes mcp installed).
- [ ] Manual test: "我用什么 model" → C6 segment loaded → one-line answer with brand label, no diagnostic verbiage.

---

## §7 Pi extension integration (NEW v4 — 2026-06-04)

### §7.1 Why expand ctrl-pi-bridge

Pre-v4 `ctrl-pi-bridge` only called `pi.registerProvider('ctrl-bridge', {streamSimple})` — a single seam routing LLM calls back to the kernel provider chain. This is correct but incomplete. Three failure modes traced 2026-06-04:

- **B1 (Pi 0 tool)** — `ctrl-pi-plugin/pi-bridge.ts:242` spawns Pi with `--no-tools`; bridge doesn't `registerTool`. Pi has zero functions to call, so it falls back to text-only output. Test transcript: Pi explicitly told user "我没有 skill 系统" because, from Pi's perspective, it really didn't.
- **B2 (XML-only protocol)** — System prompt teaches `<call name="X">{...}</call>` to fake a tool interface. Frontier models (Anthropic / OpenAI) prefer native function calling; XML is leftover ReAct convention. The PWA `irisy-tool-dispatch.ts` loop is the only thing keeping it working.
- **B3 (monolithic prompt — §6 fixes this from the prompt side)**

### §7.2 Pi extension API used (verified against `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`)

```ts
// All 4 surfaces ctrl-pi-bridge will call:
pi.registerProvider(name, {streamSimple})                          // existing v3
pi.registerTool<TParams>({name, label, description, parameters,    // NEW v4 — ~10 tools
                          execute, promptSnippet?, promptGuidelines?})
pi.on('before_agent_start', (evt, ctx) => {                        // NEW v4 — chain hook
  // return { systemPrompt: '...' } — Pi chains across extensions
})
pi.on('tool_call', (evt, ctx) => {                                 // NEW v4 — inspector stub
  // return { block: true, reason: '...' } to veto dangerous calls
})
pi.on('resources_discover', (evt) => {                             // NEW v4 — skills bridge
  // return { skillPaths: ['~/.claude/skills/.../SKILL.md', ...] }
})
```

Pi ToolDefinition is TypeBox-shaped (TParams extends TSchema). ctrl-pi-bridge **cannot import @sinclair/typebox** because Pi loads the extension from `<.app>/Resources/pi-bridge/index.ts` where Node module resolution can't reach Pi's node_modules. Resolution: inline a 30-LOC mock (`T.Object` / `T.String` / `T.Optional`) producing the same JSON Schema shape at runtime; cast via `as unknown as TSchema` to satisfy TS.

### §7.3 Tools registered

10 tools, each is a thin HTTP-fetch wrapper to kernel provider port (`CTRL_PROVIDER_PORT` env, same path already used for `streamSimple`):

| Tool name | Capability | Wraps Tauri command |
|---|---|---|
| `vault_write` | C1 (Note Writer) | `vault_write` |
| `vault_read` | C4 (Knowledge Retriever) | `vault_read` |
| `vault_search` | C4 | `vault_search` |
| `vault_tags` | C4 | `vault_tags` |
| `vault_backlinks` | C4 | `vault_backlinks` |
| `list_local_skills` | C2 (Cap Builder) | `list_local_skills` |
| `install_mcp` | C2 | `install_mcp` |
| `list_mcps` | C2/C3 | `list_mcps` |
| `mcp_run` | C3 (Cap Invoker) | NEW Tauri command per §7.5 |
| `brain_status` | C6 (System Doctor) | `brain_status` |

C7 (Coding Companion) uses Pi's own `read` / `write` / `edit` / `bash` / `grep` / `find` / `ls` — kept enabled by switching `--no-tools` → `--no-builtin-tools` (negates only the built-in default; extension-registered tools still load).

### §7.4 Hook responsibilities

**`before_agent_start`**: examine `evt.prompt` (raw user text) + session state, call `pickCapabilitySegments()` (§6.3), return `{systemPrompt: <base + selected segments>}`. If multiple extensions register, Pi chains — ctrl-pi-bridge runs first, others append after.

**`tool_call`**: stub that always passes today; documented hook point for ADR-006 §4 policy-envelope (autonomy ladder). v1 watches for repeated identical calls (5+ in a row → block as "tool loop detected") so a runaway Pi can't loop forever on the same broken vault path.

**`resources_discover`**: scan `~/.claude/skills/*/SKILL.md` + `~/.ctrl/plugins/cache/**/SKILL.md` and return them as `skillPaths`. Pi auto-loads as native Skills, exposing `/skill:<name>` slash commands. CTRL's own `list_local_skills` Tauri command keeps the same discovery code (§7.3) so both surfaces share one source of truth (`feedback_no_redundancy_one_ssot`).

### §7.5 New Tauri command — `mcp_run` (for C3)

Tauri command `mcp_run({mcp_id: string, args: Record<string, unknown>}) → McpInvocation`. Locates the manifest in `~/.ctrl/mcps/<mcp_id>/`, spawns its runtime (MCP server / built-in handler / local agent per ADR-004 §1), pipes args, streams result back through the same `chat-stream-delta` Tauri event (so ctrl-pi-bridge can render output inline). When the mcp is a SKILL-derived one, the args dict is the skill's `{{var}}` placeholders.

### §7.6 PWA XML fallback retention

`packages/ctrl-web/src/lib/irisy-tool-dispatch.ts` (the XML loop I added 2026-06-04) **stays as fallback** for the Volc / CF Workers AI / Qwen-3 / Llama-3.3 path — these models JSON-format inconsistently, and Cline runs into the same constraint (`apps/vscode/src/core/prompts/system-prompt/components/tool_use/formatting.ts`). Selection logic in `irisy_chat_stream`:

```
if active provider is BYOK frontier (anthropic-* / openai-* / claude-* / gpt-*):
  use native Pi tools (via registerTool)
else:
  use PWA XML dispatch loop + prompt teaches <call> protocol
```

The XML segment is added to the system prompt only when the fallback path is active, so frontier turns stay clean (`feedback_no_redundancy_one_ssot` — one mode active per turn, not both).

### §7.7 Acceptance

- [ ] `packages/ctrl-pi-bridge/src/index.ts` registers 10 tools per §7.3; tsc passes with TypeBox mock cast.
- [ ] `pi.on('before_agent_start')` returns `{systemPrompt}` per §7.4; chain verified by `scripts/probes/pi-bridge-probe.mjs` registering a second test extension.
- [ ] `pi.on('tool_call')` inspector: 5 identical calls in a row → block with reason "tool loop detected"; verified by unit test.
- [ ] `pi.on('resources_discover')` returns at least the same skills `list_local_skills` Tauri command finds; both share helper in `packages/ctrl-pi-bridge/src/skills-discover.ts`.
- [ ] `ctrl-pi-plugin/src/pi-bridge.ts:242` changed: `--no-tools` → `--no-builtin-tools`; new `--skill` args appended for each discovered skill file (delegates to Pi's own loader).
- [ ] New Tauri command `mcp_run` in `src-tauri/src/commands/kernel.rs`, registered in `commands/mod.rs`.
- [ ] Provider-based path selection in `commands/irisy_chat.rs::forward_to_brain`: route via active `brain_status.irisy.primary.id` (frontier ⇒ native tools / non-frontier ⇒ XML).
- [ ] Manual: BYOK Anthropic Pro → ctrl-pi-bridge native function calling fires; vault_write tool call visible in Pi event stream as `tool_use`, not XML in chat content.
- [ ] Manual: Volc default → XML `<call>` loop fires (regression guard).
- [ ] Manual: "用 frontend-slide" → mcp_run invokes and streams output through chat panel.

## §8 Terminal-essence dialog — the engine owns the loop + context (NEW v7, 2026-06-28)

> Authoritative architecture for this section: ADR-001 spine §byo-cli-driver +
> ADR-002 §brain + `vault/ctrl/architecture-byo-cli-driver.md` 定案 4/5. Operational
> truth for the engine: `.claude/skills/hermes/SKILL.md`. §5/§6/§7 above are Pi-era
> and retired (Pi exited the hot path); §8 is the current interface model.

### §8.1 Decision

Irisy's chat is **dialog in form, terminal in essence**. The conversational UI
stays friendly (non-technical users — the ambient workbench), but underneath it
is a **persistent REPL-style engine that owns BOTH the agent loop AND the whole
conversation context** — the same model Claude Code / Codex / Gemini CLI use, and
exactly what ADR-001 §byo-cli-driver + ADR-002 §brain already mandate: *调度权在
CLI/引擎手里; CTRL 不 supervise / 不编排 agent loop* (定案5). CTRL stays its proper
layer — **projection + `:17873` gate** — and stops reconstructing context per turn.

`先不用管 provider` (bao 2026-06-28): the **engine** is the unit of this decision,
whatever model backs it. v1 engine = the bundled Hermes Agent (ADR-002 §brain) run
as ONE persistent session per conversation. The provider/model layer is out of
scope here; the tool-less **provider-direct path is demoted to a pure fallback**
(engine absent / offline) and, when used, does NOT become the conversation's
memory of record.

### §8.2 Root cause this fixes (code-verified 2026-06-28)

Three amnesia mechanisms in the pre-v7 implementation, all from CTRL wrongly
half-owning a loop it should not own:
1. the agent path sent the engine **only the latest user message** (`last_user`);
   continuity relied entirely on the engine's ACP session surviving.
2. on **ANY** engine prompt error CTRL set the client singleton to `None`
   (`irisy_chat.rs`) → next turn `session/new` → total amnesia; since only
   `last_user` is ever sent, a fresh session = zero history.
3. routing (`turn_needs_agent`) **split turns** between the engine and the
   tool-less provider-direct path; the two never shared memory.

Ledger truth: across a whole session `caller='hermes'` showed only research tools
and never `vault_write` — the brain also failed to act, compounding the symptom.

### §8.3 The model (v7 lock)

- **ONE persistent engine session ≡ ONE conversation.** Every turn (tool or chat)
  goes to that engine; the engine accumulates context. Normal conversation is NOT
  split to provider-direct.
- The engine session is **not reset on transient / recoverable errors** — only on a
  genuine unrecoverable crash (process dead / stdout closed), and then it is
  re-hydrated (§8.4), never silently dropped into amnesia.
- The system brief / persona is part of the engine's **standing context** (primed
  once per session); a re-hydration re-primes it.
- **Continuity is the ENGINE's responsibility, not CTRL's per-turn reconstruction**
  — consistent with ADR-001/002 (the engine owns the loop).

### §8.4 Durable transcript (vault-is-truth backstop)

Per plain-text philosophy (本地是 truth), the conversation transcript is persisted
locally so it survives app restart / engine crash and can **re-hydrate a fresh
engine session**. The transcript is the recovery source of truth; the live engine
session is the working context. (Minimal v7 ships the no-reset + single-engine
routing fixes; durable-transcript re-hydration is the immediately-following
increment, not a separate ADR.)

### §8.5 Acceptance / implementation

- [ ] All non-coding turns route to the single persistent engine; the
  `turn_needs_agent` split of normal conversation to provider-direct is removed —
  provider-direct becomes an explicit engine-absent / offline fallback only.
- [ ] The engine session is NOT dropped on a transient prompt error; it is reset
  only when the engine process is genuinely dead, followed by re-hydration.
- [ ] The session survives across turns for one conversation — verified: a fact
  stated in turn 1 is recalled in turn N (real run / ledger).

### §8.6 Unified terminal-essence frontend — every surface is a terminal, agent is selectable (NEW v8, 2026-06-28)

bao 2026-06-28: **「前端都是 terminal 实质的, 统一, 可选 agent」**. §8.1's "dialog in
form, terminal in essence" is **not scoped to the Irisy ambient chat** — it is the
**unified interaction model for the WHOLE frontend**. Every interaction surface
(Irisy ambient chat, the coding L1, per-L1 workspaces, any future agent surface)
is the SAME thing underneath.

**The model (terminal analogy):**
- A surface ≡ a **terminal session**: a persistent engine (§8.3 — owns loop +
  context), a durable transcript (§8.4), never-blocked input, and a **selectable
  agent** = the session's **"shell"**. The shells are the agent axis
  (`list_byo_drivers`): **hermes** (embedded — answers in-surface) / **Codex** /
  **Claude Code** (BYO-CLI — projected via gate + AGENTS.md, driven from the user's
  terminal). Switching agent = switching shell.
- **统一 = ONE model + ONE shared agent selector** (`packages/ctrl-web/src/lib/
  active-agent.ts`) across surfaces — NOT N bespoke chat/terminal widgets. The
  selector built for the ambient chat is the universal control; it appears on
  every surface.
- **terminal 实质 = §8.3 engine semantics everywhere** (persistent session, no
  reset on transient error, continuity is the engine's), under the friendly dialog
  skin — non-technical users still see a conversation, not a shell prompt.
- **Axis orthogonality holds per surface** (ADR-005 §8 三轴): agent (engine/shell)
  ⊥ persona (role dropdown) ⊥ feature-packs. Switching the agent does NOT reset the
  conversation, persona, or packs.
- **Embedded vs BYO honesty holds per surface** (the agent axis lock): an embedded
  agent answers in-surface; a BYO-CLI agent is projected + driven from the user's
  terminal — the surface shows that honestly, never fakes a streamed answer.

**Why:** one mental model for the user (consistency), and architectural correctness
— CTRL is projection + gate; the engine/shell owns the loop. True for EVERY surface,
not just one. Avoids N divergent half-owned loops (the §8.2 amnesia bug, multiplied
per surface).

**Acceptance:**
- [ ] The agent selector (`active-agent` store + `list_byo_drivers`) is present on
  every interaction surface, not only the ambient chat.
- [ ] Every surface routes through the §8.3 terminal-essence engine model honoring
  the selected agent (embedded answers in-surface; BYO-CLI = projected + honest
  hand-off, never a faked stream).
- [ ] One shared session/transcript abstraction backs the surfaces (no bespoke
  per-surface loop); persona + feature-packs remain orthogonal axes layered on top.
- [ ] Non-technical-user skin preserved: the unification is under the hood; the
  surface still reads as a friendly dialog, not a raw shell.
- [x] durable transcript persisted (`transcript-store`) + replayed to re-hydrate
  a fresh engine after restart/crash (`AcpClient::prompt` on `!primed`) — done
  v0.1.684 per §8.7.
- [ ] CTRL remains projection + gate; it does not reconstruct context per turn
  (ADR-001/002 §brain). The fragile pre-v7 path (§8.2) is superseded.

### §8.7 Consolidation — left/right regions + the right-region pluggable ACP engine (NEW v9, 2026-06-28)

> Authoritative consolidation of §8 after a design pass with bao (2026-06-28).
> Answers the open mechanism question and corrects two overclaims in §8.6.
> **§8.7 governs where it conflicts with §8.6.**

**The workspace is TWO regions** (bao: 「你分开一下,左边区域和右边区域」):

- **LEFT — workspace / output.** Each L1 module's own workspace (notes, tables,
  KB, coding). The **coding module's** workspace is a real terminal (PTY,
  `CodingTerminal`) running a **coding agent the USER drives**: Claude Code /
  Codex / plain shell. CTRL **projects** its arsenal in (gate `.mcp.json` +
  `AGENTS.md`, §projector) and **does NOT supervise** it.
- **RIGHT — Irisy (the assistant).** ONE brand persona (§3 single-brand lock).
  Irisy's **engine is selectable** — Hermes / Codex / Claude Code — and CTRL
  **DRIVES** the chosen one as Irisy's brain (bao: 「Irisy 不是可以选择是 Hermes
  或者 Codex 么」). The `<AgentSelector>` belongs HERE; it is the Irisy-engine
  picker, not a per-shell toggle.

**The right-region engine = a pluggable ACP agent.** All three speak the Agent
Client Protocol (JSON-RPC over stdio), which `shell/acp_client.rs` already drives
for hermes:

| Irisy engine | ACP adapter | spawn |
|---|---|---|
| Hermes (default) | `hermes-acp` | uvx (wired) |
| Codex | `@zed-industries/codex-acp` (Rust binary wrapping the user's Codex) | npx |
| Claude Code | `claude-code-acp` (Anthropic SDK ACP adapter) | npx |

CTRL spawns the selected adapter and drives it through the SAME client:
`initialize → session/new {cwd, mcpServers:[gate]} → session/prompt`. The engine
choice is ONE parameter (the spawn command); everything downstream — gate tools,
Irisy persona, §8.3 loop+context ownership, streaming — is identical. This makes
ADR-001 spine §byo-cli-driver's "ACP-aware CLI 增强通道" concrete.

**Driven (right) vs projected (left) — the key distinction.** The same product
(e.g. Codex) can appear in BOTH regions in DIFFERENT roles (this answers the §8 Q2
raised in the design pass):

- RIGHT: Codex as Irisy's **engine** — CTRL spawns + drives it over ACP, streams
  its answer into the chat. **CTRL-driven.**
- LEFT: Codex as the **terminal coding agent** — the user runs it; CTRL only
  projected tools in. **User-driven, not supervised.**

They are INDEPENDENT selections. "CTRL does not supervise a BYO CLI" (ADR-001/002)
governs the LEFT (projection) path only; the RIGHT engine is always CTRL-driven,
whichever ACP agent backs it.

**Corrections to §8.6** (§8.7 governs on conflict):

1. §8.6's "every surface routes through ONE engine" was an overclaim. The LEFT
   coding terminal is NOT the Irisy engine — it's a user-driven coding agent.
   Only the RIGHT (Irisy) surfaces share the ACP engine. `coding_mode`
   legitimately bypasses the Irisy engine (`irisy_chat.rs`:
   `use_agent = !coding_mode`); that is correct, not a bug.
2. The "BYO = honest hand-off, don't fake a stream" device in `engineTransport`
   was a STOPGAP that conflated left/right. With ACP, picking Codex/Claude as
   Irisy's engine **really drives it** and streams a real answer — no dead-end.
   The hand-off survives ONLY as the *not-installed* fallback (§InstallAgentModal).

**Continuity — the real §8.4 fix (still UNMET as of v9, code-verified).** The
transcript persists to the UI (`transcript-store`) but the engine receives only
`last_user` (`irisy_chat.rs`), and a fresh ACP session starts empty on
reload/crash — **UI remembers, engine forgets**. Fix, uniform across all ACP
engines: on a fresh/reset session (`!primed`), replay the persisted transcript
into the first `session/prompt` so the engine re-hydrates; send only `last_user`
while the SAME session continues. Continuity is the engine's (§8.3); the
transcript is the recovery source (§8.4).

**Pairs with ADR-002 §brain amendment:** generalize "Irisy brain = Hermes Agent"
→ "Irisy brain = a CTRL-driven, **selectable ACP engine** (Hermes default; Codex /
Claude Code via their ACP adapters)". Hermes stays the bundled default and does
NOT retire.

**Acceptance (right region) — implemented 2026-06-29 (v0.1.684):**
- [x] `acp_client.rs` spawn command is parameterized by the selected engine
  (`engine_argv`); `hermes-acp` / `codex-acp` / `claude-code-acp` all drive
  through one client + one ACP handshake. **hermes verified end-to-end**
  (`acp_smoke`: `ANSWER "ACP OK"`, no regression).
- [x] The `agent` id (on `irisy_chat_stream`) selects the engine; hermes required
  installed, BYO trusted (UI-gated on `list_byo_drivers` present); BYO adapters
  lazy-fetch via npx; engine-switch resets the singleton.
- [x] Installed BYO drives a REAL ACP answer (no dead-end); `engineTransport`
  hand-off remains ONLY for a not-installed engine (→ InstallAgentModal).
  **Codex/Claude end-to-end pending real-machine verify** (neither installed on
  the dev box; spawn specs are code-correct; `claude-code-acp` package name to
  confirm).
- [x] Transcript re-hydrates a fresh engine session (`prompt` replays prior turns
  when `!primed`) — closes the §8.4 illusion (UI-remembers / engine-forgets).
  Behavioral recall-after-reload to verify on a real multi-turn run.
- [x] Left/right roles stay independent: right-region engine selector
  (`active-agent`) ≠ left-region terminal coding-agent; projection (left) ≠ drive
  (right).

### §8.8 One-click managed install for right-region BYO engines (NEW v10, 2026-06-29)

bao 2026-06-29: **「你希望普通用户这么安装配置吗?普通用户只会一键安装。」** §8.7 made
Codex/Claude drivable as Irisy's right-region engine, but the InstallAgentModal still
told users to copy `npm i -g @openai/codex` into a terminal. That is the **developer-tool
default**, not CTRL's model — it dead-ends a non-technical user. §8.8 corrects the install
UX to match the moat (ambient, self-contained, zero-prerequisite).

**The two-tier install model:**

1. **Ordinary users = zero install.** hermes is the bundled default engine (CTRL ships it,
   uvx auto-starts it). The agent axis defaults to hermes; an ordinary user never installs
   anything and never sees a terminal command. For them it is **zero-click**, not one-click.
2. **Codex / Claude (opt-in) = CTRL one-click managed install.** Selecting a not-present BYO
   engine opens InstallAgentModal with a real **Install** button (no terminal, no copy-paste).
   CTRL installs it into its OWN managed prefix `~/.ctrl/agents/<id>/` via local `npm install
   --prefix` — **never global, never sudo** (extends the proven `install_via_npm`, the same
   path hermes-npm used). The Node runtime is **self-bootstrapped** by `ensure_node()` exactly
   as `ensure_uvx()` bootstraps uv: download the official Node LTS tarball into `~/.ctrl/bin/`
   on first need, zero prerequisite on the user's machine (ADR-002 §1.2 v20 — "kernel
   bootstraps what it needs").
3. **Auth = one-time, reuse BYOK.** After install the only remaining step is provider auth.
   Reuse the OpenAI/Anthropic key the user already configured in CTRL (Keychain) by injecting
   it into the adapter subprocess env (same as `write_hermes_dotenv` / provider injection); the
   key never reaches Irisy or any LLM payload (ADR-006 byok-no-claude — Codex/Claude are the
   user's own tools, BYOK, not an SDK on CTRL's hot path). Fall back to a guided sign-in only
   when no key is configured.

**Why this is consistent with §8.7's "CTRL does not supervise a BYO CLI".** That rule governs
the **LEFT** (projection) path — a coding agent the user drives in their own terminal. The
**RIGHT** engine is always **CTRL-driven** (§8.7), so CTRL **installing + owning** the
right-region engine's runtime is the same ownership, extended to install. "Driven (right)"
now means **CTRL-installed + CTRL-driven**; "projected (left)" stays user-installed +
user-driven. No contradiction.

**Detection (honest, no fabricated choices).** `list_byo_drivers` reports `present=true` when
EITHER the CTRL-managed install exists (`~/.ctrl/agents/<id>/node_modules/.bin/<bin>`) OR the
user already has their own (`codex`/`claude` on PATH, or legacy `~/.codex` / `~/.claude`). So a
user who pre-installed via brew/npm is detected too — CTRL never double-installs.

**Acceptance:**
- [x] InstallAgentModal is a one-click **Install** button → `install_byo_agent(id)` → progress
  → ready; the copy-command-into-terminal framing is removed (ordinary users never see a shell
  command).
- [x] `install_byo_agent` installs into `~/.ctrl/agents/<id>/` via `npm install --prefix`
  (no global / no sudo); `ensure_node()` self-bootstraps Node LTS into `~/.ctrl/bin/` like
  `ensure_uvx`.
- [x] `list_byo_drivers` detects the managed install + PATH binary + legacy home dir; never
  fabricates an absent driver.
- [x] Auth reuses the configured BYOK key — `registry.byo_engine_auth_env(engine)` resolves
  the CANONICAL provider's key from the keychain (codex → `openai`, claude-code → `anthropic`,
  via `resolve_auth` with alias handling) and `irisy_chat` feeds it as the BYO engine's
  `provider_env`, which `acp_client::start` injects into the adapter subprocess env
  (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` [+ BASE_URL]). Empty when unconfigured → the CLI uses
  its own login (never a wrong key); pinned to the canonical id so a coding CLI is never
  misrouted onto an OpenAI-compatible-but-not-OpenAI endpoint. Key stays in the subprocess env
  — never in Irisy's prompt or the PWA (ADR-006 byok-no-claude).
- [x] **Real-machine probe 2026-06-29 (codex)** — resolved three hang causes: (1) the
  package moved — `@zed-industries/codex-acp` is DEPRECATED and answers NOTHING on stdio (silent
  180s hang); the maintained one is `@agentclientprotocol/codex-acp` (v1.0.1). (2) the ACP flow
  needs an explicit `authenticate` before `session/new` (codex returns "Authentication required"
  otherwise); hermes advertises no authMethods so it's skipped. (3) the adapter couldn't find the
  managed codex binary (off PATH) → now `CODEX_PATH` + PATH wiring. Also: adapter stderr is now
  drained to logs so a stall is never silent. `@zed-industries/claude-code-acp` (0.16.2) confirmed
  still correct.
- [x] **Codex auth = OpenAI only — definitively (live `codex exec` test 2026-06-29 with the user's
  Volc key).** `authMethods` = `api-key`{provider:openai} | `chat-gpt`; api-key reads
  `OPENAI_API_KEY`/`CODEX_API_KEY`. Tried pointing codex at Volc via a custom `[model_providers]`
  with `wire_api="chat"` → codex 0.142.4 hard-rejects: *"`wire_api = "chat"` is no longer supported …
  set `wire_api = "responses"`"* (github.com/openai/codex/discussions/7782). Volc (`ark…/api/v3`) is
  Chat-Completions, not the Responses API → **Codex CANNOT use Volc or any OpenAI-compatible provider**.
  CONSEQUENCE locked: per-engine provider constraints — **Hermes** rides the CTRL provider router (any
  BYOK incl. Volc; it's Irisy's working brain today), **Codex** = OpenAI-Responses only, **Claude** =
  Anthropic only. The ONLY way to run Codex on an arbitrary provider would be CTRL exposing an
  OpenAI-Responses-compatible shim that translates to the provider's wire format (deferred feature,
  not built).
- [x] **Honest per-engine readiness (bao 2026-06-29 — "用 Hermes 跑 Volc + Codex/Claude 诚实标注").**
  `list_byo_drivers` now returns `authReady` (CTRL holds the engine's required account key: hermes
  always; codex=openai key; claude=anthropic key). UI uses `isUsable = present && authReady`: the
  selector dot is hollow when not usable, the detail says "Needs an OpenAI/Anthropic account", and
  `engineTransport` short-circuits with a plain message ("Codex needs an OpenAI account — it can't use
  your current provider; switch to Hermes") instead of silently falling back to the router. No
  pretend-it-works, no silent wrong-engine answer.
- [x] **Capability-brief honesty (audit fix 2026-06-29).** The capability brief
  (`acp_client.rs CTRL_CAPABILITY_BRIEF`) claimed clipboard / OCR / image+video generation — none of
  which the gate registers, so Irisy was told it could do things it can't. Removed; replaced with the
  real `smart_table_*` tools. Separately, SOUL.md memory (`irisy_soul_get`/`irisy_soul_set`) was
  implemented but absent from `BRAIN_TOOLSET`, so the capped brain never saw it despite the brief
  promising persistent memory — added to the core group (cap raised 25→27). Irisy no longer
  over-claims, and its memory tools are actually reachable.
- [ ] **Still pending**: end-to-end answer with a REAL OpenAI key (probe confirmed the mechanism via
  the auth-error, not a live completion); claude-code authenticate + end-to-end; Windows Node/codex
  asset paths.

## Acceptance

### Lifecycle (§1)
- [x] ADR locks 8-stage model + invisible internal mode routing. v1 ships stage-1 (Chat) via `IrisyChat.tsx`. Closed.
- [x] No mode-switcher UI in shipped code; `decision_one_persona_irisy` honored. Verified.

### Remote co-view (§2)
- [x] ADR direction recorded; v1 ships none of these (v1.1+ scope). Closed at "decision recorded".

### Persona + prompt v5 (§3)
- [x] Persona is per-mcp `cap_asset.files/persona.md`; vault override path declared. ADR-002 § composition axis 6 closes the schema side.

### SOUL.md compat (§4 — NEW v2)
- [x] Strategic lock recorded — SOUL.md spec adopted verbatim, `x-ctrl:` namespace reserved for CTRL extensions, ecosystem stance documented in `.olym/brainstorm/openclaw-compat-2026-06-03.md` and memory `decision_openclaw_compat_layer`. Code follow-up tracked in **Future work** below (deferred batch, not a blocker for ongoing P0 fixes).
## §9 Mission + knowledge system (NEW v11, 2026-06-29)

> Governing design SSOT = `vault/ctrl/irisy-architecture.md` (3-track research-backed map). This § records the DECISION; the doc holds the detail. Pairs with §3 persona-shell (§9 is the layer ABOVE persona: what Irisy is FOR) + [[irisy-roles.md]] (the role axis).

### §9.1 The mission (LOCKED, bao 2026-06-29)

bao picked the research-backed frame: **Irisy = the 数字员工 / operator for a one-person company** — by **role** (sales follow-up / customer service / docs / bookkeeping) it **completes the whole job**, on the user's **own local data** it **remembers the business** (customers, context), it **self-extends** (builds a feature pack when a capability is missing), all **through the `:17873` gate**.

Root-fix for "Irisy isn't smart" (bao 2026-06-29): not the model — two structural gaps. ① **No mission** — the system prompt had identity + voice + a tool list + guardrails but no *purpose*, so Irisy always "waits to be asked → answers shallow." ② **Knowledge scattered across 5 sources** with no SSOT (`irisy-prompts.ts` + `acp_client.rs::CTRL_CAPABILITY_BRIEF` + hermes SOUL/config + vault + skills) → drift (brief over-claimed capabilities, SOUL went unread). Three research tracks (knowledge/context-engineering · proactive-operator · China-OPC market) converge: leading assistants make the mission a model-external persistent scaffold and the knowledge a layered, single-SSOT, injected-vs-retrieved system.

Three differentiators (all three required): **completes the whole job** (not answers) · **remembers your business — locally** (rivals all park the customer book in their cloud; Irisy gives the agent that context WITHOUT exporting = vault-is-truth, the sharpest seam) · **self-extends** (feature packs, Manus Skills/Projects analog). Positioning red lines: NOT the free all-in-one super-box (Doubao/Quark/Yuanbao own that via free + IM distribution — undistributable for us) → owner-role colleague; NOT a companion (shallow market, >50% churn, regulatory exposure) → warm-but-reliable colleague, trust from accuracy+consistency+drill-down; privacy framed as **business data sovereignty** (PIPL/DSL + leak/lockout avoidance, e.g. cross-app automation getting banned), NOT abstract consumer privacy.

### §9.2 Knowledge system — 8 layers, single SSOT each, injected-vs-retrieved

Principle (Anthropic context-engineering et al.): keep the static prompt small at the "right altitude", route dynamic knowledge through tools just-in-time, one SSOT per layer, **capability-awareness DERIVED not hand-written**.

| # | Layer | SSOT | Injected per-turn vs retrieved on-demand |
|---|---|---|---|
| 1 | Identity / mission | `irisy-prompts.ts` (versioned) | injected, tiny — who + OPC mission + operating loop |
| 2 | persona / voice | persona pool (versioned) | injected, tiny, per-role |
| 3 | **Capability awareness** | **live gate registry** (MCP `tools/list` / `visibility.rs`) | injected, **generated per-turn from the registry** ← honesty fix |
| 4 | Durable user/business facts (customer-profile core) | `vault/irisy/` markdown (md+YAML) | injected, **bounded** (Letta core-block style), reconcile-on-write (ADD/UPDATE/DELETE, mem0 style) |
| 5 | Skill metadata | `SKILL.md` frontmatter | injected, name+desc only (progressive disclosure) |
| 6 | Inferred prefs / soft context | derived index over past sessions | retrieved top-k |
| 7 | Vault project-brain / customer book | user markdown vault (vault-is-truth) | retrieved just-in-time — agentic file-read > chunked RAG at personal scale (<1M tok); FTS5+sqlite-vec+RRF when it grows |
| 8 | Archival / session memory | out-of-window files (memory-tool dir) | retrieved; flush before compaction |

Three iron rules: **one SSOT per layer** (merge the two drifting prompts; fold `CTRL_CAPABILITY_BRIEF` into a single assembly point) · **capability-awareness derived not hand-written** (kills both fake-capability claims and missed-tool blindness) · **brain and chat share ONE knowledge source** (hermes sees what the chat path assembles — kills the unread-SOUL bug).

local-first / BYOK fit + traps: memory stored as vault markdown (passes vim test, no lock-in); on-demand file-read IS vault-is-truth; capability-derivation IS the existing gate. Traps to avoid: mem0/Letta are hosted — borrow the patterns (memory blocks, reconcile-on-write, sleep-time tidy) on vault files, don't use their cloud; under BYOK an embedder can leak the vault to a cloud — default a LOCAL embedder, cloud-embed needs explicit consent + gate audit, FTS5/BM25 always-local fallback; route all memory writes through the gate (auditable, reversible).

### §9.3 Operating loop + proactivity guardrails

The system prompt teaches the LOOP (a "right-altitude" heuristic), not a tool list: **Sense → Anticipate (idle pre-stage; present-now/save/hold) → Plan (answer / act / build-a-pack) → Act (through `:17873` gate — read/reversible = automatic, write/spend/send/delete = confirm first) → Produce (answer in chat; documents/pages routed into the owning module's workspace) → Persist (write decisions/results back to vault → smarter next turn)**.

Proactivity guardrails (research: unsolicited help can hurt competence): ① reversibility = the ask boundary (= the gate's job) · ② only trigger-born + goal-relevant nudges, batched into ONE brief not a stream · ③ one-tap suggestions the user can ignore (don't usurp autonomy) · ④ transparency + sovereignty (drill-down to raw, runs on local vault, NEVER block the input box, any proactive routine is switch-off-able).

### §9.5 Implementation path — TAME hermes, don't build (bao 2026-06-29: "有些 hermes 应该都做了一些了,你要综合考虑")

Critical calibration after auditing hermes + the existing code. **hermes is already a complete agent engine** — it has its own memory, an agent loop that runs to task-completion (max_turns 90, task_completion_guidance), skills, cron (proactivity), a kanban task board, web search, a terminal. The execution substrate is THERE. So Irisy's job is NOT to build capabilities (that re-invents what hermes has — the exact mistake bao corrected 3×). Irisy's job is to **tame** a generic, raw engine whose data lives in its own private store:

> **hermes is the engine; Irisy is the car. The user must never perceive the engine.** CTRL adds the three things hermes structurally lacks, each of which IS the user experience: ① **give it a soul** (the OPC operator mission — hermes can't grow one) · ② **drain its memory back into the user's vault** (hermes defaults to a private DB → violates the vim test; CTRL lands it as the user's own markdown) · ③ **a one-Ctrl-key warm entry that hides all the jargon** (toolsets / cron / providers vanish behind one trustworthy colleague). This is subtraction + taming, not addition + wheel-building.

Audit finding: CTRL already DESIGNED all three, scattered + stale. `vault_seed/irisy-soul.md` (a ~200-line soul seed) already carries the whole memory system (episodes / playbook / curator reconcile-on-write), the privacy locks, the output-routing-to-vault, and the hide-jargon rules. `acp_client.rs::CTRL_CAPABILITY_BRIEF` already commands hermes "your long-term memory is the user's SOUL.md — persist durable facts THERE via the ctrl soul/memory tools, not your private store, so the chat and agent paths share one memory and never drift." So the DRAIN MECHANISM exists. What was actually wrong: (a) the soul was stale (`co-pilot` / `passenger-seat` + retired `Pi`/`keycap` jargon), (b) two sources (seed + brief) drift = the §9.2 "scattered knowledge" disease, (c) the drain isn't closed (hermes still double-writes its own private MEMORY.md), (d) `vault/irisy/SOUL.md` was NEVER seeded into the user's vault, so the rich soul never reached anyone.

### §9.4 Acceptance (§9)

- [x] Mission LOCKED by bao 2026-06-29 (数字员工/operator frame) — recorded here + in governing doc §一.
- [x] Governing design SSOT written: `vault/ctrl/irisy-architecture.md` v2 (research-backed mission + 8-layer knowledge stack + operating loop + positioning), `vault/ctrl/irisy-roles.md` role axis.
- [x] **Soul re-souled (§9.5 ③ + ②-jargon)**: `vault_seed/irisy-soul.md` `about` + `x-ctrl.identity` rewritten co-pilot/passenger → operator/back-office-of-your-one-person-company; retired jargon (`Pi`/`keycap`/`co-pilot`/`servant`) wiped. Seeds into `vault/irisy/SOUL.md` on next launch (`write_if_missing`, currently absent → writes the new soul). PWA chat path reads it via `irisy_soul_get`.
- [x] **Mission in the PWA spine**: `irisy-prompts.ts` v13→v14 prepends mission + operating loop (layer 1).
- [ ] **Close the drain (§9.5 ②)**: on hermes launch, sync `vault/irisy/SOUL.md` → `~/.hermes/SOUL.md` (or point hermes at the vault) so the engine path reads the SAME re-souled file as the PWA path; stop hermes double-writing its private `~/.hermes/memories/MEMORY.md` (land durable facts in the vault instead). ← needs on-device hermes verification.
- [~] **One spine + capability from registry (§9.2 iron-rules, in progress)**. **一脉 = CTRL real functions are the capability backbone** (bao 2026-06-29 chose this over hermes built-ins): Irisy stands on TWO toolsets — hermes's own (browser/subagent/image/kanban/sessions/its-own-memory) + the CTRL gate (:17873: vault/market/feature-packs/smart-table/soul-memory). A live probe (`hermes -z`) proved Irisy was reciting the hermes built-in list while the CTRL real functions stayed invisible — the "no single spine" disease, live. Landed: (a) `CTRL_CAPABILITY_BRIEF` no longer hand-lists tools — it pins the `ctrl` tool list (tools/list) as the SINGLE source of truth + the PRIMARY toolset, demotes built-ins to "fill gaps only (image/browse)", tells Irisy to answer capability questions from ctrl tools not a built-in list (cargo check green). (b) SOUL widened to **personal assistant** (not one-person-company) + capabilities-come-from-the-tool-list, persona-talk removed. Remaining: disable hermes's DUPLICATE built-in toolsets (its memory/sessions/kanban — needs `hermes tools` granularity, interactive-only); behavior verify in-app (oneshot can't reach the gated ctrl tools). Do NOT re-implement hermes's loop/memory.
- [ ] **Close the orphan-soul drain (treblesoul → one owner)**: `~/.hermes/SOUL.md` is an orphan runtime file (no code owned it → held a stale co-pilot persona). Re-souled by hand for now; still needs code to re-pin it from a repo seed on every hermes launch (`acp_client::start`, alongside `write_hermes_dotenv`) so it can't drift back.
- [ ] China-OPC hero feature: local customer-profile memory (drained from hermes into per-customer vault markdown) + cross-IM (WeChat) ingestion → next-up after the drain is closed.

## Future work

- Irisy prompt v5 — bumps `PROMPT_VERSION` 4 → 5 in `packages/ctrl-web/src/lib/irisy-prompts.ts`; replaces v4 "no codenames" hard-ban with "brand labels only + self-aware via brain_status + failover transition + Settings deflect". Lands with ADR-002 § provider §3.7 introspection wiring.
- Stages 2-7 (Creation / Config / Invoke / Collab / Debug / Improvement) UI surfaces — v1.1+ scope (memory `feedback_no_planning_no_phasing`)
- Stage 8 (Retire) Settings drawer for low-usage mcps
- Cross-stage conversation history via `LocalStorage` namespace `irisy:<stage>:<mcp_id>`
- Remote co-view § 4 primitives (session.observe / share / takeover / narrate) — v1.1+ scope
- §4 SOUL.md compat — code follow-up batch (deferred to next session, not a release blocker):
  - `vault/irisy/SOUL.md` first-boot seed via `seed_vault_feature_layer` (template at `vault_seed/irisy-soul.md`)
  - `vault/irisy/.soul-md-version` pin file recording upstream commit/tag
  - Kernel commands `irisy_soul_read` / `irisy_soul_write` surfacing `{frontmatter, body}`
  - MCP tools `irisy.soul_get` / `irisy.soul_set` on :17873 — external agents (Cursor, Claude Code) can read+write CTRL's soul; write emits `platform.notify`
  - Seeded SOUL.md template demonstrates `x-ctrl:` namespace with provider routing + mcp activation example
  - Pi brain prompt v5 (or v6) injects SOUL.md body verbatim per turn
  - CLAUDE.md "Design Philosophy" cross-link to §4
- §4.4 mcp manifest ↔ OpenClaw skill bridge — schema lock lands in **ADR-002 § composition v1 amendment** (next session, paired with `packages/ctrl-mcp-sdk/src/openclaw-bridge.ts` transformer and Pool import flow). Independent of the §4 SOUL.md compat acceptance items.

## Provenance

- §1 ← orig-016 (Irisy 8-stage mcp lifecycle, 2026-05-22, accepted)
- §2 ← orig-017 (Remote co-view = Irisy primitives, 2026-05-22, accepted, v1.1+ scope)
- §3 ← orig-024 §7 (Irisy persona rule, 2026-05-30) + amendment 2026-05-31 (prompt v5 replaces v4 "no codenames" with brand-label + self-aware policy; closes bao 2026-05-31 root issue "Irisy doesn't know its own stack")
- §4 ← NEW 2026-06-03. Driven by bao competitive research dump (OpenClaw 350k stars / WorkBuddy compat / SOUL.md cross-tool recognition); locks ecosystem alignment that memory `decision_pi_is_sole_brain_hermes_is_keycap` half-committed to. Full strategic analysis at `.olym/brainstorm/openclaw-compat-2026-06-03.md`.
