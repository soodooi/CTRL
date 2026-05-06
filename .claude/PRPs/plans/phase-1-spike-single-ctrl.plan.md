# Plan: Phase 1 Spike — 单击 Ctrl 唤出 + 选中文本捕获 PoC

## Summary

7 天技术 spike，用 Tauri 2.0 + Rust 验证 CTRL 产品的最大未知风险：**单击 Ctrl 在 Windows 上能否做到无误触地唤出弹窗，并能抓到当前选中文本**。本 spike 是 PRD Path B（8-10 周 L1 闭环）的 Phase 1，独立于后续所有产品功能——只验证键位可行性 + 场景捕获可行性 + Tauri 窗口性能上限。

## User Story

> 作为 CTRL App Lab 的开发者，
> 我想在 7 天内验证"单击 Ctrl 唤出 + 选中文本捕获"在 Win11 上能稳定工作，
> 以便决定 MVP 阶段是用单 Ctrl（产品命名灵魂键位）还是 fallback 到双击 Ctrl / Ctrl+Space。

## Problem → Solution

| 维度 | 当前（Day 0） | spike 完成（Day 7） |
|---|---|---|
| 项目代码 | 空目录 | 可运行 Tauri 2.0 应用 + Rust 键盘钩子 + UIA 抓取 |
| 单 Ctrl 唤出可行性 | 未验证 | 量化数据：误触次数 / 唤出延迟 / 兼容性 |
| 场景捕获可行性 | 未验证 | 选中文本能否抓到 + 抓取失败 fallback 路径 |
| 决策依据 | 无 | 是否锁定单 Ctrl，是否需要白名单/fallback |

## Metadata

- **Complexity**: Medium（Rust + Win 系统 API + Tauri 学习）
- **Source PRD**: `.claude/PRPs/prds/ctrl-platform.prd.md`
- **PRD Phase**: Phase 1 — Spike（Week 1）
- **Estimated Files**: 15 个新建 / 0 个修改
- **Time Box**: 5-8 工作日上限（超时即砍 Task 7 实测矩阵 35→15 用例）

---

## UX Design

### Before（当前 OPC 工作流）

```
┌─────────────────────────────────────────────────────┐
│  浏览器 / 编辑器中选中文本                            │
│        ↓                                            │
│  Ctrl+C 复制                                        │
│        ↓                                            │
│  Alt+Tab 切到 ChatGPT                              │
│        ↓                                            │
│  Ctrl+V 粘贴 + 输入"改成知乎风格"                    │
│        ↓                                            │
│  等结果 → Ctrl+C 复制结果                           │
│        ↓                                            │
│  Alt+Tab 切回原应用 → Ctrl+V 粘贴                   │
│  耗时：~30 秒，~7 步操作                            │
└─────────────────────────────────────────────────────┘
```

### After（Spike 验证目标，仅前 2 步真实可跑）

