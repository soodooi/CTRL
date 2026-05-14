# ADR-003: Multi-device Mesh Communication Architecture

- **Status**: **Accepted** (bao 2026-05-14, choice "A" — full mesh, mobile lane in v1.0)
- **Date**: 2026-05-14 (proposed), 2026-05-14 (accepted)
- **Decision makers**: bao (architecture call + accept), zeus (proposer + foundation builder), athena (Sprint 2+ implementer)
- **Supersedes (partial)**:
  - ADR-002 §8 (Mobile lane) — replaced by mesh-native mobile model
  - ADR-002 §9 (Optional `ctrl-relay`) — promoted from P11+ to mandatory v1.0 (signaling-only) and v1.1 (CRDT sync coordinator)
  - ADR-001 §6 item #18 (Optional `ctrl-sync` P11+) — promoted to v1.1
  - ADR-001 §11 (CRDT library question) — resolved (see §6 of this ADR)
- **Preserves (untouched)**:
  - ADR-001 5 kernel primitives (Actor / Capability / Event / Channel / Effect)
  - ADR-001 §4 5 keycap sources — ST-SS source unchanged at wire level
  - ADR-001 §6 #1–17 — protocol/data/creator/market/commercial layers intact
  - ADR-002 §1 PWA-first + Tauri 2 shell — UI layer untouched
  - 不做清单 — no workflow editor, no hardware vendor, no GPT clone, no mamamiya tenant
- **References**: AIOS (Rutgers COLM 2025); Signal protocol (libsignal); Yjs / Automerge CRDTs; WebRTC (RFC 8825 / 8830); mDNS (RFC 6762); Anthropic MCP

---

## 1. Decision

CTRL adopts a **hybrid multi-device mesh communication architecture**, replacing the v1 cloudflared-tunnel approach (ADR-002 §8) with a layered stack:

```
Discovery → Transport → Encryption → Sync
```

| Layer | Primary | Fallback | Same-LAN accelerator |
|---|---|---|---|
| Discovery | ctrl-relay signaling (HTTPS WSS) | — | mDNS (`_ctrl._tcp.local`) |
| Transport | WebRTC datachannel (P2P, STUN/TURN) — **webrtc-rs v0.17.x in v1.0**, v0.20+ Sans-IO migration tracked as v1.1 tech-debt | ctrl-relay forwarding (encrypted payload) | mDNS-direct TCP |
| Encryption | **vodozemac (Matrix.org fork of Olm)** — Olm 1:1 sessions only, **no Megolm**. Rust on desktop + `wasm-bindgen` build on PWA. Signal's libsignal-rust is explicitly rejected (upstream policy "use outside Signal is not yet recommended"). | — | — |
| Sync | Automerge CRDT v0.7.x (Rust + `@automerge/automerge` WASM, same wire format) | — | — |

**Brand promise**: 任何设备 (Win / Mac 桌面, iOS / Android PWA, 未来 AI 眼镜) 一次配对, 永久无配置 mesh; 零本地常驻端口 (除 mDNS 可选); 端到端加密; 离线优先。

**Strategic frame**: this is the technical foundation for ADR-001 §4 source #4 (ST-SS multi-device + hardware), §6 #18 (cross-device AI memory), and §10 keycap #15 (跨设备同步). Without it, CTRL is a single-machine launcher — Raycast with a Chinese skin. With it, CTRL is the only ambient-AI mesh with E2E privacy + offline-first.

---

## 2. Why this changes now (delta from ADR-002)

ADR-002 §8 specified PWA on mobile + cloudflared tunnel as bridge. Three product realities surfaced in the 2026-05-14 architecture call:

| Reality | Source | Forces toward |
|---|---|---|
| User must manually run `cloudflared tunnel` and copy URL = friction | bao usability question | Zero-config pairing |
| Tunnel = public URL = global attack surface; only token + localhost binding mitigates | sub-PR d security review (CRITICAL-1) | Encrypted P2P, no public exposure |
| Mobile loses state when offline (WS disconnects, no replay) | Mobile UX behavior on iOS background suspend | Offline-first via CRDT |
| Future hardware peers (AI glasses, e-paper) cannot run cloudflared | hardware-strategy spec | Mesh primitive that hardware can join |
| ADR-001 §11 left CRDT library deferred — but no sync = no cross-device AI memory | ADR-001 §6 #7 + §14 SC #5 dependency | CRDT pinned (Automerge) |

