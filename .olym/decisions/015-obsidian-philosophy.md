---
adr_id: 015
title: Obsidian philosophy — CTRL is user-augmentation, not knowledge intermediary
status: accepted
date: 2026-05-22
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/003-multi-device-mesh.md
  - .olym/decisions/013-kernel-as-mcp-server.md
scope: framework
supersedes: []
superseded_by: []
---

## Context

Through 2026-05-22 bao钉死 CTRL 的设计灵魂 (memory `decision_ctrl_obsidian_philosophy`): **CTRL = 用户能力的延伸 (augmentation), 不是知识中介**. 数据本来就是用户的, 存为本地 markdown + YAML/TOML/JSON, 100 年后用 vim 还能读. CTRL 不私有 vault, 不要求用户开账号, 不引入 lock-in.

This is a cross-cutting design constraint — every new kernel capability, every keycap, every spec must be auditable against it. Without an ADR, the constraint lives only in MEMORY.md and risks drift when fleet members (especially new members) read the codebase without reading memories.

Reference: Obsidian (markdown-as-truth, vault is a directory, plain files), Logseq (similar), Roam Research's antithesis (proprietary graph DB; lock-in user complaints).

## Decision

CTRL data philosophy = **本地是 truth, 云是 mirror**. Concrete principles, applied to every new capability:

1. **Local is truth, cloud is mirror, never reversed**
   - All reads hit local first
   - Writes commit to local synchronously (user sees the change immediately), then async push to cloud mirror
   - Cloud absent / unreachable → kernel degrades gracefully, no hard fail
   - User pulls network cable → CTRL still fully functional

2. **No CTRL account system**
   - User identity = a keypair in macOS Keychain / Windows Credential Manager / Linux libsecret
   - CTRL team's backend (`ctrl-cloud`) does NOT know who any user is — billing tokens are opaque receipts, sync uses E2E crypto (ADR-007 vodozemac)
   - No `users` table in any CF Worker D1; the only identifier is the user's public key

3. **No proprietary binary formats**
   - All user content stored as plain text + structured frontmatter
   - Vault notes = markdown + YAML frontmatter (Obsidian-compatible)
   - Keycap manifests = TOML or JSON (user-editable, git-diffable)
   - Keycap state = JSON via `LocalStorage` SQLite (`sqlite3` inspectable)
   - Event log = SQLite (`event-store.db`) — public schema, public format
   - NO binary blobs for user-facing content; only for caches that can be regenerated

4. **No "export" feature (because nothing was ever imported)**
   - The vault directory `~/.ctrl/vault/` IS the data
   - The keycap directory `~/.ctrl/keycaps/` IS the install
   - User who uninstalls CTRL keeps all their files; copy the directory anywhere, it remains usable
   - Third-party platforms (Feishu / Notion / Slack) are **sync providers**, not sources of truth; local wins every conflict

5. **端侧化优先 (client-side first)**
   - OAuth: macOS Keychain loopback callback (`http://127.0.0.1:NNN/callback`), NOT via `ctrl-cloud` proxy
   - LLM: Volc Ark default + Ollama local fallback; cloud calls are user-configured outbound only
   - Sync: P2P mesh (WebRTC + vodozemac, ADR-003); `ctrl-relay` Worker is NAT-traversal helper only, never reads payload
   - RAG / embeddings: local SQLite FTS5 + WASM embeddings, NOT a vector DB SaaS
   - OCR: macOS Vision framework / Windows OCR API, NOT cloud OCR
   - Hermes: `pip install hermes-agent` lives on user's machine (`~/.ctrl/hermes-venv/`)

6. **vim test (design gate)**
   - Before merging any new capability, ask: "Can the user open their local files in vim and get the core value CTRL provides?"
   - If the answer is "no, our value requires our app running", the design fails the test; rework or reject
   - Examples that pass: vault read/write, keycap manifest (text file), event log (sqlite, vim-readable via `:!sqlite3`)
   - Examples that would fail: encrypted-only vault, binary keycap blobs, proprietary graph DB for notes

7. **Vault layout is user-policy, not hardcoded**
   - CTRL provides default policy templates (flat / by-day / by-entity), user can swap
   - Keycap writes declare `path_glob` capability for prefix-scoped vault access (ADR-010 capability gates); kernel does NOT enforce a directory structure
   - Detailed layout policy spec: `.olym/specs/vault-layout/spec.md` (follow-up)

