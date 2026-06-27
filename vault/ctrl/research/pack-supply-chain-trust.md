# Feature-Pack Supply-Chain Trust Model — research + recommendation

> 2026-06-26. Backs ADR-004 cap §6.1 v3. Question (bao delegated: "你调研一下 哪个好"):
> what supply-chain integrity/trust model fits CTRL's feature-pack library —
> **no account, local-first, multi-source, `.mcpb` zip, plain-text**.

## TL;DR

**Adopt minisign/signify-style detached Ed25519 signature + TOFU key-pinning + mandatory
sha256 hash-pin + default-deny install gate.** NOT Sigstore keyless (needs an OIDC
account), NOT full TUF (needs an online metadata pipeline per source), NOT the
manifest-embedded self-signed key the old ADR had (the **key-swap anti-pattern**). Borrow
TUF's *ideas* (per-source root, forward-chained key rotation, threshold for high-value
packs) without running TUF's servers.

The single most important fix is structural, not cryptographic: **the verification key
must never live inside the bundle it verifies.** Old ADR ("manifest carries
`signing.pubkey`") = textbook key-swap (attacker re-signs with their own key + replaces the
embedded pubkey, verification always passes). NIST CSWP code-signing
(https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.01262018.pdf); US Pat. 7,552,342.

## Q1 — mechanisms compared

| Mechanism | Defends | Does NOT | Central dependency |
|---|---|---|---|
| **Sigstore/cosign keyless** | long-lived key compromise (ephemeral key + transparency log) | detection-only, needs someone watching the log | **Yes — OIDC identity (= an account); self-host = heavy infra.** https://docs.sigstore.dev/about/security/ |
| **cosign static keys** | tamper after signing if pubkey pinned out-of-band | revocation/rollback/freeze | No — user-held key |
| **TUF** | key compromise <threshold, rollback, freeze, mix-and-match | not a signing scheme; needs live metadata pipeline | **Per-source root, not necessarily central.** https://theupdateframework.io/docs/security/ |
| **npm provenance / SLSA** | where/how built; post-CI tamper | "no guarantee the package has no malicious code"; no local builds | **Yes — central registry + cloud CI OIDC.** https://slsa.dev/spec/v1.0/threats |
| **Self-sign + TOFU** | continuity — every update after first install verified | the FIRST install | **No.** https://en.wikipedia.org/wiki/Trust_on_first_use |
| **Pure hash-pin (SRI)** | tamper after pin; bad mirror | no authorship/revocation/update story | No |
| **Registry signing root** | tamper vs "what registry received" | authorship; guarantee dies across mirrors/re-hosting/air-gap | **Yes — central root key.** https://peps.python.org/pep-0458/ |

Multi-source trust doesn't cross distribution boundaries: USENIX 2025 https://arxiv.org/html/2510.04964v1.

## Q2 — best fit for CTRL's constraints

Only **hash-pin** and **Ed25519 + TOFU** are natively account-free + multi-source. Hash-pin
alone = integrity, no authorship/revocation. **Ed25519 detached sig + TOFU pin** adds
authorship *continuity* with zero online infra once pinned (minisign/OpenBSD signify:
single algorithm, no CA, tiny pubkeys distributed out-of-band, tamper-proof trusted
comments — https://www.openbsd.org/papers/bsdcan-signify.html, https://github.com/jedisct1/minisign).
Strongest achievable: integrity (hash) + "same author as before" (TOFU Ed25519) + key
rotation by forward-chaining. Irreducible residual = the first-contact window (no scheme
removes it without central PKI); mitigate with wide out-of-band key dispersion + plain-text
fingerprints.

## Q3 — ecosystem precedents

- **Obsidian community plugins — near-exact mirror.** Local-first, third-party-dominant,
  *no enforceable sandbox* ("Obsidian cannot reliably restrict plugins"), one-time human PR
  review at index admission, code ships from author's GitHub, default-off **Restricted
  Mode**. https://obsidian.md/help/plugin-security
- **Homebrew — enforce-the-hash lesson.** sha256 pinned in formula + sandboxed builds +
  Sigstore attestation; the leak is casks (`sha256 :no_check`), Koi.ai Feb 2026 found 20
  casks over plain HTTP, MITM-able. → **never allow a `:no_check` escape.**
- **VS Code Marketplace:** MS signs every extension, but "verified publisher" = domain
  ownership, NOT code review (typosquat `automated1ogic` survived 16mo). Badge ≠ safety.
- **Raycast:** central monorepo PR review — reviewed = shipped (no author-hosted drift), but
  needs a central reviewer CTRL won't have.
- **npm — cautionary tail.** Every 2024-26 disaster = maintainer account takeover + auto
  propagation: chalk/debug clipper (Sep 2025, ~2.6B dl/wk,
  https://www.wiz.io/blog/widespread-npm-supply-chain-attack-breaking-down-impact-scope-across-debug-chalk),
  self-replicating Shai-Hulud worm (incl. `@ctrl/tinycolor`; CISA
  https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem).

**MCP-specific (critical):** `.mcpb` manifest spec (v0.3) has **no signature/integrity/hash
field** — unsigned zip, trust = download source
(https://github.com/anthropics/mcpb/blob/main/MANIFEST.md). MCP Registry is metadata-only,
verifies namespace identity (DNS/GitHub OIDC) but **signs no code, scans nothing**
(https://modelcontextprotocol.io/registry/about). Live MCP threats = **tool-poisoning** +
**rug-pull** (tool description changes after approval): Invariant Labs
https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks, Trail of
Bits https://blog.trailofbits.com/2025/04/21/jumping-the-line-how-mcp-servers-can-attack-you-before-you-ever-use-them/.
Their fix = **pin + hash the tool description** = CTRL-side work at `:17873`.

## Q4 — phased recommendation

**v1 (no registry):** (1) mandatory sha256 hash-pin in a git-diffable lockfile, no
`:no_check` escape; (2) detached Ed25519 sig over bundle hash, key NOT in `.mcpb`, pubkey
out-of-band in repo root; (3) TOFU key-pin in `~/Documents/CTRL/.trust/packs.toml` signed by
user's Keychain identity; (4) default-deny gate before pack code runs, approval screen shows
fingerprint + hash + full tool descriptions. **Revocation:** forward-chained key rotation
(`next_pubkey`); local kill via pin mismatch; opportunistic CTRL-signed `revoked-hashes`
denylist (only justified CTRL-held key — for CTRL's own artifacts).

**v1.1 (with registry):** registry namespace identity as a *second* signal (shrinks
first-contact window), NOT a replacement for CTRL's sig+hash; graduate first-party packs to
TUF-style threshold + offline root.

## Residual risks (state plainly to bao)

- First-install trust irreducible without central PKI — TOFU + dispersion mitigates, doesn't cure.
- TOFU does not stop a *legitimately-signed* malicious update → default-deny gate + no-sandbox honesty.
- No sandbox = full host access for any approved pack (true of Obsidian/VSCode/Homebrew too); signing = "who/what changed", not "what it can do" → pair with `:17873` gate + OS sandbox (ADR-004 §1 v3).
- MCP rug-pull → CTRL must re-hash tool descriptions each server start, diff vs approved pin (upstream gives nothing).
