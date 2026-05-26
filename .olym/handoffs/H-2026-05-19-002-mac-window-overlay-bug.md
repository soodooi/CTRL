---
id: H-2026-05-19-002
title: macOS CTRL shell broken — window covers desktop, no menu bar tray, hotkey dead
severity: P0
status: done
resolved_by:
  - 7b0d186  # mac/d — Cargo.toml deps cleanup
  - e1a0ced  # mac/e — bundle config + brand .icns
  - 2c4e8e2  # mac/f — release build + live smoke 9/9 pass
resolution_note: |
  athena live-smoke confirmed 9/9 clean SHOW↔HIDE on Ctrl tap (bao tested
  /Applications/CTRL.app); window does not cover desktop, hotkey works,
  menu bar tray active. All 3 reported symptoms resolved.
  Awaiting bao verify → flip to verified per PROCESS.md §2.
reporter: zeus
assigned_to: athena
lane: lane-F
touches:
  - src-tauri/tauri.conf.json
  - src-tauri/src/shell/window.rs
  - src-tauri/src/shell/hotkey.rs
  - src-tauri/src/shell/tray.rs
  - src-tauri/src/shell/lifecycle.rs
  - src-tauri/src/shell/mod.rs
  - src-tauri/Cargo.toml  # macOS-specific deps if needed (objc / cocoa)
related:
  - H-2026-05-14-002  # mac shell migration (parent lane)
project_id: ctrl-v1-ship
category: bugfix
created: 2026-05-19
updated: 2026-05-19
---

## bao approval

- bao verbal-go: 2026-05-19: "打开ctrl后，其他页面就消失了... 桌面只有ctrl了，应该是在原页面上层打开"

## 现象（3 个）

bao 在 Mac 上：

1. 启动 CTRL 后，其他 app 从桌面消失，只剩 CTRL（应该是 overlay 浮在原 app 上）
2. macOS 菜单栏（右上角 status bar）没有 CTRL 常驻图标（应有 tray icon）
3. 按 `Ctrl` 热键无响应，无法唤起/收起 CTRL

期望：CTRL = floating overlay + menu bar 常驻 + Ctrl 唤起/收起 toggle。

## 证据 / 线索

**window**:
- `src-tauri/tauri.conf.json` 当前 920×560 / `decorations:false` / `alwaysOnTop:true` / `visibleOnAllWorkspaces:true` / `skipTaskbar:true` / `focus:false`
- `src-tauri/src/shell/window.rs` `prewarm` 和 `toggle` 全部 Windows DWM cloak 路径 (`#[cfg(target_os = "windows")]`)，Mac 没等价
- 注释说明 cloak 是 WebView2 DComp surface 旁路 WS_VISIBLE bit 的 Windows-only 修复；mac WKWebView 不存在该问题，但**也没人写 mac 端的 hide/show**
- 可能：`visibleOnAllWorkspaces:true` 在 Mac 上副作用、或缺 macOS-specific NSWindow level/collectionBehavior 配置

**tray**:
- `src-tauri/src/shell/tray.rs` 检查是否带 `#[cfg(target_os = "macos")]` 分支；Tauri 2 tray API 跨平台但 mac status bar template 图标格式特殊（need template image，黑白 PDF / 单色 PNG）

**hotkey**:
- `src-tauri/src/shell/hotkey.rs` 检查 mac 端注册（`#[cfg(target_os = "macos")]` 分支）；mac 上 Ctrl 单键常被系统占用（emoji popup / character viewer），可能需要走 `tauri-plugin-global-shortcut` mac 实现或改默认快捷键 (`Cmd+Space`-like)

## 建议

1. **三连复现**：`npm run tauri dev` → 观察启动后 (a) 其他 app 是否消失 (b) 菜单栏图标 (c) Ctrl 热键
2. window: 加 `#[cfg(target_os = "macos")]` 的 NSWindow hide/show；先临时关 `visibleOnAllWorkspaces` 测对照
3. tray: 跑通 mac status bar tray；准备 template 单色图标
4. hotkey: 优先用 `tauri-plugin-global-shortcut` 而非自己注册；如 Ctrl 在 mac 上冲突，先用 `Cmd+Space` 或 `Cmd+Shift+Space` 占位（bao 决定最终热键）

## 约束

- 不破 Windows 路径（DWM cloak 是 Win 唯一可行解）
- mac 实现走 `#[cfg(target_os = "macos")]` 条件编译
- 不放 `decorations:true` 兜底（破坏 overlay 美学）
- 不依赖 Apple Private API（macOSPrivateApi flag 已开但慎用，会卡 App Store / notarization）

## 验收清单

- [x] 菜单栏（右上角）出现 CTRL 常驻图标，点击可 toggle  ← athena 9/9 live-smoke
- [x] 按 Ctrl → CTRL 浮窗，其他 app 仍可见  ← athena 9/9 + bao PR #23 10+ cycle live-use
- [x] 再按 → CTRL 消失，焦点还原到原 app  ← 同上
- [x] 切换 Space 时 CTRL 行为可预期  ← athena live-smoke (Space follow per default)
- [x] Windows 路径不回归  ← cargo check pre-merge 0 warnings 增加, Win build untouched

## 讨论 / 备注

@zeus 这里走 lane-F 不抢 lane-G zeus 那条 Code Space 主线。如需要 kernel 侧支持（事件 / capability）再 ping zeus。

---

### 2026-05-22 zeus — themis verify verdict

**Tier**: B (multi-file shell touch + global hotkey + macOS platform).
**Verdict**: **APPROVE_WITH_WARNINGS** — 3 reported symptoms 全部修复 + 后续 desync regression 已通过 PR #23 (`e3cf194`) 补完。**Status 暂留 `done`，1 HIGH 未清，不翻 `verified`。**

**HIGH (blocks verified flip)** — `src-tauri/src/shell/hotkey.rs:475`:
- `reset_hotkey_state()` 用 `try_lock()`. CGEventTap callback 跑 real-time thread，可能跟 main thread 的 `toggle()` 抢锁 → `try_lock` 静默 no-op，原 desync symptom 的复发面没堵死。
- Fix: 换 `lock()` 或 `lock().unwrap_or_else(|_| { tracing::warn!(...); return; })`。需 athena 拍板 deadlock 风险评估。

**MEDIUM** — `src-tauri/src/shell/window.rs:93`:
- `reset_state()` 只在 **show** path 调用。hide path 也应 mirror reset，跟 Win `cloak::set(false)` 对称。

**Follow-up handoff**: `H-2026-05-22-002` — athena lane-E, 2 件修复 + smoke。完成后 zeus 翻 `verified`。
