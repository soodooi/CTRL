# Creator Economy — ctrl-market + Revenue Share

- **Status**: Draft v0.1
- **Date**: 2026-05-11
- **Parent**: `.olym/decisions/001-system-architecture.md` §6 layer 4 (market layer), §10 differentiation
- **Implementation**: P9 of phase plan

---

## 1. Purpose

ctrl-market is **the** strategic differentiator of CTRL. Without an active creator economy, CTRL = Raycast 中文版. With it, CTRL = AI-native creator OS.

This spec defines:
- Submission + review flow (creator → market)
- Discovery + install flow (user → market → keycap)
- Revenue share mechanics (install count / invoke count → creator wallet)
- Quality scoring + ranking
- Anti-abuse / content moderation

---

## 2. Market actors

| Role | Description |
|---|---|
| **Creator** | User who publishes manifests. Single-user-can-be-both consumer and creator. |
| **Consumer** | User who installs + uses keycaps. Subscribers default tier. |
| **Reviewer** | CTRL team + automated pipeline. AI moderation + manual eyeball for trending. |
| **Platform** | CTRL itself (us). Takes share of subscription pool. |

---

## 3. Pricing model

### 3.1 Subscriber tier (default, ¥800-1200/yr TBD)

Subscription includes:
- 15 built-in keycaps (P0 + P1)
- CF Workers AI quota (Qwen/Llama, ~500k tokens/day soft limit)
- Free access to all `pricing: free` and `pricing: subscription_only` market keycaps
- Per-invocation cost amortized into subscription
- BYOK Claude/OpenAI (user pays own API cost, no quota cap)

### 3.2 Creator-priced keycaps (Phase 2)

Creators MAY price their keycap (pricing field in manifest):

| Pricing | Mechanic |
|---|---|
| `free` | No charge, but creator earns nothing |
| `subscription_only` | Visible only to subscribers, creator earns from invoke share |
| `pay_per_install` | One-time fee at install (¥5-50 typical), creator gets 70% |
| `pay_per_invoke` | Per-call fee (¥0.1-1.0), creator gets 60% |

Platform takes 30-40% (covering Stripe fees + ctrl-cloud infra + LLM proxy cost).

### 3.3 Revenue share — subscriber pool model

For subscriber-included keycaps:
- Monthly pool = (subscription revenue) × (creator pool ratio, e.g., 25%)
- Pool distributed pro-rata to creators by: weighted_score = invocations × engagement_weight
- engagement_weight encourages high-quality use (longer sessions, returning users)

Spotify-style: low-quality / spammy keycaps cannibalize pool, real creators benefit.

---

## 4. Submission flow

```
Creator → AI 创作助手 generates manifest
        → Sandbox dry-run passes
        → Creator clicks "Publish to Market"
        ↓
ctrl-market API receives submission
        ↓
Stage 1: Schema validation (Zod + JSON Schema check)  ← auto, instant
        ↓
Stage 2: Capability sanity (declared vs source-type allowed)  ← auto
        ↓
Stage 3: Sandbox e2e (run with synthetic inputs)  ← auto, ~30s
        ↓
Stage 4: AI moderation (Claude reads manifest + flow)  ← auto, ~5s
        - Detect malicious intent (data exfil, ransom prompt)
        - Detect spam (manifest doesn't match name)
        - Detect duplicate (cosine similarity vs existing keycaps)
        ↓
Stage 5: Manual review (only if trending or AI flags)  ← human, async
        ↓
PUBLISHED — visible in market search/browse
```

Failure at any stage → rejection with structured error to creator. Creator can iterate.

---

## 5. Discovery flow

```
User in CTRL: Ctrl → Pool → "Market" tab
        ↓
Browse: Featured / Trending / By Category / Search
        ↓
Click keycap card → preview pane
        - Screenshots / demo GIF
        - Capability declaration (what it can do)  ← key trust signal
        - Creator info + reputation score
        - Reviews
        - Price (if any)
        ↓
"Install" → 
        - If capability includes sensitive (FsWrite, HttpPost) → confirm dialog
        - If OAuth source → kick off OAuth flow
        - If MCP source → install MCP server
        - Manifest persisted to local cache
        ↓
Keycap appears in user's pool
```

**Trust signal**: capability declaration always visible pre-install. User sees "this keycap reads clipboard + calls LLM" and decides.

