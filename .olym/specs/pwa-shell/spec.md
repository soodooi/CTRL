# PWA Shell — Tauri 2 Native Host Specification

- **Status**: Draft v0.1
- **Date**: 2026-05-13
- **Parent**: `.olym/decisions/002-pwa-pivot.md`
- **Supersedes**: `.olym/specs/win-shell/spec.md` (full deprecation), `.olym/specs/mac-shell/spec.md` (full deprecation — UI portion)
- **Sibling**: `.olym/specs/kernel/spec.md` (kernel internal design — unchanged, only deployment shape changes)

---

## 1. Scope

The PWA shell is the **only native code** that ships with CTRL desktop. It is a thin Tauri 2 application owning four (and only four) responsibilities:

1. Global `Ctrl` hotkey detection and window toggle
2. System tray icon and menu
3. Spawning/supervising the Rust kernel daemon (which in turn hosts MCP stdio child processes)
4. OS keychain for BYOK API key storage

It additionally hosts a WebView pointing at the PWA codebase (`packages/ctrl-web`) and provides a strict, capability-allowlisted JS↔Rust bridge.

The shell **does NOT own**:
- Any product UI (KeycapPool, Workspace, Settings, Marketplace, Manifest editor) — all in PWA
- LLM calls / MCP host logic / capability check / event store — all in Rust kernel
- Manifest schema / step engine / AI memory / vector search — all in Rust kernel or PWA
- Any cross-platform UI rendering — PWA does this with one codebase

If a feature can be done in the PWA, it must be done in the PWA. The shell is reserved for OS-API-only requirements.

---

## 2. Toolchain

```
Rust 1.75+ stable
Tauri 2.x stable (cargo install tauri-cli --version "^2")
Node 20.x LTS (for PWA build, not shell)
WebView2 evergreen (Win 10 1809+ ships it; Win 10 LTSC needs bootstrapper)
WKWebView (macOS 13+ ships it)
```

Cargo dependencies (Cargo.toml):

```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-stronghold = "2"
tauri-plugin-updater = "2"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
# kernel deps remain in src-tauri/src/kernel/, unchanged
```

Tray uses Tauri 2 built-in tray API (no separate plugin in 2.x).

---

