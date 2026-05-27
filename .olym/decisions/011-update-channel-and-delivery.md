---
adr_id: 011
title: Tauri 2 updater + three-mirror channel for global + CN delivery
status: accepted
date: 2026-05-17
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/002-pwa-pivot.md
  - src-tauri/tauri.conf.json
scope: framework
module: cap
supersedes: []
superseded_by: []
---

## Context

CTRL v1 is about to ship to multi-machine testers and then publicly. Users need automatic updates **reachable from China**. `tauri-plugin-updater` dep is already in `src-tauri/Cargo.toml` but `lib.rs:289` explicitly deferred to P8 because (a) no production signing key exists, (b) no update manifest host exists. ByteDance monetized Doubao 2026-05-04 (¥68 / 200 / 500 tiers) — CTRL must ship promptly to capture window; update pipeline cannot block.

## Decision

Self-update = **Tauri 2 native updater** + **three-mirror endpoint array (ordered fallback)** + **three channels (stable / beta / dev)** + **per-user install** (no UAC) + **signing key in macOS keychain**. Mirrors in priority order: Tokyo Caddy (`updates.ctrlapplab.com`) → CF Worker + R2 (`ctrl-updates.workers.dev`) → GitHub Releases. Channel switching via `~/.ctrl/state/update-channel` file (PWA Settings exposes toggle); URL embeds channel segment. Signing private key has mandatory redundant backup (1Password vault + age-encrypted disk).

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | GitHub Releases only (single mirror) | GFW intermittently blocks binary download; no custom routing → unship-able to CN OPC users |
| A2 | CF Workers + R2 only | `*.workers.dev` mostly OK in CN but operator-blocked at edge; custom CF Pages domain unstable in CN historically; R2 egress cost rises with volume |
| A3 | Domestic cloud only (Aliyun OSS / Qiniu) | Global users see worse speed; ICP filing risk; adds CN compliance / content-review surface |
| A4 | Self-host BitTorrent | Corporate / school networks block BT; UX collapses; signature still needs central manifest |

## Consequences

**Positive**:
- Day-1 global + CN coverage
- No single supplier dependency (three different infra providers, different jurisdictions)
- Multi-channel enables solo testing across stable / beta / dev without rebuild
- Native Tauri 2 plugin → zero custom client code
- Signing key in keychain matches existing secret pattern (Volc / CF / Minimax / Tauri-sign all uniform)

**Negative / cost**:
- Signing private key loss = forever locked out of pushing updates → mandatory redundant backup
- Three-mirror manifest sync needs CI automation (`scripts/release.sh` to build → sign → push to all 3)
- Win OV code-signing cert ~$200-400/yr required to avoid SmartScreen friction (budget pending bao approval)
- CF Worker bandwidth quota for large binaries (mitigated by R2 direct streaming)

**Reversal cost**:
- Cheap — ~3 days to swap to single-mirror if multi-mirror proves operationally over-complex. No code change in app — only release pipeline reverts. Signing key + binary format choices ride forward independently.

## Acceptance

- [ ] `tauri signer generate` run; private key in macOS keychain `app.ctrl.spike` / `tauri-sign`; public key in `src-tauri/tauri.conf.json` `plugins.updater.pubkey`
- [ ] DNS A record `updates.ctrlapplab.com` → 52.196.27.37 (use CF API token already in keychain)
- [ ] Tokyo Caddyfile route `/updates/{channel}/{target}/{version}/{json,zip}` with auto-TLS
- [ ] CF Worker + R2 bucket with same route shape (failover mirror)
- [ ] `scripts/release.sh` one-shot: build → sign → push to all 3 mirrors
- [ ] Win OV code-signing cert procured + CI signing integrated (bao budget gate)
- [ ] Cross-3-machine smoke (2 mac + 1 win) hitting each channel
- [ ] CN-network P95 update < 30s real-world test

## Changelog

| Date | Change |
|---|---|
| 2026-05-17 | Initial proposed (zeus); awaiting bao Accept to unblock implementation gates |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format; implementation gates moved into Acceptance checklist (was separate "Implementation gates" section) |
| 2026-05-19 | **Accepted** (bao verbal-go + zeus). Was P0 超时 5/3d, v1 ship blocker — unblocked. |
