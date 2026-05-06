// macOS adapter implementing SelectionCapturePort via simulated Cmd+C + NSPasteboard read.
// Spike-only PoC. Production should switch to AXUIElement / AXSelectedTextAttribute.

use std::time::Duration;

use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use crate::application::ports::SelectionCapturePort;
use crate::error::{Result, SpikeError};

const KVK_C: CGKeyCode = 0x08;
const COPY_SETTLE_MS: u64 = 80;
const RESTORE_DELAY_MS: u64 = 600;

pub struct PasteboardCapture;

impl PasteboardCapture {
    pub fn new() -> Self {
        Self
    }
}

impl Default for PasteboardCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl SelectionCapturePort for PasteboardCapture {
    fn get_selected_text(&self) -> Result<String> {
        let original = read_pasteboard().ok();

        simulate_cmd_c()?;
        std::thread::sleep(Duration::from_millis(COPY_SETTLE_MS));

        let captured = read_pasteboard()?;

        if let Some(orig) = original {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(RESTORE_DELAY_MS));
                if let Err(err) = write_pasteboard(&orig) {
                    tracing::warn!(?err, "pasteboard restore failed");
                }
            });
        }

        if captured.is_empty() {
            return Err(SpikeError::CaptureFailed("empty selection".into()));
        }
        Ok(captured)
    }
}

fn simulate_cmd_c() -> Result<()> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| SpikeError::CaptureFailed("CGEventSource::new failed".into()))?;

    let down = CGEvent::new_keyboard_event(source.clone(), KVK_C, true)
        .map_err(|_| SpikeError::CaptureFailed("create key-down failed".into()))?;
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    down.post(CGEventTapLocation::HID);

    let up = CGEvent::new_keyboard_event(source, KVK_C, false)
        .map_err(|_| SpikeError::CaptureFailed("create key-up failed".into()))?;
    up.set_flags(CGEventFlags::CGEventFlagCommand);
    up.post(CGEventTapLocation::HID);

    Ok(())
}

fn read_pasteboard() -> Result<String> {
    let mut clip =
        arboard::Clipboard::new().map_err(|e| SpikeError::ClipboardFailed(e.to_string()))?;
    clip.get_text()
        .map_err(|e| SpikeError::ClipboardFailed(e.to_string()))
}

fn write_pasteboard(text: &str) -> Result<()> {
    let mut clip =
        arboard::Clipboard::new().map_err(|e| SpikeError::ClipboardFailed(e.to_string()))?;
    clip.set_text(text.to_owned())
        .map_err(|e| SpikeError::ClipboardFailed(e.to_string()))
}
