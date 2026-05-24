// Window controller — DWM cloak launcher (instant multi-cycle toggle).
//
// Root cause (pinned after 2 days of detours):
//   wry calls ICoreWebView2Controller::SetIsVisible once at init and never
//   again — there is no public set_visible on InnerWebView. Tauri's own
//   WebviewWindow::hide() only flips the host HWND's WS_VISIBLE bit, and
//   WebView2's DComp surfaces composite directly via DWM, bypassing that
//   bit. Net effect: every public hide path leaves the WebView pixels
//   visible on screen after the first cycle.
//
// The fix: DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, TRUE). DWM cloak
// operates ABOVE the DComp surface — DWM still composes the surface but
// does not present it. Microsoft's docs explicitly endorse this for the
// "DirectComposition visual on a child window" case
// (learn.microsoft.com/.../dwmapi/ne-dwmapi-dwmwindowattribute, DWMWA_CLOAK).
// It is the same API the Windows shell uses to hide PowerToys' command
// palette and taskbar animations. Cloak is a pure boolean attribute, not
// a window-state transition, so it survives arbitrary toggle cycles.
//
// What we ruled out before reaching this:
//   • WebviewWindow::hide() / Win32 SW_HIDE — DComp stays composited.
//   • DestroyWindow + rebuild — works, but ~300ms cold rebuild per summon.
//   • set_position(-32000) — DComp surface stays at original rect after
//     parent HWND moves.
//   • WS_EX_LAYERED + alpha 0 — WebView2 DComp bypasses layered alpha.
//   • controller.SetIsVisible via with_webview — closure queues onto the
//     event loop, executes 10s+ behind the current run_on_main_thread.
//   • OnceLock + sync controller.SetIsVisible — even when called sync,
//     wry's IsVisible flag isn't a presentation API and the DComp commit
//     waits for the next message-pump tick anyway.

#![allow(dead_code)]

use anyhow::Result;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::hotkey;

pub struct WindowController;

impl WindowController {
    pub fn main(app: &AppHandle) -> Option<WebviewWindow> {
        app.get_webview_window("main")
    }

