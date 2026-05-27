# Best Practice

> Curated 踩坑教训 / 反模式 / 配置 archive / case study. Single curator = zeus (per protocol/knowledge.md §3.1).

## What goes here

- 反模式 (don't do X, here's why) — 单次 critical 教训, zeus EOD 提取自 fleet handoff body
- 基建配置 archive — 生产稳态记录 (e.g., VPS / DNS / CF tunnel ID / certificate paths)
- PR 案例研究 (PR-NN) — review 漏的 bug 复盘
- 跨 lane 经验沉淀

## What does NOT go here

- 短期 plan (open handoff 即可)
- 业务模块 SOP (`.olym/skills/<lane>/SKILL.md`)
- ADR (`.olym/decisions/`)
- evergreen 规则 (`.olym/steering/`)

## Writer responsibility

- **Fleet 写 raw material 进 handoff body** — 反模式 / 配置 archive / 踩坑教训 inline
- **Zeus EOD 提取** — fleet handoff body raw material → 终稿 best-practice 文件
- **Fleet 不直接写本目录** — denylist_explicit (`lane-ownership.yaml`)

详 `.olym/steering/protocol/knowledge.md` §3.1.
