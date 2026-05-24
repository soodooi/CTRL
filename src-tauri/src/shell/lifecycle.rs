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

use super::ax_prompt::{
    ensure_accessibility_trusted_with_prompt, is_first_launch, mark_first_launch_done,
};
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

        // Accessibility permission gate (macOS only no-op elsewhere). The
        // CGEventTap hotkey path needs this; without it the user sees
        // "Ctrl does nothing" and has to guess. Calling this surfaces the
        // standard macOS Privacy & Security dialog on the first launch
        // where the permission isn't already granted. Per bao 2026-05-23:
        // "你应该自动弹出 不要让用户猜".
        let ax_trusted = ensure_accessibility_trusted_with_prompt();
        if !ax_trusted {
            tracing::warn!(
                "Accessibility not yet granted — system prompt surfaced. Hotkey will arm \
                 once user enables CTRL in System Settings → Privacy & Security → Accessibility."
            );
        }

        let first_launch = is_first_launch();
        if first_launch {
            // First boot: show the window directly so the user sees CTRL
            // running. Without this, the prewarm-cloak path leaves the
            // app invisible until a hotkey works — and the hotkey needs
            // a permission the user hasn't granted yet. Chicken-and-egg
            // fix: visible first launch, prewarm-cloak from boot #2 on.
            tracing::info!("ShellLifecycle::boot — first launch detected, showing main window");
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.center();
                let _ = main.show();
                let _ = main.set_focus();
            }
            mark_first_launch_done();
        } else {
            // Steady-state launch: teleport the auto-built main window
            // off-screen as the very first thing after kernel ready.
            // Tauri's window-config `x`/`y` is unreliable on Win11 (often
            // centered regardless), so do it from Rust to guarantee the
            // user never sees the launcher until they press Ctrl. WebView2
            // / WKWebView spin up in the background, PWA mounts off-screen
            // — first hotkey tap becomes a sub-30ms teleport.
            tracing::info!("ShellLifecycle::boot — prewarming main window off-screen");
            WindowController::prewarm(app)?;
        }

        // Install close intercept on main so the X button also teleports
        // off-screen rather than destroying state.
        tracing::info!("ShellLifecycle::boot — installing close intercept on main");
        if let Some(main) = app.get_webview_window("main") {
            install_close_intercept(&main, app, "main");
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

        // Background update prewarm — start polling the release endpoint
        // before the user opens the window so the cockpit can render the
        // "Upgrade" pill instantly on first mount. Per bao 2026-05-23:
        // "update 不应该打开窗口后才检查, 应该后台直接做完, 用户打开页面
        // 直接就点击能升级".
        crate::commands::system::spawn_update_prewarm(app.clone());

        tracing::info!("ShellLifecycle::boot — complete");
        Ok(())
    }
}
