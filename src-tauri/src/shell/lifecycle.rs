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
use tauri::{AppHandle, Manager, WindowEvent};

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

        // Intercept the OS close button (X) on every webview window. Tauri 2
        // default CloseRequested destroys the window — that turns it into a
        // one-shot, lose-it-forever surface (lone-Ctrl after user clicks X
        // returns "main window not found"). For a launcher app we want X to
        // hide, so the app stays alive in tray + hotkey for re-summoning.
        // Workspace window X = close the workspace (different intent than
        // toggling main).
        tracing::info!("ShellLifecycle::boot — wiring close-to-hide on main + workspace");
        for label in ["main", "workspace"] {
            if let Some(window) = app.get_webview_window(label) {
                let app_for_event = app.clone();
                let label_owned = label.to_string();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        tracing::info!("close requested on window={label_owned} — intercepted, hiding");
                        api.prevent_close();
                        let app = app_for_event.clone();
                        let app_for_closure = app.clone();
                        let label_for_call = label_owned.clone();
                        let _ = app.run_on_main_thread(move || {
                            let result = if label_for_call == "main" {
                                WindowController::toggle(&app_for_closure)
                            } else {
                                WindowController::close_workspace(&app_for_closure)
                            };
                            if let Err(err) = result {
                                tracing::error!(?err, "close intercept hide failed");
                            }
                        });
                    }
                });
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
