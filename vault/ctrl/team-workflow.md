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
> 这不是恢复 olym 多智能体框架(handoff/lane/fleet 仍然不做,见 `harness-minimal.md`)——
> 是「多个普通 Claude Code 窗口 + git worktree 隔离 + PR 汇合」的官方轻量模式。
> 官方依据: code.claude.com/docs/en/worktrees.md + settings.md + hooks.md。

## 角色

| 角色 | 窗口 | 检出 | 职责 | 不做 |
|---|---|---|---|---|
| **zeus** | 常驻管理窗口(本窗口) | **main 主检出**(`~/Documents/coding/CTRL`) | GOAL 切片与分派、PR review + squash merge、ADR 守护与 amend(经 bao)、开发环境/规范/hooks 维护、清理 worktree/分支 | 不写功能代码(环境修复、紧急小修除外) |
| **worker**(athena、hermes-w、…) | 每切片新开一个窗口 | **自己的 worktree**(永不碰主检出) | 领一个切片 → 读 ADR → dev-loop → 分支 commit → push → draft PR(附验证证据) | 不 merge;不动 main 检出;不改 ADR/GOAL(冲突停下报 zeus);不越切片范围 |

## Worker 窗口生命周期

1. **启动**: bao 新开窗口,粘贴 kickoff 模板(见下)。worker 第一件事建隔离检出:
   - 首选官方: `claude --worktree <切片名>` 启动(自动建 `.claude/worktrees/<名>/` + 新分支,退出时无改动自动清理);
   - 已开的普通窗口: `git worktree add .worktrees/<切片名> -b feat/<切片名>` 后 `cd` 进去干活。
2. **锚定**: SessionStart hook 自动注入 GOAL.md + 最近 commits + working tree(已实装,无需人工粘贴上下文);动模块前照 CLAUDE.md 硬门读 `.olym/decisions/INDEX.md` + 该模块 ADR。
3. **开发**: 走 `dev-loop` skill(三层验证 + code-reviewer 独立 checker)。保命线全部由 checked-in 的项目级 hooks 自动继承(全英文/secret 检查、verification-gate、adr-cite-gate、husky pre-push + commitlint)——新窗口零配置。
4. **交付**: push 分支 → `gh pr create --draft`,PR 描述必须含**验证证据**(编译/测试输出、gate smoke、截图)。完成后在窗口里向 bao 报告一句结论。
5. **汇合**: zeus review(必要时 spawn code-reviewer)→ squash merge → 删远端分支 → 更新 GOAL 切片状态 → worktree 清理(`git worktree remove`,干净才删)。

## Kickoff 模板(bao 复制到新窗口)

```
你是 <athena>,CTRL 的开发 worker。本窗口只做一个切片:
<切片名>: <一句话范围 + 验收标准>。
governing: vault/ctrl/GOAL.md 切片表 + <相关 ADR / plan 文档>。
规矩: 先建隔离 worktree 分支再动手; 动模块前读 INDEX.md + 该模块 ADR;
走 dev-loop; 完成后 push + gh pr create --draft 并附验证证据;
不 merge、不动 main 检出、ADR 冲突停下报 zeus。
```

## GOAL 切片表

GOAL.md 保持**单一 active goal** 不变(goal skill 管);goal 内新增「切片分派」小节:

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

- **agent-teams**(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`,共享任务列表 + 队友互发消息): 实验性,当前多窗口人工分派已够;需要实时协同再开。
- **olym fleet/handoff 恢复**: 不恢复(harness-minimal.md 的裁决不变)。
- **Workflow 大编排**: 单窗口内按需用,不作为跨窗口机制。

## 环境审计基线(2026-07-11,zeus 首轮)

已核验、每个新窗口自动继承的资产:
- `.claude/settings.json`(checked-in): 权限白名单/黑名单(含禁 `--no-verify`、禁 force-push)、english+secret PreToolUse prompt hook、verification-gate、adr-cite-gate、memory-load-injector、SessionStart 的 GOAL+git 注入、PreCompact 提示;
- husky: pre-push 全英文门 + SC5 dual-surface ratchet + commitlint(conventional);
- skills: goal / dev-loop / debug-irisy 等 + `.claude/rules/` 路径规则;
- agents: code-reviewer(独立 checker)。

本轮清理: 4.9G 陈旧 spike worktree(分支保留)+ 2 个孤儿 worktree 目录已删;remote 线孤儿 WIP park 到 `wip/remote-window-s4-acl`(tsc 过,行为未验)。
