---
id: 009-pi-surface-integration
status: retired
retired_by: ADR-001 v4 + ADR-002 v19 (3-agent aggregator, H-2026-06-09-002, 2026-06-09)
retired_reason: |
  Pi has exited CTRL's hot path entirely in v19. The 3-agent aggregator is **hermes + opencode + kairo**
  (all external MIT, lazy-installed to ~/.ctrl/agents/). Pi remains usable as a standalone CLI installed
  by the user via npm; CTRL doesn't install it, wrap it, or compose with it. `ctrl-pi-bridge` and
  `ctrl-pi-plugin` packages are deleted in this branch.

  The Pi-extension wiring this ADR locked (12 hooks, 6 communication APIs, N tool/command/renderer
  registrations, auto-RAG, audit log, $VAR apiKey prefix, MCP auto-connect) is all retired — the
  agents CTRL now integrates (hermes / opencode / kairo) expose their own native protocols (MCP stdio /
  HTTP / webview). CTRL kernel = thin install + launch + bridge + keychain.

  Useful auto-RAG and audit-log behaviors migrate to **CTRL skills** (`~/.ctrl/skills/auto-rag/SKILL.md`,
  `~/.ctrl/skills/audit-log/SKILL.md`) so the behavior survives the architecture change while staying
  cross-agent (any of the 3 agents can invoke).
created: 2026-06-04
owner: bao
supersedes: []
amends:
  - 002-substrate (§ brain v1, § brain v7 §1.1 — 扩展 ctrl-pi-bridge surface 范围)
  - 005-irisy (§7 pi-extension-integration — 从 4 个 surface 扩到 ~12 个)
  - 008-irisy-assistant (§2 4-layer 实施细则)
sources:
  - .olym/brainstorm/irisy-pipeline-2026-06-04.md
  - ~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts (Pi 0.73 verbatim)
---

> **RETIRED 2026-06-09** by ADR-001 v4 + ADR-002 v19 (3-agent aggregator). Pi exited CTRL hot path; `ctrl-pi-bridge` + `ctrl-pi-plugin` deleted. See ADR-002 §1 v19 for new 3-agent integration model. Original content kept below for provenance only.

---

# ADR-009 Pi extension surface — full integration

## §0 Decision (one paragraph)

CTRL **完全拥抱 Pi 0.73 ExtensionAPI** — 所有"调度 / steering / sub-agent / context 压缩 / 运行时 tool 切换 / 自定义消息类型 / slash 命令" 均使用 Pi 已 export 的 surface, **不在 CTRL 端另造抽象层** (scheduler / workflow engine / module registry contract 等). `ctrl-pi-bridge` 是 CTRL × Pi 的唯一桥, 订阅 Pi 12 个 hook + 调用 6 个 communication API + 注册 N 个 tool/command/renderer. CTRL 自家能力 (vault / cap / brain_status 等) 走 Pi tool (`registerTool`) 而不是绕 MCP / extension / SKILL 协议. 该 ADR 锁住"用 Pi 自己的 surface, 不重发明", 跟 memory `feedback_pi_is_core_use_upstream_surfaces` (2026-05-31) 对齐.

## §1 Pi 0.73 ExtensionAPI 全清单 (status table)

来源: `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts` (verbatim grep, 2026-06-04).

### §1.1 Hooks (24 events)