```
┌─────────────────────────────────────────────────────┐
│  浏览器 / 编辑器中选中文本                            │
│        ↓                                            │
│  按一下 Ctrl（< 200ms 内弹窗）                      │
│        ↓                                            │
│  弹窗显示"已捕获文本：xxxxx..."                     │
│  （spike 阶段到此为止；MVP 阶段后续接 AI 路由）     │
└─────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After (spike) | Notes |
|---|---|---|---|
| 唤出 | Alt+Tab 切应用 | 按一下 Ctrl | spike 必须验证零误触 |
| 文本传递 | Ctrl+C 手动复制 | 自动抓取选中文本 | UIA fallback：剪贴板 |
| 弹窗位置 | — | 鼠标光标附近 | 不抢焦点（不打断当前应用） |

---

## Mandatory Reading

⚠️ 项目目录目前为空——无内部代码可读。spike 阶段建立的代码本身将成为后续 Phase 2-4 的"标准模板"。**先读外部文档**：

| Priority | Source | Why |
|---|---|---|
| P0 | https://v2.tauri.app/start/create-project/ | Tauri 2.0 项目初始化（必读 1-2-3 章） |
| P0 | https://docs.rs/windows/latest/windows/Win32/UI/WindowsAndMessaging/fn.SetWindowsHookExW.html | WH_KEYBOARD_LL 低级键盘钩子 API |
| P0 | https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview | UI Automation API 概念（仅看 Selection Pattern） |
| P1 | https://v2.tauri.app/reference/javascript/api/ | Tauri JS API（窗口/事件/invoke） |
| P1 | https://docs.rs/windows/latest/windows/Win32/UI/Accessibility/struct.IUIAutomation.html | IUIAutomation Rust 绑定 |
| P2 | https://github.com/tauri-apps/tauri/discussions/8001 | Tauri 2.0 Windows 性能讨论 |
| P2 | https://kennykerr.ca/rust-getting-started/ | Kenny Kerr 的 windows-rs 入门（最权威） |

## External Documentation

| 主题 | 来源 | 关键要点 |
|---|---|---|
| Tauri 2.0 在 Win 的全局热键 | tauri-plugin-global-shortcut docs | **不能用此插件**——它基于 Win RegisterHotKey，无法监听单个 modifier 键 |
| 单 Ctrl 检测算法 | Win SDK WH_KEYBOARD_LL | 必须用低级钩子：捕获 Ctrl down → 标记 `ctrl_pending=true` → 任何其他 keydown → `ctrl_pending=false`；Ctrl up + `ctrl_pending=true` + (now - down_time < 350ms) = 单击触发 |
| 抓取选中文本 | Win UI Automation | `IUIAutomation::GetFocusedElement` → `TextPattern::GetSelection` → `TextRange::GetText`；fallback：模拟 Ctrl+C 后读剪贴板（侵入性，仅 fallback） |
| Tauri 窗口快速显示 | Tauri 2.0 docs | 必须 `decorations: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focus: false`；预先 hide 不 destroy，复用窗口实例 |
| Rust ↔ JS 通信 | Tauri events | `app.emit("hotkey-triggered", payload)` → JS `listen("hotkey-triggered", cb)` |

```
KEY_INSIGHT: tauri-plugin-global-shortcut 不能监听单 modifier 键
APPLIES_TO: Task 3 钩子实现
GOTCHA: 必须直接调 Win32 SetWindowsHookExW，绕开 Tauri 插件
```

```
KEY_INSIGHT: 低级键盘钩子必须运行在带消息泵的线程上
APPLIES_TO: Task 3 Rust 钩子线程
GOTCHA: 在 Tauri 主线程之外起独立 std::thread + GetMessageW 循环；Tauri runtime 的 tokio 不会自动调度 Win 消息泵
```

```
KEY_INSIGHT: UIA 在 Chromium / Electron 应用中可能取不到选中文本
APPLIES_TO: Task 5 文本捕获
GOTCHA: Chrome / Edge / VSCode / Discord 默认不暴露 UIA；fallback 必须有：模拟 Ctrl+C 后 clipboard.read，注意延迟 50ms 等剪贴板 ready
```

```
KEY_INSIGHT: 单击 Ctrl 与中文输入法（搜狗/微软拼音）切换冲突
APPLIES_TO: Task 7 实测验证
GOTCHA: 必须实测搜狗/微软/谷歌输入法各 30 分钟；冲突情况下提供"双击 Ctrl"运行时切换
```

```
KEY_INSIGHT: Tauri 2.0 在 2024 年底 GA，2026 年初为稳定版
APPLIES_TO: Task 1 项目初始化
GOTCHA: 用 `npm create tauri-app@latest` 拉最新模板；spike 完成时记录使用的 tauri / rustc / node 版本到 README
```

---

## Patterns to Mirror

⚠️ **本 spike 不 mirror 任何已有 codebase 模式（项目为空）**——本 spike 建立的模式将成为 Phase 2-4 的标准。下面定义的是 **本 spike 必须建立的种子约定**，未来所有 phase 必须沿用。

### NAMING_CONVENTION（spike 建立）

```rust
// SOURCE: src-tauri/src/keyboard.rs（本 spike 创建）
// 文件：snake_case；模块：snake_case；类型：PascalCase；函数：snake_case；常量：SCREAMING_SNAKE_CASE
pub struct KeyboardListener { /* ... */ }
pub fn start_listener(app: AppHandle) -> Result<(), KeyboardError> { /* ... */ }
pub const SINGLE_CTRL_MAX_DURATION_MS: u64 = 350;
```

```typescript
// SOURCE: src/lib/hotkey.ts（本 spike 创建）
// 文件：kebab-case；类型/组件：PascalCase；函数/变量：camelCase；hooks：use 前缀
export type HotkeyEvent = { kind: 'single-ctrl'; capturedText: string | null; cursorX: number; cursorY: number };
export function listenHotkey(handler: (e: HotkeyEvent) => void): UnlistenFn { /* ... */ }
```

### ERROR_HANDLING（spike 建立）

```rust
// SOURCE: src-tauri/src/error.rs（本 spike 创建）
// Rust 端用 thiserror；从不 unwrap()；错误冒泡到 main，用 tracing::error! 落地
#[derive(thiserror::Error, Debug)]
pub enum SpikeError {
    #[error("hook installation failed: {0}")]
    HookFailed(#[from] windows::core::Error),
    #[error("uia query failed")]
    UiaFailed,
    #[error("clipboard read failed: {0}")]
    ClipboardFailed(String),
}
pub type Result<T> = std::result::Result<T, SpikeError>;
```

```typescript
// SOURCE: src/lib/result.ts（本 spike 创建）
// TS 端用 Result<T, E> 模式，不抛异常给 UI 层
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

### LOGGING_PATTERN（spike 建立）

```rust
// SOURCE: src-tauri/src/main.rs（本 spike 创建）
// Rust 端用 tracing + tracing_subscriber；INFO 默认；DEBUG 开发时打开
tracing::info!(event = "hotkey_triggered", duration_ms = elapsed.as_millis(), "single ctrl pressed");
tracing::warn!(event = "uia_failed", "fallback to clipboard");
tracing::error!(error = ?e, "hook installation failed");
```

### EVENT_BRIDGE_PATTERN（spike 建立）

```rust
// SOURCE: src-tauri/src/keyboard.rs（本 spike 创建）
// 跨线程事件：Rust 钩子线程通过 channel 把事件发给 Tauri runtime
let (tx, rx) = std::sync::mpsc::channel::<HotkeyEvent>();
std::thread::spawn(move || keyboard_hook_loop(tx));
tauri::async_runtime::spawn(async move {
    while let Ok(event) = rx.recv() {
        app_handle.emit("hotkey-triggered", &event).ok();
    }
});
```

### TEST_STRUCTURE（spike 建立）

```rust
// SOURCE: src-tauri/src/keyboard.rs 末尾（本 spike 创建）
// Rust 单元测试 #[cfg(test)] mod tests；纯逻辑（如单击判定）必须有单测；钩子注册类无法 mock 故无 unit test
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_single_ctrl_when_no_other_key_pressed() {
        let mut detector = SingleCtrlDetector::new(SINGLE_CTRL_MAX_DURATION_MS);
        assert!(matches!(detector.on_ctrl_down(0), DetectionState::Pending));
        assert!(matches!(detector.on_ctrl_up(100), DetectionState::Triggered));
    }
    #[test]
    fn rejects_when_other_key_pressed_during_ctrl() {
        let mut detector = SingleCtrlDetector::new(SINGLE_CTRL_MAX_DURATION_MS);
        detector.on_ctrl_down(0);
        detector.on_other_key_down(50);
        assert!(matches!(detector.on_ctrl_up(100), DetectionState::Cancelled));
    }
    #[test]
    fn rejects_when_held_too_long() {
        let mut detector = SingleCtrlDetector::new(350);
        detector.on_ctrl_down(0);
        assert!(matches!(detector.on_ctrl_up(500), DetectionState::Cancelled));
    }
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `.gitignore` | CREATE | Rust target/ + node_modules + dist + .DS_Store + .env |
| `package.json` | CREATE | Tauri JS 依赖 + scripts；由 `create-tauri-app` 生成 |
| `vite.config.ts` | CREATE | Vite + Tauri 配置；模板生成 |
| `src-tauri/Cargo.toml` | CREATE | Rust 依赖：tauri 2、windows、thiserror、tracing、arboard |
| `src-tauri/tauri.conf.json` | CREATE | 窗口配置：transparent / always-on-top / no decorations / no taskbar |
| `src-tauri/src/main.rs` | CREATE | Tauri 入口；setup hook；启动键盘 listener |
| `src-tauri/src/keyboard.rs` | CREATE | WH_KEYBOARD_LL 低级钩子 + SingleCtrlDetector 状态机 |
| `src-tauri/src/capture.rs` | CREATE | UIA 抓取选中文本；fallback 到剪贴板 |
| `src-tauri/src/error.rs` | CREATE | SpikeError 枚举 + Result alias |
| `src/main.tsx` | CREATE | React 入口 |
| `src/App.tsx` | CREATE | 唯一 UI：listen("hotkey-triggered") → 渲染捕获文本 + 渲染唤出延迟统计 |
| `src/lib/hotkey.ts` | CREATE | TS 端 listen/unlisten 封装 |
| `src/styles.css` | CREATE | 透明背景 + 圆角卡片 |
| `README.md` | CREATE | 5 分钟跑通指南 + 测试矩阵 + 实测数据记录表 |
| `docs/SPIKE_RESULTS.md` | CREATE | spike 结束后填：测得数据、决策建议、是否锁定单 Ctrl |

## NOT Building

明确不做（spike 范围外）：

- ❌ AI 调用 / LLM 集成
- ❌ 动作系统 / playbook 运行时
- ❌ 创作者编辑器
- ❌ 账号 / 注册 / 登录
- ❌ 后端 API / 数据库
- ❌ 支付
- ❌ macOS 适配（PRD 已定 Win 先）
- ❌ 双击 Ctrl 检测（仅在单 Ctrl 失败时作为 V1.1 备份方案）
- ❌ UI 美化（spike 用最简卡片足以）
- ❌ 自动更新 / 安装包签名
- ❌ 任何形式的遥测后端（数据写本地 log）

---

## Step-by-Step Tasks

### Task 1: 项目脚手架与版本锁定

- **ACTION**: 在 `/Users/mac/Documents/coding/CTRL/` 用 `npm create tauri-app@latest` 初始化（选 React + TypeScript + Vite）
- **IMPLEMENT**:
  ```bash
  cd /Users/mac/Documents/coding/CTRL
  npm create tauri-app@latest . -- --template react-ts --manager npm
  npm install
  ```
- **MIRROR**: NAMING_CONVENTION（建立约定）
- **IMPORTS**: 无
- **GOTCHA**: 模板可能默认 Tauri 1.x；必须确认 `Cargo.toml` 中 `tauri = "2"` 与 `tauri-build = "2"`；不是则手动升级
- **VALIDATE**:
  - `npm run tauri dev` 能启动空白窗口
  - README 记录 `tauri --version`、`rustc --version`、`node --version`、`npm --version`

### Task 2: 配置 Tauri 窗口属性

- **ACTION**: 编辑 `src-tauri/tauri.conf.json` 设置弹窗为 frameless / transparent / always-on-top
- **IMPLEMENT**:
  ```json
  {
    "app": {
      "windows": [{
        "label": "main",
        "title": "CTRL",
        "width": 600,
        "height": 80,
        "center": false,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "focus": false,
        "visible": false,
        "resizable": false
      }]
    }
  }
  ```
- **MIRROR**: 此文件结构成为后续所有窗口的模板
- **IMPORTS**: 无
- **GOTCHA**:
  - `transparent: true` 在 Win11 需要 `webview2 >= 122`；旧版会黑屏
  - `focus: false` 是关键——弹窗不抢焦点，否则用户无法感知"非侵入式"
  - `visible: false` 启动时不显示，由 hotkey 触发 `window.show()`
- **VALIDATE**: `npm run tauri dev` 启动后窗口不可见，确认无窗口出现在任务栏

### Task 3: 实现 Win 低级键盘钩子（核心难点）

- **ACTION**: 在 `src-tauri/src/keyboard.rs` 创建 `KeyboardListener` 与 `SingleCtrlDetector`
- **IMPLEMENT**: 关键骨架（开发者补全细节）：

  ```rust
  // src-tauri/src/keyboard.rs
  use std::sync::mpsc::Sender;
  use std::time::Instant;
  use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
  use windows::Win32::UI::WindowsAndMessaging::{
      CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW,
      UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
      WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
  };

