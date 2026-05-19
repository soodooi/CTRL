---
id: H-2026-05-19-002
title: macOS CTRL shell broken — window covers desktop, no menu bar tray, hotkey dead
severity: P0
status: open
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

- [ ] 菜单栏（右上角）出现 CTRL 常驻图标，点击可 toggle
- [ ] 按 Ctrl（或 bao 钦定的 mac 替代键）→ CTRL 浮窗，其他 app 仍可见
- [ ] 再按 → CTRL 消失，焦点还原到原 app
- [ ] 切换 Space 时 CTRL 行为可预期（bao 决定 follow vs pin）
- [ ] Windows 路径不回归

## 讨论 / 备注

@zeus 这里走 lane-F 不抢 lane-G zeus 那条 Code Space 主线。如需要 kernel 侧支持（事件 / capability）再 ping zeus。
