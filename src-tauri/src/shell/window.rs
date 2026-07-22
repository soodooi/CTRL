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

#[cfg(target_os = "macos")]
mod macos_window {
    use objc2_app_kit::NSWindow as LegacyNSWindow;
    use objc2_foundation::MainThreadMarker as LegacyMainThreadMarker;
    use tauri::{Manager, WebviewWindow, Wry};
    use tauri_nspanel::{
        CollectionBehavior, ManagerExt, PanelHandle, PanelLevel, StyleMask, WebviewWindowExt,
    };

    tauri_nspanel::tauri_panel!(CtrlLauncherPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
        }
    });

    type LauncherPanelHandle = PanelHandle<Wry>;

    fn native<'a>(
        window: &'a WebviewWindow,
        _main_thread: &LegacyMainThreadMarker,
    ) -> Option<&'a LegacyNSWindow> {
        let pointer = window.ns_window().ok()?;
        // SAFETY: Tauri owns this NSWindow for at least as long as the
        // WebviewWindow handle, and the marker proves this is the main thread.
        unsafe { (pointer as *const LegacyNSWindow).as_ref() }
    }

    fn panel(window: &WebviewWindow) -> Option<LauncherPanelHandle> {
        if let Ok(panel) = window
            .app_handle()
            .get_webview_panel(window.label())
        {
            return Some(panel);
        }
        match window.to_panel::<CtrlLauncherPanel>() {
            Ok(panel) => Some(panel),
            Err(error) => {
                tracing::error!(?error, "WindowController — failed to convert launcher to NSPanel");
                None
            }
        }
    }

    fn configure_panel(panel: &LauncherPanelHandle) {
        panel.set_floating_panel(true);
        panel.set_level(PanelLevel::Status.value());
        panel.set_hides_on_deactivate(false);
        panel.set_style_mask(
            StyleMask::empty()
                .resizable()
                .nonactivating_panel()
                .into(),
        );
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .stationary()
                .full_screen_auxiliary()
                .into(),
        );
    }

    /// Keep the input-first launcher available in normal and full-screen
    /// Spaces. The fixed Accessory process owns an input-capable NSPanel;
    /// standard Regular NSWindows cannot reliably cross another app's
    /// full-screen Space. (ADR-003 frontend §1.1 v24)
    pub(super) fn configure(window: &WebviewWindow) {
        let Some(_mtm) = LegacyMainThreadMarker::new() else {
            tracing::warn!("WindowController — configuration requested off the macOS main thread");
            return;
        };
        let Some(panel) = panel(window) else {
            return;
        };
        configure_panel(&panel);
    }

    pub(super) fn is_on_active_space(window: &WebviewWindow) -> Option<bool> {
        let mtm = LegacyMainThreadMarker::new()?;
        let window = native(window, &mtm)?;
        Some(unsafe { window.isOnActiveSpace() })
    }

    pub(super) fn present(window: &WebviewWindow) {
        let Some(_mtm) = LegacyMainThreadMarker::new() else {
            tracing::warn!("WindowController — presentation requested off the macOS main thread");
            return;
        };
        let Some(panel) = panel(window) else {
            return;
        };
        configure_panel(&panel);

        // Accessory is fixed at process boot; this panel only performs the
        // current-Space reveal and key-window handoff. It never mutates the
        // activation policy. (ADR-003 frontend §1.1 v24)
        panel.show_and_make_key();
    }
}

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
        {
            cloak::set(&w, true);
            tracing::info!("WindowController::prewarm — main cloaked at boot");
        }
        // macOS: hide the launcher at boot so it stays invisible until the
        // first Ctrl tap. Without this the tauri.conf `visible: true` window
        // sits on screen (always-on-top) and can cover the system
        // Accessibility prompt the hotkey thread raises on first launch.
        #[cfg(target_os = "macos")]
        {
            macos_window::configure(&w);
            let _ = w.hide();
            tracing::info!("WindowController::prewarm — main hidden at boot");
        }
        Ok(())
    }

    /// Always-reveal — bring the main window into view regardless of
    /// current state. Used by single-instance, LaunchServices reopen, and
    /// menu-bar actions so an explicit open request consistently surfaces the
    /// window instead of toggling an already-visible launcher closed.
    /// (ADR-003 frontend §1.1 v24)
    pub fn reveal(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            tracing::info!("WindowController::reveal — main missing, rebuilding");
            let rebuilt = Self::build_main(app)?;
            #[cfg(target_os = "windows")]
            cloak::set(&rebuilt, false);
            #[cfg(target_os = "macos")]
            {
                let _ = rebuilt.show();
                macos_window::present(&rebuilt);
            }
            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            {
                let _ = rebuilt.show();
                let _ = rebuilt.set_focus();
            }
            return Ok(());
        };
        #[cfg(target_os = "windows")]
        {
            cloak::set(&w, false);
            super::hotkey::HotkeyController::reset_state();
        }
        #[cfg(target_os = "macos")]
        {
            let _ = w.show();
            macos_window::present(&w);
        }
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            let _ = w.show();
            let _ = w.set_focus();
        }
        tracing::info!("WindowController::reveal — main shown");
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
            let rebuilt = Self::build_main(app)?;
            #[cfg(target_os = "windows")]
            cloak::set(&rebuilt, false);
            #[cfg(target_os = "macos")]
            {
                let _ = rebuilt.show();
                macos_window::present(&rebuilt);
            }
            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            {
                let _ = rebuilt.show();
                let _ = rebuilt.set_focus();
            }
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
            let visible = w.is_visible().unwrap_or(false);
            #[cfg(target_os = "macos")]
            let visible_on_active_space =
                visible && macos_window::is_on_active_space(&w).unwrap_or(false);
            #[cfg(not(target_os = "macos"))]
            let visible_on_active_space = visible;

            if visible_on_active_space {
                tracing::info!("WindowController::toggle — hide");
                let _ = w.hide();
                // Sync hide for the input companion window so users don't
                // see a stranded textarea floating on screen after Ctrl-hide
                // (bao 2026-05-30: 'Ctrl toggles both windows visible/hidden together').
                if let Some(input) = app.get_webview_window("input") {
                    let _ = input.hide();
                }
                // Workspace independent window also cascades. macOS
                // addChildWindow already auto-hides children when parent
                // hides; the explicit call here is defense-in-depth.
                if let Some(workspace) = app.get_webview_window("workspace") {
                    let _ = workspace.hide();
                }
            } else {
                tracing::info!("WindowController::toggle — show on active Space");
                let _ = w.show();
                // Same — bring the input companion back up alongside main.
                if let Some(input) = app.get_webview_window("input") {
                    let _ = input.show();
                }
                #[cfg(target_os = "macos")]
                macos_window::present(&w);
                #[cfg(not(target_os = "macos"))]
                let _ = w.set_focus();
            }
        }
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
            .resizable(true)
            .build()?;
        install_close_intercept(&w, app, "main");
        #[cfg(target_os = "macos")]
        macos_window::configure(&w);
        Ok(w)
    }

    /// Open (or focus) the workspace window with a specific mcp loaded.
    ///
    /// Per bao 2026-05-14: the workspace is a standalone window, corresponding to the selected mcp. Workspace window
    /// is rebuilt fresh per activation so the new mcp_id query param
    /// drives the route from a clean WebView state (same destroy + rebuild
    /// trick as the main window).
    pub fn open_workspace(app: &AppHandle, mcp_id: &str) -> Result<()> {
        // If a workspace window already exists, destroy it so the rebuild
        // below loads the new mcp_id cleanly.
        if let Some(existing) = app.get_webview_window("workspace") {
            let _ = existing.destroy();
        }
        let safe_mcp = mcp_id.replace(['\'', '"', '\\', '\n', '\r'], "");
        let url = format!("/workspace?mcp_id={safe_mcp}");
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
        tracing::info!("workspace window built for mcp_id={}", mcp_id);
        Ok(())
    }

    /// Close (destroy) the workspace window. Called by the mcp actor on
    /// completion, by the PWA close button, or by Esc.
    pub fn close_workspace(app: &AppHandle) -> Result<()> {
        if let Some(w) = app.get_webview_window("workspace") {
            let _ = w.destroy();
        }
        Ok(())
    }

    /// Hide the main window unless a modal child has been opened.
    /// macOS keeps the converted NSPanel alive so the panel manager and
    /// WebviewWindow continue to reference the same launcher instance.
    pub fn hide_unless_modal(app: &AppHandle) -> Result<()> {
        if let Some(w) = Self::main(app) {
            #[cfg(target_os = "macos")]
            let _ = w.hide();
            #[cfg(not(target_os = "macos"))]
            let _ = w.destroy();
        }
        Ok(())
    }

    /// Unconditional hide — backs the top-right Hide (×) button in the
    /// cockpit StatusBar (`hide_window` Tauri command). Click is an
    /// explicit user signal so we don't gate on modal state. Same
    /// destroy-the-window mechanism as hide_unless_modal (see the
    /// module header for why CTRL uses destroy + rebuild on macOS).
    pub fn hide(app: &AppHandle) -> Result<()> {
        if let Some(w) = Self::main(app) {
            tracing::info!("WindowController::hide — explicit user request");
            // macOS: hide (not destroy) so the launcher stays tray-resident.
            // Destroying the last window fires ExitRequested → quits the app
            // (which would also kill the hotkey + Pi supervisor threads).
            // Mirrors toggle()'s hide branch.
            #[cfg(target_os = "macos")]
            let _ = w.hide();
            #[cfg(not(target_os = "macos"))]
            let _ = w.destroy();
        }
        // Sync hide the input companion window too.
        if let Some(input) = app.get_webview_window("input") {
            let _ = input.hide();
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
/// Workspace window: destroy (workspaces are per-mcp, no preserved state).
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
                        #[cfg(target_os = "macos")]
                        let _ = w.hide();
                    } else {
                        let _ = w.destroy();
                    }
                }
            });
        }
    });
}
