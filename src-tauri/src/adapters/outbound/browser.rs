// macOS implementation of BrowserPort via the `open` command.

use std::process::Command;

use crate::application::ports::BrowserPort;
use crate::error::{Result, SpikeError};

pub struct MacBrowser;

impl MacBrowser {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacBrowser {
    fn default() -> Self {
        Self::new()
    }
}

impl BrowserPort for MacBrowser {
    fn open(&self, url: &str) -> Result<()> {
        Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| SpikeError::CaptureFailed(format!("open {}: {}", url, e)))
    }
}
