// Channel — encrypted transport between two peers.
//
// Three concrete impls (selected per peer pair, in priority order):
//   1. WebRTC datachannel — webrtc-rs v0.17.x, primary path
//   2. Relay-forwarded    — ctrl-relay CF Worker, TURN-style fallback
//   3. mDNS direct TCP    — same-LAN accelerator (v1.1)
//
// Sprint 3 implements WebRTC + relay. Sprint 4.9 implements mDNS.

use async_trait::async_trait;
use thiserror::Error;

use crate::wire::MeshFrame;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelKind {
    WebRtc,
    Relay,
    MdnsLan,
}

#[async_trait]
pub trait MeshChannel: Send + Sync {
    /// Which underlying transport this channel uses.
    fn kind(&self) -> ChannelKind;

    /// Currently reachable (sub-second round trip expected) — informs the
    /// router whether to attempt a send or queue.
    fn is_open(&self) -> bool;

    /// Best-effort round-trip latency estimate in ms. Used by router to pick
    /// fastest transport when multiple are open (e.g. P2P vs relay).
    fn rtt_ms_estimate(&self) -> Option<u32>;

    /// Send an encrypted frame. Returns once the bytes have been written to
    /// the underlying socket — does NOT guarantee remote receipt.
    async fn send(&self, frame: &MeshFrame) -> Result<(), ChannelError>;

    /// Receive next frame. Returns None when channel closes cleanly; Err
    /// when channel terminates abnormally.
    async fn recv(&mut self) -> Result<Option<MeshFrame>, ChannelError>;

    /// Close the channel. Idempotent.
    async fn close(&mut self) -> Result<(), ChannelError>;
}

#[derive(Debug, Error)]
pub enum ChannelError {
    #[error("channel closed")]
    Closed,
    #[error("send timeout")]
    Timeout,
    #[error("ICE failed (no path P2P or relay)")]
    NoPath,
    #[error("transport error: {0}")]
    Transport(String),
    #[error("frame decode failed: {0}")]
    Decode(String),
}
