// Shell lifecycle.
//
// Coordinates app launch + shutdown across:
//   • Kernel daemon spawn (KernelSupervisor)
//   • Hotkey hook install (HotkeyController)
//   • Tray icon install (TrayController)
//   • Window setup (WindowController)
//
// Ordering invariant: kernel must report ready before hotkey is armed, so the
// first Ctrl tap can't reach a not-yet-listening kernel (ADR-002 §11 risk #2).

use anyhow::Result;
use tauri::{AppHandle, Manager};

use super::window::install_close_intercept;
use super::{HotkeyController, KernelSupervisor, TrayController, WindowController};

pub struct ShellLifecycle;

impl ShellLifecycle {
    /// Boot the shell. Runs inside `tauri::Builder::setup`.
    ///
    /// Order is load-bearing:
    /// 1. KernelSupervisor starts the kernel daemon so commands have something
    ///    to route to.
    /// 2. KernelSupervisor::wait_ready blocks until the daemon reports ready
    ///    (prevents the first Ctrl tap landing before mcp_host is up).
    /// 3. Tray icon installs (cheap; user-visible feedback that we're alive).
    /// 4. Window close-button interception (X = hide, not destroy).
    /// 5. Lone-Ctrl hotkey installs LAST.
    pub fn boot(app: &AppHandle) -> Result<()> {
        tracing::info!("ShellLifecycle::boot — starting kernel daemon");
        KernelSupervisor::start(app)?;
        KernelSupervisor::wait_ready(5_000)?;

        tracing::info!("ShellLifecycle::boot — installing tray");
        TrayController::install(app)?;

        // Prewarm: teleport the auto-built main window off-screen as the very
        // first thing after kernel ready. Tauri's window-config `x`/`y` is
        // unreliable on Win11 (often centered regardless), so do it from
        // Rust to guarantee the user never sees the launcher until they
        // press Ctrl. WebView2 spins up in the background, PWA mounts off-
        // screen — first hotkey tap becomes a sub-30ms teleport.
        tracing::info!("ShellLifecycle::boot — prewarming main window off-screen");
        WindowController::prewarm(app)?;

        // Install close intercept on the prewarmed main so the X button also
        // teleports off-screen rather than destroying state.
        tracing::info!("ShellLifecycle::boot — installing close intercept on main");
        if let Some(main) = app.get_webview_window("main") {
            install_close_intercept(&main, app, "main");
        }

        // macOS: CGEventTap silently no-ops without Accessibility trust. Show
        // the system prompt + open the Privacy pane on the first cold launch
        // where trust is missing; second launch finds the user has granted
        // and HotkeyController::install succeeds (H-2026-05-19-003).
        #[cfg(target_os = "macos")]
        {
            if !ax::ensure_trusted_with_prompt() {
                tracing::warn!(
                    "macOS Accessibility trust not granted — system prompt shown. \
                     Hotkey will not fire until the user adds CTRL to \
                     System Settings > Privacy & Security > Accessibility."
                );
            }
        }

        tracing::info!("ShellLifecycle::boot — installing lone-Ctrl hotkey");
        let app_for_hotkey = app.clone();
        let _hotkey = HotkeyController::install(move || {
            // Fires on the OS dispatch thread; the trace log gives us
            // immediate evidence that the hook + state machine work even when
            // the toggle itself silently no-ops (Win11 Mica quirk territory).
            tracing::info!("hotkey: lone-Ctrl tap detected");
            let app = app_for_hotkey.clone();
            let app_for_closure = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(err) = WindowController::toggle(&app_for_closure) {
                    tracing::error!(?err, "WindowController::toggle failed");
                }
            });
        })?;
        // Leak the HotkeyController for the process lifetime — Drop tears down
        // the OS hook on exit anyway via the Tauri shutdown path.
        std::mem::forget(_hotkey);

        tracing::info!("ShellLifecycle::boot — complete");
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod ax {
    // ApplicationServices framework AX trust check. Inline FFI keeps the dep
    // surface tight (we already link core-graphics + core-foundation for the
    // CGEventTap hotkey; ApplicationServices is the umbrella that also exports
    // the AX bits, no extra crate needed).
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    }

    /// Returns `true` if the current process holds Accessibility trust.
    ///
    /// When trust is missing, macOS shows its own "X would like to control
    /// this computer using accessibility features" alert and links to the
    /// Privacy & Security pane. The user grants once; future launches return
    /// `true` without re-prompting.
    pub fn ensure_trusted_with_prompt() -> bool {
        // SAFETY: ApplicationServices is linked statically; the constants and
        // function are part of its public ABI. `wrap_under_get_rule` increments
        // the CF retain count, balanced by the CFDictionary's drop.
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let value = CFBoolean::true_value();
            let opts: CFDictionary<CFString, CFBoolean> =
                CFDictionary::from_CFType_pairs(&[(key, value)]);
            AXIsProcessTrustedWithOptions(opts.as_concrete_TypeRef())
        }
    }
}
