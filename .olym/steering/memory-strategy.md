---
inclusion: always
---

# Memory Strategy

> Claude per-project auto-memory 整理策略. 硬限 ≤180 行, 单文件.
> Sibling: [protocol/knowledge.md](protocol/knowledge.md) (KM 三层模型, memory 是 capture 层一部分).

## 0. Where memory lives

Claude per-project memory 在用户机器:
```
~/.claude/projects/<project-slug>/memory/
└── MEMORY.md     # 单文件, ≤180 行, 自动注入每次 session
```

**不进 git 仓** — 这是 per-machine claude state, 跟项目代码独立. 多人 fleet / 多机器 bao 各自 maintain (跨机同步靠 git handoff).

## 1. 单文件原则

- MEMORY.md 是 Claude 唯一的 quick-context memory 文件
- 每次 session 自动注入, 硬限 ≤180 行
- 超 180 行 = 触发压缩 (老 entry 提取到 `.olym/best-practice/`)

## 2. 什么放 MEMORY.md (auto-injected)

| 类型 | 示例 |
|---|---|
| **User identity** | bao 角色 / 沟通偏好 / 决策风格 |
| **Project current state** (短) | active milestone / 关键约束 / staleness 警惕 |
| **Discipline 索引** | 不存内容, 链 protocol/conduct.md 等 SSOT |
| **High-recall facts** | API 计费 / 常踩坑 / 关键决策 (≥10 行抽到 best-practice) |

## 3. 什么不放 MEMORY.md (抽到别处)

- 长 rule (>10 行) → `.olym/steering/protocol/conduct.md` (行为契约) / `spec-discipline.md` (spec 写作) / `.olym/steering/` 其他规则文件
- 大设计 → `.olym/specs/<feature>/spec.md`
- 个人战略 (隐藏) → bao 自己的 obsidian / 私人笔记 (不进 zeus memory)
- 历史复盘 (1 次性) → `.olym/audits/` 或 `.olym/best-practice/`

## 4. 整理触发

| 触发 | 动作 |
|---|---|
| MEMORY.md > 180 行 | zeus 选老 entry 提取到 best-practice, memory 留 1 行 link |
| 同类 entry ≥3 个 | 提取到 `.olym/skills/<lane>/SKILL.md` (累积操作经验) |
| 跨 session 重复 entry | 提取到 protocol 或 steering (永久规则) |
| Project state 变 | 老的 staleness flag, 直接改 / 删 |

## 5. Memory 跟 protocol/knowledge.md 关系

`protocol/knowledge.md` §3 capture 表把 "fleet capture 位置" 跟 "zeus 终稿位置" 拆开.

MEMORY.md 落在:
- **fleet capture** — fleet 不写 MEMORY (denylist Class 2, single-writer = zeus)
- **zeus 终稿** — zeus 决定哪条进 memory, 哪条进 best-practice / steering / protocol

简单说: **MEMORY.md = zeus 唯一可写, 其他人发现可入的 entry 通过 handoff body 给 zeus, zeus EOD 整合时决定**.

## 6. Anti-pattern (memory 失败模式)

| 反模式 | 正确做法 |
|---|---|
| MEMORY.md 写 50 行 explainer (复杂规则) | 抽到 `protocol/<topic>.md`, memory 留 1 行 link |
| 业务事实重复维护 (CLAUDE.md + MEMORY.md 各写一遍) | CLAUDE.md authoritative, memory 仅写 zeus 个人 working notes |
| 教训写 MEMORY.md 单条 > 10 行 | 抽到 `.olym/best-practice/<topic>.md` |
| Fleet 想加 memory entry → 直接编辑 | 错. 改走 handoff body, zeus EOD review 后决定 |
