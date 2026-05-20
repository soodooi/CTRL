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

### 2026-05-20 — athena (lane-E) — 3 follow-ups 全落, mac live smoke 待跑

PR #4 squash-merge 进 main (`ea2bb3a`) 后, 在 origin/main 开 `feat/h-2026-05-19-003-mac-followups` 接 H-003. 单 commit, 6 文件 +120 / -7.

| 验收项 | 实施 | evidence |
|---|---|---|
| single-instance plugin | `Cargo.toml` 加 `tauri-plugin-single-instance = "2"`; `lib.rs` 在 Mac + Win 两条 `pub fn run()` 把 `tauri_plugin_single_instance::init(focus_existing_on_second_launch)` 注册为**首个**插件 (early-bind so kernel / hotkey / tray 不再为 port 17872 + 全局 Ctrl hook 抢位) | `lib.rs` `focus_existing_on_second_launch` show + unminimize + set_focus 主窗 |
| AX prompt | `shell/lifecycle.rs` 加 `#[cfg(target_os = "macos")] mod ax` inline FFI 到 `ApplicationServices.framework`, install hotkey 前调 `AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: true})` (CFDictionary 构造走 core-foundation, 不加新 crate). 未授权 → 系统弹原生 alert + 跳隐私面板; 不阻塞其它 boot 步骤 (log warn 后继续, 用户授权后下次启动自动 fire) | `lifecycle.rs` `mod ax` |
| bundle id rename | `tauri.conf.json` `identifier` 改 `app.ctrl`; `bin/setup_llm_key.rs` `SERVICE` 改 `app.ctrl` (`shell/keychain.rs` runtime side 已经是 `app.ctrl`, 这次只补 CLI 一致) | grep 0 残留 (LEGACY_SERVICE 常量除外) |
| keychain migration | `KeychainStore::get` 在 `app.ctrl` `NoEntry` 时 fall back 到 `LEGACY_SERVICE = "app.ctrl.spike"`, 命中则 copy 到新名 + best-effort delete 老名; `KeychainStore::delete` 顺手 sweep 老名残留 — 老用户 dev install 第一次读 BYOK key 时静默 migrate | `keychain.rs` `migrate_legacy` fn |
| mac live smoke (Ctrl × 9) | **待** — 需要 bao 在 MacBook 跑 `npx tauri build --target aarch64-apple-darwin` (~5 min on M-series) + tap Ctrl 9 次 + 2nd `open /Applications/CTRL.app` 看 focus 行为. mac/f 已经在装好的 app 上 9/9 pass, 这次 follow-up 不动 hotkey 路径, 主要验单实例 + AX prompt 行为 |

#### evidence

```bash
$ cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin
warning: `ctrl` (lib) generated 26 warnings (run `cargo fix --lib -p ctrl` to apply 15 suggestions)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 24.49s
# 0 errors. 26 warnings = pre-merge baseline (无新 warning).

$ grep -rn "app.ctrl.spike" --include="*.rs" --include="*.toml" --include="*.json" src-tauri/
src-tauri/src/shell/keychain.rs:14:// Production service identifier. Was `app.ctrl.spike` during the P0/P1 spike;
src-tauri/src/shell/keychain.rs:20:const LEGACY_SERVICE: &str = "app.ctrl.spike";
# 仅 LEGACY_SERVICE migration 用 — 预期保留.
```

#### 待 bao live smoke 验

- [ ] 启动 `/Applications/CTRL.app` (装新构建) — 首启出现 macOS Accessibility 系统 alert (如果之前权限被撤销 / 重命名后认作新 app)
- [ ] tap Ctrl × 9 — 9 次都 toggle 主窗 SHOW/HIDE (跟 mac/f 9/9 一致)
- [ ] 再 `open /Applications/CTRL.app` (启第二实例) — 第二实例立即退出, 第一实例主窗 focus
- [ ] 关闭后再启 — 不再弹 AX alert (一次 grant 持续)

build + live test 命令完整序列:

```bash
cd .worktrees/lane-E
npm install                  # 拉新依赖 (single-instance 等)
npx tauri build --target aarch64-apple-darwin
# 然后 bao 拖 target/aarch64-apple-darwin/release/bundle/macos/CTRL.app 进 /Applications
# 真机走 4 项 live smoke
```

push 到 `origin/feat/h-2026-05-19-003-mac-followups` 后 PR 开 → `[H-2026-05-19-003] mac shell follow-ups`.
