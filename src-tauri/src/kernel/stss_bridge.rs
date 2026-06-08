// kernel::stss_bridge — promoted from share/stss-spike/.
//
// WS server exposing the kernel's event bus over CBOR-framed ST-SS Cell/Op.
// Promoted in sub-PR d after the spike validated:
//   • CBOR round-trip Rust ↔ JS without schema drift
//   • Sub-100ms LAN round-trip latency
//   • Capability-shape check at every received Op
//
// The bridge owns:
//   • TcpListener on 127.0.0.1:17872
//   • broadcast::Sender<Event> for fan-out to connected viewers
//   • Per-connection task that fans out events + accepts inbound Ops
//
// What the bridge does NOT own (kept in kernel proper):
//   • Real CapabilityBroker (this module accepts a callback that the kernel
//     wires to its broker)
//   • Effect dispatch (Op -> Effect translation belongs in scheduler)
//   • Persistence (event store records via a separate sink)

use anyhow::Result;
use futures::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use subtle::ConstantTimeEq;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_hdr_async, WebSocketStream};
use tracing::{info, warn};
use uuid::Uuid;

use crate::kernel::event::{Cell, Event, Op, OpKind};

/// WS listen address. Mirrors ADR-003 frontend §3 "kernel daemon @ localhost:17872".
pub const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:17872";

/// In-memory broadcast capacity. Slow viewers see a `Lagged` warning above
/// this many backlog events; the publisher never blocks.
pub const BROADCAST_BUFFER: usize = 64;

/// Maximum accepted inbound WS frame size (CBOR Op). Frames above this are
/// dropped before deserialization to bound per-connection memory. Ops carry
/// clipboard text / prompts / ids — 4 MiB is generous for legitimate traffic.
pub const MAX_INBOUND_FRAME_BYTES: usize = 4 * 1024 * 1024;

/// Outcome of authorizing an inbound Op. Returning Err short-circuits dispatch.
pub type CapabilityCheck = Arc<dyn Fn(&Op) -> Result<(), String> + Send + Sync>;

/// Restrictive default authorization for inbound Ops from anonymous WS
/// clients (the PWA). A full per-session `CapabilityBroker` model for WS
/// clients does not exist yet, so until it lands we DENY by default and
/// permit ONLY the Op kinds the PWA legitimately originates over the bridge.
///
/// The allowlist is derived from `event.rs`, where the inbound (PWA → kernel)
/// Op kinds are explicitly documented:
///   - SubprocessStdin / SubprocessResize / SubprocessSignal  (subprocess v1)
///   - AgentPrompt / AgentInterrupt / EnvSignal / FileRequest (v0.7 coding-env)
///   - HotkeyTriggered                                        (UI hotkey relay)
///
/// Everything else — MCP lifecycle, LLM call events, actor lifecycle, mesh
/// sync events, and the outbound Subprocess{Stdout,Exit,Spawned} echoes — is
/// kernel/actor-originated and MUST NOT be accepted from a WS client, as that
/// would let an authenticated-but-untrusted client forge privileged events.
fn is_pwa_originated(kind: OpKind) -> bool {
    matches!(
        kind,
        OpKind::SubprocessStdin
            | OpKind::SubprocessResize
            | OpKind::SubprocessSignal
            | OpKind::AgentPrompt
            | OpKind::AgentInterrupt
            | OpKind::EnvSignal
            | OpKind::FileRequest
            | OpKind::HotkeyTriggered
    )
}

/// Build the default capability check: a restrictive allowlist (deny-by-default)
/// over inbound Op kinds. Keeps the `CapabilityCheck` shape so call sites are
/// unchanged. Replaces the former allow-all stub (OWASP A01 blocker).
fn default_cap_check() -> CapabilityCheck {
    Arc::new(|op: &Op| {
        if is_pwa_originated(op.kind) {
            Ok(())
        } else {
            Err(format!(
                "op kind {:?} is not permitted from a WS client (deny-by-default allowlist)",
                op.kind
            ))
        }
    })
}

/// Public handle the rest of the kernel uses to push events out + receive
/// Ops from the world. Clone freely; broadcast::Sender supports many writers.
#[derive(Clone)]
pub struct StssBridge {
    events: broadcast::Sender<Event>,
    /// Per-process auth token. Required as `?token=<value>` on the WS upgrade
    /// URL. Generated fresh on every kernel boot, never persisted. PWA inside
    /// Tauri WebView fetches it via the `get_bridge_token` invoke command;
    /// mobile/tunnel clients must be paired (separate handoff).
    auth_token: Arc<String>,
}

