# Protocol / Spec Discipline

> Spec versioning + 4 类内容路由 + 反膨胀机制. 抽自 bao 2026-05-03 反馈 (memory: feedback_spec_proliferation).
> Parent: [olympus-protocol.md](../olympus-protocol.md) · Sibling: [conduct.md](conduct.md) · [knowledge.md](knowledge.md)
> 任何 zeus 开新 spec / bump 现有 spec 前先扫这里. 违反 = dike audit flag.

---

## 1. 核心原则

**spec ≠ 文档载体, spec = 临时的 plan 文件**.

一个 cross-cutting concern 永远是**一个 spec_id**. 演进靠 version bump + Changelog 段, 不靠开新文件. shipped 后 spec 关闭, 内容拆下沉到代码 / steering / archive.

bao 反馈原文 (2026-05-03):
1. "spec 现在越写越多, 有点麻烦"
2. "spec 应该用版本更新, 控制不住"

**根因**: spec 写作时缺 versioning 思维 — 每发现新子问题就开新文件, 不会去 bump 已有 spec. 纯靠人记律不住, 必须机制兜底.

---

## 2. 内容 4 类 → 4 个去向

| spec 包含的内容 | 类型 | 去向 | 例子 |
|---|---|---|---|
| 函数/模块的契约 (参数/返回/可见性/版本) | **Contract** | 代码 TSDoc → handbook `/api/` 自动出 | `@public @since 1.2 @deprecated` |
| 单元行为/验收标准 | **Behaviour** | 测试 + JSDoc `@example` | `expect(envelope).toMatchShape(...)` |
| 架构决策事件 (once-off, 含 alternatives + 时间戳) | **Decision (event)** | `.olym/decisions/NNN-slug.md` (ADR) → handbook `/decisions/` | ADR 001 fleet 14→7 (含 alternatives 评估) |
| 架构决策规则 (evergreen, 持续参考) | **Decision (rule)** | `.olym/steering/topic.md` → handbook `/arch/` | "OKLCH 不 HSL 因为 P3 色域" / db-schema-snapshot |
| 跨周期要做的步骤/迁移 | **Plan** | `.olym/specs/` (少量) + 短期 handoff | "Phase 1B: tag 5 modules" |

**写 spec 前自检**: 一个 spec 通常 4 类都掺. 写完 main scope 后立刻拆:
- Contract 段 → 抽到代码 TSDoc + spec 留链接 (`see packages/platform/src/auth/index.js@since 2.5.0`)
- Behaviour 段 → 抽到测试 + spec 留链接
- Decision 段 → 抽到 `.olym/steering/<topic>.md` + spec 留链接
- Plan 段 → 留 spec 主体

shipped 时 spec 被掏空 → 只剩 changelog + 链接 → 标 `status: shipped` 移 archive.

---

## 3. Frontmatter 强制 6 字段

```yaml
---
type: spec-<scope>            # spec-infrastructure / spec-cross-cutting-unification / spec-feature
spec_id: <kebab-id>           # 永久 ID, 唯一. 改名 = 新 spec_id (极少)
version: <semver>             # 1.0.0, 2.3.1 etc.
status: draft|active|shipped|archived
lifecycle: alpha|beta|GA      # optional, 系统成熟度 (≠ status); 见 §3.1
created: YYYY-MM-DD
updated: YYYY-MM-DD
owner: <persona> [→ <persona>]
audit_dimension: <dim>[, <dim>]   # 接 audit-cross-cutting.mjs 维度. 无关填 (none — net-new infrastructure)
superseded_check: |               # 只在新建 spec 时必填. bump 已有不需要
  Scanned existing specs:
  - api-envelope (audit_dimension=envelope) → not match because <reason>
  - auth-unification (audit_dimension=auth) → not match because <reason>
  Decision: open new spec, audit_dimension=<new-dim>
related:
  - <path>
---
```

