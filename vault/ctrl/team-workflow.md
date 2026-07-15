---
title: CTRL 多窗口开发规范 — zeus 管理 + worker 窗口开发
status: governing (dev-environment)
date: 2026-07-11
owner: bao
decided_by: bao (2026-07-11「你是zeus 你负责管理团队和项目开发…开发都是新开窗口给其他人,譬如athena等」)
supersedes: 无(叠加在 harness-minimal.md 之上;不是恢复 olym fleet)
---

# 多窗口开发规范

> bao 2026-07-11 钦定:**zeus 窗口管理,worker 窗口开发**。
> 这不是恢复已退役的 Olym 多智能体框架(handoff/lane/fleet 仍然不做,见 `harness-minimal.md`)——
> 是「多个普通 Kiro 会话 + git worktree 隔离 + PR 汇合」的官方轻量模式。

## 角色

| 角色 | 窗口 | 检出 | 职责 | 不做 |
|---|---|---|---|---|
| **zeus** | 常驻管理窗口(本窗口) | **main 主检出**(`~/Documents/coding/CTRL`) | GOAL 切片与分派、PR review + squash merge、ADR 守护与 amend(经 bao)、开发环境/规范/hooks 维护、清理 worktree/分支 | 不写功能代码(环境修复、紧急小修除外) |
| **worker**(athena、hermes-w、…) | 每切片新开一个窗口 | **自己的 worktree**(永不碰主检出) | 领一个切片 → 读 ADR → dev-loop → 分支 commit → push → draft PR(附验证证据) | 不 merge;不动 main 检出;不改 ADR/GOAL(冲突停下报 zeus);不越切片范围 |

## Worker 窗口生命周期

1. **启动**: bao 新开 Kiro 会话,粘贴 kickoff 模板(见下)。worker 第一件事建隔离检出: `git worktree add .worktrees/<切片名> -b feat/<切片名>`,然后在该 worktree 中工作。
2. **锚定**: `.kiro/hooks/session-context.json` 的 SessionStart hook 注入 GOAL + Git truth;随后按 `.kiro/steering/development-philosophy.md` 读 `vault/ctrl/adrs/INDEX.md`、ADR-001 和该模块 ADR。
3. **开发**: 走 `.kiro/skills/dev-loop/SKILL.md`:设计 → 最小 coherent change → affected compiler/type check + targeted tests + runtime/UI smoke(as applicable)→ independent semantic review。项目级 Husky/CI 继续守 conventional commit、source checks 和 pre-push gates。
4. **交付**: push 分支 → `gh pr create --draft`,PR 描述必须含**验证证据**(编译/测试输出、gate smoke、截图 as applicable)。完成后在窗口里向 bao 报告一句结论。
5. **汇合**: zeus review(非平凡变更调用 independent semantic reviewer)→ squash merge → 删远端分支 → 更新 GOAL 切片状态 → worktree 清理(`git worktree remove`,干净才删)。

## Kickoff 模板(bao 复制到新窗口)

```
你是 <athena>,CTRL 的开发 worker。本窗口只做一个切片:
<切片名>: <一句话范围 + 验收标准>。
governing: vault/ctrl/GOAL.md 切片表 + <相关 ADR / plan 文档>。
规矩: 先建隔离 worktree 分支再动手;先读 .kiro/steering/development-philosophy.md;
动模块前读 vault/ctrl/adrs/INDEX.md + ADR-001 + 该模块 ADR;
走 .kiro/skills/dev-loop/SKILL.md;完成后 push + gh pr create --draft 并附验证证据;
不 merge、不动 main 检出、ADR 冲突停下报 zeus。
```

## GOAL 切片表

GOAL.md 保持**单一 active goal** 不变(`.kiro/skills/goal/SKILL.md` 管);goal 内新增「切片分派」小节:

```
## 切片分派
| # | 切片 | 窗口 | 分支 | 状态 |
|---|---|---|---|---|
| 1 | <切片> | athena | feat/<...> | assigned / pr-open / merged |
```

zeus 是唯一写这张表的人。

## 主检出卫生(zeus 守)

- main 检出永远干净(dirty = 有 worker 在错误的地方干活,立刻纠正);
- 中断的 WIP 一律 park 到 `wip/<线名>` 分支(先例: `wip/remote-window-s4-acl`);
- worktree 生命周期跟 PR 走,merge 后即清;`.worktrees/` 里不留过夜的孤儿。

## 明确不采用(现在)

- **Claude Code agent-teams**(former runtime's experimental shared task list + teammate messaging):不采用;当前 Kiro 多会话人工分派已够,需要实时协同再单独决策。
- **Olym fleet/handoff 恢复**:不恢复(`harness-minimal.md` 的裁决不变);历史 handoff 仅保存在 `vault/ctrl/history/handoffs/`。
- **Workflow 大编排**:单会话内按需用,不作为跨会话机制。

## 环境审计基线(Kiro migration)

每个新 Kiro 会话使用 checked-in 资产:
- `.kiro/steering/development-philosophy.md`:开发合同、hard rules、设计哲学、最小循环;
- `.kiro/skills/goal/SKILL.md` + `.kiro/skills/dev-loop/SKILL.md`:goal 锚定与实现/验证/review loop;
- `.kiro/hooks/session-context.json`:SessionStart 注入 active GOAL + Git truth;
- `vault/ctrl/adrs/`:架构与模块决策 SSOT;
- Husky + CI:repository-level source/pre-push/conventional-commit gates。

Olym/Claude-era hooks、skills、rules、handoff/fleet 机制不是当前 runtime;其文件若保留仅作迁移或历史归档。
