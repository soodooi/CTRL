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
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, WebSocketStream};
use tracing::{info, warn};

use crate::kernel::event::{Cell, Event, Op};

/// WS listen address. Mirrors ADR-002 §3 "kernel daemon @ localhost:17872".
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
}

impl StssBridge {
    /// Create the bridge handle (does not bind yet — call `serve()` to start
    /// accepting connections).
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel::<Event>(BROADCAST_BUFFER);
        Self { events: tx }
    }

    /// Publish a Cell. Used by event_bus to forward kernel events to viewers.
    pub fn publish_cell(&self, cell: Cell) {
        let _ = self.events.send(Event::Cell(cell));
    }

    /// Publish an Op (acks / state-machine events). Used by scheduler to
    /// surface keycap_invoked / keycap_completed back to the PWA.
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
                        tokio::spawn(async move {
                            if let Err(e) =
                                handle_connection(bridge_for_conn, stream, peer, on_op, cap).await
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
) -> Result<()> {
    let ws = accept_async(stream).await?;
    info!("[{peer}] WS handshake OK");

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
    info!("[{peer}] op {:?} payload={}", op.kind, op.payload);
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