**superseded_check 是反膨胀核心**: 让"开新 spec"比"bump 已有"更费力. zeus 写不出 superseded_check = 必须 bump 已有.

### 3.1 lifecycle (G-018, optional) — 系统成熟度

跟 `status` 区分:

| 字段 | 答 | 取值 |
|---|---|---|
| `status` | spec **文档** 还在写吗 | draft / active / shipped / archived |
| `lifecycle` | spec 描述的**系统**多成熟 | alpha / beta / GA |

例: `status: shipped + lifecycle: alpha` = spec 写完了, 但系统还在早期, breaking change OK.
例: `status: active + lifecycle: GA` = spec 还在迭代 (v1.x patch/minor), 但 contract 已稳定 semver.

**三态语义**:

- **alpha** — 早期 / prototype / 内部 dogfood. breaking change 不需 migration. 默认 lifecycle.
- **beta** — feature complete, 1+ adopter, 内部稳定. breaking change 需公告 + 1 周 grace.
- **GA** — 跨多 adopter / 外部依赖 / 长期承诺. breaking change = major bump + ADR + migration plan.

**Transition** (单向, 禁降级):

| from → to | 条件 | 谁判 |
|---|---|---|
| alpha → beta | 1+ adopter 实际 use, smoke pass, doc complete | spec owner |
| beta → GA | 跨 lane 依赖 / 长期承诺 / 外部 contract | bao escalate |
| GA → archived | G-031 retirement 流程 | bao + zeus |

降级 (GA→beta / beta→alpha) **禁止**. 出问题 = bump major + ADR alternatives, 不改 lifecycle. 跟 semver 规矩对齐.

**跟 semver 关联** (G-017 sister, 待实施):
- `0.x.y` ↔ alpha / beta (pre-GA)
- `1.0.0+` ↔ GA only

backward compat: 缺 `lifecycle` → `(unspecified)` group. 不强制回填, 自然演进.

---

## 4. Semver 规矩

**关键 (G-017)**: spec frontmatter `version` = **spec 文档自身**版本, **不**是它描述的产品/系统版本. 两者解耦.

| bump | 触发 | 例 |
|---|---|---|
| **major** | scope 变 / 兼容性破坏 | `1.0.0 → 2.0.0` envelope-only spec 扩到 cross-cutting unification |
| **minor** | 子模块加章节 / scope 内增量 | `2.0.0 → 2.1.0` auth-unification 合进来作为 §3 |
| **patch** | 措辞修订 / 链接修正 / 拼写 | `2.3.0 → 2.3.1` |

**绝不**: 同 spec_id 跳版本 (`1.0.0 → 3.0.0`) 或 downgrade. 写错 = 重新 bump 一次到正确版本, 不回滚.

### 4.1 GA gate (G-017)

"officially GA" = `lifecycle: GA` (G-018 字段). **不**是 `version: 1.0.0`.

升 lifecycle: GA 触发 (任 1 满足 + bao escalate, 见 §3.1 transition):
1. 跨 lane 依赖 (≥2 owner consume)
2. 长期承诺 (breaking change 需 ADR + migration plan)
3. 外部 contract (上游 / 客户依赖)

**为何分开**: spec 文档可能 v1.0.0 写完了 (内容稳定), 但它描述的系统还 alpha (未跨 adopter / 没外部承诺). 反之系统已 GA (生产稳定), 但 spec 还在 v0.6 写一半. 两者不应耦合.

例:
- `auth-unification v2.3.1 + lifecycle: alpha` = spec 文档第 2.3.1 版, 系统仍 prototype
- `payment-system v1.0.0 + lifecycle: alpha` = spec 文档完整, 系统未实现
- `olympus v1.0.0 + lifecycle: GA` = 跨 fleet 全员依赖, 真 GA

### 4.2 lifecycle ↔ version 弱关联 (推荐, 不强制)

