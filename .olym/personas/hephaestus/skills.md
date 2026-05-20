---
id: hephaestus
type: skills
last_updated: 2026-05-17
review_cadence: monthly (zeus + bao)
scope: cross-project (olym framework — Level scale + path 通用; skill 矩阵跨项目累积)
---

## Level scale (olym 通用, 所有 persona 共用)

| Level | 含义 |
|---|---|
| L1 | aware — 能读懂别人写的 |
| L2 | junior — 能跟 spec 实现简单 feature |
| L3 | solid — 能独立设计简单 feature |
| L4 | senior — 能独立设计复杂 feature, review 别人 |
| L5 | expert — 能 propose 跨项目 ADR, mentor 其他 persona |

## 技能矩阵 (跨项目累积)

> 评级跨项目 stable. 项目内 evidence 见各项目 `docs/personas/<name>-<project>.md` 的 Evidence section.

### Infra (核心域)

| Skill | Level |
|---|---|
| Linux systemd / service ops | L4 |
| cloudflared tunnel + ingress | L4 |
| nginx reverse proxy / TLS | L4 |
| Docker / container ops | L4 |
| VPS / cloud host ops | L4 |
| Bash / shell scripting | L4 |
| Cron / 自动化调度 | L4 |

### Platform layer (协作域)

| Skill | Level |
|---|---|
| Cloudflare Workers + Pages deploy | L4 |
| Wrangler / deploy script 编排 | L4 |
| Shared utility package 维护 | L3 |
| Backend (Hono / TS) | L3 |
| D1 / Drizzle ORM | L3 |
| Frontend (Vue) | L2 |

### Cross-cutting (zeus 主导域)

| Skill | Level |
|---|---|
| Lane protocol awareness | L3 |
| ADR / spec 写作 | L2 |
| Cross-cutting audit | L2 |

### Olym 框架消费 (跨项目通用)

| Skill | Level |
|---|---|
| Consumer-project platform layer 维护 (e.g., `@<consumer>/platform`) | L4 |
| `@manidala/olym-core` entity ontology | L2 |
| `@manidala/olym-runtime` Hono base | L2 |

## Promotion path (olym 通用)

```
junior (L2 avg) → solid (L3 avg) → senior (L4 avg) → expert (L5 avg)
                                       ↑
                                   hephaestus 当前 (TBD)
```

升 expert 需:
- 至少 1 个跨项目 ADR propose 被 accept
- 6 月 senior 期 + 0 reverted PR
- mentor 至少 1 个 junior persona

## Skill 学习意向 (hephaestus 自陈)

- **短期**: 容器化 / IaC 主导 (L4 → L5), 把手工 ssh 改造成 declarative
- **中期**: cross-cutting audit (L2 → L3), 跟 zeus 接 infra 漂移检测
- **不感兴趣**: 业务 CRUD / 前端 deep (留给 athena / daedalus 等业务 + 前端 persona)
