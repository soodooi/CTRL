# Irisy ↔ Mem0 Direct Contract (v0.4 — routing locked)

**Date:** 2026-05-17
**Owner:** Athena (consumer)
**Counterpart:** Zeus / infra (Lightsail / Postgres+pgvector / Mem0 deployed; Hermes idle)
**Status:** v0.4 ACK by Bao 2026-05-17. Routing locked: public surface = `api.ctrlapplab.com/v1/memory/*`, Caddy reverse-proxies to Mem0 bare REST on internal `127.0.0.1:9100`. mcp:9000 is unrelated (Zeus's olym auto-MCP for decisions). v1.1 Janus will add a separate `/v1/keycap-mcp/*` MCP wrapper later.

---

## 1. What changed vs v0.2

| | v0.2 | **v0.3** |
|---|---|---|
| Memory hub | Hermes profiles + MEMORY.md + Mem0 plugin | **Mem0 direct, no Hermes layer** |
| Persona file | Hermes per-profile SOUL.md | Athena bundles in PWA (`packages/ctrl-web/src/personas/irisy/soul.ts`) |
| Multi-tenancy plumbing | Hermes profile → tenant_id via Mem0 plugin config | CTRL auth token → tenant_id derived server-side, applied to Postgres RLS |
| Conversation history | Hermes `sessions/` per profile | CTRL-owned (`irisy-history.ts` localStorage now → SQLite via Tauri plugin later) |
| Hermes server install | configured + running | **stopped (systemd disable), venv kept for v1.1 Janus** |

---

## 2. `@ctrl/memory` SDK (TypeScript, runs in PWA)

The single surface Irisy uses to talk to long-term memory. Other personas (Janus / Talos / Mnemosyne) will share it.

- `MemoryKind = 'user_fact' | 'skill_outcome' | 'coding_context' | 'open_thread'`.
- `MemoryRecord` = `{ text, kind, metadata? }` — metadata is kind-specific (see §3).
- `MemoryHit` = `{ id, text, score (semantic similarity 0-1), kind, metadata, created_at (ISO) }`.
- `MemoryFilter` = `{ kind?, since? (ISO), metadata? (key-equality match) }`.
- `MemoryClient` exposes `add(record)`, `search(query, { topK?, filter? }?)`, `get(id)`, `delete(id)`, `history(id)` (Mem0 history pass-through), `deleteAll()` (user-triggered wipe).

*(TS interface definitions elided. Implementation: `packages/ctrl-memory/src/index.ts`.)*

`tenant_id` is NEVER in the SDK — server derives it from the bearer token. SDK constructor takes `{ baseUrl, getAuthToken }`; nothing else.

---

## 3. Metadata conventions per kind (Athena's only schema)

| `kind` | required metadata | retention |
|---|---|---|
| `user_fact` | (none) | indefinite (user-deletable) |
| `skill_outcome` | `{skill_id: string, accepted: boolean, succeeded?: boolean, session_id: string}` | 180 days rolling |
| `coding_context` | `{session_id: string, device_id: string, source?: 'claude_code'\|'cursor'\|'codex'\|'gemini_cli'}` | 30 days rolling |
| `open_thread` | `{resolved: boolean}` (Irisy flips to true on close) | 30 days OR until `resolved=true` for 7 days |

Pruning is Athena's job — Irisy runs a tiny client-side sweep at session-open (oldest N first).

---

## 4. Wire format

REST over HTTPS at `https://api.ctrlapplab.com/v1/memory/*`. Caddy reverse-proxies to internal Mem0 OSS REST on `127.0.0.1:9100`. Six endpoints:

- `POST /v1/memory/records` — add a record
- `GET /v1/memory/records/:id` — fetch by id
- `DELETE /v1/memory/records/:id` — delete by id
- `POST /v1/memory/search` (body: `{ query, top_k, filter }`)
- `GET /v1/memory/records/:id/history`
- `DELETE /v1/memory` — wipe all (user-triggered)

The SDK's clean shape (§2) translates inside `@ctrl/memory` to Mem0's native request body (`messages: [...]`, `user_id`, `metadata`). PWA / Irisy code never sees Mem0's shape.

Bearer token in `Authorization: Bearer …`. **Auth-to-user_id middleware required** — see §5 Q1.

---

## 5. Open questions Athena → Zeus

1. ~~AUTH-TO-USER_ID MIDDLEWARE — blocker~~ **RESOLVED 2026-05-17.** Zeus extends existing ctrl-mcp (Hono on :9000) with `/v1/memory/*` handler: validates JWT → extracts `tenant_id` → rewrites body `user_id` → proxies to Mem0 :9100. No new process. Final routing:
   `PWA → Caddy /v1/memory/* → ctrl-mcp :9000 (auth+rewrite) → Mem0 :9100`
2. **Token issuer**: which service mints the bearer token Irisy presents? CTRL backend isn't built yet. For Athena local dev, can Zeus mint a long-lived dev token bound to a sandbox tenant?
3. **Tenant scoping inside Mem0**: confirm we plumb `tenant_id → Mem0 user_id` 1:1, so Postgres RLS + Mem0 namespacing both fire on the same key.
4. **Local dev**: `docker compose up` of Postgres+pgvector+Mem0 so Athena can iterate without round-tripping to Lightsail? If not, Lightsail with a `dev_<athena>` tenant prefix is acceptable.
5. **CORS**: Caddy needs to allow `http://127.0.0.1:5173` (dev) and the eventual PWA prod origin.

---

## 6. Not in scope for v1

- Hermes anything (re-evaluate when Janus v1.1 lands).
- Cross-device sync of conversation history (Mem0 handles long-term durable facts; conversation transcripts live local-per-device).
- Backup / DR for Mem0 / Postgres (infra).
- Personalized embedding fine-tuning.
- Multi-agent shared memory (Janus / Talos write into same store under their own `kind` — design when those personas ship).
