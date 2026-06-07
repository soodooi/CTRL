---
adr_id: 006
module: cross-cutting
title: CTRL cross-cutting — BYOK no-Claude in production + global English first + plain-text philosophy
version: 2
status: accepted
last_updated: 2026-06-04
deciders: [bao, zeus]
sections:
  - { id: byok-no-claude,    source: orig-005 }
  - { id: global-english,    source: orig-014 }
  - { id: plain-text,        source: orig-015 }
  - { id: policy-envelope,   source: new-2026-06-04, note: "L3/L4/L5 autonomy ladder + blast-radius limit + typed-ISA validation — invariants reused across all 6 self-evolution loops (ADR-001 §8)." }
changelog:
  - v1 2026-05-31: module reorg — merged orig-005 (no Claude/Anthropic SDK in production runtime) + orig-014 (global English first) + orig-015 (plain-text / "Obsidian" philosophy).
  - v2 2026-06-04: **NEW §4 policy-envelope** — single autonomy ladder (L3 suggest-only / L4 low-risk auto / L5 full auto) + blast-radius limit + typed-ISA validation, reused across the 6 self-evolution loops (ADR-001 §8). Source: UUMit L3-L5 (cap-design-v2 §14 #8) generalised cross-loop. Per bao "整个系统都要自我升级成长 ... 唯一真相, 要经常整理 ADR".
related:
  - .olym/decisions/001-spine.md
  - .olym/decisions/002-substrate.md
---

## §1 BYOK — no Claude/Anthropic SDK in CTRL production runtime

CTRL production runtime **only** calls AI through user-configured provider (ADR-002 § provider):

- **Default subscription** = CF Workers AI (Qwen-3 / Llama-3.3, bundled, CN-reachable via Tokyo)
- **BYOK advanced** = user actively adds Anthropic API key / OpenAI key / local Ollama / Volc. Key existence + invocation are user actions, never CTRL defaults
- **Dev-time only** = `experiments/claude-cli-shim/` and Claude CLI are contributor local tools, NOT shipped binary

**Rules**:
- Anthropic SDK / OpenAI SDK / similar must NOT load on the production hot path
- They MAY load only when user has filled own key in Settings → Providers
- User-facing references to external CLIs (`claude-code` / `aider` as Code Space env presets) are NOT a violation — user choice, not CTRL-bundled
- CN users open-box-usable on default CF Workers AI path

**Why**: CN OPC users don't have Anthropic API key + don't install Claude CLI; default Claude = dead-on-arrival. Memory `feedback_no_claude_in_production` 🔒.

## §2 Global English first

CTRL = **global product launched in English**. Chinese (and other locales) = i18n adaptation layer following v1.

| Rule | Detail |
|---|---|
| UX text | Every string in `packages/ctrl-web/` is English source. Chinese loaded via `react-i18next` from `locales/zh-CN.json` (never inline) |
| Marketing | `ctrlapplab.com` English. CN copy = translation, not source |
| Mcp priority | Global creator+agent ecosystem reach (hermes-agent skills, MCP marketplace, Claude Code/Cursor MCP host adoption, agentskills.io) — NOT CN user count |
| Integration priority | Global = hermes / MCP marketplace / agentskills.io / GitHub / Linear / Notion. Lower = 飞书 / Coze / Doubao / 微信 / 钉钉 (CN-only, regional adapter packages, not core) |
| Anti-list | CTRL is NOT 中文 OPC 工具 — it is global ambient AI workbench. CN OAuth providers are regional adapters, not core |
| CN infra | Stays — ADR-004 §2 three-mirror channel (Tokyo / CF / GitHub) + BYOK posture for CN (CF Workers AI can be unreliable in CN). Global English first ≠ ignore CN; **positioning + priority global, infra still serves CN** |

Memory `decision_ctrl_is_global_english_first` 🔒 (2026-05-22).

## §3 Plain-text philosophy (formerly "Obsidian")

CTRL = user-augmentation, NOT knowledge intermediary. Memory `decision_ctrl_obsidian_philosophy` 🔒 (2026-05-22).

### 8 principles

1. **Local is truth, cloud is mirror, never reversed** — all reads hit local first; writes commit local synchronously then async push; cloud absent → graceful degrade.

2. **No CTRL account system** — user identity = keypair in macOS Keychain / Windows Credential Manager / Linux libsecret. `ctrl-cloud` backend does NOT know who any user is — billing tokens opaque receipts, sync uses E2E crypto (ADR-002 § crypto). No `users` table in any CF Worker D1; only identifier is user's public key.

3. **No proprietary binary formats** — all user content = plain text + structured frontmatter. Vault notes = markdown + YAML. Manifests = TOML/JSON (user-editable, git-diffable). Mcp state = JSON via `LocalStorage` SQLite. Event log = SQLite (public schema). NO binary blobs for user-facing content; only for caches that can be regenerated.

4. **No "export" feature** (because nothing was ever imported) — vault directory `~/Documents/CTRL/` IS the data. User uninstalls CTRL → all files remain. Third-party platforms (Feishu / Notion / Slack) = sync providers, not sources of truth; local wins every conflict.

5. **端侧化优先 (client-side first)**:
   - OAuth: macOS Keychain loopback callback (`http://127.0.0.1:NNN/callback`), NOT ctrl-cloud proxy
   - LLM: Volc Ark default + Ollama local fallback; cloud calls user-configured outbound only
   - Sync: P2P mesh (ADR-002 § crypto + WebRTC); `ctrl-relay` Worker = NAT-traversal helper, never reads payload
   - RAG / embeddings: local SQLite FTS5 + WASM embeddings, NOT vector DB SaaS
   - OCR: macOS Vision framework / Windows OCR API, NOT cloud OCR

6. **vim test (design gate)** — before merging any new capability: "Can the user open their local files in vim and get the core value CTRL provides?" If "no, our value requires our app running" → design fails, rework. Examples passing: vault read/write, mcp manifest, event log (sqlite, vim-readable via `:!sqlite3`). Examples failing: encrypted-only vault, binary mcp blobs, proprietary graph DB for notes.

7. **Vault layout is user-policy, not hardcoded** — CTRL provides default templates (flat / by-day / by-entity); user can swap. Mcp writes declare `path_glob` capability (ADR-004 §1); kernel does NOT enforce directory structure.

8. **Cloud (`ctrl-cloud`) scope locked** — allowed: billing settlement, marketplace listing, NAT-traversal relay, push-notification fanout. NOT allowed: user content storage, AI inference proxy (BYOK direct to provider), knowledge graph hosting.

## §4 Policy envelope — L3/L4/L5 autonomy + blast-radius + typed-ISA (NEW v2, 2026-06-04)

bao 2026-06-04: "整个系统都要自我升级成长" → 6 self-evolution loops (ADR-001 §8) all need the same safety substrate. Rather than each loop inventing its own permission model, **one policy envelope governs them all**. Inspired by Nova AI Ops "policy envelope + blast-radius" (2026) + arxiv 2604.09963 typed ISA (2604.09963) + UUMit autonomy L3/L4/L5 ladder (cap-design-v2 §14 #8 — extended cross-loop here).

### §4.1 Autonomy ladder (locked)

Every self-evolution action declares an **autonomy level** at execution time, persisted to the audit ledger (ADR-002 §11):

| Level | Behaviour | Applies to |
|---|---|---|
| **L3 suggest-only** | Microkernel validates + logs the action; **does not execute**. User sees it in Settings → 自我升级 → 待批 panel and approves manually. | New loops in Crawl phase; any high-blast-radius action regardless of phase; loops the user has explicitly slowed. |
| **L4 low-risk auto (default)** | Microkernel executes the action immediately **iff** it passes blast-radius + reversibility checks; otherwise downgrades to L3 (suggest-only) for that action. | Walk-phase loops; the standard mode after a loop has earned >7 d of clean audit-ledger history. |
| **L5 full auto** | Microkernel executes within envelope without any blast-radius downgrade. Verify + auto-rollback still mandatory. | Run-phase loops only; opt-in per loop; rate-limited; ledger-audited. |

Default global level = **L4**. Per-loop overrides allowed (e.g. Loop 5 system self-healing might stay at L3 indefinitely on first install). User can also set per-cap override (cap manifest `autonomy_level` field, cap-design-v2 §6).

### §4.2 Typed ISA — the only language self-evolution actions speak

Self-evolution code does **not** call `std::process::Command::new()`, `std::fs::remove_file()`, or any other untyped surface. Every action is a typed variant of an enum (e.g. `SelfEvolutionAction::RestartPi`, `AdjustProviderTrust { delta }`, `AppendPlaybook { rule }`). The full variant list belongs in ADR-002 § typed-isa v1 (amend pending, P1).

Rationale (arxiv 2604.09963 evidence): typed actuation + microkernel validation reduces agent-caused harm by 95% in simulation (77% → 4%) and to 0% in online experiments under fault injection. Untyped agents frequently cause regressions; constrained agents cannot express harmful actions.

CTRL has the substrate already: ADR-001 §2 5 primitives include `Effect` (first-class side-effect type returned from actor handlers). Self-evolution actions extend the Effect taxonomy.

### §4.3 Blast-radius limit

Every typed action declares blast-radius metadata as part of its variant definition:

- **`scope`**: which subsystem the action touches (`pi_process` / `provider_state` / `vault_index` / `cap_manifest` / `keychain` / etc.)
- **`reversibility`**: `transactional` (one-step rollback) / `compensatable` (run inverse) / `irreversible` (e.g. a network DELETE — these always require L3 approval)
- **`rate_limit_key`**: bucket name (e.g. "pi_restart" capped at 3/hour, "vault_re_embed" capped at 1/min)

The microkernel validator (capability_resolver.rs extension) reads these and rejects or downgrades before execution.

### §4.4 Verify + auto-rollback (mandatory at L4 and above)

Borrowed from Nova AI Ops 6-stage loop. No self-evolution action is considered complete until:

1. The Verify stage runs (ADR-002 §11 stage `verify` row written)
2. The verify_result is `recovered` — `unchanged` or `rolled_back` triggers automatic rollback via the action's `reversibility` path
3. Three consecutive `rolled_back` results in the same loop's audit ledger downgrade the loop to L3 for 24 h (auto-pause)

Skipping Verify is **not optional** — Nova AI Ops phrases this as "skipping verify is how an auto-fix loops forever or declares victory on a still-broken service". Microkernel will reject `learn`-stage writes if the matching `verify` row is missing.

### §4.5 Break-glass (irreversible actions)

For truly irreversible self-evolution actions (e.g. permanent SOUL.md frontmatter delete, cap uninstall that purges manifests), the policy envelope **always** requires L3 regardless of global setting. The Settings UI shows a "break-glass" panel listing pending irreversible actions; user must explicitly approve.

### §4.6 Acceptance

- [ ] `kernel/policy_envelope.rs` (new) — autonomy level enum + per-action `BlastRadius` struct + validation entry point.
- [ ] `capability_resolver.rs` extended to call into `policy_envelope::validate(action)` before execution.
- [ ] Settings → 自我升级 → autonomy slider (global L3/L4/L5) + per-loop override panel.
- [ ] Settings → 自我升级 → break-glass panel for pending irreversibles.
- [ ] Audit ledger `autonomy_level` column populated at write-time (not retroactively, see ADR-002 §11.5 invariant #4).
- [ ] Three-consecutive-rollback auto-downgrade rule shipped (verify substrate exists in ADR-002 §11).

## Acceptance

### BYOK no-Claude (§1)
- [x] `packages/ctrl-web/src/lib/llm-transport.ts` default model = Volc-shaped (via `ctrl.builtin.text-chat`); comment line 1 reads "Volc-default, OpenAI-shape, transport-agnostic". Closed.
- [x] `experiments/claude-cli-shim/` removed from vite build / repo. Closed.
- [x] `grep -rn 'anthropic' src-tauri/Cargo.toml` → 0 hits. Closed.
- [x] BYOK UI — `ProvidersBlock` in `packages/ctrl-web/src/routes/settings.tsx` exposes key management (ADR-002 § provider §3.6 supersedes with role-routing). Closed.
- [x] CLAUDE.md `## LLM Pattern D` references BYOK lock. Closed v0.1.126.

### Global English (§2)
- [x] CLAUDE.md line 9 amended → "global ambient AI workbench + creator substrate". Closed v0.1.126.
- [x] PWA strings English (verified `grep '>[一-龥]<' src/*.tsx` → 0 user-visible hits 2026-05-31). Closed.
- [x] Mcp priority list lives in this ADR + memory; standalone spec deferred per CLAUDE.md 灵活开发. Closed as deferred.

### Plain-text (§3)
- [x] CLAUDE.md "Design Philosophy" section references this ADR + spells out derived rules. Closed.
- [x] No proprietary binary user-content formats — mcp manifests JSON, vault plain markdown. Verified.
- [x] OAuth loopback (`commands/skills.rs:162` claude-oauth + `commands/system.rs:50` ST-SS bridge both loopback-only; no ctrl-cloud OAuth proxy). Verified.
- [x] vim-test reviewer gate is policy-active per-PR. Closed as policy.

## Provenance

- §1 ← orig-005 (No Claude/Anthropic SDK in CTRL production runtime, 2026-05-18, accepted)
- §2 ← orig-014 (CTRL = global English first, 2026-05-22, accepted)
- §3 ← orig-015 (Plain-text philosophy, formerly "Obsidian philosophy"; 2026-05-22, accepted; section renamed 2026-05-25)