**Conclusion**: build the mesh primitive once, in v1, instead of bolting on per-device workarounds.

---

## 3. Architecture — 4-layer mesh

### 3.1 Layer diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Application (L3 userland / PWA routes)                                 │
│  - keycap invocations / ST-SS publishers / subscribers                 │
│  - reads from + writes to local CRDT document                          │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ application-level Cell/Op (unchanged from ADR-001)
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ Sync layer — Automerge CRDT v0.7.x                                     │
│  - Each device holds full local copy of shared documents               │
│  - Op-based merge (commutative, idempotent, conflict-free)             │
│  - Documents: mesh.devices / mesh.keycaps / mesh.preferences (v1.0)    │
│              + mesh.history / mesh.clipboard (v1.1)                    │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ Automerge change frames (binary, ~50 bytes/op typical)
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ Sync layer — vodozemac (Olm 1:1 only, NO Megolm)                       │
│  - Per-peer double-ratchet session, forward secrecy, post-compromise   │
│  - Pre-shared device key established via QR pairing (X3DH)             │
│  - Relay sees only ciphertext + ICE candidates (zero-knowledge)        │
│  - vodozemac vendored via `cargo vendor`; pinned to post-2026-02 fix   │
│    release that addresses Soatok's non-contributory DH key disclosure  │
│  - Own DH-validity check at wrapper layer (defense-in-depth)           │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ encrypted payload + control frames
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ TRANSPORT layer (per peer pair, negotiated at session start)           │
│  Priority order:                                                        │
│  1. WebRTC datachannel (P2P, STUN-traversal, ~5ms LAN / ~30ms WAN)     │
│  2. ctrl-relay forwarding (TURN-style, ~50-200ms via Cloudflare PoP)   │
│  3. mDNS direct TCP (same-LAN accelerator, ~3ms, optional)             │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ ICE / TLS / mDNS service records
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ DISCOVERY layer                                                        │
│  - ctrl-relay (CF Worker): always-available signaling, MIME WSS only   │
│  - mDNS (optional, same-LAN): zero-config local peer discovery         │
│  - Identity: long-lived device public key (curve25519, derived from   │
│    libsignal identity key)                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Five mesh primitives (the only concepts the rest of the system needs)

| # | Primitive | Role |
|---|---|---|
| 1 | **Identity** | Device public key (curve25519) + display name + capabilities |
| 2 | **Peer** | Remote Identity + current transport state + libsignal session |
| 3 | **Document** | Named Automerge document, replicated across all peers in the mesh |
| 4 | **Channel** | Bidirectional encrypted transport between two Peers (WebRTC / relay / mDNS) |
| 5 | **Signaling Beacon** | ctrl-relay endpoint each device polls/connects to advertise presence + accept ICE offers |

No 6th concept. Higher-level features (cross-device clipboard / AI memory mesh / shared keycap pool) are all Documents.

### 3.3 Why this stack

| Choice | Reason |
|---|---|
| Hybrid (not pure P2P) | WebRTC NAT traversal succeeds 80-90% of internet pairs; relay fallback covers the rest. Pure P2P would strand users behind symmetric NATs. |
| Hybrid (not pure relay) | 99% of typical flow is P2P → relay sees only signaling (~1 KB/peer-pair), keeping CF Workers cost negligible. |
| libsignal (not raw NaCl) | Forward secrecy + post-compromise recovery are non-negotiable for AI memory mesh (one stolen device must not compromise history). |
| Automerge (not Yjs) | Rust-native + WASM dual-target lets kernel + PWA share document logic. Yjs is JS-first and would require a separate Rust impl. |
| Op-based CRDT (not state-based) | Cell/Op already model events; serializing them as Automerge changes is mechanical. State-based CRDTs would force re-encoding. |
| mDNS as accelerator only | Same-LAN sub-3ms is real value, but iOS PWA forbids mDNS, so it can never be the primary path. |

