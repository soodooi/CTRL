// Shell lifecycle.
//
// Coordinates app launch + shutdown across:
//   • Kernel daemon spawn (KernelSupervisor)
//   • Hotkey hook install (HotkeyController)
//   • Tray icon install (TrayController)
//   • Window setup (WindowController)
//
// Ordering invariant: kernel must report ready before hotkey is armed, so the
// first Ctrl tap can't reach a not-yet-listening kernel (ADR-003 frontend §11 risk #2).

use anyhow::Result;
use tauri::{AppHandle, Manager};

use super::window::install_close_intercept;
use super::{BrainSupervisor, HotkeyController, KernelSupervisor, TrayController, WindowController};

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

        // Seed builtin mcps under ~/.ctrl/mcps/. Idempotent (existing
        // user files are never overwritten); heals accidentally-deleted
        // builtins on every launch. Per ADR-002 substrate § composition v1 — `builtin = true` in the
        // manifest is the only distinction from user mcps; everything
        // else (routing / dispatch / capability gates / vault scoping)
        // works identically.
        tracing::info!("ShellLifecycle::boot — seeding builtin mcps");
        super::builtin_mcps::ensure_builtins_installed();

        // Pi is the sole brain — keep it always connected. Spawns + supervises
        // the @ctrl/pi-plugin MCP server (ctrl-pi-mcp on :17874) so the user
        // never starts it by hand. Non-blocking + graceful (Volc fallback).
        tracing::info!("ShellLifecycle::boot — starting Pi brain supervisor");
        BrainSupervisor::start(app);

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
