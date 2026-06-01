---
adr_id: 006
module: cross-cutting
title: CTRL cross-cutting — BYOK no-Claude in production + global English first + plain-text philosophy
version: 1
status: accepted
last_updated: 2026-05-31
deciders: [bao, zeus]
sections:
  - { id: byok-no-claude,  source: orig-005 }
  - { id: global-english,  source: orig-014 }
  - { id: plain-text,      source: orig-015 }
changelog:
  - v1 2026-05-31: module reorg — merged orig-005 (no Claude/Anthropic SDK in production runtime) + orig-014 (global English first) + orig-015 (plain-text / "Obsidian" philosophy).
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
| Keycap priority | Global creator+agent ecosystem reach (hermes-agent skills, MCP marketplace, Claude Code/Cursor MCP host adoption, agentskills.io) — NOT CN user count |
| Integration priority | Global = hermes / MCP marketplace / agentskills.io / GitHub / Linear / Notion. Lower = 飞书 / Coze / Doubao / 微信 / 钉钉 (CN-only, regional adapter packages, not core) |
| Anti-list | CTRL is NOT 中文 OPC 工具 — it is global ambient AI workbench. CN OAuth providers are regional adapters, not core |
| CN infra | Stays — ADR-004 §2 three-mirror channel (Tokyo / CF / GitHub) + BYOK posture for CN (CF Workers AI can be unreliable in CN). Global English first ≠ ignore CN; **positioning + priority global, infra still serves CN** |

Memory `decision_ctrl_is_global_english_first` 🔒 (2026-05-22).

## §3 Plain-text philosophy (formerly "Obsidian")

CTRL = user-augmentation, NOT knowledge intermediary. Memory `decision_ctrl_obsidian_philosophy` 🔒 (2026-05-22).

### 8 principles

1. **Local is truth, cloud is mirror, never reversed** — all reads hit local first; writes commit local synchronously then async push; cloud absent → graceful degrade.

2. **No CTRL account system** — user identity = keypair in macOS Keychain / Windows Credential Manager / Linux libsecret. `ctrl-cloud` backend does NOT know who any user is — billing tokens opaque receipts, sync uses E2E crypto (ADR-002 § crypto). No `users` table in any CF Worker D1; only identifier is user's public key.

3. **No proprietary binary formats** — all user content = plain text + structured frontmatter. Vault notes = markdown + YAML. Manifests = TOML/JSON (user-editable, git-diffable). Keycap state = JSON via `LocalStorage` SQLite. Event log = SQLite (public schema). NO binary blobs for user-facing content; only for caches that can be regenerated.

4. **No "export" feature** (because nothing was ever imported) — vault directory `~/Documents/CTRL/` IS the data. User uninstalls CTRL → all files remain. Third-party platforms (Feishu / Notion / Slack) = sync providers, not sources of truth; local wins every conflict.

5. **端侧化优先 (client-side first)**:
   - OAuth: macOS Keychain loopback callback (`http://127.0.0.1:NNN/callback`), NOT ctrl-cloud proxy
   - LLM: Volc Ark default + Ollama local fallback; cloud calls user-configured outbound only
   - Sync: P2P mesh (ADR-002 § crypto + WebRTC); `ctrl-relay` Worker = NAT-traversal helper, never reads payload
   - RAG / embeddings: local SQLite FTS5 + WASM embeddings, NOT vector DB SaaS
   - OCR: macOS Vision framework / Windows OCR API, NOT cloud OCR

6. **vim test (design gate)** — before merging any new capability: "Can the user open their local files in vim and get the core value CTRL provides?" If "no, our value requires our app running" → design fails, rework. Examples passing: vault read/write, keycap manifest, event log (sqlite, vim-readable via `:!sqlite3`). Examples failing: encrypted-only vault, binary keycap blobs, proprietary graph DB for notes.

7. **Vault layout is user-policy, not hardcoded** — CTRL provides default templates (flat / by-day / by-entity); user can swap. Keycap writes declare `path_glob` capability (ADR-004 §1); kernel does NOT enforce directory structure.

8. **Cloud (`ctrl-cloud`) scope locked** — allowed: billing settlement, marketplace listing, NAT-traversal relay, push-notification fanout. NOT allowed: user content storage, AI inference proxy (BYOK direct to provider), knowledge graph hosting.

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
- [x] Keycap priority list lives in this ADR + memory; standalone spec deferred per CLAUDE.md 灵活开发. Closed as deferred.

### Plain-text (§3)
- [x] CLAUDE.md "Design Philosophy" section references this ADR + spells out derived rules. Closed.
- [x] No proprietary binary user-content formats — keycap manifests JSON, vault plain markdown. Verified.
- [x] OAuth loopback (`commands/skills.rs:162` claude-oauth + `commands/system.rs:50` ST-SS bridge both loopback-only; no ctrl-cloud OAuth proxy). Verified.
- [x] vim-test reviewer gate is policy-active per-PR. Closed as policy.

## Provenance

- §1 ← orig-005 (No Claude/Anthropic SDK in CTRL production runtime, 2026-05-18, accepted)
- §2 ← orig-014 (CTRL = global English first, 2026-05-22, accepted)
- §3 ← orig-015 (Plain-text philosophy, formerly "Obsidian philosophy"; 2026-05-22, accepted; section renamed 2026-05-25)
