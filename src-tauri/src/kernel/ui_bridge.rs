//! UI bridge — the kernel-side state + push channel for UI-session-coupled
//! note capabilities (ADR-002 §1.9 v46 E2 active note + E3 open-in-UI; the
//! LRA `/active/` + `/open/` parity, CTRL-native).
//!
//! Two halves, both deliberately tiny:
//! - **Active note** (E2): the PWA REPORTS which note is focused via the
//!   `set_active_note` Tauri command (PWA-only surface — the brain cannot
//!   forge it, same C3 boundary as `review_resolve`); the brain READS it via
//!   the `note_active_get` gate tool ("summarize what I'm looking at").
//! - **Open note** (E3): the brain calls the `note_open` gate tool; the
//!   supervisor forwards the broadcast to the PWA as a Tauri event
//!   (`notes:open`) — same forwarder pattern as the review gate.

use std::sync::RwLock;
use tokio::sync::broadcast;

/// A request to open a note in the PWA workspace (E3).
#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenNoteRequest {
    /// Vault-relative path.
    pub path: String,
    /// Optional heading anchor to scroll to.
    pub heading: Option<String>,
}

pub struct UiBridge {
    /// The note currently focused in the PWA (None = none / PWA closed).
    active_note: RwLock<Option<String>>,
    /// Open-note requests fanned out to the supervisor → PWA.
    open_tx: broadcast::Sender<OpenNoteRequest>,
}

impl UiBridge {
    pub fn new() -> Self {
        let (open_tx, _rx) = broadcast::channel(16);
        UiBridge { active_note: RwLock::new(None), open_tx }
    }

    /// PWA-side report (Tauri command): which note is focused now.
    pub fn set_active_note(&self, path: Option<String>) {
        if let Ok(mut slot) = self.active_note.write() {
            *slot = path;
        }
    }

    /// Gate-side read (E2).
    pub fn active_note(&self) -> Option<String> {
        self.active_note.read().ok().and_then(|s| s.clone())
    }

    /// Gate-side push (E3). Returns false when no PWA is listening.
    pub fn request_open(&self, req: OpenNoteRequest) -> bool {
        self.open_tx.send(req).is_ok()
    }

    /// Supervisor-side subscription (forwards to the PWA as a Tauri event).
    pub fn subscribe_open(&self) -> broadcast::Receiver<OpenNoteRequest> {
        self.open_tx.subscribe()
    }
}

impl Default for UiBridge {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_note_set_get_roundtrip() {
        let b = UiBridge::new();
        assert_eq!(b.active_note(), None);
        b.set_active_note(Some("notes/today.md".into()));
        assert_eq!(b.active_note(), Some("notes/today.md".into()));
        b.set_active_note(None);
        assert_eq!(b.active_note(), None);
    }

    #[tokio::test]
    async fn open_request_reaches_subscriber() {
        let b = UiBridge::new();
        // No subscriber yet → send reports false (PWA not listening).
        assert!(!b.request_open(OpenNoteRequest { path: "a.md".into(), heading: None }));
        let mut rx = b.subscribe_open();
        assert!(b.request_open(OpenNoteRequest {
            path: "notes/x.md".into(),
            heading: Some("Overview".into()),
        }));
        let got = rx.recv().await.unwrap();
        assert_eq!(got.path, "notes/x.md");
        assert_eq!(got.heading.as_deref(), Some("Overview"));
    }
}
