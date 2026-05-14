// SignalingBeacon — persistent client connection to ctrl-relay.
//
// Each device opens one beacon at boot. Beacon traffic:
//   - presence advertisements (device id + capability tier, ~100 B/min)
//   - pair-offer / pair-accept messages (one-time per new device, ~3 KB)
//   - ICE candidate exchange (one-time per peer pair, ~2-5 KB)
//
// ctrl-relay sees: source / destination device public keys + encrypted
// payload only. Zero knowledge of Cell/Op content.
//
// Sprint 2 implements the client. Sprint 4.8 builds the ctrl-relay worker
// it talks to (CF Worker, separate ctrl-cloud repo).

use async_trait::async_trait;
use thiserror::Error;

use crate::identity::DeviceId;
use crate::wire::MeshFrame;

/// Underlying transport for the beacon. WSS in production; mock impl for
/// tests + Sprint 2 round-trips without a real relay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalingTransport {
    /// `wss://relay.ctrl.run/signal?identity=...&proof=...`
    ProductionWss,
    /// `ws://localhost:N` for tests + Sprint 2 local mock (Node http server
    /// or miniflare; NEVER `wrangler dev` per CLAUDE.md global rule).
    LocalMock,
}

#[async_trait]
pub trait SignalingBeacon: Send + Sync {
    fn transport(&self) -> SignalingTransport;

    /// Open the persistent connection. Returns once the relay has
    /// authenticated us (challenge-response with identity key).
    async fn connect(&mut self) -> Result<(), BeaconError>;

    /// Send a frame addressed to a specific remote device. The relay routes
    /// based on `frame.to`; payload stays encrypted (relay doesn't decrypt).
    async fn send(&self, frame: &MeshFrame) -> Result<(), BeaconError>;

    /// Receive next frame addressed to us. Returns None on clean close.
    async fn recv(&mut self) -> Result<Option<MeshFrame>, BeaconError>;

    /// Notify the relay we're going offline (graceful disconnect — other
    /// peers see our presence drop within ~1s).
    async fn disconnect(&mut self) -> Result<(), BeaconError>;

    /// Identity advertised on this beacon.
    fn local_id(&self) -> &DeviceId;
}

#[derive(Debug, Error)]
pub enum BeaconError {
    #[error("relay unreachable: {0}")]
    Unreachable(String),
    #[error("auth challenge failed")]
    AuthFailed,
    #[error("identity key not yet provisioned")]
    NoIdentity,
    #[error("transport error: {0}")]
    Transport(String),
    #[error("frame decode failed: {0}")]
    Decode(String),
}