    /// Boot prewarm. The window comes pre-built from tauri.conf.json with
    /// `visible: true` so wry's DComp surface is fully initialized; we
    /// immediately cloak it so the user sees nothing until the first Ctrl
    /// tap. WebView2 keeps the PWA mounted in the background — every
    /// future show is a single Win32 attribute flip.
    pub fn prewarm(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            return Ok(());
        };
        #[cfg(target_os = "windows")]
        cloak::set(&w, true);
        tracing::info!("WindowController::prewarm — main cloaked at boot");
        Ok(())
    }

    /// Toggle the main window. Called by hotkey + tray click.
    ///
    /// Cloaked → uncloak + raise + focus. Uncloaked → cloak. The cloak
    /// flag flips synchronously at the DWM attribute table; the visual
    /// state updates on the next DWM composition tick (~8ms at 120Hz).
    /// No destroy, no rebuild, no event-loop queueing.
    pub fn toggle(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            tracing::info!("WindowController::toggle — main missing, rebuilding");
            let w = Self::build_main(app)?;
            #[cfg(target_os = "windows")]
            cloak::set(&w, false);
            // Don't set focus - this allows hotkey to work while window is visible
            // let _ = w.set_focus();
            return Ok(());
        };

        #[cfg(target_os = "windows")]
        {
            let was_cloaked = cloak::is_cloaked(&w).unwrap_or(false);
            if was_cloaked {
                tracing::info!("WindowController::toggle — uncloak (show)");
                cloak::set(&w, false);
                // Reset hotkey state when window is shown to prevent interference
                super::hotkey::HotkeyController::reset_state();
                // Don't set focus - this allows hotkey to work while window is visible
                // let _ = w.set_focus();
            } else {
                tracing::info!("WindowController::toggle — cloak (hide)");
                cloak::set(&w, true);
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            // macOS: cloak bug is Win11-specific, native hide/show works.
            // BUT: CGEventTap modifier-flag race after Cmd-Tab app switches
            // can leave ctrl_pending stuck. Reset hotkey state on show so the
            // 3rd+ Ctrl tap doesn't silently no-op.
            let visible = w.is_visible().unwrap_or(false);
            if visible {
                tracing::info!("WindowController::toggle — hide (macOS)");
                let _ = w.hide();
            } else {
                tracing::info!("WindowController::toggle — show (macOS)");
                let _ = w.show();
                let _ = w.set_focus();
                // Mirror Win path: clear hotkey state so the next Ctrl tap
                // starts fresh regardless of what FlagsChanged events were
                // dropped while the window was off-screen.
                super::hotkey::HotkeyController::reset_state();
            }
        }
        Ok(())
    }

    /// Always-reveal — bring the main window into view regardless of
    /// current state. Used by single-instance + macOS Dock reopen
    /// handlers so a second `open .app` or a Dock click consistently
    /// surfaces the window (vs `toggle` which would hide it when
    /// already visible). Per bao 2026-05-23: '在任务栏 就是打不开'.
    pub fn reveal(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            tracing::info!("WindowController::reveal — main missing, rebuilding");
            let w = Self::build_main(app)?;
            #[cfg(target_os = "windows")]
            cloak::set(&w, false);
            let _ = w.show();
            let _ = w.set_focus();
            return Ok(());
        };
        #[cfg(target_os = "windows")]
        {
            cloak::set(&w, false);
            super::hotkey::HotkeyController::reset_state();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.unminimize();
            super::hotkey::HotkeyController::reset_state();
        }
        tracing::info!("WindowController::reveal — main shown + focused");
        Ok(())
    }

    /// Build the main launcher window. Recovery path; normally the window
    /// comes pre-built from tauri.conf.json `windows: [...]`.
    pub fn build_main(app: &AppHandle) -> Result<WebviewWindow> {
        let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
            .title("CTRL")
            .inner_size(920.0, 560.0)
            .min_inner_size(480.0, 420.0)
            .decorations(false)
            .transparent(false)
            .shadow(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .focused(true)
            .center()
            .resizable(false)
            .build()?;
        install_close_intercept(&w, app, "main");
        Ok(w)
    }

    /// Open (or focus) the workspace window with a specific keycap loaded.
    ///
    /// Per bao 2026-05-14: 工作区是独立窗口, 对应所选按键. Workspace window
    /// is rebuilt fresh per activation so the new keycap_id query param
    /// drives the route from a clean WebView state (same destroy + rebuild
    /// trick as the main window).
    pub fn open_workspace(app: &AppHandle, keycap_id: &str) -> Result<()> {
        // If a workspace window already exists, destroy it so the rebuild
        // below loads the new keycap_id cleanly.
        if let Some(existing) = app.get_webview_window("workspace") {
            let _ = existing.destroy();
        }
        let safe_keycap = keycap_id.replace(['\'', '"', '\\', '\n', '\r'], "");
        let url = format!("/workspace?keycap_id={safe_keycap}");
        let w = WebviewWindowBuilder::new(app, "workspace", WebviewUrl::App(url.into()))
            .title("CTRL · Workspace")
            .inner_size(640.0, 480.0)
            .min_inner_size(400.0, 320.0)
            .decorations(true)
            .transparent(false)
            .shadow(true)
            .always_on_top(false)
            .skip_taskbar(false)
            .focused(true)
            .center()
            .resizable(true)
            .build()?;
        install_close_intercept(&w, app, "workspace");
        tracing::info!("workspace window built for keycap_id={}", keycap_id);
        Ok(())
    }

    /// Close (destroy) the workspace window. Called by the keycap actor on
    /// completion, by the PWA close button, or by Esc.
    pub fn close_workspace(app: &AppHandle) -> Result<()> {
        if let Some(w) = app.get_webview_window("workspace") {
            let _ = w.destroy();
        }
        Ok(())
    }

    /// Hide the main window unless a modal child has been opened.
    /// In the destroy + rebuild model, "hide" = "destroy".
    pub fn hide_unless_modal(app: &AppHandle) -> Result<()> {
        if let Some(w) = Self::main(app) {
            let _ = w.destroy();
        }
        Ok(())
    }

    /// Always-hide — same path as the hide branch of `toggle`, but
    /// unconditional. Used by the cockpit's top-right Hide button so bao
    /// has a click fallback when the Ctrl hotkey state is broken (CGEventTap
    /// permission drop, FlagsChanged desync, etc.).
    pub fn hide(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            return Ok(());
        };
        #[cfg(target_os = "windows")]
        {
            tracing::info!("WindowController::hide — cloak");
            cloak::set(&w, true);
        }
        #[cfg(not(target_os = "windows"))]
        {
            tracing::info!("WindowController::hide — hide (macOS)");
            let _ = w.hide();
        }
        Ok(())
    }
}

