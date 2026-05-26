---
id: H-2026-05-22-001
title: Code Space companion pane — Irisy ↔ live terminal 闭环 (coding companion 临门一脚)
severity: P0
status: in_progress
reporter: zeus
assigned_to: daedalus
lane: lane-A
touches:
  - packages/ctrl-web/src/routes/code-space.tsx
  - packages/ctrl-web/src/routes/code-space.module.css
  - packages/ctrl-web/src/components/code-space/CompanionPane.tsx           # NEW
  - packages/ctrl-web/src/components/code-space/CompanionPane.module.css   # NEW
  - packages/ctrl-web/src/hooks/useTerminalBuffer.ts                       # NEW
  - packages/ctrl-web/src/personas/irisy/code-companion.ts                 # NEW
related:
  - H-2026-05-19-001    # SubprocessActor + portable-pty (done) — 底座
  - H-2026-05-18-001    # Irisy keycap-creator — 复用 LLMTransport / ChatPane pattern
  - .olym/decisions/012-subprocess-actor-pty.md
  - .olym/decisions/005-no-claude-in-production-runtime.md
project_id: ctrl-v1-ship
category: feature
created: 2026-05-22
updated: 2026-05-22
---

## bao approval

- bao verbal-go: 2026-05-22 — zeus 提 3 个前端 ship value 选项 (Irisy↔Code Space 闭环 / PWA polish v1 / Code Space 多 session)，bao 选 #1 ("Irisy ↔ Code Space 闭环"). 关联 memory: `project_code_space_path_c.md` + `decision_irisy_as_coding_companion.md`.

## Outcome (ship value, 1 句)

`/code-space/$envId` 路由从 "单 xterm + stdin 转发" → "**xterm + Irisy companion side-pane (LLM 看 stdout、给建议、能反向送命令)**"。这是 coding companion 真正成型的临门一脚，对 Doubao / Warp / Cursor 的差异化卖点全在这一刀。

## Critical constraint

- **Lane**: lane-A (前端)。touches list 之外**严禁**碰 (尤其 src-tauri/** / .olym/decisions/** / kernel.ts 的 typegen)
- **No Claude in production** (ADR-005): companion 走 `defaultTransport()` (`ChatStreamTransport` enabled / 兜底 `RunKeycapTransport('ctrl.builtin.text-chat')`). 不准出现 `anthropic` / `claude-3` / Claude API 任何 string
- **No mock data** (memory `feedback_no_mock_data_in_production`): 接真 `useSubprocessChannel` + 真 `defaultTransport()`. 任何 `mock-*.ts` = 立刻 reject
- **代码全英文** (CLAUDE.md): 注释 / UI 文本 / placeholder / error 全英. 中文只在 handoff 讨论 + commit body
- Commit prefix: `[H-2026-05-22-001][lane-A]`
- 禁止 `--no-verify`

## Deliverables (10 item, 顺序)

1. **`hooks/useTerminalBuffer.ts`** — 维护一个 ring buffer (default 32 KB) 接 `onTerminalOutput` byte stream → 暴露 `getRecentText(maxBytes?)` 返回 utf-8 decoded text. 处理 mid-codepoint truncation 用 `TextDecoder({ fatal: false })`. Pure hook, 不持组件状态.

2. **`personas/irisy/code-companion.ts`** — export `CODE_COMPANION_SYSTEM_PROMPT` (英文，<200 词，定义角色 = "live coding companion observing the user's terminal session, suggests next commands, explains errors, never executes destructively without confirmation") + `composeContext({ recentStdout, envId, userMessage })` 函数把 stdout buffer 注成 user-turn 的 context 块.

3. **`components/code-space/CompanionPane.tsx`** — Side panel 组件. Props: `{ envId: string; recentStdout: () => string; onSendToTerminal: (text: string) => void; }`. 用 `defaultTransport()` 串 chat. 流式渲染 (deltas accumulate). 渲染 markdown-lite (用现有 lib 或简单 fenced-code 提取). 维护 messages state.

4. **CompanionPane 抽 fenced ` ```bash ` / ` ```sh ` block** → 在 assistant 消息底显示 `[Send to terminal]` 按钮 → click → `onSendToTerminal(code)` (parent route 转给 `channel.writeStdin`). 多 block 都各自一个按钮.

5. **CompanionPane abort 支持**：每条 in-flight assistant 消息可 cancel (走 `LLMStreamOptions.signal: AbortController`).

6. **`code-space.tsx` (CodeSpaceDetailRoute)**:
   - 引入 `useTerminalBuffer`, hook 进 `onTerminalOutput` (跟现有 `terminalRef.current?.write(bytes)` 并存)
   - 加 split 状态: `'terminal' | 'split' | 'companion'` (default `'split'`). 头部 segmented control 切换.
   - layout 改 grid: 桌面 (>900px) `split` → 左 terminal / 右 companion 50/50; mobile (≤900px) → tab 切换 (不同时显示)
   - `onSendToTerminal` impl: `channel.writeStdin(encoder.encode(text + '\n'))` + `pushLog(\`> ${text}\` , 'info')`

7. **CSS** (`code-space.module.css` 加 `.csdSplit`, `.csdCompanion`, `.csdModeSegmented`, `.csdModeButton`, `.csdModeButton_active`): 沿用现有 tokens. companion pane 背景 `var(--color-surface-2)` 或同 rail. mobile breakpoint @ 900px.

8. **空态 + error 态**: companion 默认状态 = "Ask Irisy about this session…" placeholder. LLM error → 红底 inline error + retry. ChatStreamTransport disabled fallback path 必须工作 (现在它 enabled=true, 但 transport 本身有 disabled 兜底).

9. **键盘**: companion input `Enter` submit, `Shift+Enter` newline. terminal 区域焦点优先 (xterm 自己接). 不抢 ctrl/cmd hotkey.

10. **自测**:
    - 起 `pnpm tauri dev`, `/code-space` 列表 → spawn 一个 `bash -l` → 进 detail → split 模式默认见 xterm + companion
    - 在 xterm 敲 `ls && echo hello`, 回车 → companion 输入 "what did I just run?" → LLM 回答含 `ls` / `hello`
    - LLM 回答包 ` ```bash ` 块 → `[Send to terminal]` 按钮可见且点击注入 stdin
    - 切到 `terminal` only / `companion` only / `split` 三态都正常
    - mobile viewport (chrome devtools 375x812) 用 tab 切，无重叠

## Acceptance

- [ ] 10 deliverable 全做
- [ ] `npm --workspaces --if-present run typecheck` 0 错 (ctrl-web 那一段)
- [ ] `npm --workspace @ctrl/web run build` 0 错
- [ ] grep `mock-` / `claude` / `anthropic` / `sk-` 命中 0 (production 路径)
- [ ] 自测 6 条全 pass + 在本 handoff `## 讨论` 贴一张 split-mode 截图
- [ ] PR 用 themis 走 review (tier B, cross-cutting because touches new persona + new hook + route logic), zeus 收 verdict 后翻 verified

## 讨论 / 备注

(daedalus / 前端 subagent 在此追加进展)
