// Window controller.
//
// Owns the main frameless / always-on-top / Mica window per ADR-002 §6.
//
// Behaviors:
//   • Show / hide via hotkey or tray click
//   • Focus-loss hide (only when no modal child window is up — guard from W3.6
//     `MainWindow_Activated` modal-aware hide)
//   • Mica (Win 11) / vibrancy (macOS) backdrop — Tauri 2 handles the
//     transparent+decorations:false combo natively
//
// Toggle correctness note: `WebviewWindow::is_visible()` on Win11 + Mica +
// transparent + alwaysOnTop returns `Ok(true)` even when the window is
// minimized/hidden in some Tauri 2 builds. We additionally check
// `is_minimized()` so the user-perceived state drives the toggle, not the
// WS_VISIBLE bit alone. The legacy WinUI 3 surface had the same trap; W3.6
// `MainWindow_Activated` worked around it via its `_isHidden` field. Here we
// double-check the OS state instead of caching.

use anyhow::Result;
use tauri::{AppHandle, Manager, WebviewWindow};

pub struct WindowController;

impl WindowController {
    pub fn main(app: &AppHandle) -> Option<WebviewWindow> {
        app.get_webview_window("main")
    }

    /// Returns true if the window is on-screen and not minimized.
    fn is_user_visible(w: &WebviewWindow) -> bool {
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        visible && !minimized
    }

    /// Toggle the main window. Called by hotkey + tray click.
    ///
    /// Trace logs every transition with the OS state at decision time so the
    /// next time someone reports "Ctrl doesn't hide", the log shows whether
    /// the hotkey fired at all and which branch ran.
    pub fn toggle(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            tracing::warn!("WindowController::toggle — main window not found");
            return Ok(());
        };
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        let user_visible = visible && !minimized;
        tracing::info!(
            "WindowController::toggle — visible={visible} minimized={minimized} focused={focused} -> {}",
            if user_visible { "HIDE" } else { "SHOW" }
        );
        if user_visible {
            w.hide()?;
        } else {
            if minimized {
                w.unminimize()?;
            }
            w.show()?;
            w.set_focus()?;
        }
        Ok(())
    }

    /// Hide the main window unless a modal child has been opened.
    /// Ports the W3.6 modal-aware focus-loss guard.
    pub fn hide_unless_modal(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            return Ok(());
        };
        if !Self::is_user_visible(&w) {
            return Ok(());
        }
        // sub-PR f: enumerate child webviews + skip hide if any are
        // visible+focused. For now, hide unconditionally.
        w.hide()?;
        Ok(())
    }
}
