---
id: spec-mesh-comm
title: Multi-device mesh communication — implementation spec
status: Draft v0.1
parent_adr: ADR-003
related_handoffs:
  - H-2026-05-14-001
lane: hephaestus (lane-D)
created: 2026-05-19
updated: 2026-05-19
---

# Mesh Communication — Implementation Spec

> 本 spec 把 ADR-003 §3 / §6 / §7 展开成 sub-PR 级实施图纸，并给 v1.0 (design + spike) → v1.1 (full impl) 的切线。**所有锁点回指 ADR-003**；本 spec 只能在「实施细节」层面增删，不能改 ADR 决定。

---

## 0. v1.0 vs v1.1 切线

| Deliverable | v1.0 (this lane) | v1.1 (athena follow-on) |
|---|---|---|
| Library locks | ✓ Confirmed (§1) | — |
| Wire format | ✓ Stable (§2) | — |
| Pairing protocol | ✓ Sequence frozen (§3) | implement X3DH wire-up |
| Olm 1:1 session API surface | ✓ Defined (§4) | implement Double-Ratchet over real channel |
| 1:1 pair smoke (in-memory) | ✓ Land (§5) | — |
| WASM binding plan | ✓ Documented (§6) | wasm-bindgen build + Vite pre-bundle |
| WebRTC transport | — | webrtc-rs wrapper (Sprint 3) |
| ctrl-relay worker (CF) | — | worker + miniflare local stub (Sprint 3) |
| Automerge sync (3 documents) | — | Sprint 4 |
| mDNS LAN accelerator | — | Sprint 4.9 (deferred to v1.1 per ADR-003 §9) |

The v1.0 deliverable demonstrates the crypto core works end-to-end against vendored vodozemac; the rest is mechanical wiring on top of frozen interfaces.

---

## 1. Library locks (post-Sprint 1 evidence)

ADR-003 §14 records the four library locks. This section adds the reasoning trail so future readers don't re-litigate.

### 1.1 Crypto — vodozemac v0.10.x (Olm 1:1 only)

| Candidate | Verdict | Reason |
|---|---|---|
| **vodozemac (Matrix.org)** | **LOCKED** | Audited by NCC Group (2022) + ongoing matrix-rust-sdk usage at scale. Pure Rust, no C deps. WASM-bindgen-ready via `wasm-bindgen` target. Post-2026-02 fix release closes the Soatok non-contributory DH key disclosure. |
| libsignal-rust | rejected | Upstream policy: "use outside Signal is not yet recommended"; Rust API unstable; build pulls protobuf compiler. |
| ring + hand-rolled Noise | rejected | One-off crypto; we'd own the spec, the audit, and the bug-fix release cycle. Anti-NIH. |
| age + per-message envelope | rejected | No forward secrecy / no PCS — disqualifies for AI memory mesh. |

**Constraint** (locked by ADR-003 §3.1 row 3 + §6.1): use **Olm 1:1 only**, NOT Megolm. CTRL is single-user multi-device — group encryption is dead weight (~80 KB WASM, no security benefit).

**Defense-in-depth**: wrap vodozemac DH calls with a DH-validity check at the session boundary; reject identity points with low-order subgroup risk. See §4.4.

### 1.2 WebRTC — webrtc-rs v0.17.x (feature-frozen)

| Candidate | Verdict | Reason |
|---|---|---|
| **webrtc-rs v0.17.x** | **LOCKED** for v1.0 | Pure Rust, feature-frozen branch matches our static-link policy. ~2 MB binary contribution acceptable in 25 MB installer. |
| webrtc-rs v0.20+ (Sans-IO) | track as v1.1 tech-debt | Cleaner Sans-IO architecture but unstable API; defer until post-launch. |
| str0m | rejected for v1.0 | Sans-IO design is nicer but lacks production hours; revisit at v1.1. |
| native browser WebRTC only | partial | Used on iOS/Android PWA (browser API); desktop still needs webrtc-rs. |

### 1.3 CRDT — Automerge v0.7.x (Rust + WASM same wire format)

| Candidate | Verdict | Reason |
|---|---|---|
| **automerge v0.7.x** | **LOCKED** | Rust-first; WASM target with identical wire format. Op-based merge maps cleanly onto kernel Cell/Op. |
| Yjs | rejected | JS-first; would force a parallel Rust impl for the kernel. |
| Loro | rejected (for now) | Newer, less production exposure; revisit at v2. |
| State-based CRDT (Merkle-CRDT) | rejected | Forces re-encoding of existing Cell/Op model. |

