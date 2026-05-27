---
id: H-2026-05-22-002
title: mac shell hotkey reset — try_lock → lock + hide-path mirror (themis HIGH+MEDIUM)
severity: P1
status: open
reporter: zeus
assigned_to: athena
lane: lane-E
touches:
  - src-tauri/src/shell/hotkey.rs
  - src-tauri/src/shell/window.rs
related:
  - H-2026-05-19-002    # parent: macOS overlay/tray/hotkey bug — APPROVE_WITH_WARNINGS, blocks verified flip
  - H-2026-05-14-002    # mac shell migration
project_id: ctrl-v1-ship
category: bugfix
created: 2026-05-22
updated: 2026-05-22
---

## bao approval

- bao implicit: zeus dispatches via themis verdict (APPROVE_WITH_WARNINGS on parent H-2026-05-19-002, 2026-05-22). bao explicit ack inherited from H-2026-05-19-002 + PR #23 acceptance.

## Outcome (ship value, 1 句)

Close the residual fragility flagged by themis on H-2026-05-19-002 so the mac hotkey state machine cannot re-enter the 2-3-cycle desync under lock contention. After this lands zeus flips H-2026-05-19-002 → `verified`.

## Findings (themis 2026-05-22)

### HIGH — `src-tauri/src/shell/hotkey.rs:475`

`reset_hotkey_state()` currently uses `state_cell.try_lock()`. The CGEventTap callback runs on a real-time thread; concurrently, the main thread may call `toggle()` → `reset_state()`. If the mutex is held during contention, `try_lock` silently returns `None` and the reset is dropped — this is exactly the failure mode PR #23 was patching (state desync after 2-3 cycles).

**Fix options** (athena decides):
- `lock()` + accept potential brief blocking on RT thread (preferred if the critical section is short, which it is — single bool flip).
- `lock().unwrap_or_else(|_| { tracing::warn!("hotkey reset_state lock contention"); return; })` — log + bail, never silent.
- If athena identifies a deadlock risk (lock holder calls back into reset_state in the same chain), document the cycle and pick the variant that breaks it (e.g. clone-and-swap pattern).

### MEDIUM — `src-tauri/src/shell/window.rs:93`

`reset_state()` currently fires only on the **show** path. Mirror it on the **hide** path so a modifier-flag race during hide cannot leave the state machine in a corrupt position for the next tap. Symmetric to Win's `cloak::set(false)` calling reset.

## Critical constraint

- **Lane**: lane-E (athena, `src-tauri/src/shell/**` only). Denylist: CLAUDE.md / MEMORY.md / .olym/decisions/** / .olym/specs/** / .claude/hooks/**.
- Commit prefix: `[H-2026-05-22-002][lane-E]`.
- 不破 Windows 路径 (Win 走 DWM cloak, 不动)。
- 不放 `--no-verify`。

## Acceptance

- [ ] `hotkey.rs:reset_hotkey_state` 改 `lock()` 或带 warn 的 fallback；comment 一行说明为什么不能 `try_lock`
- [ ] `window.rs` hide path 加 `reset_state()` 调用，mirror show path
- [ ] `cargo check --target aarch64-apple-darwin` 0 warning 新增
- [ ] athena live-smoke: 30 连击 `Ctrl` (≥ 10× 比 PR #23 的 10+ cycle 更激进), 0 漂移
- [ ] PR 用 themis 走 review (tier C — lane-internal, 2 文件, < 30 LOC). APPROVE → zeus 同 PR 内顺手翻 H-2026-05-19-002 status → verified.
- [ ] 本 handoff 自身翻 done → zeus verify → verified

## 讨论 / 备注

(athena 接手)
