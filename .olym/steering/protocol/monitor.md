# Protocol / Monitor

> Stage 8 of olym engineering lifecycle. Daily ops watch — 持续观察 prod state.
> Parent: [olympus-protocol.md](../olympus-protocol.md) · Sister: [deploy.md](deploy.md) · [rollback.md](rollback.md)
>
> **跟 Smoke (G-019, deploy.md §6) 区分**: smoke = one-shot post-deploy. monitor = daily 持续.

---

## 1. Daily Zeus 5-item Checklist (≤5 min morning)

每日 zeus session 起手做 (跟 SessionStart hook 注入并行):

| # | 看 | 命令 / 入口 | Threshold |
|---|---|---|---|
| 1 | **CF Workers Analytics** | dashboard.cloudflare.com → Workers → Analytics | 5xx rate < 1%, response p95 < 1s |
| 2 | **fleet-status** | `bash scripts/fleet-status.sh` | handoff backlog 健康 / dike phase 不滞后 / EOD audit 不漏 |
| 3 | **D1 query slow log** | CF dashboard → D1 → 各 db → Query insights | > 500ms 是 watchable, > 1s 必修 |
| 4 | **KV / R2 quota** | CF dashboard → Workers KV / R2 | 接近 free tier limit (read 100k/day) 提前 plan paid |
| 5 | **Cost dashboard** | Anthropic console + fal.ai dashboard | spike check + 日均 burn rate (见 §4) |

每条 ≤ 1 min. 异常 → 跳出 daily 进 §3 ladder.

---

## 2. Per-worker Watch Matrix

| Worker | Key metric | Threshold | 看哪 |
|---|---|---|---|
| admin | 5xx rate | < 0.5% | CF analytics + log-tail |
| catalog | response p95 | < 500ms | CF analytics |
| customer | login success rate | > 99% | log-tail filter `login` |
| supplier-sds | enrichment cron success | > 99% (4-tier closed-loop) | `.olym/best-practice/enrichment-manual-fix.md` queue |
| moderation | detect throughput | n/a (low traffic) | log-tail spot-check |
| ops | health/deep response | 200 + < 200ms | manual curl |
| shopify | sync error rate | < 5% | webhook idempotency log |
| recommendation | recommendation generation | success | log spot-check |
| images | fal.ai cost daily | < $50/day | daily review |
| maya | conversation success | > 95% | log-tail |
| cdn / video-cdn | bandwidth burn | < 10GB/day | CF dashboard |
| log-tail | ingestion errors / dropped events | 0 (best-effort) | CF dashboard |

**填 "n/a" = 当前流量低不 watchable**. lane owner 接手后 refine.

---

## 3. 4-tier Alarm Escalation

| Tier | 触发 | Action | 状态 |
|---|---|---|---|
| **info** | 单 spike (1 hr 5xx 0.6%) | log only, daily review 包含 | 可降级 |
| **warn** | 持续 ≥ 30 min over threshold | open lane handoff `severity: P2`, fix forward | 可降级 |
| **page** | 业务级 ≥ 5 min (admin login 5xx) | open zeus handoff `severity: P1` + forward bao | 不可降级, 必走 audit |
| **emergency** | 大面积 (>50% 5xx) / 数据丢失 / 安全 | rollback trigger #2 + incident handoff (G-023) | 立即 |

### Ladder rules

- info → warn: 持续 over threshold
- warn → page: 业务级影响 (用户可见)
- page → emergency: 大面积 / 安全 / 数据
- 一旦 page 必走 dike audit (root cause + 防再发)
- emergency 必 24h 内 incident retro

---

## 4. Cost Watch (daily)

**bao pre-launch budget 紧, cost watch 跟 healthy ops 同优先**:

| Service | 日均 burn target | 超时 action |
|---|---|---|
| **Anthropic API** | < $20/day | 警告 + 5 min review |
| **fal.ai** (image gen) | < $50/day | 警告 + cards strategy review (`.olym/best-practice/cards-module.md`) |
| **Cloudflare** | $0 (free tier) | 监控接近 limit, 接近时升 paid |
| **Vultr VPS** (hermes / logos) | $20/month fixed | 不变 |

连续 2 天超 → bao 决: 调 budget / 限流 / 优化.

**Cost dashboard 入口**:
- Anthropic: console.anthropic.com → Usage
- fal.ai: fal.ai/dashboard → Billing
- Cloudflare: dashboard.cloudflare.com → Workers / D1 → Analytics → Usage
- Vultr: my.vultr.com → Billing

---

## 5. Monitor → Handoff/Rollback/Incident Bridge

| Monitor finding | Stage 9 action |
|---|---|
| info | 无, daily log |
| warn | open lane handoff (lane owner fix forward) |
| page | full incident response ([`incident.md`](incident.md)) — 4-phase + 24h retro |
| emergency | full incident + rollback trigger #2 ([`rollback.md`](rollback.md)) + ADR |

**严格分界**: warn 是 fix forward (修代码), page+ 是 incident 响应. 详见 [`incident.md`](incident.md) 4-phase.

---

## 6. log-tail 用法

`workers/log-tail` 是 tail worker, 抓全 fleet workers 的 console.log / errors.

**查看**: CF dashboard → Workers → log-tail → Logs (实时 stream).

**典型 grep**:
- `login` — 鉴权链路
- `5xx` / `error` — server error
- `D1_ERROR` — D1 binding 失败
- `cron` — enrichment / scheduled task

**不替代**: log-tail 是 reactive (出问题查), 不是 proactive (alarm). proactive alarm 留 G-041.

---

## 7. EOD Cadence (复用 conduct.md §3)

zeus 每日收尾 sequence 已含 monitor 元素:

1. `bash scripts/audit-all.sh` — 跑 SSOT drift + cross-cutting
2. dike audit (P0 finding bao 通报)
3. fleet-status check (handoff backlog)

加 (此 spec 引入):
4. **monitor 5-item checklist** (上 §1) — 收尾时再扫一遍 prod state

EOD = morning checklist 镜像, 中午 ops 看一下 (page tier 才 alert).

---

## 8. Out of Scope (cross-link)

- **Auto alerting / paging** — G-041 P3 (alerting on SSOT drift / 死链 / 业务 metrics)
- **Synthetic monitoring** — Pingdom/Better Uptime 类, future
- **Custom metrics dashboard** — G-040 P3 (vs 用 CF analytics)
- **Detailed runbook per worker** — lane owner 自填 (此 spec 给 template / matrix only)
- **Cost optimization SOP** — G-038 P2 (vs 此 spec 仅 cost watch threshold)
- **Multi-region monitoring** — CF Workers 单区域 propagation, 不适用

---

## 9. Common Pitfalls

1. **info 累积成 warn** — 单日 6 次 info 应 escalate 为 warn 看趋势
2. **page 后 zeus 自己 fix 不 forward bao** — page tier mandatory forward, 流程不可省
3. **log-tail 当 alerting 用** — log-tail 是 reactive, 没人盯 = 没 alarm
4. **cost spike 周末 leak** — 周末没看 dashboard, 周一发现已超 — 周末 zeus 至少扫一次
5. **D1 quota miss** — free tier read 5M/month 容易超, daily check 第 4 项
6. **fal.ai cost runaway** — image gen 单次 $0.024-0.05, 一晚跑 1000 张 = $50+, daily watch

---

> 此协议是 lifecycle Stage 8. 跟 deploy (Stage 6) / rollback (Stage 9) sister, 共同覆盖 ops phase.
> 改 = RFC 5 步 (此协议是 olym stewardship 8 类之一).
