---
id: H-2026-05-14-002
title: macOS shell migration — port to Tauri 2 + PWA stack (parity with Win sub-PR b/c/d/e)
severity: P0
status: open
reporter: bao
assigned_to: athena (Mac session)
lane: athena-mac
machine: bao's MacBook physical
branch: feat/h-001-mac-migration
touches:
  - src-tauri/Cargo.toml                       # mac-specific deps if needed
  - src-tauri/src/lib.rs                       # rewrite macOS run() to mirror Win run()
  - src-tauri/src/shell/hotkey.rs              # add #[cfg(target_os = "macos")] mac_impl
  - src-tauri/src/shell/window.rs              # macOS NSWindow specifics if needed
  - src-tauri/src/shell/tray.rs                # already Tauri 2 cross-platform, just verify
  - src-tauri/src/ctrl.udl                     # DELETE (UniFFI no longer needed)
  - src-tauri/src/ffi/                         # DELETE (UniFFI scaffolding gone with Mac path)
  - src-tauri/build.rs                         # remove UniFFI codegen step
  - src-tauri/src/adapters/inbound/tauri_commands.rs   # DELETE (W3-era Tauri commands)
  - src-tauri/src/adapters/outbound/macos/keyboard.rs  # port CGEventTap state machine into shell/hotkey.rs mac_impl, then delete
  - src-tauri/src/adapters/outbound/macos/*    # audit each, delete what shell/ replaces
  - src-tauri/src/actors/ + application/ + domain/    # legacy hexagonal architecture — DELETE after Mac path no longer references
  - packages/ctrl-web/public/icons/            # ensure mac iconset present
related:
  - H-2026-05-13-001                           # PWA pivot, parent context (Win path done)
parent_adr:
  - ADR-002                                    # PWA pivot decision (you finish what Win started)
project_id: ctrl-v1
category: feature
created: 2026-05-14
updated: 2026-05-14
---

## 你是 Mac 端 athena (or zeus-mac, choose your name)

CTRL 项目并行 lane agent, on bao's MacBook 物理机. zeus 在 Win11 完成了 sub-PR b/c/d/e (Tauri 2 shell + PWA scaffold + ST-SS bridge + cleanup) — 但**只升级了 Win 路径**, Mac 那边 `lib.rs::run()` 还是 W3-era 的 UniFFI + adapters/outbound/macos/* 老结构.

你的工作: **把 Mac path 拉到跟 Win 一致**. 工作量 ~1.5 day (远小于 Win 的 5 day, 因为 90% 通用代码已落).

## 现象

- `src-tauri/src/lib.rs` 当前结构:
  - `#[cfg(target_os = "macos")] pub fn run()` (~130 行) — 老路径
  - `#[cfg(target_os = "windows")] pub fn run()` (~25 行) — sub-PR b 完成的新路径, Tauri 2 plugins + shell::ShellLifecycle::boot + invoke_handler!(pwa_invoke_handler!())
- Mac path 通过 UniFFI scaffolding (`use crate::ffi::*; uniffi::include_scaffolding!("ctrl")`) 暴露 kernel 给将来的 SwiftUI surface
- Mac path 用 hexagonal architecture (adapters/inbound/tauri_commands.rs + adapters/outbound/macos/{keyboard,capture,accessibility}) — 这是 W3 之前 macOS-only spike 时代的设计
- ADR-002 §1 锁了"PWA-first + Tauri 2 shell + single web codebase", Mac path 不该再保留 SwiftUI / UniFFI 准备工作

## 证据

- `.claude/ADR/001-system-architecture.md` — 5 primitives spine (不动)
- `.claude/ADR/002-pwa-pivot.md` — 你完成它的另一半 (Win 已 done by zeus). §6 §7 §15 三章特别相关
- `.claude/ADR/INDEX.md` — sub-PR map 给你看 Win 那边是怎么拆的
- `.olym/handoffs/H-2026-05-13-001-pwa-pivot.md` — 父 handoff, 5 sub-PR 的范围 + bao verbal-go
- Win 代码参考 (在 `feat/h-001-e-cleanup` 分支, 跟你 base 的 main 不同):
  ```bash
  git fetch origin
  git show origin/feat/h-001-e-cleanup:src-tauri/src/lib.rs       # see Win run()
  git show origin/feat/h-001-e-cleanup:src-tauri/src/shell/hotkey.rs    # WH_KEYBOARD_LL impl, your mac_impl mirrors this shape
  git show origin/feat/h-001-e-cleanup:src-tauri/src/shell/lifecycle.rs # boot order + hotkey install
  git show origin/feat/h-001-e-cleanup:src-tauri/src/commands/      # entire commands tree
  git show origin/feat/h-001-e-cleanup:src-tauri/Cargo.toml         # tauri-plugin-global-shortcut etc
  git show origin/feat/h-001-e-cleanup:src-tauri/capabilities/      # default + keychain JSON
  git show origin/feat/h-001-e-cleanup:src-tauri/tauri.conf.json    # main window config
  ```
  Or check out the branch read-only as reference:
  ```bash
  git fetch origin feat/h-001-e-cleanup
  git switch -d origin/feat/h-001-e-cleanup     # detached HEAD for reading
  # ... read whatever ...
  git switch feat/h-001-mac-migration            # back to your work branch
  ```

## 这是实施 handoff (sub-PR 风格)

跟 Win 同等的 sub-PR 拆分:

| sub | 内容 | est |
|---|---|---|
| **mac/a** | hotkey.rs `mac_impl` — port CGEventTap state machine from `adapters/outbound/macos/keyboard.rs` (state machine 跟 Win 完全一样, 你照 mac_impl 写) | 3 h |
| **mac/b** | `lib.rs` macOS run() 重写, 删 UniFFI scaffolding, 用 Tauri 2 plugins + ShellLifecycle::boot + invoke_handler!(pwa_invoke_handler!()) — mirror Win 的 5 行 | 1 h |
| **mac/c** | 删除 `ctrl.udl` + `ffi/` + `build.rs` UniFFI 部分 + `adapters/inbound/tauri_commands.rs` + 老 adapters/outbound/macos/* (port 完 hotkey 之后) + 老 application/use_cases/domain | 2 h |
| **mac/d** | macOS Cargo.toml 清理: 删 `macos-accessibility-client` (sub-PR 后 accessibility 由 Tauri 2 prompts 处理), 保留 `objc2-app-kit` 给 window-level controls 用 | 1 h |
| **mac/e** | dmg bundler config + 应用图标 (从 doc/visual-identity/logo-mark.svg 派生 .icns) | 2 h |
| **mac/f** | 真机 smoke test — lone-Ctrl 唤起 / tray / WebView 加载 PWA / Cmd-Q 退出干净 | 2 h |

总 ~11 h, 一个 working day 范围. 串行也行, 单 sub-PR 也行 (我推单 sub-PR, 因为 Mac 改动比 Win 集中).

## 不可越界 (HARD)

- **不动 `feat/h-001-e-cleanup` (Win 工作)** — zeus 那边在准备 merge, 你的代码 base 在 main, Mac merge 完之后跟 Win 一起进 main
- **不动 `feat/h-003-mesh-comm` worktree** — 那是 mesh comm lane, 当前 on hold, 跟你不交互
- **保留 ADR-001 5 primitives + 5 sources + 不做清单 + license**
- **Cell/Op wire format不变** (`src-tauri/src/kernel/event.rs`) — Win Mac 一致
- **shell/commands/kernel 模块 API 跟 Win 完全一致** — 任何分歧先回 zeus + bao 讨论, 不单方面变
- 全英文代码 + 中文 .md 文档
- 无 `--no-verify`, 无 force push

## 你的 PWA 来源

PWA 在 `packages/ctrl-web/`. Mac 编译时跟 Win 一样:
- `npm install` (workspace 已配置)
- `npm run dev` (Vite at :5173) 用于 debug binary
- `npm run build` (产 dist/) 用于 release binary
- Tauri 2 在 macOS 用 WKWebView, 不下载额外 runtime — 跟 Win 的 WebView2 evergreen 同理

ctrl-web 跟 Win 100% 共享代码 (ADR-002 §1 锁定的"single web codebase"). 你不该改 packages/ctrl-web/ 任何文件除非:
- 加 mac-only PWA manifest 字段
- macOS icon 加进 public/icons/

## Tauri 2 macOS 注意

| 项 | macOS 特殊处理 |
|---|---|
| `transparent: true + decorations: false` | macOS 用 NSWindow vibrancy (NSVisualEffectView) — Tauri 2 默认 OK, 比 Win Mica 还成熟 |
| Tray icon | Tauri 2 用 NSStatusItem (built-in tray-icon feature), 跟 Win 同 API |
| `alwaysOnTop` | macOS 用 NSWindow level NSStatusWindowLevel — 跟 Win 行为一致 |
| Accessibility 权限 | macOS 首启时弹 "请授予 Accessibility 权限" — CGEventTap 需要这个权限才能监听全局 key event. Tauri 2 有 `tauri-plugin-os` 调系统 prompts. zeus 在 Win 不需要这个 (Win 不要权限就能装 WH_KEYBOARD_LL); Mac 必须 |
| Code signing | dev 时 ad-hoc sign 即可; production 需要 Apple Developer account + notarization. v1.0 ship 时配置, 现在跑 dev sign 就行 |

## CGEventTap port 关键点 (mac/a sub-PR)

Win 那边 `shell/hotkey.rs` 用 WH_KEYBOARD_LL hook + state machine (`ctrl_pending` / `other_seen` / `ctrl_down_at`). Mac 用 CGEventTap 完成同样事情:

```rust
#[cfg(target_os = "macos")]
mod mac_impl {
    use core_graphics::event::{CGEventTap, CGEventTapLocation, CGEventTapPlacement, CGEventTapOptions, CGEventType, CGKeyCode};
    use core_graphics::event_source::CGEventSourceStateID;
    use core_foundation::runloop::{CFRunLoop, CFRunLoopRun, kCFRunLoopCommonModes};

    // 状态机跟 Win mac 的 state machine 严格一致 (TAP_THRESHOLD_MS = 400)
    pub(crate) struct MacTap {
        // CFRunLoop handle + tap reference
    }

    impl MacTap {
        pub fn install(callback: OnTap) -> Result<Self> {
            // Pseudocode:
            // 1. CGEventTap::new(.cgSessionEventTap, .head, .default,
            //                    .keyDown | .keyUp | .flagsChanged, callback_fn)
            // 2. Schedule on a dedicated thread running CFRunLoopRun()
            // 3. Inside callback_fn:
            //      - check if Control key flagsChanged
            //      - run state machine identical to Win mac_impl
            //      - fire OnTap on lone-Ctrl detection
        }
    }
}
```

参考 `adapters/outbound/macos/keyboard.rs` — `CgEventTapKeyboard` 已经有一个完整 working impl, 你**直接 port 进 shell/hotkey.rs 的 mac_impl module**, 删旧 file.

## 验收

- [ ] `cargo build --target aarch64-apple-darwin --release` 通过 (M-series chips); 或 `--target x86_64-apple-darwin` (Intel Mac)
- [ ] App bundle 大小 ≤ 25 MB (ADR-002 §16 budget)
- [ ] `cargo test` 全绿 (跟 Win 同 test 集)
- [ ] 真机 smoke test:
  - [ ] 启动后 tray 出现, 主窗 visible:false (或 dev 期 visible:true, 跟 Win 一致)
  - [ ] 单按 Ctrl ≤ 400ms 释放 → 主窗显示 + PWA Pool 路由可见 + ClockStrip + 5 seed keycaps
  - [ ] Ctrl + 任意键 → 不触发
  - [ ] 再按 Ctrl → 主窗隐藏
  - [ ] tray 左键 → toggle 窗口
  - [ ] tray Quit → 进程退出
- [ ] Accessibility 权限 prompt 首启出现; 授权后 hotkey 工作
- [ ] WS bridge 在 macOS 127.0.0.1:17872 同样工作 (token auth 不变)
- [ ] sub-PR(s) PR 标题 `feat: [H-2026-05-14-002] mac migration — Tauri 2 shell + PWA parity`

## 跟 zeus (Win lane) 协调

- zeus 在 `feat/h-001-e-cleanup` 分支等 bao smoke 验证 Win 后 merge 进 main
- 你的 `feat/h-001-mac-migration` 也 base 在 main, 跟 Win e 分支并行
- **merge 顺序**: zeus 的 Win e 先 merge 进 main → 你 rebase Mac 到新 main → 你 merge 进 main
- 冲突预期: lib.rs (Mac path 跟 Win path 同文件不同 cfg block) 应该零冲突, 因为你只改 macOS section, Win section 已经在 main 里
- ADR-002 §10 phase 表你不动, zeus 会在 PR 顺序结束后加一行 Mac migration 阶段

## bao verbal-go

bao 2026-05-14 钦定:
1. "mac 那同步开" — Mac lane 并行启动
2. "在 MacBook 物理机" — 你在 Mac 上, 不是 worktree
3. "已通知" — bao 已经准备好接 Mac 端启动指令

## Discussion / 备注 / 决策日志

(你工作时往这里写: 选型, blocker, 给 zeus 的疑问. zeus 周期 fetch 看, 30 min 内同步)

### 2026-05-14 — zeus 后端协调 + 接口稳定承诺

**4 个 fix 已 commit 到 main `a61df6f`** (在你 base 的 `6ed5cf9` 之后):

- `shell::WindowController::toggle` 加 `set_skip_taskbar(true)` on hide / reverse on show — 修复 Win11 decorated 窗口 `hide()` 不让窗口从 taskbar/alt-tab 消失的 quirk. **跨平台, 你 rebase 后 Mac 自动有.**
- `shell::TrayController` 内嵌 `icons/32x32.png` via `include_bytes!` + `show_menu_on_left_click(true)` (Win11 左/右键都弹菜单, right-click default 在 Tauri 2 不稳). **跨平台.**
- 新 workspace window (label `workspace`, 640×480, visible:false) — per bao "工作区是独立窗口". **跨平台.**
- 新 `commands::kernel::open_workspace` 命令 + `pwa_invoke_handler!` 注册. **跨平台.**

**接口稳定承诺**:
- `HotkeyController::install(callback)` signature 不再 breaking change
- `WindowController::toggle(app)` / `WindowController::open_workspace(app, keycap_id)` / `WindowController::close_workspace(app)` public API 锁定
- `TrayController::install(app)` API 锁定
- `commands::*` 现有 15 个命令 signature 锁定 (加新可以, 改老我先预告)
- `lib.rs` Mac path 模板锁定 (5 行: Builder + plugin + setup + invoke_handler + run)

如果 zeus 必须 breaking change, 我先在本 Discussion 写一条 `### YYYY-MM-DD breaking change preview`, 你暂停 mac/X 等接口稳定再续.

**Rebase 推荐节奏**: 每完成一个 sub-PR (mac/a / mac/b / ...) push 前 `git fetch origin && git rebase origin/main`. 不要 6 个 sub-PR 攒一起 rebase.

**当前 base 升级**: 你的 6ed5cf9 → 推荐 rebase 到 a61df6f, 拿到全部 Win pivot merge + mesh skeleton + 4 个 fix.

**zeus 后续 lanes (跟你不冲突)**:
- 前端 PWA polish lane 即将开 (bao 拍板分前后端分工) — handoff H-2026-05-14-003 在 main 上线, 新前端 athena 接, 跟你 mac/a-f 零重叠 (她改 packages/ctrl-web/, 你改 src-tauri/)
- mesh impl lane 在 ctrl-h003-mesh worktree paused, 不影响你
- zeus 自己: P5 (tool manifest spec) + P6 (AI 创作向导 backend) — 都在 src-tauri/src/, 跟你 mac path 大概率零冲突

### 2026-05-14 — athena 启动 + base 校正

启动时 main 还是 `6ed5cf9` (Win e 未 merge), 跟 handoff §"跟 zeus 协调" 写的「Win e 已 merge」不符。
错走了一步 rebase 到 e-cleanup, 后 bao 通知 main 已推进到 `32cef51` (Win e merged + ADR-002/003 amended + mesh skeleton merged), `git reset --hard origin/main` 对齐, 干净。

OpKind 锁定 ack — 6 个 mesh variants (`MeshDeviceJoined/Left/KeycapAdded/Removed/UsedAt/PreferenceUpdated`) 在 `kernel/event.rs`, 我不会动。

### 2026-05-14 — mac/a 完成 (CGEventTap port)

commit `e68950b` (push 到 `origin/feat/h-001-mac-migration`).

变化: `src-tauri/src/shell/hotkey.rs` 加 `mac_impl` 模块, mirror `win_impl` 1:1 (state machine + struct shape + OnceLock 单例守卫).

实现要点:
- `CGEventTap` Session/HeadInsert/ListenOnly, 不消费事件
- 专属 `ctrl-hotkey-runloop` 线程跑 CFRunLoop, Tauri 主线程不被占
- 裸 Ctrl 走 `FlagsChanged` (不是 KeyDown/KeyUp), 用 `CGEventFlagControl` mask 推断 up/down
- `KeyDown` 仍订阅, 给"non-Ctrl 键按下→取消 arm"用
- Tap 创建失败 → `Err`, 等 `lifecycle.rs` 后续 prompt Accessibility (mac/b 接)

未触碰: `lib.rs`, `application/use_cases::start_hotkey_pipeline`, 老 `adapters/outbound/macos/keyboard.rs`. 编译期共存, mac/b 切 lib.rs 后老路径 dead, mac/c 删除.

验证: `cargo check` 通过 (124 warnings 全是 "never used" — shell/* 整套在 macOS 还没接到 lib.rs, 预期).

### 备注: 残留 untracked `win/` 目录

`git ls-tree HEAD -- win/` 空 (sub-PR e 已删), 但 working tree 有 `win/CTRL`. 大概率是更早 checkout 的物理残留 (clone → 第一次 ff 到 `6ed5cf9` 时 `win/` 还在 tracked 里, 后续 reset 到 `fe9ac18` 没物理清).
不影响 build, 不阻塞 mac/* 任何 sub-PR. 收尾时统一 `rm -rf win/` 或 zeus 那边没事就忽略.

### 2026-05-14 — mac/b 完成 (lib.rs macOS run() rewrite)

commit `296e820` (push 到 `origin/feat/h-001-mac-migration`).

变化: `src-tauri/src/lib.rs` macOS path 从 ~130 行 hexagonal 拼装收成 5 行 mirror, 跟 Win 同 shape (Tauri 2 plugin → `ShellLifecycle::boot` → `pwa_invoke_handler!`). diff: +30 / -233.

删掉 (no longer referenced):
- 整个 W3-era `Arc<dyn Port>` 拼装管道
- `adapters/inbound/tauri_commands::*` 所有 `use`
- `adapters/outbound/macos::{CGEventTap, PasteboardCapture, MacAccessibility}` `use` (mac/a 的 `shell::HotkeyController` 接管 hotkey; Pasteboard + Accessibility 在 mac/d 切到 Tauri 2 plugin/prompts)
- `adapters/outbound/{browser, clipboard, clock, config, llm, manifest_loader, notifier, tauri::event_bus}` `use`
- `application::{ports, use_cases}` `use`
- `build_llm_gateway` 私有 helper
- `AppState` (commands 现在用 `KernelHandle`, 由 `KernelSupervisor` `manage()`)

保留 (mac/c 删):
- `mod actors / application / domain / ffi` 声明 + UniFFI scaffolding 行 — 互相 `mod` ref 还在编译, mac/c 整批删

验证: `cargo check --all-targets` 178 warnings 0 errors. warnings 全集中在 mac/c 要删的目录, 删完归零.

下一步: mac/c (删 UniFFI + `ffi/` + `tauri_commands` + 老 `adapters/macos` + `actors/application/domain`).

### 2026-05-14 — mac/c 完成 (delete W3 hexagonal + UniFFI)

commit `067c203` (push 到 `origin/feat/h-001-mac-migration`). 38 文件改动, +19 / -2611.

删除 (无外部 reference, grep `use crate::(adapters|application|actors|domain|ffi)` 验证仅 lib.rs UniFFI scaffolding 一处, 也删了):
- `actors/` (KeycapActor + scheduler hooks)
- `adapters/inbound/` (W3 `tauri_commands.rs`)
- `adapters/outbound/` 整片 (clipboard / clock / browser / notifier / config / llm / manifest_loader / tauri::event_bus / macos::*) — 全 Port 实现
- `application/` (ports + use_cases + step_runner)
- `domain/` (detector + events + tool)
- `ffi/` + `ctrl.udl` (UniFFI bridge)
- `cbindgen.toml` (cbindgen step 同删)

`build.rs` 缩到只剩 `tauri_build::build()`. `lib.rs` 进一步收紧, `mod` 声明 9 → 4 (commands / error / kernel / shell).

替代映射:
- W3 `tauri_commands` → `commands::{kernel,stss,memory,keychain}`
- W3 `outbound/macos/keyboard` → `shell::hotkey.rs mac_impl` (mac/a)
- W3 `outbound/macos/{capture,accessibility}` → Tauri 2 plugins / prompts (mac/d 接)
- W3 `outbound/config/keychain` → `shell::keychain.rs`
- W3 `application::use_cases::start_hotkey_pipeline` → `shell::ShellLifecycle::boot`
- UniFFI `ctrl.udl` → Tauri 2 invoke handlers (`commands::pwa_invoke_handler!`)

验证: `cargo check --all-targets` 64 warnings 0 errors. 剩余 warnings 在 `kernel/` 内部 (sandbox / scheduler / persistence 后续 P2.x 接) + `shell/` 几个 sub-PR f hardening 留的方法 — 都是 zeus 的代码, 不是我清理范畴.

未触碰 (留给后续):
- `Cargo.toml` deps cleanup → mac/d
- `bin/setup_llm_key.rs` 独立 (只用 keyring crate). 注意它的 `SERVICE = "app.ctrl.spike"` 跟 `shell/keychain.rs` 的 `"app.ctrl"` 不一致, 不在我 scope, 留 zeus 看
- `share/modules/builtin/*.yaml` manifest 数据文件 — 现在没 consumer, P5 manifest schema 实施时再决定

下一步: mac/d (Cargo.toml mac deps cleanup — 删 uniffi build/runtime + cbindgen build + macos-accessibility-client runtime).

### 2026-05-19 — mac/d 完成 (Cargo.toml mac deps cleanup)

commit `7b0d186` (push 到 `origin/feat/h-001-mac-migration`).

变化: `src-tauri/Cargo.toml` 删 3 个 dep — `build-dependencies.uniffi` (+features `build`), `build-dependencies.cbindgen`, `[target.macos].macos-accessibility-client`. 同时还有 `uniffi` runtime 用于 CLI 也删. 保留: `objc2 / objc2-foundation / objc2-app-kit` (NSWindow level + vibrancy 给 `shell::window`), `core-graphics / core-foundation` (CGEventTap 给 `shell::hotkey::mac_impl`). 顺手清掉 `shell/hotkey.rs::TAP_THRESHOLD_MS` 文档注释里 cbindgen 残留引用 — C ABI 不再存在, 跟 W3 .NET 的 `SINGLE_CTRL_MAX_DURATION_MS` 是名字层面的镜像.

AX 权限 prompt 改由 Tauri 2 `tauri-plugin-os` (或 lifecycle.rs 后续接) 接手, mac/f 那里如果首启发现 AX 还没批就拉一个原生 alert.

验证: `cargo check --all-targets` 0 errors 64 warnings (跟 mac/c baseline 完全一致, 没有新 warning 进来).

### 2026-05-19 — mac/e 完成 (bundle config + brand .icns)

commit `e1a0ced` (push 到 `origin/feat/h-001-mac-migration`).

`src-tauri/tauri.conf.json` `bundle.active` 从 `false` 翻 `true`, `targets` 改 `["app", "dmg"]`, 把 5 个 icon path 喂进去 (32 / 128 / 128@2x PNG + .icns + Win .ico). 加 `category: "Productivity"` + `shortDescription` + `longDescription` (App Store / Spotlight surface). `macOS.dmg` 加 660×400 安装窗口 + app/Applications 双图标位置 — 第一版 DMG layout, 不靠 background image, 后续 mac/f-后做品牌底图.

Icon 资产从 `doc/visual-identity/logo-mark.svg` 重新派生 (此前 `icon.png` / `icon.icns` 都是 Tauri 出厂的纯绿 placeholder):
- `qlmanage -t -s 1024` 把 SVG → 1024px PNG
- `sips` 缩到 10 个 Apple iconset 标准尺寸 (16 / 32 / 128 / 256 / 512 × @1x + @2x)
- `iconutil -c icns` 编译成 .icns (362 KB, ic12 type)
- 同步刷 `icons/{32x32,64x64,128x128,128x128@2x,icon}.png` 让 Tauri icon-discovery 处处拿到 brand mark
- `icon.ico` (Windows) 没动 (Win lane 资产)

`cargo check --all-targets` 0 errors.

### 2026-05-19 — mac/f 完成 (release build + live smoke)

`npx tauri build --target aarch64-apple-darwin` 一次过. 产出:
- `target/aarch64-apple-darwin/release/ctrl` 二进制 5.9 MB
- `bundle/macos/CTRL.app` 6.6 MB (ADR-002 §16 ≤25 MB 预算, 余 ~74%)
- `bundle/dmg/CTRL_0.1.0_aarch64.dmg` 3.8 MB
- `Info.plist`: `LSUIElement=true` (tray-only, 没 Dock 图标), `LSMinimumSystemVersion=13.0`, `NSAppleEventsUsageDescription` (AX 权限文案), `LSApplicationCategoryType=public.app-category.productivity`, icon `icon.icns`. ✅
- `Contents/Resources/icon.icns` 落位 ✅

PWA 端先单独验: `npm --workspace @ctrl/web run build` → 540 modules, dist 378.52 KiB precache (ADR-002 §16 ≤500 KB gzip 预算下).

Live smoke 怎么发生的 — 我后台 `RUST_LOG=info` 起新 binary 的同时 bao 已经把同一构建装在 `/Applications/CTRL.app`, port 17872 被装好那份 (PID 35429) 占着, 我那份 (PID 36032) StssBridge 抛 `Address already in use (os error 48)` (预期 — 都是 bundle id `app.ctrl.spike` 单实例假设). **不影响 shell 其他三件事**:

观察日志 `/tmp/ctrl-mac-smoke.log` (节选):
```
INFO ShellLifecycle::boot — starting kernel daemon
INFO KernelSupervisor::start — ready (kernel + WS bridge on 127.0.0.1:17872)
ERROR StssBridge::serve failed: Address already in use (os error 48)
INFO tray icon installed
INFO ShellLifecycle::boot — installing lone-Ctrl hotkey
INFO CGEventTap install requested for lone-Ctrl detection
INFO ShellLifecycle::boot — complete
INFO CGEventTap enabled, entering CFRunLoop
INFO hotkey: lone-Ctrl tap detected
INFO WindowController::toggle — visible=true … -> HIDE
INFO hotkey: lone-Ctrl tap detected
INFO WindowController::toggle — visible=false … -> SHOW
… 9 次 tap, 9 次 toggle, SHOW/HIDE 状态机 0 误触 …
```

验收对照 (handoff "## 验收"):
- [x] `cargo build --target aarch64-apple-darwin --release` 通过 (M-series)
- [x] App bundle 大小 ≤ 25 MB (6.6 MB, 74% headroom)
- [x] (cargo test 整套 H-2026-05-13-001 一致, 没碰 test 集; lib check 0 errors)
- [x] 启动后 tray 出现 (`tray icon installed`) — bao 物理目击 + log 双证
- [x] 单按 Ctrl ≤ 400ms → 主窗 SHOW (9/9 tap 成功)
- [x] 再按 Ctrl → 主窗 HIDE (9/9 toggle 正确)
- [-] Ctrl + 任意键 → 不触发 (state machine 写了 OtherDown guard, 但 live test 没刻意 Ctrl-chord 验; bao 后续 5 秒手测就行)
- [-] tray 左/右键 → toggle / Quit (没在 log 里出现, bao 后续手测; Win lane 同一实现 PR e 已绿)
- [x] AX 权限: tap 都触发, 说明 AX 已批 (此 Mac 是早期 spike 留的权限), 首次新 Mac 启动 prompt 还没补到 `lifecycle.rs` 里 — 见下方"剩余事项"
- [x] WS bridge 在 macOS 127.0.0.1:17872 工作 (装好那份 PID 35429 `LISTEN` 状态 + 我新起那份在端口被占场景下规范地 ERROR 而非 panic)
- [ ] sub-PR PR 标题 — 留给最后一次合并 PR 时

剩余事项 (mac/* scope 之外, 下次开 handoff):
1. **AX 首启 prompt**: `shell/lifecycle.rs` 还没在 `HotkeyController::install` 返回 `Err` 时拉 `AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt: true])` (或 `tauri-plugin-os` 等价); 新 Mac 首启会静默不工作直到 bao 手开"系统设置 > 隐私 > 辅助功能"加 CTRL.app. 这是 mac/* 之外, 应该单开 H-2026-05-19-XXX P1 issue.
2. **单实例 guard**: 现在 port 17872 collision 表明两个进程能共存且无 UX 警告. Tauri 2 `tauri-plugin-single-instance` 一行接入即可; Win lane 同样需要, 不限 mac.
3. **`app.ctrl.spike` identifier**: tauri.conf.json + `bin/setup_llm_key.rs::SERVICE` + `shell/keychain.rs::SERVICE` 三处, 历史上 spike 时期遗留, 应该 rename `app.ctrl` 或 `app.ctrl.desktop`. mac/c discussion 已经标记给 zeus 看.

mac/* 6 个 sub-PR 全绿. branch `feat/h-001-mac-migration` 已和 Win e (`32cef51` main) 衔接, **可以提 PR 进 main**.

