// Use cases — orchestration only. They depend on port traits, never on concrete adapters.

use std::sync::{Arc, Mutex};

use crate::application::ports::{
    AccessibilityPort, ClockPort, EventBusPort, KeyboardListenerPort, RawKeyEvent,
    SelectionCapturePort, ToolRegistryPort,
};
use crate::domain::detector::{
    DetectionState, SingleCtrlDetector, SINGLE_CTRL_MAX_DURATION_MS,
};
use crate::domain::events::{HotkeyEvent, HotkeyKind, PermissionState};
use crate::domain::tool::Tool;
use crate::error::Result;

pub fn start_hotkey_pipeline(
    keyboard: Arc<dyn KeyboardListenerPort>,
    clock: Arc<dyn ClockPort>,
    event_bus: Arc<dyn EventBusPort>,
) -> Result<()> {
    let detector = Arc::new(Mutex::new(SingleCtrlDetector::new(SINGLE_CTRL_MAX_DURATION_MS)));

    keyboard.start(Box::new(move |raw| {
        let now = clock.now_ms();
        let state = {
            // Recover from a poisoned mutex instead of panicking on a stray
            // panic inside an earlier callback. The detector is a pure state
            // machine over u64 timestamps — there is no partially-mutated
            // invariant that observing the inner state could violate.
            let mut d = match detector.lock() {
                Ok(guard) => guard,
                Err(poisoned) => {
                    tracing::warn!("detector mutex poisoned — recovering inner state");
                    poisoned.into_inner()
                }
            };
            match raw {
                RawKeyEvent::CtrlDown => d.on_ctrl_down(now),
                RawKeyEvent::CtrlUp => d.on_ctrl_up(now),
                RawKeyEvent::OtherKeyDown => d.on_other_key_down(now),
            }
        };

        if matches!(state, DetectionState::Triggered) {
            tracing::info!("single-ctrl triggered — opening panel");
            // No auto-capture. Just emit "open-panel" so the UI can render the tool list,
            // and surface the window. Each tool fetches its own input per its manifest.
            let event = HotkeyEvent {
                kind: HotkeyKind::OpenPanel,
                captured_text: None,
                cursor_x: 0,
                cursor_y: 0,
                latency_ms: 0,
                ts_ms: now,
            };
            if let Err(err) = event_bus.emit_hotkey(&event) {
                tracing::warn!(?err, "emit_hotkey failed");
            }
            event_bus.show_main_window();
        }
    }))
}

pub fn capture_selection(capture: &dyn SelectionCapturePort) -> Result<String> {
    capture.get_selected_text()
}

pub fn ensure_accessibility(ax: &dyn AccessibilityPort) -> PermissionState {
    if ax.is_trusted() {
        PermissionState::Granted
    } else {
        ax.request_with_prompt();
        PermissionState::PendingRestart
    }
}

pub fn list_tools(registry: &dyn ToolRegistryPort) -> Result<Vec<Tool>> {
    registry.list_all()
}

pub fn run_action(
    registry: &dyn ToolRegistryPort,
    ports: &crate::application::step_runner::StepPorts,
    tool_id: &str,
    action_id: &str,
) -> Result<String> {
    let tools = registry.list_all()?;
    let tool = tools
        .iter()
        .find(|t| t.id == tool_id)
        .ok_or_else(|| crate::error::SpikeError::ManifestError(format!("tool not found: {}", tool_id)))?;
    let action = tool
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| {
            crate::error::SpikeError::ManifestError(format!(
                "action not found: {}/{}",
                tool_id, action_id
            ))
        })?;
    tracing::info!(tool = %tool_id, action = %action_id, "running action");
    crate::application::step_runner::run_steps(&action.steps, ports)
}
