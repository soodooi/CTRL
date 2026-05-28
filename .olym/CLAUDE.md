---
id: olym-claude-md
type: framework-instructions
scope: cross-project (olym framework asset, git 即用)
consumer-load: 各 consumer project CLAUDE.md 顶部应加 `> Framework: see .olym/CLAUDE.md`
---

> ⚠️ **CTRL 在灵活开发模式 (2026-05-25 钦定)** — **不写 handoff / 不跑 RFC 5 步 / 不跑 main-loop 10 阶段 / 不写 digest / 不跑 EOD audit**. 只做 3 件事: **ADR + 代码 + PR**. 详见项目 `CLAUDE.md` "Working mode: 灵活开发" 一节. 本文件其他流程 (handoff / RFC / monitor / dike) 在 CTRL 此期间一律 **暂搁**.

# Olym Framework Instructions

> Framework-level conventions, philosophy, fleet protocol, git workflow. 跨项目通用 — consumer project (`<consumer-project>` 等) 在自己的 CLAUDE.md 顶部 reference 此文件即可.

## Rules (framework — 跨项目通用)

- 代码全英文（注释、UI 文本、API 响应、错误信息）— pre-push hook 自动检测，违规阻止推送
- 不创建 .md 文档（README.md、framework spec / handoff / best-practice / docs / steering 例外）
- 模棱两可的指令直接对话框询问
- 开始前查 framework `skills/` 和 `best-practice/`
- 禁止 `--no-verify` 跳过 git hooks
- API keys 存 Cloudflare KV (`config:*`)，禁止硬编码

## Design Philosophy

> 跨 session 的强约束。冲突时优先级：**目标推进 (<consumer-project> 上线 / capability ship / 收入) > 硬规则 (上方 `## Rules`) > 设计哲学 (本节) > 实施细节**。
> 实施跟哲学有 gap 时，gap 标在哪条下面，不要假装不存在。
> 哲学跟目标推进冲突时，让步推进目标，把 gap 记录到 `### Decision log`。

### 元规则 — 目标导向 (奔着目标去, 钦定 2026-05-17)

0. **任何 spec / refactor / protocol / cleanup 先回答"这推进什么目标?"**
   - 目标 = <consumer-project> 上线 ship / capability 上货 / 收入 / fleet 协作不卡 / bao 决策面板更清晰
   - 不为哲学完美 ship 残缺系统 — **反例**: 某 monolithic refactor 激进单 PR + atomic cutover, 后续多 `restore` commit + `<consumer>-edge-worker` 新增 worker 来愈合残缺. 名义 done; 实际系统残缺等到后续 restore PR 才填洞, 整周 churn
   - **"正确" < "推进"** — Phase 1 ugly but works > Phase 0 elegant but stuck
   - **检查问句**: 派 handoff / 开 PR / 写 spec 之前口头说"这是为了 ___ (具体可见 ship 目标)", 说不出 OR 目标 > 1 周才见 ship value → 砍 / 拆 / 推迟
   - **反漩涡**: cross-cutting cleanup / spec rewrite / protocol clarify 的存在意义全是 unblock 上面的目标, 不要陷入这些 sub-goal 自循环 (cleanup 为 cleanup, spec 为 spec, protocol 为 protocol)
   - **应用到 fleet 派遣**: bao 视角看每个 active handoff 应该 1 句回答"这推进什么", 答不出 → archive / 合并 / 砍

### 强一致 (no caveat — 任何新代码都要遵守)

1. **AI-native, advisory-only — 4-mode gate**
   - 4 mode: READ / PROPOSE / EXECUTE / APPROVE
   - "AI propose ≠ AI execute" — destructive 操作必须经 bao 批准
   - 实施: `packages/platform/src/capability/` 的 4-guard pipeline (persona / RBAC / approval gate / idempotency)
   - 任何新 AI 接入必须走 capability layer，禁止直接 D1 / KV / 外部 API。

2. **1 engine + N spec paradigm — spec-driven discipline**
   - 业务变化用 spec (声明)，引擎不变 (代码)
   - SSOT: Drizzle entity ontology → derive D1 schema / Zod validator / MCP tool / capability handler
   - System prompt / few-shot 同样 externalized (`.olym/personas/*.md` + `.few-shots.json`)
   - 新业务规则先改 spec，不要改 engine

3. **Polymorphic strategy registry over hardcoded branches**
   - N 种变体用 registry/union/factory，不写 if/else
   - 实施样本: `CapabilityRegistry` (10 entity × 6 verb 自动派生) / `LogosEventType` union (3 event_type)
   - if/else 超过 3 个分支立刻抽 registry

4. **Olym multi-agent dev OS — 5 层 + Greek persona fleet**
   - 5 层: Identity / Knowledge / Protocol / Tooling / Pipeline
   - Fleet protocol (handoff / signature / review tier) 每 session 都遵守
   - 见上方 `## Olympus` 段 + `.olym/steering/olympus-roster.md` + `.olym/steering/olympus-protocol.md`

