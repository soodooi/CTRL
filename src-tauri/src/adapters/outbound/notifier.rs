// Tauri-backed NotifierPort — emits a "notify" event the webview listens for.

use tauri::{AppHandle, Emitter};

use crate::application::ports::NotifierPort;
use crate::error::{Result, SpikeError};

pub struct TauriNotifier {
    handle: AppHandle,
}

impl TauriNotifier {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }
}

impl NotifierPort for TauriNotifier {
    fn notify(&self, message: &str) -> Result<()> {
        self.handle
            .emit("notify", message)
            .map_err(|e| SpikeError::EventTapFailed(e.to_string()))
    }
}