impl StssBridge {
    /// Create the bridge handle (does not bind yet — call `serve()` to start
    /// accepting connections). Generates a fresh auth token per process.
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel::<Event>(BROADCAST_BUFFER);
        Self {
            events: tx,
            auth_token: Arc::new(Uuid::new_v4().to_string()),
        }
    }

    /// Return the auth token. PWA receives it through a Tauri command before
    /// opening its WebSocket; mobile pairing flow does the same out-of-band.
    pub fn auth_token(&self) -> &str {
        &self.auth_token
    }

    /// Subscribe to all bus events. The receiver gets each Cell/Op the
    /// kernel publishes, mirroring what WS clients receive on the wire.
    /// Used by in-process consumers (e.g. tests, adapter tasks, future
    /// effect executor) that want to observe without going through WS.
    pub fn subscribe_events(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }

    /// Publish a Cell. Used by event_bus to forward kernel events to viewers.
    pub fn publish_cell(&self, cell: Cell) {
        let _ = self.events.send(Event::Cell(cell));
    }

    /// Publish an Op (acks / state-machine events). Used by scheduler to
    /// surface mcp_invoked / mcp_completed back to the PWA.
    pub fn publish_op(&self, op: Op) {
        let _ = self.events.send(Event::Op(op));
    }

    /// Bind the listener and serve in the background. Returns once bound;
    /// the accept loop runs as a tokio task.
    pub async fn serve<F>(self, addr: &str, on_op: F) -> Result<()>
    where
        F: Fn(Op) + Send + Sync + 'static,
    {
        let on_op_arc: Arc<dyn Fn(Op) + Send + Sync> = Arc::new(on_op);
        // Default capability check: restrictive deny-by-default allowlist over
        // inbound Op kinds (see `default_cap_check`). Replaces the former
        // allow-all stub. The kernel can swap in a real per-session
        // CapabilityBroker later; the shape stays so the call site is stable.
        let cap_check = default_cap_check();

        let listener = TcpListener::bind(addr).await?;
        info!("kernel::stss_bridge listening on {addr}");

        let bridge = self.clone();
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, peer)) => {
                        let bridge_for_conn = bridge.clone();
                        let on_op = on_op_arc.clone();
                        let cap = cap_check.clone();
                        let expected_token = bridge.auth_token.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(
                                bridge_for_conn,
                                stream,
                                peer,
                                on_op,
                                cap,
                                expected_token,
                            )
                            .await
                            {
                                warn!("[{peer}] connection ended: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        warn!("listener accept error: {e}");
                        break;
                    }
                }
            }
        });
        Ok(())
    }
}

impl Default for StssBridge {
    fn default() -> Self {
        Self::new()
    }
}

