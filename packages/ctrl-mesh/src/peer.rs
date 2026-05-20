// Peer — remote DeviceIdentity + transport state + vodozemac Olm session handle.
//
// One Peer per remote device in the mesh. State machine matches the standard
// Olm 1:1 flow: Unpaired -> Pairing -> Paired -> (Online | Offline).
//
// Sprint 2 implements the session establishment + ratchet rotation.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::identity::{DeviceId, DeviceIdentity};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerState {
    /// Discovered but no key exchange yet (e.g. seen in signaling beacon).
    Unpaired,
    /// X3DH handshake in progress.
    Pairing,
    /// Olm session established but currently unreachable (mobile background,
    /// other desktop sleeping, etc).
    PairedOffline,
    /// Olm session established and an active transport channel exists.
    PairedOnline,
    /// User revoked from any device — peer dies, all future frames denied.
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub identity: DeviceIdentity,
    pub state: PeerState,
    /// Last time we successfully sent OR received a frame, in epoch ms.
    pub last_active_ms: u64,
}

impl Peer {
    pub fn new(identity: DeviceIdentity) -> Self {
        Self {
            identity,
            state: PeerState::Unpaired,
            last_active_ms: 0,
        }
    }

    pub fn id(&self) -> &DeviceId {
        &self.identity.id
    }

    pub fn is_reachable(&self) -> bool {
        matches!(self.state, PeerState::PairedOnline)
    }
}

#[derive(Debug, Error)]
pub enum PeerError {
    #[error("peer not paired (state: {0:?})")]
    NotPaired(PeerState),
    #[error("peer revoked")]
    Revoked,
    #[error("vodozemac session error: {0}")]
    SessionError(String),
}
