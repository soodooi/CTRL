# Win Shell — WinUI 3 / C# UI Layer Specification

- **Status**: **Superseded** by `.olym/specs/pwa-shell/spec.md` (per ADR-002, accepted 2026-05-13)
- **Date**: 2026-05-11 (draft), 2026-05-13 (superseded)
- **Parent**: `.olym/decisions/001-system-architecture.md` (revised by ADR-002)
- **Successor**: `.olym/specs/pwa-shell/spec.md` (Tauri 2 native shell + PWA)
- **Disposition**: W3.1–W3.7 deliverables remain in `win/` tree until H-2026-05-13-001 step e (HARD GATE: step d end-to-end demo must pass first). Hotkey/tray/lifecycle logic ports to `src-tauri/src/shell/`.
- **Note**: this spec preserved as history; do not extend or implement against it.

---

## 1. Scope

The Win shell is the thin, Win 11-native UI layer of CTRL. It owns:

- Window chrome (frameless / Mica backdrop / always-on-top / acrylic)
- Global hotkey detection (`RegisterHotKey` Win32 API)
- Clipboard read/write (`Windows.ApplicationModel.DataTransfer`)
- Keycap grid + workspace pane rendering (WinUI 3 + Fluent Design)
- Spring animations + 5-layer shadow keycap visuals (per PRODUCT.md)
- Rust kernel invocation via P/Invoke (cdylib FFI bindings)

The Win shell does **NOT** own:

- LLM calls / MCP host / capability check / event store — all in Rust core
- Manifest schema / step engine — Rust core
- AI memory / vector search — Rust core
- Anything that can be shared with Mac shell — must live in Rust core

---

## 2. Toolchain

Windows 11 (build 22000+, ideally 22621 for full Mica). .NET 8.0 SDK, Windows App SDK 1.5+ (formerly Project Reunion), WinUI 3 + Fluent Design System, C# 12, Visual Studio 2022 17.8+ / Rider 2024.1+ / VSCode + C# Dev Kit, Rust 1.95+.

---

## 3. Repository layout

```
CTRL/
├── win/                                ← NEW (this spec covers)
│   ├── CTRL.sln                        Solution file
│   ├── CTRL/                           Main app project
│   │   ├── CTRL.csproj                 .NET 8 + WinUI 3 project
│   │   ├── App.xaml / App.xaml.cs      App lifecycle (hotkey registration)
│   │   ├── MainWindow.xaml             Hidden parent window
│   │   ├── KeycapPool.xaml             Main keycap grid
│   │   ├── Workspace.xaml              Keycap workspace pane
│   │   ├── Bindings/                   ← Auto-generated from Rust UDL/C-header
│   │   │   ├── CtrlNative.cs           DllImport declarations
│   │   │   └── CtrlBindings.cs         Idiomatic C# wrappers + JSON types
│   │   ├── Services/
│   │   │   ├── KernelBridge.cs         Wraps CtrlNative; OnceTime boot
│   │   │   ├── HotkeyService.cs        RegisterHotKey + WM_HOTKEY pump
│   │   │   ├── ClipboardService.cs     Win.ApplicationModel.DataTransfer
│   │   │   └── McpStore.cs             ObservableCollection for MCP servers
│   │   ├── Views/
│   │   │   ├── Components/             KeycapCard / SpringHover behavior
│   │   │   └── Resources/              Acrylic brushes, fluent tokens
│   │   ├── Resources/
│   │   │   └── Tokens.json             Shared design tokens (with Mac shell)
│   │   ├── Package.appxmanifest        MSIX packaging
│   │   └── Assets/                     icons, splash
│   ├── ctrl_lib.dll                    ← Rust core artifact (gitignored)
│   ├── ctrl_native.h                   ← cbindgen-generated C header
│   └── README.md
└── (Rust core at src-tauri/, exposing both UniFFI + raw C ABI)
```

---

## 4. FFI integration

