// System tray controller.
//
// Per ADR-002 §6, tray uses Tauri 2's built-in tray icon API (no separate
// plugin in 2.x). Menu items: Show / Hide / About / Quit. Click on the icon
// toggles the main window — matches W3's TrayInterop behavior.

use anyhow::Result;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

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

        TrayIconBuilder::new()
            .tooltip("CTRL")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "hide" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
                "about" => {
                    tracing::info!("tray: about clicked (handler TBD)");
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { .. } = event {
                    let app = tray.app_handle();
                    if let Some(w) = app.get_webview_window("main") {
                        let visible = w.is_visible().unwrap_or(false);
                        let _ = if visible { w.hide() } else { w.show() };
                        if !visible {
                            let _ = w.set_focus();
                        }
                    }
                }
            })
            .build(app)?;

        tracing::info!("tray icon installed");
        Ok(())
    }
}
