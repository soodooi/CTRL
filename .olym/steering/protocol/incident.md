# Protocol / Incident Response

> Stage 9 full lifecycle catch-all. 当 prod 着火时入口.
> Parent: [olympus-protocol.md](../olympus-protocol.md) · Sister: [monitor.md](monitor.md) (detect) · [rollback.md](rollback.md) (action) · [knowledge.md](knowledge.md) (retro)

> 此协议把 detect/triage/action/retro 串起来. 不重复 monitor / rollback / knowledge 内容, 只管串联.

---

## 1. 4-phase Lifecycle

```
Phase 1. DETECT      monitor.md tier triggers
Phase 2. TRIAGE      5-min decide: rollback / forward-fix / observe
Phase 3. ACTION      rollback.md OR forward-fix RFC
Phase 4. RETRO       24h retro mandatory if page+ tier
```

---

## 2. Phase 1 — DETECT

来源 (复用 [monitor.md](monitor.md)):
- daily 5-item checklist 抓 spike
- log-tail filter (`5xx` / `D1_ERROR` / `login` / `cron`)
- bao / 用户报错 forward
- dike audit P0 finding
- automated scripts (`audit-all` / `fleet-status`)

→ 进 Phase 2 当 tier ≥ **warn**.

---

## 3. Phase 2 — TRIAGE (5 min decide)

| 维度 | 答 |
|---|---|
| **scope** | 影响哪些 worker / 多少 user / 哪些 endpoint |
| **impact** | 5xx rate / 数据丢? / 安全漏洞? |
| **cause** | recent deploy? config change? upstream (CF / fal.ai / Anthropic outage)? |
| **action** | rollback / forward-fix / observe |

**5-min budget**. 超时未决 → **默认 rollback** (保守).

### Decision Tree

```
是否 page+ tier?
  否 → warn → open lane handoff P2, fix forward
  是 → 是否 deploy-related (recent commit caused)?
        是 → rollback ([rollback.md](rollback.md) trigger #1/#2)
        否 → 是否 upstream outage (CF / fal.ai / Anthropic)?
              是 → forward bao + status update (无需 action)
              否 → forward-fix RFC (emergency carve-out, 24h retroactive)
```

---

## 4. Phase 3 — ACTION

### Path A — Rollback (recent deploy is cause)
走 [`rollback.md`](rollback.md) 4 triggers + per-target table. 完成进 Phase 4.

### Path B — Forward-fix (deploy 不是 cause / rollback 不可行)
开 emergency handoff:
- `## bao approval` 段加 `emergency: <reason>`
- skip [deploy.md](deploy.md) §3 audit gates (per §8 emergency)
- 改 code/config/KV → deploy
- **24h 内 retroactive RFC 5 步** (spec/handoff/dike audit)

### Path C — Observe (warn tier 持续)
- log handoff `severity: P2`, lane owner watch
- threshold breach → 升 page → 走 Path A/B

---

## 5. Phase 4 — RETRO (24h mandatory if page+)

**Threshold**: page 或 emergency tier event → 24h 内必开 retro handoff.

### Retro Handoff Template

```yaml
---
id: H-YYYY-MM-DD-NNN-incident-<scope>
title: Incident retro — <one-line summary>
severity: P1
status: in_progress
category: chore
related:
  - <original-incident-handoff>
  - .olym/audits/zeus-quality/<date>-incident.md
---

## bao approval
- bao verbal-go: <date>: "<quote>" (or paraphrased)

## Timeline
- HH:MM detect
- HH:MM triage decision
- HH:MM action started
- HH:MM resolved

## Root cause (5 whys)
1. why 1
2. why 2
3. why 3
4. why 4
5. why 5

## What worked
- <bullet>

## What didn't
- <bullet>

## Action items
- [ ] H-... follow-up: <improvement>
- [ ] add hook / audit / protocol clause

## Pattern (dike skill new pattern?)
- <P-XXX bao approve, optional>
```

dike audit `.olym/audits/zeus-quality/<date>-incident.md` 作 sediment evidence.

---

## 6. Communication Template (bao 期间 update)

### Status update (每 15 min during active)

```
@bao: incident <ID> status: <triage|action|resolving>
  scope: <what's broken>
  impact: <user / 5xx %>
  action: <rollback / forward-fix / observe>
  ETA: <time>
— from @zeus
```

### Resolved announcement

```
@bao: incident <ID> RESOLVED at <time>
  duration: <X min>
  action taken: <summary>
  retro: H-YYYY-MM-DD-NNN-incident-... (open within 24h)
— from @zeus
```

---

## 7. Severity 跟 monitor.md Tier 对齐

| Monitor tier | Incident response |
|---|---|
| info | not incident, daily log |
| warn | Phase 2 triage, often Path C observe |
| **page** | full 4-phase, 24h retro mandatory |
| **emergency** | full 4-phase + ADR + bao escalate immediately |

---

## 8. Dike Audit Integration

page+ tier event sediment 路径:
- `.olym/audits/zeus-quality/<date>-incident.md` (dike auto-included in EOD)
- 5 维度评估: detect promptness / triage decision quality / action effectiveness / retro completeness / pattern detection

**≥3 incident in 30d** = dike pattern flag (类似 P-XXX), bao review olym 整体健康.

---

## 9. Common Pitfalls

1. **Triage 超 5 min 没决** — 默认 rollback 保守 (避免 user 持续 5xx)
2. **Forward-fix 没 retroactive RFC 24h 内补** — 累计违规 → bao review (zeus 钻空子嫌疑)
3. **Retro 24h 没开** — page+ event 必开, dike P0 flag
4. **Status update 给 bao 太简略** — scope/impact/action 三件必含, ETA 可选 (没把握就写 "TBD")
5. **Upstream outage 误判 deploy bug** — CF/fal.ai status page 先看, 别瞎 rollback
6. **Pattern 重复** — 同类 incident 30d 内 ≥3 = 机制问题, 不只 fix 单点

---

## 10. Out of Scope (cross-link)

- **Auto incident management tool** (PagerDuty / FireHydrant) — manual now
- **Public status page** — pre-launch 不需要
- **On-call schedule** — solo zeus, 不适用
- **Post-mortem document template** (separate from retro handoff) — future, 此 spec 仅 codify retro mandatory threshold

---

> 此协议是 lifecycle Stage 9 full. 串联 monitor/rollback/knowledge.
> 改 = RFC 5 步 (此协议是 olym stewardship 8 类之一).