| Event | 状态 | 用途 |
|---|---|---|
| `session_start` | ❌ → ✅ | session 启动 → bridge inject SOUL/playbook into context |
| `session_before_switch` | ⏭️ defer v1.1 | session 切换前 (多 session 才有意义) |
| `session_before_fork` | ⏭️ defer v1.1 | fork 前 (P6 session tree 启用后再接) |
| `session_before_compact` | ❌ → ✅ | **P1** — 压缩前抢 hook, summary 落 vault note |
| `session_compact` | ❌ → ✅ | **P1** — 压缩后写 audit log |
| `session_shutdown` | ❌ → ✅ | session 结束 → curator final pass (写 playbook proposal) |
| `session_before_tree` | ⏭️ defer v1.1 | tree 导航前 (P6 后接) |
| `session_tree` | ⏭️ defer v1.1 | tree 导航后 |
| `context` | 🟡 | 每 LLM call 前看 messages — 可用作 token budget audit |
| `before_provider_request` | ❌ | 改 payload (现 N/A, 走 ctrl-bridge provider 已能改) |
| `after_provider_response` | ❌ | 响应后 (现 N/A) |
| `before_agent_start` | ✅ 已用 | capability segment 注入 (Phase 1 commit `7994221`) |
| `agent_start` | ❌ → ✅ | agent loop 开始 → 触发 status bar "thinking" |
| `agent_end` | ❌ → ✅ | agent loop 结束 → 触发 status bar "done" + 计 latency |
| `turn_start` | ❌ → ✅ | **P4** — turn 开始, 检查是否该 inject steering (cron / vault watch) |
| `turn_end` | ❌ → ✅ | **P4** — turn 结束, 检查是否触发 curator (turn_count >= 5) |
| `message_start` | ❌ | 消息开始 (现 N/A) |
| `message_update` | 🟡 | 流式 chunk 更新 — PWA 通过 chat-stream-delta event 已有, 不需要重复 |
| `message_end` | ❌ → ✅ | 消息结束 → 触发 render-filter audit, 看有没有 codename 漏过 |
| `tool_execution_start` | ❌ → ✅ | tool 开始 → 通知 PWA status bar "在搜 vault…" |
| `tool_execution_update` | ❌ → ✅ | tool 流式更新 → status bar 进度条 |
| `tool_execution_end` | ❌ → ✅ | **P4** — tool 结束. isError=true → 触发 reflection (sendMessage nextTurn) |
| `tool_call` | ✅ 已用 | runaway-loop guard (5 相同 = block, Phase 1) |
| `tool_result` | ❌ → ✅ | tool result 后 → 自动给 result 加 source citation tag |
| `model_select` | ❌ → ✅ | 用户切 model → 通知 PWA 刷 brain status |
| `thinking_level_select` | ⏭️ defer v1.1 | thinking depth 切换 |
| `user_bash` | ⏭️ defer v1.1 | 用户 ! prefix 跑 bash (interactive mode) |
| `input` | ❌ → ✅ | 用户输入 → bridge 看是否含 slash command, 拦截路由 |
| `resources_discover` | ✅ 已用 | SKILL.md auto-discover (Phase 1) |

**统计**: 24 events, 4 ✅ 已用, 14 ❌→✅ 计划接, 6 ⏭️ defer v1.1.

### §1.2 Registration (7 surfaces)

| Surface | 状态 | 用途 |
|---|---|---|
| `registerProvider` | ✅ 已用 | `ctrl-bridge` provider (streamSimple → kernel /text-chat) |
| `registerTool` | ✅ 已用 | 10 个 CTRL kernel tool (vault_* / cap_* / brain_status) |
| `unregisterProvider` | ⏭️ N/A | 不会动态卸 provider |
| `registerCommand` | ❌ → ✅ | **P5** — `/cap` / `/discover` / `/note` / `/soul` / `/switch` 等 |
| `registerShortcut` | ⏭️ N/A | Pi interactive mode 键盘 — CTRL 在 PWA 拦键盘 |
| `registerFlag` | ⏭️ N/A | CLI flag — 启动时配置, 不动态 |
| `registerMessageRenderer` | ❌ → ✅ | **P3** — `irisy-suggestion` / `curator-proposal` / `cap-discover` / `reflection-result` / `source-citation` |

### §1.3 Communication (3 surfaces)

| Surface | 状态 | 用途 |
|---|---|---|
| `sendMessage` | ❌ → ✅ | **P4** — 推 custom message (customType + deliverAs) — steering 核心 |
| `sendUserMessage` | ❌ → ✅ | **P4** — 推 user 角色消息 (steer / followUp) — 主动插话 |
| `appendEntry` | ❌ → ✅ | persist session entry 不 trigger turn — episode 用 |

### §1.4 Runtime control (8 surfaces)

| Surface | 状态 | 用途 |
|---|---|---|
| `setActiveTools` / `getActiveTools` | ❌ → ✅ | **P2** — Coding mode 切换时改 tool 集. 移除 `--no-builtin-tools`, 初始 setActiveTools([10 extension]), Coding mode 进入时加 [read/write/edit/bash/grep/find/ls] |
| `getAllTools` | ❌ → ✅ | PWA Discover 显示当前 cap 列表用 |
| `getCommands` | ❌ → ✅ | PWA 显示 slash command 提示用 |
| `setModel` | ⏭️ defer | 运行时切 model — 现有 `provider_set_active` 已能做 |
| `getThinkingLevel` / `setThinkingLevel` | ⏭️ defer v1.1 | 推理深度 (frontier only) |
| `setSessionName` / `getSessionName` | ⏭️ defer v1.1 | 多 session 才有意义 |
| `setLabel` | ⏭️ defer v1.1 | bookmark — session tree 启用后 |
| `exec` | ⏭️ defer | Pi 帮跑 shell — CTRL 走 subprocess_actor 已有 |

