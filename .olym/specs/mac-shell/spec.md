# Mac Shell — SwiftUI UI Layer Specification

- **Status**: **Superseded** by `.olym/specs/pwa-shell/spec.md` (per ADR-002, accepted 2026-05-13)
- **Date**: 2026-05-11 (draft), 2026-05-13 (superseded)
- **Parent**: `.olym/decisions/001-system-architecture.md` (revised by ADR-002)
- **Successor**: `.olym/specs/pwa-shell/spec.md` (Tauri 2 native shell + PWA — single shell across Win/Mac)
- **Disposition**: never implemented. SwiftUI dual-stack approach abandoned before any Mac code shipped — PWA pivot avoids the duplicate-UI cost ADR-002 §2 cites.
- **Note**: this spec preserved as history; do not extend or implement against it.

---

## 1. Scope

The Mac shell is the thin, Mac-native UI layer of CTRL. It owns:

- The window chrome (transparent / frameless / always-on-top / Vibrancy / NSVisualEffectView)
- Global hotkey detection (NSEvent monitor + Accessibility API)
- Clipboard read/write (NSPasteboard)
- Keycap grid + workspace pane rendering (SwiftUI)
- Spring animations + 5-layer shadow keycap visuals (per PRODUCT.md)
- Rust kernel invocation via UniFFI-generated Swift bindings

The Mac shell does **NOT** own:

- LLM calls / MCP host / capability check / event store — all in Rust core
- Manifest schema / step engine — Rust core
- AI memory / vector search — Rust core
- Anything that can be shared with Win shell — must live in Rust core

---

## 2. Toolchain