### 3.4 What this architecture is NOT

- ❌ A federated social protocol (Matrix, ActivityPub) — CTRL is single-user multi-device
- ❌ A general-purpose CRDT cloud (no per-document servers like Liveblocks)
- ❌ A blockchain or DHT-based identity system — pure key-based pairing only
- ❌ A media streaming protocol — ST-SS sends semantic cells, not raw audio/video
- ❌ Multi-tenant — each user's mesh is independent; no cross-user discovery

---

## 4. ctrl-relay (CF Worker, signaling + fallback)

### 4.1 Endpoints

| Path | Purpose | Auth |
|---|---|---|
| `WSS /signal` | Persistent signaling channel; each device opens one. Sends/receives ICE candidates + offer/answer SDP. | Device identity key (signed challenge) |
| `WSS /relay/:peer_id` | TURN-style fallback. Encrypted payload (libsignal ciphertext) is forwarded byte-for-byte between two peers. | Both peers must be paired (mutual identity proof) |
| `POST /pair` | One-time pairing endpoint. Returns short-lived pairing code that the QR encodes. | Optional auth (rate-limited by IP) |
| `GET /healthz` | Health check (Cloudflare uptime monitoring). | Public |

### 4.2 Zero-knowledge property

The relay sees:
- Encrypted ciphertext (libsignal payload) — opaque
- Source + destination device public keys — needed for routing
- Transport metadata (ICE candidates) — needed for P2P upgrade
- Timing / packet sizes — irreducible side channel

The relay does NOT see:
- Plaintext Cell/Op content
- CRDT document state
- Keycap names / invocations / AI memory
- BYOK API keys (those never enter the mesh)

If the relay is compromised, the worst leak is metadata (which peers paired when, payload sizes). Content remains confidential.

### 4.3 Cost model

| Operation | Bandwidth | CF Workers cost (paid plan $5/mo + $0.50/M req) |
|---|---|---|
| Signaling open + heartbeat | ~100 B/min/device | $0.00 (within free tier) |
| ICE candidate exchange (one-time per pair) | ~2-5 KB | $0.00 |
| Relay fallback (P2P failed) | full payload bandwidth | ~$0.05/GB after free 10GB egress |

For a typical user with 2 devices and P2P success: ~500 KB/month relay traffic, well within CF free tier. For a worst-case symmetric-NAT user with 100% relay: ~50 MB/month, $0.0025/month.

**This is the cheapest "infrastructure" CTRL ever runs.**

---

## 5. Pairing flow

### 5.1 Initial pair (any two devices)

```
Device A (already in mesh)                 Device B (joining)
   │                                          │
   │  1. User: Settings → "Add device"        │
   │  2. Generate one-time pairing code       │
   │     (60-byte payload, encodes:           │
   │      - A's device public key             │
   │      - relay endpoint URL                │
   │      - 8-byte challenge nonce)           │
   │  3. Render QR + 6-digit fallback         │
   │                                          │
   │                                          │  4. User: Settings → "Join mesh"
   │                                          │  5. Scan QR / type 6-digit code
   │                                          │  6. Generate B's identity key
   │                                          │  7. POST /pair (relay) with:
   │                                          │     - B's public key
   │                                          │     - A's public key from QR
   │                                          │     - signed challenge
   │  8. Relay routes pair-offer to A         │←─────── pair-offer
   │  9. Push notification to A (Web Push     │
   │     subscription if available)           │
   │  10. User confirms on A                  │
   │  11. A → libsignal X3DH handshake        │
   │  12. Encrypted session established       │
   │  13. A sends mesh document snapshots     │ ────────→
   │                                          │  14. B writes local copy
   │                                          │  15. Pairing complete
```

QR contains no secret beyond the one-time challenge. Pairing code expires in 5 minutes. Replay attacks fail because the challenge is bound to A's public key and signed by both parties.

