# Protocol / Deploy Protocol

> Stage 6 of olym engineering lifecycle (`.olym/specs/olym-engineering-lifecycle/spec.md`). 协议层包裹 `scripts/deploy/*.sh` 工具.
> Parent: [olympus-protocol.md](../olympus-protocol.md) · Sibling: [git.md](git.md) · [handoff.md](handoff.md)

---

## 1. 什么是 Deploy

把 commit `git push` 后, 把 worker / frontend / DB schema 推到 Cloudflare 生产 (workers.dev → <your-domain> route). 跟 git push 不同 — push 仅推 source, deploy 是真 effective change.

---

## 2. 5-Stage SOP

```
A. PRE-CHECK    5 hard gates, fail fast
B. STAGING      optional per worker, see §4 matrix
C. PRODUCTION   deploy-all-production.sh
D. SMOKE        deploy-smoke-test.sh + 业务级 (G-019 后续)
E. ANNOUNCE     handoff update + forward bao + EOD audit
```

任 stage fail → abort + rollback hint (last-known-good SHA, deploy script 自动 print).

---

## 3. Stage A — PRE-CHECK 5 硬 gate

| # | Gate | 命令 | Fail action |
|---|---|---|---|
| 1 | git tree clean | `git status` 空 | abort (hard) |
| 2 | on main + synced | `git symbolic-ref HEAD == main` + 0 ahead/behind | abort (hard) |
| 3 | audit-all green | `bash scripts/audit-all.sh --check` exit 0 | abort or zeus override (log reason) |
| 4 | no P0 dike pending | latest `.olym/audits/zeus-quality/<date>.md` no P0 unaddressed | abort or zeus override |
| 5 | preflight pass | `bash scripts/deploy/deploy-preflight.sh` exit 0 | abort (hard, binding broken) |

**Override**: zeus 可 override #3/#4 但必 log "override reason" 在 deploy commit message + 24h 内 retroactive fix. #1/#2/#5 不可 override.

**Lane owner trigger**: 不允许. lane owner deploy 走 handoff `## bao approval` 含 `deploy:prod <date>` trace, zeus 代 trigger.

---

## 4. Stage B — STAGING gate matrix

当前 staging = `*.workers.dev` (CF 默认子域, 国内可访问). 不是真隔离 staging (D1 仍共享 prod).

| Worker class | Staging required? | 理由 |
|---|---|---|
| New worker (first deploy) | ✅ 必经 | 验证 binding / route 配置 |
| Schema migration touched | ✅ 必经 | D1 migration 风险 |
| Auth / payment / config | ✅ 必经 | 安全 / 钱 |
| Frontend (Pages) | ⚠️ Preview 必经 | Cloudflare Pages 默认 preview URL |
| Routine business changes (admin / catalog / customer business logic) | ❌ 直 prod | bao 节奏快, 高风险 worker 已隔离 |

Staging 跑命令: `bash scripts/deploy/deploy-staging.sh <worker>` (单 worker) 或对应 `npx wrangler deploy` (无 `--env production`).

Staging smoke pass → 进 Stage C. Fail → fix → re-staging.

---

## 5. Stage C — PRODUCTION

### 部署顺序

```
1. DB migration  (database/*.sql, 手动 wrangler d1 migrations apply --remote)
2. Backend workers (bash scripts/deploy/deploy-all-production.sh)
3. Frontend Pages (npm run build && npx wrangler pages deploy dist --project-name=<name>)
4. Edge configs (KV / R2, 极少改)
```

**DB migration 必先** — schema 兼容性. backend 跟 frontend 顺序无关 (envelope contract 稳定).

### 命令速查

| Target | 命令 |
|---|---|
| Single worker prod | `cd workers/<name> && npx wrangler deploy --env production` |
| All workers prod | `bash scripts/deploy/deploy-all-production.sh` |
| Frontend Pages | `cd apps/<name> && npm run build && npx wrangler pages deploy dist --project-name=<service>-<name>` |
| Admin unified | `cd workers/admin && npm run deploy:prod` (含 migrate:prod) |
| D1 migrate | `cd workers/<name> && npm run migrate:prod` (per-worker config) |

详细 dev-env 见 `.olym/skills/dev-env/SKILL.md`.

### 触发权

- **zeus**: prod deploy 唯一 trigger
- **lane owner**: 不直 trigger prod, 走 handoff `## bao approval` 含 deploy:prod trace, zeus 代 trigger
- **bao**: 可任 stage 触发 / abort, 不绕 zeus

