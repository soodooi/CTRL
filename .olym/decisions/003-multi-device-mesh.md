---
adr_id: 003
title: Mesh cross-device communication with E2E crypto + CRDT
status: accepted
date: 2026-05-14
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/002-pwa-pivot.md
  - .olym/decisions/007-encryption-library.md
scope: framework
supersedes: []
superseded_by: []
---

## Context

Users will own 2-3 CTRL devices (mac + win + iPhone PWA). Need state sync for keycap layout, settings, history, "share to my phone" flow. CN environment is hostile to central app servers (data localization + cost + audit). Mesh with relay-as-pipe gives E2E privacy + works behind NAT + CN-friendly (`*.workers.dev` mostly accessible). Iris-V backend research validated vodozemac (Matrix's Olm) as the Rust crypto baseline.

## Decision

Cross-device communication is a mesh of user-owned devices with E2E encryption + CRDT state, NOT a central CTRL server. Stack: **vodozemac (Olm 1:1 sessions)** + **webrtc-rs v0.17.x** (data channel) + **Automerge v0.7.x** (CRDT) + **mdns-sd v1.71+** (LAN discovery) + **ctrl-relay CF Worker** (outbound WSS-only for NAT traversal — never holds plaintext). PWA gets WASM builds of vodozemac + Automerge. Zero listening ports for cross-device; intra-device PWA uses 127.0.0.1:17872 WS bridge with token auth.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Central CTRL server holds all user state (Firebase / Supabase model) | Privacy regression; CN data localization risk; bandwidth bill on us; cannot offer E2E credibly |
| A2 | Bluetooth / wifi-direct only (no internet path) | Fails when devices on different networks; "share to my phone across the room" only works in LAN |
| A3 | WebRTC without app-layer crypto | Trusts WebRTC's DTLS only; no forward secrecy; can't claim Matrix-grade E2E |
| A4 | Yjs CRDT instead of Automerge | Yjs is JS-native; needs JS-on-Rust bridge for desktop; Automerge has clean Rust+WASM split |

## Consequences

**Positive**:
- Real E2E claim → enterprise / OPC trust; differentiation vs 豆包 / Coze (cloud-state business models)
- No central state on CTRL — bandwidth borne by user devices + CF free tier
- CN-friendly (`*.workers.dev`) — no domestic compliance / ICP filing required for relay
- Hardware peer-ready (future AI glasses / e-ink reader same mesh contract)

**Negative / cost**:
- Implementation complexity — WebRTC + Olm + Automerge each have learning curves
- Cross-platform WASM testing burden
- mdns iOS restrictions add discovery edge cases
- Binary footprint up (kernel ≤ 18 MB, installer ≤ 25 MB default — see §binary table)

**Reversal cost**:
- Expensive — ~2 months if mesh proves unship-able (WebRTC NAT failure rate too high, or relay Worker bandwidth uneconomic). Fallback = optional sign-in to user-owned cloud (Tokyo / R2) — still E2E but loses peer-to-peer. Replacing vodozemac → libsignal-wasm = ~2 weeks (see ADR-007).

## Acceptance

- [ ] `packages/ctrl-mesh/` has vodozemac dep wired (no libsignal-* present)
- [ ] PWA bundle imports vodozemac-wasm via wasm-bindgen
- [ ] webrtc-rs v0.17.x data channel exchange E2E-encrypted via Olm session
- [ ] Automerge v0.7.x CRDT document model implemented for shared state (keycap layout / settings)
- [ ] mdns-sd LAN pairing flow + ctrl-relay CF Worker NAT traversal fallback both pass smoke
- [ ] iOS PWA pairing flow tested with Web Push notify on incoming
- [ ] Zero listening ports for cross-device (only 127.0.0.1:17872 intra-device with token)

## Changelog

| Date | Change |
|---|---|
| 2026-05-14 | Initial accept (bao); kernel ≤ 18 MB / installer ≤ 25 MB baseline revised |
| 2026-05-16 | ADR-007 proposed to resolve §3.1 vs §7 crypto library conflict (vodozemac confirmed) |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format |