### §1.5 UI context (interactive mode only, RPC mode 不可用)

`ExtensionUIContext` 全部 ⏭️ N/A — CTRL 是 PWA, Pi 跑 RPC mode, UI 在 PWA 端独立做.

---

## §2 6 块新接入实施序 (P1-P6)

| # | Pi surface | 实施重点 | 估时 | 依赖 | 文件 |
|---|---|---|---|---|---|
| **P1** | `session_before_compact` + `compact()` | 订阅 event, 把压缩 summary 写 `vault/irisy/compacted/<date>-<session>.md` | 1 d | 无 | `ctrl-pi-bridge/src/index.ts` + 新 `irisy-compaction.ts` |
| **P2** | `setActiveTools` 运行时 tool 切换 | 移除 `--no-builtin-tools` flag. 初始 `setActiveTools([10 extension])`. Coding mode hook 加 7 built-in, 退出时减 | 0.5 d | 无 | `ctrl-pi-plugin/pi-bridge.ts` + bridge 注册 mode handler |
| **P3** | `registerMessageRenderer` 自定义消息 | 定义 5 个 customType + PWA renderer + Accept/Skip/Edit affordance | 1.5 d | PWA tab framework | bridge `register(...)` + 新 `packages/ctrl-web/src/components/irisy/CustomMessage/*` |
| **P4** | `sendMessage` / `sendUserMessage` steering + 7 hooks | bridge 订阅 turn_start / turn_end / tool_execution_end / message_end / agent_start / agent_end / session_shutdown. 翻译 CTRL trigger (vault watch / cron / cap fail / curator cadence) → steer/followUp/nextTurn | 2 d | P3 | bridge `index.ts` + 新 `irisy-steering.ts` (CTRL kernel 端 vault watcher → bridge IPC) |
| **P5** | `registerCommand` slash 命令 | 注册 `/cap` / `/discover` / `/note` / `/soul` / `/switch` 等 7-10 个. 用户 chat 打 `/<x>` 直接路由, 不进 brain 分类 | 1 d | 无 | bridge `register(...)` + PWA 端 autocomplete |
| **P6** | Session tree / fork / navigateTree | 接 Pi sessionManager, 替换 PWA `localStorage` chat 历史. 多 tab + fork + 跳转 | 2 d | P3 (branch UI 用 customType) | PWA `IrisyChat.tsx` 大改 + `chat-storage.ts` 重写 |

**总**: 8 d serial / 4-5 d 双 lane. 推荐序: P1+P2 → P3 → P4 → P5 → P6.

---

## §3 默认 5 决策 (5 open questions, 默认推荐写死, bao 改 ADR 即可改实施)

| # | Question | Default | Rationale |
|---|---|---|---|
| **D1** | 长期记忆要不要 confidence level (high/med/low) | **yes** | Mem0 验证有效, frontmatter 加一字段不增 token, 冲突时高 trust 赢. high = 用户原话/vault原文; med = LLM paraphrase; low = 纯推理 |
| **D2** | 长回复 promote 阈值 | **3 段 或 800 字符 取较松** | Notion AI 阈值 3 段, 加字符上限防"段长但少段" 边界 |
| **D3** | low-confidence 句子怎么显示 | **显示但标灰 + ⚠ pill** | Granola/Perplexity 模式. 不显示 = 信息丢失; 显示不标 = 用户误信 |
| **D4** | compaction summary 落 vault 还是只 Pi 内部 | **落 vault** (`vault/irisy/compacted/<date>-<session>.md`) | vim test. Pi DB 是黑盒, vault summary 用户能 grep + 校对 |
| **D5** | CTRL 自家能力 (vault/cap/brain_status) 走哪 | **Pi tool (`registerTool`), 不绕 MCP/Extension/SKILL** | 直接, 1 hop. 绕 MCP 多一层网络 = 慢, 包 extension = 多文件碎. SKILL 是 NL instruction, 不该装结构化函数 |