### 1.4 mDNS — mdns-sd v1.71+ (deferred to v1.1)

| Candidate | Verdict | Reason |
|---|---|---|
| **mdns-sd v1.71+** | **LOCKED for v1.1** | Pure Rust, no C dep, async-friendly. |
| zeroconf-rs | rejected | Binds to platform mDNS daemons (Bonjour on macOS, Avahi on Linux) — heavier and inconsistent across OSes. |

mDNS is a v1.1 LAN accelerator; v1.0 ships without it (ADR-003 §9 P4.9).

---

## 2. Wire format (frozen)

Identical to `packages/ctrl-mesh/src/wire.rs`. Recap:

```text
MeshFrame {
  magic:        b"CMSH"      // 4 bytes — sanity check + protocol identifier
  version:     u8 = 1        // bump on incompatible change only
  kind:        FrameKind     // pairing | data | control
  from:        DeviceId
  to:          DeviceId
  session_step: u32          // monotonic per-direction counter (replay defense)
  ciphertext:  Vec<u8>       // Olm-encrypted body
}
```

Decrypted body is one of:

```text
DataPayload::Change(MeshChange)   // Automerge change for a Document
DataPayload::Op { kind, payload } // ephemeral kernel Op (signal/ack/control)
```

`MeshChange` envelope:

```text
MeshChange {
  document_id:   String           // "mesh.devices" | "mesh.keycaps" | …
  causal_clock:  VectorClock      // last-seen seq per device
  author_device: DeviceId
  author_ts_ms:  u64
  change_bytes:  Vec<u8>          // raw automerge save_incremental output
}
```

Serialization: **CBOR** via ciborium (same crate the kernel uses for `Event`). Rationale: smaller than JSON, schema-flexible, already in our binary.

**Anti-spec**: do not use protobuf (extra build dep + IDL maintenance) or bincode (no forward-compat story).

---

## 3. Pairing protocol (sequence-frozen)

Pairing is the only flow where the relay sees plaintext device identity (public keys, never private). Sequence per ADR-003 §5.1, with implementation contracts here.

### 3.1 Sequence (initiator A, joiner B)

```text
A: Settings → "Add device"
A:    1. account_a = vodozemac::olm::Account::new()
A:    2. pre_key = account_a.one_time_keys().pick_one()  // mark published
A:    3. pair_offer = PairOffer {
A:           identity_pub:   account_a.curve25519_key(),
A:           one_time_pub:   pre_key,
A:           challenge:      random 8-byte nonce,
A:           relay_endpoint: "wss://relay.ctrl.run/signal",
A:           expires_at:     now + 5 min
A:       }
A:    4. qr_payload = cbor(pair_offer)         // target ≤ 60 bytes pre-base32
A:    5. render(qr_payload) + show 6-digit fallback (hash → base10)

B: Settings → "Join mesh" → scan QR (or type code)
B:    6. account_b = vodozemac::olm::Account::new()
B:    7. session_b = account_b.create_outbound_session(
B:                       account_a.curve25519_key(),     // from QR
B:                       account_a.one_time_keys.picked) // from QR
B:    8. hello = session_b.encrypt(
B:                  PairHello {
B:                      identity_pub: account_b.curve25519_key(),
B:                      display_name: "soodo's iPhone",
B:                      kind:         DeviceKind::Mobile,
B:                      challenge_response: hmac(challenge, shared_secret)
B:                  })
B:    9. POST /pair { to: A_id, from: B_id, body: hello } → relay

A: relay push (or signaling beacon delivers)
A:   10. session_a = account_a.create_inbound_session(hello)
A:   11. pair_hello = session_a.decrypt(hello)
A:   12. verify pair_hello.challenge_response == hmac(challenge, shared_secret)
A:   13. show UI: "iPhone wants to join mesh. Approve?" → user confirms
A:   14. account_a.mark_keys_as_published()       // one-time key consumed
A:   15. snapshot = render(mesh.devices, mesh.keycaps, mesh.preferences)
A:   16. encrypted = session_a.encrypt(snapshot)
A:   17. send via beacon → B

B:   18. apply snapshot → mesh seeded
B:   19. emit OpKind::MeshDeviceJoined for B's identity

Both: Olm 1:1 session is now live; subsequent frames use Double-Ratchet via session_*.
```

### 3.2 Replay & MITM defenses

