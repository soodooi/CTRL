---
id: H-2026-05-17-001
title: Memory Stack Spike — Postgres + pgvector + Mem0 + MCP on 2GB Lightsail
status: closed
opened: 2026-05-17
closed: 2026-05-17
owner: zeus
parent_adr: pending ADR-015
---

# H-2026-05-17-001: Memory Stack Spike

## Goal
Validate "Postgres + pgvector + Mem0 + olym-style auto-MCP" on existing 2 GB Lightsail (Tokyo) before locking ADR-015.

## Setup
- AWS Lightsail Tokyo, 2 vCPU / 1.9 GB RAM / 58 GB SSD
- Postgres 17.10 + pgvector 0.8.2 + pg_trgm + HNSW index
- DB: `ctrl`; tenants: alice / bob / carol
- MCP server: Hono + Drizzle (TS, hand-written 100 LOC, replaces unpublished `@manidala/olym-core` for spike)
- Embedder: fastembed BGE-small-en-v1.5 (384 dim, 30 MB model)
- Real data: 64 markdown files (~900 KB) from CTRL `doc/` + `.olym/` + `.claude/ADR/`

## Results

### Latency (measured on server)

| Operation | Time |
|---|---|
| Seed insert (64 rows) | 200 ms |
| trgm lexical search | 1-2 ms (SQL) / 10 ms (HTTP roundtrip) |
| Embed query (BGE-small CPU) | 9-14 ms |
| pgvector HNSW search | 2-7 ms |
| Full semantic query | ~15 ms |

### Multi-tenant isolation
- alice list → 24 rows; bob → 22; carol → 21 (correct)
- bob `get(alice_id)` → null ✅
- Each search/list filters by `tenant_id` at SQL layer

### Recall quality (top-1 spot-checks)
- "creator marketplace revenue" → Creator Economy spec
- "how does cross-device sync work" → ST-SS Protocol spec
- "如何 部署 服务器 AWS" → 部署相关文档 (cross-lingual works on BGE)

### RAM (live processes, after model loaded)

| Process | RSS |
|---|---|
| Postgres (3 workers) | ~130 MB |
| MCP server (node + tsx) | ~150 MB |
| Mem0 wrapper (Python, loaded) | ~117 MB |
| Embedder worker (Python, fastembed常驻 estimate) | ~200 MB |
| Caddy + fail2ban + OS | ~250 MB |
| Hermes (if working, estimate) | ~200-300 MB |
| **Predicted full load** | **~1.0-1.1 GB / 1.9 GB** |

→ headroom ~800 MB, **2 GB 在 Phase 0 充足**.

### Storage
- Base install (PG + Node + Python + Hermes venv + Mem0): 6.1 GB / 58 GB
- User data rough estimate: 50-100 MB/user/year (含 embedding)
- 58 GB 容量 ≈ 500-1000 用户-年

## Issues uncovered

| Issue | Severity | Owner |
|---|---|---|
| `@manidala/olym-core` not on public npm | Low | (workaround: rsync source from CTRL/packages/) |
| Hermes 0.13 `dashboard` mode needs web_dist (npm build required) | Med | Athena |
| Hermes 0.13 `mcp serve` mode missing `mcp_serve` module | Med | Athena (Hermes 上游问题) |
| Hermes 0.13 `acp` mode missing `acp` module | Med | Athena |
| Mem0 `/mem/add` returns 500 without embedder config | Low | Athena (配 OpenAI 或 local embedder) |
| body trgm 索引最初漏建 | resolved | zeus 已补 |
| node + tsx wrapper RAM 偏高 (200MB) | Low | 编译后用 plain node 可降一半 |

## Conclusions

1. **Architecture works** — Postgres + pgvector + Drizzle + Hono MCP 完整链路通
2. **2 GB Lightsail 够 Phase 0** — 全栈 RAM ~1 GB，足够余量
3. **Multi-tenant via tenant_id 列 + SQL filter** — 简单可靠，无需 RLS（Phase 0）
4. **Semantic search 端到端 15 ms** — 用户感知 = 实时
5. **Hermes daemon 模式现版（0.13.0）多处 bug** — Athena 接手调试
6. **olym-core 用 npm 发布前** — 项目内部用 file:// 或 git URL 引用

## Next

- ADR-010 (keycap execution model) — by zeus, ~30 min
- ADR-015 (cloud memory stack + multi-tenant) — by zeus, ~45 min
- Hermes 跑通选模式 — by athena
- Mem0 embedder 接 fastembed (复用 spike 装好的) — by athena

## bao approval

Verbal-go 2026-05-17（多次 confirm "继续"）: spike 跑通即可，2GB 暂不升级，结果转 Athena。

## Server state (留给后续使用)

- 仍跑：Postgres、MCP server `:9000`、Mem0 wrapper `:9100`、Caddy `:443/:80`
- HTTPS：hermes.ctrlapplab.com（Let's Encrypt 已签）
- DB credentials：见 `/etc/hermes/.env`（hermes ssh 后看）
- 知识库 seed data：64 行已嵌入 + HNSW 索引
