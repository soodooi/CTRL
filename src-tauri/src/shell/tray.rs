// System tray controller.
//
// The macOS Accessory shell has no Dock or regular application menu, so this
// status item is the durable recovery surface. Every reveal action routes
// through WindowController rather than direct window calls, keeping normal and
// full-screen Spaces on one presentation path. (ADR-003 frontend §1.1 v24)
//
// macOS menu items: Open CTRL / Open Config / Reload PWA / Quit. About is
// omitted until it has a real product surface; a dead item is not a recovery
// path. Other platforms preserve their existing tray menu and focus behavior.

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
        let reload_pwa =
            MenuItem::with_id(app, "reload-pwa", "Reload PWA  ⌘R", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

        #[cfg(target_os = "macos")]
        let menu = {
            let open_ctrl =
                MenuItem::with_id(app, "open-ctrl", "Open CTRL", true, None::<&str>)?;
            Menu::with_items(
                app,
                &[
                    &open_ctrl,
                    &open_config,
                    &separator,
                    &reload_pwa,
                    &separator,
                    &quit,
                ],
            )?
        };

        #[cfg(not(target_os = "macos"))]
        let menu = {
            let about = MenuItem::with_id(app, "about", "About CTRL", true, None::<&str>)?;
            Menu::with_items(
                app,
                &[
                    &open_config,
                    &separator,
                    &reload_pwa,
                    &separator,
                    &about,
                    &separator,
                    &quit,
                ],
            )?
        };

        // Embed the 32x32 icon bytes at compile time so the tray has a real
        // visual identity even before bundle-time icon resolution.
        let icon_bytes: &[u8] = include_bytes!("../../icons/32x32.png");
        let icon = Image::from_bytes(icon_bytes)?;

        // Explicitly retain the TrayIcon in app state for the full process
        // lifetime instead of relying on backend-specific implicit ownership
        // for the Accessory shell's only recovery surface.
        // (ADR-003 frontend §1.1 v24)
        let tray = TrayIconBuilder::new()
            .tooltip("CTRL")
            .icon(icon)
            .menu(&menu)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "open-ctrl" => {
                    if let Err(err) = WindowController::reveal(app) {
                        tracing::error!(?err, "tray: Open CTRL failed");
                    }
                }
                "open-config" => {
                    #[cfg(target_os = "macos")]
                    if let Err(err) = WindowController::reveal(app) {
                        tracing::error!(?err, "tray: Open Config reveal failed");
                    }
                    #[cfg(not(target_os = "macos"))]
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_skip_taskbar(false);
                        let _ = w.set_focus();
                    }
                    if let Err(err) = app.emit(EVENT_OPEN_CONFIG, ()) {
                        tracing::error!(?err, "failed to emit tray:open-config");
                    }
                }
                "reload-pwa" => {
                    #[cfg(target_os = "macos")]
                    if let Err(err) = WindowController::reveal(app) {
                        tracing::error!(?err, "tray: Reload PWA reveal failed");
                    }
                    #[cfg(not(target_os = "macos"))]
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    if let Some(w) = app.get_webview_window("main") {
                        if let Err(err) = w.eval("window.location.reload()") {
                            tracing::warn!(?err, "tray: reload PWA eval failed");
                        } else {
                            tracing::info!("tray: PWA reloaded");
                        }
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

        if !app.manage(tray) {
            anyhow::bail!("tray icon state was already installed");
        }
        tracing::info!("tray icon installed and retained for process lifetime");
        Ok(())
    }
}