/// DWM cloak — the only Win11 + WebView2 + DComp hide path that works
/// every cycle. See module header for the failure analysis. `set(window,
/// true)` makes the window invisible to the user while DWM still composes
/// the WebView2 surface in the background. `set(window, false)` brings it
/// back instantly with no rebuild cost.
#[cfg(target_os = "windows")]
mod cloak {
    use std::ffi::c_void;
    use tauri::WebviewWindow;
    use windows_sys::Win32::Foundation::{BOOL, HWND};
    use windows_sys::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAK, DWMWA_CLOAKED,
    };

    fn hwnd(w: &WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| h.0 as HWND)
    }

    pub(super) fn set(w: &WebviewWindow, cloaked: bool) {
        let Some(h) = hwnd(w) else { return };
        let flag: BOOL = if cloaked { 1 } else { 0 };
        // SAFETY: HWND obtained from Tauri is valid for the WebviewWindow
        // lifetime. DwmSetWindowAttribute is a documented Win32 API; the
        // attribute write is internally serialized by DWM. We pass the
        // address + exact size of a BOOL as the docs require.
        unsafe {
            DwmSetWindowAttribute(
                h,
                DWMWA_CLOAK as u32,
                &flag as *const BOOL as *const c_void,
                std::mem::size_of::<BOOL>() as u32,
            );
        }
    }

    pub(super) fn is_cloaked(w: &WebviewWindow) -> Option<bool> {
        let h = hwnd(w)?;
        let mut value: u32 = 0;
        // SAFETY: HWND valid; we provide a u32 out-buffer matching the docs
        // for DWMWA_CLOAKED (returns a DWORD indicating the cloaking source
        // 0 = not cloaked, non-zero = cloaked by app/inherited/shell).
        let hr = unsafe {
            DwmGetWindowAttribute(
                h,
                DWMWA_CLOAKED as u32,
                &mut value as *mut u32 as *mut c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
        if hr == 0 {
            Some(value != 0)
        } else {
            None
        }
    }
}

/// Install a WindowEvent::CloseRequested handler that intercepts the OS X
/// button. Main launcher: cloak (preserves PWA state, instant re-show).
/// Workspace window: destroy (workspaces are per-keycap, no preserved state).
pub(crate) fn install_close_intercept(w: &WebviewWindow, app: &AppHandle, label: &str) {
    let app_for_event = app.clone();
    let label_owned = label.to_string();
    w.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            tracing::info!("close requested on window={} — intercept routing", label_owned);
            api.prevent_close();
            let app_for_closure = app_for_event.clone();
            let label_for_closure = label_owned.clone();
            let _ = app_for_event.run_on_main_thread(move || {
                if let Some(w) = app_for_closure.get_webview_window(&label_for_closure) {
                    if label_for_closure == "main" {
                        #[cfg(target_os = "windows")]
                        cloak::set(&w, true);
                    } else {
                        let _ = w.destroy();
                    }
                }
            });
        }
    });
}
