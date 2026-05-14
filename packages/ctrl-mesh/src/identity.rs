// Identity — per-device curve25519 keypair + advertised device metadata.
//
// Sprint 2 implements:
//   - IdentityKeypair::generate() (uses vodozemac::olm::IdentityKeys internally)
//   - persistence via shell::KeychainStore
//   - DeviceIdentity serialization for QR pairing payload (60-byte target)

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Public, opaque, stable identifier for a device in a user's mesh.
///
/// Derived deterministically from the public identity key on first use; never
/// regenerated. Format = `dev-{uuid}` so it's safe to log without leaking the
/// underlying key bytes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DeviceId(pub String);

impl DeviceId {
    /// Generate a fresh device id. Real implementation derives from the
    /// public identity key fingerprint; this skeleton uses a random UUID.
    pub fn fresh() -> Self {
        Self(format!("dev-{}", Uuid::new_v4()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Public, advertise-able view of a device. Carried in `mesh.devices` document
/// + signaling beacon hello frames.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub id: DeviceId,
    /// Human-readable, user-set name. "soodo's MacBook", "iPhone 15 Pro", etc.
    pub display_name: String,
    /// Coarse capability tier — lets PWA decide whether to send heavy payloads.
    pub kind: DeviceKind,
    /// Last-seen identity public key fingerprint (hex). Sprint 2 fills this.
    pub identity_pub_fingerprint: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceKind {
    /// Win11 / macOS desktop running Tauri 2 shell + Rust kernel.
    Desktop,
    /// iOS / Android browser PWA, no native kernel.
    Mobile,
    /// AI glasses / e-paper / ring etc — ST-SS publisher, no PWA UI.
    HardwarePeer,
}

#[derive(Debug, Error)]
pub enum IdentityError {
    #[error("keypair generation failed: {0}")]
    KeypairGenFailed(String),
    #[error("keychain read/write failed: {0}")]
    KeychainFailed(String),
    #[error("invalid identity envelope: {0}")]
    InvalidEnvelope(String),
}