macOS 13+ (Ventura), Xcode 15+ with Swift 5.9+, SwiftUI for views, AppKit for window chrome and hotkey, Combine for reactive bindings, Rust core consumed via UniFFI (Mozilla's official Swift bindings, first-class support).

---

## 3. Repository layout

```
CTRL/
├── mac/                                ← NEW (this spec covers)
│   ├── CTRL.xcodeproj/
│   ├── CTRL/
│   │   ├── App/
│   │   │   ├── CTRLApp.swift           SwiftUI App entry
│   │   │   └── AppDelegate.swift       NSApp lifecycle (hotkey registration)
│   │   ├── Views/
│   │   │   ├── KeycapPoolView.swift    Main 键帽 grid
│   │   │   ├── WorkspaceView.swift     Keycap workspace pane
│   │   │   └── Components/             KeycapCard / KeycapShadow / SpringHover
│   │   ├── ViewModels/
│   │   │   ├── KernelBridge.swift      Wraps UniFFI ctrl module
│   │   │   ├── KeycapStore.swift       ObservableObject for keycap list
│   │   │   └── McpStore.swift          ObservableObject for MCP servers
│   │   ├── Services/
│   │   │   ├── HotkeyService.swift     Global Ctrl-press detection
│   │   │   ├── ClipboardService.swift  NSPasteboard wrapper
│   │   │   └── AccessibilityService.swift  AX permission flow
│   │   ├── Resources/
│   │   │   └── Tokens.json             Design tokens (colors, shadows, spring)
│   │   └── Info.plist                  Bundle metadata + entitlements
│   └── Package.swift                   Swift Package Manager manifest
└── (Rust core at src-tauri/, will rename to core/ in future commit)
```

---

## 4. UniFFI integration

### 4.1 Build Rust core for Mac targets

Build `libctrl.dylib` for both `aarch64-apple-darwin` and `x86_64-apple-darwin` (release), then `lipo -create` the two into a universal `target/universal/libctrl.dylib`.

*(Build scripts elided — superseded by Tauri 2 PWA shell, see `.olym/specs/pwa-shell/spec.md`.)*

### 4.2 Generate Swift bindings

Install `uniffi-bindgen-cli`, then `uniffi-bindgen generate src-tauri/src/ctrl.udl --language swift --out-dir mac/CTRL/Bindings/`.

*(Binding-generation scripts elided — superseded by ADR-002 PWA pivot.)*

Produces:
- `ctrl.swift` (Swift API wrapper)
- `ctrlFFI.h` (C header)
- `ctrlFFI.modulemap` (Clang module map)

### 4.3 Xcode project integration

1. Link `libctrl.dylib` as Embed & Sign framework
2. Add `Bindings/` to project, `import ctrl` available in Swift code
3. Set `DYLD_LIBRARY_PATH` in scheme if running outside bundle

---

## 5. Public API surface (UniFFI-exposed)

All async work happens in Rust core via internal Tokio runtime. Swift calls
the sync FFI entry points; results return synchronously to the caller.

For UI responsiveness, Swift code should call FFI methods off the main thread (e.g. `Task.detached { try kernelBoot(...) ; let h = try kernelHealth() ; await MainActor.run { kernelStatus = .online(h) } }`).

*(Swift invocation example elided — see UniFFI Swift docs.)*

### Available functions (in current `ctrl.udl`):

| Function | Returns | Notes |
|---|---|---|
| `kernel_boot(data_dir: String)` | `Result<(), KernelError>` | Call once at app launch |
| `kernel_health()` | `Result<String, KernelError>` | JSON-encoded HealthSnapshot |
| `mcp_register(descriptor_json: String)` | `Result<(), KernelError>` | Register MCP server (no spawn) |
| `mcp_connect(server_id: String)` | `Result<(), KernelError>` | Lazy spawn + handshake |
| `mcp_list_tools(server_id: String)` | `Result<String, KernelError>` | JSON array of tools |
| `mcp_invoke(server_id, tool_name, args_json)` | `Result<String, KernelError>` | JSON result |
| `mcp_list_installed()` | `Result<String, KernelError>` | JSON array |
| `mcp_disconnect(server_id: String)` | `Result<(), KernelError>` | Cancel running server |

Future additions (deferred to P2.11+): callback-based streaming (LLM
chunks, event subscriptions), capability inspection, manifest CRUD.

---

## 6. UI visual specification

### 6.1 Window chrome

- Frameless: `NSWindow.styleMask = [.borderless]`
- Translucent: `NSVisualEffectView` with material `.hudWindow` / `.fullScreenUI`
- Always-on-top: `.floatingPanel` level
- Centered on screen at startup
- Hides on focus loss (`NSApplication.shared.hide`)

### 6.2 Keycap visual (per PRODUCT.md "Keycap 派工业精确")

- 5-layer shadow stack (CALayer or SwiftUI `.shadow` chain):
  1. inset top highlight (white, 0.6 opacity, 1px)
  2. inset bottom edge (black, 0.15, 1px)
  3. ground line (black, 0.08, 2px y-offset)
  4. near drop (black, 0.15, 8px blur, 4px y-offset)
  5. far drop (black, 0.08, 16px blur, 12px y-offset)

- Spring hover: `.scaleEffect` + `.shadow` interpolated with
  `Animation.interpolatingSpring(stiffness: 320, damping: 22)`

- Press: scale-down to 0.95, shadows compress (z-press feel)

### 6.3 Color tokens (from `Tokens.json`)

Light tokens: `bg #F5F5F7`, `card #FFFFFF`, `cardDeep #F0F0F3`, `primary #3B5BDB`, `text #1D1D1F`, and `shadowKeycap` referencing the 5-layer shadow stack above. Dark mode auto-derived per `Tokens.dark` block.

---

## 7. Hotkey detection (macOS)

Use `NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged)`; on `.control` flag transitions, call `AppDelegate.shared.toggleMainWindow()`. Requires Accessibility permission; prompt user on first launch via `AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt: true])`.

*(Swift hotkey scaffolding elided — superseded by ADR-002 PWA shell. Implementation reference: see `src-tauri/src/shell/hotkey.rs` in the active shell.)*

---

## 8. Lifecycle

```
NSApp launch
    ↓
AppDelegate.applicationDidFinishLaunching
    ↓
HotkeyService.start()
AccessibilityService.requestPermission()
KernelBridge.boot()    // calls kernel_boot via UniFFI
    ↓
SwiftUI App renders main window (hidden by default)
    ↓
User presses Ctrl
    ↓
HotkeyService notification → main window slides in
    ↓
KeycapStore loads installed keycaps (via UniFFI mcp_list_installed)
    ↓
Render KeycapPoolView with grid
    ↓
User selects keycap → WorkspaceView opens
    ↓
WorkspaceView dispatches via UniFFI to Rust kernel actor
    ↓
Rust returns stream of events; SwiftUI re-renders reactively
```

---

## 9. Tasks for MacBook Claude

### Phase M1 (1-2 days)
- [ ] Create `mac/` directory with empty Xcode project
- [ ] Build Rust core to `libctrl.dylib` (universal binary)
- [ ] Run `uniffi-bindgen generate` → produces `ctrl.swift`
- [ ] Link dylib + bindings in Xcode project
- [ ] Smoke test: SwiftUI button calls `kernel_boot()` + `kernel_health()`, displays JSON

### Phase M2 (3-5 days)
- [ ] Implement HotkeyService (global Ctrl monitor + Accessibility flow)
- [ ] Implement keycap window (frameless + Vibrancy + always-on-top)
- [ ] Render 8 placeholder keycaps in `KeycapPoolView` grid
- [ ] Wire keycap click → calls `mcp_invoke` via UniFFI

### Phase M3 (1 week)
- [ ] 5-layer shadow + spring animation polish
- [ ] Workspace pane: LLM streaming response display
- [ ] Settings pane: MCP server registration UI
- [ ] BYOK Anthropic key entry → Tauri Keychain via UniFFI

### Phase M4 (1 week)
- [ ] Real 5 P0 keycaps wired end-to-end (clipboard / OCR / translate / text / chat)
- [ ] Auto-update Rust core dylib via shared script
- [ ] Distribution: codesign + notarize + .dmg packaging

---

## 10. Out of scope (handled by Rust core)

- LLM API calls (Anthropic / OpenAI / Workers AI / Ollama)
- MCP server lifecycle (spawn / handshake / invoke / disconnect)
- Capability check / permission system
- Event sourcing / SQLite event store
- Vector memory / semantic cache
- Step engine / actor scheduler
- Manifest schema parsing

If MacBook Claude finds it needs any of these in Swift, **STOP**. The
feature belongs in Rust core. Add to `src-tauri/src/ctrl.udl`, regenerate
bindings, then consume in Swift.

---

## 11. Coordination protocol with Win shell

- **Both Win + Mac shells consume the same Rust core** (single source of truth)
- **UDL changes**: open coordination handoff in `.olym/handoffs/` before
  modifying `src-tauri/src/ctrl.udl`. Both shells re-run binding generation
- **No platform-specific business logic** in either shell. If you find
  yourself writing Swift LLM code, move it to Rust.
- **Visual tokens** (colors / shadows / spacing) defined in `Tokens.json`,
  consumed by both shells. PRODUCT.md is canonical.

---

## 12. Open questions for bao

- [ ] Codesign identity: Apple Developer team ID? (post-launch concern)
- [ ] Notarization automation: GitHub Actions or local Fastlane?
- [ ] Sparkle (auto-update framework) vs custom updater?
- [ ] Mac App Store distribution or direct .dmg only?

Defer until M1-M2 done.

---

## 13. References

- [UniFFI Swift bindings guide](https://mozilla.github.io/uniffi-rs/latest/swift/overview.html)
- [Calling Rust from Swift — Strathweb](https://www.strathweb.com/2023/07/calling-rust-code-from-swift/)
- [Integrating Rust and SwiftUI — Mitchell Hashimoto](https://dfrojas.com/software/integrating-Rust-and-SwiftUI.html)
- [swift-bridge (alternative if UniFFI insufficient)](https://lib.rs/crates/swift-bridge)
- PRODUCT.md (CTRL keycap visual spec)
- `.olym/specs/win-shell/spec.md` (sibling Win UI spec)
