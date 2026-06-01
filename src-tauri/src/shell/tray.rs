// System tray controller.
//
// Per ADR-003 frontend §6, tray uses Tauri 2's built-in tray icon API (no separate
// plugin in 2.x). Menu items: Open Config / About / Quit.
//
// Show/Hide are NOT in the menu — left-click on the tray icon already
// toggles the window, and surfacing them as menu items is redundant
// noise for a 3-state product. The menu is reserved for actions that
// have no other path (open settings, see version info, exit).
//
// Tauri 2 click semantics (TrayIconEvent variants):
//   - Click { button: MouseButton::Left,  button_state: Down/Up } — toggle window
//   - Click { button: MouseButton::Right, ... }                   — menu
// `show_menu_on_left_click(true)` makes left-click ALSO open the menu so
// Win11 users (where right-click is sometimes hijacked by the OS) still
// get the menu.

use anyhow::Result;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use super::WindowController;

/// Event emitted to the webview when the user clicks the tray "Open Config"
/// item. The PWA root listens for this and routes to `/settings`.
const EVENT_OPEN_CONFIG: &str = "tray:open-config";

pub struct TrayController;

impl TrayController {
    /// Build and install the system tray icon. Returns immediately; tray events
    /// fire on the Tauri runtime thread.
    pub fn install(app: &AppHandle) -> Result<()> {
        let open_config =
            MenuItem::with_id(app, "open-config", "Open Config", true, None::<&str>)?;
        let about = MenuItem::with_id(app, "about", "About CTRL", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(
            app,
            &[&open_config, &separator, &about, &separator, &quit],
        )?;

        // Embed the 32x32 icon bytes at compile time so the tray has a real
        // visual identity even before bundle-time icon resolution.
        let icon_bytes: &[u8] = include_bytes!("../../icons/32x32.png");
        let icon = Image::from_bytes(icon_bytes)?;

        TrayIconBuilder::new()
            .tooltip("CTRL")
            .icon(icon)
            .menu(&menu)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "open-config" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_skip_taskbar(false);
                        let _ = w.set_focus();
                    }
                    if let Err(err) = app.emit(EVENT_OPEN_CONFIG, ()) {
                        tracing::error!(?err, "failed to emit tray:open-config");
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