### 4.1 Strategy: raw C ABI via cbindgen + P/Invoke (NOT UniFFI for C#)

**Reason**: UniFFI 0.28 has no official C# support. The community crate
`uniffi-rs-csharp` exists but is a fork that lags upstream and is not
production-stable.

The safer path: expose **raw C-compatible functions** in Rust (using
`#[no_mangle] extern "C"`), let `cbindgen` generate a C header,
and call from C# via `[DllImport]` / `P/Invoke`. This is the path 1Password
and many other Rust-core-with-C#-UI projects take.

UniFFI scaffolding (for Swift / Kotlin) coexists peacefully — both paths
produce the same `ctrl_lib.dll` cdylib.

### 4.2 Rust core additions (P2.13)

Add `cbindgen = "0.27"` as a `[build-dependencies]` entry in `Cargo.toml`. Add `cbindgen.toml` with `language = "C"`, an All-Rights-Reserved SPDX header, `include_guard = "CTRL_NATIVE_H"`, `sys_includes = ["stdint.h", "stdbool.h", "stddef.h"]`, and `[export] include = ["ctrl_native_*"]` (the prefix filter).

Add `src/ffi/native.rs` next to `mod.rs` exposing `#[no_mangle] pub unsafe extern "C" fn` wrappers — all named `ctrl_native_*`. Each wrapper validates the input C string, calls the corresponding `crate::ffi` Rust function, and returns an `i32` status code (`0` = OK, negative = specific error). A `ctrl_native_string_free` wrapper drops `CString` ownership returned to C callers.

*(Cargo.toml / cbindgen.toml / Rust FFI scaffolding elided — superseded by ADR-002 PWA pivot. Tauri 2 invoke() replaces the cbindgen+P/Invoke path.)*

`build.rs` invokes cbindgen at compile-time, emitting `ctrl_native.h`.

### 4.3 C# side (CtrlNative.cs)

A `partial class CtrlNative` declares static partial methods using `[LibraryImport("ctrl_lib.dll", EntryPoint = "ctrl_native_*", StringMarshalling = StringMarshalling.Utf8)]` (NET 7+ source-generated P/Invoke — faster and safer than legacy `[DllImport]`). Each method maps 1:1 to a Rust `ctrl_native_*` export. A friendly `KernelHealthString()` wrapper retrieves the returned IntPtr, marshals it as UTF-8 via `Marshal.PtrToStringUTF8`, and frees it via `StringFree` in a `try/finally`.

