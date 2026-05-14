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

/// Force-hide the window on Win11 via direct Win32 ShowWindow.
///
/// Tauri 2.x `WebviewWindow::hide()` on Win11 + decorated + alwaysOnTop:false
/// returns Ok but the OS window remains visible in some 2.x stable builds
/// (verified by bao 2026-05-14 smoke test, persists after set_skip_taskbar
/// belt-and-braces). Going around the abstraction with a raw `ShowWindow(hwnd,
/// SW_HIDE)` is the reliable hammer. show() rebuilds visibility via Tauri's
/// path which works.
#[cfg(target_os = "windows")]
fn force_hide_win(w: &WebviewWindow) -> Result<()> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    let raw = w.hwnd()?;
    let hwnd: HWND = raw.0 as _;
    // SAFETY: hwnd is owned by the live WebviewWindow we just borrowed; ShowWindow
    // is documented safe to call on any valid HWND from any thread; SW_HIDE is a
    // well-defined constant. Return value is the previous visibility state — we
    // do not need it.
    unsafe { ShowWindow(hwnd, SW_HIDE) };
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn force_hide_win(_w: &WebviewWindow) -> Result<()> {
    Ok(())
}

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
            // Tauri 2 + Win11 hide() returns Ok but the OS window stays
            // visible on some 2.x stable builds. Real fix is to call
            // Win32 ShowWindow(SW_HIDE) directly via windows-sys; we
            // also flag skip_taskbar so the window vanishes from
            // taskbar/alt-tab in the same frame. Tauri's hide() is left
            // in as a no-op-if-it-works belt; the winapi call is the
            // load-bearing one.
            let _ = w.set_skip_taskbar(true);
            let _ = w.hide();
            force_hide_win(&w)?;
        } else {
            if minimized {
                w.unminimize()?;
            }
            w.show()?;
            let _ = w.set_skip_taskbar(false);
            w.set_focus()?;
        }
        Ok(())
    }

    /// Open (or focus) the workspace window with a specific keycap loaded.
    ///
    /// The workspace window is a SECOND, ephemeral window (label `workspace`),
    /// separate from the launcher pool (`main`). Each keycap activation opens
    /// the same workspace window with a new keycap_id query param, so the
    /// window is reused but its content reflects the latest selection. This
    /// matches bao 2026-05-14 directive: "工作区不应该在主窗口, 应该是独立窗口".
    pub fn open_workspace(app: &AppHandle, keycap_id: &str) -> Result<()> {
        let Some(w) = app.get_webview_window("workspace") else {
            tracing::warn!("WindowController::open_workspace — workspace window not found");
            return Ok(());
        };
        // Navigate to /workspace?keycap_id=... so the PWA workspace route picks
        // it up. The WebView already has the SPA loaded; URL change re-routes
        // without a full reload.
        // Tauri 2 exposes navigation via the underlying WebView; the simplest
        // portable trick is to evaluate the History API. sub-PR f wires a
        // proper command bridge.
        let nav_script = format!(
            "window.location.hash = '#/workspace?keycap_id={}'; window.dispatchEvent(new Event('hashchange'));",
            keycap_id.replace('\'', "")
        );
        let _ = w.eval(&nav_script);

        let _ = w.set_skip_taskbar(false);
        w.show()?;
        w.set_focus()?;
        tracing::info!("workspace window opened for keycap_id={}", keycap_id);
        Ok(())
    }

    /// Hide the workspace window. Called when the keycap actor signals done
    /// or the user presses Esc / closes the window.
    pub fn close_workspace(app: &AppHandle) -> Result<()> {
        let Some(w) = app.get_webview_window("workspace") else {
            return Ok(());
        };
        let _ = w.set_skip_taskbar(true);
        let _ = w.hide();
        force_hide_win(&w)?;
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
        let _ = w.set_skip_taskbar(true);
        let _ = w.hide();
        force_hide_win(&w)?;
        Ok(())
    }
}
