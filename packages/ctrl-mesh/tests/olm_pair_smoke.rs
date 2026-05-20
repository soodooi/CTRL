//! 1:1 Olm pair smoke — v1.0 deliverable for H-2026-05-14-001 lane-D.
//!
//! Proves the vodozemac Olm 1:1 crypto core round-trips end-to-end against
//! the minimal `session.rs` façade. Scope per
//! `.olym/specs/mesh-comm/spec.md` §5:
//!
//! - Two `OlmAccount`s (Device A "desktop", Device B "mobile") spawned in-process.
//! - A advertises a one-time prekey; B builds an outbound session and sends
//!   the first PreKey message ("hello from mobile").
//! - A builds an inbound session from B's first message; A decrypts; A replies.
//! - Verifies ratchet works in both directions and session ids match.
//!
//! Out of scope (deferred to v1.1 Sprint 2+): pickle round-trip, replay-attack
//! defense at the wrapper layer, DH-validity check, WebRTC transport, Automerge.

#![cfg(feature = "crypto")]

use ctrl_mesh::session::{Message, OlmAccount};

const HELLO_FROM_MOBILE: &[u8] = b"hello from mobile device B";
const ACK_FROM_DESKTOP: &[u8] = b"ack from desktop device A";
const FOLLOWUP_FROM_MOBILE: &[u8] = b"second frame from B, double-ratchet step";

#[test]
fn olm_1_1_round_trip_smoke() {
    // --- Device A (desktop) advertises identity + one-time prekey ---
    let mut account_a = OlmAccount::fresh();
    let identity_a = account_a.identity_public_key();
    let one_time_a = account_a.generate_one_time_keys(1);

    // --- Device B (mobile) builds outbound session against A's bundle ---
    let account_b = OlmAccount::fresh();
    let identity_b = account_b.identity_public_key();
    let mut session_b = account_b
        .establish_outbound(identity_a, one_time_a)
        .expect("B must establish outbound session against A's prekey bundle");

    // --- B sends first message (PreKey variant per Olm spec) ---
    let first_msg = session_b
        .encrypt(HELLO_FROM_MOBILE)
        .expect("B encrypts first message");
    assert!(
        matches!(first_msg, Message::PreKey(_)),
        "B's first encrypted frame must be an Olm PreKey message",
    );

    // --- A receives and builds inbound session from the first message ---
    let (mut session_a, decrypted_first) = account_a
        .establish_inbound(identity_b, &first_msg)
        .expect("A must establish inbound session from B's PreKey message");

    assert_eq!(decrypted_first, HELLO_FROM_MOBILE);
    assert_eq!(
        session_a.session_id(),
        session_b.session_id(),
        "both sides must derive the same session id",
    );
    assert_eq!(session_a.peer_identity(), identity_b);
    assert_eq!(session_b.peer_identity(), identity_a);

    // --- A burns the one-time key so it cannot be reused (X3DH invariant) ---
    account_a.mark_keys_as_published();

    // --- A replies; B decrypts the response ---
    let reply_msg = session_a.encrypt(ACK_FROM_DESKTOP).expect("A encrypts reply");
    let decrypted_reply = session_b
        .decrypt(&reply_msg)
        .expect("B must decrypt A's reply");
    assert_eq!(decrypted_reply, ACK_FROM_DESKTOP);

    // --- B sends a follow-up — exercises another ratchet step ---
    let followup_msg = session_b
        .encrypt(FOLLOWUP_FROM_MOBILE)
        .expect("B encrypts follow-up");
    let decrypted_followup = session_a
        .decrypt(&followup_msg)
        .expect("A must decrypt B's follow-up");
    assert_eq!(decrypted_followup, FOLLOWUP_FROM_MOBILE);
}

#[test]
fn outbound_session_emits_normal_message_after_first() {
    // After the initial PreKey exchange, subsequent messages must be the
    // shorter Normal variant — guards against accidentally re-emitting a
    // PreKey envelope on every send (which would leak the prekey and bloat
    // every datachannel frame by ~250 bytes).
    let mut account_a = OlmAccount::fresh();
    let identity_a = account_a.identity_public_key();
    let one_time_a = account_a.generate_one_time_keys(1);

    let account_b = OlmAccount::fresh();
    let identity_b = account_b.identity_public_key();
    let mut session_b = account_b
        .establish_outbound(identity_a, one_time_a)
        .expect("B outbound");

    let first = session_b.encrypt(b"first").expect("B encrypts first");
    assert!(matches!(first, Message::PreKey(_)));

    // A bootstraps inbound session so the channel is two-way.
    let (mut session_a, _) = account_a
        .establish_inbound(identity_b, &first)
        .expect("inbound");
    // A replies so B's ratchet advances.
    let reply = session_a.encrypt(b"ack").expect("A encrypts ack");
    session_b.decrypt(&reply).expect("B decrypts reply");

    // Subsequent B→A message is Normal, not PreKey.
    let second_b = session_b.encrypt(b"second").expect("B encrypts second");
    assert!(
        matches!(second_b, Message::Normal(_)),
        "post-handshake messages must use the Normal Olm variant",
    );
}

#[test]
fn distinct_accounts_have_distinct_identity_keys() {
    // Sanity check: two freshly-generated accounts must not collide on the
    // identity key. Reuses the same OS-RNG that vodozemac uses internally.
    let a = OlmAccount::fresh();
    let b = OlmAccount::fresh();
    assert_ne!(a.identity_public_key(), b.identity_public_key());
}