| lifecycle | 推荐 version | 备注 |
|---|---|---|
| alpha | `0.x.y` (推荐) / `1.x.y` (grandfather OK) | spec 文档完整度跟系统成熟度解耦 |
| beta | 多见 `0.x.y` | 1+ adopter 但仍 pre-GA |
| GA | `1.0.0+` (建议) | 跨 adopter 时 semver 严格, breaking → major bump |

**Grandfather**: 当前 14+ olym specs 全部 v1.0.0 + alpha — **不强制**回滚. version 反映 spec 文档 maturity (写完了就 1.0.0), lifecycle 反映系统 maturity. 两者各自演进.

**未来 lint (G-046 follow-up)**: optional warn `version >= 1.0.0 && lifecycle != GA` — 不阻塞, 仅提醒. 当前 grandfather 期不开.

---

## 5. Changelog 段强制

每个 spec 有 `## Changelog` 段, 倒序排列, 旧版本进 changelog 不删除:

```markdown
## Changelog

- **2.3.0** (2026-05-03): logo unification 子模块完成, §6 标 shipped
- **2.2.0** (2026-04-28): vi-unification 合并进来作为 §4
- **2.1.0** (2026-04-25): auth-unification 合并进来作为 §3
- **2.0.0** (2026-04-20): scope 从 envelope-only 扩到 cross-cutting
- **1.0.0** (2026-04-15): created (envelope only)
```

shipped 后 changelog 仍保留 — audit trail 用.

---

## 6. 开新 spec 决策树

> **Stage 0 上游**: 此决策树是 RFC 5 步的 step 1 内. 上游 (Stage 0 Propose) 见 [`olym-proposal-sop`](../../specs/olym-proposal-sop/spec.md) — bao verbal-go ✅ / brief proposal ✅ / formal proposal ✅ approved 后才进此决策树.

```
有新需求要写下来 (bao approved or verbal-go)
  ↓
扫 .olym/specs/_index.md 所有现有 spec_id + audit_dimension
  ↓
能匹配某个现有 audit_dimension?
  ├─ 是 → bump 现有 spec (minor/major), 加 § 章节, 不开新文件
  └─ 否 → 是 Decision?
            ├─ 是 once-off 事件 (含 alternatives, 时间戳, 决议后不改) → 写 ADR `.olym/decisions/NNN-slug.md`
            ├─ 是 evergreen 规则 (持续参考, 会 update) → 写 steering `.olym/steering/<topic>.md`
            └─ 否 → 是 Contract (附属于某个文件)?
                      ├─ 是 → 写 TSDoc 到代码, 不开 spec
                      └─ 否 → 是 短期 plan (1-7 days)?
                                ├─ 是 → 开 handoff, 不开 spec
                                └─ 否 → 开新 spec (frontmatter 必填 superseded_check)
```

> **改 olym 自身 (8 类 zeus stewardship 文件) 开新 spec / ADR 后**, 走 §7 RFC 5 步流程 (硬时序).
> 普通 <project> 业务 spec (lane scope 内) 不强制 RFC, 走 lane handoff 即可.

---

## 7. RFC 流程 — 改 olym 自身 mandatory

