---
title: PTY crate survey for SubprocessActor
lane: lane-G
handoff: H-2026-05-19-001
status: pre-ADR-012 input
---

# PTY crate 选型 (Code Space path C)

CLI/TUI 输出 ingest 需真 PTY (`isatty=true` 给彩色 + 交互 prompt)，纯 stdio pipe 不够。
跨平台目标 = Win 10+ ConPTY + macOS 13+ + Linux Unix PTY。

## 3 候选对比

| Crate | Win | Async | 用例 | 决断 |
|---|---|---|---|---|
| **portable-pty** (wezterm) | ✅ ConPTY | blocking + `spawn_blocking` + mpsc | wezterm / zellij 生产 | ✅ 推荐 |
| pty-process | ❌ Unix only | 原生 tokio | 小巧 | ❌ 没 Windows = 装机半砍 |
| tokio::process (stdio pipe) | ✅ | 原生 | 标准 | ❌ 无 isatty, TUI / 颜色坏 |

## 推荐 = portable-pty

- 唯一覆盖 ConPTY + Unix PTY
- 接口干净: `PtySystem::openpty()` → `MasterPty` + `Child`，reader/writer 独立线程
- 5 primitives 不破: `EffectExecutor` 起 `spawn_blocking`，Actor 只持 pid
- bundle ~150KB，kernel ≤ 18MB 预算内

## 参考

- portable-pty: github.com/wez/wezterm/tree/main/pty
- zellij `zellij-server/src/pty.rs` (production-grade 用法)

接口决断 (新 Effect variant / chunk 边界 / resize 语义) → 见 `02-actor-sketch.md` §7。
