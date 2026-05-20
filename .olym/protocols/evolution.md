---
id: olym-evolution
type: protocol
status: active
scope: cross-project (olym framework asset, git 即用)
created: 2026-05-17
---

# Olym 持续提升机制

> Olym = 通用开发框架. Consumer project 实战 lessons 持续回流, 不让框架变 dead artifact.
> 任何 consumer (POD / SaaS / 桌面工具 / B2B / 出海 ...) git pull olym 即可消费此 protocol.

## 1. Contribution sources (好提交来源)

好的框架升级永远来自实战, 不来自空想:

1. **Consumer 项目实战** — 踩坑 / 新 pattern / fleet 协作经验 / 工具链调整
2. **Persona growth-log** — 个人成长 lesson (`.olym/personas/<name>/growth-log.md`)
3. **Spike / Proposal / PoC RESULT** — 验证证据 (`.olym/research/`)
4. **ADR retro** — 撞墙复盘 (e.g., 某 monolithic refactor 反例, 某 cutover 失败)

任何 source 不带 RESULT / 证据 / 反例 → 不进框架, 留在 consumer 项目内部.

## 2. Channels (回流路径)

```
 consumer 实战 (踩坑 / 新 pattern)
        │
        ▼
 zeus propose  ──►  scratch worktree (proposal)
        │
        ▼
 bao 审 + cross-project consumer 共审 (跨项目 ADR)
        │
        ▼
 olym 框架升级 (decisions/, skills/, personas/, protocols/)
        │
        ▼
 downstream consumer git pull → 消费升级
```

单项目内部 lesson → 留 `.olym/best-practice/`.
跨项目可复用 lesson → 提升至 olym framework (本 protocol scope).

## 3. Cadence

| 节奏 | 谁 | 干什么 |
|---|---|---|
| EOD | persona 自己 | growth-log + 1 行 "本周 olym 可提升点" |
| 每周 | zeus | synthesize fleet growth-log, 如有 → 提 olym proposal |
| 每月 | bao | 跨项目 synthesis, ack olym 升级, 决定 propagate 节奏 |

EOD 没料 → 跳过, 不强写; 每周没料 → 跳过, 不凑数.

## 4. Decision authority

| 改动 | propose | approve |
|---|---|---|
| skill 模板 / persona few-shot | 任何 persona / zeus | bao |
| protocol 变更 | zeus | bao |
| framework ADR | zeus + cross-project consumer | bao + cross-project 共审 |
| persona 新增 / 退役 | zeus | bao (需 ADR) |
| lane slot 命名 | zeus | bao (需 ADR) |

跨项目 ADR 必须列出每个 consumer 受影响面, 否则 bao 拒批.

## 5. Research lifecycle — Spike / Proposal / PoC (mini 4 stage)

3 类轻量单元, 对比 handoff (重型 9 stage) 更适合"先回答一个问题":

| 类型 | 问什么 | 输出 | timebox |
|---|---|---|---|
| Spike | "可不可行?" | 决策证据 RESULT | 1-3 day |
| Proposal | "提议如何做?" | 选项 A/B/C 决策文档 | 1-2 day |
| PoC | "选定方案能不能跑?" | demo + 验证报告 | 1-5 day |

### 存储

```
.olym/research/
├── proposals/<topic>-<YYYY-MM-DD>/
├── spikes/<topic>-<YYYY-MM-DD>/
└── pocs/<topic>-<YYYY-MM-DD>/
```

### Frontmatter (统一)

```yaml
---
id: SPIKE-YYYY-MM-DD-NNN  # 或 PROP-... / POC-...
type: spike | proposal | poc
status: draft | approved | in_progress | done | killed
reporter: zeus | bao | <persona>
assigned_to: zeus | <persona>
timebox: 1-3 day              # 必填
worktree: scratch/<type>-<topic>  # optional
goal: "answer ___ decision"   # 必填, 见 §6 #0 元规则
parent_adr: <path>            # optional
created: YYYY-MM-DD
---
```

### Lifecycle 4 stage

```
draft → approved (bao 一句 ack) → in_progress (起 scratch worktree 或自接) → done | killed (RESULT 入 main)
```

### Dispatch 3 路径

1. **Main-inline** — zeus 自接, ≤ 1 day, 不开 worktree
2. **Scratch worktree** — `.worktrees/scratch/<type>-<topic>/`, 独立 git tree, 不污染 lane
3. **Lane worktree** — 派给 lane owner, 在 lane 持久 worktree 干 (适合跟 lane 强相关 spike)

选哪条: timebox < 1day & 跟 lane 弱相关 → main-inline; 短期独立调研 → scratch; 跟现有 lane 紧耦合 → lane.

## 6. #0 元规则守护 (目标导向)

Olym 的根命题: **任何 artifact 必须能回答 "跑完后能做什么决策?"**. 守护规则:

- 所有 Spike / Proposal / PoC 必 **timeboxed**, 否则陷 research loop (anti-pattern)
- frontmatter `goal` 必填, 必须可一句话翻译成"做出 X 决策"
- 答不出 goal → 砍, 不要做
- **失败优雅**: spike 证明不可行 = 成功 (省了未来撞墙), 不是浪费, RESULT 照写
- **反例**: 某 monolithic refactor 有 spike 没 PoC, atomic cutover 撞墙 → 后续靠 restore PR 愈合系统残缺. 教训 = "改动幅度 ≥ X 时强制 PoC, 不只 spike"

## 7. Anti-pattern

| 反例 | 处理 |
|---|---|
| 已有 spike topic 重复触发 | 引用历史 spike, 不重做 |
| "看似复杂实际成熟 pattern" (e.g., 业内 5 年标准) | 不 spike, 直接 ship |
| spike / PoC 跑完没 ADR / skill / protocol 引用 | kill (孤儿 = bloat, 季度 prune) |
| protocol / spec / cleanup 不答 ship value | archive, 不消耗 fleet |
| 业务踩坑就改 olym framework (不抽象) | 留 consumer `.olym/best-practice/`, 不污染框架 |
| persona growth-log 全是流水账, 0 lesson | EOD 跳过, 不要凑数 |

## 8. Versioning

Olym framework 自身按 semver:

- **patch** — 拼写 / 措辞 / 内部链接
- **minor** — 新增 skill / persona few-shot / protocol section (向后兼容)
- **major** — protocol 强约束变更 / persona slot 重命名 / 删 skill (consumer 需 migration)

每次 major 必带 `decisions/<NNN>-<title>.md` ADR + consumer migration note.

## 9. 相关协议

- `protocols/handoff.md` — 重型工作单元 (跨 lane / multi-day) 协议
- `protocols/review.md` — review tier ABC
- `protocols/conduct.md` — fleet 行为契约 (含 EOD 收尾)
- `protocols/knowledge.md` — KM 三层 + daily iteration

本 protocol 跟以上互补: handoff 管"做事", evolution 管"框架自身怎么进化".