### 5.2 Subsequent connect (already paired devices)

Both devices on boot open a persistent WSS to `/signal`. They see each other's "online" advertisements, attempt WebRTC ICE exchange, and upgrade to P2P within 1-2 seconds. If WebRTC fails (symmetric NAT both sides), they fall back to relay forwarding without user intervention.

---

## 6. CRDT layer (Automerge)

### 6.1 Document inventory (v1.0)

| Document | Owner | Purpose | v target |
|---|---|---|---|
| `mesh.devices` | implicit | Roster of paired devices + their capabilities | v1.0 |
| `mesh.keycaps` | each device contributes | Pool of installed keycaps (manifests + last-used) | v1.0 |
| `mesh.preferences` | LWW | User settings (theme, default LLM, etc) | v1.0 |
| `mesh.history` | append-only | Cross-device AI memory log (Cell stream excerpts) — **uses per-peer Olm 1:1 sessions only, no Megolm** (CTRL is single-user, no group encryption needed; Megolm would add ~80 KB to bundle for zero benefit) | v1.1 |
| `mesh.clipboard` | append-only, capped | Optional cross-device clipboard (user-toggled) | v1.1 |

### 6.2 Why Automerge

| Property | Automerge | Yjs |
|---|---|---|
| Language | Rust-first (also WASM) | JS-first (also Rust via separate crate) |
| Op size | ~50 B/typical change | ~30 B/typical change |
| Conflict resolution | Op-based (full causal history) | Op-based + GC |
| WASM bundle | ~150 KB | ~60 KB |
| License | MIT | MIT |
| Stability | 2.0 stable (2023+) | 13.x stable, large adoption |

Bundle size is the only meaningful Yjs advantage. Automerge wins on Rust integration (kernel can author + read same documents the PWA writes), op semantics (matches our existing Cell/Op model), and full-history preservation (matches event-sourced kernel persistence).

### 6.3 Document mapping to Cell/Op

Each Automerge change maps to a kernel Op:

```rust
struct MeshChange {
    document_id: String,
    change_bytes: Vec<u8>,  // Automerge binary change
    author_device: DeviceId,
    causal_clock: VectorClock,
}
```

Kernel `event_bus` already routes Ops to subscribers; the mesh layer is a subscriber that forwards each Op as an Automerge change to peers, and a publisher that injects remote Ops into the local bus.

---

## 7. Platform coverage

| Platform | Identity | Discovery | Transport | Encryption | CRDT |
|---|---|---|---|---|---|
| Win 11 (Tauri 2) | curve25519-dalek (Rust) | mDNS via windows-sys | webrtc-rs | vodozemac (Rust) | automerge-rs |
| macOS 13+ (Tauri 2) | curve25519-dalek (Rust) | Bonjour via objc2 | webrtc-rs | vodozemac (Rust) | automerge-rs |
| iOS Safari PWA | libsignal-wasm | none (iOS PWA limit) | browser WebRTC | libsignal-wasm | automerge-wasm |
| Android Chrome PWA | libsignal-wasm | none | browser WebRTC | libsignal-wasm | automerge-wasm |
| Future AI glasses | minimal libsignal-c | mDNS (if BLE bridge) | webrtc-rs | vodozemac | optional (publish only) |

PWA bundle delta: libsignal-wasm ~150 KB + automerge-wasm ~150 KB + small mesh client ~30 KB = **~330 KB total**, brings the PWA bundle from current 125 KB → ~450 KB gzip. Exceeds ADR-002 §5 300 KB target. **ADR-002 §5 budget revised here to 500 KB gzip** — justified because mesh is the differentiator. App shell critical-path code (<200 KB) still loads first; mesh modules lazy-load on Settings → Add Device.

---

## 8. Migration from ADR-002 §8 (cloudflared tunnel)

