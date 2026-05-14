// ctrl-mesh — CTRL multi-device mesh communication primitives.
//
// Parent: ADR-003 (Accepted 2026-05-14) + H-2026-05-14-001 Sprint 1 evidence.
// Status: SKELETON. Real implementations land Sprint 2+ (athena).
//
// 5 mesh primitives mirroring kernel's 5 primitives:
//   - Identity  : per-device curve25519 keypair + advertised metadata
//   - Peer      : remote Identity + transport state + libsignal session
//   - Document  : Automerge document replicated across mesh (mesh.devices, etc)
//   - Channel   : encrypted transport between two Peers (WebRTC / relay / mDNS)
//   - SignalingBeacon : ctrl-relay endpoint each device polls for presence

pub mod channel;
pub mod document;
pub mod identity;
pub mod peer;
pub mod signaling;
pub mod wire;

pub use channel::{ChannelError, ChannelKind, MeshChannel};
pub use document::{DocumentId, MeshDocument, V1_DOCUMENTS};
pub use identity::{DeviceId, DeviceIdentity, IdentityError};
pub use peer::{Peer, PeerError, PeerState};
pub use signaling::{BeaconError, SignalingBeacon, SignalingTransport};
pub use wire::{FrameKind, MeshChange, MeshFrame, VectorClock};

/// Mesh wire format magic ("CMSH" = CTRL Mesh).
pub const MESH_FRAME_MAGIC: [u8; 4] = *b"CMSH";

/// Protocol version. Bumped when wire format breaks compat.
pub const MESH_PROTOCOL_VERSION: u8 = 1;