bao 改默认: 直接编辑本 ADR 表, code 端按表实施.

---

## §4 影响的现有 ADR (amendment list)

| ADR | 影响 | 改法 |
|---|---|---|
| 002 § brain v1 | Pi sole brain 仍成立, 但加 "用 Pi 所有 surface, 不重发明" 子句 | 加 `§ brain v8 amendment 2026-06-04`: 引 ADR-009 §1 全 surface 表 |
| 002 § brain v7 §1.1 | bridge surface 从 5 个扩到 ~12 个 | 同上 amendment 引 ADR-009 §1 |
| 005 § irisy v4 §7 | "Pi extension integration" 章节超细化 | mark `superseded by ADR-009 §1+§2`, 留指针 |
| 008 § Irisy assistant §2 | 4-layer 中的 L1 Context + L3 Brain 用 ADR-009 surface 实施 | §2 加 cross-ref ADR-009 §2 P1-P6 |
| 004 cap-spec | 已在 ADR-008 §5 #1 标 superseded (cap = SKILL.md / MCP, 不造 schema) | 不动 |

---

## §5 Anti-features (新增 5 条 NOT-do)

OpenClaw VISION.md 模式 — 锁住边界:

1. **NO CTRL-side scheduler / module registry / workflow engine** — 所有调度走 Pi `sendMessage(deliverAs)` API. CTRL 不开 Scheduler Actor / 不写 DAG / 不发明 module contract.
2. **NO 复造 Pi 已有的能力** — session manager / session tree / context compaction / sub-agent / model switching / slash commands / shell exec, 全部 Pi 自带, CTRL 不重写.
3. **NO 自家能力包 MCP server / extension 中间层** — vault / cap / brain_status 走 `registerTool` 直接进 Pi tool 集. 不绕第三方协议.
4. **NO PWA 端 chat 历史持久化层** — 接 Pi `sessionManager` (P6), 不维护独立 localStorage chat history (现有那个 P6 后移除).
5. **NO 替换 Pi extension API** — Pi 升级 npm dep 跟, bridge 不动 (memory `feedback_pi_is_core_use_upstream_surfaces` 锁).

---

## §6 Acceptance

- [ ] §1.1 - §1.4 表里所有 `❌ → ✅` 标记的 surface 都在 ctrl-pi-bridge 接入
- [ ] §2 P1-P6 全部 ship + 各自 1 个 E2E 测试 (playwright + 单测)
- [ ] §3 D1-D5 决策落进代码 (frontmatter schema / promote 阈值常量 / 渲染 pill / vault 路径 / registerTool wiring)
- [ ] §4 ADR-002 / 005 / 008 amend 完, 不留漂移
- [ ] §5 5 条 anti-features 各有 1 处代码 / 文档 enforcement
- [ ] 验证: 删 PWA 端 chat localStorage 持久化代码, 切 Pi sessionManager, 历史不丢
- [ ] 验证: Coding mode 进入时 `getActiveTools()` 含 read/write/edit/bash; 退出时减
- [ ] 验证: 长对话超 context window 时 `session_before_compact` 触发, summary 落 `vault/irisy/compacted/`
- [ ] 验证: tool 失败时 `tool_execution_end isError=true` 触发, 自动 inject reflection followUp

---

## §7 References

- Pi 0.73 ExtensionAPI verbatim: `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
- ADR-002 substrate (brain v1, brain v7 §1.1)
- ADR-005 irisy v4 §7 (即将 superseded by 本 ADR §1+§2)
- ADR-008 Irisy assistant (§2 4-layer 引 本 ADR §2 实施细则)
- Memory: `feedback_pi_is_core_use_upstream_surfaces` (2026-05-31), `decision_pi_is_sole_brain_hermes_is_keycap` (2026-05-28), `feedback_adr_code_comments_are_truth` (2026-05-31), `feedback_no_redundancy_one_ssot`
- Brainstorm: `irisy-pipeline-2026-06-04.md` (Pi/Letta/Cline/Goose/Cursor 对标 §3), 个人助理 SOTA agent report (2026-06-04 §1), OpenClaw/Hermes agent report (2026-06-04)
- SOTA verbatim quotes 见 brainstorm `irisy-reply-specs-2026-06-04.md` §0 + §10
