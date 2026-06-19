---
title: CTRL 极简单人开发 harness — 全局规划图
status: governing (dev-environment)
date: 2026-06-19
owner: bao
decided_by: bao (AskUserQuestion 2026-06-19 — 选「激进剥离」)
---

# 极简单人 harness — 砍 / 留 / 改 全局图

> bao 2026-06-19 钦定：开发环境**全量升级到 110% 且极简**。
> 路径 = **激进剥离** olym 多智能体重型层，只留单人极简 harness，核心循环升到天花板。
> 本文是 system-design-first 的统管全局图 —— 先有它再动手，不 debug 式逐个删。

## 设计原则

开发环境 = Claude Code 每次运行时**加载/执行**的东西（hook / 脚本 / skill / plugin）。
极简针对**运行时 harness**，不是静态文档。判据：

- **空转即砍** —— 单人模式下永不触发的多智能体机制（lane / handoff / fleet）。
- **漂移即修** —— 引用退役物（Pi、`.kiro/` 旧路径、端口 17878）的代码。
- **保命线绝不动** —— 全英文、no-`--no-verify`、ADR 引用、验证门槛、secret 检查。
- **SSOT 绝不删** —— `.olym/decisions/` 7 ADR、`vault/`、CLAUDE.md 架构指针。

## 保留 (核心 + 保命线)

| 部件 | 角色 |
|---|---|
| `/goal` + `/dev-loop` skill | 唯一入口；目标驱动循环 |
| 内置 UI/debug skills | 按需触发、零空转，不砍 |
| PreToolUse english+secret prompt hook | 保命：全英文 + 无硬编 secret |
| `verification-gate.cjs` | 保命：ship 前强制验证证据（**升级**见下） |
| `adr-cite-gate.cjs` | 保命：改架构强制引 ADR § |
| `memory-load-injector.cjs` | 好资产：按话题注入必读 memory |
| husky `pre-push-check.js` + commitlint | 保命：全英文 pre-push + conventional commit |
| `scripts/`: bump-version / escape-cjk / git-new / release.sh | 日常工具 |
| `.olym/decisions/` (7 ADR + INDEX/PROCESS/DRIFT) | **SSOT，绝不删** |
| `code-reviewer` agent | **升级**为 independent checker |

## 升级到 110% (改)

1. **`verification-gate.cjs`** — 删退役 `pi` 检查；端口 `17878`→`17873`（架构真相源 gate）；新增证据：`curl :17873` smoke + Playwright/`:5173` 视觉验证。
2. **`dev-loop` skill** — verify 步加 `:17873` smoke + Playwright 视觉（UI 改动）；新增 **maker/checker** 独立核验步（implement 后 spawn `code-reviewer` 对照 GOAL+ADR）；停止条件加 `--max-turns` 预算。
3. **`code-reviewer` agent** — 特化为对照 `GOAL.md` + ADR § acceptance + diff 的 PASS/FAIL checker。
4. **session 注入** — `session-handoff-snapshot.js`（fleet/handoff）→ 极简 `session-context.cjs`（GOAL + git status，~15 行）。

## 剥离 (多智能体重型层 — git rm)

- hooks: `pretool-lane-guard.js`、`stop-handoffs-archive.js`、`scripts/hooks/*`（3 副本）
- plugin: `.claude-plugin/`（空壳，`agents/skills/commands` 目录根本不存在）
- commands/agents: `olym-doctor.md`、`comment-analyzer.md`
- scripts: `audit-olym-*`、`audit-all`、`audit-olympus-health`、`auto-validate.sh`、`daily-digest`、`fleet-status`、`handoff-sync`、`handoffs-archive`、`handoffs-index`、`pre-push-dispatch-check`、`scratch-new`、`specs-archive`、`specs-index`、`check-adr-acceptance`、`adr-check.py`、`keycap-to-mcp-rename`、`olym-doctor.sh`、`olym-install.sh`、`worktree-new/remove`、`probes/`（pi/hermes/irisy 全退役）、`release.ps1`
- husky: `commit-msg` 去 `[H-]` 强制（留 commitlint）；`pre-commit` 去 `.kiro/` 死代码；`pre-push` 去 dispatch 检查
- `.olym/handoffs/`、`.olym/steering/`（纯多智能体机制；`specs/brainstorm/audits` 作内容资产保留）

## 恢复方法 (多人协作需要时)

剥离走 `git rm`，全部在 git 历史中：

```
git log --oneline -- .claude-plugin/            # 找剥离前的 commit
git checkout <sha>^ -- <path>                    # 单文件恢复
```

olym 多智能体框架本体是 marketplace plugin（`.olym/VERSION` 锁 `plugin_sha`），
完整恢复 = 重装 `github.com/soodooi/hello-olym` plugin。