8. **Cloud (`ctrl-cloud`) scope is locked**
   - Allowed: billing settlement, marketplace listing service, NAT-traversal relay, push-notification fanout
   - NOT allowed: user content storage, AI inference proxy (BYOK direct to provider), knowledge graph hosting

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Cloud-first (Notion / Roam pattern) | Lock-in, account dependency, monetization conflict with creator economy,违反 Obsidian 灵魂 |
| A2 | Local-default, cloud-optional (hybrid where many features need cloud) | Drifts toward cloud-first over time as features add "small cloud dependencies"; the only stable boundary is "no cloud dependency at all for core" |
| A3 | Hybrid storage formats (binary cache + markdown view) | The cache invariably becomes the truth; sync conflicts surface as "rebuild cache" instead of "merge markdown" |
| A4 | User-account-optional, anonymous-default | The optional account becomes mandatory for "premium features"; better to design no-account from day 1 |

## Consequences

**Positive**:
- User trust + retention (no lock-in fear)
- Compliance simplification (no PII on CTRL team's servers)
- "Just rename my vault directory" works on every platform — portability is free
- Obsidian / vim / git users are immediately at home (the vault IS git-versionable)
- v1 ship is faster because there's no auth/account infrastructure to build

**Negative / cost**:
- Onboarding friction: no email/password to recover; user lose keypair = lose paid subscription identity
- Per-device state — multi-device requires mesh (ADR-003) since there's no cloud-of-truth
- Marketing pitch is harder ("just trust local files" vs "AI in the cloud, sync everywhere"); apollo must lean on Obsidian/vim creator-trust framing

**Reversal cost**:
- Very high. Reversing means: build account system, migrate vault to cloud DB, introduce binary formats, write export/import tooling, audit privacy/compliance regime. Estimated 6+ months. Practically a v2 product.

## Acceptance

- [ ] CLAUDE.md "Design Philosophy" section already references this ADR — verify section is in sync (it currently spells out the 6 derived rules)
- [ ] Every new kernel capability PR includes a one-line vim-test response in the PR description
- [ ] No `users` table created in any `ctrl-cloud` D1 schema; billing identifies by public-key fingerprint
- [ ] No proprietary binary user-content formats land in v1 (caches are exempt as long as derivable)
- [ ] `ctrl-cloud` scope policed: each new Worker passes the "is this billing / marketplace / NAT / push" gate
- [ ] `.olym/specs/vault-layout/spec.md` exists with default policy templates (flat / by-day / by-entity)
- [ ] OAuth flows verified: every provider integration uses loopback callback, never goes through `ctrl-cloud`

## Counter-evidence (would invalidate this ADR)

1. User research shows >80% of target users actively WANT cloud-of-truth (similar to Google Docs / Notion crowd) — invalidates the Obsidian-style trust framing
2. Compliance regime (e.g. EU AI Act + similar CN regs) forces traceable provenance on AI-generated content — local-only audit log becomes a liability
3. Mesh (ADR-003) operational complexity proves untenable for non-technical users — forced retreat to cloud-of-truth on UX grounds

## Changelog

| Date | Change |
|---|---|
| 2026-05-22 | Initial accept (bao verbal-go 2026-05-22 session). Cross-cutting constraint applies to every subsequent kernel capability / keycap / spec; vim-test is the design gate. |

---

## 2026-05-25 amendment — reconcile with ADR-001 third 校准 (Pi-as-sole-brain)

This ADR predates 2026-05-25 brain-as-keycap reframing. Read in conjunction with:

- `.olym/decisions/001-system-architecture.md` 2026-05-25 amendments (first/second/third 校准 — authoritative)
- memory `decision_pi_is_sole_brain_hermes_is_keycap` — Pi is Irisy's sole brain; hermes is an optional personal-assistant keycap (target=brain, opt-in install via Pool), not the primary integration
- memory `decision_vmark_not_substrate_use_open_stack` — VMark is a compatibility commitment, not a substrate; CTRL uses the same open-source stack (Tiptap + CodeMirror 6 + mermaid.js + SQLite FTS5) directly

Where this ADR's body says "hermes" as the canonical brain / primary client / single integration point, **substitute "the active brain keycap (default = Pi, `@earendil-works/pi-coding-agent` lazy npm install; optional = hermes via `pip install hermes-agent` from Pool)"**. The substantive design (kernel-as-MCP-server / auto-update strategy / etc.) remains valid; only the brain identity / framing is updated.

Where this ADR uses "Obsidian philosophy" wording, the philosophy is unchanged but **the section is renamed "Plain-text philosophy"** (substance: local-is-truth, vim-readable markdown, no proprietary binary, no CTRL account, end-side OAuth/LLM/RAG/sync). The vim test remains the design gate.

Body not rewritten to keep diff small + preserve historical reasoning. This amendment header is the canonical pointer.
