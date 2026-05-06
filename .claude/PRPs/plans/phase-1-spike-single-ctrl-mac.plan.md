# Plan: Phase 1 Spike (macOS Sibling) — 单击 Ctrl 唤出 + 选中文本捕获 PoC

> **本文件是 [`phase-1-spike-single-ctrl.plan.md`](./phase-1-spike-single-ctrl.plan.md)（Win 版）的 macOS sibling**。
> 通用部分（UX、Patterns、状态机、Testing Strategy 通用条目、Acceptance 通用条目、Notes）**直接引用 Win plan**，本文件只详写 macOS 平台差异。
> ⚠️ **PRD 首发仍是 Windows**——Mac spike 是验证性技术原型，结论用于参考；Win 实测仍需在 Win 机器自做。

---

## Summary

5-6 天技术 spike，在 Mac 上验证 CTRL 的最大未知风险：**单击 Control 键在 macOS 上能否做到无误触地唤出弹窗，并能抓到当前选中文本**。Mac sibling 与 Win plan 共用同一套 Tauri / React / 状态机，仅替换 OS-specific 的键盘钩子与文本捕获实现。

**Mac 端隐藏机会**：Mac 用户用 ⌘ 做修饰键，Control 用得极少（远低于 Win）——单 Control 唤出在 Mac **天然冲突更少**，是这条路线最适合先验证的平台。

## User Story

> 作为 CTRL App Lab 的开发者（在 Mac 上工作），
> 我想在 5-6 天内验证"单击 Control 唤出 + 选中文本捕获"在 macOS 14/15 上能稳定工作，
> 以便（1）建立 Tauri + Rust 跨平台代码模式；（2）拿 Mac 端冲突数据；（3）让 Win plan 的状态机得到平台无关验证。

## Problem → Solution

| 维度 | 当前 | Spike 完成 |
|---|---|---|
| Mac 端可行性 | 未验证 | 量化：误触率 / 唤出延迟 P95 / 应用兼容矩阵 |
| Accessibility 权限流程 | 未知 | 首启自动引导 + 重启检测 |
| AX API vs Pasteboard | 未知 | 决策：spike 阶段先用 pasteboard fallback，AX 进 V1 |
| 跨平台代码模式 | 无 | Win/Mac 共用 SingleCtrlDetector + EventBridge，OS API 隔离在 platform/ |

## Metadata

- **Complexity**: Medium（Rust + macOS 系统 API + Tauri）
- **Source PRD**: `.claude/PRPs/prds/ctrl-platform.prd.md`
- **PRD Phase**: Phase 1 — Spike（macOS sibling）
- **Estimated Files**: 16 个新建（含 Mac 专属：CGEventTap 实现、Info.plist、权限引导 UI）
- **Time Box**: 5-6 工作日（比 Win 短：core-graphics crate 比 windows-rs 友好）
- **Sibling Plan**: `phase-1-spike-single-ctrl.plan.md`（Win）

---

## UX Design

### Before / After / Interaction Changes

→ **同 Win plan**。Mac 端唯一新增 UX 步骤：**首启 Accessibility 权限引导**。

### Mac 专属：首启权限引导

```
┌─────────────────────────────────────────────────────┐
│  CTRL 首次启动                                       │
│        ↓                                            │
│  检测 AXIsProcessTrustedWithOptions = false        │
│        ↓                                            │
│  弹窗："CTRL 需要辅助功能权限来监听全局快捷键"      │
│        [打开系统设置]  [稍后]                       │
│        ↓                                            │
│  系统设置 → 隐私与安全 → 辅助功能 → 勾选 CTRL.app   │
│        ↓                                            │
│  CTRL 检测到授权 → 提示重启 App                     │
│        ↓                                            │
│  重启后正常监听单 Ctrl                               │
└─────────────────────────────────────────────────────┘
```

---

## Mandatory Reading