**触发**: 修改 zeus stewardship 8 类文件 (conduct.md §8) 中的 cross-cutting 决策类 — protocol/* 改条款 / olympus-roster.md fleet 增减 / lane-ownership.yaml lane 改 / spec/olympus + spec/multi-agent-fleet / 加新 ADR / .husky 钩子 / .claude/hooks / mcp.json 等.

**不触发**: routine sync (CLAUDE.md fact / MEMORY entry / archive routine). 见 conduct.md §13 决策树.

### 7.1 5 步流程 (硬时序, 不可合并 step)

```
Step 1 — OPEN RFC
  - 开 branch (feat/olym-<scope> or chore/olym-<scope>)
  - 写 spec .olym/specs/olym-<scope>/spec.md (含 superseded_check)
  - 开 handoff .olym/handoffs/H-YYYY-MM-DD-NNN-<scope>.md (status: in_progress)
  - (可选) 写 ADR .olym/decisions/NNN-<slug>.md (大决策含 alternatives)

Step 2 — IMPLEMENT
  - 改文件
  - commit on branch (NOT main 直接)
  - push branch + open PR

Step 3 — REVIEW
  - 派 themis (Agent code-reviewer), tier 默认 B
  - APPROVE → Step 4
  - CHANGE_REQUEST → 修 → re-review → APPROVE
  - REJECT → close PR + close handoff (status: archived)

Step 4 — MERGE
  - bao 看一眼 (optional, default zeus 代 squash)
  - gh pr merge --squash --delete-branch
  - main pull + verify (tests / fleet-status)

Step 5 — SEDIMENT
  - dike audit (Agent + skill dike) post-dispatch
  - 写 .olym/audits/zeus-quality/<date>-<scope>-review.md
  - handoff status → verified
  - (可选) best-practice 沉淀新 pattern
  - olym-v3-roadmap 对应 gap 标 done
  - commit 收尾 docs (handoff close + audit + best-practice)
```

### 7.2 Emergency carve-out

生产挂 / 死链立即修 / SSOT 急修 → zeus 直接动手, **事后**走 5 步 (retroactive). 要求:

- **24 小时内**补 spec + handoff + ADR (如 cross-cutting)
- 24 小时内派 themis re-review 对应 commit (虽然已 push)
- dike audit 标 "retroactive due to emergency, root cause: <reason>"

**Emergency 判定**: zeus 自决 trigger. 但 retroactive review 时 bao 可重判 violation (e.g., 觉得不算 emergency, 是 zeus 偷懒). 累计 N 次 (≥ 3) 滥用 → 升级到 dike pattern flag (e.g., new pattern P-008-emergency-abuse), bao 半年 review.

非 emergency **不允许** commit-first-handoff-after. olym v2 compaction 那类违反就在此被禁.

### 7.3 Spec ↔ ADR ↔ Handoff 三位一体

每个 RFC 对应:

| 文档 | 回答 | 必填 |
|---|---|---|
| **spec** | 实施计划 (要做什么) | ✅ RFC 必须 |
| **ADR** | 决策依据 (为什么决定 X + alternatives) | ⚠️ only if 决策 once-off + 含 alternatives |
| **handoff** | 任务跟踪 (谁在做 + status flow) | ✅ RFC 必须 |

ADR 触发 = G-002 路由 (决策事件 vs 规则). 不是所有 RFC 都需要 ADR (e.g., G-003 stewardship 是边界明文化, 没 alternatives, 不需要 ADR).

### 7.4 实例

| 实例 | RFC 走完? | spec | handoff | ADR | dike |
|---|---|---|---|---|---|
| olym v2 compaction | ❌ retroactive (commit 在前) | ✅ olym-v2-compaction | ✅ H-2026-05-05-001 | ✅ ADR 001 (fleet 14→7) | B+ (8/10) |
| olym-mcp Phase 1 | ✅ 完整 (atlas 写, zeus-3 接) | ✅ olym-mcp | ✅ H-2026-05-04-005 | (no ADR) | A- (9/10) |
| olym-adr-codify (G-002) | ✅ 完整 | ✅ olym-adr-codify | ✅ H-2026-05-05-005 | (no ADR, 自身是 ADR codify) | A (9/10) |
| olym-zeus-stewardship (G-003) | ✅ 完整 | ✅ olym-zeus-stewardship | ✅ H-2026-05-05-006 | (no ADR) | A- (8.5/10) |
| **olym-rfc-mandatory (G-004, this)** | ✅ 完整 | ✅ olym-rfc-mandatory | ✅ H-2026-05-05-008 | (no ADR) | (pending) |

第 1 例 retroactive (违反 7.1 时序), 第 2-5 例完整 — RFC 流程不是新规, 是把现有 dogfood 模式形式化.

---

## 8. 当前 14 spec 重新归类 (2026-05-03 baseline)

| spec | 类型判定 | 动作 |
|---|---|---|
| multi-agent-fleet | Decision (shipped) | 标 `status: shipped` + `superseded_by: olympus-roster.md + olympus-protocol.md`. 文件不动 (23 处 reference) |
| api-envelope | Contract (active) | 主体下沉 `packages/platform/src/response.js` TSDoc; spec 留 plan 段 + 链接 |
| auth-unification | Contract (active) | 主体下沉 `packages/platform/src/auth/` TSDoc |
| vi-unification | Contract (active) | 主体下沉 `packages/brand/` JSDoc + tokens.css 注释 |
| logo-unification | Contract (active) | 主体下沉 `packages/brand/logo/` JSDoc |
| database-naming | Contract (active) | 主体下沉 `packages/platform/src/utils/multi-db.js` JSDoc; 33 violations 仍待清理. **注意**: `.olym/steering/database-naming.md` 是规则 Decision (已存在), `.olym/specs/database-naming/spec.md` 是 in-flight cleanup Plan. 双轨无冲突 |
| synthetic-users | Plan (active) | 保留 spec |
| payment-system | Plan (future) | 保留 spec |
| marketing-v2/test/gologin | Plan (active) | 保留 spec, 补 frontmatter |
| marketing-v2/execution-layer | Plan (active) | 保留 spec, 修 status 字段 |
| <example-spec> | Plan (active) | 保留 spec, 修 status 字段 |
| handbook-pipeline | Plan (active) | 保留 spec — 这套机制本身的载体 |
| architecture-unification.md | Plan (active) | Phase 1-3 done, Phase 4-5 in-flight (per CLAUDE.md). Body "Status: done 2026-04-21" 是 phase 1-3 落地, 不是整体. version 0.3.0 (3/5 phases) |
| staging-env-rollout.md | Plan (active) | Phase 1-3 done, Phase 4-5 not started. version 0.6.0 |

**预期收敛**: 14 → 6 个 active plan spec. Contract 内容下沉 TSDoc, Decision 下沉 steering, shipped 标记不立即移文件 (避免断 23 处 reference, 等架构调整 cycle 一起做).

---

## 8. 反膨胀机制 (机制层兜底)

| 机制 | 落点 | 触发 |
|---|---|---|
| **a.** `superseded_check` frontmatter 必填 | spec 模板 | 开新 spec 时 |
| **b.** `.olym/specs/_index.md` 自动生成 (`scripts/specs-index.mjs`) | scripts | pre-commit hook + EOD audit |
| **c.** `audit-cross-cutting.mjs` 加项: spec 数量周环比 | scripts | EOD audit |
| **d.** 周环比 +N > +2 → zeus 必须解释根因 | dike audit flag | 自动 |
| **e.** 写新 spec 但 superseded_check 写不出 → dike P1 flag | dike skill | 派遣前 |

---

## 9. 应用

- 任何 zeus 决策"要不要写 spec" 之前先扫此文件 §6 决策树
- 任何 zeus 写 spec frontmatter 必填 §3 6 字段, 缺一不通过 (CI 加 lint)
- 任何 zeus 改 spec 内容必 bump version + 加 changelog 行
- shipped 标记不动文件位置, 等架构 cycle 一起处理 reference 迁移
- bao feedback 触发 §1 任一根因 → 强制 zeus 重读此文件

---

## Changelog

- **1.2.0** (2026-05-05): G-017 added — §4 clarify spec doc version ≠ product version, §4.1 GA gate (lifecycle:GA not version 1.0.0), §4.2 lifecycle ↔ version 弱关联表 + grandfather 说明.
- **1.1.0** (2026-05-05): G-018 added — §3.1 lifecycle field (alpha/beta/GA) + transition table. status (doc state) ≠ lifecycle (system maturity) 区分 codified.
- **1.0.0** (2026-05-03): created. 抽自 bao 2026-05-03 两层反馈 + memory feedback_spec_proliferation. 当前 14 spec baseline 归类 (§7).
