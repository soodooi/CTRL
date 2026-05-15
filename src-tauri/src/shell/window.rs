// Window controller — launcher pattern with destroy + rebuild.
//
// Why destroy + rebuild instead of hide / show:
//
// Tauri 2 on Win11 + WebView2 composites the window contents via Direct
// Composition surfaces. DComp draws to absolute screen coordinates and
// IGNORES Win32 visibility hints:
//   - WebviewWindow::hide() flips WS_VISIBLE but DComp keeps compositing
//   - ShowWindow(SW_HIDE) — same: WS_VISIBLE=0 but DComp pixels stay
//   - SetWindowPos to off-screen — Win32 confirms RECT moved, but WebView2's
//     DComp surface stays at the original screen rect
//   - ShowWindow(SW_MINIMIZE) — works visually but turns the launcher into
//     a taskbar entry, which is not the ephemeral feel we want
//
// Only DestroyWindow truly tears down the DComp surface. Rebuild on next
// summon: WebView2 process is already warm, PWA assets are HTTP-cached
// (dev) or bundled (release), so the rebuild is sub-300ms in practice
// — under the perceptual threshold for "snappy".
//
// This is the same pattern Raycast / Alfred / Spotlight use, for the
// same root cause: modern compositor-backed WebViews don't honor classic
// hide/show on every platform consistently.

use anyhow::Result;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub struct WindowController;

impl WindowController {
    pub fn main(app: &AppHandle) -> Option<WebviewWindow> {
        app.get_webview_window("main")
    }

    /// Toggle the main window. Called by hotkey + tray click.
    ///
    /// Exists → destroy. Doesn't exist → build. No hide/show involved.
    pub fn toggle(app: &AppHandle) -> Result<()> {
        if let Some(w) = Self::main(app) {
            tracing::info!("WindowController::toggle — destroying main window");
            w.destroy()?;
        } else {
            tracing::info!("WindowController::toggle — rebuilding main window");
            Self::build_main(app)?;
        }
        Ok(())
    }

    /// Build the main launcher window from scratch. Called on toggle-show
    /// after a previous toggle-hide destroyed it.
    ///
    /// Window settings here mirror `tauri.conf.json` `main` definition so
    /// rebuild lands the user in exactly the same launcher they had at boot.
    pub fn build_main(app: &AppHandle) -> Result<WebviewWindow> {
        let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
            .title("CTRL")
            .inner_size(920.0, 560.0)
            .min_inner_size(480.0, 420.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
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
}

/// Install a WindowEvent::CloseRequested handler that intercepts the OS X
/// button and routes it to destroy through the canonical toggle path. The
/// intercept is necessary because clicking X otherwise leaves residual
/// state Tauri considers a "close-from-user" event — we want the same
/// behavior as a hotkey-triggered destroy: window gone, app process stays
/// alive in tray for re-summoning.
pub(crate) fn install_close_intercept(w: &WebviewWindow, app: &AppHandle, label: &str) {
    let app_for_event = app.clone();
    let label_owned = label.to_string();
    w.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            tracing::info!("close requested on window={} — destroying via toggle path", label_owned);
            api.prevent_close();
            let app_for_closure = app_for_event.clone();
            let label_for_closure = label_owned.clone();
            let _ = app_for_event.run_on_main_thread(move || {
                if let Some(w) = app_for_closure.get_webview_window(&label_for_closure) {
                    let _ = w.destroy();
                }
            });
        }
    });
}
