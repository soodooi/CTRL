// kernel::stss_bridge — the local kernel->PWA event WS.
//
// ST-SS as a protocol abstraction is deprecated (ADR-010 communication
// § transports v5, SC6): this is a PLAIN WebSocket that ships CBOR-framed
// `Event` (Cell/Op) payloads to in-app viewers — Cell/Op are just the payload
// shape the PWA decodes (cbor-x), not a semantic-stream protocol. It stays
// because it is load-bearing (useCellStream / useSubprocessChannel / code_space
// terminal output); only the protocol framing + its inbound command surface
// (publish / list_streams / get_bridge_token) retired. The promoting spike
// validated:
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
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_hdr_async, WebSocketStream};
use tracing::{info, warn};
use uuid::Uuid;

use crate::kernel::event::{Cell, Event, Op};

/// WS listen address. Mirrors ADR-003 frontend §3 "kernel daemon @ localhost:17872".
pub const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:17872";

/// In-memory broadcast capacity. Slow viewers see a `Lagged` warning above
/// this many backlog events; the publisher never blocks.
pub const BROADCAST_BUFFER: usize = 64;

/// Outcome of authorizing an inbound Op. Returning Err short-circuits dispatch.
pub type CapabilityCheck = Arc<dyn Fn(&Op) -> Result<(), String> + Send + Sync>;

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
        // Default capability check: allow everything (the kernel wires real
        // CapabilityBroker as it lands). The shape stays so the call site
        // doesn't change.
        let allow_all: CapabilityCheck = Arc::new(|_op: &Op| Ok(()));

        let listener = TcpListener::bind(addr).await?;
        info!("kernel::stss_bridge listening on {addr}");

        let bridge = self.clone();
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, peer)) => {
                        let bridge_for_conn = bridge.clone();
                        let on_op = on_op_arc.clone();
                        let cap = allow_all.clone();
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
            if provided == expected_token.as_str() {
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
}
