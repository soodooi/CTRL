# Protocol / Rollback

> Stage 9 sub-protocol of olym engineering lifecycle. Sister to [deploy.md](deploy.md) (Stage 6).
> Parent: [olympus-protocol.md](../olympus-protocol.md)

> When prod deploy goes bad → 这个文件. 不是"修 forward 还是 rollback" 的判断指南 (那是 incident response, G-023), 是"决了 rollback 后怎么做" 的 procedure.

---

## 1. 4 Rollback Triggers

| # | Trigger | 决 | 时序 |
|---|---|---|---|
| 1 | **Deploy smoke fail** (basic /health 5xx 或 business endpoint fail) | zeus 自决 (deploy script 已 print rollback hint) | 立即 (deploy 流程内) |
| 2 | **User-reported 5xx** (bao / 客户报错) | zeus 评估 → 跟 bao 决 | 5 min 内决 |
| 3 | **Dike P0 finding** (安全漏洞 / 数据丢失) | bao 决 (mandatory escalation) | 1h 内决 |
| 4 | **Schema migration 失败** (D1 migrate 中途 abort) | zeus + demeter inline (database tech specialist) | 立即, 不进 worker deploy |

**非 trigger** (forward fix 别 rollback):
- WARN level smoke / 单 endpoint 4xx
- dev workers / staging 失败
- audit warning 无实际 5xx
- 用户单点偶发 (流量小, 修 forward 更快)

---

## 2. 决策权 matrix

| 决 | 谁 |
|---|---|
| smoke fail / 5xx 临时 | zeus 自决 |
| dike P0 / 流量大用户报错 | bao 决 (zeus forward block 后等) |
| schema break (大概率 forward fix) | zeus + demeter inline |
| 半夜 bao 不在线 | zeus 自决 + retroactive forward 24h 内 |

---

## 3. Per-target Rollback Procedure

### 3.1 Single worker

```bash
cd workers/<name>
git checkout <good-sha> -- src/ wrangler.toml
npx wrangler deploy --env production
```

**注意**: `wrangler.toml` 也 checkout — binding 跟 source 同步, 否则 binding 漂移.

### 3.2 All workers

```bash
git checkout <good-sha>
bash scripts/deploy/deploy-all-production.sh
```

bash script 自动 deploy 全部 workers. 用 deploy script print 的 last-known-good SHA. 跑完后 `git checkout main` (回 main 分支, 别留 detached HEAD).

### 3.3 Frontend Pages

```bash
# 列 deployment history
npx wrangler pages deployment list --project-name=<service>-<name>

# 回滚 (CF 较新 CLI)
npx wrangler pages deployment rollback <deployment-id> --project-name=<service>-<name>
```

或: CF dashboard → Pages → <service>-<name> → Deployments → "Rollback to this deployment".

CF 默认保留 deployment history 长期, 找前 deployment 容易.

### 3.4 D1 schema (谨慎)

⚠️ **D1 forward-only**, 无 auto-reverse.

**优先 forward fix**: 写新 migration 修. 不退 schema (例: column 加错 → 写新 migration 删, 不 revert).

**真破坏性** (e.g., 误 DROP TABLE / 删了 column 数据丢) → bao + demeter inline:
1. 写 reverse migration `database/<n+1>-revert-<n>.sql` 重建结构 (从 schema-snapshot.md backup)
2. `cd workers/<owner> && wrangler d1 migrations apply <db> --remote`
3. 数据若已丢 → 评估 D1 backup snapshot (CF 自动 daily) 恢复 — bao 决

### 3.5 KV / config

KV 无 history. rollback 需**先有 backup**:

```bash
# Rollback (如果有 backup)
wrangler kv:key put <key> "<old-value>" --binding=<binding> --remote
```

**当前 backup 不强制** (follow-up codify). 改 KV `config:*` 前应在 `.olym/decisions/kv-snapshot-<date>.md` 备份 — 但当前未自动化. 重要 KV (`config:jwt-secret` / API keys) 改前 dump 旧值到 audit log.

---

## 4. 部署逆序 Rollback

```
deploy:   DB → backend → frontend → edge configs
rollback: edge configs → frontend → backend → (DB 慎重, 大概率 forward fix)
```

**frontend 先 rollback** — 减少用户可见 5xx 时间 (frontend 5xx → white screen 直接看到).

**backend 后 rollback** — 避免 frontend 拿不到 API (frontend 老版本 + backend 新版本 = envelope contract 漂移可能 5xx).

**DB schema rollback** 大概率不做, 走 forward fix.

---

## 5. Communication / Audit

rollback 完成后:

1. **handoff body** 加 rollback section:
   ```markdown
   ## Rollback Log
   - 2026-05-05 14:35: rolled back to <good-sha> (was <bad-sha>)
     reason: smoke-fail / user-5xx / dike-p0 / schema-fail
     scope: workers / pages / D1 / KV
   ```

2. **forward bao**:
   ```
   @bao: prod rolled back to <good-sha>, reason <X>, scope <workers/pages/etc> — from @zeus
   ```

3. **24h 内 mandatory** open incident handoff (G-023 PR 8) — root cause + 防再发.

4. **Dike P1 audit** (`.olym/audits/zeus-quality/<date>-rollback.md`) — 5 维度评估为啥 deploy 没拦住, 哪个 gate 漏 / 加哪个 hook.

---

## 6. Emergency rollback carve-out

production 大面积 5xx (>50% requests) / 安全漏洞 active exploit / 数据丢失:

- **Skip step 5 通信**, 立即 rollback
- 跑完后 retroactive 24h 内补:
  - handoff body rollback section
  - forward bao (虽然事后)
  - dike audit
  - incident handoff (G-023)

---

## 7. Common Pitfalls (历史沉淀)

1. **wrangler.toml 漏 checkout** — 只 checkout `src/`, binding 漂移 → worker 5xx
2. **Detached HEAD 留下** — `git checkout <sha>` 跑完忘 `git checkout main`, 后续 commit 丢
3. **D1 试图 reverse** — D1 不支持, 应 forward fix (写新 migration)
4. **KV 改前没 backup** — 没法 rollback, 只能 forward 重设 (重要 KV 改前必 dump)
5. **Frontend rollback 太晚** — 后于 backend rollback, user 持续看 white screen, 应先 frontend
6. **流量小事件做 rollback** — 5 user 报 5xx 不应 rollback (forward hotfix 更快, 影响小)

---

## 8. Cross-link

- **Trigger 1 (smoke fail)** → [deploy.md](deploy.md) §6.3
- **Trigger 2 (user 5xx)** → 跟 bao 沟通 (无 protocol, 自决)
- **Trigger 3 (dike P0)** → [.olym/skills/dike/SKILL.md](../../skills/dike/SKILL.md) Iteration mechanism
- **Trigger 4 (schema)** → [protocol/handoff.md](handoff.md) §10 collision (lane owner 决) + demeter inline
- **24h incident handoff** → G-023 PR 8 (待 codify)

---

> 此协议跟 deploy.md sibling — deploy 是去, rollback 是回. 两者必互相引用清晰.
> 改 = RFC 5 步 (此协议是 olym stewardship 8 类之一).
