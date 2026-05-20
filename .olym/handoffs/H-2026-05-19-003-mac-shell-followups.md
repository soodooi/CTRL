---
id: H-2026-05-19-003
title: mac shell follow-ups — single-instance lock, AX prompt, bundle id rename
severity: P1
status: open
reporter: zeus
assigned_to: athena
lane: lane-F
touches:
  - src-tauri/Cargo.toml                       # +tauri-plugin-single-instance
  - src-tauri/src/lib.rs                       # register single-instance plugin
  - src-tauri/src/shell/lifecycle.rs           # AX permission first-launch prompt
  - src-tauri/tauri.conf.json                  # bundle id rename
  - src-tauri/src/bin/setup_llm_key.rs         # bundle id rename
  - src-tauri/src/shell/keychain.rs            # bundle id rename
related:
  - H-2026-05-14-002   # parent mac migration (now done modulo these)
  - H-2026-05-19-002   # 3-symptom bug (resolved by mac/d-f, this batches the surfaced follow-ups)
project_id: ctrl-v1-ship
category: chore
created: 2026-05-19
updated: 2026-05-19
---

## bao approval

- bao verbal-go: 2026-05-19: "好，都同意" (consolidate 4 follow-ups into 1 handoff after mac/d-f land)

## Outcome

mac shell production-ready：单实例锁住 port 17872、首次启动引导用户开 macOS 辅助功能权限、bundle id 从 `app.ctrl.spike` 改名 `app.ctrl`。3 件事完成 → mac 路径无遗留尾巴，可进 v1 release pipeline。

## Critical constraint

- Lane: stay in **lane-F** scope（src-tauri/**）
- Commit policy: 每个 commit 前缀 `[H-2026-05-19-003]`
- Denylist: 不动 CLAUDE.md / MEMORY.md / .olym/decisions/** / .olym/steering/**
- 不破 Windows 路径（mac/* sub-PR 已 mirror Win）
- bundle id 改名要全局一致（tauri.conf.json + setup_llm_key.rs + shell/keychain.rs；漏一处 → keychain 服务名不一致 → 老用户失 key）

## Acceptance

- [ ] `tauri-plugin-single-instance` 加 Cargo.toml + lib.rs 注册；第二实例启动 → 唤起第一实例 + 退出（不抢 port 17872）
- [ ] `shell/lifecycle.rs` 首次启动检测 `kAXTrustedCheckOptionPrompt`（CGEventTap 需要），未授权 → 弹原生引导窗 + 跳转系统设置面板
- [ ] bundle id `app.ctrl.spike` → `app.ctrl` 全局改名（grep 确认 0 残留）
- [ ] keychain 旧条目 `app.ctrl.spike` migrate 到 `app.ctrl`（or 启动时双查 + 写回新名）
- [ ] mac live smoke 重跑 Ctrl × 9（确保 single-instance + 改名不引入 regression）
- [ ] 自测命令 + 输出 paste 在本 handoff `## 讨论` 里

## Blocker

blocker 直接在 `## 讨论` 块 ping zeus / bao。

## 讨论 / 备注

(lane-F 进度更新写这里)
