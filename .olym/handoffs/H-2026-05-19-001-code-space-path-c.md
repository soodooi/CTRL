---
id: H-2026-05-19-001
title: Code Space path C — SubprocessActor + portable-pty 落地
severity: P0
status: done
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
updated: 2026-05-22
completed: 2026-05-22
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

- [x] `portable-pty = "0.9"` 加 src-tauri/Cargo.toml (PR #6 ea2bb3a... wait actually f058c0c)
- [x] `src-tauri/src/kernel/subprocess_actor.rs` 实 Actor trait (PR #6)
- [x] 6 个 `Subprocess.*` Event variant 加 event.rs (PR #6)
- [x] Runtime/scheduler 能从 manifest spawn SubprocessActor (prototype="subprocess") (PR #6)
- [x] Supervisor 三约束: panic catch / 256 MB cap / on_shutdown close PTY (PR #6 + themis fixes 16cc5bf)
- [x] e2e 验证 `bash` (e2e_bash_echo_exit_code_7 test in PR #6, 17/17 pass)
- [ ] CLAUDE.md stack 表加行（zeus 主树 follow-up, 不阻塞 handoff close）
- [x] 自测命令 + 输出 paste — PR #6 themis verdict APPROVE_WITH_WARNINGS + 17/17 tests
- [x] **NEW** Z1 adapter (PR #16 merged) — subprocess_stss_adapter + commands/code_space + 6 Tauri commands; wire 跟 ST-SS spec v0.7 对齐 (lane-C C1)
- [x] **NEW** Tauri command surface 完整: cs_spawn / cs_stdin / cs_signal / cs_resize / cs_kill / cs_list
- [~] **NEW** PWA `/code-space/$envId` route + xterm.js (lane-B Phase 2 in flight, 2 mismatch 修中 — cell name + Tauri invoke 路径)

## Blocker

blocker 时直接 ping bao + 在本 handoff `## 讨论` 块写 `@zeus 需要 ... 因为 ...`。不要等 themis。

## 讨论 / 备注

### 2026-05-20 zeus session 进展

**已完成（落 main）**:
- PR #6 ea2bb3a (实际 f058c0c) — SubprocessActor + portable-pty (ADR-012)
- PR #12 — ADR-007 amend (vodozemac 0.10 native check)
- PR #16 — Z1 wire adapter + 6 Tauri commands + ST-SS spec v0.7 Rust enum 扩 (本 handoff §7/§8 范围)

**待 merge**:
- PR #14 lane-C ST-SS spec v0.7 vocabulary + kind.ts (themis 2 HIGH 修中)
- PR #15 lane-C jiazuo capability surface RESULT.md (themis APPROVE, verify status flip)
- PR #8 lane-D mesh design + crypto spike (themis 2 HIGH 修中)
- lane-B Phase 2 PR (PWA viewer wire, 2 mismatch 修中)

**关闭 acceptance 条件**: lane-B Phase 2 PR + lane-C PR #14 都 merge 后 → handoff status open → done。zeus follow-up = CLAUDE.md stack 表加 portable-pty + ST-SS spec v0.7 行。

(lane-G 进度更新写这里)
