---
adr_id: 006
module: cross-cutting
title: CTRL cross-cutting — BYOK aggregator-first + global English first + plain-text philosophy + policy envelope
version: 3
status: accepted
last_updated: 2026-06-09
deciders: [bao, zeus]
sections:
  - { id: byok-aggregator,   source: orig-005 + H-2026-06-09-002 校准 }
  - { id: global-english,    source: orig-014 }
  - { id: plain-text,        source: orig-015 }
  - { id: policy-envelope,   source: new-2026-06-04, note: "L3/L4/L5 autonomy ladder + blast-radius limit + typed-ISA validation — invariants reused across all 6 self-evolution loops (ADR-001 §8)." }
changelog:
  - v1 2026-05-31: module reorg — merged orig-005 (no Claude/Anthropic SDK in production runtime) + orig-014 (global English first) + orig-015 (plain-text / "Obsidian" philosophy).
  - v2 2026-06-04: **NEW §4 policy-envelope** — single autonomy ladder (L3 suggest-only / L4 low-risk auto / L5 full auto) + blast-radius limit + typed-ISA validation, reused across the 6 self-evolution loops (ADR-001 §8). Source: UUMit L3-L5 (cap-design-v2 §14 #8) generalised cross-loop. Per bao "整个系统都要自我升级成长 ... 唯一真相, 要经常整理 ADR".
  - v3 2026-06-09: **§1 reframed BYOK no-Claude → BYOK aggregator-first** (H-2026-06-09-002). bao 校准: "我们卖工具+平台, 不卖模型" extended to multi-modal. Per ADR-002 v19 §13 (3-capability-face SSOT, API face = aggregator differentiator), CTRL ships **fal.ai BYOK adapter** as flagship aggregator (985 image/video/audio endpoints — FLUX 2, Seedream 5.0, Recraft V3, Nano Banana Pro, Kling 3.0, Veo 3.1, Hunyuan Video). Codex 锁单家 gpt-image-2; CTRL 接 fal.ai 拿 985 模型. The no-Anthropic-SDK-in-hot-path rule stays — but applies to ALL single-brand vendors equally (Anthropic / OpenAI / Tencent Yuanbao / xAI / Mistral). Aggregator endpoints (fal.ai, OpenRouter-like, LiteLLM-pattern) are exceptions: user BYOK to the aggregator key, CTRL loads aggregator SDK only on user activation. **No CTRL-bundled default model spend** — first-launch default = `none` (user picks fal.ai or Anthropic or OpenAI BYOK). Removes the implicit "CTRL CF Workers AI default" path that existed v1-v2 — bao memory `feedback_default_to_user_cli_not_paid_providers` (2026-05-31) already校准了 this for CLI; v19 extends to all API providers including CTRL-managed fallback.
related:
  - .olym/decisions/001-spine.md
  - .olym/decisions/002-substrate.md
---

## §1 BYOK — aggregator-first, no single-brand SDK in hot path (v3 2026-06-09)

CTRL production runtime **only** calls AI through user-configured provider (ADR-002 § provider). CTRL **does NOT ship a default model spend** — bao 2026-05-31 `feedback_default_to_user_cli_not_paid_providers` extended to all API providers in v3:

- **First-launch default** = `none`. User onboarding shows provider catalogue (fal.ai aggregator card highlighted) and asks user to pick / fill BYOK key.
- **fal.ai (NEW v3, flagship aggregator)** — single BYOK key unlocks 985 endpoints across image (FLUX 2 / Seedream / Recraft / Nano Banana Pro / etc., 406 total) / video (Kling 3.0 / Veo 3.1 / Hunyuan Video / etc., 450 total) / audio / 3D / speech. Adapter loads only when user fills fal.ai key in Settings → Providers. This is the v19 战术 differentiator vs Codex single-brand gpt-image-2 lock-in. Spec: ADR-002 §13.4.
- **Single-brand BYOK** = Anthropic / OpenAI / Hunyuan / DeepSeek / xAI / Mistral / etc. Each adapter loads only when user fills that brand's key. Settings → Providers lists 20 templates (ADR-002 §3.10 v10).
- **Local Ollama** = privacy tier; runs on user machine, 0 CTRL cost, 0 vendor key. Already wired (ADR-002 §10 embeddings).
- **Dev-time only** = `claude-code` / `aider` etc. as Code Space environment presets are NOT a violation — user choice, not CTRL-bundled.

**Rules**:
- ANY single-brand provider SDK (Anthropic / OpenAI / Tencent Yuanbao / xAI) MUST NOT load on the production hot path.
- They MAY load only when user has filled that vendor's key in Settings → Providers.
- **Aggregator adapters are exceptions** — fal.ai (image/video/audio aggregator), OpenRouter-pattern (LLM aggregator), LiteLLM-style proxy. These load on user BYOK to the aggregator endpoint, NOT on the upstream vendor key. The aggregator brokerage IS the value-add — same exemption logic as MCP server registry.
- CTRL never auto-fallbacks user requests to a CTRL-paid endpoint. The "irisy.fallback = CTRL volc" path (memory `decision_irisy_fallback_is_ctrl_paid_volc_now` 2026-05-31) IS RETIRED in v3 — no CTRL-paid fallback at all. User who picks no provider gets a clear "no provider configured" message + onboarding link.
- CN users open-box-usable via fal.ai aggregator (proxied via Cloudflare/Tokyo) + Volc BYOK option.

**Why aggregator-first**: 4 friend products (Claude Desktop / Codex / WorkBuddy / CodeBuddy) all brand-lock the API face — that's their billing model. CTRL doesn't sell brains; it sells the **stitching layer** (Ctrl hotkey + ambient workspace + 3-capability-face). Aggregator API face is the商业模式上 differentiator: 4 友商 商业模式上做不出来 (他们靠卖自家脑回本). Memory `feedback_no_claude_in_production` 🔒 + memory `decision_ctrl_repositioned_as_aggregator` (2026-06-03) 🔒.

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
