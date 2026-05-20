# Protocol / Review Protocol

> Review 是 fleet 质量底线. **2 层 review** (lane self + zeus 派): lane owner ship 前必跑 `simplify` skill self-review (refactor / DRY / 删 dead code), zeus 派 themis + specialist 整合 findings.
> Parent: [olympus-protocol.md](../olympus-protocol.md)

---

## 0. Pre-PR Self-Review (lane owner 必跑, 2026-04-30 钦定)

任何 lane owner ship PR 前**必跑 ECC `simplify` skill**:

```
> simplify
```

`simplify` skill 自动:
- 找 changed files (vs origin/main)
- review for reuse / quality / efficiency
- 自动 fix 找到的问题 (refactor / DRY / 删 dead code)
- 给 self-review report

跑完 + fix 后才 push PR. zeus 派 review 时验"是否已跑 simplify" (handoff EOD report 含一行 "simplify ran ✅").

未跑 simplify 直接 push PR = **dike P1 audit flag**.

**why**: themis review 是结构性 / 大问题, simplify 是细节级 (重复代码 / 命名 / 死代码). lane owner 自己最清楚改动上下文, simplify pre-check 能省 themis review 后再返工的时间.

---

## 1. Review 角色分工

| 谁 | 干什么 | 不干什么 |
|---|---|---|
| **@themis** (zeus inline) | tier 判定 + specialist 派遣 + findings 整合 + worker action items + 签名 | 不手撕代码 |
| **@prometheus** (zeus inline, backend specialist) | backend architecture 视角介入 (worker / API / business logic) | 不接 frontend / DB review |
| **@demeter** (zeus inline, database specialist) | DB schema / migration / SQL / multi-db 边界 | 不接 frontend / backend logic |
| **@iris** (frontend lane owner + 兼前端 tech) | frontend 业务 + 技术 review | — |
| **@metis** (audit lane owner) | audit script + regression test 设计 (PRE-PR / 长期防线) | 不接 PR review (是 themis scope) |
| **@hephaestus** | cross-lane execution 后的 self-review (跟普通 lane owner 一样) | 不替别人 review |
| **lane owner** | 自己 PR 自验 + 实施 fix | 不替别人 review |

---

## 1.2 Trigger Conditions (G-011, 2026-05-05)

**status:done = themis dispatch trigger**. 当 handoff 进入 `done` 状态:

1. **SessionStart hook** 自动显示 "Pending Review" section (zeus context only) — `.claude/hooks/session-handoff-snapshot.js` 实施
2. **zeus 派 themis** (`Agent(subagent_type: "code-reviewer")`) tier 按 §3 决策
3. **APPROVE** → flip handoff status `done -> verified`
4. **CHANGE_REQUEST** → 实施 follow-up commit → re-review
5. **REJECT** → close handoff status:archived + 写 ADR (`.olym/decisions/`) 记 alternative considered

zeus 不应 rubber-stamp 自己的 handoff. 即使 routine sync 改了 `.olym/`, 也按此 trigger 走 (tier C / D 仍要 solo verify).

---

## 2. Tier 判定 (PR / fix-commit)

| Tier | 触发条件 | Review 强度 |
|---|---|---|
| **A-tier** | ≥500 行 + 跨多个高敏感维度 (worker + D1 + R2 + 用户输入 + auth) | **5-skill blind santa-loop** (round-1 + round-2 fresh blind) |
| **B-tier** | 任何行数 + 涉及 auth / RBAC / secret / SQL schema / SSRF / R2 path 任一 | 至少 1 个对应**专科 reviewer** (security-reviewer / database-reviewer 等) |
| **C-tier** | 普通 ≤200 行单一维度修复 | **solo verify + 跑测试**, 跳过 specialist (zeus + themis 自验) |
| **D-tier** | 纯 docs / JSDoc / handoff status flip | solo eyeball |

---

## 3. Specialist 决策树 (themis 派遣)

```
PR / fix-commit 进入 review queue
│
├─ themis 判定 tier (A/B/C/D)
│
├─ tier = A → themis 派 5-skill blind:
│   ├─ security-reviewer
│   ├─ database-reviewer (如涉及 D1)
│   ├─ silent-failure-hunter
│   ├─ typescript-reviewer
│   └─ code-reviewer
│   round-2 fresh blind (新 agent instance) 抓 round-1 漏的
│
├─ tier = B → themis 派对应专科:
│   ├─ auth/RBAC/secret/SSRF → security-reviewer
│   ├─ SQL schema/migration/D1 → database-reviewer
│   ├─ silent error/swallowed exception → silent-failure-hunter
│   ├─ TS 类型/async/idiom → typescript-reviewer
│   ├─ frontend a11y → a11y-architect
│   ├─ E2E 关键流 → e2e-runner
│   └─ architecture decision → code-architect
│
├─ tier = C → solo verify + 跑测试 (无 specialist)
│
└─ tier = D → solo eyeball
```

---

## 4. Specialist Persona inline 介入

`@prometheus` (backend) / `@demeter` (database) **inline 调用** = zeus 在 review/architecture 决策时, 不只是派 ECC agent 跑机械 review, 还**写 architecture 视角的判断**, 签名 `— from @prometheus (zeus inline backend specialist)`.