async fn handle_connection(
    bridge: StssBridge,
    stream: TcpStream,
    peer: SocketAddr,
    on_op: Arc<dyn Fn(Op) + Send + Sync>,
    cap: CapabilityCheck,
    expected_token: Arc<String>,
) -> Result<()> {
    // Validate `?token=<expected>` on the WS upgrade. tokio-tungstenite gives
    // the full Request URI in the callback; we extract the query string and
    // match the token byte-for-byte. Wrong / missing token => 401.
    let ws = accept_hdr_async(
        stream,
        move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
            let path_and_query = req.uri().path_and_query().map(|p| p.as_str()).unwrap_or("");
            let provided = extract_query_param(path_and_query, "token").unwrap_or_default();
            if tokens_match(provided, expected_token.as_str()) {
                Ok(resp)
            } else {
                let mut err = ErrorResponse::new(Some("missing or invalid token".into()));
                *err.status_mut() = StatusCode::UNAUTHORIZED;
                Err(err)
            }
        },
    )
    .await?;
    info!("[{peer}] WS handshake OK (authenticated)");

    let mut events_rx = bridge.events.subscribe();
    let (mut sink, mut source) = ws.split();

    loop {
        tokio::select! {
            forward = events_rx.recv() => match forward {
                Ok(event) => {
                    if send_event(&mut sink, event).await.is_err() {
                        info!("[{peer}] disconnected during send");
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("[{peer}] lagged {n} events (back-pressure)");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            incoming = source.next() => match incoming {
                Some(Ok(Message::Binary(bytes))) => {
                    handle_inbound(&bytes, peer, &on_op, &cap);
                }
                Some(Ok(Message::Text(_))) => {
                    warn!("[{peer}] text frame ignored (CBOR binary only)");
                }
                Some(Ok(Message::Ping(p))) => {
                    let _ = sink.send(Message::Pong(p)).await;
                }
                Some(Ok(Message::Close(_))) | None => {
                    info!("[{peer}] closed");
                    break;
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    warn!("[{peer}] ws error: {e}");
                    break;
                }
            },
        }
    }
    Ok(())
}

fn handle_inbound(
    bytes: &[u8],
    peer: SocketAddr,
    on_op: &Arc<dyn Fn(Op) + Send + Sync>,
    cap: &CapabilityCheck,
) {
    // Bound the frame before deserialization. An authenticated client (or a
    // compromised in-app WebView) could otherwise send an arbitrarily large
    // Binary frame and force the full payload into memory before decode.
    if bytes.len() > MAX_INBOUND_FRAME_BYTES {
        warn!(
            "[{peer}] inbound frame {} bytes exceeds {MAX_INBOUND_FRAME_BYTES} cap; dropped",
            bytes.len()
        );
        return;
    }
    let event: Event = match ciborium::from_reader(bytes) {
        Ok(e) => e,
        Err(e) => {
            warn!("[{peer}] CBOR decode failed: {e}");
            return;
        }
    };
    let op = match event {
        Event::Op(op) => op,
        Event::Cell(_) => {
            warn!("[{peer}] client sent Cell (only Op accepted)");
            return;
        }
    };
    if let Err(e) = cap(&op) {
        warn!("[{peer}] op denied: {e}");
        return;
    }
    // Payload may carry clipboard text / partial LLM prompt / session
    // identifiers; only `kind` is safe to log at info level. Full payload
    // is debug-only to avoid leaking through tracing log shippers (pre-merge
    // review M1).
    info!("[{peer}] op kind={:?}", op.kind);
    tracing::debug!("[{peer}] op payload={}", op.payload);
    on_op(op);
}

async fn send_event(
    sink: &mut futures::stream::SplitSink<WebSocketStream<TcpStream>, Message>,
    event: Event,
) -> Result<()> {
    let mut buf = Vec::with_capacity(128);
    ciborium::into_writer(&event, &mut buf)?;
    sink.send(Message::Binary(buf)).await?;
    Ok(())
}

/// Constant-time auth-token comparison. Avoids the timing oracle of `==` /
/// `str::eq`, which short-circuits at the first differing byte and leaks how
/// much of a guessed prefix is correct.
///
/// `subtle::ct_eq` is only constant-time over equal-length inputs; comparing
/// differing lengths still varies in time. The auth token is a fixed-length
/// UUID generated per process, so its length is not secret — we reject a
/// length mismatch up front (no secret bytes inspected), then run the
/// constant-time byte compare on the equal-length case.
fn tokens_match(provided: &str, expected: &str) -> bool {
    if provided.len() != expected.len() {
        return false;
    }
    provided.as_bytes().ct_eq(expected.as_bytes()).into()
}

/// Minimal URL query string parser — pulls the first `key=value` pair whose
/// key matches `name`. Avoids pulling in the `url` crate for a single use.
fn extract_query_param<'a>(path_and_query: &'a str, name: &str) -> Option<&'a str> {
    let query = path_and_query.split_once('?').map(|p| p.1)?;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == name {
                return Some(v);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_query_param_basic() {
        assert_eq!(extract_query_param("/socket?token=abc", "token"), Some("abc"));
        assert_eq!(extract_query_param("/socket?x=1&token=abc&y=2", "token"), Some("abc"));
        assert_eq!(extract_query_param("/socket?token=", "token"), Some(""));
        assert_eq!(extract_query_param("/socket", "token"), None);
        assert_eq!(extract_query_param("/socket?other=1", "token"), None);
    }

    #[test]
    fn tokens_match_constant_time_semantics() {
        assert!(tokens_match("abc123", "abc123"));
        assert!(!tokens_match("abc123", "abc124"));
        // length mismatch (prefix of the real token) must not authorize
        assert!(!tokens_match("abc", "abc123"));
        assert!(!tokens_match("", "abc123"));
        assert!(tokens_match("", ""));
    }

    fn op(kind: OpKind) -> Op {
        Op {
            kind,
            ts_ms: 0,
            stream_id: None,
            payload: serde_json::Value::Null,
        }
    }

    #[test]
    fn default_cap_check_allows_pwa_originated_kinds() {
        let cap = default_cap_check();
        for kind in [
            OpKind::SubprocessStdin,
            OpKind::SubprocessResize,
            OpKind::SubprocessSignal,
            OpKind::AgentPrompt,
            OpKind::AgentInterrupt,
            OpKind::EnvSignal,
            OpKind::FileRequest,
            OpKind::HotkeyTriggered,
        ] {
            assert!(cap(&op(kind)).is_ok(), "expected {kind:?} to be allowed");
        }
    }

    #[test]
    fn default_cap_check_denies_privileged_kinds() {
        let cap = default_cap_check();
        // Kernel/actor-originated kinds a WS client must never be able to forge.
        for kind in [
            OpKind::McpInvoked,
            OpKind::McpCompleted,
            OpKind::LlmCallStarted,
            OpKind::ActorSpawned,
            OpKind::ActorTerminated,
            OpKind::MeshDeviceJoined,
            OpKind::SubprocessStdout,
            OpKind::SubprocessExit,
            OpKind::SubprocessSpawned,
        ] {
            assert!(cap(&op(kind)).is_err(), "expected {kind:?} to be denied");
        }
    }
}