  pub const SINGLE_CTRL_MAX_DURATION_MS: u64 = 350;

  #[derive(Debug, Clone, serde::Serialize)]
  pub struct HotkeyEvent {
      pub kind: String,           // "single-ctrl"
      pub captured_text: Option<String>,
      pub cursor_x: i32,
      pub cursor_y: i32,
      pub latency_ms: u64,
  }

  pub enum DetectionState { Idle, Pending, Triggered, Cancelled }

  pub struct SingleCtrlDetector {
      ctrl_down_at: Option<Instant>,
      other_key_pressed_during_ctrl: bool,
      max_duration_ms: u64,
  }

  impl SingleCtrlDetector {
      pub fn new(max_duration_ms: u64) -> Self {
          Self { ctrl_down_at: None, other_key_pressed_during_ctrl: false, max_duration_ms }
      }
      pub fn on_ctrl_down(&mut self, _t_ms: u64) -> DetectionState {
          if self.ctrl_down_at.is_none() {
              self.ctrl_down_at = Some(Instant::now());
              self.other_key_pressed_during_ctrl = false;
          }
          DetectionState::Pending
      }
      pub fn on_other_key_down(&mut self, _t_ms: u64) -> DetectionState {
          if self.ctrl_down_at.is_some() { self.other_key_pressed_during_ctrl = true; }
          DetectionState::Cancelled
      }
      pub fn on_ctrl_up(&mut self, _t_ms: u64) -> DetectionState {
          let result = match self.ctrl_down_at.take() {
              Some(start) if !self.other_key_pressed_during_ctrl
                  && start.elapsed().as_millis() as u64 <= self.max_duration_ms
                  => DetectionState::Triggered,
              _ => DetectionState::Cancelled,
          };
          self.other_key_pressed_during_ctrl = false;
          result
      }
  }