---

## 6. Stage D — SMOKE

两层互补:

### 6.1 Basic smoke (always-on)

`scripts/deploy/deploy-smoke-test.sh` — 查每 worker `/health` 200/204. `deploy-all-production.sh` Step 3 自动跑.

WARN: 401/403 (auth required = worker reachable). FAIL: 5xx / unreachable.

### 6.2 Business smoke (G-019, opt-in)

`scripts/deploy/deploy-smoke-business.sh` — 查业务 endpoint, 抓 binding/DB/KV/envelope drift.

Spec: [`.olym/specs/olym-smoke-business/spec.md`](../../specs/olym-smoke-business/spec.md).

**3 类**:
- **read-sanity** — binding/DB/KV read works (e.g., `GET /api/products?limit=1` 返 envelope)
- **shape-sanity** — response 字段 stable (envelope contract 守约)
- **auth-roundtrip** — login → /me 200 (TBD synthetic-users)

**触发**: `OLYM_BUSINESS_SMOKE=1 bash scripts/deploy/deploy-all-production.sh` (默认 off, opt-in until lane owners populate).

**MVP coverage**: catalog + moderation. 其他 worker lane owner follow-up.

### 6.3 Fail action

任 smoke FAIL → abort + rollback hint. 详细 rollback procedure 见 [`protocol/rollback.md`](rollback.md):

- per-target rollback (worker / Pages / D1 / KV)
- 部署逆序 (frontend → backend → DB 慎重)
- 4 triggers + emergency carve-out
- D1 forward-only 限制 (优先 forward fix)

重 deploy 前必修 + retroactive incident handoff (G-023 PR 8).

---

## 7. Stage E — ANNOUNCE

deploy 成功后:

1. handoff body 加 deploy section:
   ```markdown
   ## Deploy Log
   - 2026-05-05 14:30 SHA <abc1234>: prod, smoke pass
   ```
2. **重大 deploy** 加 forward block to bao:
   ```
   @bao: prod deploy <area> done, smoke pass — from @zeus
   ```
3. **EOD audit 当天必跑** (`bash scripts/audit-all.sh`), 不能放隔天 — deploy 后 D1/KV state 可能漂移, 隔天 audit 抓不准.

---

## 8. Emergency Hotfix Carve-out

production 5xx / 数据丢失 / 安全漏洞 → emergency mode:

- ✅ Stage A #1 (clean tree), #2 (on main), #5 (preflight) — 仍必经
- ❌ Stage A #3 (audit), #4 (dike P0) — skip OK
- ❌ Stage B (staging) — skip OK
- ✅ Stage C (production) — 跑
- ✅ Stage D (smoke) — 跑 (5 sec /health 至少)
- ✅ Stage E (announce + 24h retroactive)

**Retroactive 24h 内必补**:
- handoff `## bao approval` 加 `emergency: <reason>`
- 完整 audit-all
- dike P0 跑 retroactive
- 累计 ≥3 次 emergency → bao review (是不是 zeus 钻空子)

非 emergency **不允许** skip 任 stage.

---

## 9. Cross-link 占位 (后续 PR 完成后填)

- **G-019 Smoke 业务级** (PR 4) — 替换 §6 当前简版
- **G-020 Rollback SOP** (PR 5) — emergency / smoke fail 时 rollback 详细流程
- **G-050 Monitor SOP** (PR 6) — Stage E announce 后 daily ops watch

---

## 10. Common pitfalls (历史沉淀)

1. **Dev workers 共享 prod D1** — 测试 GET only, 禁写. dev 不 deploy, 仅本地 wrangler dev 调试.
2. **`*.workers.dev` 国内可访问** — 用作 staging smoke. 但生产域名 (api.<your-domain>) 国内不可访问, smoke 需用 `<worker>.<account>.workers.dev` URL.
3. **schema migration 顺序** — 必先于 worker, 否则 worker 找不到 column 5xx.
4. **Frontend cache** — Cloudflare Pages 部署后 ~30s 全网生效, smoke 太早可能旧版本.
5. **Wrangler OAuth 缺权限** (CF tunnel ingress 改) — 这类改走 bao-dashboard-manual, 不在 deploy script scope.

---

> 此协议跟 `git.md` (push) sibling — git push 是 source 推, deploy 是 effective change 落. 两者不可混用.
> 改 = RFC 5 步 (此协议是 olym stewardship 8 类之一).
