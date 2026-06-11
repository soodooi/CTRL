---
adr_id: 005
module: irisy
title: CTRL Irisy — PWA persona shell + sycophancy filter + system-prompt injection + drill-down (3-agent aggregator era)
version: 5
status: accepted
last_updated: 2026-06-09
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
  - v1 2026-05-31: module reorg — merged orig-016 (8-stage mcp lifecycle) + orig-017 (remote co-view = Irisy primitives) + lifted orig-024 §7 persona rule into this ADR + amended persona rule with prompt v5 (brain self-awareness with brand labels).
  - v2 2026-06-03: NEW §4 soul-md-compat — Irisy persistent memory adopts the SOUL.md spec (github.com/aaronjmars/soul.md) verbatim, ecosystem-aligned with OpenClaw (350k stars, 2,999+ ClawHub skills, WorkBuddy compat) and Claude Code. CTRL-only extensions land in an `x-ctrl:` frontmatter namespace so vanilla SOUL.md readers stay forward-compatible. Driven by bao 2026-06-03 competitive research summarised in `.olym/brainstorm/openclaw-compat-2026-06-03.md`.
  - v3 2026-06-04: **NEW §5 self-reflection-loop** — Irisy implements Loop 1 of ADR-001 §8 self-evolution. Three layers: client-side rule-based **Detect** (failure signals → episodes), Pi background subagent **Reflect** (Letta-code stateless mode, idle-30min trigger), playbook **Improve** (injected into next IrisyChat system prompt). Reuses ADR-002 §11 audit-ledger for cross-loop accountability. Per bao "不仅仅 Irisy LLM, 整个系统都要自我升级成长 — Irisy 自己有自我成长的能力". Brainstorm: `.olym/brainstorm/irisy-self-reflection-loop-2026-06-04.md` + `.olym/brainstorm/system-self-evolution-2026-06-04.md` §3.1.
  - v4 2026-06-04: **NEW §6 capability-decomposition + §7 pi-extension-integration** — root-cause fix for "Pi 一切动词都 install_mcp" + "Pi 说我没 skill 系统" 实测 fail. ctrl-pi-bridge 升级从 provider-only → registerTool + 3 hook (before_agent_start chain / tool_call inspector / resources_discover skills 贡献), Pi `--no-tools` → `--no-builtin-tools` (撤 7 个 built-in 但保 extension 注册的). System prompt 从 monolithic 200 行 → thin base (~30 行) + 8 capability segment, 通过 `before_agent_start` hook 按关键词动态注入 (token cache 友好). PWA `<call>` XML loop 保留作 Volc Qwen/Llama 弱模型 fallback. 调研: `.olym/brainstorm/irisy-pipeline-2026-06-04.md` v2 §3 (Pi/Letta/Cline/Goose/Cursor 对标) + §8 (background agent 深拉源码).
  - v5 2026-06-09: **Irisy reframed as PWA persona shell (H-2026-06-09-002).** bao 2026-06-09 校准: "Irisy 是表象". Irisy is **no longer a brain / agent runtime** — the brain role belongs to 3 external agents (hermes / opencode / kairo per ADR-002 §1 v19). Irisy is now the PWA UX persona layer: (1) **Avatar + branding** — Irisy character, voice, blink animation (Lottie). (2) **System-prompt injection** — wraps user message with CTRL substrate context (active provider info, Notes folder path, OS hint) before routing to whichever agent matches active L1 chip (default `/assistant` → hermes). (3) **Sycophancy filter** — `packages/ctrl-web/src/lib/persona-filter/patterns.md` (relocated from retired `packages/ctrl-pi-bridge/data/persona-patterns.md`). (4) **Drill-down** — long-press / Alt-click reveals raw agent output before filter. RETIRED sections: lifecycle (moves to ADR-004 § mcp execution), soul-md-compat (applies to hermes memory, not Irisy), self-reflection-loop (migrates to hermes as `~/.ctrl/skills/auto-reflect/SKILL.md`), capability-decomposition (no Irisy system prompt — agents own theirs), pi-extension-integration (Pi exited, ctrl-pi-bridge deleted). Per memory `feedback_no_redundancy_one_ssot` 🔒: hermes is the sole substrate-level agent memory primitive — Irisy doesn't duplicate.
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
- **Single user-facing persona** (memory `decision_one_persona_irisy` 🔒) — Irisy never switches; internal sub-modes invisible
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

**Persona is per-mcp** — lives inside `cap_asset.files` as markdown (ADR-002 § composition axis 6). Vault override `vault/mcps/<id>/persona.md` wins; no global persona library, no shared persona indirection.

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
