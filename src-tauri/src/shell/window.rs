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
// Full focus-loss + modal guard land in sub-PR b commit 2.

use anyhow::Result;
use tauri::{AppHandle, Manager, WebviewWindow};

pub struct WindowController;

impl WindowController {
    pub fn main(app: &AppHandle) -> Option<WebviewWindow> {
        app.get_webview_window("main")
    }

    /// Toggle the main window. Called by hotkey + tray click.
    pub fn toggle(app: &AppHandle) -> Result<()> {
        let Some(w) = Self::main(app) else {
            return Ok(());
        };
        let visible = w.is_visible().unwrap_or(false);
        if visible {
            w.hide()?;
        } else {
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
        // sub-PR b commit 2: enumerate child webviews + skip hide if any are
        // visible+focused. For now, hide unconditionally.
        w.hide()?;
        Ok(())
    }
}