| Priority | Source | Why |
|---|---|---|
| P0 | https://v2.tauri.app/start/create-project/ | Tauri 2.0 项目初始化（同 Win） |
| P0 | https://docs.rs/core-graphics/latest/core_graphics/event/struct.CGEventTap.html | CGEventTap Rust binding（替代 Win SetWindowsHookEx） |
| P0 | https://developer.apple.com/documentation/coregraphics/quartz_event_services | Quartz Event Services 概念（必读 Tap 与 RunLoop 部分） |
| P0 | https://developer.apple.com/documentation/applicationservices/axuielement_h | AXUIElement / AXSelectedTextAttribute（替代 IUIAutomation） |
| P1 | https://developer.apple.com/documentation/applicationservices/1462089-axisprocesstrustedwithoptions | 权限检测/申请 API |
| P1 | https://docs.rs/objc2/latest/objc2/ | objc2 crate（NSPasteboard fallback） |
| P2 | https://github.com/servo/core-foundation-rs | core-foundation 仓库（CFRunLoop 用法） |
| P2 | https://nshipster.com/cgevent/ | CGEvent 实战指南（最佳通俗教程） |

## External Documentation

```
KEY_INSIGHT: CGEventTap 必须运行在带 CFRunLoop 的线程上
APPLIES_TO: Task 3 钩子线程
GOTCHA: 与 Win 一样必须独立 std::thread；Mac 上是 CFRunLoop::run_current() 而非 GetMessageW；阻塞调用直到 tap.disable()
```

```
KEY_INSIGHT: macOS 必须申请 Accessibility 权限才能 tap 键盘事件
APPLIES_TO: Task 0 权限引导（Mac 专属新增）
GOTCHA: AXIsProcessTrustedWithOptions(kAXTrustedCheckOptionPrompt) 会自动弹系统对话框；用户授权后 App 必须重启才能生效；开发模式下 cargo run 每次重新签名 → 每次都要重新授权（开发不便）
```

```
KEY_INSIGHT: AXUIElement Rust binding 不完善，spike 阶段可砍
APPLIES_TO: Task 5 选中文本捕获
GOTCHA: accessibility-sys / accessibility crate 维护一般；如果手动 FFI 成本超 1.5 天，spike 改用"模拟 Cmd+C 读 NSPasteboard"作为 PoC（与 Win 不同：Win 的 spike 不主动模拟 Ctrl+C，因为 Ctrl 是唤出键会干扰；Mac 用 Cmd+C 不冲突，可以主动模拟）
```

```
KEY_INSIGHT: macOS 的 Control 单击与 IME / 系统手势冲突点
APPLIES_TO: Task 7 实测验证
GOTCHA: 必查：Mission Control（默认 Ctrl+↑/↓ 切换桌面）、Vim 用户的 Ctrl+letter、中文输入法的 Ctrl+Space 切换、Spaces 切换、VoiceOver（VO=Ctrl+Option）
```

```
KEY_INSIGHT: 单 Control 在 Mac 比 Win 冲突更少（结构性优势）
APPLIES_TO: 全局结论
GOTCHA: Mac 用户键盘模式：⌘ 主修饰、⌥ 次修饰、⌃（Control）极少独立用——这意味着 Mac 端的"零误触"门槛比 Win 容易达标
```

```
KEY_INSIGHT: Tauri 2.0 在 Mac 透明窗口需要 macOSPrivateApi
APPLIES_TO: Task 2 窗口配置
GOTCHA: tauri.conf.json 中 macOSPrivateApi: true 才能 transparent + alwaysOnTop 生效；App Store 提交时需关闭，但 spike 不上架无影响
```

---

## Patterns to Mirror

→ **NAMING_CONVENTION / ERROR_HANDLING / LOGGING_PATTERN / EVENT_BRIDGE_PATTERN / TEST_STRUCTURE 全部同 Win plan**。

Mac 新增模式：

### PLATFORM_ADAPTER_PATTERN（建立跨平台抽象）

为 MVP 阶段做准备，spike 就开始隔离 OS-specific 代码：

```rust
// SOURCE: src-tauri/src/keyboard/mod.rs（本 spike 创建）
// 平台抽象：上层只见 trait，OS 实现各自一个文件

pub trait KeyboardListener: Send {
    fn start(&self, tx: std::sync::mpsc::Sender<HotkeyEvent>) -> Result<()>;
}

#[cfg(target_os = "macos")]
pub use mac::MacKeyboardListener as DefaultListener;
#[cfg(target_os = "windows")]
pub use win::WinKeyboardListener as DefaultListener;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "windows")]
mod win;
```

### PERMISSION_FLOW_PATTERN（Mac 专属）