  // 全局静态 detector — 因为 hook callback 是 extern "system" fn，必须无状态参数
  // 用 OnceLock + Mutex 包装，或用 thread_local
  static DETECTOR: std::sync::OnceLock<std::sync::Mutex<SingleCtrlDetector>> = std::sync::OnceLock::new();
  static EVENT_TX: std::sync::OnceLock<std::sync::Mutex<Option<Sender<HotkeyEvent>>>> = std::sync::OnceLock::new();

  unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
      if code >= 0 {
          let kbd = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
          let vk = kbd.vkCode;
          let event_type = wparam.0 as u32;
          let is_ctrl = vk == 0xA2 || vk == 0xA3; // VK_LCONTROL / VK_RCONTROL

          if let Some(detector_lock) = DETECTOR.get() {
              let mut detector = detector_lock.lock().unwrap();
              let state = match (event_type, is_ctrl) {
                  (WM_KEYDOWN | WM_SYSKEYDOWN, true) => detector.on_ctrl_down(0),
                  (WM_KEYUP | WM_SYSKEYUP, true) => detector.on_ctrl_up(0),
                  (WM_KEYDOWN | WM_SYSKEYDOWN, false) => detector.on_other_key_down(0),
                  _ => DetectionState::Idle,
              };
              if matches!(state, DetectionState::Triggered) {
                  if let Some(tx_lock) = EVENT_TX.get() {
                      if let Some(tx) = tx_lock.lock().unwrap().as_ref() {
                          let _ = tx.send(HotkeyEvent {
                              kind: "single-ctrl".into(),
                              captured_text: None,  // 在主线程接收后再 capture
                              cursor_x: 0, cursor_y: 0,
                              latency_ms: 0,
                          });
                      }
                  }
              }
          }
      }
      CallNextHookEx(HHOOK::default(), code, wparam, lparam)
  }

  pub fn start_keyboard_hook(tx: Sender<HotkeyEvent>) {
      DETECTOR.set(std::sync::Mutex::new(SingleCtrlDetector::new(SINGLE_CTRL_MAX_DURATION_MS))).ok();
      EVENT_TX.set(std::sync::Mutex::new(Some(tx))).ok();

      // Hook 必须在带消息泵的线程上
      std::thread::spawn(|| unsafe {
          let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0)
              .expect("failed to install keyboard hook");
          let mut msg = MSG::default();
          while GetMessageW(&mut msg, None, 0, 0).into() {
              DispatchMessageW(&msg);
          }
          let _ = UnhookWindowsHookEx(hook);
      });
  }
  ```
- **MIRROR**: ERROR_HANDLING + EVENT_BRIDGE_PATTERN
- **IMPORTS**: `windows = { version = "0.58", features = ["Win32_UI_WindowsAndMessaging", "Win32_Foundation"] }`
- **GOTCHA**:
  - 钩子线程必须有 `GetMessageW` 消息泵，否则 Win 不会派发钩子事件
  - `OnceLock` + `Mutex` 而非 `lazy_static`——后者已弃用
  - `keyboard_proc` 内严禁阻塞操作（IO/UIA 等），否则系统键盘失灵——发到 channel 让主线程处理
  - VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3；按钩子原始 vkCode 区分左右 Ctrl 不影响检测逻辑（任一即可）
- **VALIDATE**:
  - `cargo test` 中 SingleCtrlDetector 三个单测全过
  - 启动后单击 Ctrl → 看到 Rust log "single ctrl pressed"
  - Ctrl+C/V/Z/A → 不触发

### Task 4: 主线程接收事件 + 触发 Tauri 窗口显示

- **ACTION**: 在 `src-tauri/src/main.rs` 中：起 channel、起钩子线程、起接收 task
- **IMPLEMENT**:
  ```rust
  // src-tauri/src/main.rs
  mod keyboard;
  mod capture;
  mod error;

  use tauri::{Manager, Emitter};

  fn main() {
      tracing_subscriber::fmt::init();

      tauri::Builder::default()
          .setup(|app| {
              let app_handle = app.handle().clone();
              let (tx, rx) = std::sync::mpsc::channel::<keyboard::HotkeyEvent>();
              keyboard::start_keyboard_hook(tx);

              tauri::async_runtime::spawn(async move {
                  while let Ok(mut event) = rx.recv() {
                      let started = std::time::Instant::now();
                      // 在主线程做 UIA 抓取（不能在钩子线程做）
                      event.captured_text = capture::get_selected_text().ok();
                      event.latency_ms = started.elapsed().as_millis() as u64;

                      if let Some(window) = app_handle.get_webview_window("main") {
                          let _ = window.show();
                          // 注意：不调 set_focus，保持原应用焦点
                      }
                      let _ = app_handle.emit("hotkey-triggered", &event);
                  }
              });
              Ok(())
          })
          .run(tauri::generate_context!())
          .expect("error while running tauri application");
  }
  ```
- **MIRROR**: EVENT_BRIDGE_PATTERN
- **IMPORTS**: `tracing-subscriber = "0.3"`
- **GOTCHA**:
  - `tauri::async_runtime::spawn` 而非 `tokio::spawn`——Tauri 自带 runtime
  - `window.show()` 必须在 setup 之后；启动早期窗口未就绪
  - 不调 `set_focus()`——保持非侵入
- **VALIDATE**: 单击 Ctrl → 弹窗出现 + 不抢焦点（原应用光标仍在闪）

### Task 5: 实现选中文本捕获（UIA 主路径 + 剪贴板 fallback）

- **ACTION**: 在 `src-tauri/src/capture.rs` 实现 `get_selected_text() -> Result<String>`
- **IMPLEMENT**:
  ```rust
  // src-tauri/src/capture.rs
  use crate::error::{SpikeError, Result};

  pub fn get_selected_text() -> Result<String> {
      // 主路径：UI Automation
      match get_via_uia() {
          Ok(text) if !text.trim().is_empty() => Ok(text),
          _ => {
              tracing::warn!(event = "uia_empty_or_failed", "fallback to clipboard");
              get_via_clipboard()
          }
      }
  }

  fn get_via_uia() -> Result<String> {
      use windows::Win32::System::Com::*;
      use windows::Win32::UI::Accessibility::*;

      unsafe {
          CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|_| SpikeError::UiaFailed)?;
          let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
              .map_err(|_| SpikeError::UiaFailed)?;
          let element = automation.GetFocusedElement().map_err(|_| SpikeError::UiaFailed)?;
          let text_pattern: IUIAutomationTextPattern = element
              .GetCurrentPatternAs(UIA_TextPatternId)
              .map_err(|_| SpikeError::UiaFailed)?;
          let selections = text_pattern.GetSelection().map_err(|_| SpikeError::UiaFailed)?;
          let count = selections.Length().map_err(|_| SpikeError::UiaFailed)?;
          if count == 0 { return Err(SpikeError::UiaFailed); }
          let range = selections.GetElement(0).map_err(|_| SpikeError::UiaFailed)?;
          let bstr = range.GetText(-1).map_err(|_| SpikeError::UiaFailed)?;
          Ok(bstr.to_string())
      }
  }

  fn get_via_clipboard() -> Result<String> {
      use arboard::Clipboard;
      // 注：spike 阶段不主动按 Ctrl+C 模拟（侵入性强）
      // 仅读取当前剪贴板内容作为 fallback；MVP 阶段再决定是否做主动复制
      let mut clip = Clipboard::new().map_err(|e| SpikeError::ClipboardFailed(e.to_string()))?;
      clip.get_text().map_err(|e| SpikeError::ClipboardFailed(e.to_string()))
  }
  ```
- **MIRROR**: ERROR_HANDLING
- **IMPORTS**:
  - `Cargo.toml` 加：`arboard = "3"`
  - `windows` features 增加：`Win32_UI_Accessibility`, `Win32_System_Com`
- **GOTCHA**:
  - UIA 在 Chromium 系（Chrome/Edge/VSCode/Discord）取不到 → 必有 fallback
  - `CoInitializeEx` 在每个调用线程都要做；spike 简化方案是每次调用前都初始化
  - spike 阶段**不**主动模拟 Ctrl+C；这会触发钩子的 KEYDOWN(C) 干扰检测，且改变用户剪贴板——MVP 再用安全方式（保存原剪贴板→模拟→读取→恢复）
- **VALIDATE**:
  - 在记事本选中文字 → 按 Ctrl → 弹窗显示选中文字（UIA 主路径）
  - 在 Chrome 选中文字 → 按 Ctrl → 弹窗显示剪贴板内容（fallback；如果剪贴板恰好有该文字）
  - 未选中任何内容 → 显示"无捕获内容"

### Task 6: React UI 接收事件并显示

- **ACTION**: 在 `src/App.tsx` listen 事件并渲染
- **IMPLEMENT**:
  ```tsx
  // src/App.tsx
  import { useEffect, useState } from 'react';
  import { listen, UnlistenFn } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

  type HotkeyEvent = {
    kind: string;
    captured_text: string | null;
    cursor_x: number;
    cursor_y: number;
    latency_ms: number;
  };

  export default function App() {
    const [last, setLast] = useState<HotkeyEvent | null>(null);
    const [count, setCount] = useState(0);

    useEffect(() => {
      let unlisten: UnlistenFn | undefined;
      listen<HotkeyEvent>('hotkey-triggered', (e) => {
        setLast(e.payload);
        setCount((c) => c + 1);
      }).then((u) => { unlisten = u; });
      return () => { unlisten?.(); };
    }, []);

    const dismiss = () => getCurrentWebviewWindow().hide();

    return (
      <div className="card" onMouseLeave={dismiss}>
        <div className="latency">#{count} · {last?.latency_ms ?? 0}ms</div>
        <div className="text">{last?.captured_text ?? '（未捕获选中文本）'}</div>
        <div className="hint">spike 模式：1 秒后自动隐藏</div>
      </div>
    );
  }
  ```
- **MIRROR**: NAMING_CONVENTION（TS 部分）
- **IMPORTS**: `@tauri-apps/api/event`, `@tauri-apps/api/webviewWindow`
- **GOTCHA**:
  - `unlisten` 必须在 useEffect 清理函数里调用，避免热更新累积监听
  - Tauri 2 的 webview window API 与 Tauri 1 不同——确保用 `getCurrentWebviewWindow` 而非 `appWindow`
- **VALIDATE**:
  - 单击 Ctrl → 卡片显示捕获文本 + 唤出延迟
  - 鼠标移出卡片 → 自动隐藏
  - 计数器递增正确

### Task 7: 实测矩阵 + 数据记录

- **ACTION**: 在 `docs/SPIKE_RESULTS.md` 建立测试矩阵，按矩阵执行并记录
- **IMPLEMENT**: 创建测试矩阵文档（见下面"Manual Validation"章节）
- **MIRROR**: 无（首份文档，建立模板）
- **IMPORTS**: 无
- **GOTCHA**: 数据必须真实——是 / 否、毫秒数字必须实测，不能凭感觉
- **VALIDATE**: docs/SPIKE_RESULTS.md 至少包含 30 个测试用例的数据

### Task 8: spike 总结与决策建议

- **ACTION**: 基于 Task 7 数据，在 `docs/SPIKE_RESULTS.md` 末尾写决策建议
- **IMPLEMENT**: 三选一决策模板：
  ```markdown
  ## 决策建议（Day 7 终结）

  ### 选项 A：锁定单击 Ctrl 作为 MVP 默认唤出键
  - 触发条件：误触率 < 2%，唤出延迟 P95 < 200ms，主流输入法无冲突
  - 风险：[列出残留风险]

  ### 选项 B：单击 Ctrl + 双击 Ctrl 双方案，用户首启选择
  - 触发条件：单 Ctrl 在某些场景误触率 5-15%，但仍有重度用户偏好
  - 工程成本：+2 天

  ### 选项 C：放弃单 Ctrl，回退到 Ctrl+Space / 双击 Ctrl
  - 触发条件：误触率 > 15% 或主流 IME 严重冲突
  - 产品影响：CTRL 命名失去键位呼应，需重新评估品牌叙事

  ## 我的建议：[A/B/C]，因为 [...]
  ```
- **MIRROR**: 无
- **IMPORTS**: 无
- **GOTCHA**: 决策必须基于数据，不允许"感觉良好就 A"
- **VALIDATE**: 文档自洽——结论与数据一致

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `detects_single_ctrl_when_no_other_key_pressed` | Ctrl down → Ctrl up @ 100ms | `Triggered` | 否（happy path） |
| `rejects_when_other_key_pressed_during_ctrl` | Ctrl down → C down → Ctrl up | `Cancelled` | 是（Ctrl+C 防误触） |
| `rejects_when_held_too_long` | Ctrl down → Ctrl up @ 500ms | `Cancelled`（超 350ms） | 是（防长按误触） |
| `handles_repeated_ctrl_down` | Ctrl down → Ctrl down → Ctrl up | 第二次 down 应被忽略 | 是（Win key repeat） |
| `latency_within_budget` | Ctrl up 时间戳 - Ctrl down 时间戳 | < 350ms | 否 |

### Edge Cases Checklist
- [x] 空输入（无选中文本）→ 显示"未捕获"
- [x] 极长选中（10000+ 字符）→ 截断显示前 500 字
- [x] Unicode / emoji / 中文混合
- [x] Ctrl 长按未释放（用户走开了）→ 不触发
- [x] 快速连续单击 Ctrl 5 次 → 5 次触发不丢失
- [x] 同时按下 Ctrl+Shift → 不触发
- [x] 在 RDP / 远程桌面下的行为（标 known issue 即可）
- [x] 输入法激活时按 Ctrl → 实测多个 IME

---

## Validation Commands

### Static Analysis

```bash
cd /Users/mac/Documents/coding/CTRL
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run tsc --noEmit
```
EXPECT: 零 fmt 差异；零 clippy 警告；零 TS 错误

### Unit Tests

```bash
cd /Users/mac/Documents/coding/CTRL/src-tauri
cargo test
```
EXPECT: SingleCtrlDetector 5 个单测全过

### Build Verification

```bash
cd /Users/mac/Documents/coding/CTRL
npm run tauri build -- --debug
```
EXPECT: 产出 `src-tauri/target/debug/ctrl.exe`，可手动运行

### Manual Validation（实测矩阵）

把以下矩阵填入 `docs/SPIKE_RESULTS.md`，每格记录"是/否/数字"：

| 场景 | 操作 | 是否触发 | 唤出延迟 ms | 备注 |
|---|---|---|---|---|
| 1 | 在 Notepad 选中"hello"，单击 Ctrl | 应 ✅ | 测 | UIA 应抓到 |
| 2 | 在 Notepad 不选任何，单击 Ctrl | 应 ✅ | 测 | 文本为空 |
| 3 | 在 Notepad 按 Ctrl+C | 应 ❌ | n/a | 防 Ctrl+C 误触 |
| 4 | 在 Notepad 按 Ctrl+V | 应 ❌ | n/a | |
| 5 | 在 Notepad 按 Ctrl+Z | 应 ❌ | n/a | |
| 6 | 在 Notepad 按 Ctrl+A | 应 ❌ | n/a | |
| 7 | 在 Notepad 长按 Ctrl 1 秒后释放 | 应 ❌ | n/a | 超时 |
| 8 | 在 Notepad 按 Ctrl+Shift | 应 ❌ | n/a | |
| 9-12 | 在 Chrome / Edge 重复 1-2 | 应 ✅ | 测 | UIA 失败 → 剪贴板 fallback |
| 13-16 | 在 VSCode 重复 1-4 | 应 ✅/❌ | 测 | UIA 在 VSCode 表现待测 |
| 17-20 | 在 WeChat / Telegram 桌面版 | 测 | 测 | |
| 21-25 | 在 Word / Excel / PowerPoint | 应 ✅ | 测 | UIA 应抓到 |
| 26-30 | 在 Figma 桌面版 / Slack | 测 | 测 | |
| 31 | 启用搜狗输入法，正常打字 30 分钟 | 误触次数 | n/a | 关键 |
| 32 | 启用微软拼音，正常打字 30 分钟 | 误触次数 | n/a | 关键 |
| 33 | 启用 Google IME，正常打字 30 分钟 | 误触次数 | n/a | 关键 |
| 34 | 写代码 1 小时（Cursor / IDEA） | 误触次数 | n/a | 重度 modifier 场景 |
| 35 | 玩游戏 30 分钟（任意支持 Ctrl 的游戏） | 误触次数 | n/a | 极端 modifier 场景 |

最关键阈值：
- **误触率**：35 个用例总误触数 / 总用户操作数 < 2% → A 选项；2-15% → B；> 15% → C
- **延迟 P95**：唤出延迟 < 200ms 是 PRD 硬指标

---

## Acceptance Criteria

- [ ] Task 1-8 全部完成
- [ ] `cargo test` 5 个单测全绿
- [ ] `cargo clippy -- -D warnings` 零警告
- [ ] `npm run tauri build --debug` 成功产出 exe
- [ ] 实测矩阵 35 个用例数据全部填入 `docs/SPIKE_RESULTS.md`
- [ ] PRD Phase 1 三个 Success signal 验证：
  - [ ] 连续 1 小时正常打字（含 Ctrl+C/V/Z/A）误唤出次数 ≤ 0（理想）/ ≤ 5（可接受）
  - [ ] 唤出延迟 P95 < 200ms
  - [ ] 弹窗能在至少 5 个主流应用（Notepad / Word / Chrome / VSCode / WeChat）显示选中文本（UIA 或 fallback）
- [ ] `docs/SPIKE_RESULTS.md` 末尾给出 A/B/C 决策建议 + 数据论证

## Completion Checklist

- [ ] 代码命名遵循 NAMING_CONVENTION（已在本 plan 中建立）
- [ ] 错误处理使用 SpikeError + Result（已建立）
- [ ] 日志使用 tracing 宏（已建立）
- [ ] 测试覆盖关键纯逻辑（SingleCtrlDetector）
- [ ] 无硬编码值（350ms 等用 const 暴露）
- [ ] README 含 5 分钟跑通指南
- [ ] SPIKE_RESULTS.md 数据完整
- [ ] 已更新 PRD 中 Phase 1 status = `complete`，并记录决策建议
- [ ] 自包含——下一阶段 plan 可直接基于本 spike 的代码骨架扩展

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| UIA 在 Chromium / Electron 系应用全部失败 | **高** | 中 | 已设计 fallback；MVP 阶段考虑用 Accessibility Insights 协议或 Chrome DevTools Protocol |
| 单 Ctrl 在中文 IME 严重冲突 | **中** | 高 | 实测 3 个主流 IME；冲突时退到 B 选项（双方案） |
| Tauri 2.0 在 Win 透明窗口黑屏 | 中 | 中 | 设备 webview2 < 122 时 fallback 到非透明带圆角；README 标最低系统要求 |
| Rust + Win FFI 学习曲线超过 1 周 | 中 | 高 | 本 plan 已给出可工作骨架；超时砍 Task 7 实测矩阵到 15 用例 |
| 钩子线程死锁导致全键盘失灵 | 低 | **极高** | `keyboard_proc` 严禁阻塞；Mutex 锁仅短临界区；测试时虚拟机隔离 |
| `arboard` 在某些 Win 系统读剪贴板失败 | 低 | 中 | 试用过失败可换 `clipboard-win` |
| spike 完成后误触率落在 2-15% 灰区 | **中** | 高 | 决策模板已含 B 选项（双方案）；不要强行 A |

## Notes

### 为什么 spike 是 7 天而不是 3 天

PRD 给 1 周，本 plan 估算（含学习曲线）：
- Task 1-2（脚手架 + 配置）: 0.5 天
- Task 3（钩子核心）: 2-3 天 ← 最大不确定性
- Task 4（事件桥）: 0.5 天
- Task 5（UIA capture）: 1-1.5 天
- Task 6（UI）: 0.5 天
- Task 7（实测）: 1.5-2 天 ← 必须留足时间
- Task 8（决策）: 0.5 天

**总计 ~6.5-8 天**——上限 8 天，超时即砍 Task 7 实测矩阵 35→15 用例。

### Spike 结束后的 Phase 2 启动条件

Phase 2（用户侧 MVP）启动前必须满足：
1. 决策建议是 A 或 B（C 选项需要回 PRD 重新评估键位与品牌）
2. UIA + fallback 能至少覆盖 5 个主流应用
3. spike 代码已 commit 到 git，作为 Phase 2 的起点
4. README + SPIKE_RESULTS.md 完整

### Founder dogfooding 的早期信号

PRD 强调"团队即首批用户"——spike 完成后，开发者本人 **必须用这个 spike 版本工作 3 天**（哪怕只能弹个空卡片），记录"按 Ctrl 的肌肉记忆"建立速度与是否影响日常工作。这是后续 builder-in-public 内容的第一篇素材。

---

*Generated: 2026-05-03*
*Source PRD: `.claude/PRPs/prds/ctrl-platform.prd.md`*
*Phase: Phase 1 — Spike*
*Status: ready-for-implementation*