| Threat | Defense | Where |
|---|---|---|
| QR replay (attacker re-uses old QR) | one-time key marked published after step 14 — second use of QR fails X3DH | step 14 |
| Pairing code phishing | QR carries A's identity public key; man-in-the-middle would have to substitute key, which mismatches once user verifies SAS (optional but offered) | step 4 + UI |
| Relay impersonates A | relay never holds A's private key; signed challenge from B is verified by A's account, not relay | step 12 |
| Stolen QR after expiry | `expires_at` enforced at step 10 (account_a rejects inbound session if QR > 5 min old) | step 10 |

### 3.3 Anti-flows (forbidden)

- ❌ Pairing over plain HTTP (relay must be WSS).
- ❌ Reusing identity key as one-time key (vodozemac API rejects this; verify in tests).
- ❌ Caching one-time keys across reboots without `account.pickle()` round-trip.
- ❌ Pairing without user confirmation on A (step 13) — silent pair = MITM target.

---

## 4. Session API surface (frozen interfaces, v1.1 implements)

This section locks the Rust + WASM surface so Sprint 2+ doesn't churn callers.

### 4.1 `OlmSession` (Rust)

```rust
// packages/ctrl-mesh/src/session.rs (Sprint 2 fills the body)

pub struct OlmSession {
    inner: vodozemac::olm::Session,
    peer_identity_pub: Curve25519PublicKey,
}

impl OlmSession {
    /// Initiator side. Establishes outbound session against peer's prekey bundle.
    pub fn establish_outbound(
        local: &mut OlmAccount,
        peer_identity: Curve25519PublicKey,
        peer_one_time: Curve25519PublicKey,
    ) -> Result<Self, SessionError>;

    /// Responder side. Establishes inbound session from initiator's first message.
    pub fn establish_inbound(
        local: &mut OlmAccount,
        first_message: &OlmMessage,
    ) -> Result<Self, SessionError>;

    /// Encrypt a frame payload. Increments ratchet counter.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> OlmMessage;

    /// Decrypt a frame payload. Validates ratchet counter (replay defense).
    pub fn decrypt(&mut self, msg: &OlmMessage) -> Result<Vec<u8>, SessionError>;

    /// Persist session to keychain (serialized via `session.pickle()`).
    pub fn pickle(&self, key: &PickleKey) -> Vec<u8>;

    /// Restore session from keychain.
    pub fn unpickle(bytes: &[u8], key: &PickleKey) -> Result<Self, SessionError>;

    pub fn peer_identity(&self) -> Curve25519PublicKey;
}
```

### 4.2 `OlmAccount` (Rust)

```rust
pub struct OlmAccount {
    inner: vodozemac::olm::Account,
}

impl OlmAccount {
    pub fn fresh() -> Self;

    pub fn identity_public_key(&self) -> Curve25519PublicKey;

    /// Generate N fresh one-time keys (default 50).
    pub fn rotate_one_time_keys(&mut self, count: usize);

    /// Mark a one-time key as published (cannot be reused).
    pub fn mark_keys_as_published(&mut self);

    pub fn pickle(&self, key: &PickleKey) -> Vec<u8>;
    pub fn unpickle(bytes: &[u8], key: &PickleKey) -> Result<Self, SessionError>;
}
```

### 4.3 Errors (`SessionError`)

| Variant | When |
|---|---|
| `VodozemacError(String)` | underlying vodozemac error (wrapped, never leak internals) |
| `InvalidPrekey` | DH-validity check failed |
| `ReplayDetected { expected, got }` | ratchet step regression |
| `PickleKeyMismatch` | wrong key for stored session |
| `ExpiredPairOffer` | pair offer past TTL |

### 4.4 DH-validity check (defense-in-depth)

Before passing a peer identity key into vodozemac, validate that it is not the low-order subgroup point. Code path: `Curve25519PublicKey::from_bytes` → reject if `bytes` matches any of the 11 known low-order points. This protects against the Soatok disclosure regardless of which vodozemac patch level is in use.

### 4.5 WASM binding (v1.1 build, surface locked here)

