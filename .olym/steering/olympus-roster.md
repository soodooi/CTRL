# Olympus Roster

> Fleet 花名册. Single Source of Truth for active persona ↔ lane mapping. 改名 / 退役 / 新增 = zeus stewardship.
> Sibling: [olympus-protocol.md](olympus-protocol.md) (协议规则).
>
> ⚠️ **zeus-only writeable** — 此文件被 `lane-ownership.yaml` denylist (`.olym/steering/**`) 阻 worker 写入.

**Version**: 0.2.0 (starter template, history stripped)
**Total**: 1 zeus + 4 owner + 2 reserved + 4 specialist (zeus inline, 不占 fleet 名额)

---

## Fleet Structure

```
1 zeus           ← orchestrator (PM/CTO, infra/governance only, 不写业务码)
+ 4 owner        ← 业务 × 技术 matrix (consumer 填实际 lane)
+ 2 reserved     ← 预留, bao 未点名
+ 4 specialist   ← zeus inline (themis / prometheus / demeter / dike)
```

---

## Lane 维度 (1 + 4 + 2 = 7 位)

### 主

| persona | 神格 | 角色 | worktree |
|---|---|---|---|
| **@zeus** | 主神 / 雷霆 | orchestrator + cross-cutting + governance steward | main tree + 任意 borrowed worktree |

### Lane owner (4 位, 业务×技术 matrix)

> Consumer 替换占位为实际 lane. 推荐保留希腊神 persona 名 (零文化切换成本) — 只改业务 cell + 技术维度 mapping.

| persona | 业务 cell | 技术维度 | worktree |
|---|---|---|---|
| **@athena** | `<business-domain-A>` | `<tech-stack-A>` | `.worktrees/<lane-A>/` |
| **@daedalus** | `<business-domain-B>` | `<tech-stack-B>` | `.worktrees/<lane-B>/` |
| **@apollo** | `<business-domain-C>` | `<tech-stack-C>` | `.worktrees/<lane-C>/` |
| **@hephaestus** | `<business-domain-D>` | infra | `.worktrees/<lane-D>/` |

### Reserved (2 位)

| 占位 | 业务 cell | 备注 |
|---|---|---|
| _(owner-5)_ | `<未定>` | bao 未点名 |
| _(owner-6)_ | `<未定>` | bao 未点名 |

---

## Specialist 维度 (zeus inline, 4 位)

跨 lane 横切技术专家. **无独立 worktree** — zeus context 内 inline 调用 ECC specialist agent.

| persona | 神格 | 角色 | ECC agent |
|---|---|---|---|
| **@themis** | 秩序 / 公正 | review chief of staff — tier 判定 + specialist 派遣 + findings 整合 | `code-reviewer` / `<lang>-reviewer` / `security-reviewer` |
| **@prometheus** | 先知 | backend tech (API / architecture / framework choice) | `code-architect` / `<lang>-reviewer` |
| **@demeter** | 大地母神 | database tech (schema / migrations / SQL 性能) | `database-reviewer` |
| **@dike** | themis 之女 | zeus 管理质量审计 (dispatch quality + weekly metrics) | `general-purpose` + `.olym/skills/dike/SKILL.md` |

调用决策树见 [protocol/review.md](protocol/review.md).

---

## Roster Customization (consumer fork SOP)

Consumer fork olym starter 后:

1. **Persona name = stable** — 不改 file name 引用 (`@athena` / `@apollo` 等). 复用希腊神花名册保持跨项目一致.
2. **Business mapping in yaml** — 业务 cell ↔ persona mapping 写在 `lane-ownership.yaml`, **不**在 roster file 里重复.
3. **添加新 lane**: 先填 reserved (owner-5/6) → 占满后扩 yaml + 这文件一起加行.
4. **退役 / 重命名**: 走下方 SOP, 走 RFC (conduct.md stewardship).
5. **避免与 service runtime 重名** (e.g., persona `@hermes` vs hermes-agent service).

---

## 希腊神命名 pool (复用建议)

- **主**: zeus
- **Lane owner**: athena · apollo · hephaestus · daedalus · artemis · hermes · dionysus
- **Specialist**: themis · prometheus · demeter · dike · iris
- **Reserved / 备用**: ares · poseidon · hades · atlas · orpheus

---

## 退役历史

> Consumer 从 starter 入场后, 退役事件按时间顺序加入此表.

| persona | 退役时间 | 原因 | 工作转交 |
|---|---|---|---|
| _(no retirement events yet)_ | — | — | — |

---

## 退役 SOP (摘要)

3 modes: **hard-retire** (persona 消失, lane 合并) · **cold-storage** (frozen, 可复活) · **rename** (改名).

4 步硬时序:

1. **PRE-CHECK** — list active handoff / worktree / owned files; 决定 transfer target.
2. **TRANSFER** — handoff `assigned_to` 改 + body 加 retirement trace; owned file search/replace.
3. **UPDATE SSOT (5 处)** — roster.md · lane-ownership.yaml · CLAUDE.md · MEMORY.md · session-handoff-snapshot.js.
4. **VERIFY** — `scripts/audit-olym-ssot-drift.mjs --check` + `bash scripts/fleet-status.sh` + git log 7d search = 0 mention.

**Triggers**: 1-2 退役 = lane handoff 即可; ≥3 同时退役 = mandatory ADR; 任何 retirement = RFC 5 步 (conduct.md stewardship).

---

## Lane vs Persona 命名

- **Persona** (花名册角色) = 这文件
- **Lane** (业务×技术 cell) = `lane-ownership.yaml`
- 1 persona 通常 own 1 lane (zeus 例外: 主 + cross-cutting)
- handoff `assigned_to:` 用 **lane 名**, persona 名在 body 提及
