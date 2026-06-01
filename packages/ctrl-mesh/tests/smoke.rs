//! Smoke tests for ctrl-mesh skeleton.
//! Sprint 2+ adds real test coverage for Identity / Peer / Document / Channel /
//! SignalingBeacon. This file ensures the public API compiles + the constants
//! agree with ADR-002 substrate.

use ctrl_mesh::{
    DeviceId, DeviceIdentity, DocumentId, FrameKind, MeshChange, MeshFrame, MESH_FRAME_MAGIC,
    MESH_PROTOCOL_VERSION, V1_DOCUMENTS,
};
use ctrl_mesh::identity::DeviceKind;
use ctrl_mesh::peer::{Peer, PeerState};
use ctrl_mesh::wire::VectorClock;

#[test]
fn device_id_fresh_has_dev_prefix() {
    let id = DeviceId::fresh();
    assert!(id.as_str().starts_with("dev-"), "got {}", id);
}

#[test]
fn v1_documents_match_adr_003() {
    // ADR-002 substrate §6.1: v1.0 ships 3 documents.
    assert_eq!(V1_DOCUMENTS, &["mesh.devices", "mesh.keycaps", "mesh.preferences"]);
}

#[test]
fn document_id_round_trip() {
    let id_a: DocumentId = "mesh.devices".into();
    let id_b: DocumentId = String::from("mesh.devices").into();
    assert_eq!(id_a, id_b);
    assert_eq!(format!("{}", id_a), "mesh.devices");
}

#[test]
fn mesh_frame_magic_is_cmsh() {
    // "CMSH" = CTRL Mesh, current protocol version is 1.
    assert_eq!(&MESH_FRAME_MAGIC, b"CMSH");
    assert_eq!(MESH_PROTOCOL_VERSION, 1);
}

#[test]
fn peer_starts_unpaired_and_unreachable() {
    let id = DeviceId::fresh();
    let identity = DeviceIdentity {
        id: id.clone(),
        display_name: "test peer".into(),
        kind: DeviceKind::Desktop,
        identity_pub_fingerprint: "pending".into(),
    };
    let peer = Peer::new(identity);
    assert_eq!(peer.state, PeerState::Unpaired);
    assert!(!peer.is_reachable());
    assert_eq!(peer.id(), &id);
}

#[test]
fn frame_serializes_to_cbor() {
    let from = DeviceId::fresh();
    let to = DeviceId::fresh();
    let frame = MeshFrame {
        magic: MESH_FRAME_MAGIC,
        version: MESH_PROTOCOL_VERSION,
        kind: FrameKind::Control,
        from,
        to,
        session_step: 0,
        ciphertext: vec![],
    };
    let mut buf = Vec::new();
    ciborium::into_writer(&frame, &mut buf).expect("cbor encode");
    let decoded: MeshFrame = ciborium::from_reader(&buf[..]).expect("cbor decode");
    assert_eq!(decoded.magic, frame.magic);
    assert_eq!(decoded.session_step, frame.session_step);
    assert_eq!(decoded.kind, FrameKind::Control);
}

#[test]
fn mesh_change_serializes() {
    let change = MeshChange {
        document_id: "mesh.devices".into(),
        causal_clock: VectorClock::empty(),
        author_device: DeviceId::fresh(),
        author_ts_ms: 1_700_000_000_000,
        change_bytes: vec![0x01, 0x02, 0x03],
    };
    let mut buf = Vec::new();
    ciborium::into_writer(&change, &mut buf).expect("cbor encode change");
    let decoded: MeshChange = ciborium::from_reader(&buf[..]).expect("cbor decode change");
    assert_eq!(decoded.change_bytes, vec![0x01, 0x02, 0x03]);
    assert_eq!(decoded.document_id, "mesh.devices");
}