5. **代码全英 + 中文沟通**
   - code / UI / API / error message 全英文 (pre-push hook 自动检测)
   - commit message body / handoff content / 跟 bao 对话: 中文 OK
   - 例外白名单见 `scripts/pre-push-check.js` 的 `CHINESE_ALLOWED_FILES`

### 方向一致，实施有 gap (新代码要靠近哲学，不能反向漂)

6. **Immutable by default**
   - TypeScript / capability invocation / React props 默认 immutable input
   - In-memory data 用 spread / `{...obj, field: value}`，禁止 `obj.field = value`
   - **Gap**: D1 `UPDATE` 不可避免 mutate persisted state。补偿手段 = #7 audit log 维持 history
   - 新代码: in-memory immutable 必须；DB mutation 配 audit 写入

7. **Audit-first, 7y retention — immutable event stream**
   - 关键 mutation 走 immutable event stream (民航 M15 模式)
   - **当前实施 ~30%**: capability approval gate / KB proposals / autonomy transitions 已接
   - **Gap**: order / customer / inventory 关键 mutation 没接 immutable event stream
   - 新 destructive capability: 必须经 `proposals` 表 + `signal.record` audit (走 shared event-push helper 或 admin-side audit writer)

8. **Many small files (200-400 行)**
   - 软目标 400，硬上限 800
   - 反 god module — 1 文件 1 职责，文件名说人话
   - **Gap**: consumer 项目里某些聚合 handler / route 文件已破 400，未来重构机会拆
   - 新文件直接按 small module 写 (目标: 单一职责 30-50 行的工具模块)

### 有边界条件 (按场景决定)

9. **Anti-template, bespoke craft**
   - **明确反对**: shadcn / Element Plus / Vuetify / 其他成品 UI kit (component library)
   - **允许**: Tailwind / utility class / design token primitives — 不是 template，是 utility primitive
   - 当前实施: admin SPA 用 `<consumer-brand-pkg>/tailwind-preset` (consumer CLAUDE.md `## Visual Identity` 已钦定)
   - 品牌一致性靠 consumer 自己的 `packages/brand/` (OKLCH token + 字体配对 + 3-layer theming)，不是靠抄模板

10. **Per-tenant physical isolation — 取决于场景，YAGNI**
    - **当前**: <consumer-project> = 单租户，**不实施** multi-tenant
    - **决策延后**: 等下游 SaaS / 多租户 phase 启动时按场景决定
      - B2B SaaS / 合规重 (healthcare/金融) → physical isolation (独立 D1 instance + binding)
      - B2C / 海量小租户 → row-level (`merchant_id` column + RLS-equivalent)
    - **不要现在为未来场景 over-engineer**

### Decision log

- 10 条哲学固化进 CLAUDE.md (consumer + framework owner 共审)
- #9 Tailwind 划线: utility class 允许，component library 禁止
- #10 multi-tenant 决策延后至下游 SaaS phase
- #0 元规则 "目标导向 (奔着目标去)" 加入 CLAUDE.md (consumer owner directive: "奔着目标去这个思维写到开发哲学中"). 触发: zeus 清债 audit 发现某 monolithic refactor 名义 done 实际系统残缺 (后续 restore commit 痕迹), consumer owner 反弹"我们又恢复了很多 workers 因为系统残缺了". 后果: #0 作为元规则置于所有现有 10 条之上, 优先级 = 目标 > 硬规则 > 哲学. 应用: 任何 active handoff 答不出 1 句 ship value → archive

## Olympus (Multi-agent Fleet System)

> **新人 / cold start 先读**: [`.olym/olym-handbook.md`](.olym/olym-handbook.md) — 一页 navigator (≤250 行, 5 层 / fleet / protocol / RFC / milestone / 命令 全索引).

并行多 Claude 实例编制. **整套系统名 = Olympus** (希腊神栖息地, 全员希腊神 persona). 日常对话用 "fleet" / "团队" / persona 名 (`@athena` / `@apollo` / `@daedalus` etc) — Olympus 是 internal label.

**权威文档** (改名 / 退役 / 新增 / 协议变更先改这里):