```rust
// SOURCE: src-tauri/src/permissions.rs（本 spike 创建）
// 启动时检测 → 未授权弹窗引导 → 授权后提示重启

pub fn ensure_accessibility() -> PermissionState {
    if is_trusted_silently() {
        PermissionState::Granted
    } else {
        request_with_prompt();  // 系统弹原生对话框
        PermissionState::PendingRestart
    }
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `.gitignore` | CREATE | 同 Win，加 `.DS_Store`、`*.xcuserstate` |
| `package.json` | CREATE | 同 Win |
| `src-tauri/Cargo.toml` | CREATE | Mac 专属 deps：`core-graphics`、`core-foundation`、`objc2`、`objc2-foundation`、`objc2-app-kit`；通用：`tauri`、`thiserror`、`tracing`、`arboard` |
| `src-tauri/tauri.conf.json` | CREATE | 含 `macOSPrivateApi: true`、`titleBarStyle: "Transparent"`、菜单栏配置 |
| `src-tauri/Info.plist` | CREATE | 加 `NSAppleEventsUsageDescription`、`LSUIElement = true`（不在 Dock 显示） |
| `src-tauri/src/main.rs` | CREATE | 入口：权限检测 → 起 listener → setup window |
| `src-tauri/src/keyboard/mod.rs` | CREATE | PlatformAdapter trait + cfg 分发 |
| `src-tauri/src/keyboard/mac.rs` | CREATE | CGEventTap + CFRunLoop + SingleCtrlDetector（复用） |
| `src-tauri/src/keyboard/detector.rs` | CREATE | SingleCtrlDetector 状态机（与 Win 共用，纯逻辑无 OS API） |
| `src-tauri/src/capture/mod.rs` | CREATE | trait + cfg |
| `src-tauri/src/capture/mac.rs` | CREATE | spike 实现：模拟 Cmd+C + NSPasteboard 读取（含原 pasteboard 保存/还原） |
| `src-tauri/src/permissions.rs` | CREATE | Accessibility 权限检测/申请；Mac 专属 |
| `src-tauri/src/error.rs` | CREATE | 同 Win 但补 macOS 错误变体（PermissionDenied / PasteboardFailed） |
| `src/main.tsx` | CREATE | 同 Win |
| `src/App.tsx` | CREATE | 同 Win + 新增 PermissionGuide 组件 |
| `src/components/PermissionGuide.tsx` | CREATE | Mac 专属：检测未授权时显示引导 UI |
| `src/lib/hotkey.ts` | CREATE | 同 Win |
| `src/styles.css` | CREATE | 同 Win |
| `README.md` | CREATE | Mac 跑通指南 + 测试矩阵 + 实测数据 |
| `docs/SPIKE_RESULTS_MAC.md` | CREATE | spike 结束后填：Mac 端测得数据、决策建议 |

## NOT Building

→ 同 Win plan。**Mac 专属补充**：
- ❌ Universal Binary（Intel + Apple Silicon）；spike 只测当前 arch
- ❌ Notarization / Codesigning 完整流程；spike 用 ad-hoc sign
- ❌ App Store 兼容（macOSPrivateApi 与 App Store 冲突，但 spike 无所谓）
- ❌ AXUIElement 完整实现（如果手动 FFI 超 1.5 天，砍到 V1.1）

---

## Step-by-Step Tasks

### Task 0（Mac 新增）: 验证开发机权限基线

- **ACTION**: 在写代码前确认开发 Mac 上的当前 Accessibility 已授权状态（避免 cargo run 时被权限弹窗反复打断）
- **IMPLEMENT**:
  ```bash
  # 检查当前哪些 App 已授权（macOS 14+）
  sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" \
    "SELECT client, allowed FROM access WHERE service='kTCCServiceAccessibility'" 2>/dev/null \
    || echo "权限检查需 Full Disk Access；改用 系统设置 → 隐私与安全 → 辅助功能 手动确认"
  ```
- **GOTCHA**: 开发模式 `cargo run` 每次都重新签名 → bundle id 变 → 每次都要在 系统设置 重新勾选；解决：每次开发用 `npm run tauri dev` 而非 `cargo run`，Tauri 维持稳定 bundle id
- **VALIDATE**: 在 系统设置 → 隐私与安全 → 辅助功能 看到 `Terminal` 或 `iTerm` 已勾选（用于子进程权限继承）

### Task 1: 项目脚手架与版本锁定

→ **同 Win plan Task 1**，区别仅在 Mac 上 `npm create tauri-app@latest` 模板默认会生成 Info.plist。

- **VALIDATE 补充**: README 记录 `sw_vers -productVersion`（macOS 版本）

### Task 2: 配置 Tauri 窗口属性（Mac 专属调整）

- **ACTION**: 编辑 `src-tauri/tauri.conf.json` + `src-tauri/Info.plist`
- **IMPLEMENT (tauri.conf.json)**:
  ```json
  {
    "app": {
      "windows": [{
        "label": "main",
        "title": "CTRL",
        "width": 600, "height": 80,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "focus": false,
        "visible": false,
        "resizable": false,
        "titleBarStyle": "Transparent"
      }],
      "macOSPrivateApi": true
    },
    "bundle": {
      "macOS": {
        "minimumSystemVersion": "13.0"
      }
    }
  }
  ```
- **IMPLEMENT (Info.plist)**:
  ```xml
  <key>LSUIElement</key>
  <true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>CTRL needs accessibility to listen for the global Control key</string>
  ```
- **GOTCHA**:
  - `macOSPrivateApi: true` **必须**——否则 `transparent + alwaysOnTop` 不生效（这是 Tauri 2 文档明示的）
  - `LSUIElement = true` 让 App 不出现在 Dock 与 Cmd+Tab —— 后台型应用必备
  - `minimumSystemVersion: "13.0"` 限制 Ventura+，避免老系统 webview 兼容问题
- **VALIDATE**: `npm run tauri dev` 启动后无 Dock 图标，无窗口可见

### Task 3: 实现 macOS CGEventTap（核心难点）

- **ACTION**: 在 `src-tauri/src/keyboard/mac.rs` 创建 MacKeyboardListener
- **IMPLEMENT**:
  ```rust
  // src-tauri/src/keyboard/mac.rs
  use core_graphics::event::{
      CGEvent, CGEventField, CGEventTap, CGEventTapLocation, CGEventTapOptions,
      CGEventTapPlacement, CGEventType,
  };
  use core_foundation::runloop::{CFRunLoop, kCFRunLoopCommonModes};
  use std::sync::mpsc::Sender;
  use crate::keyboard::detector::{SingleCtrlDetector, DetectionState, SINGLE_CTRL_MAX_DURATION_MS};

  // macOS Virtual Key Codes (HIToolbox/Events.h)
  const KVK_CONTROL: i64 = 0x3B;        // Left Control
  const KVK_RIGHT_CONTROL: i64 = 0x3E;  // Right Control

  pub struct MacKeyboardListener;

  impl MacKeyboardListener {
      pub fn start(tx: Sender<crate::keyboard::HotkeyEvent>) {
          std::thread::spawn(move || {
              let detector = std::sync::Mutex::new(SingleCtrlDetector::new(SINGLE_CTRL_MAX_DURATION_MS));

              let tap = CGEventTap::new(
                  CGEventTapLocation::Session,
                  CGEventTapPlacement::HeadInsertEventTap,
                  CGEventTapOptions::Default,
                  vec![CGEventType::KeyDown, CGEventType::KeyUp, CGEventType::FlagsChanged],
                  |_proxy, event_type, event| {
                      let keycode = event
                          .get_integer_value_field(CGEventField::KEYBOARD_EVENT_KEYCODE);
                      let is_ctrl = keycode == KVK_CONTROL || keycode == KVK_RIGHT_CONTROL;

                      let state = {
                          let mut d = detector.lock().unwrap();
                          // FlagsChanged 用于 modifier-only 检测
                          // KeyDown/KeyUp 用于其他键
                          match (event_type, is_ctrl) {
                              (CGEventType::FlagsChanged, true) => {
                                  // Ctrl 按下/弹起都走 FlagsChanged
                                  // 通过 flags 当前状态判断 down or up
                                  let flags = event.get_flags();
                                  let ctrl_now_down = flags.contains(
                                      core_graphics::event::CGEventFlags::CGEventFlagControl
                                  );
                                  if ctrl_now_down { d.on_ctrl_down(0) } else { d.on_ctrl_up(0) }
                              },
                              (CGEventType::KeyDown, false) => d.on_other_key_down(0),
                              _ => DetectionState::Idle,
                          }
                      };

                      if matches!(state, DetectionState::Triggered) {
                          let _ = tx.send(crate::keyboard::HotkeyEvent {
                              kind: "single-ctrl".into(),
                              captured_text: None,
                              cursor_x: 0, cursor_y: 0,
                              latency_ms: 0,
                          });
                      }
                      None  // 不消费事件，让其继续传递
                  },
              ).expect("Accessibility 权限未授予 - 请前往 系统设置 → 隐私与安全 → 辅助功能 勾选 CTRL");

              let runloop_source = tap.mach_port().create_runloop_source(0).unwrap();
              unsafe {
                  CFRunLoop::get_current().add_source(&runloop_source, kCFRunLoopCommonModes);
              }
              tap.enable();
              CFRunLoop::run_current();  // 阻塞此线程直到 tap 被禁用
          });
      }
  }
  ```
- **MIRROR**: PLATFORM_ADAPTER_PATTERN + 复用 `detector.rs` 的 SingleCtrlDetector
- **IMPORTS**:
  ```toml
  # Cargo.toml
  core-graphics = "0.24"
  core-foundation = "0.10"
  ```
- **GOTCHA**:
  - **关键差异**：Mac 上 modifier 键（Ctrl/Cmd/Shift/Option/Fn）**不走 KeyDown/KeyUp，走 FlagsChanged** —— Win 是统一 KeyDown/KeyUp。这是 Mac 钩子最容易踩的坑
  - 通过 `event.get_flags()` 检查 `CGEventFlagControl` bit 来判断是 down 还是 up
  - 闭包必须 `Send` —— 用 `std::sync::Mutex` 包 detector
  - `CFRunLoop::run_current()` 阻塞，所以必须在独立线程
  - 返回 `None` 不消费事件 —— 用户的 Ctrl 仍传给应用；返回 `Some(event)` 替换；返回 `Some(NULL_EVENT)` 拦截
- **VALIDATE**:
  - `cargo test` 中复用 detector.rs 5 个单测全过
  - 启动后单击 Ctrl → 看到 Rust log "single ctrl pressed"
  - 按 Ctrl+C/V/Z/A → 不触发；普通字母 → 不触发

### Task 4: 主线程接收事件 + 触发 Tauri 窗口显示

→ **同 Win plan Task 4**，唯一改动：`MacKeyboardListener::start(tx)` 替代 `start_keyboard_hook(tx)`。

### Task 5: 选中文本捕获（macOS PoC：Cmd+C + NSPasteboard）

- **ACTION**: 在 `src-tauri/src/capture/mac.rs` 实现 spike 版 capture（不走 AX，走主动复制）
- **IMPLEMENT**:
  ```rust
  // src-tauri/src/capture/mac.rs
  use core_graphics::event::{CGEvent, CGEventTapLocation, CGKeyCode};
  use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
  use crate::error::{SpikeError, Result};

  const KVK_C: CGKeyCode = 0x08;  // 'C'

  pub fn get_selected_text() -> Result<String> {
      // Mac 上 Cmd+C 不冲突 Ctrl 唤出，可以主动模拟
      // 步骤：1) 保存原 pasteboard  2) 模拟 Cmd+C  3) 等 50ms  4) 读 pasteboard  5) 异步还原原 pasteboard
      let original = read_pasteboard().ok();
      simulate_cmd_c().map_err(|e| SpikeError::CaptureFailed(format!("cmd+c sim failed: {e}")))?;
      std::thread::sleep(std::time::Duration::from_millis(50));
      let captured = read_pasteboard()?;

      // 异步还原原剪贴板（不阻塞 UI）
      if let Some(orig) = original {
          std::thread::spawn(move || {
              std::thread::sleep(std::time::Duration::from_millis(500));
              let _ = write_pasteboard(&orig);
          });
      }
      Ok(captured)
  }

  fn simulate_cmd_c() -> std::result::Result<(), &'static str> {
      let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
          .map_err(|_| "event source")?;
      let down = CGEvent::new_keyboard_event(source.clone(), KVK_C, true).map_err(|_| "kd")?;
      down.set_flags(core_graphics::event::CGEventFlags::CGEventFlagCommand);
      down.post(CGEventTapLocation::HID);

      let up = CGEvent::new_keyboard_event(source, KVK_C, false).map_err(|_| "ku")?;
      up.set_flags(core_graphics::event::CGEventFlags::CGEventFlagCommand);
      up.post(CGEventTapLocation::HID);
      Ok(())
  }

  fn read_pasteboard() -> Result<String> {
      use arboard::Clipboard;  // 跨平台 fallback；objc2 NSPasteboard 也可用
      let mut clip = Clipboard::new().map_err(|e| SpikeError::ClipboardFailed(e.to_string()))?;
      clip.get_text().map_err(|e| SpikeError::ClipboardFailed(e.to_string()))
  }

  fn write_pasteboard(text: &str) -> Result<()> {
      use arboard::Clipboard;
      let mut clip = Clipboard::new().map_err(|e| SpikeError::ClipboardFailed(e.to_string()))?;
      clip.set_text(text).map_err(|e| SpikeError::ClipboardFailed(e.to_string()))
  }
  ```
- **MIRROR**: ERROR_HANDLING
- **IMPORTS**:
  ```toml
  arboard = "3"
  objc2 = "0.5"
  objc2-foundation = "0.2"
  objc2-app-kit = "0.2"
  ```
- **GOTCHA**:
  - **关键决策（spike 阶段）**：放弃 AX API（Rust binding 不完善 + 学习曲线），用"主动 Cmd+C + pasteboard"做 PoC；MVP 阶段评估是否补 AX
  - 主动 Cmd+C 是侵入式的（改用户剪贴板）→ 必须异步还原原 pasteboard
  - 50ms 等待是经验值；某些应用可能要 100ms（实测验证）
  - Mac 的 pasteboard 写入有约 500ms 写延迟，所以还原放 500ms 后做避免覆盖捕获
  - 如果选中区为空，pasteboard 不变，read 拿到旧值——必须用 NSPasteboard.changeCount 检测：调用前记 count，调用后看 count 是否 +1，未变则报"无选中"
- **VALIDATE**:
  - 在 TextEdit 选中"hello" → 单击 Ctrl → 弹窗显示 "hello"
  - 未选中 → 弹窗显示 "未捕获选中文本"
  - 1 秒后剪贴板恢复原内容（手动 Cmd+V 验证）

### Task 6: React UI 接收事件并显示

→ **同 Win plan Task 6**。**Mac 新增 PermissionGuide 组件**：

  ```tsx
  // src/components/PermissionGuide.tsx
  import { invoke } from '@tauri-apps/api/core';
  import { useEffect, useState } from 'react';

  export function PermissionGuide() {
    const [granted, setGranted] = useState<boolean | null>(null);

    useEffect(() => {
      invoke<boolean>('check_accessibility').then(setGranted);
    }, []);

    if (granted === null) return null;
    if (granted) return null;

    return (
      <div className="permission-guide">
        <h2>需要辅助功能权限</h2>
        <p>CTRL 需要监听全局键盘以响应 Control 键唤出。</p>
        <button onClick={() => invoke('open_accessibility_settings')}>
          打开系统设置
        </button>
        <p className="hint">授权后请重启 CTRL</p>
      </div>
    );
  }
  ```

  对应 Rust commands:
  ```rust
  #[tauri::command]
  fn check_accessibility() -> bool { /* AXIsProcessTrustedWithOptions */ }

  #[tauri::command]
  fn open_accessibility_settings() {
      let _ = std::process::Command::new("open")
          .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
          .spawn();
  }
  ```

### Task 7: Mac 实测矩阵 + 数据记录

- **ACTION**: 在 `docs/SPIKE_RESULTS_MAC.md` 建立 Mac 测试矩阵

| # | 场景 | 应预期 | 唤出延迟 ms | 备注 |
|---|---|---|---|---|
| 1 | TextEdit 选中"hello"，单击 Ctrl | ✅ | 测 | Cmd+C PoC 应抓到 |
| 2 | TextEdit 不选任何，单击 Ctrl | ✅ | 测 | "未捕获" |
| 3 | TextEdit 按 Cmd+C | ❌ | n/a | Mac 用 Cmd 不冲突 Ctrl 唤出 |
| 4 | TextEdit 按 Ctrl+A（Mac 上 = 行首） | ❌ | n/a | 防 Ctrl+letter 误触 |
| 5 | TextEdit 按 Ctrl+E（Mac 上 = 行尾） | ❌ | n/a | 同上 |
| 6 | TextEdit 长按 Ctrl 1 秒后释放 | ❌ | n/a | 超时 |
| 7 | TextEdit 同时按 Ctrl+Shift | ❌ | n/a | |
| 8 | Mission Control 触发 Ctrl+↑ | ❌ | n/a | 系统手势冲突测试 |
| 9 | Spaces 切换 Ctrl+→ / Ctrl+← | ❌ | n/a | 关键 |
| 10-13 | Safari 重复 1-4 | ✅/❌ | 测 | |
| 14-17 | Chrome 重复 1-4 | ✅/❌ | 测 | |
| 18-21 | VSCode 重复 1-4 | ✅/❌ | 测 | VSCode 大量 Ctrl shortcut |
| 22-24 | Cursor 重复 1-3 | ✅/❌ | 测 | 重度 modifier 用户 |
| 25-27 | 微信 Mac / Telegram | 测 | 测 | |
| 28-30 | Notion / Figma 桌面 / Slack | 测 | 测 | |
| 31 | 启用搜狗输入法（Mac 版），打字 30 分钟 | 误触次数 | n/a | 关键 |
| 32 | 启用 Squirrel（鼠须管），打字 30 分钟 | 误触次数 | n/a | |
| 33 | 启用系统拼音，打字 30 分钟 | 误触次数 | n/a | |
| 34 | Vim/Neovim 写代码 1 小时 | 误触次数 | n/a | **Vim 用户大量用 Ctrl** |
| 35 | VoiceOver 开启（Ctrl+F5）| ❌ | n/a | VO 与 Ctrl 关联，必查 |

最关键阈值（Mac 端）：
- **误触率**：< 1% → A 选项；1-8% → B；> 8% → C（Mac 因结构性优势更严苛）
- **延迟 P95**：< 200ms（与 Win 同硬指标）
- **Vim 用户兼容性**：单独标记，不达标可加白名单

### Task 8: spike 总结与决策建议

→ **同 Win plan Task 8**，决策模板加一行：

```markdown
## Mac vs Win Cross-Validation
- Mac 端误触率 vs Win 端误触率（如已有 Win 数据）
- 状态机在两平台上是否一致行为
- 建议是否调整 SINGLE_CTRL_MAX_DURATION_MS 阈值（Mac 用户单击节奏可能不同）
```

---

## Testing Strategy

### Unit Tests

→ **同 Win plan**（detector.rs 跨平台共用，5 个单测同样适用）

### Mac 专属边界
- [ ] Accessibility 权限被撤销时的 UX
- [ ] 开发模式下重新签名导致每次都要重授权 → README 必写解决方案
- [ ] Mac 休眠唤醒后 CGEventTap 是否仍生效
- [ ] 多显示器场景下 cursor 位置取值
- [ ] Apple Silicon vs Intel 行为是否一致（开发机 arch 记入 SPIKE_RESULTS）

---

## Validation Commands

### Static Analysis / Build

```bash
cd /Users/mac/Documents/coding/CTRL
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin -- -D warnings
npm run tsc --noEmit
npm run tauri build -- --debug --target aarch64-apple-darwin
```
EXPECT: 零警告；产出 `src-tauri/target/aarch64-apple-darwin/debug/ctrl.app`

### Manual

→ **测试矩阵 35 用例**（见 Task 7）；填入 `docs/SPIKE_RESULTS_MAC.md`

---

## Acceptance Criteria

- [ ] Task 0-8 全部完成
- [ ] `cargo test` detector.rs 5 个单测全绿
- [ ] `cargo clippy -- -D warnings` 零警告
- [ ] `npm run tauri build --debug --target aarch64-apple-darwin` 产出 .app
- [ ] Accessibility 权限引导流程可用：未授权 → 弹引导 → 打开系统设置 → 授权 → 重启 → 单击 Ctrl 工作
- [ ] 实测矩阵 35 用例数据全部填入 `docs/SPIKE_RESULTS_MAC.md`
- [ ] PRD Phase 1 三个 Success signal 在 Mac 端验证：
  - [ ] 误触率 < 1%（理想）/ < 8%（可接受）
  - [ ] 唤出延迟 P95 < 200ms
  - [ ] 至少 5 个主流应用（TextEdit / Safari / Chrome / VSCode / 微信 Mac）能显示选中文本
- [ ] `docs/SPIKE_RESULTS_MAC.md` 末尾给 A/B/C 决策建议 + 数据论证 + Mac vs Win 横向对比预留位

## Completion Checklist

- [ ] PlatformAdapter 抽象正确（detector.rs 不含任何 OS 调用）
- [ ] Mac 专属代码全在 `src-tauri/src/keyboard/mac.rs` / `capture/mac.rs` / `permissions.rs`
- [ ] Win plan 中的 NAMING / ERROR / LOGGING / TEST / EVENT_BRIDGE 模式被严格遵守
- [ ] README 含 5 分钟跑通指南 + 权限引导步骤截图
- [ ] SPIKE_RESULTS_MAC.md 数据完整
- [ ] 已更新 PRD Phase 1 行：Status 与 Mac plan 链接
- [ ] 自包含——下一阶段或 Win 平移时无需再问

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AX API binding 缺失，PoC 文本捕获质量不如 UIA | **高** | 中 | spike 用 Cmd+C + pasteboard PoC；MVP 阶段补 AX 或评估 native helper |
| 主动 Cmd+C 模拟在某些应用失效（受保护输入框、密码框） | 中 | 中 | 矩阵实测；MVP 阶段加白名单跳过 |
| 开发模式重新签名 → 反复要权限 → 影响开发节奏 | **高** | 低 | README 写解决方案：用 `tauri dev` 而非 `cargo run`；或开发机一次性手动加白名单 |
| Vim/Neovim/VSCode-Vim 用户单 Ctrl 误触率高 | 中 | 中 | 矩阵单独评估；可加"开发者模式 = 双击 Ctrl"开关 |
| CGEventTap 在 Apple Silicon 与 Intel 行为不一致 | 低 | 中 | 双 arch 实测；优先 Apple Silicon |
| 系统手势 Mission Control / Spaces / VoiceOver 冲突 | 中 | 中 | 矩阵实测；冲突即 fallback 双击 Ctrl 或可配置 |
| Tauri macOSPrivateApi 未来被 Apple 禁用 | 低 | 高 | 监控；备选方案是非 transparent 窗口 |

## Notes

### Mac sibling 与 Win plan 的关系

- 状态机（detector.rs）100% 共用——这是 PRD 双端首发的关键技术保证
- OS-specific 代码隔离在 `keyboard/{mac,win}.rs` 与 `capture/{mac,win}.rs`
- Mac spike 完成后，detector + EventBridge 模式被 Win plan 执行时直接复用
- **Mac spike 的"决策建议"对 Win 仅作参考**——Win 必须独立 spike 拿到 IME 冲突等本平台数据

### 为什么 Mac 比 Win 先做（实用决策）

1. 当前开发机是 Mac，立刻能跑 → 反馈速度最快
2. Mac 单 Ctrl 冲突结构性更少（用户用 ⌘ 主修饰）→ 验证更容易跑通
3. core-graphics + objc2 比 windows-rs 学习曲线友好，Rust + macOS 生态更成熟
4. 跑通 Mac 后，detector + 模式 + UI 95% 复用到 Win

### Founder dogfooding 的早期信号（同 Win plan）

spike 完成后开发者本人 **必须用 Mac spike 版工作 3 天**——记录"按 Ctrl 的肌肉记忆"建立速度，作为 builder-in-public 内容第一篇素材（"我在 Mac 上做了一个 Quicker，用我自己的命来 dogfood"）。

### Win plan 的并行触发条件

Mac spike 完成且决策为 A/B 时，立刻在 Win 机器（虚拟机或独立机）启动 Win plan Task 1-8，detector.rs 直接复用，估计 Win spike 工时减半（~3-4 天）。

---

*Generated: 2026-05-03*
*Source PRD: `.claude/PRPs/prds/ctrl-platform.prd.md`*
*Phase: Phase 1 — Spike (macOS sibling)*
*Status: ready-for-implementation*
*Sibling: `phase-1-spike-single-ctrl.plan.md` (Win)*
