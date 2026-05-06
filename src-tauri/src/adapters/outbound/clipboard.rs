// arboard-backed implementation of ClipboardPort. Cross-platform.

use crate::application::ports::ClipboardPort;
use crate::error::{Result, SpikeError};

pub struct ArboardClipboard;

impl ArboardClipboard {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ArboardClipboard {
    fn default() -> Self {
        Self::new()
    }
}

impl ClipboardPort for ArboardClipboard {
    fn read(&self) -> Result<String> {
        let mut clip = arboard::Clipboard::new()
            .map_err(|e| SpikeError::ClipboardFailed(e.to_string()))?;
        clip.get_text()
            .map_err(|e| SpikeError::ClipboardFailed(e.to_string()))
    }

    fn write(&self, value: &str) -> Result<()> {
        let mut clip = arboard::Clipboard::new()
            .map_err(|e| SpikeError::ClipboardFailed(e.to_string()))?;
        clip.set_text(value.to_owned())
            .map_err(|e| SpikeError::ClipboardFailed(e.to_string()))
    }
}
