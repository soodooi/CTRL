// Document — Automerge document replicated across the mesh.
//
// v1.0 ships 3 documents (per ADR-002 substrate §6.1):
//   - mesh.devices       — paired device roster
//   - mesh.mcps       — installed mcp pool (manifests + last-used)
//   - mesh.preferences   — user settings (LWW)
//
// v1.1 adds:
//   - mesh.history       — cross-device AI memory (Olm 1:1 per-peer only, no Megolm)
//   - mesh.clipboard     — cross-device clipboard (user-toggled)
//
// Sprint 4 wires Automerge v0.7.x in/out for each document.

use serde::{Deserialize, Serialize};

/// Canonical document identifier. Same string across all peers; conflict-free
/// because Automerge change op vectors carry author + clock.
///
/// Construct via `From<&str>` or `From<String>` — there is no `const fn`
/// constructor because `String` cannot be built in a const context. Callers
/// either use the `&str` constants in `V1_DOCUMENTS` directly or `DocumentId::from(s)`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DocumentId(pub String);

impl From<&str> for DocumentId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl From<String> for DocumentId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl std::fmt::Display for DocumentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// V1.0 document inventory. Sprint 4 binds each to an Automerge schema.
pub const V1_DOCUMENTS: &[&str] = &[
    "mesh.devices",
    "mesh.mcps",
    "mesh.preferences",
];

/// V1.1 additions (NOT shipped in v1.0 — listed for documentation parity).
pub const V1_1_DOCUMENTS: &[&str] = &[
    "mesh.history",
    "mesh.clipboard",
];

/// Document handle abstraction. Sprint 4 implements this on top of
/// `automerge::AutoCommit`.
pub trait MeshDocument: Send + Sync {
    /// Stable document id (matches V1_DOCUMENTS entry).
    fn id(&self) -> &DocumentId;

    /// Returns the raw Automerge `actor_id` (author identity) bound to this
    /// device's writes — same value across the process lifetime.
    fn actor_id(&self) -> &str;

    /// Generate Automerge change bytes for any local edits since the last
    /// `take_pending_changes` call. Sprint 4 wraps `automerge::AutoCommit::save`.
    fn take_pending_changes(&mut self) -> Vec<u8>;

    /// Apply Automerge change bytes received from a remote peer. Sprint 4
    /// wraps `automerge::AutoCommit::load_incremental`.
    fn apply_remote_changes(&mut self, bytes: &[u8]) -> Result<(), DocumentError>;
}

#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    #[error("automerge load failed: {0}")]
    LoadFailed(String),
    #[error("unknown document id: {0}")]
    UnknownDocument(String),
    #[error("schema validation failed: {0}")]
    SchemaViolation(String),
}