## 3. Repository layout

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json                ← rewritten for PWA host + capability allowlist
├── capabilities/                  ← Tauri 2 capability files
│   ├── default.json               (production capabilities)
│   └── dev.json                   (devtools enabled)
├── icons/                         (tray + app icons)
└── src/
    ├── main.rs                    (entry: parses CLI flag --kernel-daemon vs --shell)
    ├── shell/                     ← NEW (this spec covers)
    │   ├── mod.rs
    │   ├── hotkey.rs              global Ctrl single-tap detection
    │   ├── tray.rs                system tray icon + menu
    │   ├── window.rs              frameless window, focus-loss hide, modal guard
    │   ├── lifecycle.rs           app launch / kernel boot / shutdown
    │   ├── kernel_supervisor.rs   spawn + supervise + health-check kernel daemon
    │   ├── keychain.rs            stronghold wrapper for BYOK keys
    │   └── updater.rs             auto-update channel
    ├── commands/                  ← NEW (Tauri 2 #[tauri::command] handlers)
    │   ├── mod.rs
    │   ├── kernel.rs              mcp_call, list_keycaps, run_keycap, …
    │   ├── stss.rs                subscribe, publish, list_streams
    │   ├── memory.rs              read_log, append, query
    │   └── keychain.rs            store_key, get_key, delete_key (capability-gated)
    └── kernel/                    UNCHANGED (the L1 microkernel impl)
        ├── actor.rs
        ├── capability.rs
        ├── event.rs
        ├── channel.rs
        ├── effect.rs
        ├── llm_port.rs
        ├── mcp_host.rs
        ├── persistence.rs
        └── daemon.rs              ← NEW: kernel-as-daemon entrypoint
```

Note: `win/` tree is removed entirely after migration.

---

## 4. Window configuration

```jsonc
// src-tauri/tauri.conf.json (excerpt)
{
  "app": {
    "windows": [{
      "label": "main",
      "title": "CTRL",
      "width": 920,
      "height": 560,
      "decorations": false,           // frameless
      "transparent": true,            // for Mica/vibrancy
      "alwaysOnTop": true,
      "resizable": false,
      "skipTaskbar": true,
      "visible": false,               // shown only when Ctrl is tapped
      "center": true,
      "windowEffects": {
        "effects": ["mica"],          // Win 11 Mica; on Mac use "vibrancy"
        "state": "active"
      }
    }],
    "security": {
      "csp": "default-src 'self' tauri://localhost; script-src 'self' tauri://localhost; connect-src 'self' tauri://localhost ws://localhost:* https://*.ctrl.run; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:"
    }
  }
}
```

CSP intentionally tight: no remote scripts, no eval. PWA bundle ships in app, served at `tauri://localhost`. Outbound only to local kernel WS and `*.ctrl.run`.

---

## 5. Hotkey detection (Responsibility #1)

Behavior (per W3.2 commit `5b651fc` baseline, ported to Rust):
- Single tap of `Ctrl` (no modifier, no held duration) within 200 ms → toggle window
- `Ctrl` held > 200 ms → not a tap (let pass through)
- `Ctrl + X` (any combination) → not a tap (let pass through)
- Window visible + Ctrl tap → hide
- Window hidden + Ctrl tap → show + focus

Implementation:

```rust
// src-tauri/src/shell/hotkey.rs
pub struct HotkeyService {
    last_ctrl_down: Option<Instant>,
    listener: GlobalShortcutManager,
}

impl HotkeyService {
    pub fn register(&mut self, app: &AppHandle) -> Result<()> {
        // Tauri 2 global shortcut for Ctrl key (raw key, not chord)
        // Note: tauri-plugin-global-shortcut handles chord conflicts
    }

    fn on_ctrl_down(&mut self) { self.last_ctrl_down = Some(Instant::now()); }

    fn on_ctrl_up(&mut self, app: &AppHandle) {
        if let Some(t) = self.last_ctrl_down.take() {
            if t.elapsed() < Duration::from_millis(200) {
                self.toggle_window(app);
            }
        }
    }
}
```

If `tauri-plugin-global-shortcut` does not expose key-up events (current 2.x limitation, requires verify), fall back to per-OS native impl (Win32 `RegisterHotKey` directly via `windows` crate, macOS `CGEventTap` via `core-graphics`). Spike in H-2026-05-13-001 Step 3.

**Latency budget**: ≤ 30 ms warm, ≤ 80 ms cold (matches W3 baseline).

---

## 6. Tray (Responsibility #2)

```rust
// src-tauri/src/shell/tray.rs
pub fn build_tray(app: &AppHandle) -> Result<()> {
    let menu = MenuBuilder::new(app)
        .item("Show CTRL", "show")
        .item("Settings", "settings")
        .separator()
        .item("Quit", "quit")
        .build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click { .. } => toggle_window(tray.app_handle()),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
```

Tray remains visible while window hidden (CTRL is "always-running" daemon, tray = control surface).

---

## 7. Kernel daemon supervision (Responsibility #3)

Single Rust binary, two entrypoints decided by CLI flag:

```rust
// src-tauri/src/main.rs
fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--kernel-daemon") => kernel::daemon::run(),
        _ => shell::lifecycle::run(),
    }
}
```

Shell spawns daemon as child process on launch:

```rust
// src-tauri/src/shell/kernel_supervisor.rs
pub struct KernelSupervisor {
    child: Option<Child>,
    ws_port: u16,
    ready_tx: oneshot::Sender<()>,
}

impl KernelSupervisor {
    pub async fn spawn(&mut self) -> Result<()> {
        let exe = std::env::current_exe()?;
        let mut cmd = Command::new(&exe);
        cmd.arg("--kernel-daemon")
           .arg("--port").arg(self.ws_port.to_string())
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());
        let child = cmd.spawn()?;
        // wait for "READY" line on stdout, then resolve ready_tx
        // restart on crash with exponential backoff (max 5 retries / 60s window)
    }
}
```

**Hotkey gating**: shell does NOT register the global hotkey until `ready_tx` resolves. Otherwise user Ctrl-taps land on a window with no kernel behind it.

**Daemon WebSocket port**: bind to `127.0.0.1:0` (OS-assigned), shell reads chosen port from daemon stdout, passes to PWA via Tauri command `get_kernel_ws_port()`.

---

## 8. Keychain (Responsibility #4)

`tauri-plugin-stronghold` wraps Win Credential Vault and macOS Keychain. Used for BYOK API keys (Anthropic / OpenAI / others).

Capability-gated commands (only callable from allowlisted PWA origin):

```rust
#[tauri::command]
async fn keychain_store(key_id: String, value: String) -> Result<(), String> { … }

#[tauri::command]
async fn keychain_get(key_id: String) -> Result<String, String> { … }

#[tauri::command]
async fn keychain_delete(key_id: String) -> Result<(), String> { … }
```

Keys never travel through the WebView in plaintext for storage; PWA passes value to `keychain_store`, retrieves via `keychain_get` only when needed for an LLM call. Future hardening (P11+): keys stay in keychain and the kernel daemon retrieves them directly, bypassing PWA entirely.

---

## 9. JS↔Rust bridge contract

PWA calls Rust via `@tauri-apps/api/core::invoke()`. Surface is the union of `commands/` modules:

| Command | Args | Returns | Capability |
|---|---|---|---|
| `kernel.list_keycaps` | `{}` | `KeycapManifest[]` | `keycap:read` |
| `kernel.run_keycap` | `{ id, args }` | `RunResult` | `keycap:run` |
| `kernel.mcp_call` | `{ server, tool, args }` | `McpResult` | `mcp:call` |
| `kernel.mcp_list_servers` | `{}` | `McpServer[]` | `mcp:read` |
| `stss.subscribe` | `{ stream_id }` | `Subscription` (event stream) | `stss:subscribe` |
| `stss.publish` | `{ stream_id, op }` | `void` | `stss:publish` |
| `memory.append` | `{ event }` | `void` | `memory:write` |
| `memory.query` | `{ filter }` | `Event[]` | `memory:read` |
| `keychain.store` | `{ key_id, value }` | `void` | `keychain:write` |
| `keychain.get` | `{ key_id }` | `string` | `keychain:read` |
| `shell.toggle_window` | `{}` | `void` | `shell:window` |
| `shell.get_kernel_ws_port` | `{}` | `number` | `shell:read` |

**Capabilities** declared in `src-tauri/capabilities/default.json`:

```jsonc
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    { "identifier": "kernel:read" },
    { "identifier": "kernel:run" },
    { "identifier": "mcp:call" },
    { "identifier": "mcp:read" },
    { "identifier": "stss:subscribe" },
    { "identifier": "stss:publish" },
    { "identifier": "memory:read" },
    { "identifier": "memory:write" },
    { "identifier": "keychain:read" },
    { "identifier": "keychain:write" },
    { "identifier": "shell:window" },
    { "identifier": "shell:read" }
  ]
}
```

No filesystem, no shell, no http, no process plugins enabled. PWA cannot escape this surface.

---

## 10. PWA load source

| Mode | Source | Used in |
|---|---|---|
| Production | `tauri://localhost` serving `packages/ctrl-web/dist/` (bundled into app) | shipped builds |
| Dev | `http://localhost:5173` (Vite dev server) | `cargo tauri dev` |
| Mobile (browser) | `https://app.ctrl.run` (Cloudflare Pages or Workers static) | iOS Safari / Android Chrome |

`tauri.conf.json` `frontendDist` points to `../packages/ctrl-web/dist`. Build pipeline:
```bash
npm -w @ctrl/web run build    # → packages/ctrl-web/dist/
cargo tauri build              # bundles dist/ into app
```

Service worker registered with scope `/`. Cache strategy:
- App shell: cache-first, version-bumped on every deploy
- API responses: network-first with stale fallback
- Static assets (icons, fonts): cache-first, immutable

Update flow:
- Service worker `skipWaiting` + `clients.claim` on activate
- Notify PWA UI via `BroadcastChannel('app-update')`, prompt user to reload (non-blocking toast)
- Tauri shell auto-update via `tauri-plugin-updater` checks `https://app.ctrl.run/latest.json`

---

## 11. Security boundaries

| Boundary | Trust model |
|---|---|
| OS ↔ shell | shell runs as user, no admin requested |
| Shell ↔ kernel daemon | localhost only, daemon binds `127.0.0.1`, no public bind ever |
| Kernel daemon ↔ MCP servers | stdio child processes, killed on daemon exit |
| Shell ↔ WebView | Tauri 2 IPC with strict capability allowlist (§9) |
| WebView ↔ PWA code | standard browser sandbox + CSP (§4) |
| PWA ↔ ctrl-cloud | HTTPS only, JWT auth (P8) |
| PWA ↔ remote kernel daemon (mobile) | WSS via cloud relay (post-launch P11+), VAPID-signed push for wake |

**Capability principle propagation**: ADR-001 §3.2 capability tokens at L1 kernel level → mirrored at L0 shell level via Tauri 2 capability allowlist. PWA never has ambient authority; every native operation declared.

---

## 12. Error handling

```rust
// src-tauri/src/shell/errors.rs (port from win/CTRL/Services/KernelErrors.cs)
#[derive(thiserror::Error, Debug, Serialize)]
pub enum ShellError {
    #[error("kernel daemon failed to start: {0}")]
    KernelBootFailed(String),
    #[error("kernel daemon crashed: {0}")]
    KernelCrashed(String),
    #[error("hotkey registration failed: {0}")]
    HotkeyRegistrationFailed(String),
    #[error("keychain access denied: {0}")]
    KeychainDenied(String),
    #[error("capability {0} not granted")]
    CapabilityDenied(String),
}

impl Serialize for ShellError { /* friendly JSON for PWA toast */ }
```

PWA receives errors as `{ kind: "ShellError", variant: "KernelCrashed", message: "..." }`. Display in app toast, log to memory store for triage.

**Restart policy**: kernel daemon crash → supervisor restart with exponential backoff (1s → 2s → 4s → 8s → 16s, then surface error to user). Hotkey unregisters during restart, re-registers when ready.

---

## 13. Update channel

`tauri-plugin-updater` pulls from `https://app.ctrl.run/updates/latest.json`:

```jsonc
{
  "version": "1.2.3",
  "notes": "...",
  "pub_date": "2026-05-13T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://app.ctrl.run/updates/CTRL-1.2.3-x64.msi"
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://app.ctrl.run/updates/CTRL-1.2.3-aarch64.dmg"
    }
  }
}
```

Updater code-signed with maintainer key (Tauri convention). PWA-only changes (no shell delta) ship via service-worker update — much faster path than shell update.

---

## 14. LOC budget (enforces "thin shell" promise)

| Module | Target LOC | Hard cap |
|---|---|---|
| `shell/hotkey.rs` | 80 | 150 |
| `shell/tray.rs` | 60 | 100 |
| `shell/window.rs` | 80 | 150 |
| `shell/lifecycle.rs` | 100 | 200 |
| `shell/kernel_supervisor.rs` | 120 | 200 |
| `shell/keychain.rs` | 50 | 100 |
| `shell/updater.rs` | 30 | 80 |
| `shell/errors.rs` | 40 | 80 |
| `commands/*` (sum) | 200 | 400 |
| **Total shell + commands** | **~760** | **1460** |

If any module exceeds hard cap, refactor or split. The shell must stay readable in one sitting.

---

## 15. Testing

### Unit tests (Rust)
- `shell/hotkey.rs` — single-tap detection, debounce, chord rejection
- `shell/kernel_supervisor.rs` — spawn, ready signal, restart on crash, max retry
- `shell/keychain.rs` — store/get/delete roundtrip with mock backend

### Integration tests
- Cold launch → daemon ready → hotkey registered → window toggle → kernel command → kernel response → window hide
- Daemon crash → supervisor restart → hotkey re-registered (gap measured)
- Update install simulation

### E2E (Playwright via Tauri WebDriver)
- Full user flow per `.olym/handoffs/H-2026-05-13-001` Step 8
- Run on Win 11 + macOS 14 in CI

---

## 16. Validation criteria (acceptance)

- ✅ Total native shell LOC ≤ 1460 (hard cap)
- ✅ `Ctrl` single-tap latency: ≤ 30 ms warm, ≤ 80 ms cold
- ✅ Kernel daemon ready signal arrives ≤ 500 ms after shell start
- ✅ MCP roundtrip (PWA → daemon → MCP server → PWA): ≤ 200 ms (matches W3.6 baseline)
- ✅ Capability allowlist rejects undeclared command (test: `invoke('shell.exec', ...)` fails)
- ✅ CSP blocks remote script load (test: `<script src="https://evil.com/x.js">` rejected)
- ✅ Daemon crash + restart → window toggle works again within 5 s
- ✅ BYOK key stored in OS keychain (verified out-of-process: open Win Credential Manager / macOS Keychain Access)
- ✅ App installer (.msi / .dmg) ≤ 30 MB (excluding bundled WebView2 bootstrapper)

---

## 17. Open questions

| Question | Defer to |
|---|---|
| `tauri-plugin-global-shortcut` 2.x exposes key-up events? | H-2026-05-13-001 Step 3 spike |
| Daemon IPC: WS only, or add Unix domain socket / named pipe for lower latency | Step 4 prototype, measure |
| Devtools toggle in production (debug shortcut Ctrl+Shift+I)? | Step 4 |
| Multi-window support (separate Settings window vs in-app route) | P5 (Settings UI design) |
| Mac code signing + notarization automation | Pre-P10 beta |
| Auto-launch at login (registry / launchd entry) | Post-P10 |

---

## 18. What this spec is NOT

- Not a PWA UI design spec — that lives in `packages/ctrl-web/` and design docs
- Not a kernel design spec — see `.olym/specs/kernel/spec.md`
- Not a manifest spec — see `.olym/specs/tool-manifest/spec.md`
- Not a deployment spec — see ctrl-cloud repo (separate)
- Not a Mac-specific spec — Tauri 2 cross-platform; Mac-specific quirks (vibrancy, notarization) noted inline

The shell is intentionally boring. That is its value.
