// ADR-002 substrate § provider v2 §3.2 — CTRL-side bridge for the
// verbatim VMark REST functions.
//
// VMark's `rest_providers.rs` (ISC) drives output through a `&dyn AiSink`
// trait so the same provider code can serve both windowed UI emission and
// headless channel collection (see the VMark sink.rs commentary). CTRL
// has neither a Tauri `WebviewWindow` event surface nor an unbounded
// channel — chat streams flow through `tokio::sync::mpsc::Sender<
// Result<ChatChunk, ProviderError>>`. To keep the VMark function bodies
// truly verbatim, this module re-declares the trait + ships a single
// `CtrlChannelSink` that adapts it to the kernel's `mpsc::Sender`.
//
// This file is NOT a verbatim port (the original VMark `sink.rs` is
// Tauri-WebviewWindow-bound). It is the minimum CTRL-side glue so the
// ported `run_rest_*` functions compile and forward output through
// `Provider::chat_stream`'s receiver.

use tokio::sync::mpsc;

use crate::kernel::provider::types::{ChatChunk, ProviderError};

/// Mirrors VMark's `AiSink` contract verbatim (chunk / done / error).
/// Each provider call emits zero or more `chunk` calls then exactly one
/// terminal call (`done` on success, `error` on failure). After the
/// terminal call the sink may be dropped.
pub(super) trait AiSink: Send + Sync {
    /// Emit a partial output chunk.
    fn chunk(&self, text: &str);
    /// Signal successful completion (called exactly once).
    fn done(&self);
    /// Signal failure (called exactly once, in place of `done`).
    fn error(&self, msg: &str);
}

/// Forwards AiSink calls into the kernel's `Provider::chat_stream`
/// receiver. Holds a `blocking_send`-capable `Sender` so the verbatim
/// VMark functions (which call `sink.chunk` / `sink.done` / `sink.error`
/// from non-async positions inside their `async fn` body) don't have to
/// await — the channel is sized so a healthy consumer drains faster than
/// the REST function emits.
pub(super) struct CtrlChannelSink {
    sender: mpsc::Sender<Result<ChatChunk, ProviderError>>,
}

impl CtrlChannelSink {
    pub(super) fn new(
        sender: mpsc::Sender<Result<ChatChunk, ProviderError>>,
    ) -> Self {
        Self { sender }
    }
}

impl AiSink for CtrlChannelSink {
    fn chunk(&self, text: &str) {
        let chunk = ChatChunk {
            delta: text.to_string(),
            finish_reason: None,
        };
        let _ = self.sender.blocking_send(Ok(chunk));
    }

    fn done(&self) {
        let chunk = ChatChunk {
            delta: String::new(),
            finish_reason: Some("stop".to_string()),
        };
        let _ = self.sender.blocking_send(Ok(chunk));
    }

    fn error(&self, msg: &str) {
        let _ = self
            .sender
            .blocking_send(Err(ProviderError::ProviderError(msg.to_string())));
    }
}