```typescript
// packages/ctrl-mesh/wasm/index.d.ts (generated by wasm-bindgen Sprint 2)

export class OlmSession {
  encrypt(plaintext: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array): Uint8Array;
  pickle(key: Uint8Array): Uint8Array;
  static unpickle(bytes: Uint8Array, key: Uint8Array): OlmSession;
  static establishOutbound(local: OlmAccount, identityPub: Uint8Array, oneTimePub: Uint8Array): OlmSession;
  static establishInbound(local: OlmAccount, firstMessage: Uint8Array): OlmSession;
  readonly peerIdentity: Uint8Array;
}

export class OlmAccount {
  constructor();
  readonly identityPublicKey: Uint8Array;
  rotateOneTimeKeys(count: number): void;
  markKeysAsPublished(): void;
  pickle(key: Uint8Array): Uint8Array;
  static unpickle(bytes: Uint8Array, key: Uint8Array): OlmAccount;
}
```

Targeted bundle: ≤ 180 KB gzip for the WASM + glue (subset of the ADR-003 §7 ~330 KB mesh budget — Olm-1:1-only saves ~80 KB vs Megolm-included build).

---

## 5. 1:1 pair smoke (v1.0 deliverable)

Goal: a deterministic, in-memory round-trip test that exercises the real vodozemac crypto and proves the locked interfaces above hold up.

### 5.1 Test scope

- Two `OlmAccount`s (Device A "desktop", Device B "mobile") generated in-process.
- A advertises one-time key; B builds outbound session; B sends "hello"; A builds inbound session from B's first message; A decrypts; A replies; B decrypts.
- Verify:
  - Both directions decrypt to the expected plaintext.
  - Ratchet counter advances monotonically.
  - Re-attempting the SAME ciphertext fails (replay defense).
  - Pickling + unpickling each session preserves state.

### 5.2 Where it lives

`packages/ctrl-mesh/tests/olm_pair_smoke.rs` (integration test, only compiled when `--features crypto`).

### 5.3 What it does NOT test (deferred)

- WebRTC transport
- ctrl-relay routing
- Automerge change application
- WASM glue layer

Those are Sprint 3+ deliverables; this smoke just proves the crypto core compiles + ratchets correctly.

---

## 6. WASM binding plan

Sprint 2 (athena) will produce `packages/ctrl-mesh/wasm/` via `wasm-bindgen`. v1.0 spec items:

1. **Build target**: `wasm32-unknown-unknown` with `wasm-bindgen-cli` and `wasm-opt -Oz`.
2. **Cargo target stub** (added to `ctrl-mesh/Cargo.toml` in v1.1): `crate-type = ["rlib", "cdylib"]` behind the `wasm` feature.
3. **JS twin** (`packages/ctrl-mesh/index.ts`): re-export the generated bindings with a TypeScript wrapper that adds runtime DH-validity check + nicer error types (mirrors §4.3 enum).
4. **Bundle slot**: `import('@ctrl/mesh')` is the **lazy-load entry point** in the PWA. Vite chunks it separately; the app shell never imports it eagerly. Wire-up lands in `packages/ctrl-web` Sprint 2 (zeus / lane-A).
5. **No mobile-only divergence**: the same WASM artifact serves Win / macOS / iOS / Android browser PWAs. Desktop kernel uses the Rust crate directly (no WASM bridge), so iOS/Android are the only WASM consumers.

### 6.1 Vodozemac WASM build prerequisites (verified ahead of Sprint 2)

- vodozemac compiles to `wasm32-unknown-unknown` (matrix-rust-sdk has shipped this for ~2 years).
- No `getrandom` issues — vodozemac uses the `web_sys` Crypto API via `getrandom`'s `js` feature, which we'll enable behind a `wasm` cargo feature flag.
- `Account.pickle()` works in the browser — pickle key derives from device-local IndexedDB-stored material.

---

## 7. ctrl-relay worker (v1.1 deliverable, spec'd here)

Worker lives in **sibling repo `ctrl-cloud/workers/ctrl-relay/`**. Lane-D produces the spec; ctrl-cloud merges the worker code.

### 7.1 Endpoints (recap of ADR-003 §4.1)

| Path | Purpose | Auth |
|---|---|---|
| `WSS /signal` | Persistent presence + ICE candidate exchange | Identity-key signed challenge |
| `WSS /relay/:peer_id` | TURN-style fallback (encrypted payload forward) | Mutual identity proof |
| `POST /pair` | One-time pair-offer routing | Rate-limited by IP |
| `GET /healthz` | Health check | Public |

### 7.2 Local-mock strategy (NOT `wrangler dev`)

CLAUDE.md globally forbids `wrangler dev`. v1.1 local dev path:

