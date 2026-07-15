---
title: CTRL 极简单人开发 harness — 全局规划图
status: governing (dev-environment)
date: 2026-06-19
owner: bao
decided_by: bao (AskUserQuestion 2026-06-19 — 选「激进剥离」)
---

# 极简单人 harness — 砍 / 留 / 改 全局图

> bao 2026-06-19 钦定：开发环境**全量升级到 110% 且极简**。
> 路径 = **激进剥离** Olym 多智能体重型层，只留单人极简 harness，核心循环升到天花板。
> 本文是 system-design-first 的统管全局图 —— 先有它再动手，不 debug 式逐个删。
> 当前实现 runtime 已迁移到 Kiro；下面以 checked-in `.kiro/` 资产为准。

## 设计原则

开发环境 = Kiro 每次运行时**加载/执行**的东西(steering / hook / skill) + repository hooks。
极简针对**运行时 harness**，不是静态历史文档。判据：

- **空转即砍** —— 单人模式下永不触发的多智能体机制(lane / handoff / fleet)。
- **漂移即修** —— 引用退役的 Olym/Claude runtime、Pi 或旧端口 17878 的代码。
- **保命线绝不动** —— 全英文、no-`--no-verify`、ADR 引用、验证门槛、secret 检查。
- **SSOT 绝不删** —— `vault/ctrl/adrs/`、`vault/ctrl/` 和 `.kiro/steering/development-philosophy.md`。

## 保留 (核心 + 保命线)

| 部件 | 角色 |
|---|---|
| `.kiro/skills/goal/SKILL.md` + `.kiro/skills/dev-loop/SKILL.md` | 唯一入口；目标驱动循环 |
| `.kiro/steering/development-philosophy.md` | development contract + design philosophy + hard rules |
| `.kiro/hooks/session-context.json` | SessionStart 注入 GOAL + Git truth |
| Husky + CI | diff-aware 全英文、secret、ADR-citation、dual-surface 与编译/测试等 deterministic repository gates |
| Release gate | accepted ADR acceptance 严格审计；CI 仅 soft-report 已有 acceptance debt |
| Runtime/UI evidence | 由 Kiro `dev-loop` 按改动要求执行；`:17873` smoke 另有 nightly/manual CI，不伪装成每次 push 都能通用执行 |
| `vault/ctrl/adrs/` (ADRs + INDEX/PROCESS/DRIFT) | **唯一架构 SSOT，绝不删** |
| independent semantic reviewer | 非平凡变更的 maker/checker 分离 |
| `scripts/`: governance / ADR acceptance / bump-version / escape-cjk / git-new / release.sh | 日常工具与发布 gate |

## 升级到 110% (当前落点)

1. **Kiro steering** — `.kiro/steering/development-philosophy.md` 统一 hard rules、设计哲学、ADR-first 与 verification-before-completion。
2. **dev-loop skill** — `.kiro/skills/dev-loop/SKILL.md` 要求 affected compiler/type check、targeted tests、`:17873` gate smoke、UI visual evidence(as applicable)和 independent semantic review。
3. **goal skill** — `.kiro/skills/goal/SKILL.md` 锁 `vault/ctrl/GOAL.md` 为唯一 active goal;缺 goal 不擅自发明。
4. **session context** — `.kiro/hooks/session-context.json` 运行 `.kiro/scripts/session-context.cjs`,只注入 active GOAL + Git truth，不恢复 fleet/handoff snapshot。

## 已剥离 / 不恢复 (历史裁决)

- Olym lane、persona、fleet、handoff dispatch 和 RFC 编排 runtime；历史 handoff 只在 `vault/ctrl/history/handoffs/` 保留。
- Olym audit/brainstorm 的 runtime 角色；内容资产分别归档到 `vault/ctrl/history/audits/` 与 `vault/ctrl/history/brainstorm/`。
- Claude-era project hooks、rules、skills 和 project-entry contract；当前 normative contract 是 `.kiro/steering/development-philosophy.md`。
- 退役脚本族: `audit-olym-*`、`audit-all`、`audit-olympus-health`、`auto-validate.sh`、`daily-digest`、`fleet-status`、`handoff-sync`、`handoffs-archive`、`handoffs-index`、`pre-push-dispatch-check`、`scratch-new`、`specs-archive`、`specs-index`、`adr-check.py`、`keycap-to-mcp-rename`、`olym-doctor.sh`、`olym-install.sh`、`worktree-new/remove`、retired probes、`release.ps1`。

## 恢复方法 (若未来经新决策恢复多人编排)

剥离历史仍可从 Git 查阅；不要直接重新激活旧 runtime。先由 bao 建立新目标/ADR，明确 Kiro-compatible 的协作需求，再按最小机制实现。当前多会话开发只采用 `vault/ctrl/team-workflow.md` 的 worktree + PR 模式。
