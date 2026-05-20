---
adr_id: 012
title: SubprocessActor + portable-pty execution model for Code Space coding companion
status: proposed
date: 2026-05-19
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/handoffs/H-2026-05-19-001-code-space-path-c.md
  - packages/ctrl-web/src/routes/irisy.tsx
  - src-tauri/src/kernel/actor.rs
scope: framework
supersedes: []
superseded_by: []
---

## Context

Irisy 的 Code Space 已经有 PWA 端 3×4 tile UI（lane-A daedalus 已 ship）。bao 2026-05-18 钦定 **path C**：v1 ship 前必须落地 SubprocessActor + PTY，让每个 Code Space tile 能 host 一个长生命周期的子进程（Claude Code / Cursor / aider / plain bash 等任意 CLI 工具），实时双向 stream。

这是 coding companion vs Doubao 的关键差异化（Doubao 没有"我在终端开个 Claude，让 Irisy 旁观 + 帮我说话"这条线）。

现状缺口：

- `src-tauri/src/kernel/actor.rs` 只有 Actor trait 抽象，没有 "长生命周期 + 进程绑定 + IO stream" 的具体实现
- Kernel 5 primitives (Actor / Capability / Event / Channel / Effect) 够用，但需要一个**具体 Actor 实现**承载 subprocess 生命周期
- PTY 处理跨平台不简单（Unix forkpty vs Windows ConPTY），不能 hand-roll

## Decision

### 1. SubprocessActor = Actor trait 的具体实现，不是新 primitive

- 文件：`src-tauri/src/kernel/subprocess_actor.rs`
- 实现 `Actor` trait（不破 5 primitives 抽象）
- State 持 `Box<dyn portable_pty::Child>` + `MasterPty` 句柄 + capability + tile metadata
- Lifecycle = `on_spawn` 拉子进程 → `handle(Event)` 处理 stdin/resize/signal → `on_shutdown` kill + close PTY

### 2. PTY 抽象层选 portable-pty crate

- v0.9.x，跨平台（Unix pty + Windows ConPTY 自动适配）
- Mozilla / wezterm 在生产用，crates.io 月下载 50k+
- 不重写 vt100 / xterm 终端模拟器（PWA 端用 xterm.js）

### 3. Event 设计（kernel ↔ subprocess）

入向 Event（PWA → kernel → SubprocessActor）：
- `Subprocess.Stdin(bytes)` — 用户键入
- `Subprocess.Resize { cols, rows }` — 终端尺寸变更
- `Subprocess.Signal(SIGINT / SIGTERM / SIGKILL)` — 终止

出向 Event（SubprocessActor → kernel → PWA via Channel）：
- `Subprocess.Stdout(bytes)` — 原始字节流（含 ANSI escape）
- `Subprocess.Exit { code, signal }` — 退出
- `Subprocess.Spawned { pid }` — 启动成功

### 4. Manifest schema 扩展

`ActorManifest.prototype = "subprocess"` 时，`initial_state` 含：

```json
{
  "command": "claude-code",        // 可执行文件名/路径
  "args": ["--workspace", "$CWD"], // 启动参数（支持 env 占位）
  "env": { "CTRL_TILE_ID": "abc" },
  "cwd": "$HOME/projects/foo",
  "pty": { "cols": 80, "rows": 24 }
}
```

### 5. Lifecycle 与 supervisor 约束

- 单 SubprocessActor 失败 **不许** crash 整个 kernel runtime（panic catch + emit Error Event）
- 资源上限：每个 SubprocessActor 默认 256 MB RAM cap（用 OS rlimit / Job Object）；超过 → kill + emit OOM Event
- Code Space 12 tile × N user concurrent — Scheduler 用 `ActorPriority::UserAction` 排程

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Tokio `Command` 裸子进程（无 PTY） | TUI 工具（vim/claude-code/cursor）需要 PTY 才能渲染光标、颜色、resize；裸 stdin/stdout 会 buffer 行级 = TUI 烂掉 |
| A2 | 自己写 vt100/xterm 模拟器（Rust 侧解析 ANSI） | 工作量大（≈3 万 LOC 历史教训：alacritty / wezterm），scope 严重失控，且 PWA 已用 xterm.js 解析端 |
| A3 | macOS-only tty crate + Win-only ConPTY crate 分别接 | portable-pty 已经做了这层封装，自己拼 = double work + 平台分支炸开 5 primitives |
| A4 | Tauri command per spawn（无 Actor 包装） | Tauri command 是请求-响应模型；长生命周期 + 双向 stream 与 command 模型对抗；最终需要 Channel + state = 等于重造 Actor |
| A5 | WASM 沙盒子进程（不直接调本机进程） | 用户安装的 Claude Code / Cursor 是 native binary，必须本机执行；WASM 沙盒不能跑 OS 进程，路径不通 |

## Consequences

**Positive**:
- Code Space 12 tile 每个可 host 任意 CLI 工具（Claude Code / Cursor / aider / bash / fish / etc.）— 真正的"coding companion"
- 复用 Actor trait + 5 primitives，不增加新 kernel primitive
- portable-pty 跨平台一份代码，不写 cfg 分支
- 后续硬件 keycap / 长生命周期 daemon keycap 都可复用此 actor 模式

**Negative / cost**:
- portable-pty 加约 150 KB binary（接受范围，kernel binary 上限 18 MB 还有空间）
- Windows ConPTY 在 Win 10 1809+ 才稳，older Win 不支持 — 与 CTRL minimum platform Win 10 1809+ 对齐 ✓
- PTY 资源（fd / handle）泄漏风险，要严格 `on_shutdown` close

**Reversal cost**:
- Medium — 实装后 reversal ~5 天。换 PTY crate（如 wezterm-term）便宜（~3 天），但**完全不用 PTY**（A1 方向）= 等于砍 coding companion 差异化 = 反向 v1 战略，不可逆等同放弃此 ADR.

## Acceptance

- [ ] `portable-pty = "0.9"` 加入 `src-tauri/Cargo.toml`
- [ ] `src-tauri/src/kernel/subprocess_actor.rs` 实装 SubprocessActor 持 portable-pty Child + MasterPty
- [ ] `Subprocess.{Stdin,Resize,Signal,Stdout,Exit,Spawned}` 6 个 Event variant 加入 `kernel/event.rs`
- [ ] Kernel runtime / scheduler 能从 ActorManifest（`prototype: "subprocess"`）spawn SubprocessActor
- [ ] panic catch + OOM 上限 + on_shutdown close PTY 三项 supervisor 约束写到代码
- [ ] 至少 1 个 CLI 工具端到端验证（推荐 `aider --no-stream` 或 plain `bash`，验证基本 stdin/stdout/exit 路径）
- [ ] Code Space tile UI（lane-A daedalus）wire `Channel<Subprocess.*>` → xterm.js 显示（独立 handoff，不阻塞本 ADR accepted）
- [ ] CLAUDE.md `## Stack` 表加一行 "Subprocess execution | portable-pty 0.9 (Unix forkpty + Windows ConPTY)"
- [ ] ADR-INDEX 把 012 从 Reserved 移到 Active

## Changelog

| Date | Change |
|---|---|
| 2026-05-19 | Initial proposed (zeus); drafted in main tree for lane-G H-2026-05-19-001 启动依据 |
