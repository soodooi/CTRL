// System tray controller.
//
// Per ADR-002 §6, tray uses Tauri 2's built-in tray icon API (no separate
// plugin in 2.x). Menu items: Show / Hide / About / Quit.
//
// Tauri 2 click semantics (TrayIconEvent variants):
//   - Click { button: MouseButton::Left,  button_state: Down/Up } — toggle window
//   - Click { button: MouseButton::Right, ... }                   — menu (when show_menu_on_left_click(false))
// To make the menu reliably appear on a Win11 install (where the right-click
// default sometimes shows the OS context menu instead of our app menu in some
// Tauri 2 builds), we set `show_menu_on_left_click(true)` AND wire the right
// button as an explicit fallback. Left click then both toggles AND opens menu;
// users get the menu wherever they click.

use anyhow::Result;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use super::WindowController;

pub struct TrayController;

impl TrayController {
    /// Build and install the system tray icon. Returns immediately; tray events
    /// fire on the Tauri runtime thread.
    pub fn install(app: &AppHandle) -> Result<()> {
        let show = MenuItem::with_id(app, "show", "Show CTRL", true, None::<&str>)?;
        let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
        let about = MenuItem::with_id(app, "about", "About CTRL", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &hide, &separator, &about, &separator, &quit])?;

        // Embed the 32x32 icon bytes at compile time so the tray has a real
        // visual identity even before bundle-time icon resolution. The png is
        // the Tauri default placeholder for now; sub-PR f swaps in a CTRL-
        // branded raster derived from doc/visual-identity/logo-mark.svg.
        let icon_bytes: &[u8] = include_bytes!("../../icons/32x32.png");
        let icon = Image::from_bytes(icon_bytes)?;

        TrayIconBuilder::new()
            .tooltip("CTRL")
            .icon(icon)
            .menu(&menu)
            // Left click also opens the menu — Win11 users expect either button
            // to surface controls; relying on right-click only loses users.
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_skip_taskbar(false);
                        let _ = w.set_focus();
                    }
                }
                "hide" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_skip_taskbar(true);
                        let _ = w.hide();
                    }
                }
                "about" => {
                    tracing::info!("tray: about clicked (handler TBD sub-PR f)");
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                // Toggle on left-up. Right-click is handled by show_menu_on_left_click(true)
                // automatically by Tauri 2 — we don't need to wire it here.
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Err(err) = WindowController::toggle(app) {
                        tracing::error!(?err, "tray click toggle failed");
                    }
                }
            })
            .build(app)?;

        tracing::info!("tray icon installed");
        Ok(())
    }
}