| Component | ADR-002 state | ADR-003 state | Migration |
|---|---|---|---|
| `kernel::stss_bridge` (WS server) | ✓ exists | ✓ keep | Add second transport (mesh client) alongside; kept for local Tauri WebView ↔ kernel IPC fallback |
| `commands::stss::publish/subscribe` | ✓ exists | ✓ keep | No change to PWA-facing API; mesh transparent below |
| cloudflared tunnel docs | in README + spike runbook | removed | mesh replaces it; tunnel docs deleted on ADR-003 acceptance |
| Web Push (ADR-002 §9 ctrl-push) | planned P8 | optional, still useful | Mesh primary; Push fires when device is fully offline to wake it |

The mesh layer wraps stss_bridge: the bridge already handles local WS connections; mesh adds the cross-device path. PWA running in Tauri WebView keeps using Tauri `invoke` for its kernel commands (zero-port, fastest); ST-SS cross-device flows through mesh.

---

## 9. Phase plan (revises ADR-002 §10)

| Phase | Content | v target |
|---|---|---|
| P3.7-P3.9 (sub-PR b–e + review fixes) | Tauri 2 shell + PWA scaffold + stss_bridge baseline + token auth | **already in flight** |
| **P4.5 (NEW)** | **mesh-core**: Identity + Peer + libsignal session establishment + signaling client | **v1.0** (this handoff scope) |
| **P4.6 (NEW)** | **mesh-transport**: WebRTC + relay fallback (no mDNS yet) | **v1.0** |
| **P4.7 (NEW)** | **mesh-sync**: Automerge integration + 3 documents (mesh.devices, mesh.keycaps, mesh.preferences) | **v1.0** |
| **P4.8 (NEW)** | **ctrl-relay worker**: CF Worker for signaling + relay fallback | **v1.0** |
| P5 | Tool manifest spec implementation | v1.0 (parallel) |
| P6 | AI 创作向导 | v1.0 (parallel) |
| P7 | 5 P0 built-in keycaps | v1.0 |
| **P4.9 (NEW)** | **mesh-extras**: mDNS LAN accelerator + history/clipboard documents | v1.1 |
| P8 | ctrl-cloud + ctrl-auth + ctrl-billing + (folded ctrl-relay) | v1.0 |
| P9 | ctrl-market | v1.0 |
| P9.5 | ctrl-affiliate (Q2 electronic-commerce) | v1.1 |
| P10 | Closed beta | v1.0 |
| P11+ | Hardware actor SDK + AI glasses as mesh peer | post-launch |

**Net effect**: mesh becomes a v1.0 requirement. The pre-merge `feat/h-001-e-cleanup` branch (PWA pivot sub-PR e) merges first; mesh work starts on a parallel branch immediately after.

---