- **Sprint 3**: Node 20 `ws` server (~80 LOC) re-implementing the four endpoints in memory. Lives at `packages/ctrl-mesh/dev/relay-mock.ts`. Two PWA tabs connect to `ws://localhost:N` for laptop-only round-trip testing.
- **CI**: docker-compose with two containers + the Node mock in a third; tests run cross-container ICE + relay fallback.
- **Staging**: deploy to `ctrl-relay.<account>.workers.dev` via `wrangler deploy` (deploy, not dev). PWA flips relay endpoint env var per build target.
- **Production**: `wss://relay.ctrl.run` (CNAME → `ctrl-relay.<account>.workers.dev`).

### 7.3 Zero-knowledge enforcement

The worker must NEVER:

- Decrypt or inspect `ciphertext` field of `MeshFrame`.
- Persist routing logs beyond `[timestamp, source_pubkey, dest_pubkey, byte_count]` for billing.
- Cross-reference mesh peers between different users (each user's mesh has independent identity keys; relay scopes routing by destination pubkey, not by user account).

D1 schema (sketch):

```sql
CREATE TABLE relay_quota (
  -- per-pubkey monthly byte counter, used for the free 1 GB fair-use cap
  identity_pub TEXT PRIMARY KEY,
  month        TEXT NOT NULL,          -- "2026-05"
  bytes_used   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
```

No table stores message content, no table joins users across identity keys (matches CLAUDE.md "no cross-D1 JOIN" rule by construction).

---

## 8. Test plan (v1.1, summary)

| Test | Layer | Sprint |
|---|---|---|
| ✓ smoke 7 (skeleton) | skeleton compile | v1.0 done |
| ✓ olm_pair_smoke | crypto core round-trip | v1.0 this lane |
| pair_qr_replay_rejected | pairing replay defense | Sprint 2 |
| session_pickle_round_trip | persistence | Sprint 2 |
| sas_verification | optional SAS step | Sprint 2 |
| webrtc_ice_round_trip | transport (docker pair) | Sprint 3 |
| relay_fallback_when_p2p_fails | transport fallback | Sprint 3 |
| automerge_3doc_converge | sync layer | Sprint 4 |
| offline_30day_then_merge | CRDT stress | Sprint 4 |
| device_revoke_cuts_future | post-compromise security | Sprint 4 |
| wasm_olm_browser_round_trip | WASM glue | Sprint 2 (in PWA repo) |

Coverage target: ≥ 30 unit + ≥ 5 integration tests before any of Sprints 2-4 merge per H-2026-05-14-001.

---

## 9. Risks revisited (delta from ADR-003 §10)

| Risk | ADR-003 sev | Spec mitigation |
|---|---|---|
| vodozemac DH non-validation | 🔴 | §4.4 wrapper-level check + pinned ≥0.10 |
| webrtc-rs v0.17 stale before v1.1 | 🟡 | locked as ADR-003 §10 amendment; v0.20 Sans-IO migration tracked as v1.1 tech debt only |
| WASM bundle inflation | 🟡 | Olm-1:1-only build saves ~80 KB vs Megolm-included; lazy-load on Settings → Add Device |
| QR code MITM | 🟢 | SAS verification (numeric short-string compare) offered as optional confirm UI |
| Pickle key compromise (stolen device) | 🔴 | pickle key derives from OS keychain (Windows DPAPI / macOS Keychain) — moving the file off-device is not enough |
| Worker forced TLS termination by CDN | 🟢 | ciphertext is end-to-end; CDN sees only Olm payload |

No new 🔴 risks introduced by this spec.

---

## 10. Open questions (deferred — `@zeus v1.1 RFC scope`, athena Sprint 2 to resolve)

All four are non-blocking for v1.0 design lock; athena Sprint 2 picks them up before wiring the WASM build.

- **Pickle key root**: derived from OS keychain or from user-set passphrase? Currently planning OS keychain only; passphrase is a v2 feature.
- **One-time key replenishment**: triggered eagerly (every connect) or lazily (when < 10 remain)? Lock at Sprint 2.
- **SAS verification UI**: surfaced by default or under "advanced"? Default = under "advanced" (most users won't verify); Sprint 2 PWA call.
- **Identity rotation**: never (current) vs. allow on user request? `Never` for v1; revisit if compromise scenarios surface.

---

## 11. Change log

| Date | Change | By |
|---|---|---|
| 2026-05-19 | Draft v0.1 — initial spec from ADR-003 + Sprint 1 evidence | hephaestus (lane-D) |
