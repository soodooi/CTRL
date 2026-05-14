// Wire format — frames that travel between peers (over WebRTC / relay / mDNS).
//
// Per H-2026-05-14-001 Sprint 1 evidence:
//
//   MeshFrame {
//     magic, kind, from, to, session_step, ciphertext
//   }
//
// Ciphertext is vodozemac Olm 1:1 encrypted; only the two peers can decrypt.
// Inside ciphertext lives either:
//   - a `MeshChange` (Automerge change envelope for a `Document`), or
//   - a raw kernel `Op` (for ephemeral signaling, ack, etc).
//
// Kernel `Op` is the SAME enum as `ctrl_lib::kernel::event::Op`. Sprint 4
// promotes that enum into `ctrl-mesh` or exposes it via shared crate so
// both sides have one definition.

use serde::{Deserialize, Serialize};

use crate::identity::DeviceId;

/// Outer envelope every cross-device byte travels in. Serialized CBOR.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshFrame {
    /// b"CMSH" sanity / version. See `crate::MESH_FRAME_MAGIC`.
    pub magic: [u8; 4],
    /// Protocol version, current 1.
    pub version: u8,
    /// What's inside `ciphertext` once decrypted.
    pub kind: FrameKind,
    /// Sender device.
    pub from: DeviceId,
    /// Recipient device.
    pub to: DeviceId,
    /// Monotonic per-session counter. Replay defense + ordering.
    pub session_step: u32,
    /// Olm-encrypted payload. Sprint 2 wires vodozemac in/out.
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameKind {
    /// X3DH / Olm prekey bundle exchange. Sprint 2.
    Pairing,
    /// Olm Double-Ratchet message carrying a `MeshChange` or `Op`. Sprint 2-4.
    Data,
    /// Heartbeat / capability negotiation / ICE candidate. Sprint 3.
    Control,
}

/// Decrypted-side payload variant inside a `Data` frame. Sprint 4 wires the
/// real shape (MeshChange OR kernel Op); skeleton keeps the binding loose.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DataPayload {
    /// Automerge change to be applied to a Document.
    Change(MeshChange),
    /// Ephemeral kernel Op (not persisted in any document). Sprint 4 promotes
    /// `ctrl_lib::kernel::event::Op` here.
    Op {
        kind: String,
        payload: serde_json::Value,
    },
}

/// Automerge change envelope. Wraps the raw binary change with routing meta.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshChange {
    pub document_id: String,
    pub causal_clock: VectorClock,
    pub author_device: DeviceId,
    pub author_ts_ms: u64,
    /// Raw bytes returned by `automerge::AutoCommit::save_incremental`.
    pub change_bytes: Vec<u8>,
}

/// Per-document vector clock — tracks last-seen seq for each known device.
/// Sprint 4 uses this to detect missed changes after offline windows.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VectorClock {
    pub entries: Vec<(DeviceId, u64)>,
}

impl VectorClock {
    pub fn empty() -> Self {
        Self::default()
    }
}