## 10. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| webrtc-rs is heavy (~2 MB binary contribution) | 🟡 | Acceptable within 25 MB installer; switch to slim webrtc-rs feature flags |
| libsignal protocol misuse → silent crypto failure | 🔴 | Use vodozemac (Element / matrix-rust-sdk maintainers' fork, audited); explicit X3DH + Double-Ratchet API only |
| iOS PWA WebRTC + WSS background limits | 🟡 | Foreground-only sync; Web Push wake fallback |
| Automerge WASM bundle adds 150 KB | 🟡 | Lazy-load on first cross-device action |
| Symmetric NAT + restrictive firewall = relay-only | 🟢 | Acceptable cost; user experience identical, just higher latency |
| ctrl-relay outage = no new pairs (existing P2P unaffected) | 🟡 | Relay deployed on Cloudflare with 99.99% SLA; existing peers keep working |
| Device key compromise (stolen laptop) | 🔴 | User runs "revoke device" from any other paired device; libsignal post-compromise security limits damage |
| MITM during initial pair | 🟢 | QR code over physical channel (camera-to-camera); short authentication string (SAS) verification optional |
| Mesh divergence on long offline (>30 days) | 🟢 | Automerge handles arbitrary offline duration; merge cost is O(ops missed) |

---

## 11. Open questions (deferred)

| Question | Defer until |
|---|---|
| Should `mesh.history` be append-only or windowed (last 30 days)? | P4.7 implementation |
| Should we support "guest device" (read-only join) for shared demo flows? | v1.1 |
| Relay region selection: single CF Worker globally, or geo-routed? | P4.8 — start global |
| Federation between users' meshes (e.g., share a single keycap)? | v2 product call (likely 不做) |
| WebRTC mediasoup-style SFU for many-to-many streams? | v2 — current N-N is fine for <5 devices |
| Hardware peer (AI glasses) — full mesh node or "thin publisher"? | hardware-strategy spec update post-v1 |

---

## 12. Success criteria

ADR-003 v1.0 must achieve:

- ✅ Two devices on different networks pair via QR in < 30 seconds end-to-end
- ✅ P2P upgrade succeeds for 80%+ NAT combinations (matches WebRTC field rate)
- ✅ Relay fallback transparent (no user-visible difference besides latency badge in Settings)
- ✅ Offline device makes 10+ changes; on reconnect, mesh converges in < 5 seconds
- ✅ Stolen-device revocation completes in < 60s; revoked device cannot decrypt subsequent traffic
- ✅ Total PWA bundle ≤ 500 KB gzip (revised from 300 KB)
- ✅ Total kernel binary contribution from mesh ≤ 3 MB (per ADR-002 §16 ≤ 15 MB total)
- ✅ Relay CF Worker handles 1000 concurrent signaling sessions on free tier

If any fail measurably, ADR-003 returns to review before v1.0 ship.

---

## 13. What remains explicitly out of scope for ADR-003

- WASM keycap mesh participation (P7 keycaps run sandboxed; mesh is shell-only)
- Per-keycap data scoping in CRDT (single user, single mesh, no per-keycap isolation)
- Cross-user content sharing (creator economy uses `ctrl-market`, not mesh)
- Server-side processing of mesh content (relay is dumb pipe)
- Audio/video streaming (ST-SS sends semantic cells; raw media is out of scope)

---

## 14. Acceptance

**Status: Accepted by bao on 2026-05-14 (choice "A" — full mesh, mobile lane in v1.0).**

Acceptance scope:
- All 14 sections lock as written, with 4 amendments applied in-place during accept (encryption wording §1/§3.1, WebRTC version pin §1/§3.1/§10, no-Megolm clarification §1/§3.1/§6.1, layer naming "Sync" globally).
- Library locks confirmed: webrtc-rs v0.17.x / vodozemac (Olm 1:1) / automerge v0.7.x / mdns-sd v1.71+ (Sprint 1 evidence in H-2026-05-14-001 Discussion).
- Bundle / size budgets revised (cross-referenced into ADR-002 amend):
  - PWA bundle: ADR-002 §5 raised from 300 → 500 KB gzip
  - Desktop installer: ADR-002 §16 unchanged at 25 MB (mesh fits in +3 MB headroom)
  - Slim installer: ADR-002 §16 raised from 15 → 18 MB (mesh-included slim); a separate "no-mesh slim" path is NOT supported in v1.0 (mesh is core differentiator per §1)
  - Cold-launch latency: ADR-002 §13 SC #1 raised from 80 → 100 ms; lazy-load mesh path keeps first-tap at 80 ms with first cross-device action incurring +200 ms initial mesh setup (acceptable per §12)
- Phase plan revised (added to ADR-002 §10): P4.5 (mesh-core), P4.6 (mesh-transport), P4.7 (mesh-sync), P4.8 (ctrl-relay worker), all v1.0 mandatory. P4.9 (mesh-extras: mDNS + history/clipboard docs) stays v1.1.

Implementation lanes:
- **Foundation (zeus, 2026-05-14)**: ADR amendments + ctrl-strategy + CLAUDE updates + packages/ctrl-mesh skeleton + Cargo deps + 4 new OpKind variants. Lands on a new branch `feat/h-001-mesh-baseline` from main.
- **Sprint 2+ (athena, 2026-05-14 onward)**: implementation per H-2026-05-14-001. Worktree at `D:/code-space/ctrl-h003-mesh` (currently empty after Sprint 1 evidence captured in handoff Discussion). Athena resumes once foundation lands.
- Sprint 1 evidence (background subagent transcript) preserved in H-2026-05-14-001 Discussion section; do not redo library evaluation.