何时 inline:
- 涉及**架构决策** (e.g., 新增 worker / 改 API contract / 调整 D1 multi-db 边界)
- 跨 lane 影响 (frontend lane 决策影响 backend 性能 → prometheus 介入)
- 长期技术债判断 (e.g., "这个 pattern 是临时还是永久")

何时仅 ECC agent 即可:
- 普通代码审查 (typescript/security 标准 review)
- 一次性修复 (fix-commit C-tier)

---

## 5. Fix-commit grep checklist

fix-commit push 前必须 grep `<changed-symbol>` 全工作树, verify 所有 caller 一并改.

**Why**: PR-38 round-7 reviewer 抓出 2 BLOCKER (sister `/save` handlers 漏改)。"按 codepath 分组" 不是 "按 commit 分组" review — 找 catch 块**调用链**触达目标 lib 的所有位置。

**How**:
1. 找 `import <symbol>` 全文件 (3+ 出现, 不只看你 touch 的那个)
2. 同文件内多个 `export async function handle*` 共享 helper 的契约一致, 永远 grep all
3. 每轮 review 完写 task "是否还有别的 X caller?" 不是直接说 "done"

详细 case study: `.olym/best-practice/pr-38-skill-review-rounds.md`

---

## 6. Scope 升级判定

C-tier follow-up commit 不无差别套主 PR rigor. 4 级:

| 级 | scope | 强度 |
|---|---|---|
| 1 | ≥500 行 + 多维度 | 5-skill (PR-36/38 主 PR) |
| 2 | 任何行数 + auth/RBAC/SQL/SSRF/secret/新 attack surface | 1 specialist + 自验 |
| 3 | ≤50 行 + 单 finding follow-up | **solo verify + 跑测试, 跳过 specialist** |
| 4 | 纯 docs/JSDoc | solo eyeball |

**升级触发**: scope 描述含 "新 export" / "新 typedef" / "新 KV key" / "新 caller path" 任一 → 升 specialist (即使行数小).

---

## 7. Reviewer 漏的 bug 由 reviewer 亲手补防线

review 漏掉的 bug, **回归防线** (regression test / audit script / contract check) **由该 reviewer 自己实施**, 不要反问 "要我做哪个?" 不要派 agent 写也不要 defer 到 follow-up handoff.

**Why**: reviewer 亲手 close the loop = 把 "我下次会更仔细" 换成 "下次再漏也会被自动抓".

例: PR-51 漏 wrangler.toml binding cross-check → audit script 由 zeus 自己写 (不派别人) — 这条 audit 现在交 @metis lane.

---

## 8. Squash-verify 前置 (memory 教训)

fleet-status 显示 ahead=N **不等于**"未 push". PR squash-merge 后本地 commit hash ≠ main hash 会显示 ahead.

**ping "你没 push" 前必须先跑**:

```bash
gh pr list --state merged --head <branch>
```

CLAUDE.md "Squash workflow 注意" 段已警告. 不 squash-verify 就 ping = 错前提 = 浪费 fleet 时间 + 损 zeus 公信力.

---

## 9. Spec-authoring PR 也是 B-tier

含 fix snippet / 代码示例的 spec-authoring PR 也命中 B-tier, 因为 spec snippet 会被实施者复制粘贴成代码 → 错误等同代码错误, 必须 reviewer 闭环.

例: 2026-04-26 PR #43 (W1.6 子 spec) — solo manual review 通过, security-reviewer round-2 抓出 3 BLOCKER + 8 处 frontmatter touches 缺失.

---

## 10. ECC Agent toolbox 一览

| ECC agent | 适用 |
|---|---|
| `code-reviewer` | 通用代码质量 / 模式 / best-practice |
| `security-reviewer` | OWASP / SSRF / injection / unsafe crypto / secret leak |
| `database-reviewer` | SQL / schema / migration / index / N+1 / D1 multi-db |
| `typescript-reviewer` | TS 类型 / async / Node/web 安全 / idiom |
| `silent-failure-hunter` | swallowed errors / bad fallback / 缺 error propagation |
| `code-architect` | 架构 blueprint / 文件 / interface / data flow / build order |
| `code-explorer` | 现有 codebase 深度分析 (新功能前 informed) |
| `a11y-architect` | WCAG 2.2 / inclusive UX (web + native) |
| `e2e-runner` | Playwright E2E / 关键用户流 |
| `pr-test-analyzer` | PR 测试覆盖质量 / 行为覆盖 / 真实 bug 防御 |
| `tdd-guide` | 强制 write-test-first / 80% 覆盖率 |
| `refactor-cleaner` | 死代码 / 未使用 / 重复消除 |
| `comment-analyzer` | 注释准确性 / 完整性 / rot 风险 |
| `type-design-analyzer` | type 封装 / invariant / 强制 |
| `performance-optimizer` | 瓶颈 / bundle 大小 / runtime / profiling |
| `healthcare-reviewer` | 临床安全 / PHI 合规 (项目特定, e.g., 医疗类项目用) |
| `seo-specialist` | 技术 SEO / 结构化数据 / Core Web Vitals |

调用方式: `Agent(subagent_type: "<name>", prompt: "...")`. themis 决定派哪个.