- [`.olym/steering/olympus-roster.md`](.olym/steering/olympus-roster.md) — **7 位 fleet 花名册** (人事真相, v2.0 compacted 2026-05-05)
- [`.olym/steering/olympus-protocol.md`](.olym/steering/olympus-protocol.md) — 5 类协议法典:
  - [`protocol/handoff.md`](.olym/steering/protocol/handoff.md) — handoff / signature / 跨机器 / forward / collision / handover
  - [`protocol/review.md`](.olym/steering/protocol/review.md) — tier (ABC) / specialist 决策树 / fix-commit grep / scope 升级
  - [`protocol/git.md`](.olym/steering/protocol/git.md) — commit / branch / squash-verify / pre-push / worktree / lane-guard 6 步
  - [`protocol/conduct.md`](.olym/steering/protocol/conduct.md) — 处女座 / 不绕 / 收尾 sequence / 离线处理 / 自决
  - [`protocol/knowledge.md`](.olym/steering/protocol/knowledge.md) — KM 三层 + 4 目标 + daily iteration workflow
  - [`protocol/discipline.md`](.olym/steering/protocol/discipline.md) — 行为契约索引 (实际内容散在 conduct.md + MEMORY.md)
- [`.olym/specs/olympus/spec.md`](.olym/specs/olympus/spec.md) — 系统设计 spec (5 层架构权威)

### Fleet 7 位速查 (v2.2, 详见 olympus-roster.md)

7 位 = **1 zeus + 4 owner (业务×技术 matrix) + 2 reserved**.

> 2026-05-06 (ADR 002): zeus-2 / zeus-3 sub-personas hard-retire to zeus. 详 `.olym/decisions/002-zeus-fleet-collapse.md`.
> 2026-05-07 (ADR 003): @hephaestus un-retire → olym-platform owner-4. 详 `.olym/decisions/003-hephaestus-platform-owner.md`.

**主**:
- @zeus (orchestrator + cross-cutting + Identity/Knowledge/Protocol stewardship, main tree + 任意 borrowed worktree)

**Lane owner** (4 位, 业务×技术 matrix):
- @athena = (admin, 后端) — admin 业务路由 / admin workers / D1 + auth + API envelope
- @daedalus = (creator, 前端) — creator-facing apps + 前端实施 + VI 标准维护
- @apollo = (marketing, 数据库) — matrix social + landing + marketing D1
- @hephaestus = (olym-platform, infra) — VPS host ops / **consumer tenant interface for shared infra services** (NOT the service itself; shared infra = olym ecosystem cross-project per consumer ADR-001 §Cross-project note) / VPS agent runtime / packages/platform / deploy / 3 yaml lanes (platform+ops+hephaestus)

**Reserved** (2 位): owner-5 / owner-6 待 bao 决.

**Specialist** (zeus inline, 4 位, 不占 fleet 名额):
- @themis (review chief of staff) · @prometheus (backend tech) · @demeter (database tech) · @dike (zeus 管理质量审计)

**注意**: `hermes` (lowercase) = VPS Agent runtime (现 @hephaestus 维护), 不是 fleet persona. 不要混淆.

**已退役**:
- 2026-05-03: @dionysus → @apollo
- 2026-05-05: @atlas / @argus / @iris / @metis → @zeus / @daedalus / @dike (cascade 详见 olympus-roster.md)
- 2026-05-05: @artemis (冷冻)
- 2026-05-05: @hephaestus retired → **2026-05-07 un-retired (ADR 003)** — 当前 active olym-platform owner-4
- **2026-05-06: @zeus-2 / @zeus-3 → @zeus (ADR 002 矫正)**

详见 olympus-roster.md "退役历史".

### 速查命令

- `bash scripts/fleet-status.sh` — 树状态 + handoff 计数
- `bash scripts/worktree-new.sh <persona> <lane> <branch>` — 新 worktree
- `gh pr list --state merged --head <branch>` — squash-verify (protocol/git.md)

### Daily Iteration

新 zeus session 启动 → SessionStart hook 注入 (Roster + Protocol 索引 + active handoffs) → 当天 fleet coordination → zeus EOD 收尾 (protocol/conduct.md "Zeus 收尾 sequence") → commit + push EOD PR. 详见 protocol/knowledge.md "Daily Iteration Workflow".

## Git Workflow

**开新 feature branch** — 必须先 sync main，避免基于过时本地 main 起步：
```bash
bash scripts/git-new.sh feat/<name>     # sync main + 开 branch + 切过去（推荐入口）
```
禁止直接 `git switch -c` / `git checkout -b` 在未 sync 的本地 main 上开 branch。

**PR squash-merged 后** — 拉新 main + 清理已合并 branch：
```bash
git switch main && git pull --rebase
git branch -D <feat-branch>             # squash-merged 的必须用 -D，git cherry 看不出
```
`.husky/post-merge` 会软提示哪些 local branch 已合可清。

**Squash workflow 注意**：GitHub PR 用 squash merge，本地 feature branch 多个 commit → origin/main 上变一个新 hash。`git cherry` 看到 `+` 不一定 unmerged — 用 `gh pr list --state merged --head <branch>` 才权威。

**Commit message** — 完成 handoff 时加 `[H-YYYY-MM-DD-NNN]` 前缀。例：`fix(<scope>): [H-YYYY-MM-DD-NNN] <short description>`。
