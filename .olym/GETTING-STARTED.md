---
id: olym-getting-started
type: framework-onboarding
scope: cross-project (跨项目通用)
target-reader: 新 PM / 项目负责人 / fleet member 第一天
estimated-time: 30 minutes
---

# Olym Getting Started — 30 分钟 onboard

> 新加入 olym? 这 30 分钟读完, 你能开始 dispatch first handoff.

## What is Olym (3 min)

Olym 是 multi-agent AI-native dev OS — 不是 npm framework, 是 starter template + 协议体系. 1-5 人 solo / 小团队用 Claude Code 作主力 AI agent 跑全栈开发的 OS layer.

核心特征:
- **Claude Code as primary AI agent** — 主驱动, 不是辅助
- **Greek-pantheon fleet personas** (zeus / athena / daedalus / apollo / hephaestus) — 跨项目稳定身份, 可改 role-name alias (e.g., backend-owner)
- **Git-based handoffs across worktrees** — fleet 通过派遣单异步协作, 不实时 chat
- **5 层架构**: Identity / Knowledge / Protocol / Tooling / Pipeline
- **Solo or small-team** — 1 个 bao + N 个 Claude session 是常态

## Install (5 min)

照 [`README.md`](../README.md) "Bootstrap 5 steps" 跑一遍. 关键 checkpoints:
1. Clone hello-olym 作 starter (不是 `npm install olym`)
2. Fork 后 rename 项目, **保留 `.olym/` 目录结构** — 这是 SSOT
3. 跑 `scripts/install-hooks.sh` 装 pre-push / post-merge
4. 验证 `bash scripts/fleet-status.sh` 跑通 (fleet 5 人花名册显示)
5. 读 `.olym/CLAUDE.md` 的 **#0 元规则 "目标导向"** — 一切以 ship value 为终点

## 5 Core Concepts (10 min)

1. **Persona (人物)** — Greek 神或 role-name alias. 跨项目 stable identity, 4 文件: `skills.md` / `memory.md` / `persona.md` / `growth-log.md`. 见 `.olym/personas/<name>/`.
2. **Lane (工位)** — Abstract slot (lane-A/B/C/D/E/F). Consumer fork 时 `assign persona × business` 给 slot. Lane ≠ persona — 同一 persona 可换 lane.
3. **Business (业务)** — Consumer-specific 业务域 (e.g., admin / creator / marketing / infra). Lane slot 绑业务, persona 可换.
4. **Handoff (派遣单)** — fleet 协作 channel. 文件位于 `.olym/handoffs/`, ID 格式 `H-YYYY-MM-DD-NNN`. Cross-lane 通过 handoff 通信, **不直接 message**.
5. **Main loop (10 stage)** — `TRIGGER → RESEARCH → ADR → SPEC → HANDOFF → LANE → PR → MERGE → VERIFY → LEARN`. 反 ADR-002 "atomic single-PR cutover 撞墙" 反例 — 大改必 spec 先行 + 分阶段 cutover.

## 10 Min Your First Try

```bash
# 1. 看 fleet status
bash scripts/fleet-status.sh

# 2. 看 1 个 handoff sample
ls .olym/handoffs/            # 找 INDEX.md 或 _template.md

# 3. 起 spike (mini research)
bash scripts/scratch-new.sh spike my-first-topic
# → 创建 .worktrees/scratch/spike-my-first-topic
# → 创建 .olym/research/spikes/my-first-topic-<date>/

# 4. 看 personas
ls .olym/personas/            # 5 fleet member, 各 4 file
```

跑通这 4 步 = 你已 onboard 完成 first try.

## What to Read Next (5 min)

读完上面后, 按顺序:

- [`.olym/olym-handbook.md`](olym-handbook.md) — 一页 navigator (深入索引)
- [`.olym/protocols/main-loop.md`](protocols/main-loop.md) — 10 stage dev loop 协议
- [`.olym/protocols/evolution.md`](protocols/evolution.md) — 持续提升机制
- [`.olym/steering/olympus-protocol.md`](steering/olympus-protocol.md) — 12 协议索引 (handoff / review / git / conduct / knowledge / verification 等)
- [`.olym/CLAUDE.md`](CLAUDE.md) — framework instructions (含 **#0 元规则**)

## When Stuck

| 情况 | 看哪里 |
|---|---|
| install / setup 卡住 | `README.md` "Bootstrap 5 steps" |
| 概念不懂 (lane? handoff?) | `olym-handbook.md` |
| 协议怎么走 | `.olym/protocols/<topic>.md` |
| 跨 lane 协调 | Zeus (orchestrator) — 唯一跨 lane 入口 |
| persona / fleet 人事 | `.olym/steering/olympus-roster.md` |

## Gotchas

- **Don't** 把 olym 当 npm dependency — olym 是 **starter template**, 不是 npm package
- **Do** 读 README 再假设 mental model — 直觉常错
- **Don't** 给 bao 抛"3 选 1"决策题 — zeus / lane owner 自决, 不绕路
- **Do** Day 1 起 empirically 验证每步 (跑 fleet-status / scratch-new / 真起 worktree)
- **Don't** 子任务自循环 (cleanup / spec / protocol 反复打磨自己) — **#0 元规则反漩涡**: 一切回到 ship value
- **Don't** 跳 git hooks (`--no-verify` 禁用) — pre-push 检全英 code 是硬约束
- **Do** 中文沟通, 英文 code — 双轨, 不互混

---

读到这, 30 分钟到. 现在你能:
1. 起 first handoff (复制 `_template.md` 改 ID + content)
2. 起 first worktree (跑 `worktree-new.sh <persona> <lane> <branch>`)
3. 知道哪里查协议 / 概念 / 人事

Welcome to olym. Ship value, not docs.
