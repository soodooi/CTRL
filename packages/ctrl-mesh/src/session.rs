// Session — Olm 1:1 session wrapper around vodozemac.
//
// Spike scope (H-2026-05-14-001 lane-D): minimal façade just sufficient to
// drive `tests/olm_pair_smoke.rs`. The full surface (PickleKey, pickle round-
// trip, DH-validity check, replay error variant) is described in
// `.olym/specs/mesh-comm/spec.md` §4 and lands in Sprint 2.
//
// Only compiled when the `crypto` feature is enabled — keeps the default
// build of ctrl-mesh free of the vodozemac dependency tree.

use thiserror::Error;
use vodozemac::olm::{Account, OlmMessage, PreKeyMessage, Session, SessionConfig};
use vodozemac::Curve25519PublicKey;

/// Errors surfaced by the spike-level session wrapper.
///
/// Sprint 2 expands this to include `ReplayDetected`, `PickleKeyMismatch`,
/// `ExpiredPairOffer`, and the wrapper-level `InvalidPrekey` (DH-validity
/// check) per spec §4.3. Note: as of vodozemac 0.10 the `NonContributoryKey`
/// rejection (Soatok disclosure fix) is enforced inside vodozemac itself
/// and surfaces here as `Vodozemac(...)` — the §4.4 wrapper check becomes
/// belt-and-braces rather than the sole defense.
#[derive(Debug, Error)]
pub enum SessionError {
    #[error("vodozemac error: {0}")]
    Vodozemac(String),
    #[error("first message must be a prekey message, got Normal")]
    NotPreKeyMessage,
}

/// Thin façade over a vodozemac Olm account. v1.0 spike only — Sprint 2
/// replaces with the locked surface in spec §4.2.
pub struct OlmAccount {
    inner: Account,
}

impl OlmAccount {
    pub fn fresh() -> Self {
        Self { inner: Account::new() }
    }

    pub fn identity_public_key(&self) -> Curve25519PublicKey {
        self.inner.curve25519_key()
    }

    /// Generate `count` one-time prekeys. Returns the first generated key for
    /// convenience (smoke tests rely on knowing it without iterating).
    pub fn generate_one_time_keys(&mut self, count: usize) -> Curve25519PublicKey {
        self.inner.generate_one_time_keys(count);
        *self
            .inner
            .one_time_keys()
            .values()
            .next()
            .expect("generate_one_time_keys produced at least one key")
    }

    /// Mark all currently-generated one-time keys as published. After this
    /// they cannot be reused; reusing a one-time key would break X3DH.
    pub fn mark_keys_as_published(&mut self) {
        self.inner.mark_keys_as_published();
    }

    /// Initiator side. Build an outbound session against the peer's prekey
    /// bundle (identity key + a one-time key).
    ///
    /// Fails with `SessionError::Vodozemac` if the peer's keys form a non-
    /// contributory DH (Soatok disclosure mitigation — vodozemac 0.10+ rejects
    /// these natively).
    pub fn establish_outbound(
        &self,
        peer_identity: Curve25519PublicKey,
        peer_one_time: Curve25519PublicKey,
    ) -> Result<OlmSession, SessionError> {
        let inner = self
            .inner
            .create_outbound_session(SessionConfig::default(), peer_identity, peer_one_time)
            .map_err(|e| SessionError::Vodozemac(e.to_string()))?;
        Ok(OlmSession { inner, peer_identity_pub: peer_identity })
    }

    /// Responder side. Build an inbound session from the initiator's first
    /// (PreKey) message and return the decrypted plaintext alongside.
    pub fn establish_inbound(
        &mut self,
        initiator_identity: Curve25519PublicKey,
        first_message: &OlmMessage,
    ) -> Result<(OlmSession, Vec<u8>), SessionError> {
        let pre_key = match first_message {
            OlmMessage::PreKey(m) => m.clone(),
            OlmMessage::Normal(_) => return Err(SessionError::NotPreKeyMessage),
        };
        let result = self
            .inner
            .create_inbound_session(SessionConfig::default(), initiator_identity, &pre_key)
            .map_err(|e| SessionError::Vodozemac(e.to_string()))?;
        let session = OlmSession {
            inner: result.session,
            peer_identity_pub: initiator_identity,
        };
        Ok((session, result.plaintext))
    }
}

/// Thin façade over a vodozemac Olm session. Spike-level — Sprint 2 wraps
/// pickle / unpickle and adds the replay-detection error path per spec §4.1.
pub struct OlmSession {
    inner: Session,
    peer_identity_pub: Curve25519PublicKey,
}

impl OlmSession {
    pub fn peer_identity(&self) -> Curve25519PublicKey {
        self.peer_identity_pub
    }

    pub fn session_id(&self) -> String {
        self.inner.session_id()
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<OlmMessage, SessionError> {
        self.inner
            .encrypt(plaintext)
            .map_err(|e| SessionError::Vodozemac(e.to_string()))
    }

    pub fn decrypt(&mut self, message: &OlmMessage) -> Result<Vec<u8>, SessionError> {
        self.inner
            .decrypt(message)
            .map_err(|e| SessionError::Vodozemac(e.to_string()))
    }
}

/// Re-export of the relevant vodozemac types so tests + Sprint 2 callers can
/// match on `OlmMessage::PreKey` etc. without depending on vodozemac directly.
pub use vodozemac::olm::{OlmMessage as Message, PreKeyMessage as PreKey};
// Silence the unused-import warning on `PreKeyMessage` — kept in scope for
// clarity at the top of the file and re-exported above with a friendlier name.
#[allow(dead_code)]
fn _prekey_message_kept_in_scope(_: PreKeyMessage) {}
