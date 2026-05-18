# Protocol / Knowledge Management

> Olympus 系统的知识管理子系统. 三层模型 (capture / aggregate / steward) + 4 目标 + daily iteration workflow.
> Parent: [olympus-protocol.md](../olympus-protocol.md)

---

## 1. KM 三层模型

| 层 | 职责 | Owner | 触发 |
|---|---|---|---|
| **Capture** | 实时收集知识 (踩坑 / 经验 / 决策) | fleet **集体顺手** (规范化, 见 §3) | 每次完成任务时 |
| **Aggregate** | 周期整合 (CLAUDE.md / memory / best-practice) | **zeus** 收尾时整合 | daily (zeus EOD) |
| **Steward** | 标准化 + 跨项目复用 (template / 通用层抽取) | **zeus** + 未来 KM persona | starter 抽取触发时 |

---

## 2. KM 4 目标 (bao 拍板)

| 目标 | 实现路径 | 文件 / 工具 | 频率 |
|---|---|---|---|
| **G1. 日报** | zeus EOD 自动 generate (聚合 git log + handoff flips + PR merges) | ✅ **Done H-2026-05-06-005** `scripts/daily-digest.mjs --apply` → `.olym/digests/D-YYYY-MM-DD-digest.md` (5 sections: Commits / PRs / Handoff snapshot / Audit summary / Best-practices). dir changed handoffs/ → digests/ for separation. | daily |
| **G2. 可复用 dev env** | 抽 `hello-olym` repo (含 .claude/ + .olym/steering/protocol/* + scripts/) | 触发: 准备孵化第二个项目 | 一次性 |
| **G3. 可复用 skills** | `.claude/skills/` (Superpowers / Impeccable lock) + `.olym/skills/` 通用 vs 业务分层 | 通用层提取到 `.claude/skills/`, 业务留 `.olym/skills/<lane>/SKILL.md` | 持续 |
| **G4. 可复用 best-practice** | `.olym/best-practice/` template + 标准化 + 跨项目复用 | 模板化 + 通用层 cherry-pick 到 starter | 持续 |

---

## 3. Capture 层规范化

每个 fleet member 完成任务时**顺手 commit knowledge entry**. Capture 责任是 fleet 写 raw material 进 handoff body, **不是 fleet 直接写 best-practice/skills 终稿** — 终稿由 zeus EOD 收尾时统一提取 (Aggregate 层, §4).

| 知识类型 | fleet capture 位置 | zeus 终稿位置 | 时机 |
|---|---|---|---|
| **踩坑教训** (我做错了 X 因为 Y) | handoff body "讨论 / 备注" 段 + memory.md feedback | (留 handoff body, 不必抽出) | 完成 handoff 时 |
| **操作经验** (我学会了怎么做 X) | handoff body "操作经验" 段 | zeus 累积 3+ 次 → `.olym/skills/<lane>/SKILL.md` | 累积 3+ 次 |
| **反模式** (不要做 X) | handoff body "反模式 / 踩坑" 段 | zeus EOD 提取 → `.olym/best-practice/<topic>.md` | 单次 critical 教训 |
| **架构决策** (我们决定 X 因为 Y) | spec triplet 内 `decisions: D-NN` 或 handoff body decision 段 | (zeus 必要时抽 ADR → `.olym/decisions/NNN-...md`) | 决策时 |
| **跨 PR 反思** (PR-N 教训) | handoff body "PR 教训" 段 | zeus PR 闭环后 提取 → `.olym/best-practice/pr-<N>-<topic>.md` case study | PR 闭环后 |
| **基建配置 archive** (生产稳态记录) | handoff body "配置" 段 + 关键 ID 列清 | zeus EOD 提取 → `.olym/best-practice/<system>-<topic>.md` | spike / migration / hotfix 完 |

**反模式**: 把所有教训塞 memory.md 里 — memory 单文件 ≤180 行限制, 大教训应该独立文件 (走 zeus 提取路径).

### 3.1 单一 curator 原则 (writer responsibility)

为防 KM 文件格式漂移 / 重复 / 跨 lane 视角丢失:

**Fleet 写**:
- 自己 lane 内的 code / specs (lane.files match)
- handoff body 全部内容 (含 raw material — 踩坑 / 反模式 / 操作经验 / 配置 archive 全 inline)
- handoffs/ allowlist 文件 (任意 lane 可写)
- memory.md 不写 (single-writer = zeus, denylist Class 2)

**Zeus 写** (KM Aggregate 层 curator, EOD 收尾时统一执行):
- `.olym/best-practice/<topic>.md` — 提炼自 fleet handoff body 的反模式 / 配置 archive / case study
- `.olym/skills/<lane>/SKILL.md` — 提炼自 fleet 累积 3+ 次的操作经验
- `.olym/steering/**` — 协议 / SSOT / lane / roster 更新
- `.olym/decisions/**` — ADR
- `.olym/audits/**` — 审计输出
- CLAUDE.md / MEMORY.md 索引

**Why 单一 curator**:
- 跨 lane 视角 — zeus 知道 admin + creator + marketing 是否踩过同样坑 → 合并 vs 单写
- 格式一致 — 40+ best-practice 文件不漂移 (新 fleet member 看老文件能 mimick 写法)
- 去重 — zeus 知道哪条已写过, 哪条是真新
- denylist 阻 fleet 直写 best-practice/ + skills/ + steering/ 是 **设计 feature**, 不是漏洞 (2026-05-07 PR #113 误开尝试已 close 验证此原则)

**Why 不写"草稿 → review"模式**:
- fleet 写 best-practice 草稿 + zeus review 模式看似温和, 实践会 fall back 到 fleet 写完 zeus 不仔细 review 直接合 → 等于 fleet 单线 curator + 没有跨 lane 视角
- 现行模式 (fleet handoff inline + zeus EOD 提取) 强制 zeus 真读 + 真写, curator 角色不空转

---

## 4. Aggregate 层 (zeus EOD)

zeus 收尾时整合 (protocol/conduct.md "Zeus 收尾 sequence" §3):

```
1. 扫 fleet 全状态 + ping 在线 fleet
2. 整合各方回报到 handoff body / memory
3. 更新 olympus-roster.md (人事变更)
4. 更新 protocol/* (规则迭代)
5. 提取 best-practice (新踩坑独立成文件)
6. 压缩 memory.md (老 entry 提取到 best-practice)
7. generate daily digest (G1 目标)
8. commit + push EOD PR
```

---

## 5. Steward 层 (周期 / 触发)

未来 KM persona 或 zeus 触发:

| 触发 | 动作 |
|---|---|
| memory.md > 180 行 | 老 entry 提取到 best-practice (硬限对齐 MEMORY.md header) |
| protocol/* 单文件 > 500 行 | 拆子文件 (e.g., review.md → review.md + specialist.md) |
| best-practice/ > 30 文件 | 按 topic 分类目录 (e.g., best-practice/git/ best-practice/review/) |
| 准备孵化第二个项目 | 一次性 refactor protocol/* 抽象化 + 抽 olympus-starter repo (G2) |
| skills 累积 > 10 个跨业务通用 | 提取到 `.claude/skills/` (G3) |

---

## 6. Daily Iteration Workflow

```
新 zeus session 启动 (08:00 PT 假设)
│
├─ SessionStart hook 注入:
│   ├─ olympus-roster.md 摘要 (谁在 fleet)
│   ├─ olympus-protocol.md 索引 (5 类规则链接)
│   ├─ active handoffs (按 lane 分组)
│   └─ recent updates (last 48h)
│
├─ 当天 fleet coordination
│   ├─ ping fleet (capture 层 — 各方完成任务顺手 commit)
│   ├─ review queue (themis 派 specialist, protocol/review.md)
│   └─ spec / handoff iteration
│
├─ EOD (zeus 收尾)
│   ├─ protocol/conduct.md "Zeus 收尾 sequence" §3 全 7 步
│   ├─ aggregate 各方知识 → memory / best-practice / protocol
│   ├─ generate daily digest → .olym/handoffs/D-YYYY-MM-DD-digest.md
│   └─ commit + push EOD PR
│
└─ 下次启动 接续
```

---

## 7. KM 跟其他 Protocol 协议关系

| Protocol | KM 关系 |
|---|---|
| [handoff.md](handoff.md) | handoff body 是 capture 主要载体 (踩坑 / 决策都在 body) |
| [review.md](review.md) | review 漏的 bug 提取 best-practice case study (PR-38/39/51) |
| [git.md](git.md) | commit message [H-id] 是 capture 索引 (knowledge → git log 关联) |
| [conduct.md](conduct.md) | "处女座 + 不绕 + 收尾" 是 KM 实施保障 (没纪律 KM 失效) |

---

## 8. Cross-machine fleet 同步 (KM 长期任务)

**问题**: bao 多台机器 (laptop + desktop), 本机 zeus 看不到台式机 fleet 状态.

**当前应对**: handoff git push + bao 中转.

**KM 长期改进** (待建):
- 共享 status branch (e.g., `fleet-status`) — 各 worktree 周期 push status snapshot, 本机 zeus pull 看
- 离线 fleet 自动检测 (zeus 启动时 git fetch + 报 "X 上次 push N 天前, 可能离线")

---

## 9. KM 不是独立 spec — 融合进 Olympus

**Why**: bao 拍板 "知识管理可以融合进去, 成为一个大的系统". KM 是 Olympus 的子系统, 不独立 spec.

**实施**:
- ❌ 取消 `.olym/specs/knowledge-management-v1/`
- ✅ KM 协议入 protocol/knowledge.md (本文件)
- ✅ KM 产物分布在 `.olym/best-practice/` `.olym/skills/` `memory.md`
- ✅ daily iteration 即 KM 实施 (zeus EOD aggregate)

---

## 10. Anti-pattern (KM 失败模式)

| 反模式 | 正确做法 |
|---|---|
| "我下次会更仔细" (口头承诺) | 写 audit script / regression test (protocol/review.md "Reviewer 漏的 bug 由 reviewer 亲手补防线") |
| 教训写 memory 单条 > 10 行 | 抽到 `.olym/best-practice/<topic>.md`, memory 留 link |
| handoff done 后留过期 body | done + PR merge 满 7 天 → 删 (protocol/handoff.md §14) |
| protocol 改动不同步 memory | zeus 每次改 protocol 必检查 memory 相关 entry 是否 stale |
| Capture 由 zeus 独占 | fleet 集体顺手 (本文件 §3 规范化) |

---

## 11. KM 度量 (未来加)

待 KM persona 或 zeus 设计:
- best-practice 文件数 / 月 (capture 速率)
- memory 行数趋势 (压缩节奏)
- specialist agent 调用次数 / PR (review 强度)
- handoff cycle time (open → done 平均时长)
- daily digest 生成稳定性