*(C# P/Invoke scaffolding elided — superseded by ADR-002 PWA pivot.)*

### 4.4 Build Rust core for Win target

`cargo build --release --target x86_64-pc-windows-msvc` produces `target/x86_64-pc-windows-msvc/release/ctrl_lib.dll`; copy to `win/`. Or wire up an MSBuild post-build step to copy automatically.

---

## 5. Public API surface (from `src/ctrl.udl` + cbindgen header)

Same 8 methods as Mac shell:

| Function | C symbol | C# wrapper |
|---|---|---|
| kernel_boot | `ctrl_native_kernel_boot` | `Kernel.Boot(dataDir)` |
| kernel_health | `ctrl_native_kernel_health` | `Kernel.HealthAsync()` |
| mcp_register | `ctrl_native_mcp_register` | `Mcp.Register(descriptor)` |
| mcp_connect | `ctrl_native_mcp_connect` | `Mcp.Connect(id)` |
| mcp_list_tools | `ctrl_native_mcp_list_tools` | `Mcp.ListTools(id)` |
| mcp_invoke | `ctrl_native_mcp_invoke` | `Mcp.Invoke(id, tool, args)` |
| mcp_list_installed | `ctrl_native_mcp_list_installed` | `Mcp.ListInstalled()` |
| mcp_disconnect | `ctrl_native_mcp_disconnect` | `Mcp.Disconnect(id)` |

All sync from C# perspective; Rust drives Tokio internally. UI calls these
from background threads (`Task.Run` / `ThreadPool`) to keep MainThread free.

---

## 6. UI visual specification (Fluent + Mica)

### 6.1 Window chrome

- Frameless: `ExtendsContentIntoTitleBar = true`
- Backdrop: `Microsoft.UI.Xaml.Media.MicaBackdrop` (or `DesktopAcrylicBackdrop` for stronger blur)
- Always-on-top: `AppWindow.Presenter = OverlappedPresenter.IsAlwaysOnTop = true`
- Centered: `AppWindow.Move((screen.Width - 480)/2, (screen.Height - 420)/2)`
- Hide on focus loss: subscribe to `Activated` event, hide on `WindowActivationState.Deactivated`

### 6.2 Keycap visual (5-layer shadow)

WinUI 3 supports CSS-like shadow chains via the `DropShadow` composition layer. A `Border` (CornerRadius 10) with a vertical white-to-gray `LinearGradientBrush` background and a `ThemeShadow` provides the base; composition code-behind iterates 5 `compositor.CreateDropShadow()` calls (varying blur / opacity / offset per the spec) to build the highlight inset / bevel / ground / near drop / far drop stack.

*(XAML + composition scaffolding elided — superseded by ADR-002 PWA pivot. CSS shadow stack lives in `packages/ctrl-web/src/styles/keycap.module.css`.)*

### 6.3 Spring animation

WinUI 3 has `SpringVector3NaturalMotionAnimation`: create via `compositor.CreateSpringVector3Animation()`, set `DampingRatio = 0.7`, `Period = 120ms`, `FinalValue = (1.05, 1.05, 1)`, then `visual.StartAnimation("Scale", spring)`.

### 6.4 Tokens

Read from `Resources/Tokens.json` at startup, expose as `Application.Resources`.
Same JSON file format as Mac shell — single source of design truth.

---

## 7. Hotkey detection (Win32 API)

WinUI 3 doesn't provide a global hotkey API directly. P/Invoke `user32.dll` for `RegisterHotKey` (combo-based) and `SetWindowsHookExW` (low-level keyboard hook for single-Ctrl detection). Single-key Ctrl-only detection requires the latter because `RegisterHotKey` needs at least one non-modifier key.

*(Win32 P/Invoke declarations elided — superseded by ADR-002 PWA pivot. Active hotkey path lives in `src-tauri/src/shell/hotkey.rs`.)*

Single-Ctrl detection requires `WH_KEYBOARD_LL` low-level hook (because
`RegisterHotKey` needs at least one non-modifier key). The hook callback
runs on a separate thread; marshal back to UI thread via
`DispatcherQueue.TryEnqueue`.

Window security: this hook requires the app to NOT be sandboxed
(MSIX package needs `inputObservation` capability).

---

## 8. Lifecycle

```
ctrl.exe launch
    ↓
App.OnLaunched
    ↓
KernelBridge.Boot()    // calls CtrlNative.KernelBoot(appData path)
HotkeyService.Start()   // WH_KEYBOARD_LL hook
    ↓
Main window created (hidden by default, Mica backdrop, frameless)
    ↓
User presses Ctrl
    ↓
KeyboardProc fires → DispatcherQueue.TryEnqueue → window.Show()
    ↓
KeycapPool loads installed keycaps (via CtrlNative.McpListInstalled)
    ↓
Render KeycapPool with grid + spring hover
    ↓
User selects keycap → Workspace.Show()
    ↓
Workspace dispatches via CtrlNative.McpInvoke
    ↓
Result streams back; XAML re-renders reactively (INotifyPropertyChanged + IObservable<T>)
```

---

## 9. Tasks for Win shell (this Win11 machine)

### Phase W1 (1 day)
- [ ] Install .NET 8 SDK (winget: `winget install Microsoft.DotNet.SDK.8`)
- [ ] Install Win App SDK + WinUI 3 templates (`dotnet new install Microsoft.WindowsAppSDK.ProjectTemplates`)
- [ ] Create `win/` directory with `dotnet new winui3 -n CTRL`
- [ ] Verify `dotnet run` opens an empty WinUI 3 window

### Phase W2 (1-2 days)
- [ ] Add cbindgen build dep to Rust core Cargo.toml
- [ ] Create `src/ffi/native.rs` with `extern "C"` wrappers (8 functions)
- [ ] Update build.rs to invoke cbindgen
- [ ] Build Rust → produces `ctrl_lib.dll` + `ctrl_native.h`
- [ ] Copy dll into `win/CTRL/bin/Debug/` via MSBuild target
- [ ] Generate `CtrlNative.cs` from `ctrl_native.h` (manual transcription first time)
- [ ] Smoke test: WinUI button click → `KernelBoot()` + `KernelHealth()` → display JSON in TextBlock

### Phase W3 (3-5 days)
- [ ] HotkeyService implementation (WH_KEYBOARD_LL hook)
- [ ] Frameless window + Mica backdrop + always-on-top
- [ ] KeycapPool 8x grid rendering
- [ ] Wire keycap click → CtrlNative.McpInvoke
- [ ] Hide on focus loss

### Phase W4 (1 week)
- [ ] 5-layer DropShadow composition
- [ ] SpringVector3NaturalMotionAnimation on hover/press
- [ ] Workspace pane: LLM streaming response display (TextBlock + IObservable<T>)
- [ ] Settings pane: MCP server registration form
- [ ] BYOK Anthropic key entry → Win Credential Manager via Rust (KeychainPort)

### Phase W5 (1 week)
- [ ] Implement 5 P0 keycaps wired end-to-end (clipboard / OCR / translate / text / chat)
- [ ] MSIX packaging + AppInstaller for distribution
- [ ] Code signing (delay to launch prep)

---

## 10. Out of scope (handled by Rust core)

Same list as Mac shell:
- LLM API calls
- MCP server lifecycle
- Capability check
- Event sourcing / event store
- Vector memory / semantic cache
- Step engine / actor scheduler
- Manifest schema

If C# code finds itself implementing any of these: STOP. Move to Rust core.

---

## 11. Coordination protocol with Mac shell

- **Same Rust core** consumed by both shells (single source of truth)
- **UDL changes** in `src-tauri/src/ctrl.udl` → coordinator handoff in
  `.olym/handoffs/` → both shells re-generate bindings
- **Native bindings**: Mac uses UniFFI Swift, Win uses cbindgen + P/Invoke.
  Both target the SAME public API surface (8 methods + KernelError enum).
- **Visual tokens** in `Tokens.json` (shared). PRODUCT.md canonical.
- **No platform-specific business logic** in either shell. If you find
  yourself writing C# LLM call code, move to Rust core.

---

## 12. Open questions for bao

- [ ] MSIX vs unpackaged (xcopy) distribution? Microsoft Store eventually?
- [ ] Code signing certificate: get EV cert ($300+/yr) or self-signed for beta?
- [ ] Win 10 support? (some users still on 10. WinUI 3 supports Win10 1809+, Mica falls back to acrylic)
- [ ] Auto-update: Squirrel.Windows / Velopack / custom?

Defer all to post-W4.

---

## 13. References

- [WinUI 3 documentation](https://learn.microsoft.com/en-us/windows/apps/winui/winui3/)
- [Windows App SDK 1.5](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/)
- [Mica backdrop guide](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)
- [LibraryImport source-generated P/Invoke](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation)
- [cbindgen Rust → C header](https://github.com/mozilla/cbindgen)
- [SpringVector3NaturalMotionAnimation](https://learn.microsoft.com/en-us/uwp/api/windows.ui.composition.springvector3naturalmotionanimation)
- [WH_KEYBOARD_LL hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/about-hooks#wh_keyboard_ll)
- PRODUCT.md (CTRL keycap visual spec)
- `.olym/specs/mac-shell/spec.md` (sibling Mac UI spec)
