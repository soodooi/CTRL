// Tauri adapter implementing EventBusPort — emits to the webview and reveals the main window.

use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Position};

use crate::application::ports::EventBusPort;
use crate::domain::events::HotkeyEvent;
use crate::error::{Result, SpikeError};

pub struct TauriEventBus {
    handle: AppHandle,
}

impl TauriEventBus {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }
}

#[cfg(target_os = "macos")]
fn current_mouse_position() -> Option<(f64, f64)> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok()?;
    let event = CGEvent::new(source).ok()?;
    let loc = event.location();
    Some((loc.x, loc.y))
}

#[cfg(not(target_os = "macos"))]
fn current_mouse_position() -> Option<(f64, f64)> {
    None
}

impl EventBusPort for TauriEventBus {
    fn emit_hotkey(&self, event: &HotkeyEvent) -> Result<()> {
        tracing::info!(?event, "TauriEventBus::emit_hotkey");
        self.handle
            .emit("hotkey", event)
            .map_err(|e| SpikeError::EventTapFailed(e.to_string()))
    }

    fn show_main_window(&self) {
        // Three independent windows:
        //   keyboard ("main") = 480×420, the anchor (always shown).
        //   pool                = 240×420, sits 12pt left of keyboard.
        //   workspace           = 360×420, sits 12pt right of keyboard.
        // We position all three relative to the active monitor's centre
        // (lifted 1/8 monitor-height above dead centre — "Spotlight
        // altitude"), then show keyboard. Pool/workspace remain hidden
        // until React invokes set_panel_visible based on user state.
        const KEYBOARD_WIDTH: f64 = 480.0;
        const POOL_WIDTH: f64 = 240.0;
        const WORKSPACE_WIDTH: f64 = 360.0;
        const PANEL_HEIGHT: f64 = 420.0;
        const GAP: f64 = 12.0;

        let Some(keyboard) = self.handle.get_webview_window("main") else {
            tracing::warn!("show_main_window — NO 'main' window found");
            return;
        };

        let scale = keyboard.scale_factor().unwrap_or(1.0);
        let monitor = current_mouse_position()
            .and_then(|_| keyboard.current_monitor().ok().flatten())
            .or_else(|| keyboard.primary_monitor().ok().flatten());
        let Some(monitor) = monitor else {
            tracing::warn!("show_main_window — no monitor available");
            let _ = keyboard.show();
            let _ = keyboard.set_focus();
            return;
        };

        let m_pos = monitor.position();
        let m_size = monitor.size();
        let m_x = m_pos.x as f64 / scale;
        let m_y = m_pos.y as f64 / scale;
        let m_w = m_size.width as f64 / scale;
        let m_h = m_size.height as f64 / scale;

        // Keyboard centred horizontally, lifted 1/8 monitor-height up.
        let kbd_x = m_x + (m_w - KEYBOARD_WIDTH) / 2.0;
        let kbd_y = m_y + (m_h - PANEL_HEIGHT) / 2.0 - m_h / 8.0;

        if let Err(err) = keyboard
            .set_position(Position::Logical(LogicalPosition::new(kbd_x, kbd_y)))
        {
            tracing::warn!(?err, "keyboard set_position failed");
        }

        if let Some(pool) = self.handle.get_webview_window("pool") {
            let pool_x = kbd_x - GAP - POOL_WIDTH;
            let _ = pool
                .set_position(Position::Logical(LogicalPosition::new(pool_x, kbd_y)));
        }
        if let Some(workspace) = self.handle.get_webview_window("workspace") {
            let ws_x = kbd_x + KEYBOARD_WIDTH + GAP;
            let _ = workspace
                .set_position(Position::Logical(LogicalPosition::new(ws_x, kbd_y)));
        }

        tracing::info!("show_main_window — showing keyboard");
        if let Err(err) = keyboard.show() {
            tracing::warn!(?err, "keyboard.show() failed");
        }
        if let Err(err) = keyboard.set_focus() {
            tracing::warn!(?err, "keyboard.set_focus() failed");
        }
        // Pool/workspace are shown by React via set_panel_visible based on
        // user-toggled state — we don't unilaterally show them here.
    }
}