---

## 6. Quality scoring

Each keycap has a composite score:

```
score = 
  0.30 * install_count_normalized +
  0.25 * return_rate (% of installers who use again after 7d) +
  0.20 * star_rating (1-5 stars from users) +
  0.15 * crash_rate_inverse (1 - crashes/invokes) +
  0.10 * creator_reputation
```

Ranking in search/browse uses score. New keycaps get a "new" badge + boost factor for first 7 days (fairness for newcomers).

---

## 7. Anti-abuse

| Risk | Mitigation |
|---|---|
| Spam / mass-publish | Per-creator daily submission limit (5 first day, +5 weekly) |
| Stealing other creator's keycap | Cosine similarity check + creator handle on every install |
| Pump-and-dump (fake installs) | Install must be followed by actual invoke within 7d to count |
| Capability escalation attack | Static manifest verification + sandbox runtime check |
| Phishing keycap (looks like official) | Reserved name prefixes for `ctrl-*` and `official-*` |
| Coordinated inauthentic behavior | Sock-puppet detection via install pattern clustering |

---

## 8. ctrl-market backend (CF Workers)

```
ctrl-market worker
├── /api/submit         POST manifest → enter review pipeline
├── /api/review/status  GET — creator polls own submissions
├── /api/discover       GET — featured / trending / by-tag
├── /api/search         GET — full-text + capability filter
├── /api/install/:id    POST — fetch manifest + record install
├── /api/invoke/log     POST — desktop reports invocation (rate limited)
├── /api/rating         POST — user rates installed keycap
└── /api/wallet/:user   GET — creator views earnings
```

D1 schema:

```sql
CREATE TABLE manifests (
    id            TEXT PRIMARY KEY,
    version       TEXT,
    creator_id    TEXT NOT NULL,
    spec_cbor     BLOB,
    status        TEXT,  -- 'pending' / 'published' / 'rejected' / 'deprecated'
    score         REAL,
    install_count INTEGER,
    invoke_count  INTEGER,
    created_at_ms INTEGER,
    updated_at_ms INTEGER
);

CREATE TABLE installs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id   TEXT,
    user_id       TEXT,
    installed_at  INTEGER,
    last_used_at  INTEGER,
    uninstalled_at INTEGER
);

CREATE TABLE invocations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id   TEXT,
    user_id       TEXT,
    invoked_at_ms INTEGER,
    duration_ms   INTEGER,
    success       BOOLEAN
);

CREATE TABLE creator_wallets (
    creator_id    TEXT PRIMARY KEY,
    balance_cents INTEGER,
    paid_total_cents INTEGER,
    last_payout_at INTEGER
);
```

---

## 9. Payout mechanics

- Threshold: ¥200 minimum to request payout
- Frequency: monthly batch via Stripe Connect / Alipay
- Tax: creator responsible (we issue 1099-equivalent doc)
- Currency: CNY for China, USD for international
- Anti-fraud: 30-day holdback (refunded invokes deducted)

---

## 10. Content policy (high level)

Reject keycaps that:
- Generate sexual / violent content as primary use
- Impersonate identifiable individuals
- Facilitate illegal action (per local jurisdiction)
- Contain hardcoded API keys / secrets / PII
- Mass-spam mode (auto-send messages without user consent)
- Crypto / financial advice keycaps (regulatory risk)

Detailed content policy at `/policy/content` post-launch.

---

## 11. Trust + transparency commitments

- All manifests are publicly readable (creators can not hide flow)
- Capability declarations are non-removable post-install
- Crash logs + invocation traces user-accessible (local event store)
- Creator score formula published
- No shadow ranking — all ranking factors documented

---

## 12. Phase plan

| Phase | Content |
|---|---|
| P8 | ctrl-auth + ctrl-billing (foundation for wallet) |
| **P9** | ctrl-market MVP — submit / review / install / rating |
| P9.5 | Revenue share v1 — subscriber pool distribution |
| P10 | Beta with 20-50 invited creators (dogfood + tune scoring) |
| Post-launch | Search + recommendation + cross-keycap workflows |

---

## 13. References

- `.olym/specs/tool-manifest/spec.md` — manifest schema validated here
- `.olym/specs/kernel/spec.md` §4 — sandbox model used in dry-run
- Apple App Store + Raycast Store + ChatGPT GPTs Store (research baseline)
