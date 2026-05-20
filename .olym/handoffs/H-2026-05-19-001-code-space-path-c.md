---
id: H-2026-05-19-001
title: Code Space path C — SubprocessActor + portable-pty 落地
severity: P0
status: in_progress
reporter: zeus
assigned_to: zeus
lane: lane-G
touches:
  - src-tauri/Cargo.toml
  - src-tauri/src/kernel/actor.rs
  - src-tauri/src/kernel/event.rs
  - src-tauri/src/kernel/runtime.rs
  - src-tauri/src/kernel/scheduler.rs
  - src-tauri/src/kernel/subprocess_actor.rs   # NEW
  - doc/code-space-path-c/**
related:
  - .olym/decisions/012-subprocess-actor-pty.md   # 实装依据 ADR
  - H-2026-05-18-001                              # Irisy lane-A，下游 Code Space tile UI 消费 SubprocessActor Events
project_id: ctrl-v1-ship
category: feature
created: 2026-05-19
updated: 2026-05-19
---

## bao approval

- bao verbal-go: 2026-05-19: "干" (after ADR-012 摘要 review，对 SubprocessActor + portable-pty + 5 alternatives rejected 全套方案 ack)
- 关联 memory: `project_code_space_path_c.md` ("bao chose path C: build SubprocessActor + portable-pty before v1 ship")

## Outcome

Code Space 12 tile 任意一个能 host 一个长生命周期的 CLI 工具子进程（Claude Code / Cursor / aider / bash），完整支持 TUI（光标 / 颜色 / resize），双向 stream。是 v1 ship 阻塞项 + 对 Doubao 的关键差异化。

## Critical constraint

- Lane: stay in **lane-G** scope（src-tauri/src/kernel/**, Cargo.toml, doc/code-space-path-c/**）
- Commit policy: 每个 commit 前缀 `[H-2026-05-19-001]`
- Denylist: 不动 CLAUDE.md / MEMORY.md / .olym/steering/** / .olym/decisions/** / .claude/hooks/** 
- 不破 5 kernel primitives 抽象（SubprocessActor 是 Actor 具体实现，**不是**新 primitive）
- 不跳 git hooks，不 `--no-verify`
- 不写 vt100 模拟器（PWA xterm.js 负责）
- 不分平台手写 PTY（必须 portable-pty 0.9 cross-platform）

## Acceptance（与 ADR-012 §Acceptance 同步）

- [ ] `portable-pty = "0.9"` 加 src-tauri/Cargo.toml
- [ ] `src-tauri/src/kernel/subprocess_actor.rs` 实 Actor trait
- [ ] 6 个 `Subprocess.*` Event variant 加 event.rs
- [ ] Runtime/scheduler 能从 manifest spawn SubprocessActor (prototype="subprocess")
- [ ] Supervisor 三约束: panic catch / 256 MB cap / on_shutdown close PTY
- [ ] e2e 验证 ≥1 CLI 工具（推荐 `bash` 起步）
- [ ] CLAUDE.md stack 表加行（zeus 主树负责，不在 lane-G 做）
- [ ] 自测命令 + 输出 paste 在本 handoff `## 讨论` 里

## Blocker

blocker 时直接 ping bao + 在本 handoff `## 讨论` 块写 `@zeus 需要 ... 因为 ...`。不要等 themis。

## 讨论 / 备注

(lane-G 进度更新写这里)
